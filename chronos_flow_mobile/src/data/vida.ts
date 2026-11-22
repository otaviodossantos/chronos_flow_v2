import { eq } from 'drizzle-orm';
import { users } from '@db/schema';
import { lifeWeeks } from '@core/life';
import type { LifeSummary } from '@shared/types';
import { bd as banco } from './conexao';
import { fechadasHoje } from './foco';

export async function resumoDaVida(userId: string): Promise<LifeSummary> {
  const bd = banco();
  const usuario = await bd.select().from(users).where(eq(users.id, userId)).get();
  if (!usuario) throw new Error('Usuario nao encontrado.');

  const feitasHoje = await fechadasHoje(userId);
  const semanas = lifeWeeks(usuario.birth_date, usuario.life_expectancy);

  return {
    ...semanas,
    today: {
      focusMinutesDone: feitasHoje.reduce((s, n) => s + (n.estimated_minutes ?? 0), 0),
      focusGoalMinutes: usuario.daily_focus_goal_minutes,
      impactDone: Math.round(feitasHoje.reduce((s, n) => s + n.root_impact, 0) * 1000) / 10,
      impactGoal: usuario.daily_impact_goal,
      leavesCompleted: feitasHoje.length,
    },
  } as LifeSummary;
}
