import { prisma, type Tx } from '../../db/client.js';
import { subtreePrefix } from '../../domain/path.js';

export const nodeSelect = {
  include: {
    assignee: true,
    _count: { select: { children: true } },
  },
} as const;

export async function findNode(id: string, tx: Tx = prisma) {
  return tx.node.findUnique({ where: { id }, ...nodeSelect });
}

export async function requireNode(id: string, tx: Tx = prisma) {
  const node = await findNode(id, tx);
  if (!node) throw Object.assign(new Error('no nao encontrado'), { code: 'NOT_FOUND' });
  return node;
}

/** Subarvore inteira via prefixo do materialized path — um indice btree resolve. */
export async function findSubtree(path: string, tx: Tx = prisma, includeSelf = true) {
  return tx.node.findMany({
    where: {
      OR: [
        ...(includeSelf ? [{ path }] : []),
        { path: { startsWith: `${path}/` } },
      ],
    },
    ...nodeSelect,
    orderBy: [{ depth: 'asc' }, { position: 'asc' }],
  });
}

export async function countSubtree(path: string, tx: Tx = prisma) {
  return tx.node.count({ where: { path: { startsWith: `${path}/` } } });
}

export async function childrenOf(parentId: string, tx: Tx = prisma) {
  return tx.node.findMany({
    where: { parent_id: parentId },
    ...nodeSelect,
    orderBy: { position: 'asc' },
  });
}

export async function dependenciesTouching(nodeIds: string[], tx: Tx = prisma) {
  if (nodeIds.length === 0) return [];
  return tx.nodeDependency.findMany({
    where: { OR: [{ blocker_id: { in: nodeIds } }, { blocked_id: { in: nodeIds } }] },
  });
}

export async function allDependencies(userId: string, tx: Tx = prisma) {
  return tx.nodeDependency.findMany({ where: { blocked: { user_id: userId } } });
}

export async function nextPosition(parentId: string | null, userId: string, tx: Tx = prisma) {
  const last = await tx.node.findFirst({
    where: parentId ? { parent_id: parentId } : { parent_id: null, user_id: userId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  return (last?.position ?? -1) + 1;
}

export { subtreePrefix };
