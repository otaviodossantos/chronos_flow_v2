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
  NodeUpdateDTO,
  SetStatusResult,
} from '@shared/types';
import type { AiPlan } from '@shared/schemas/index';
import type { Pacote, ResumoDoPacote } from '@shared/transferencia';

const BASE = '/api';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const err = body?.error;
    throw new ApiError(
      err?.code ?? 'INTERNAL',
      err?.message ?? `Falha na requisicao (${res.status}).`,
      err?.details,
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const qs = (params: Record<string, unknown>) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
};

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

export const api = {
  tree: (params: {
    rootId?: string;
    spaceId?: string;
    assigneeId?: string;
    maxDepth?: number;
    status?: string;
    search?: string;
  }) => request<NodeDTO[]>(`/nodes/tree${qs(params)}`),

  children: (id: string) => request<NodeDTO[]>(`/nodes/${id}/children`),
  nodeDetail: (id: string) => request<NodeDetail>(`/nodes/${id}`),

  createNode: (body: Record<string, unknown>) =>
    request<NodeDTO>('/nodes', { method: 'POST', body: JSON.stringify(body) }),

  updateNode: (id: string, body: Record<string, unknown>) =>
    request<NodeDTO>(`/nodes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  completeNode: (id: string) =>
    request<CompleteResult>(`/nodes/${id}/complete`, { method: 'POST' }),

  reopenNode: (id: string) => request<ReopenResult>(`/nodes/${id}/reopen`, { method: 'POST' }),

  /** Troca de status como gesto unico (Kanban, Tabela, MCP). Ver domain/status.ts. */
  setStatus: (id: string, status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED') =>
    request<SetStatusResult>(`/nodes/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),

  /** Feed de atualizacoes em markdown, mais nova primeiro. */
  updates: (nodeId: string) => request<NodeUpdateDTO[]>(`/updates${qs({ nodeId })}`),
  createUpdate: (node_id: string, body: string) =>
    request<NodeUpdateDTO>('/updates', { method: 'POST', body: JSON.stringify({ node_id, body }) }),
  editUpdate: (id: string, body: string) =>
    request<NodeUpdateDTO>(`/updates/${id}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  deleteUpdate: (id: string) =>
    request<{ deleted: boolean }>(`/updates/${id}`, { method: 'DELETE' }),

  breakdown: (id: string, body: Record<string, unknown>) =>
    request<{ parent: NodeDTO; children: NodeDTO[] }>(`/nodes/${id}/breakdown`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  moveNode: (id: string, parent_id: string | null, position?: number) =>
    request<NodeDTO>(`/nodes/${id}/move`, {
      method: 'POST',
      body: JSON.stringify({ parent_id, position }),
    }),

  reschedule: (id: string, body: Record<string, unknown>) =>
    request<ReschedulePlan>(`/nodes/${id}/reschedule`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deleteNode: (id: string) =>
    request<{ deleted: boolean; removed: number }>(`/nodes/${id}`, { method: 'DELETE' }),

  spaces: () => request<SpaceDTO[]>('/spaces'),
  createSpace: (body: Record<string, unknown>) =>
    request<SpaceDTO>('/spaces', { method: 'POST', body: JSON.stringify(body) }),

  members: () => request<MemberDTO[]>('/members'),

  templates: (spaceId?: string | null) =>
    request<TaskTemplateDTO[]>(`/templates${qs({ spaceId })}`),
  createTemplate: (body: Record<string, unknown>) =>
    request<TaskTemplateDTO>('/templates', { method: 'POST', body: JSON.stringify(body) }),
  updateTemplate: (id: string, body: Record<string, unknown>) =>
    request<TaskTemplateDTO>(`/templates/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTemplate: (id: string) =>
    request<{ deleted: boolean }>(`/templates/${id}`, { method: 'DELETE' }),
  instantiateTemplate: (id: string, body: Record<string, unknown>) =>
    request<{ node: NodeDTO; template: TaskTemplateDTO }>(`/templates/${id}/instantiate`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  addMemberToSpace: (spaceId: string, memberId: string) =>
    request<unknown>(`/spaces/${spaceId}/members`, {
      method: 'POST',
      body: JSON.stringify({ member_id: memberId }),
    }),
  removeMemberFromSpace: (spaceId: string, memberId: string) =>
    request<{ deleted: boolean; stillAssigned: number }>(
      `/spaces/${spaceId}/members/${memberId}`,
      { method: 'DELETE' },
    ),
  createMember: (body: Record<string, unknown>) =>
    request<MemberDTO>('/members', { method: 'POST', body: JSON.stringify(body) }),
  updateMember: (id: string, body: Record<string, unknown>) =>
    request<MemberDTO>(`/members/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  focusQueue: (params: { scope?: string; assigneeId?: string }) =>
    request<FocusQueue>(`/focus/queue${qs(params)}`),
  simulate: (nodeIds: string[]) =>
    request<{
      projections: Array<{ rootId: string; rootTitle: string; current: number; projected: number }>;
    }>('/focus/simulate', { method: 'POST', body: JSON.stringify({ nodeIds }) }),

  createDependency: (blocker_id: string, blocked_id: string) =>
    request<unknown>('/dependencies', {
      method: 'POST',
      body: JSON.stringify({ blocker_id, blocked_id }),
    }),
  deleteDependency: (id: string) =>
    request<unknown>(`/dependencies/${id}`, { method: 'DELETE' }),

  velocity: () =>
    request<{
      completedLeaves30d: number;
      avgRootProgress: number;
      bottlenecks: number;
      estimateDeviationPercent: number;
      avgDepth: number;
      maxDepth: number;
    }>('/reports/velocity'),
  riskMap: () => request<{ roots: RiskRow[] }>('/reports/risk-map'),
  progressHistory: (days = 30) =>
    request<{
      series: Array<{ nodeId: string; title: string; date: string; progress: number; leafEffort: number }>;
    }>(`/reports/progress-history${qs({ days })}`),

  life: () => request<LifeSummary>('/life/summary'),

  backlog: () => request<BacklogItemDTO[]>('/backlog'),
  createBacklog: (body: Record<string, unknown>) =>
    request<BacklogItemDTO>('/backlog', { method: 'POST', body: JSON.stringify(body) }),
  updateBacklog: (id: string, body: Record<string, unknown>) =>
    request<BacklogItemDTO>(`/backlog/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteBacklog: (id: string) =>
    request<{ deleted: boolean }>(`/backlog/${id}`, { method: 'DELETE' }),
  planBacklog: (id: string, extraInstructions?: string) =>
    request<BacklogItemDTO>(`/backlog/${id}/plan`, {
      method: 'POST',
      body: JSON.stringify({ extraInstructions }),
    }),
  saveBacklogPlan: (id: string, plan: AiPlan) =>
    request<BacklogItemDTO>(`/backlog/${id}/plan`, {
      method: 'PATCH',
      body: JSON.stringify({ plan }),
    }),

  applyBacklogPlan: (
    id: string,
    body: { plan: AiPlan; space_id?: string | null; start_date?: string | null },
  ) =>
    request<{
      item: BacklogItemDTO;
      rootId: string;
      nodesCreated: number;
      roles: number;
      dependencies: number;
      /** Quando a ultima tarefa do plano termina, ja encadeada. */
      fimPrevisto: string;
      /** O encadeamento passa da data de entrega do item. */
      atrasaEntrega: boolean;
    }>(
      `/backlog/${id}/apply`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  setBacklogRoleMember: (roleId: string, memberId: string | null) =>
    request<unknown>(`/backlog/roles/${roleId}`, {
      method: 'PATCH',
      body: JSON.stringify({ member_id: memberId }),
    }),

  /**
   * Transferencia. O `export` e o `import` dispensam codigo quando a chamada
   * vem desta maquina; o codigo existe para o iPhone do outro lado da rede.
   */
  liberarTransferencia: () =>
    request<{ codigo: string; expiraEm: string }>('/transfer/liberar', { method: 'POST' }),
  fecharTransferencia: () =>
    request<{ liberado: boolean }>('/transfer/fechar', { method: 'POST' }),
  exportarTudo: () => request<Pacote>('/transfer/export'),
  importarTudo: (pacote: unknown) =>
    request<{ importado: boolean; contagem: Record<string, number>; resumo: ResumoDoPacote }>(
      '/transfer/import',
      { method: 'POST', body: JSON.stringify(pacote) },
    ),

  aiSettings: () => request<AiSettings>('/ai/settings'),
  updateAiSettings: (body: { gemini_api_key?: string | null; gemini_model?: string }) =>
    request<AiSettings>('/ai/settings', { method: 'PATCH', body: JSON.stringify(body) }),
  aiModels: () => request<{ models: Array<{ name: string; label: string }> }>('/ai/models'),
  transcribe: (audio: string, mimeType: string) =>
    request<{ text: string }>('/ai/transcribe', {
      method: 'POST',
      body: JSON.stringify({ audio, mimeType }),
    }),

  user: () =>
    request<{
      id: string;
      name: string;
      birth_date: string;
      life_expectancy: number;
      daily_focus_goal_minutes: number;
      daily_impact_goal: number;
    }>('/user'),
  updateUser: (body: Record<string, unknown>) =>
    request<unknown>('/user', { method: 'PATCH', body: JSON.stringify(body) }),
  recompute: () => request<{ nodes: number; roots: number }>('/user/recompute', { method: 'POST' }),

  dataSummary: () =>
    request<{
      nodes: number;
      roots: number;
      spaces: number;
      members: number;
      backlog: number;
      dependencies: number;
      staleClient: string[];
    }>('/user/data-summary'),
  resetAll: (confirm: string, includeProfile: boolean) =>
    request<{
      reset: boolean;
      profileRemoved: boolean;
      deleted: { nodes: number; spaces: number; members: number; backlog: number };
    }>('/user/reset', { method: 'POST', body: JSON.stringify({ confirm, includeProfile }) }),
};
