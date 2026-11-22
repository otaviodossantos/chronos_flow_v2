import { Router } from 'express';
import { prisma } from '../../db/client.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { currentUserId } from '../../lib/currentUser.js';
import { AppError, notFound } from '../../lib/errors.js';
import { createDependencySchema } from '../../../shared/schemas/index.js';
import { findCycle, criticalPath, blockedNodeIds } from '../../domain/dependencies.js';

const router = Router();

router.get(
  '/critical-path',
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    const spaceId = req.query.spaceId as string | undefined;

    const nodes = await prisma.node.findMany({
      where: { user_id: userId, ...(spaceId ? { space_id: spaceId } : {}) },
      select: { id: true, title: true, status: true, estimated_minutes: true },
    });
    const edges = await prisma.nodeDependency.findMany({
      where: { blocked: { user_id: userId, ...(spaceId ? { space_id: spaceId } : {}) } },
      select: { blocker_id: true, blocked_id: true },
    });

    const ids = criticalPath(nodes, edges);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    res.json({ path: ids.map((id) => byId.get(id)).filter(Boolean) });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    const body = createDependencySchema.parse(req.body);

    const [blocker, blocked] = await Promise.all([
      prisma.node.findUnique({ where: { id: body.blocker_id }, select: { id: true, title: true, path: true, status: true } }),
      prisma.node.findUnique({ where: { id: body.blocked_id }, select: { id: true, title: true, path: true } }),
    ]);
    if (!blocker || !blocked) throw notFound('No da dependencia');

    if (blocked.path.startsWith(`${blocker.path}/`) || blocker.path.startsWith(`${blocked.path}/`)) {
      throw new AppError(
        'CYCLE_DETECTED',
        'Um no nao pode depender de um ancestral ou descendente proprio.',
      );
    }

    const edges = await prisma.nodeDependency.findMany({
      where: { blocked: { user_id: userId } },
      select: { blocker_id: true, blocked_id: true },
    });
    const cycle = findCycle(edges, body.blocker_id, body.blocked_id);
    if (cycle) {
      const titles = await prisma.node.findMany({
        where: { id: { in: cycle } },
        select: { id: true, title: true },
      });
      const byId = new Map(titles.map((t) => [t.id, t.title]));
      throw new AppError('CYCLE_DETECTED', 'Esta dependencia criaria um ciclo.', {
        path: cycle.map((id) => byId.get(id) ?? id),
      });
    }

    const created = await prisma.nodeDependency.create({
      data: {
        blocker_id: body.blocker_id,
        blocked_id: body.blocked_id,
        type: body.type ?? 'FINISH_TO_START',
        lag_days: body.lag_days ?? 0,
      },
    });

    if (blocker.status !== 'COMPLETED' && blocker.status !== 'CANCELLED') {
      await prisma.node.updateMany({
        where: { id: body.blocked_id, status: 'PENDING' },
        data: { status: 'BLOCKED' },
      });
    }

    res.status(201).json(created);
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    const dep = await prisma.nodeDependency.findUnique({ where: { id: req.params.id } });
    if (!dep) throw notFound('Dependencia');

    await prisma.nodeDependency.delete({ where: { id: req.params.id } });

    const edges = await prisma.nodeDependency.findMany({
      where: { blocked: { user_id: userId } },
      select: { blocker_id: true, blocked_id: true },
    });
    const nodes = await prisma.node.findMany({
      where: { user_id: userId },
      select: { id: true, status: true },
    });
    const blocked = blockedNodeIds(edges, new Map<string, string>(nodes.map((n: { id: string; status: string }) => [n.id, n.status])));
    if (!blocked.has(dep.blocked_id)) {
      await prisma.node.updateMany({
        where: { id: dep.blocked_id, status: 'BLOCKED' },
        data: { status: 'PENDING' },
      });
    }
    res.json({ deleted: true });
  }),
);

export default router;
