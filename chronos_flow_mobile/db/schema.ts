import { relations, sql } from 'drizzle-orm';
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

/**
 * O mesmo modelo do desktop, em SQLite. Tres traducoes exigiram decisao:
 *
 *  - `Decimal` nao existe aqui, entao progresso e impacto viram `real`. A
 *    cascata ja comparava com tolerancia (`>= 0.005`), e o invariante das
 *    folhas somarem 1 tambem e testado com margem — ponto flutuante nao muda
 *    nenhuma conclusao do dominio.
 *  - datas viram inteiro em milissegundos, nao em segundos: o agendador
 *    arredonda para o minuto e comparar instantes truncados daria empates que
 *    no Postgres nao existem.
 *  - os enums viram texto com uniao de tipos, que e o que o TypeScript do
 *    desktop ja espera receber.
 *
 * As chaves estrangeiras so apagam em cascata com `PRAGMA foreign_keys = ON`.
 * Isso e ligado na abertura da conexao; sem isso, apagar uma tarefa deixaria
 * dependencias e atividades orfas no banco.
 */

const agora = sql`(unixepoch() * 1000)`;

/** Carimbo de criacao, igual em todas as tabelas. */
const criadoEm = () =>
  integer('created_at', { mode: 'timestamp_ms' }).notNull().default(agora);

/** O Prisma atualizava sozinho; aqui o Drizzle precisa ser mandado. */
const atualizadoEm = () =>
  integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(agora)
    .$onUpdate(() => new Date());

export const STATUS = ['PENDING', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED'] as const;
export const TIPO_DEPENDENCIA = ['FINISH_TO_START', 'START_TO_START', 'FINISH_TO_FINISH'] as const;
export const NIVEL_TREINO = ['NOT_STARTED', 'IN_TRAINING', 'AUTONOMOUS'] as const;
export const STATUS_BACKLOG = ['INBOX', 'PLANNING', 'CONVERTED', 'ARCHIVED'] as const;

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  birth_date: integer('birth_date', { mode: 'timestamp_ms' }).notNull(),
  life_expectancy: integer('life_expectancy').notNull().default(75),
  daily_focus_goal_minutes: integer('daily_focus_goal_minutes').notNull().default(240),
  daily_impact_goal: real('daily_impact_goal').notNull().default(1),
  timezone: text('timezone').notNull().default('America/Sao_Paulo'),
  gemini_api_key: text('gemini_api_key'),
  gemini_model: text('gemini_model').notNull().default('gemini-2.5-flash'),
  created_at: criadoEm(),
  updated_at: atualizadoEm(),
});

export const spaces = sqliteTable(
  'spaces',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    color: text('color').notNull().default('#10B981'),
    position: integer('position').notNull().default(0),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    created_at: criadoEm(),
    updated_at: atualizadoEm(),
  },
  (t) => [index('spaces_user_position').on(t.user_id, t.position)],
);

export const members = sqliteTable(
  'members',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    role: text('role'),
    email: text('email'),
    whatsapp: text('whatsapp'),
    training_level: text('training_level', { enum: NIVEL_TREINO })
      .notNull()
      .default('NOT_STARTED'),
    capacity_hours_week: integer('capacity_hours_week').notNull().default(40),
    color: text('color').notNull().default('#6366F1'),
    notes: text('notes'),
    created_at: criadoEm(),
    updated_at: atualizadoEm(),
  },
  (t) => [index('members_user').on(t.user_id)],
);

export const spaceMembers = sqliteTable(
  'space_members',
  {
    id: text('id').primaryKey(),
    space_id: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    member_id: text('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    created_at: criadoEm(),
  },
  (t) => [uniqueIndex('space_members_par').on(t.space_id, t.member_id)],
);

export const taskTemplates = sqliteTable(
  'task_templates',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    space_id: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    weight: integer('weight').notNull().default(1),
    estimated_minutes: integer('estimated_minutes'),
    importance: integer('importance').notNull().default(3),
    assignee_id: text('assignee_id').references(() => members.id, { onDelete: 'set null' }),
    color: text('color').notNull().default('#6366F1'),
    uses: integer('uses').notNull().default(0),
    last_used_at: integer('last_used_at', { mode: 'timestamp_ms' }),
    position: integer('position').notNull().default(0),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    created_at: criadoEm(),
    updated_at: atualizadoEm(),
  },
  (t) => [index('templates_user_space_pos').on(t.user_id, t.space_id, t.position)],
);

export const nodes = sqliteTable(
  'nodes',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    space_id: text('space_id').references(() => spaces.id, { onDelete: 'set null' }),

    // Adjacency list e a fonte da verdade; `path` e cache para consultar ramo.
    // A auto-referencia precisa do tipo anotado a mao: sem ele o TypeScript
    // entra em recursao ao inferir a tabela que ainda esta sendo declarada.
    parent_id: text('parent_id').references((): AnySQLiteColumn => nodes.id, {
      onDelete: 'cascade',
    }),
    path: text('path').notNull().default(''),
    depth: integer('depth').notNull().default(0),
    position: integer('position').notNull().default(0),

    title: text('title').notNull(),
    description: text('description'),
    status: text('status', { enum: STATUS }).notNull().default('PENDING'),

    weight: integer('weight').notNull().default(1),
    progress: real('progress').notNull().default(0),
    manual_progress: real('manual_progress'),
    leaf_count: integer('leaf_count').notNull().default(0),
    rollup_dirty: integer('rollup_dirty', { mode: 'boolean' }).notNull().default(false),
    // Despertador: esta tarefa toca mesmo com o iPhone no silencioso.
    // Existe tambem no Postgres do desktop, sem tela que a edite, para a
    // transferencia continuar simetrica nos dois sentidos — o pacote leva as
    // colunas que o schema declara, e uma coluna a mais de um lado so faria a
    // importacao recusar a primeira linha.
    alarme: integer('alarme', { mode: 'boolean' }).notNull().default(false),

    start_date: integer('start_date', { mode: 'timestamp_ms' }),
    due_date: integer('due_date', { mode: 'timestamp_ms' }),
    all_day: integer('all_day', { mode: 'boolean' }).notNull().default(true),
    estimated_minutes: integer('estimated_minutes'),
    planned_date: integer('planned_date', { mode: 'timestamp_ms' }),
    scheduled_start: text('scheduled_start'),
    scheduled_end: text('scheduled_end'),
    completed_at: integer('completed_at', { mode: 'timestamp_ms' }),

    importance: integer('importance').notNull().default(3),
    root_impact: real('root_impact').notNull().default(0),

    assignee_id: text('assignee_id').references(() => members.id, { onDelete: 'set null' }),

    created_at: criadoEm(),
    updated_at: atualizadoEm(),
  },
  (t) => [
    index('nodes_user_path').on(t.user_id, t.path),
    index('nodes_parent_pos').on(t.parent_id, t.position),
    index('nodes_assignee_status').on(t.assignee_id, t.status),
    index('nodes_space_depth').on(t.space_id, t.depth),
    index('nodes_planned').on(t.planned_date),
  ],
);

export const nodeDependencies = sqliteTable(
  'node_dependencies',
  {
    id: text('id').primaryKey(),
    blocker_id: text('blocker_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    blocked_id: text('blocked_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    type: text('type', { enum: TIPO_DEPENDENCIA }).notNull().default('FINISH_TO_START'),
    lag_days: integer('lag_days').notNull().default(0),
    created_at: criadoEm(),
  },
  (t) => [
    uniqueIndex('dep_par').on(t.blocker_id, t.blocked_id),
    index('dep_blocked').on(t.blocked_id),
  ],
);

export const progressSnapshots = sqliteTable(
  'progress_snapshots',
  {
    id: text('id').primaryKey(),
    node_id: text('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    progress: real('progress').notNull(),
    leaf_effort: integer('leaf_effort').notNull().default(0),
    // Texto 'AAAA-MM-DD': e um dia civil, nao um instante. Guardar como
    // carimbo faria o indice unico depender do fuso de quem gravou.
    captured_on: text('captured_on').notNull(),
  },
  (t) => [
    uniqueIndex('snapshot_no_dia').on(t.node_id, t.captured_on),
    index('snapshot_dia').on(t.captured_on),
  ],
);

export const nodeActivity = sqliteTable(
  'node_activity',
  {
    id: text('id').primaryKey(),
    node_id: text('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    actor: text('actor').notNull().default('Voce'),
    kind: text('kind').notNull(),
    message: text('message').notNull(),
    created_at: criadoEm(),
  },
  (t) => [index('activity_node_data').on(t.node_id, t.created_at)],
);

export const backlogItems = sqliteTable(
  'backlog_items',
  {
    id: text('id').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    space_id: text('space_id').references(() => spaces.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    notes: text('notes'),
    status: text('status', { enum: STATUS_BACKLOG }).notNull().default('INBOX'),
    position: integer('position').notNull().default(0),
    start_date: integer('start_date', { mode: 'timestamp_ms' }),
    target_date: integer('target_date', { mode: 'timestamp_ms' }),
    context: text('context'),
    // Teto de tarefas que a IA pode propor, somando todos os niveis da arvore.
    // Nulo = sem teto. Quem corta e o planner compartilhado, nao esta coluna.
    max_tasks: integer('max_tasks'),
    // O rascunho da IA inteiro, como JSON. E o mesmo contrato do desktop.
    ai_plan: text('ai_plan', { mode: 'json' }),
    ai_model: text('ai_model'),
    ai_planned_at: integer('ai_planned_at', { mode: 'timestamp_ms' }),
    converted_node_id: text('converted_node_id'),
    created_at: criadoEm(),
    updated_at: atualizadoEm(),
  },
  (t) => [index('backlog_user_status_pos').on(t.user_id, t.status, t.position)],
);

export const backlogRoles = sqliteTable(
  'backlog_roles',
  {
    id: text('id').primaryKey(),
    backlog_item_id: text('backlog_item_id')
      .notNull()
      .references(() => backlogItems.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    hours_per_week: integer('hours_per_week'),
    headcount: integer('headcount').notNull().default(1),
    position: integer('position').notNull().default(0),
    member_id: text('member_id').references(() => members.id, { onDelete: 'set null' }),
    created_at: criadoEm(),
  },
  (t) => [index('backlog_roles_item_pos').on(t.backlog_item_id, t.position)],
);

export const nodesRelations = relations(nodes, ({ one, many }) => ({
  pai: one(nodes, { fields: [nodes.parent_id], references: [nodes.id], relationName: 'arvore' }),
  filhas: many(nodes, { relationName: 'arvore' }),
  espaco: one(spaces, { fields: [nodes.space_id], references: [spaces.id] }),
  responsavel: one(members, { fields: [nodes.assignee_id], references: [members.id] }),
  bloqueia: many(nodeDependencies, { relationName: 'bloqueador' }),
  bloqueadaPor: many(nodeDependencies, { relationName: 'bloqueada' }),
  atividade: many(nodeActivity),
}));

export const dependenciesRelations = relations(nodeDependencies, ({ one }) => ({
  bloqueador: one(nodes, {
    fields: [nodeDependencies.blocker_id],
    references: [nodes.id],
    relationName: 'bloqueador',
  }),
  bloqueada: one(nodes, {
    fields: [nodeDependencies.blocked_id],
    references: [nodes.id],
    relationName: 'bloqueada',
  }),
}));

export const spacesRelations = relations(spaces, ({ many }) => ({
  nos: many(nodes),
  membros: many(spaceMembers),
  modelos: many(taskTemplates),
}));

export const backlogRelations = relations(backlogItems, ({ many, one }) => ({
  papeis: many(backlogRoles),
  espaco: one(spaces, { fields: [backlogItems.space_id], references: [spaces.id] }),
}));

export const backlogRolesRelations = relations(backlogRoles, ({ one }) => ({
  item: one(backlogItems, {
    fields: [backlogRoles.backlog_item_id],
    references: [backlogItems.id],
  }),
  membro: one(members, { fields: [backlogRoles.member_id], references: [members.id] }),
}));

export const activityRelations = relations(nodeActivity, ({ one }) => ({
  no: one(nodes, { fields: [nodeActivity.node_id], references: [nodes.id] }),
}));

/**
 * Preferencias do aparelho.
 *
 * Chave e valor, e de proposito fora do pacote de transferencia: "avisar 5
 * minutos antes" e uma escolha deste iPhone, nao do projeto. Levar isso para o
 * desktop junto com as tarefas seria mandar uma configuracao de notificacao
 * para uma maquina que nao notifica nada.
 *
 * Em tabela e nao no `localStorage` porque o WKWebView pode descartar o
 * armazenamento da pagina sob pressao de espaco, e uma preferencia que some
 * sozinha desliga os avisos sem ninguem pedir.
 */
export const preferencias = sqliteTable('preferencias', {
  chave: text('chave').primaryKey(),
  valor: text('valor').notNull(),
  updated_at: atualizadoEm(),
});
