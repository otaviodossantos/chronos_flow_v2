import { z } from 'zod';

export const nodeStatusSchema = z.enum([
  'PENDING',
  'IN_PROGRESS',
  'BLOCKED',
  'COMPLETED',
  'CANCELLED',
]);
export type NodeStatus = z.infer<typeof nodeStatusSchema>;

export const dependencyTypeSchema = z.enum([
  'FINISH_TO_START',
  'START_TO_START',
  'FINISH_TO_FINISH',
]);
export type DependencyType = z.infer<typeof dependencyTypeSchema>;

export const trainingLevelSchema = z.enum(['NOT_STARTED', 'IN_TRAINING', 'AUTONOMOUS']);
export type TrainingLevel = z.infer<typeof trainingLevelSchema>;

const isoDate = z.string().datetime({ offset: true }).or(z.string().date());
const nullableDate = isoDate.nullable().optional();
const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'horario deve estar no formato HH:MM')
  .nullable()
  .optional();

export const createNodeSchema = z.object({
  title: z.string().trim().min(1, 'titulo obrigatorio').max(300),
  description: z.string().max(5000).nullable().optional(),
  parent_id: z.string().uuid().nullable().optional(),
  space_id: z.string().uuid().nullable().optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  importance: z.number().int().min(1).max(5).optional(),
  weight: z.number().int().min(1).max(10000).optional(),
  estimated_minutes: z.number().int().min(1).max(100000).nullable().optional(),
  start_date: nullableDate,
  due_date: nullableDate,
  planned_date: nullableDate,
  scheduled_start: hhmm,
  scheduled_end: hhmm,
  position: z.number().int().min(0).optional(),
  all_day: z.boolean().optional(),
  /** Despertador por tarefa: so o app do iPhone usa. */
  alarme: z.boolean().optional(),
});
export type CreateNodeInput = z.infer<typeof createNodeSchema>;

export const updateNodeSchema = createNodeSchema.partial().extend({
  status: nodeStatusSchema.optional(),
  manual_progress: z.number().min(0).max(100).nullable().optional(),
});
export type UpdateNodeInput = z.infer<typeof updateNodeSchema>;

export const breakdownSchema = z.object({
  children: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(300),
        assignee_id: z.string().uuid().nullable().optional(),
        estimated_minutes: z.number().int().min(1).max(100000).nullable().optional(),
        due_date: nullableDate,
        weight: z.number().int().min(1).max(10000).optional(),
      }),
    )
    .min(1)
    .max(50),
  notify_on_delay: z.boolean().optional(),
});
export type BreakdownInput = z.infer<typeof breakdownSchema>;

export const moveNodeSchema = z.object({
  parent_id: z.string().uuid().nullable(),
  position: z.number().int().min(0).optional(),
});

export const rescheduleSchema = z.object({
  start_date: nullableDate,
  due_date: nullableDate,
  all_day: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  cascadeChildren: z.boolean().optional(),
});
export type RescheduleInput = z.infer<typeof rescheduleSchema>;

export const treeQuerySchema = z.object({
  rootId: z.string().uuid().optional(),
  spaceId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
  maxDepth: z.coerce.number().int().min(0).max(12).optional(),
  status: z.string().optional(),
  search: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});
export type TreeQuery = z.infer<typeof treeQuerySchema>;

export const createDependencySchema = z.object({
  blocker_id: z.string().uuid(),
  blocked_id: z.string().uuid(),
  type: dependencyTypeSchema.optional(),
  lag_days: z.number().int().min(0).max(365).optional(),
});

export const createSpaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  position: z.number().int().min(0).optional(),
});

/**
 * Modelo de tarefa recorrente. Sem recorrencia de verdade: nao tem dias da
 * semana nem agenda, porque ele nao gera nada sozinho. Sao os campos que
 * voce repetiria a mao toda vez que cria a mesma tarefa.
 */
export const createTemplateSchema = z.object({
  space_id: z.string().uuid(),
  title: z.string().trim().min(1, 'titulo obrigatorio').max(300),
  description: z.string().max(5000).nullable().optional(),
  weight: z.number().int().min(1).max(10000).optional(),
  estimated_minutes: z.number().int().min(1).max(100000).nullable().optional(),
  importance: z.number().int().min(1).max(5).optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  position: z.number().int().min(0).optional(),
  archived: z.boolean().optional(),
});
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

/** O que o gesto de soltar informa: onde na arvore e, se veio do canvas, quando. */
export const instantiateTemplateSchema = z.object({
  parent_id: z.string().uuid().nullable().optional(),
  position: z.number().int().min(0).optional(),
  start_date: nullableDate,
  /** false quando o arraste veio do zoom de horas e carrega horario. */
  all_day: z.boolean().optional(),
  /** Ajuste pontual do titulo sem mexer no modelo. */
  title: z.string().trim().min(1).max(300).optional(),
});
export type InstantiateTemplateInput = z.infer<typeof instantiateTemplateSchema>;

export const createMemberSchema = z.object({
  name: z.string().trim().min(1).max(160),
  role: z.string().max(160).nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal('')),
  whatsapp: z.string().max(40).nullable().optional(),
  training_level: trainingLevelSchema.optional(),
  capacity_hours_week: z.number().int().min(1).max(80).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  notes: z.string().max(4000).nullable().optional(),
  space_ids: z.array(z.string().uuid()).optional(),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  birth_date: isoDate.optional(),
  life_expectancy: z.number().int().min(1).max(130).optional(),
  daily_focus_goal_minutes: z.number().int().min(0).max(1440).optional(),
  daily_impact_goal: z.number().min(0).max(100).optional(),
});

export const simulateSchema = z.object({
  nodeIds: z.array(z.string().uuid()).min(1).max(200),
});


/* ------------------------------------------------------------------ backlog */

export const backlogStatusSchema = z.enum(['INBOX', 'PLANNING', 'CONVERTED', 'ARCHIVED']);
export type BacklogStatus = z.infer<typeof backlogStatusSchema>;

/**
 * Teto de tarefas que a IA pode propor para um item, somando TODOS os niveis.
 *
 * O minimo e 3 porque abaixo disso nao ha decomposicao, so a tarefa original
 * reescrita; o maximo e 60 porque `aiPlanSchema` ja limita a 30 por nivel e um
 * plano maior que isso ninguem revisa na tela — e revisar antes de aplicar e o
 * ponto inteiro do backlog.
 */
export const LIMITE_MIN = 3;
export const LIMITE_MAX = 60;

export const createBacklogSchema = z.object({
  title: z.string().trim().min(1).max(300),
  notes: z.string().max(8000).nullable().optional(),
  context: z.string().max(8000).nullable().optional(),
  space_id: z.string().uuid().nullable().optional(),
  start_date: isoDate.nullable().optional(),
  target_date: isoDate.nullable().optional(),
  status: backlogStatusSchema.optional(),
  position: z.number().int().min(0).optional(),
  /** Nulo = sem teto: a IA decide quantas tarefas o trabalho pede. */
  max_tasks: z.number().int().min(LIMITE_MIN).max(LIMITE_MAX).nullable().optional(),
});

/**
 * Forma do plano sugerido. A mesma estrutura sai do modelo, e validada aqui,
 * e volta editada do front — um contrato so para os tres lados.
 */
export const planTaskSchema: z.ZodType<PlanTask> = z.lazy(() =>
  z.object({
    /** Identificador curto que a propria IA atribui, para ligar dependencias. */
    ref: z.string().max(24).optional(),
    title: z.string().trim().min(1).max(300),
    detail: z.string().max(2000).nullable().optional(),
    estimated_minutes: z.number().int().min(15).max(100000).nullable().optional(),
    role: z.string().max(120).nullable().optional(),
    offset_days: z.number().int().min(0).max(3650).nullable().optional(),
    duration_days: z.number().int().min(0).max(3650).nullable().optional(),
    /** Refs de tarefas que precisam terminar antes desta comecar. */
    depends_on: z.array(z.string().max(24)).max(10).optional(),
    keep: z.boolean().optional(),
    children: z.array(planTaskSchema).max(30).optional(),
  }),
);

export interface PlanTask {
  ref?: string;
  title: string;
  detail?: string | null;
  estimated_minutes?: number | null;
  /** Dias a partir do inicio do projeto; o front converte em data real. */
  offset_days?: number | null;
  duration_days?: number | null;
  role?: string | null;
  depends_on?: string[];
  keep?: boolean;
  children?: PlanTask[];
}

/**
 * Quantas tarefas um plano tem, contando frentes, etapas e folhas juntas.
 *
 * Mora aqui, e nao no planner, porque quem precisa dessa conta esta nos dois
 * lados da fronteira: o servidor, para cortar o excedente, e as duas telas de
 * backlog, para mostrar "12 no rascunho" ao lado do limite escolhido. Duas
 * implementacoes dariam dois numeros para a mesma arvore.
 */
export function contarTarefas(tasks: PlanTask[]): number {
  return tasks.reduce((n, t) => n + 1 + contarTarefas(t.children ?? []), 0);
}

export const planRoleSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().max(1000).nullable().optional(),
  hours_per_week: z.number().int().min(1).max(80).nullable().optional(),
  headcount: z.number().int().min(1).max(50).optional(),
  reports_to: z.string().max(120).nullable().optional(),
  member_id: z.string().uuid().nullable().optional(),
  keep: z.boolean().optional(),
});
export type PlanRole = z.infer<typeof planRoleSchema>;

export const aiPlanSchema = z.object({
  summary: z.string().max(2000).optional(),
  tasks: z.array(planTaskSchema).min(1).max(30),
  roles: z.array(planRoleSchema).max(20).default([]),
  risks: z.array(z.string().max(500)).max(10).optional(),
});
export type AiPlan = z.infer<typeof aiPlanSchema>;

/** Rascunho editado voltando do front, sem aplicar nada ainda. */
export const savePlanSchema = z.object({ plan: aiPlanSchema });

export const applyPlanSchema = z.object({
  plan: aiPlanSchema,
  space_id: z.string().uuid().nullable().optional(),
  start_date: isoDate.nullable().optional(),
  importance: z.number().int().min(1).max(5).optional(),
  /** Cria as dependencias que a IA propos entre as tarefas mantidas. */
  applyDependencies: z.boolean().optional(),
});

export const planRequestSchema = z.object({
  extraInstructions: z.string().max(2000).optional(),
  /**
   * Teto desta rodada. Normalmente vem do proprio item; entra aqui para o
   * front poder pedir "de novo, mas com metade disso" sem gravar antes.
   */
  maxTasks: z.number().int().min(LIMITE_MIN).max(LIMITE_MAX).nullable().optional(),
});

export const aiSettingsSchema = z.object({
  gemini_api_key: z.string().max(200).nullable().optional(),
  gemini_model: z.string().max(120).optional(),
});


/* -------------------------------------------------------------- zerar tudo */

/** A frase exata que o usuario precisa digitar. Conferida no servidor tambem. */
export const RESET_PHRASE = 'APAGAR TUDO';

export const resetSchema = z.object({
  confirm: z.literal(RESET_PHRASE, {
    errorMap: () => ({ message: `Digite exatamente "${RESET_PHRASE}" para confirmar.` }),
  }),
  /** Marcado: apaga tambem nome, data de nascimento, metas e a chave da IA. */
  includeProfile: z.boolean().optional(),
});

/**
 * Atualizacao de tarefa (o feed estilo Monday). O corpo e markdown cru: quem
 * desenha e a tela, e o MCP escreve no mesmo formato que uma pessoa.
 */
export const createNodeUpdateSchema = z.object({
  node_id: z.string().uuid(),
  body: z.string().trim().min(1, 'a atualizacao esta vazia').max(20000),
  /** Quem escreveu. Vazio = o nome do perfil; o MCP manda o do agente. */
  author: z.string().trim().min(1).max(80).optional(),
});
export type CreateNodeUpdateInput = z.infer<typeof createNodeUpdateSchema>;

export const editNodeUpdateSchema = z.object({
  body: z.string().trim().min(1, 'a atualizacao esta vazia').max(20000),
});

export const nodeUpdatesQuerySchema = z.object({
  nodeId: z.string().uuid(),
});

/**
 * Troca de status como gesto unico — o que o Kanban faz ao soltar um cartao e
 * o que o MCP faz com `set_status`. BLOCKED fica de fora de proposito: ele e
 * derivado das dependencias, e um BLOCKED manual seria desfeito pelo proprio
 * servidor na proxima sincronizacao.
 */
export const setStatusSchema = z.object({
  status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
});
export type SetStatusInput = z.infer<typeof setStatusSchema>;

/* ── Contas ─────────────────────────────────────────────────────────────── */

const email = z.string().trim().toLowerCase().email('e-mail invalido').max(200);
const senha = z.string().min(8, 'a senha precisa de pelo menos 8 caracteres').max(200);

export const cadastroSchema = z.object({
  nome: z.string().trim().min(1, 'nome obrigatorio').max(120),
  email,
  senha,
  /** Exigido quando o servidor define CHRONOS_CONVITE. */
  convite: z.string().max(200).optional(),
});

export const entrarSchema = z.object({
  email,
  senha: z.string().min(1).max(200),
});

export const trocarSenhaSchema = z.object({
  atual: z.string().min(1).max(200),
  nova: senha,
});

export const criarTokenSchema = z.object({
  nome: z.string().trim().min(1, 'de um nome ao token').max(80),
});
