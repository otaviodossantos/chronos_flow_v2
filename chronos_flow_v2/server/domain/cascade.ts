/**
 * Motor de cascata: o progresso de um no com filhos e sempre derivado,
 * nunca digitado. Funcoes puras — nenhuma delas conhece Prisma.
 */

export interface CascadeChild {
  weight: number;
  progress: number;
  status: string;
}

export interface CascadeNode {
  id: string;
  parent_id: string | null;
  weight: number;
  status: string;
  manual_progress: number | null;
}

export const COMPLETED = 'COMPLETED';
export const CANCELLED = 'CANCELLED';

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Progresso de uma folha: concluida vale 100, senao o manual, senao 0. */
export function leafProgress(node: Pick<CascadeNode, 'status' | 'manual_progress'>): number {
  if (node.status === COMPLETED) return 100;
  if (node.manual_progress != null) return clamp(node.manual_progress, 0, 100);
  return 0;
}

/**
 * Media dos filhos ponderada pelo peso. Filhos cancelados saem da conta
 * inteira — nao penalizam nem inflam o pai.
 */
export function weightedProgress(children: CascadeChild[]): number {
  const live = children.filter((c) => c.status !== CANCELLED);
  if (live.length === 0) return 0;

  const totalWeight = live.reduce((sum, c) => sum + Math.max(0, c.weight), 0);
  if (totalWeight <= 0) {
    // Todos com peso zero: cai para media simples em vez de dividir por zero.
    return round2(live.reduce((sum, c) => sum + c.progress, 0) / live.length);
  }

  const weighted = live.reduce((sum, c) => sum + Math.max(0, c.weight) * c.progress, 0);
  return round2(weighted / totalWeight);
}

/** Um pai com qualquer filho nao concluido nao pode ser marcado como concluido. */
export function canComplete(children: Array<{ status: string }>): boolean {
  return children.every((c) => c.status === COMPLETED || c.status === CANCELLED);
}

/**
 * Para onde volta uma tarefa reaberta. Ela nao vira PENDING na marra: se ja
 * ha progresso (manual, ou vindo das filhas), voltar para "nao iniciada"
 * apagaria da tela um trabalho que existe. Cancelada e o unico caso em que
 * o progresso e ignorado — retomar uma tarefa cancelada e recomecar.
 */
export function statusAfterReopen(
  progress: number,
  wasCancelled = false,
): 'PENDING' | 'IN_PROGRESS' {
  if (wasCancelled) return 'PENDING';
  return progress > 0 ? 'IN_PROGRESS' : 'PENDING';
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Peso derivado do esforco estimado, caindo para 1 quando nao ha estimativa. */
export function weightFromEstimate(estimatedMinutes: number | null | undefined): number {
  if (!estimatedMinutes || estimatedMinutes <= 0) return 1;
  return Math.max(1, Math.round(estimatedMinutes));
}

/**
 * Recalcula uma arvore inteira em memoria, de baixo para cima.
 * Usado nos testes e no comando `recompute`.
 */
export function recomputeTree(
  nodes: Array<CascadeNode & { depth: number }>,
): Map<string, number> {
  const byParent = new Map<string, Array<CascadeNode & { depth: number }>>();
  for (const n of nodes) {
    const key = n.parent_id ?? '__root__';
    const list = byParent.get(key) ?? [];
    list.push(n);
    byParent.set(key, list);
  }

  const progress = new Map<string, number>();
  const ordered = [...nodes].sort((a, b) => b.depth - a.depth);

  for (const node of ordered) {
    const children = byParent.get(node.id) ?? [];
    if (children.length === 0) {
      progress.set(node.id, leafProgress(node));
    } else {
      progress.set(
        node.id,
        weightedProgress(
          children.map((c) => ({
            weight: c.weight,
            progress: progress.get(c.id) ?? 0,
            status: c.status,
          })),
        ),
      );
    }
  }

  return progress;
}
