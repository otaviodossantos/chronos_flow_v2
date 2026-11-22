import { Router } from 'express';
import { prisma } from '../../db/client.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { currentUserId } from '../../lib/currentUser.js';
import { createMemberSchema } from '../../../shared/schemas/index.js';
import { toMemberDTO } from '../../lib/serialize.js';

const router = Router();

/**
 * Carga do membro: minutos abertos contra a capacidade semanal declarada,
 * no total e quebrada por espaco — e a quebra que permite avisar, na hora de
 * desvincular, quanto trabalho aberto ficaria orfao naquele espaco.
 */
async function withLoad(userId: string, members: any[]) {
  const where = {
    user_id: userId,
    assignee_id: { not: null },
    status: { notIn: ['COMPLETED', 'CANCELLED'] as any },
  };

  const [open, perSpace] = await Promise.all([
    prisma.node.groupBy({
      by: ['assignee_id'],
      where,
      _sum: { estimated_minutes: true },
      _count: { _all: true },
    }),
    prisma.node.groupBy({
      by: ['assignee_id', 'space_id'],
      where: { ...where, space_id: { not: null } },
      _sum: { estimated_minutes: true },
      _count: { _all: true },
    }),
  ]);

  return members.map((m) => {
    const row = open.find((o: any) => o.assignee_id === m.id);
    const openMinutes = row?._sum.estimated_minutes ?? 0;
    const capacityMinutes = m.capacity_hours_week * 60;

    return toMemberDTO(m, {
      openMinutes,
      openLeaves: row?._count._all ?? 0,
      loadPercent: capacityMinutes > 0 ? Math.round((openMinutes / capacityMinutes) * 100) : 0,
      spaceLoad: perSpace
        .filter((r: any) => r.assignee_id === m.id)
        .map((r: any) => ({
          space_id: r.space_id as string,
          openLeaves: r._count._all,
          openMinutes: r._sum.estimated_minutes ?? 0,
        })),
    });
  });
}

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const userId = await currentUserId();
    const members = await prisma.member.findMany({
      where: { user_id: userId },
      include: { spaces: { include: { space: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(await withLoad(userId, members));
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    const { space_ids, ...body } = createMemberSchema.parse(req.body);
    const created = await prisma.member.create({
      data: {
        ...body,
        email: body.email || null,
        user_id: userId,
        ...(space_ids?.length
          ? { spaces: { create: space_ids.map((space_id) => ({ space_id })) } }
          : {}),
      },
      include: { spaces: { include: { space: true } } },
    });
    res.status(201).json(toMemberDTO(created));
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { space_ids, ...body } = createMemberSchema.partial().parse(req.body);
    if (space_ids) {
      await prisma.spaceMember.deleteMany({ where: { member_id: req.params.id } });
      if (space_ids.length > 0) {
        await prisma.spaceMember.createMany({
          data: space_ids.map((space_id) => ({ space_id, member_id: req.params.id })),
          skipDuplicates: true,
        });
      }
    }
    const updated = await prisma.member.update({
      where: { id: req.params.id },
      data: { ...body, ...(body.email !== undefined ? { email: body.email || null } : {}) },
      include: { spaces: { include: { space: true } } },
    });
    res.json(toMemberDTO(updated));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await prisma.member.delete({ where: { id: req.params.id } });
    res.json({ deleted: true });
  }),
);

export default router;
