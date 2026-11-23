import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, RequestHandler, Response } from 'express';
import { prisma } from '../db/client.js';
import { AppError } from './errors.js';
import { hashSegredo, novoSegredo } from './senha.js';

/**
 * Quem esta fazendo a requisicao.
 *
 * O servidor inteiro pergunta isso por `currentUserId()` — sao dezenas de
 * chamadas. Em vez de passar o usuario de mao em mao por cada servico, o
 * porteiro grava a resposta aqui e ela acompanha a requisicao ate o fim,
 * inclusive atraves dos `await`.
 */
interface Contexto {
  /** De quem sao os dados desta requisicao. */
  userId?: string;
  /** Como entrou: pela tela (cookie) ou por token de API (MCP, scripts). */
  via?: 'sessao' | 'token';
  /** Admin agindo no espaco de `userId`: quem ele e de verdade. */
  adminId?: string;
  adminNome?: string;
}

/** Quem esta por tras da requisicao, para a resolucao de sessao/token. */
export interface Quem {
  userId: string;
  via: 'sessao' | 'token';
  adminId?: string;
  adminNome?: string;
}

export const contexto = new AsyncLocalStorage<Contexto>();

/** Abre o contexto vazio de cada requisicao; o porteiro preenche depois. */
export const abrirContexto: RequestHandler = (_req, _res, next) => {
  contexto.run({}, next);
};

export function definirUsuario(quem: Quem) {
  const atual = contexto.getStore();
  if (!atual) throw new Error('definirUsuario fora de uma requisicao');
  atual.userId = quem.userId;
  atual.via = quem.via;
  atual.adminId = quem.adminId;
  atual.adminNome = quem.adminNome;
}

/** A pessoa de verdade por tras da requisicao (o admin, quando ele atua por outra conta). */
export function pessoaReal(): string | undefined {
  const c = contexto.getStore();
  return c?.adminId ?? c?.userId;
}

/**
 * Nome que assina a atividade e as atualizacoes. Quando o admin age no espaco
 * de outra conta, fica registrado que foi ele — nunca em nome da pessoa.
 */
export function assinaturaDoAdmin(): string | null {
  const c = contexto.getStore();
  return c?.adminId ? `${c.adminNome ?? 'Admin'} (admin)` : null;
}

/**
 * Embrulha um middleware que chama `next` de dentro de eventos de stream (o
 * leitor de corpo JSON, por exemplo). Esses eventos nascem no socket, fora do
 * contexto da requisicao — sem isto, o porteiro seguinte nao acharia onde
 * gravar o usuario.
 */
export function preservarContexto(mw: RequestHandler): RequestHandler {
  return (req, res, next) => {
    const store = contexto.getStore();
    mw(req, res, (err?: unknown) => (store ? contexto.run(store, () => next(err)) : next(err)));
  };
}

/**
 * Conexao direta desta mesma maquina, sem proxy no meio. So serve para
 * liberar o primeiro acesso sem convite no app desktop. Atras de tunel ou
 * proxy, o socket pode ate ser local, mas eles anunciam o cliente real
 * nestes cabecalhos — e ai ja nao e "a propria maquina".
 */
export function daPropriaMaquina(req: Request): boolean {
  const endereco = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  const loopback = endereco === '127.0.0.1' || endereco === '::1';
  const viaProxy = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'cf-connecting-ip'].some(
    (h) => req.get(h),
  );
  return loopback && !viaProxy;
}

/** Quem esta chamando, para o freio de tentativas. Atras da Cloudflare, o IP real. */
export function cliente(req: Request): string {
  return req.get('cf-connecting-ip') ?? (req.socket.remoteAddress ?? 'desconhecido');
}

export const COOKIE = 'chronos_sessao';
const DURACAO_MS = 30 * 24 * 60 * 60 * 1000;
/** Renovar a cada requisicao seria uma escrita no banco por clique. */
const RENOVAR_APOS_MS = 60 * 60 * 1000;

/** Le um cookie sem depender de `cookie-parser`. */
export function lerCookie(cabecalho: string | undefined, nome: string): string | null {
  if (!cabecalho) return null;
  for (const parte of cabecalho.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    if (parte.slice(0, i).trim() === nome) {
      try {
        return decodeURIComponent(parte.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** `Authorization: Bearer <token>`, como o MCP manda. */
export function lerBearer(cabecalho: string | undefined): string | null {
  if (!cabecalho?.startsWith('Bearer ')) return null;
  return cabecalho.slice(7).trim() || null;
}

/**
 * `Secure` quando a conexao do navegador e HTTPS. Atras do tunel da
 * Cloudflare o servidor recebe HTTP, mas o tunel avisa no X-Forwarded-Proto.
 * Um cliente pode forjar esse cabecalho, so que o efeito seria apenas deixar
 * o proprio cookie mais restrito.
 */
function seguro(req: Request) {
  return process.env.CHRONOS_COOKIE_SEGURO === 'true' || req.get('x-forwarded-proto') === 'https';
}

function gravarCookie(req: Request, res: Response, valor: string, maxAgeS: number) {
  const partes = [
    `${COOKIE}=${encodeURIComponent(valor)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeS}`,
  ];
  if (seguro(req)) partes.push('Secure');
  res.append('Set-Cookie', partes.join('; '));
}

/** Tokens de API (MCP, scripts) comecam assim; qualquer outro Bearer e sessao de app. */
export const PREFIXO_TOKEN_API = 'chr_';

/**
 * A sessao desta requisicao: no navegador vem no cookie; no app do celular,
 * que fala com o servidor de outra origem e nao guarda cookie, vem no
 * `Authorization: Bearer`. As duas sao a mesma coisa — uma linha em
 * `sessions` —, entao sair, trocar a senha e o bloqueio valem igual.
 */
function sessaoNoBearer(req: Request): string | null {
  const bearer = lerBearer(req.get('authorization'));
  return bearer && !bearer.startsWith(PREFIXO_TOKEN_API) ? bearer : null;
}

export function tokenDaSessao(req: Request): string | null {
  return sessaoNoBearer(req) ?? lerCookie(req.get('cookie'), COOKIE);
}

/**
 * Abre a sessao. No navegador ela vai no cookie; com `app`, o token volta para
 * quem chamou (o app guarda no Keychain) e nenhum cookie e gravado.
 */
export async function abrirSessao(
  req: Request,
  res: Response,
  userId: string,
  { app = false } = {},
): Promise<string> {
  const token = novoSegredo(app ? 'cs_' : '');
  await prisma.session.create({
    data: {
      user_id: userId,
      token_hash: hashSegredo(token),
      user_agent: req.get('user-agent')?.slice(0, 300) ?? null,
      expires_at: new Date(Date.now() + DURACAO_MS),
    },
  });
  if (!app) gravarCookie(req, res, token, DURACAO_MS / 1000);
  return token;
}

export async function encerrarSessao(req: Request, res: Response) {
  const doApp = sessaoNoBearer(req);
  const token = doApp ?? lerCookie(req.get('cookie'), COOKIE);
  if (token) await prisma.session.deleteMany({ where: { token_hash: hashSegredo(token) } });
  if (!doApp) gravarCookie(req, res, '', 0);
}

/**
 * Descobre o usuario pelo cookie de sessao ou pelo token de API. Devolve null
 * quando nao ha credencial valida; quem chama decide se isso e erro.
 */
export async function resolverUsuario(
  req: Request,
  res: Response,
  { aceitarToken = true } = {},
): Promise<Quem | null> {
  const bearer = lerBearer(req.get('authorization'));
  if (bearer?.startsWith(PREFIXO_TOKEN_API) && aceitarToken) {
    const token = await prisma.apiToken.findUnique({
      where: { token_hash: hashSegredo(bearer) },
      select: { id: true, user_id: true, last_used_at: true, user: { select: { bloqueado_em: true } } },
    });
    // Conta bloqueada: o token para de valer junto com o resto.
    if (!token || token.user.bloqueado_em) return null;
    if (!token.last_used_at || Date.now() - token.last_used_at.getTime() > 60_000) {
      await prisma.apiToken.update({ where: { id: token.id }, data: { last_used_at: new Date() } });
    }
    return { userId: token.user_id, via: 'token' };
  }

  const doApp = sessaoNoBearer(req);
  const valor = doApp ?? lerCookie(req.get('cookie'), COOKIE);
  if (!valor) return null;
  const sessao = await prisma.session.findUnique({
    where: { token_hash: hashSegredo(valor) },
    select: {
      id: true,
      user_id: true,
      expires_at: true,
      last_seen_at: true,
      atuando_como_id: true,
      user: { select: { name: true, papel: true, bloqueado_em: true } },
      atuando_como: { select: { id: true } },
    },
  });
  if (!sessao || sessao.user.bloqueado_em) return null;
  if (sessao.expires_at.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: sessao.id } }).catch(() => {});
    return null;
  }

  // Sessao deslizante: quem usa todo dia nao e deslogado no dia 30.
  if (Date.now() - sessao.last_seen_at.getTime() > RENOVAR_APOS_MS) {
    await prisma.session.update({
      where: { id: sessao.id },
      data: { last_seen_at: new Date(), expires_at: new Date(Date.now() + DURACAO_MS) },
    });
    // O app nao tem cookie: o token dele e o mesmo, so o prazo no banco anda.
    if (!doApp) gravarCookie(req, res, valor, DURACAO_MS / 1000);
  }

  // Admin no espaco de outra conta. So vale enquanto ele continuar admin; se
  // perdeu o papel, a sessao volta sozinha a ser so dele.
  if (sessao.atuando_como_id && sessao.user.papel === 'ADMIN' && sessao.atuando_como) {
    return {
      userId: sessao.atuando_como_id,
      via: 'sessao',
      adminId: sessao.user_id,
      adminNome: sessao.user.name,
    };
  }
  return { userId: sessao.user_id, via: 'sessao' };
}

/**
 * O porteiro da API. Nao ha mais excecao para "a propria maquina": atras de
 * um tunel ou proxy, toda conexao chega de 127.0.0.1, e foi exatamente isso
 * que tornava a regra antiga perigosa na nuvem.
 */
export const exigeLogin: RequestHandler = (req, res, next) => {
  resolverUsuario(req, res)
    .then((quem) => {
      if (!quem) {
        next(new AppError('NAO_AUTENTICADO', 'Entre na sua conta para continuar.'));
        return;
      }
      definirUsuario(quem);
      next();
    })
    .catch(next);
};

/**
 * Acoes que mexem na propria conta (senha, tokens, apagar tudo, transferir)
 * so pela tela. Um token de API vazado — ele mora num arquivo de configuracao
 * do MCP — nao pode criar outros tokens, trocar a senha nem levar a base.
 */
export const somenteSessao: RequestHandler = (_req, _res, next) => {
  const c = contexto.getStore();
  if (c?.via === 'token') {
    next(new AppError('SO_PELA_TELA', 'Esta acao so pode ser feita pela tela do app, nao com token de API.'));
    return;
  }
  // No espaco de outra conta, o admin cuida dos projetos, nao da conta da
  // pessoa: senha, tokens, apagar tudo e transferir continuam so dela.
  if (c?.adminId) {
    next(
      new AppError(
        'SO_PELA_TELA',
        'Acao da propria conta: volte para o seu espaco para fazer isso. Contas de outros se gerenciam na tela de Admin.',
      ),
    );
    return;
  }
  next();
};

/** So admin (a pessoa de verdade, mesmo agindo no espaco de outra conta). */
export const exigeAdmin: RequestHandler = (_req, _res, next) => {
  const id = pessoaReal();
  if (!id) {
    next(new AppError('NAO_AUTENTICADO', 'Entre na sua conta para continuar.'));
    return;
  }
  prisma.user
    .findUnique({ where: { id }, select: { papel: true, bloqueado_em: true } })
    .then((u) => {
      if (!u || u.papel !== 'ADMIN' || u.bloqueado_em) {
        next(new AppError('SO_ADMIN', 'So administradores podem fazer isso.'));
        return;
      }
      next();
    })
    .catch(next);
};
