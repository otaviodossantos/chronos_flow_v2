import { prisma, type Tx } from '../../db/client.js';
import { ancestorIdsBottomUp } from '../../domain/path.js';
import {
  weightedProgress,
  leafProgress,
  round2,
  COMPLETED,
  CANCELLED,
} from '../../domain/cascade.js';
import { contributionMap } from '../../domain/impact.js';
import { num } from '../../lib/serialize.js';
import type { CascadeStep } from '../../../shared/types.js';

/**
 * Sobe a cascata a partir de um no, um nivel por vez, parando cedo quando
 * o progresso gravado nao muda. Custo O(profundidade), nao O(tamanho da arvore).
 */
export async function propagateFrom(nodeId: string, tx: Tx): Promise<CascadeStep[]> {
  const node = await tx.node.findUnique({
    where: { id: nodeId },
    select: { path: true, id: true, status: true, manual_progress: true },
  });
  if (!node) return [];

  const steps: CascadeStep[] = [];

  // O proprio no primeiro: se virou folha ou mudou de status, seu valor muda.
  await refreshOwnProgress(node.id, tx);

  for (const ancestorId of ancestorIdsBottomUp(node.path)) {
    const ancestor = await tx.node.findUnique({
      where: { id: ancestorId },
      select: { id: true, title: true, depth: true, progress: true },
    });
    if (!ancestor) break;

    const children = await tx.node.findMany({
      where: { parent_id: ancestorId },
      select: { weight: true, progress: true, status: true },
    });

    const next = weightedProgress(
      children.map((c) => ({ weight: c.weight, progress: num(c.progress), status: c.status })),
    );
    const previous = num(ancestor.progress);
    if (Math.abs(next - previous) < 0.005) break;

    await tx.node.update({ where: { id: ancestorId }, data: { progress: next } });
    steps.push({
      id: ancestor.id,
      title: ancestor.title,
      depth: ancestor.depth,
      previous,
      progress: next,
    });
  }

  return steps.reverse();
}

/** Recalcula o valor de um unico no a partir dos seus filhos diretos. */
export async function refreshOwnProgress(nodeId: string, tx: Tx): Promise<number> {
  const node = await tx.node.findUnique({
    where: { id: nodeId },
    select: { status: true, manual_progress: true, progress: true },
  });
  if (!node) return 0;

  const children = await tx.node.findMany({
    where: { parent_id: nodeId },
    select: { weight: true, progress: true, status: true },
  });

  const value =
    children.length === 0
      ? leafProgress({ status: node.status, manual_progress: num(node.manual_progress, 0) || null })
      : weightedProgress(
          children.map((c) => ({ weight: c.weight, progress: num(c.progress), status: c.status })),
        );

  if (Math.abs(value - num(node.progress)) >= 0.005) {
    await tx.node.update({ where: { id: nodeId }, data: { progress: value } });
  }
  return value;
}

/** Recontagem de folhas na subarvore — usada em relatorios e na sidebar. */
export async function refreshLeafCounts(rootPath: string, tx: Tx): Promise<void> {
  const nodes = await tx.node.findMany({
    where: { OR: [{ path: rootPath }, { path: { startsWith: `${rootPath}/` } }] },
    select: { id: true, parent_id: true, depth: true },
    orderBy: { depth: 'desc' },
  });

  const childrenOf = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.parent_id) continue;
    const list = childrenOf.get(n.parent_id) ?? [];
    list.push(n.id);
    childrenOf.set(n.parent_id, list);
  }

  const counts = new Map<string, number>();
  for (const n of nodes) {
    const kids = childrenOf.get(n.id) ?? [];
    counts.set(n.id, kids.length === 0 ? 1 : kids.reduce((s, k) => s + (counts.get(k) ?? 1), 0));
  }

  await Promise.all(
    [...counts].map(([id, leaf_count]) => tx.node.update({ where: { id }, data: { leaf_count } })),
  );
}

/**
 * Recalcula `root_impact` de toda a arvore de uma raiz: a fracao da meta
 * macro que cada no representa. Roda quando peso ou estrutura mudam.
 */
export async function refreshRootImpact(rootId: string, tx: Tx): Promise<void> {
  const root = await tx.node.findUnique({ where: { id: rootId }, select: { path: true } });
  if (!root) return;

  const nodes = await tx.node.findMany({
    where: { OR: [{ path: root.path }, { path: { startsWith: `${root.path}/` } }] },
    select: { id: true, parent_id: true, weight: true, status: true },
  });

  const contrib = contributionMap(nodes);
  await Promise.all(
    nodes.map((n) =>
      tx.node.update({
        where: { id: n.id },
        data: { root_impact: round6(contrib.get(n.id) ?? 0) },
      }),
    ),
  );
}

function round6(n: number): number {
  return Math.round((n + Number.EPSILON) * 1e6) / 1e6;
}

/** Recomputa tudo — comando de manutencao e verificacao no boot. */
export async function recomputeAll(userId: string): Promise<{ nodes: number; roots: number }> {
  const roots = await prisma.node.findMany({
    where: { user_id: userId, parent_id: null },
    select: { id: true, path: true },
  });

  let touched = 0;
  for (const root of roots) {
    await prisma.$transaction(async (tx) => {
      const nodes = await tx.node.findMany({
        where: { OR: [{ path: root.path }, { path: { startsWith: `${root.path}/` } }] },
        select: {
          id: true,
          parent_id: true,
          depth: true,
          weight: true,
          status: true,
          manual_progress: true,
        },
        orderBy: { depth: 'desc' },
      });

      const childrenOf = new Map<string, typeof nodes>();
      for (const n of nodes) {
        if (!n.parent_id) continue;
        const list = childrenOf.get(n.parent_id) ?? [];
        list.push(n);
        childrenOf.set(n.parent_id, list);
      }

      const progress = new Map<string, number>();
      for (const n of nodes) {
        const kids = childrenOf.get(n.id) ?? [];
        progress.set(
          n.id,
          kids.length === 0
            ? leafProgress({
                status: n.status,
                manual_progress: n.manual_progress ? num(n.manual_progress) : null,
              })
            : weightedProgress(
                kids.map((k) => ({
                  weight: k.weight,
                  progress: progress.get(k.id) ?? 0,
                  status: k.status,
                })),
              ),
        );
      }

      for (const n of nodes) {
        await tx.node.update({
          where: { id: n.id },
          data: { progress: round2(progress.get(n.id) ?? 0), rollup_dirty: false },
        });
      }
      touched += nodes.length;

      await refreshLeafCounts(root.path, tx as Tx);
      await refreshRootImpact(root.id, tx as Tx);
    });
  }

  return { nodes: touched, roots: roots.length };
}

export { COMPLETED, CANCELLED };
