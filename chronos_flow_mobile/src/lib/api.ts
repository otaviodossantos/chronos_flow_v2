import { ZodError } from 'zod';
import type {
  NodeDTO,
  SpaceDTO,
  MemberDTO,
  CompleteResult,
  FocusItem,
  LifeSummary,
  BacklogItemDTO,
  AiSettings,
  ReopenResult,
  TaskTemplateDTO,
} from '@shared/types';
import type { AiPlan } from '@shared/schemas/index';
import {
  createNodeSchema,
  updateNodeSchema,
  breakdownSchema,
  moveNodeSchema,
  rescheduleSchema,
  treeQuerySchema,
  createSpaceSchema,
  createTemplateSchema,
  instantiateTemplateSchema,
  createMemberSchema,
  createDependencySchema,
  createBacklogSchema,
  updateUserSchema,
  simulateSchema,
  applyPlanSchema,
  aiSettingsSchema,
  resetSchema,
} from '@shared/schemas/index';
import { generateJson, listModels, transcribeAudio, resolveModel } from '@ia/gemini';
import { api as web, ApiError as ErroDoServidor } from '@desktop/src/lib/api';
import { noServidor } from '@/data/servidores';
import { planBacklogItem } from '@ia/planner';
import { eq } from 'drizzle-orm';
import { users } from '@db/schema';
import { bd as banco } from '@/data/conexao';
import * as nos from '@/data/nos';
import * as espacos from '@/data/espacos';
import * as membros from '@/data/membros';
import * as modelos from '@/data/modelos';
import * as foco from '@/data/foco';
import * as vida from '@/data/vida';
import * as relatorios from '@/data/relatorios';
import * as dependencias from '@/data/dependencias';
import * as backlog from '@/data/backlog';
import * as usuario from '@/data/usuario';
import * as prefs from '@/data/preferencias';
import * as transferencia from '@/data/transferencia';

/**
 * A mesma superficie do desktop, sem servidor nenhum.
 *
 * As telas foram escritas contra `api.tree(...)`, `api.createNode(...)` e por
 * aí afora, sem nunca saber que do outro lado havia HTTP. Mantendo as
 * assinaturas e os formatos de retorno, elas atravessam para o iPhone sem uma
 * linha alterada — o que era `fetch` vira chamada de funcao contra o SQLite do
 * aparelho, e o que era rota do Express vira a validacao do mesmo schema.
 *
 * Por isso a validacao mora aqui e nao nos servicos: no desktop quem recusava
 * um corpo malformado era a rota, e refazer isso em cada servico faria os dois
 * apps recusarem coisas diferentes.
 */

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export interface NodeDetail {
  node: NodeDTO;
  /** Tamanho da subarvore abaixo deste no: o que some junto numa exclusao. */
  descendants: number;
  ancestors: Array<{ id: string; title: string; depth: number; progress: number }>;
  children: NodeDTO[];
  dependsOn: Array<{ id: string; title: string; status: string; dependency_id: string }>;
  blocksNodes: Array<{ id: string; title: string; status: string; dependency_id: string }>;
  activity: Array<{ id: string; actor: string; kind: string; message: string; created_at: string }>;
}

export interface FocusQueue {
  queue: FocusItem[];
  impediments: FocusItem[];
  potentialImpact: number;
  completedToday: number;
}

export interface ReschedulePlan {
  applied: boolean;
  /** Ancestrais que cresceram para conter a tarefa ajustada. */
  grew?: Array<{ id: string; title: string }>;
  /** true quando o encolhimento parou no fim da ultima filha. */
  clampedToChildren?: boolean;
  plan: {
    shiftedDays: number;
    shiftedMinutes: number;
    /** 1 = so mudou de lugar; 0.5 = a janela virou metade. */
    scale: number;
    affected: Array<{ id: string; title: string; to: { start_date: string | null; due_date: string | null } }>;
    violations: Array<{ id: string; title: string; violations: Array<{ code: string; message: string }> }>;
  };
}

export interface RiskRow {
  id: string;
  title: string;
  space: { name: string; color: string } | null;
  owner: string | null;
  progress: number;
  childCount: number;
  levels: number;
  blocked: number;
  overdue: number;
  risk: 'good' | 'warning' | 'critical';
  focalPoint: string | null;
}

/**
 * Nao ha login: o aparelho e de uma pessoa so. O id fica em memoria porque
 * cada chamada atravessaria a ponte do Capacitor para reler a mesma linha.
 */
const eu = (): Promise<string> => usuario.usuarioAtual();

/** Erros de dominio viram ApiError, que e o que as telas ja sabem tratar. */
async function comErro<T>(trabalho: () => Promise<T>): Promise<T> {
  try {
    return await trabalho();
  } catch (erro) {
    if (erro instanceof ApiError) throw erro;
    if (erro instanceof ZodError) {
      throw new ApiError('VALIDATION_FAILED', 'Dados invalidos.', erro.flatten());
    }
    const e = erro as { code?: string; message?: string; details?: unknown };
    throw new ApiError(e.code ?? 'INTERNAL', e.message ?? 'Falha inesperada.', e.details);
  }
}

const mask = (key: string | null) =>
  key ? `${key.slice(0, 4)}${'•'.repeat(Math.max(0, key.length - 8))}${key.slice(-4)}` : null;

async function linhaDoUsuario() {
  const u = await banco().select().from(users).where(eq(users.id, await eu())).get();
  if (!u) throw new ApiError('NOT_FOUND', 'Usuario nao encontrado.');
  return u;
}

/**
 * No desktop havia `GEMINI_API_KEY` no ambiente do servidor. Aqui nao ha
 * ambiente: ou a chave esta no aparelho ou nao ha IA, e dizer isso cedo e
 * melhor do que falhar no meio de um planejamento.
 */
async function configDaIA() {
  const u = await linhaDoUsuario();
  if (!u.gemini_api_key) {
    throw new ApiError(
      'VALIDATION_FAILED',
      'Nenhuma chave do Gemini configurada. Adicione a sua em Configuracoes.',
    );
  }
  return { apiKey: u.gemini_api_key, model: await resolveModel(u.gemini_api_key, u.gemini_model) };
}

const apiLocal = {
  // ---------------------------------------------------------------- arvore
  tree: (params: {
    rootId?: string;
    spaceId?: string;
    assigneeId?: string;
    maxDepth?: number;
    status?: string;
    search?: string;
  }) => comErro(async () => nos.arvore(await eu(), treeQuerySchema.parse(params))),

  children: (id: string) => comErro(() => nos.filhasDe(id)),
  nodeDetail: (id: string) => comErro(() => nos.detalhe(id)) as Promise<NodeDetail>,

  createNode: (body: Record<string, unknown>) =>
    comErro(async () => nos.criar(await eu(), createNodeSchema.parse(body))),

  updateNode: (id: string, body: Record<string, unknown>) =>
    comErro(async () => nos.atualizar(await eu(), id, updateNodeSchema.parse(body))),

  completeNode: (id: string) =>
    comErro(async () => nos.concluir(await eu(), id)) as Promise<CompleteResult>,

  reopenNode: (id: string) =>
    comErro(async () => nos.reabrir(await eu(), id)) as Promise<ReopenResult>,

  breakdown: (id: string, body: Record<string, unknown>) =>
    comErro(async () => nos.quebrar(await eu(), id, breakdownSchema.parse(body))) as Promise<{
      parent: NodeDTO;
      children: NodeDTO[];
    }>,

  moveNode: (id: string, parent_id: string | null, position?: number) =>
    comErro(async () => {
      const corpo = moveNodeSchema.parse({ parent_id, position });
      return nos.mover(await eu(), id, corpo.parent_id ?? null, corpo.position);
    }),

  reschedule: (id: string, body: Record<string, unknown>) =>
    comErro(() => nos.reagendar(id, rescheduleSchema.parse(body))) as Promise<ReschedulePlan>,

  deleteNode: (id: string) =>
    comErro(() => nos.excluir(id)) as Promise<{ deleted: boolean; removed: number }>,

  // --------------------------------------------------------------- espacos
  spaces: () => comErro(async () => espacos.listar(await eu())) as Promise<SpaceDTO[]>,
  createSpace: (body: Record<string, unknown>) =>
    comErro(async () => espacos.criar(await eu(), createSpaceSchema.parse(body))),
  updateSpace: (id: string, body: Record<string, unknown>) =>
    comErro(() => espacos.atualizar(id, body)),
  deleteSpace: (id: string) => comErro(() => espacos.excluir(id)),

  addMemberToSpace: (spaceId: string, memberId: string) =>
    comErro(() => espacos.vincularMembro(spaceId, memberId)),
  removeMemberFromSpace: (spaceId: string, memberId: string) =>
    comErro(() => espacos.desvincularMembro(spaceId, memberId)),

  // ---------------------------------------------------------------- equipe
  members: () => comErro(async () => membros.listar(await eu())) as Promise<MemberDTO[]>,
  createMember: (body: Record<string, unknown>) =>
    comErro(async () => membros.criar(await eu(), createMemberSchema.parse(body))),
  updateMember: (id: string, body: Record<string, unknown>) =>
    comErro(() => membros.atualizar(id, createMemberSchema.partial().parse(body))),

  // --------------------------------------------------------------- modelos
  templates: (spaceId?: string | null) =>
    comErro(async () => modelos.listar(await eu(), spaceId ?? undefined)) as Promise<
      TaskTemplateDTO[]
    >,
  createTemplate: (body: Record<string, unknown>) =>
    comErro(async () => modelos.criar(await eu(), createTemplateSchema.parse(body))),
  updateTemplate: (id: string, body: Record<string, unknown>) =>
    comErro(() => modelos.atualizar(id, createTemplateSchema.partial().parse(body))),
  deleteTemplate: (id: string) => comErro(() => modelos.excluir(id)),
  instantiateTemplate: (id: string, body: Record<string, unknown>) =>
    comErro(async () => modelos.instanciar(await eu(), id, instantiateTemplateSchema.parse(body))),

  // ------------------------------------------------------------------ foco
  focusQueue: (params: { scope?: string; assigneeId?: string }) =>
    comErro(async () => foco.fila(await eu(), params)) as Promise<FocusQueue>,
  simulate: (nodeIds: string[]) =>
    comErro(() => foco.simular(simulateSchema.parse({ nodeIds }).nodeIds)),

  /**
   * So existe no mobile: e o que os widgets da tela inicial mostram.
   *
   * Vem numa chamada so de proposito — o widget e atualizado de fora do app,
   * as vezes com o WebView ja congelando, e tres consultas encadeadas seriam
   * tres chances de o sistema cortar no meio.
   */
  dayDigest: () =>
    comErro(async () => {
      const userId = await eu();
      const [fila, fechadas, perfil] = await Promise.all([
        foco.fila(userId, { scope: 'today' }),
        foco.fechadasHoje(userId),
        usuario.perfil(userId),
      ]);
      const primeira = fila.queue[0];

      return {
        proxima: primeira?.node.title ?? null,
        proximaInicio: primeira?.node.start_date ?? null,
        pendentes: fila.queue.length,
        concluidasHoje: fechadas.length,
        minutosFocados: fechadas.reduce((s, f) => s + (f.estimated_minutes ?? 0), 0),
        metaDeMinutos: perfil.daily_focus_goal_minutes,
        impactoDoDia: Math.round(fechadas.reduce((s, f) => s + (f.root_impact ?? 0), 0) * 100) / 100,
      };
    }),

  // ---------------------------------------------------------- dependencias
  createDependency: (blocker_id: string, blocked_id: string) =>
    comErro(async () => {
      const corpo = createDependencySchema.parse({ blocker_id, blocked_id });
      return dependencias.criar(await eu(), corpo.blocker_id, corpo.blocked_id);
    }),
  deleteDependency: (id: string) => comErro(() => dependencias.excluir(id)),
  criticalPath: (spaceId?: string) =>
    comErro(async () => dependencias.caminhoCritico(await eu(), spaceId)),

  // ------------------------------------------------------------ relatorios
  velocity: () => comErro(async () => relatorios.velocidade(await eu())),
  riskMap: () => comErro(async () => relatorios.mapaDeRisco(await eu())) as Promise<{
    roots: RiskRow[];
  }>,
  progressHistory: (days = 30) => comErro(async () => relatorios.historico(await eu(), days)),

  life: () => comErro(async () => vida.resumoDaVida(await eu())) as Promise<LifeSummary>,

  // --------------------------------------------------------------- backlog
  backlog: () => comErro(async () => backlog.listar(await eu())) as Promise<BacklogItemDTO[]>,
  createBacklog: (body: Record<string, unknown>) =>
    comErro(async () => backlog.criar(await eu(), createBacklogSchema.parse(body))),
  updateBacklog: (id: string, body: Record<string, unknown>) =>
    comErro(async () => backlog.atualizar(await eu(), id, createBacklogSchema.partial().parse(body))),
  deleteBacklog: (id: string) => comErro(() => backlog.excluir(id)),

  saveBacklogPlan: (id: string, plan: AiPlan) =>
    comErro(async () => backlog.salvarPlano(await eu(), id, plan)) as Promise<BacklogItemDTO>,

  applyBacklogPlan: (
    id: string,
    body: { plan: AiPlan; space_id?: string | null; start_date?: string | null },
  ) =>
    comErro(async () => backlog.aplicar(await eu(), id, applyPlanSchema.parse(body))),

  setBacklogRoleMember: (roleId: string, memberId: string | null) =>
    comErro(async () => backlog.definirMembroDoPapel(await eu(), roleId, memberId)),

  /** A unica chamada do app que sai para a internet, e so quando voce pede. */
  planBacklog: (id: string, extraInstructions?: string, maxTasks?: number | null) =>
    comErro(async () => {
      const userId = await eu();
      const item = (await backlog.listar(userId)).find((b) => b.id === id);
      if (!item) throw new ApiError('NOT_FOUND', 'Item do backlog nao encontrado.');

      const config = await configDaIA();
      const plano = await planBacklogItem(config, {
        title: item.title,
        notes: item.notes,
        context: item.context,
        startDate: item.start_date ? new Date(item.start_date) : null,
        targetDate: item.target_date ? new Date(item.target_date) : null,
        existingRoles: item.roles.map((r) => r.title),
        extraInstructions,
        // O argumento ganha do gravado: a tela pode pedir outro teto numa
        // rodada sem antes gravar a mudanca no item.
        maxTasks: maxTasks !== undefined ? maxTasks : item.max_tasks,
      });
      return backlog.guardarRascunhoDaIA(userId, id, plano, config.model);
    }) as Promise<BacklogItemDTO>,

  // ----------------------------------------------------- avisos de tarefa
  /**
   * Preferencias do aparelho. Ficam fora do pacote de transferencia: a
   * antecedencia dos avisos e escolha deste iPhone, nao do projeto.
   */
  preferencias: () => comErro(() => prefs.todas()) as Promise<Record<string, string>>,
  gravarPreferencia: (chave: string, valor: string) =>
    comErro(async () => {
      await prefs.gravar(chave, valor);
      return { ok: true };
    }),

  // -------------------------------------------------------------------- IA
  aiSettings: () =>
    comErro(async () => {
      const u = await linhaDoUsuario();
      return {
        configured: Boolean(u.gemini_api_key),
        source: u.gemini_api_key ? 'settings' : null,
        maskedKey: mask(u.gemini_api_key),
        model: u.gemini_model,
      };
    }) as Promise<AiSettings>,

  updateAiSettings: (body: { gemini_api_key?: string | null; gemini_model?: string }) =>
    comErro(async () => {
      const dados = aiSettingsSchema.parse(body);
      await usuario.atualizarPerfil(await eu(), {
        ...(dados.gemini_api_key !== undefined
          ? { gemini_api_key: dados.gemini_api_key || null }
          : {}),
        ...(dados.gemini_model ? { gemini_model: dados.gemini_model } : {}),
      });
      return api.aiSettings();
    }) as Promise<AiSettings>,

  aiModels: () =>
    comErro(async () => ({ models: await listModels((await configDaIA()).apiKey) })),

  transcribe: (audio: string, mimeType: string) =>
    comErro(async () => {
      const u = await linhaDoUsuario();
      const text = await transcribeAudio(
        { apiKey: u.gemini_api_key ?? '', model: u.gemini_model },
        audio,
        // O WebView manda "audio/webm;codecs=opus"; a API quer so o tipo base.
        mimeType.split(';')[0].trim(),
      );
      return { text };
    }),

  // --------------------------------------------------------------- usuario
  user: () => comErro(async () => usuario.perfil(await eu())),

  updateUser: (body: Record<string, unknown>) =>
    comErro(async () => usuario.atualizarPerfil(await eu(), updateUserSchema.parse(body))),

  recompute: () =>
    comErro(async () => {
      const r = await usuario.recomputar(await eu());
      return { nodes: r.nos, roots: r.raizes };
    }),

  dataSummary: () =>
    comErro(async () => ({
      ...(await usuario.resumoDosDados(await eu())),
      // No desktop isto listava chaves de cache do navegador que ficaram para
      // tras. O WebView tem o mesmo problema, mas quem sabe disso e a tela.
      staleClient: [] as string[],
    })),

  // ------------------------------------------------- levar para outro iPhone
  /** So existe no mobile: nao ha servidor para sincronizar, ha um arquivo. */
  exportAll: () => comErro(() => transferencia.exportar()),
  importAll: (bruto: unknown) =>
    comErro(async () => {
      return transferencia.importar(bruto);
    }),
  inspectBackup: (bruto: unknown) =>
    comErro(async () => transferencia.resumoDoPacote(transferencia.validarPacote(bruto))),

  resetAll: (confirm: string, includeProfile: boolean) =>
    comErro(async () => {
      resetSchema.parse({ confirm, includeProfile });
      const userId = await eu();
      // Os numeros sao lidos antes porque depois nao ha mais o que contar.
      const antes = await usuario.resumoDosDados(userId);
      await usuario.zerarTudo(userId);
      return {
        reset: true,
        profileRemoved: false,
        deleted: {
          nodes: antes.nodes,
          spaces: antes.spaces,
          members: antes.members,
          backlog: antes.backlog,
        },
      };
    }),
};

/* ── Aparelho ou servidor ───────────────────────────────────────────────────

 Com um servidor escolhido (ver `data/servidores.ts`), as mesmas chamadas vao
 por HTTP, pelo cliente do proprio desktop — que ja fala exatamente esta API.
 As telas continuam chamando `api.tree(...)` sem saber de que lado esta o dado.
*/

/** Erro do servidor vira o erro do app; falha de rede ganha uma frase que diga o que houve. */
function remoto<F extends (...args: never[]) => Promise<unknown>>(f: F): F {
  return (async (...args: Parameters<F>) => {
    try {
      return await f(...args);
    } catch (erro) {
      if (erro instanceof ErroDoServidor) throw new ApiError(erro.code, erro.message, erro.details);
      throw new ApiError('SEM_CONEXAO', 'Nao foi possivel falar com o servidor. Confira a internet.');
    }
  }) as F;
}

type Api = typeof apiLocal;

/**
 * O cliente do desktop declara algumas respostas mais vagas (`unknown`) ou com
 * menos campos do que o app local devolve. O servidor manda o que as telas
 * do iPhone leem — conferido rota a rota —; a diferenca e so de declaracao.
 */
const comoNoAparelho = <K extends keyof Api>(f: (...args: never[]) => Promise<unknown>) =>
  remoto(f) as unknown as Api[K];

const apiRemota: Partial<Api> = {
  addMemberToSpace: comoNoAparelho<'addMemberToSpace'>(web.addMemberToSpace),
  aiModels: remoto(web.aiModels),
  aiSettings: remoto(web.aiSettings),
  applyBacklogPlan: comoNoAparelho<'applyBacklogPlan'>(web.applyBacklogPlan),
  backlog: remoto(web.backlog),
  breakdown: remoto(web.breakdown),
  children: remoto(web.children),
  completeNode: remoto(web.completeNode),
  createBacklog: remoto(web.createBacklog),
  createDependency: comoNoAparelho<'createDependency'>(web.createDependency),
  createMember: remoto(web.createMember),
  createNode: remoto(web.createNode),
  createSpace: remoto(web.createSpace),
  createTemplate: remoto(web.createTemplate),
  dataSummary: remoto(web.dataSummary),
  deleteBacklog: remoto(web.deleteBacklog),
  deleteDependency: comoNoAparelho<'deleteDependency'>(web.deleteDependency),
  deleteNode: remoto(web.deleteNode),
  deleteTemplate: remoto(web.deleteTemplate),
  focusQueue: remoto(web.focusQueue),
  instantiateTemplate: remoto(web.instantiateTemplate),
  life: remoto(web.life),
  members: remoto(web.members),
  moveNode: remoto(web.moveNode),
  nodeDetail: remoto(web.nodeDetail),
  planBacklog: remoto(web.planBacklog),
  progressHistory: remoto(web.progressHistory),
  recompute: remoto(web.recompute),
  removeMemberFromSpace: remoto(web.removeMemberFromSpace),
  reopenNode: remoto(web.reopenNode),
  reschedule: remoto(web.reschedule),
  resetAll: remoto(web.resetAll),
  riskMap: remoto(web.riskMap),
  saveBacklogPlan: remoto(web.saveBacklogPlan),
  setBacklogRoleMember: comoNoAparelho<'setBacklogRoleMember'>(web.setBacklogRoleMember),
  simulate: remoto(web.simulate),
  spaces: remoto(web.spaces),
  templates: remoto(web.templates),
  transcribe: remoto(web.transcribe),
  tree: remoto(web.tree),
  updateAiSettings: remoto(web.updateAiSettings),
  updateBacklog: remoto(web.updateBacklog),
  updateMember: remoto(web.updateMember),
  updateNode: remoto(web.updateNode),
  updateTemplate: remoto(web.updateTemplate),
  updateUser: comoNoAparelho<'updateUser'>(web.updateUser),
  user: comoNoAparelho<'user'>(web.user),
  velocity: remoto(web.velocity),

  /** O widget pede uma chamada so; aqui sao duas, as duas leves. */
  dayDigest: remoto(async () => {
    const meiaNoite = new Date();
    meiaNoite.setHours(0, 0, 0, 0);
    const [fila, hoje] = await Promise.all([
      web.focusQueue({ scope: 'today' }),
      web.resumoDeHoje(meiaNoite.toISOString()),
    ]);
    const primeira = fila.queue[0];
    return {
      proxima: primeira?.node.title ?? null,
      proximaInicio: primeira?.node.start_date ?? null,
      pendentes: fila.queue.length,
      ...hoje,
    };
  }),
};

/**
 * Coisas do aparelho, que valem nos dois modos: as preferencias de aviso e de
 * tela sao deste iPhone, nao da conta.
 */
const SEMPRE_NO_APARELHO = new Set<keyof Api>(['preferencias', 'gravarPreferencia']);

export const api: Api = new Proxy(apiLocal, {
  get(local, chave: string | symbol) {
    const nome = chave as keyof Api;
    if (!noServidor() || SEMPRE_NO_APARELHO.has(nome)) return local[nome];
    const doServidor = apiRemota[nome];
    if (doServidor) return doServidor;
    // Copia de seguranca e "levar para outro iPhone" sao do banco do aparelho.
    return () =>
      Promise.reject(
        new ApiError('SO_NO_APARELHO', 'Isto so existe no modo "Neste iPhone", nao num servidor.'),
      );
  },
});

/** Login, cadastro e sair: so existem no servidor. */
export const conta = {
  estado: remoto(web.authEstado),
  entrar: remoto((email: string, senha: string) => web.entrar({ email, senha, app: true })),
  cadastro: remoto((corpo: { nome: string; email: string; senha: string; convite?: string }) =>
    web.cadastro({ ...corpo, app: true }),
  ),
  sair: remoto(web.sair),
};

export { generateJson };
