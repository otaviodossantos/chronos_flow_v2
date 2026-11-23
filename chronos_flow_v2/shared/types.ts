import type { NodeStatus, DependencyType, TrainingLevel } from './schemas/index.js';

export type { NodeStatus, DependencyType, TrainingLevel };

export interface NodeDTO {
  id: string;
  parent_id: string | null;
  space_id: string | null;
  path: string;
  depth: number;
  position: number;
  title: string;
  description: string | null;
  status: NodeStatus;
  weight: number;
  progress: number;
  manual_progress: number | null;
  leaf_count: number;
  childCount: number;
  isLeaf: boolean;
  start_date: string | null;
  due_date: string | null;
  /** false = as datas carregam horario; true = a tarefa ocupa o dia inteiro */
  all_day: boolean;
  estimated_minutes: number | null;
  planned_date: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  completed_at: string | null;
  importance: number;
  root_impact: number;
  assignee_id: string | null;
  assignee?: MemberDTO | null;
  blockedBy?: string[];
  blocks?: string[];
  /** Quantas atualizacoes (feed em markdown) a tarefa tem. So o desktop preenche. */
  updates_count?: number;
  created_at: string;
  updated_at: string;
  /**
   * Despertador por tarefa: toca no iPhone mesmo no silencioso.
   *
   * Opcional porque so o app do iPhone preenche. O desktop tem a coluna no
   * banco — a transferencia exige as mesmas colunas dos dois lados — mas nao
   * tem tela que a edite, entao o DTO dele simplesmente nao traz o campo.
   */
  alarme?: boolean;
}

export interface SpaceDTO {
  id: string;
  name: string;
  description: string | null;
  color: string;
  position: number;
  archived: boolean;
  rootCount: number;
  nodeCount: number;
  progress: number;
}

export interface MemberDTO {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  whatsapp: string | null;
  training_level: TrainingLevel;
  capacity_hours_week: number;
  color: string;
  notes: string | null;
  spaces?: Array<{ id: string; name: string; color: string }>;
  openMinutes?: number;
  loadPercent?: number;
  openLeaves?: number;
  /** Trabalho em aberto do membro em cada espaco, inclusive onde ele nao esta vinculado. */
  spaceLoad?: Array<{ space_id: string; openLeaves: number; openMinutes: number }>;
}

export interface CascadeStep {
  id: string;
  title: string;
  depth: number;
  previous: number;
  progress: number;
}

export interface CompleteResult {
  node: NodeDTO;
  cascade: CascadeStep[];
  unblocked: Array<{ id: string; title: string }>;
  impact: { rootId: string; rootTitle: string; deltaPercent: number };
}

export interface TaskTemplateDTO {
  id: string;
  space_id: string;
  title: string;
  description: string | null;
  weight: number;
  estimated_minutes: number | null;
  importance: number;
  assignee_id: string | null;
  assignee?: MemberDTO | null;
  color: string;
  uses: number;
  last_used_at: string | null;
  position: number;
  archived: boolean;
}

export interface ReopenResult {
  node: NodeDTO;
  cascade: CascadeStep[];
  /** Ancestrais que estavam concluidos e voltaram a ficar em aberto. */
  reopenedAncestors: Array<{ id: string; title: string }>;
  /** Tarefas que dependiam desta e voltaram para BLOCKED. */
  reblocked: Array<{ id: string; title: string }>;
}

export interface NodeUpdateDTO {
  id: string;
  node_id: string;
  author: string;
  /** Markdown cru. */
  body: string;
  created_at: string;
  updated_at: string;
  /** true quando o texto mudou depois de publicado. */
  edited: boolean;
}

/** O que sobra de uma troca de status: o no final e o que cada passo fez. */
export interface SetStatusResult {
  node: NodeDTO;
  /** Passos executados, na ordem: complete, reopen e/ou patch. */
  steps: Array<'complete' | 'reopen' | 'patch'>;
  completed?: CompleteResult;
  reopened?: ReopenResult;
}

export interface FocusItem {
  node: NodeDTO;
  root: { id: string; title: string; progress: number; color: string };
  spacePath: string[];
  score: number;
  deltaPercent: number;
  isBlocked: boolean;
  blockers: Array<{ id: string; title: string }>;
}

export interface LifeSummary {
  totalWeeks: number;
  weeksLived: number;
  weeksRemaining: number;
  percentageLived: number;
  currentAgeYears: number;
  lifeExpectancy: number;
  decades: Array<{
    decadeNumber: number;
    startAge: number;
    endAge: number;
    totalWeeks: number;
    weeksLived: number;
    status: 'past' | 'current' | 'future';
  }>;
  today: {
    focusMinutesDone: number;
    focusGoalMinutes: number;
    impactDone: number;
    impactGoal: number;
    leavesCompleted: number;
  };
}

/** O que a tela de entrada precisa saber antes de mostrar o formulario. */
export type PapelUsuario = 'ADMIN' | 'MEMBRO';

export interface AuthEstado {
  autenticado: boolean;
  /** A pessoa logada (o admin, quando ele esta no espaco de outra conta). */
  usuario: { id: string; name: string; email: string | null; papel: PapelUsuario } | null;
  /** Admin agindo no espaco de outra conta: de quem sao os dados na tela. */
  atuandoComo: { id: string; name: string; email: string | null } | null;
  /** So na resposta de entrar/cadastrar pelo app: o token da sessao do aparelho. */
  tokenDoApp?: string;
  /** Nenhuma conta tem senha ainda: o proximo cadastro vira o dono dos dados existentes. */
  primeiroAcesso: boolean;
  /** O servidor so aceita cadastro com o codigo de convite (CHRONOS_CONVITE). */
  conviteExigido: boolean;
  /** Da para criar conta agora, daqui (primeiro acesso local, ou convite configurado). */
  cadastroAberto: boolean;
  /** Por que nao da para criar a primeira conta daqui, quando for o caso. */
  avisoCadastro: string | null;
}

/** Linha da tela de Admin > Usuarios. */
export interface AdminUsuarioDTO {
  id: string;
  name: string;
  email: string | null;
  papel: PapelUsuario;
  bloqueado_em: string | null;
  created_at: string;
  ultimo_acesso: string | null;
  espacos: Array<{ id: string; name: string; color: string }>;
  metas: number;
  tarefas: number;
  tarefas_abertas: number;
}

export interface ConviteDTO {
  id: string;
  email: string | null;
  criado_em: string;
  expira_em: string;
  criado_por: string | null;
  usado_em: string | null;
  usado_por: { name: string; email: string | null } | null;
  revogado_em: string | null;
  estado: 'pendente' | 'usado' | 'expirado' | 'revogado';
}

export interface ApiTokenDTO {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}


export interface BacklogRoleDTO {
  id: string;
  title: string;
  description: string | null;
  hours_per_week: number | null;
  headcount: number;
  member_id: string | null;
  member: { id: string; name: string; color: string } | null;
}

export interface BacklogItemDTO {
  id: string;
  title: string;
  notes: string | null;
  context: string | null;
  status: 'INBOX' | 'PLANNING' | 'CONVERTED' | 'ARCHIVED';
  position: number;
  space_id: string | null;
  start_date: string | null;
  target_date: string | null;
  /** Teto de tarefas para a IA, somando todos os niveis. Nulo = sem teto. */
  max_tasks: number | null;
  ai_plan: import('./schemas/index.js').AiPlan | null;
  ai_model: string | null;
  ai_planned_at: string | null;
  converted_node_id: string | null;
  roles: BacklogRoleDTO[];
  created_at: string;
}

export interface AiSettings {
  configured: boolean;
  source?: 'settings' | 'env' | null;
  maskedKey: string | null;
  model: string;
}
