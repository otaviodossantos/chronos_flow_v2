import type { NodeDTO } from '@shared/types';

/**
 * Ligar tarefas puxando um fio entre elas. As duas pontas da barra tem
 * significados opostos, e e isso que da as duas direcoes com um gesto so:
 *
 * - puxar da ponta DIREITA de A ate B: A precisa terminar antes de B;
 * - puxar da ponta ESQUERDA de A ate B: B precisa terminar antes de A.
 *
 * Sem os dois lados, inverter uma dependencia exigiria apagar e refazer.
 */
export type LinkSide = 'start' | 'end';

export interface LinkPair {
  blocker_id: string;
  blocked_id: string;
}

export function resolveLink(fromId: string, side: LinkSide, targetId: string): LinkPair {
  return side === 'end'
    ? { blocker_id: fromId, blocked_id: targetId }
    : { blocker_id: targetId, blocked_id: fromId };
}

export interface LinkCheck {
  ok: boolean;
  reason?: string;
}

/**
 * As recusas que a tela consegue explicar sozinha, sem ida ao servidor. Ciclo
 * indireto (A→B→C→A) fica para o servidor: ele tem o grafo inteiro, a tela so
 * tem as linhas visiveis.
 */
export function canLink(from: NodeDTO, to: NodeDTO | null): LinkCheck {
  if (!to) return { ok: false };
  if (from.id === to.id) {
    return { ok: false, reason: 'Uma tarefa nao pode depender dela mesma.' };
  }
  if (to.path.startsWith(`${from.path}/`) || from.path.startsWith(`${to.path}/`)) {
    return {
      ok: false,
      reason: 'Uma tarefa nao pode depender de uma ancestral ou descendente dela.',
    };
  }
  if ((from.blocks ?? []).includes(to.id) || (from.blockedBy ?? []).includes(to.id)) {
    return { ok: false, reason: 'Ja existe um vinculo entre essas duas.' };
  }
  return { ok: true };
}

/**
 * Ponto de ancoragem na barra, em coordenadas do canvas. Encostado na borda
 * e centrado na linha: e de onde o fio sai e onde ele chega.
 */
export function anchorAt(
  left: number,
  width: number,
  rowIndex: number,
  rowHeight: number,
  side: LinkSide,
): { x: number; y: number } {
  return {
    x: side === 'start' ? left : left + width,
    y: rowIndex * rowHeight + rowHeight / 2,
  };
}

/**
 * Fio em curva entre a ancora e o cursor. Horizontal nas pontas para o traco
 * sair da barra na direcao certa em vez de cortar diagonal por cima dela.
 */
export function linkPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  side: LinkSide,
): string {
  const dir = side === 'end' ? 1 : -1;
  const dx = Math.min(120, Math.max(28, Math.abs(to.x - from.x) * 0.45)) * dir;
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;
}
