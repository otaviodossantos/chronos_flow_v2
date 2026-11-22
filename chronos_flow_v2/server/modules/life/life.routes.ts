import { Router } from 'express';
import { prisma } from '../../db/client.js';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { currentUserId } from '../../lib/currentUser.js';
import { num } from '../../lib/serialize.js';
import { lifeWeeks } from '../../domain/life.js';
import { startOfDay } from '../../domain/impact.js';
import type { LifeSummary } from '../../../shared/types.js';

const router = Router();

router.get(
  '/summary',
  asyncHandler(async (_req, res) => {
    const userId = await currentUserId();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const today = startOfDay(new Date());

    const doneToday = await prisma.node.findMany({
      where: { user_id: userId, completed_at: { gte: today }, children: { none: {} } },
      select: { estimated_minutes: true, root_impact: true },
    });

    const weeks = lifeWeeks(user.birth_date, user.life_expectancy);
    const summary: LifeSummary = {
      ...weeks,
      today: {
        focusMinutesDone: doneToday.reduce((s, n) => s + (n.estimated_minutes ?? 0), 0),
        focusGoalMinutes: user.daily_focus_goal_minutes,
        impactDone:
          Math.round(doneToday.reduce((s, n) => s + num(n.root_impact), 0) * 1000) / 10,
        impactGoal: num(user.daily_impact_goal),
        leavesCompleted: doneToday.length,
      },
    };

    res.json(summary);
  }),
);

export default router;
