import { CANCELLED, clamp, round2 } from './cascade.js';

/**
 * Priorizacao por impacto ascendente.
 * contrib(f) = produto dos pesos normalizados ao longo do caminho ate a raiz.
 * A soma das contribuicoes de todas as folhas de uma raiz e exatamente 1.
 */

export interface ImpactNode {
  id: string;
  parent_id: string | null;
  weight: number;
  status: string;
}

/** Fracao da raiz que cada no representa. A raiz vale 1. */
export function contributionMap(nodes: ImpactNode[]): Map<string, number> {
  const byParent = new Map<string, ImpactNode[]>();
  const byId = new Map<string, ImpactNode>();

  for (const n of nodes) {
    byId.set(n.id, n);
    const key = n.parent_id ?? '__root__';
    const list = byParent.get(key) ?? [];
    list.push(n);
    byParent.set(key, list);
  }

  const contrib = new Map<string, number>();
  const roots = nodes.filter((n) => !n.parent_id || !byId.has(n.parent_id));

  const walk = (node: ImpactNode, share: number) => {
    contrib.set(node.id, share);
    const children = (byParent.get(node.id) ?? []).filter((c) => c.status !== CANCELLED);
    if (children.length === 0) return;

    const total = children.reduce((sum, c) => sum + Math.max(0, c.weight), 0);
    for (const child of children) {
      const slice =
        total > 0 ? Math.max(0, child.weight) / total : 1 / children.length;
      walk(child, share * slice);
    }
  };

  for (const root of roots) walk(root, 1);
  return contrib;
}

/**
 * Urgencia 1..5 derivada do prazo — recalculada a cada leitura, nunca gravada,
 * porque ela muda sozinha com a passagem do tempo.
 */
export function urgencyFromDeadline(dueDate: Date | null, today = new Date()): number {
  if (!dueDate) return 1;
  const days = Math.ceil((dueDate.getTime() - startOfDay(today).getTime()) / 86_400_000);
  if (days <= 0) return 5;
  return clamp(6 - Math.ceil(days / 7), 1, 5);
}

/** Pressao da meta macro: importancia x urgencia, escala 1 a 25. */
export function rootCriticality(
  importance: number,
  dueDate: Date | null,
  today = new Date(),
): number {
  return clamp(importance, 1, 5) * urgencyFromDeadline(dueDate, today);
}

export interface ScoreInput {
  contribution: number;
  rootCriticality: number;
  isBlocked: boolean;
  dueDate: Date | null;
  plannedDate?: Date | null;
}

/** score = contrib x criticidade x desbloqueio x aderencia ao dia. */
export function focusScore(input: ScoreInput, today = new Date()): number {
  const beta = input.isBlocked ? 0 : 1;
  const gamma = dayAdherence(input.dueDate, input.plannedDate ?? null, today);
  return round4(input.contribution * input.rootCriticality * beta * gamma);
}

function dayAdherence(
  dueDate: Date | null,
  plannedDate: Date | null,
  today: Date,
): number {
  const t = startOfDay(today).getTime();
  if (plannedDate && startOfDay(plannedDate).getTime() <= t) return 1.3;
  if (dueDate && startOfDay(dueDate).getTime() <= t) return 1.3;
  return 1;
}

/** Projecao do simulador: quanto a raiz sobe se estas folhas forem concluidas. */
export function projectProgress(
  currentRootProgress: number,
  leaves: Array<{ contribution: number; progress: number }>,
): number {
  const gain = leaves.reduce(
    (sum, l) => sum + l.contribution * ((100 - l.progress) / 100),
    0,
  );
  return round2(clamp(currentRootProgress + gain * 100, 0, 100));
}

export function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10_000) / 10_000;
}
