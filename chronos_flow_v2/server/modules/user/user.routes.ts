import { Router } from 'express';
import { prisma } from '../../db/client.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { currentUserId } from '../../lib/currentUser.js';
import { somenteSessao } from '../../lib/sessao.js';
import { num } from '../../lib/serialize.js';
import { updateUserSchema, resetSchema } from '../../../shared/schemas/index.js';
import { recomputeAll } from '../nodes/cascade.service.js';
import { hasModel, missingModels } from '../../lib/schemaGuard.js';

const router = Router();

const shape = (u: any) => ({
  id: u.id,
  name: u.name,
  birth_date: u.birth_date.toISOString(),
  life_expectancy: u.life_expectancy,
  daily_focus_goal_minutes: u.daily_focus_goal_minutes,
  daily_impact_goal: num(u.daily_impact_goal),
  timezone: u.timezone,
});

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const userId = await currentUserId();
    res.json(shape(await prisma.user.findUniqueOrThrow({ where: { id: userId } })));
  }),
);

router.patch(
  '/',
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    const body = updateUserSchema.parse(req.body);
    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...body,
        ...(body.birth_date ? { birth_date: new Date(body.birth_date) } : {}),
      },
    });
    res.json(shape(updated));
  }),
);

router.post(
  '/recompute',
  asyncHandler(async (_req, res) => {
    const userId = await currentUserId();
    res.json(await recomputeAll(userId));
  }),
);

/** Quanto existe hoje — o dialogo mostra isso antes de destruir nada. */
router.get(
  '/data-summary',
  asyncHandler(async (_req, res) => {
    const userId = await currentUserId();
    const [nodes, roots, spaces, members, backlog, dependencies] = await Promise.all([
      prisma.node.count({ where: { user_id: userId } }),
      prisma.node.count({ where: { user_id: userId, parent_id: null } }),
      prisma.space.count({ where: { user_id: userId } }),
      prisma.member.count({ where: { user_id: userId } }),
      hasModel('backlogItem')
        ? prisma.backlogItem.count({ where: { user_id: userId } })
        : Promise.resolve(0),
      prisma.nodeDependency.count({ where: { blocked: { user_id: userId } } }),
    ]);
    res.json({
      nodes,
      roots,
      spaces,
      members,
      backlog,
      dependencies,
      // A interface avisa quando o client esta atras do schema.
      staleClient: missingModels(),
    });
  }),
);

/**
 * Apaga todos os dados de trabalho. Irreversivel e sem lixeira, entao a frase
 * de confirmacao e conferida aqui tambem: a interface nao e a unica barreira.
 */
router.post(
  '/reset',
  somenteSessao,
  asyncHandler(async (req, res) => {
    const userId = await currentUserId();
    const { includeProfile } = resetSchema.parse(req.body);

    const deleted = await prisma.$transaction(async (tx) => {
      // Ordem explicita em vez de confiar no cascade de cada relacao.
      await tx.nodeActivity.deleteMany({ where: { node: { user_id: userId } } });
      if (hasModel('nodeUpdate')) {
        await tx.nodeUpdate.deleteMany({ where: { node: { user_id: userId } } });
      }
      await tx.progressSnapshot.deleteMany({ where: { node: { user_id: userId } } });
      await tx.nodeDependency.deleteMany({ where: { blocked: { user_id: userId } } });
      if (hasModel('backlogRole')) {
        await tx.backlogRole.deleteMany({ where: { backlog_item: { user_id: userId } } });
      }

      const backlog = hasModel('backlogItem')
        ? await tx.backlogItem.deleteMany({ where: { user_id: userId } })
        : { count: 0 };
      const nodes = await tx.node.deleteMany({ where: { user_id: userId } });
      await tx.spaceMember.deleteMany({ where: { space: { user_id: userId } } });
      const members = await tx.member.deleteMany({ where: { user_id: userId } });
      const spaces = await tx.space.deleteMany({ where: { user_id: userId } });

      if (includeProfile) await tx.user.delete({ where: { id: userId } });

      return {
        nodes: nodes.count,
        spaces: spaces.count,
        members: members.count,
        backlog: backlog.count,
      };
    });

    res.json({ reset: true, profileRemoved: Boolean(includeProfile), deleted });
  }),
);

export default router;
