/** Horizonte de vida: semanas vividas e restantes. Calculo puro, nada persistido. */

const WEEKS_PER_YEAR = 52.1775;

export interface Decade {
  decadeNumber: number;
  startAge: number;
  endAge: number;
  totalWeeks: number;
  weeksLived: number;
  status: 'past' | 'current' | 'future';
}

export function lifeWeeks(birthDate: Date, lifeExpectancy: number, today = new Date()) {
  const totalWeeks = Math.floor(lifeExpectancy * WEEKS_PER_YEAR);
  const weeksLived = Math.max(
    0,
    Math.min(totalWeeks, Math.floor((today.getTime() - birthDate.getTime()) / 604_800_000)),
  );
  const currentAgeYears = Math.floor(weeksLived / WEEKS_PER_YEAR);

  const decades: Decade[] = [];
  const decadeCount = Math.ceil(lifeExpectancy / 10);

  for (let i = 0; i < decadeCount; i += 1) {
    const startAge = i * 10;
    const endAge = Math.min(lifeExpectancy, startAge + 10);
    const before = Math.floor(startAge * WEEKS_PER_YEAR);
    const until = Math.floor(endAge * WEEKS_PER_YEAR);
    const total = until - before;
    const lived = Math.max(0, Math.min(total, weeksLived - before));
    decades.push({
      decadeNumber: i + 1,
      startAge,
      endAge,
      totalWeeks: total,
      weeksLived: lived,
      status: lived >= total ? 'past' : lived > 0 ? 'current' : 'future',
    });
  }

  return {
    totalWeeks,
    weeksLived,
    weeksRemaining: totalWeeks - weeksLived,
    percentageLived: Math.round((weeksLived / totalWeeks) * 1000) / 10,
    currentAgeYears,
    lifeExpectancy,
    decades,
  };
}
