import { Router } from 'express';
import { prisma } from '../../db/client.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { currentUserId } from '../../lib/currentUser.js';
import { notFound } from '../../lib/errors.js';
import { z } from 'zod';
import { createSpaceSchema } from '../../../shared/schemas/index.js';
import { num, toSpaceDTO } from '../../lib/serialize.js';

const router = Router();

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const userId = await currentUserId();
    const spaces = await prisma.space.findMany({
      where: { user_id: userId },
      orderBy: { position: 'asc' },
    });

    const roots = await prisma.node.findMany({
      where: { user_id: userId, parent_id: null },
      select: { space_id: true, progress: true, depth: true },
    });
    const counts = await prisma.node.groupBy({
      by: ['space_id'],
      where: { user_id: userId },
      _count: { _all: true },
      _max: { depth: true },
    });

    res.json(
      spaces.map((s) => {
        const spaceRoots = roots.filter((r) => r.space_id === s.id);
        const count = counts.find((c) => c.space_id === s.id);
        const progress =
          spaceRoots.length > 0
            ? Math.round(
                (spaceRoots.reduce((sum, r) => sum + num(r.progress), 0) / spaceRoots.length) * 10,
              ) / 10
            : 0;
        return toSpaceDTO(s, {
          rootCount: spaceRoots.length,
          nodeCount: count?._count._all ?? 0,
          progress,
        });
      }),
    );
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    const body = createSpaceSchema.parse(req.body);
    const last = await prisma.space.findFirst({
      where: { user_id: userId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const created = await prisma.space.create({
      data: { ...body, user_id: userId, position: body.position ?? (last?.position ?? -1) + 1 },
    });
    res.status(201).json(toSpaceDTO(created));
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const body = createSpaceSchema.partial().parse(req.body);
    const updated = await prisma.space.update({ where: { id: req.params.id }, data: body });
    res.json(toSpaceDTO(updated));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const space = await prisma.space.findUnique({ where: { id: req.params.id } });
    if (!space) throw notFound('Espaco');
    await prisma.space.delete({ where: { id: req.params.id } });
    res.json({ deleted: true });
  }),
);

/**
 * Vinculo de membro a espaco. Endpoint proprio em vez de reenviar a lista
 * inteira de espacos do membro: duas telas editando ao mesmo tempo nao
 * apagam o vinculo uma da outra.
 */
router.post(
  '/:id/members',
  asyncHandler(async (req, res) => {
    const { member_id } = z.object({ member_id: z.string().uuid() }).parse(req.body);

    const [space, member] = await Promise.all([
      prisma.space.findUnique({ where: { id: req.params.id } }),
      prisma.member.findUnique({ where: { id: member_id } }),
    ]);
    if (!space) throw notFound('Espaco');
    if (!member) throw notFound('Membro');

    const link = await prisma.spaceMember.upsert({
      where: { space_id_member_id: { space_id: space.id, member_id } },
      create: { space_id: space.id, member_id },
      update: {},
    });

    res.status(201).json(link);
  }),
);

router.delete(
  '/:id/members/:memberId',
  asyncHandler(async (req, res) => {
    const { id, memberId } = req.params;

    const link = await prisma.spaceMember.findUnique({
      where: { space_id_member_id: { space_id: id, member_id: memberId } },
    });
    if (!link) throw notFound('Vinculo');

    await prisma.spaceMember.delete({ where: { id: link.id } });

    // As tarefas ja atribuidas continuam com o responsavel: desvincular do
    // espaco nao apaga trabalho, so tira a pessoa da lista daquele espaco.
    const stillAssigned = await prisma.node.count({
      where: {
        space_id: id,
        assignee_id: memberId,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
    });

    res.json({ deleted: true, stillAssigned });
  }),
);

export default router;
