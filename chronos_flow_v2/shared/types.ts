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
