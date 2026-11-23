import { Router, json } from 'express';
import { hostname } from 'node:os';
import { prisma } from '../../db/client.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { AppError } from '../../lib/errors.js';
import { currentUserId } from '../../lib/currentUser.js';
import { hasModel } from '../../lib/schemaGuard.js';
import {
  definirUsuario,
  exigeLogin,
  preservarContexto,
  resolverUsuario,
  somenteSessao,
} from '../../lib/sessao.js';
import * as pareamento from '../../lib/pareamento.js';
import {
  FORMATO_DO_PACOTE,
  validarPacote,
  resumoDoPacote,
  ordenarParaInserir,
  type Pacote,
  type TabelaDoPacote,
} from '../../../shared/transferencia.js';
import { DELEGATE, ORDEM, paraOPacote, doPacote } from './pacote.js';

const router = Router();

/** O nome que o iPhone mostra na lista: "MacBook do Henrique". */
export const nomeDesteComputador = () =>
  (process.env.CHRONOS_NOME ?? hostname()).replace(/\.local$/, '');

type Delegate = {
  findMany: (args?: unknown) => Promise<Array<Record<string, unknown>>>;
  deleteMany: (args?: unknown) => Promise<unknown>;
  createMany: (args: unknown) => Promise<unknown>;
  count: () => Promise<number>;
};

const tabela = (nome: TabelaDoPacote): Delegate =>
  (prisma as unknown as Record<string, Delegate>)[DELEGATE[nome]];

/**
 * Este modulo e montado **antes** do porteiro geral da API, porque o celular
 * nao faz login. Cada rota daqui diz quem pode chama-la: ler e escrever aceita
 * a sessao de quem esta no computador ou o codigo de pareamento; abrir e
 * fechar a porta, so com login.
 *
 * Nao ha mais atalho para "a propria maquina": atras de tunel ou proxy toda
 * conexao chega de 127.0.0.1, e o atalho entregaria o banco a qualquer um.
 */
const exigeSessaoOuCodigo = asyncHandler(async (req, res, next) => {
  // Token de API nao serve: transferir leva a conta inteira (ver somenteSessao).
  const quem = await resolverUsuario(req, res, { aceitarToken: false });
  if (quem) {
    // Admin no espaco de outra conta nao leva nem substitui a base dela.
    if (quem.adminId) {
      throw new AppError('SO_PELA_TELA', 'Transferencia so da propria conta: volte para o seu espaco.');
    }
    definirUsuario(quem);
    return next();
  }

  const veredito = pareamento.conferir(req.get('x-chronos-pair'));
  const dono = pareamento.dono();
  if (veredito === 'ok' && dono) {
    definirUsuario({ userId: dono, via: 'sessao' });
    return next();
  }
  throw new AppError(
    veredito === 'fechado' ? 'NOT_FOUND' : 'VALIDATION_FAILED',
    pareamento.MENSAGEM[veredito === 'ok' ? 'fechado' : veredito],
  );
});

/**
 * O que, em cada tabela do pacote, pertence a uma conta. A exportacao leva so
 * isso; a importacao apaga so isso.
 */
const DA_CONTA: Record<TabelaDoPacote, (userId: string) => Record<string, unknown>> = {
  users: (u) => ({ id: u }),
  spaces: (u) => ({ user_id: u }),
  members: (u) => ({ user_id: u }),
  space_members: (u) => ({ space: { user_id: u } }),
  task_templates: (u) => ({ user_id: u }),
  nodes: (u) => ({ user_id: u }),
  node_dependencies: (u) => ({ blocked: { user_id: u } }),
  progress_snapshots: (u) => ({ node: { user_id: u } }),
  node_activity: (u) => ({ node: { user_id: u } }),
  backlog_items: (u) => ({ user_id: u }),
  backlog_roles: (u) => ({ backlog_item: { user_id: u } }),
};

/**
 * O que nao viaja: login (o iPhone nem tem as colunas, e senha nao sai do
 * servidor) e a chave da IA, que e segredo — a tela de ajustes so a mostra
 * mascarada, e o pacote nao pode ser o atalho para le-la inteira.
 */
const SO_NO_SERVIDOR = ['email', 'password_hash', 'gemini_api_key', 'papel', 'bloqueado_em', 'dono'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A arvore do pacote tem de ser coerente: `path` e o caminho de ids ate o
 * no, `depth` a profundidade, `parent_id` o penultimo id. Varias consultas
 * acham uma subarvore so pelo comeco do `path`; um caminho forjado (ou com
 * curinga) faria essas consultas alcancarem nos de outras contas.
 */
function validarArvore(nos: Array<Record<string, unknown>>) {
  for (const no of nos) {
    const id = String(no.id ?? '');
    const caminho = String(no.path ?? '').split('/');
    const ok =
      UUID.test(id) &&
      caminho.every((parte) => UUID.test(parte)) &&
      caminho[caminho.length - 1] === id &&
      Number(no.depth) === caminho.length - 1 &&
      (no.parent_id ?? null) === (caminho.length > 1 ? caminho[caminho.length - 2] : null);
    if (!ok) {
      throw new AppError('VALIDATION_FAILED', `Pacote com arvore inconsistente na tarefa ${id || '(sem id)'}.`);
    }
  }
}

/** O que do perfil do pacote substitui o perfil da conta. Login fica. */
const PERFIL = [
  'name',
  'birth_date',
  'life_expectancy',
  'daily_focus_goal_minutes',
  'daily_impact_goal',
  'timezone',
  'gemini_model',
];

/**
 * O cartao de visita. Nao pede codigo de proposito: e o que permite ao celular
 * listar "achei o MacBook do Henrique" antes de voce digitar qualquer coisa.
 * Por isso nao carrega numero nenhum sobre os dados — so o nome do aparelho.
 */
router.get(
  '/info',
  asyncHandler(async (_req, res) => {
    res.json({
      app: 'chronos-flow',
      tipo: 'desktop',
      nome: nomeDesteComputador(),
      formato: FORMATO_DO_PACOTE,
      liberado: pareamento.liberado(),
      expiraEm: pareamento.segundosRestantes(),
    });
  }),
);

router.post(
  '/liberar',
  exigeLogin,
  somenteSessao,
  asyncHandler(async (_req, res) => {
    const liberado = pareamento.liberar(await currentUserId());
    if (!liberado) {
      throw new AppError(
        'PAREAMENTO_OCUPADO',
        'Outra conta esta transferindo agora. Tente de novo em alguns minutos.',
      );
    }
    res.json(liberado);
  }),
);

router.post(
  '/fechar',
  exigeLogin,
  somenteSessao,
  asyncHandler(async (_req, res) => {
    pareamento.fechar(await currentUserId());
    res.json({ liberado: false });
  }),
);

/** Monta o pacote de uma conta. Usado tanto pelo celular quanto pelo "salvar em arquivo". */
export async function montarPacote(userId: string): Promise<Pacote> {
  const tabelas: Pacote['tabelas'] = {};

  for (const nome of ORDEM) {
    const linhas = await tabela(nome).findMany({ where: DA_CONTA[nome](userId) });
    tabelas[nome] = linhas.map((l) => {
      const linha = paraOPacote(nome, l);
      if (nome === 'users') for (const c of SO_NO_SERVIDOR) delete linha[c];
      return linha;
    });
  }

  return {
    formato: FORMATO_DO_PACOTE,
    app: 'chronos-flow',
    origem: { tipo: 'desktop', nome: nomeDesteComputador() },
    exportadoEm: new Date().toISOString(),
    tabelas,
  };
}

router.get(
  '/export',
  exigeSessaoOuCodigo,
  asyncHandler(async (_req, res) => {
    const pacote = await montarPacote(await currentUserId());
    // Um codigo, uma transferencia: depois de levar os dados, a porta fecha.
    pareamento.fechar();
    res.json(pacote);
  }),
);

/**
 * Substitui os dados da conta. Nao ha mescla: sem relogio comum entre os dois
 * aparelhos, mesclar seria adivinhar qual versao de uma tarefa e a boa — e
 * adivinhar errado aqui apaga trabalho que ninguem pediu para apagar.
 *
 * So com uma conta no servidor. Os ids do pacote sao os do aparelho de
 * origem; com outras contas no banco, um id repetido faria a linha ser pulada
 * em silencio, ou pior, pendurar a arvore de uma conta na de outra.
 *
 * O limite de corpo e proprio: um banco de alguns milhares de tarefas passa
 * facil dos 2mb globais, e a falha apareceria so do lado do celular, como
 * "erro ao enviar", sem dizer o motivo.
 */
router.post(
  '/import',
  preservarContexto(json({ limit: '64mb' })),
  exigeSessaoOuCodigo,
  asyncHandler(async (req, res) => {
    const pacote = validarPacote(req.body);
    validarArvore(pacote.tabelas.nodes ?? []);
    const userId = await currentUserId();

    const contagem = await prisma.$transaction(
      async (tx) => {
        // Dentro da transacao: uma conta criada no meio da importacao nao
        // escapa da checagem.
        if ((await tx.user.count()) > 1) {
          throw new AppError(
            'VARIAS_CONTAS',
            'Importar substitui os dados pelo pacote, e isso so e seguro com uma conta no servidor. ' +
              'Este servidor tem mais de uma.',
          );
        }

        const comTx = (nome: TabelaDoPacote) =>
          (tx as unknown as Record<string, Delegate>)[DELEGATE[nome]];

        /**
         * As atualizacoes (feed em markdown) nao viajam no pacote: o iPhone nao
         * tem essa tabela, e incluir a chave quebraria a importacao do lado de
         * la. Sem isto, apagar as tarefas abaixo levaria o feed junto, em
         * cascata, a cada transferencia vinda do celular. Entao ele sai antes
         * e volta depois para toda tarefa que continuar existindo — os ids das
         * tarefas sao os mesmos nos dois aparelhos.
         */
        const feedLocal = hasModel('nodeUpdate')
          ? await tx.nodeUpdate.findMany({ where: { node: { user_id: userId } } })
          : [];

        // Filhas primeiro: o caminho inverso da insercao. A linha do usuario
        // fica — e nela que moram o login e as sessoes.
        for (const nome of [...ORDEM].reverse()) {
          if (nome === 'users') continue;
          await comTx(nome).deleteMany({ where: DA_CONTA[nome](userId) });
        }

        const perfil = pacote.tabelas.users?.[0] ? doPacote('users', pacote.tabelas.users[0]) : null;
        if (perfil) {
          const data: Record<string, unknown> = {};
          for (const campo of PERFIL) if (perfil[campo] !== undefined) data[campo] = perfil[campo];
          // A chave da IA do pacote so entra se existir: um celular sem chave
          // nao deve apagar a que esta configurada aqui.
          if (perfil.gemini_api_key) data.gemini_api_key = perfil.gemini_api_key;
          await tx.user.update({ where: { id: userId }, data });
        }

        const contagem: Record<string, number> = { users: perfil ? 1 : 0 };
        for (const nome of ORDEM) {
          if (nome === 'users') continue;
          const linhas = ordenarParaInserir(
            nome,
            (pacote.tabelas[nome] ?? []).map((l) => {
              const linha = doPacote(nome, l);
              // O pacote traz o id do usuario do aparelho de origem.
              if ('user_id' in linha) linha.user_id = userId;
              return linha;
            }),
          );
          contagem[nome] = linhas.length;
          if (linhas.length > 0) {
            await comTx(nome).createMany({ data: linhas, skipDuplicates: true });
          }
        }

        if (feedLocal.length > 0) {
          const nos = new Set(
            (await tx.node.findMany({ where: { user_id: userId }, select: { id: true } })).map((n) => n.id),
          );
          const mantidas = feedLocal.filter((u) => nos.has(u.node_id));
          if (mantidas.length > 0) {
            await tx.nodeUpdate.createMany({ data: mantidas, skipDuplicates: true });
          }
          contagem.node_updates_mantidas = mantidas.length;
        }
        return contagem;
      },
      // Apagar e reinserir um banco inteiro passa dos 5s padrao do Prisma.
      { timeout: 120_000, maxWait: 10_000 },
    );

    // O pareamento serve uma transferencia: deixar a porta aberta depois de
    // usar seria transformar um gesto deliberado numa janela esquecida.
    pareamento.fechar();
    res.json({ importado: true, contagem, resumo: resumoDoPacote(pacote) });
  }),
);

export default router;
