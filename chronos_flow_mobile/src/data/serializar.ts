import type { MemberDTO, NodeDTO, SpaceDTO, TaskTemplateDTO } from '@shared/types';
import type { members, nodes, spaces, taskTemplates } from '@db/schema';

type Linha<T extends { $inferSelect: unknown }> = T['$inferSelect'];

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/**
 * A tela recebe exatamente o mesmo formato do desktop — e o que permite portar
 * os componentes sem mexer numa linha de leitura de dados.
 *
 * Aqui some o `num()` do desktop: o Prisma devolvia `Decimal` e todo numero
 * precisava ser convertido. O Drizzle devolve `number` e `Date` ja prontos.
 */
export function paraNodeDTO(
  n: Linha<typeof nodes>,
  extra: {
    childCount?: number;
    assignee?: Linha<typeof members> | null;
    blockedBy?: string[];
    blocks?: string[];
  } = {},
): NodeDTO {
  const childCount = extra.childCount ?? 0;
  return {
    id: n.id,
    parent_id: n.parent_id,
    space_id: n.space_id,
    path: n.path,
    depth: n.depth,
    position: n.position,
    title: n.title,
    description: n.description,
    status: n.status,
    weight: n.weight,
    progress: n.progress,
    manual_progress: n.manual_progress,
    leaf_count: n.leaf_count,
    childCount,
    isLeaf: childCount === 0,
    start_date: iso(n.start_date),
    due_date: iso(n.due_date),
    all_day: n.all_day,
    alarme: n.alarme,
    estimated_minutes: n.estimated_minutes,
    planned_date: iso(n.planned_date),
    scheduled_start: n.scheduled_start,
    scheduled_end: n.scheduled_end,
    completed_at: iso(n.completed_at),
    importance: n.importance,
    root_impact: n.root_impact,
    assignee_id: n.assignee_id,
    assignee: extra.assignee ? paraMemberDTO(extra.assignee) : null,
    blockedBy: extra.blockedBy,
    blocks: extra.blocks,
    created_at: n.created_at.toISOString(),
    updated_at: n.updated_at.toISOString(),
  } as NodeDTO;
}

export function paraMemberDTO(
  m: Linha<typeof members>,
  extra: Partial<MemberDTO> = {},
): MemberDTO {
  return {
    id: m.id,
    name: m.name,
    role: m.role,
    email: m.email,
    whatsapp: m.whatsapp,
    training_level: m.training_level,
    capacity_hours_week: m.capacity_hours_week,
    color: m.color,
    notes: m.notes,
    ...extra,
  } as MemberDTO;
}

export function paraSpaceDTO(s: Linha<typeof spaces>, extra: Partial<SpaceDTO> = {}): SpaceDTO {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    color: s.color,
    position: s.position,
    archived: s.archived,
    rootCount: extra.rootCount ?? 0,
    nodeCount: extra.nodeCount ?? 0,
    progress: extra.progress ?? 0,
  } as SpaceDTO;
}

export function paraTemplateDTO(
  t: Linha<typeof taskTemplates>,
  assignee?: Linha<typeof members> | null,
): TaskTemplateDTO {
  return {
    id: t.id,
    space_id: t.space_id,
    title: t.title,
    description: t.description,
    weight: t.weight,
    estimated_minutes: t.estimated_minutes,
    importance: t.importance,
    assignee_id: t.assignee_id,
    assignee: assignee ? paraMemberDTO(assignee) : null,
    color: t.color,
    uses: t.uses,
    last_used_at: iso(t.last_used_at),
    position: t.position,
    archived: t.archived,
  } as TaskTemplateDTO;
}

export function parseDate(valor: unknown): Date | null {
  if (valor == null || valor === '') return null;
  const d = new Date(valor as string);
  return Number.isNaN(d.getTime()) ? null : d;
}
