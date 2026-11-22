import { Router, json } from 'express';
import { hostname } from 'node:os';
import { prisma } from '../../db/client.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { AppError } from '../../lib/errors.js';
import { ehLocal } from '../../lib/acesso.js';
import { resetUserCache } from '../../lib/currentUser.js';
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
 * precisa alcanca-lo sem o token do `.env`. Em troca, cada rota daqui diz
 * explicitamente quem pode chama-la: as de leitura e escrita pedem o codigo de
 * pareamento, e as que abrem a porta so aceitam a propria maquina.
 */
const exigeCodigo = asyncHandler(async (req, _res, next) => {
  // A propria maquina ja tem a API inteira nas maos: pedir codigo a ela seria
  // teatro, e deixaria o "salvar em arquivo" da tela dependendo de liberar a
  // rede para funcionar.
  if (ehLocal(req.socket.remoteAddress)) return next();

  const veredito = pareamento.conferir(req.get('x-chronos-pair'));
  if (veredito === 'ok') return next();
  throw new AppError(
    veredito === 'fechado' ? 'NOT_FOUND' : 'VALIDATION_FAILED',
    pareamento.MENSAGEM[veredito],
  );
});

const somenteLocal = asyncHandler(async (req, _res, next) => {
  if (!ehLocal(req.socket.remoteAddress)) {
    throw new AppError('NOT_FOUND', 'Rota inexistente.');
  }
  next();
});

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
  somenteLocal,
  asyncHandler(async (_req, res) => {
    res.json(pareamento.liberar());
  }),
);

router.post(
  '/fechar',
  somenteLocal,
  asyncHandler(async (_req, res) => {
    pareamento.fechar();
    res.json({ liberado: false });
  }),
);

/** Monta o pacote inteiro. Usado tanto pelo celular quanto pelo "salvar em arquivo". */
export async function montarPacote(): Promise<Pacote> {
  const tabelas: Pacote['tabelas'] = {};

  for (const nome of ORDEM) {
    const linhas = await tabela(nome).findMany();
    tabelas[nome] = linhas.map((l) => paraOPacote(nome, l));
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
  exigeCodigo,
  asyncHandler(async (_req, res) => {
    res.json(await montarPacote());
  }),
);

/**
 * Substitui tudo. Nao ha mescla: sem relogio comum entre os dois aparelhos,
 * mesclar seria adivinhar qual versao de uma tarefa e a boa — e adivinhar
 * errado aqui apaga trabalho que ninguem pediu para apagar.
 *
 * O limite de corpo e proprio: um banco de alguns milhares de tarefas passa
 * facil dos 2mb globais, e a falha apareceria so do lado do celular, como
 * "erro ao enviar", sem dizer o motivo.
 */
router.post(
  '/import',
  json({ limit: '64mb' }),
  exigeCodigo,
  asyncHandler(async (req, res) => {
    const pacote = validarPacote(req.body);

    const contagem = await prisma.$transaction(
      async (tx) => {
        const comTx = (nome: TabelaDoPacote) =>
          (tx as unknown as Record<string, Delegate>)[DELEGATE[nome]];

        // Filhas primeiro: o caminho inverso da insercao.
        for (const nome of [...ORDEM].reverse()) {
          await comTx(nome).deleteMany({});
        }

        const contagem: Record<string, number> = {};
        for (const nome of ORDEM) {
          const linhas = ordenarParaInserir(
            nome,
            (pacote.tabelas[nome] ?? []).map((l) => doPacote(nome, l)),
          );
          contagem[nome] = linhas.length;
          if (linhas.length > 0) {
            await comTx(nome).createMany({ data: linhas, skipDuplicates: true });
          }
        }
        return contagem;
      },
      // Apagar e reinserir um banco inteiro passa dos 5s padrao do Prisma.
      { timeout: 120_000, maxWait: 10_000 },
    );

    /**
     * O dono dos dados mudou junto com eles.
     *
     * `currentUserId` guarda o id em memoria e nada o invalidava aqui: a
     * primeira tarefa criada depois de uma importacao apontaria para um
     * usuario que a transacao acima acabou de apagar, e o erro sairia como
     * "Foreign key constraint violated: nodes_user_id_fkey" — longe daqui, sem
     * dizer o motivo.
     */
    resetUserCache();

    // O pareamento serve uma transferencia: deixar a porta aberta depois de
    // usar seria transformar um gesto deliberado numa janela esquecida.
    pareamento.fechar();
    res.json({ importado: true, contagem, resumo: resumoDoPacote(pacote) });
  }),
);

export default router;
