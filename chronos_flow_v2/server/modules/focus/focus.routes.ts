import { Router } from 'express';
import { prisma } from '../../db/client.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { currentUserId } from '../../lib/currentUser.js';
import { num, toNodeDTO } from '../../lib/serialize.js';
import { focusScore, rootCriticality, projectProgress, startOfDay } from '../../domain/impact.js';
import { blockedNodeIds } from '../../domain/dependencies.js';
import { simulateSchema } from '../../../shared/schemas/index.js';
import type { FocusItem } from '../../../shared/types.js';

const router = Router();

/**
 * Fila do dia: so folhas, ordenadas pelo quanto destravam a meta macro
 * mais pressionada. Bloqueadas vao para uma lista separada.
 */
router.get(
  '/queue',
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    const scope = (req.query.scope as string) ?? 'today';
    const assigneeId = req.query.assigneeId as string | undefined;
    const today = new Date();

    const nodes = await prisma.node.findMany({
      where: {
        user_id: userId,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
        children: { none: {} },
        ...(assigneeId ? { assignee_id: assigneeId } : {}),
      },
      include: { assignee: true, _count: { select: { children: true } } },
      take: 500,
    });

    const rootIds = [...new Set(nodes.map((n) => n.path.split('/')[0]))];
    const roots = await prisma.node.findMany({
      where: { id: { in: rootIds } },
      select: {
        id: true,
        title: true,
        progress: true,
        importance: true,
        due_date: true,
        space: { select: { color: true } },
      },
    });
    const rootById = new Map(roots.map((r) => [r.id, r]));

    const edges = await prisma.nodeDependency.findMany({
      where: { blocked: { user_id: userId } },
      select: { blocker_id: true, blocked_id: true },
    });
    const statusRows = await prisma.node.findMany({
      where: { user_id: userId },
      select: { id: true, status: true, title: true },
    });
    const statusById = new Map<string, string>(statusRows.map((s: { id: string; status: string }) => [s.id, s.status]));
    const titleById = new Map<string, string>(statusRows.map((s: { id: string; title: string }) => [s.id, s.title]));
    const blocked = blockedNodeIds(edges, statusById);

    const ancestorTitles = await prisma.node.findMany({
      where: { user_id: userId, depth: { lte: 3 } },
      select: { id: true, title: true },
    });
    const nameById = new Map(ancestorTitles.map((a) => [a.id, a.title]));

    const items: FocusItem[] = nodes.map((n) => {
      const root = rootById.get(n.path.split('/')[0]);
      const crit = root ? rootCriticality(root.importance, root.due_date, today) : 1;
      const isBlocked = blocked.has(n.id);
      const contribution = num(n.root_impact);

      return {
        node: toNodeDTO(n, {
          blockedBy: edges.filter((e) => e.blocked_id === n.id).map((e) => e.blocker_id),
        }),
        root: {
          id: root?.id ?? '',
          title: root?.title ?? 'Sem meta',
          progress: root ? num(root.progress) : 0,
          color: root?.space?.color ?? '#10B981',
        },
        spacePath: n.path
          .split('/')
          .slice(0, -1)
          .map((id) => nameById.get(id) ?? '')
          .filter(Boolean),
        score: focusScore(
          {
            contribution,
            rootCriticality: crit,
            isBlocked,
            dueDate: n.due_date,
            plannedDate: n.planned_date,
          },
          today,
        ),
        deltaPercent: Math.round(contribution * 1000) / 10,
        isBlocked,
        blockers: edges
          .filter((e) => e.blocked_id === n.id)
          .map((e) => ({ id: e.blocker_id, title: titleById.get(e.blocker_id) ?? '' }))
          .filter((b) => statusById.get(b.id) !== 'COMPLETED'),
      };
    });

    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + (scope === 'next48' ? 2 : 0));
    const endOfScope = startOfDay(horizon).getTime() + 86_399_000;

    const inScope =
      scope === 'all'
        ? items
        : items.filter((i) => {
            const planned = i.node.planned_date ? new Date(i.node.planned_date).getTime() : null;
            const due = i.node.due_date ? new Date(i.node.due_date).getTime() : null;
            return (planned != null && planned <= endOfScope) || (due != null && due <= endOfScope);
          });

    const pool = inScope.length > 0 ? inScope : items;
    const open = pool.filter((i) => !i.isBlocked).sort((a, b) => b.score - a.score).slice(0, 25);
    const impediments = pool.filter((i) => i.isBlocked).sort((a, b) => b.deltaPercent - a.deltaPercent).slice(0, 10);

    const completedToday = await prisma.node.count({
      where: { user_id: userId, completed_at: { gte: startOfDay(today) } },
    });

    res.json({
      queue: open,
      impediments,
      potentialImpact: Math.round(open.reduce((s, i) => s + i.deltaPercent, 0) * 10) / 10,
      completedToday,
    });
  }),
);

/** Projecao do simulador: quanto cada raiz sobe se estas folhas fecharem hoje. */
router.post(
  '/simulate',
  asyncHandler(async (req, res) => {
    const { nodeIds } = simulateSchema.parse(req.body);
    const nodes = await prisma.node.findMany({
      where: { id: { in: nodeIds } },
      select: { id: true, path: true, root_impact: true, progress: true, title: true },
    });

    const byRoot = new Map<string, typeof nodes>();
    for (const n of nodes) {
      const rootId = n.path.split('/')[0];
      const list = byRoot.get(rootId) ?? [];
      list.push(n);
      byRoot.set(rootId, list);
    }

    const roots = await prisma.node.findMany({
      where: { id: { in: [...byRoot.keys()] } },
      select: { id: true, title: true, progress: true },
    });

    res.json({
      projections: roots.map((r) => {
        const leaves = (byRoot.get(r.id) ?? []).map((l) => ({
          contribution: num(l.root_impact),
          progress: num(l.progress),
        }));
        const current = num(r.progress);
        return {
          rootId: r.id,
          rootTitle: r.title,
          current,
          projected: projectProgress(current, leaves),
        };
      }),
    });
  }),
);

export default router;
