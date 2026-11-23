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
  userId?: string;
  /** Como entrou: pela tela (cookie) ou por token de API (MCP, scripts). */
  via?: 'sessao' | 'token';
}

export const contexto = new AsyncLocalStorage<Contexto>();

/** Abre o contexto vazio de cada requisicao; o porteiro preenche depois. */
export const abrirContexto: RequestHandler = (_req, _res, next) => {
  contexto.run({}, next);
};

export function definirUsuario(userId: string, via: 'sessao' | 'token') {
  const atual = contexto.getStore();
  if (!atual) throw new Error('definirUsuario fora de uma requisicao');
  atual.userId = userId;
  atual.via = via;
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

export async function abrirSessao(req: Request, res: Response, userId: string) {
  const token = novoSegredo();
  await prisma.session.create({
    data: {
      user_id: userId,
      token_hash: hashSegredo(token),
      user_agent: req.get('user-agent')?.slice(0, 300) ?? null,
      expires_at: new Date(Date.now() + DURACAO_MS),
    },
  });
  gravarCookie(req, res, token, DURACAO_MS / 1000);
}

export async function encerrarSessao(req: Request, res: Response) {
  const token = lerCookie(req.get('cookie'), COOKIE);
  if (token) await prisma.session.deleteMany({ where: { token_hash: hashSegredo(token) } });
  gravarCookie(req, res, '', 0);
}

/**
 * Descobre o usuario pelo cookie de sessao ou pelo token de API. Devolve null
 * quando nao ha credencial valida; quem chama decide se isso e erro.
 */
export async function resolverUsuario(
  req: Request,
  res: Response,
  { aceitarToken = true } = {},
): Promise<{ userId: string; via: 'sessao' | 'token' } | null> {
  const bearer = aceitarToken ? lerBearer(req.get('authorization')) : null;
  if (bearer) {
    const token = await prisma.apiToken.findUnique({
      where: { token_hash: hashSegredo(bearer) },
      select: { id: true, user_id: true, last_used_at: true },
    });
    if (!token) return null;
    if (!token.last_used_at || Date.now() - token.last_used_at.getTime() > 60_000) {
      await prisma.apiToken.update({ where: { id: token.id }, data: { last_used_at: new Date() } });
    }
    return { userId: token.user_id, via: 'token' };
  }

  const valor = lerCookie(req.get('cookie'), COOKIE);
  if (!valor) return null;
  const sessao = await prisma.session.findUnique({
    where: { token_hash: hashSegredo(valor) },
    select: { id: true, user_id: true, expires_at: true, last_seen_at: true },
  });
  if (!sessao) return null;
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
    gravarCookie(req, res, valor, DURACAO_MS / 1000);
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
      definirUsuario(quem.userId, quem.via);
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
  if (contexto.getStore()?.via === 'token') {
    next(new AppError('SO_PELA_TELA', 'Esta acao so pode ser feita pela tela do app, nao com token de API.'));
    return;
  }
  next();
};
