import type { NodeDTO } from '@shared/types';
import type { FlatRow } from './useVisibleNodes';

/**
 * Onde a tarefa arrastada vai cair em relacao a linha sob o cursor.
 * `inside` muda o caminho hierarquico; `before`/`after` so reordenam entre
 * irmas. Sao tres zonas na mesma linha porque, com uma so, nao haveria como
 * dizer "irma de" e "filha de" sem um segundo gesto.
 */
export type DropWhere = 'before' | 'after' | 'inside';

export interface DropTarget {
  /** null = a faixa de raiz, no fim da lista. */
  id: string | null;
  where: DropWhere;
}

/** Fracao da altura da linha reservada para as bordas (irma) e nao para o meio (filha). */
const EDGE = 0.28;
/** Quanto o cursor precisa pairar sobre um no fechado para ele abrir sozinho. */
export const HOVER_TO_EXPAND_MS = 600;

export function dropWhereFor(event: { clientY: number }, rect: DOMRect): DropWhere {
  const ratio = (event.clientY - rect.top) / rect.height;
  if (ratio < EDGE) return 'before';
  if (ratio > 1 - EDGE) return 'after';
  return 'inside';
}

/**
 * Resolve o alvo visual em `(pai, posicao)`. A posicao e contada na lista de
 * irmas JA sem a tarefa arrastada — e assim que o servidor reinsere, e assim
 * que a tela enxerga o alvo enquanto arrasta.
 */
export function resolveMove(
  target: DropTarget,
  /** null quando a origem e um modelo da paleta: nao ha no a excluir da fila. */
  dragged: { id: string } | null,
  rows: FlatRow[],
): { parent_id: string | null; position?: number } | null {
  if (target.id === null) {
    const roots = rows.filter((r) => r.node.parent_id === null && r.node.id !== dragged?.id);
    return { parent_id: null, position: roots.length };
  }

  const targetNode = rows.find((r) => r.node.id === target.id)?.node;
  if (!targetNode) return null;

  if (target.where === 'inside') return { parent_id: targetNode.id };

  const siblings = rows
    .filter((r) => r.node.parent_id === targetNode.parent_id && r.node.id !== dragged?.id)
    .map((r) => r.node);
  const index = siblings.findIndex((n) => n.id === targetNode.id);
  if (index < 0) return null;

  return {
    parent_id: targetNode.parent_id,
    position: target.where === 'after' ? index + 1 : index,
  };
}

/**
 * Soltar dentro da propria subarvore criaria um ciclo; o caminho ja diz isso.
 * Um modelo da paleta (`dragged` nulo) nao tem subarvore: cabe em qualquer
 * lugar, inclusive como nova meta macro.
 */
export function canDrop(
  dragged: NodeDTO | null,
  targetNode: NodeDTO | null,
  where: DropWhere,
): boolean {
  if (!dragged) return true;
  if (!targetNode) return dragged.parent_id !== null; // faixa de raiz: so se ja nao for raiz
  if (targetNode.id === dragged.id) return false;
  if (targetNode.path.startsWith(`${dragged.path}/`)) return false;
  if (where === 'inside' && targetNode.id === dragged.parent_id) return false;
  return true;
}
