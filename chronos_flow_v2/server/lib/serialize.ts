import type { NodeDTO, MemberDTO, SpaceDTO, TaskTemplateDTO } from '../../shared/types.js';

type Dec = { toNumber(): number } | number | null | undefined;

export function num(value: Dec, fallback = 0): number {
  if (value == null) return fallback;
  return typeof value === 'number' ? value : value.toNumber();
}

export function numOrNull(value: Dec): number | null {
  if (value == null) return null;
  return typeof value === 'number' ? value : value.toNumber();
}

export function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

export function toNodeDTO(
  n: any,
  extra: { childCount?: number; blockedBy?: string[]; blocks?: string[] } = {},
): NodeDTO {
  const childCount = extra.childCount ?? n._count?.children ?? n.childCount ?? 0;
  return {
    id: n.id,
    parent_id: n.parent_id ?? null,
    space_id: n.space_id ?? null,
    path: n.path,
    depth: n.depth,
    position: n.position,
    title: n.title,
    description: n.description ?? null,
    status: n.status,
    weight: n.weight,
    progress: num(n.progress),
    manual_progress: numOrNull(n.manual_progress),
    leaf_count: n.leaf_count ?? 0,
    childCount,
    isLeaf: childCount === 0,
    start_date: iso(n.start_date),
    due_date: iso(n.due_date),
    all_day: n.all_day ?? true,
    estimated_minutes: n.estimated_minutes ?? null,
    planned_date: iso(n.planned_date),
    scheduled_start: n.scheduled_start ?? null,
    scheduled_end: n.scheduled_end ?? null,
    completed_at: iso(n.completed_at),
    importance: n.importance,
    root_impact: num(n.root_impact),
    assignee_id: n.assignee_id ?? null,
    assignee: n.assignee ? toMemberDTO(n.assignee) : null,
    blockedBy: extra.blockedBy,
    blocks: extra.blocks,
    created_at: n.created_at.toISOString(),
    updated_at: n.updated_at.toISOString(),
  };
}

export function toMemberDTO(m: any, extra: Partial<MemberDTO> = {}): MemberDTO {
  return {
    id: m.id,
    name: m.name,
    role: m.role ?? null,
    email: m.email ?? null,
    whatsapp: m.whatsapp ?? null,
    training_level: m.training_level,
    capacity_hours_week: m.capacity_hours_week,
    color: m.color,
    notes: m.notes ?? null,
    spaces: m.spaces?.map((s: any) => ({
      id: s.space?.id ?? s.id,
      name: s.space?.name ?? s.name,
      color: s.space?.color ?? s.color,
    })),
    ...extra,
  };
}

export function toTemplateDTO(t: any): TaskTemplateDTO {
  return {
    id: t.id,
    space_id: t.space_id,
    title: t.title,
    description: t.description ?? null,
    weight: t.weight,
    estimated_minutes: t.estimated_minutes ?? null,
    importance: t.importance,
    assignee_id: t.assignee_id ?? null,
    assignee: t.assignee ? toMemberDTO(t.assignee) : null,
    color: t.color,
    uses: t.uses,
    last_used_at: t.last_used_at ? t.last_used_at.toISOString() : null,
    position: t.position,
    archived: t.archived,
  };
}

export function toSpaceDTO(s: any, extra: Partial<SpaceDTO> = {}): SpaceDTO {
  return {
    id: s.id,
    name: s.name,
    description: s.description ?? null,
    color: s.color,
    position: s.position,
    archived: s.archived,
    rootCount: extra.rootCount ?? 0,
    nodeCount: extra.nodeCount ?? 0,
    progress: extra.progress ?? 0,
  };
}

export function parseDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d;
}
