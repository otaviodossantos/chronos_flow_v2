import { useMemo } from 'react';
import { PX_PER_DAY, type ZoomLevel } from '@/stores/timelineStore';
import { useNow } from '@/hooks/useNow';
import { MONTHS_SHORT } from '@/lib/format';

export interface Tick {
  key: string;
  x: number;
  label: string;
  major: boolean;
}

export interface TimeScale {
  zoom: ZoomLevel;
  pxPerDay: number;
  pxPerMinute: number;
  width: number;
  start: Date;
  end: Date;
  /** Instante para pixel, com precisao de minuto. */
  xOf: (d: Date | string | null) => number;
  /** Pixel para instante, encaixado no passo do zoom. */
  dateAt: (x: number, snapMinutes?: number) => Date;
  ticks: Tick[];
  /** Faixas de dia alternadas, para o zoom de horas nao virar uma regua sem fim. */
  bands: Array<{ key: string; x: number; width: number; label: string }>;
  todayX: number;
}

const DAY_MS = 86_400_000;

/**
 * De quanto em quanto tempo o relogio da linha de "hoje" acorda. Segue o
 * zoom: em trimestres um minuto vale 0,0005px e acordar a cada 30s seria
 * trabalho jogado fora; no zoom de horas, 1px e exatamente um minuto.
 */
const TICK_MS: Record<ZoomLevel, number> = {
  hours: 30_000,
  days: 60_000,
  weeks: 300_000,
  months: 300_000,
  quarters: 300_000,
};

const VISIBLE_DAYS: Record<ZoomLevel, number> = {
  quarters: 1095,
  months: 365,
  weeks: 120,
  days: 30,
  hours: 3,
};

export function useTimeScale(zoom: ZoomLevel, viewportStart: Date): TimeScale {
  const agora = useNow(TICK_MS[zoom]);

  // Duas etapas de proposito: reguas e faixas so mudam com zoom e viewport,
  // e nao ha por que reconstrui-las a cada batida do relogio.
  const base = useMemo(() => {
    const pxPerDay = PX_PER_DAY[zoom];
    const pxPerMinute = pxPerDay / 1440;
    const days = VISIBLE_DAYS[zoom];
    const start = new Date(viewportStart);
    const end = new Date(start.getTime() + days * DAY_MS);
    const width = days * pxPerDay;

    // Diferenca em milissegundos, nao em dias: e isso que faz a hora existir.
    const xOf = (value: Date | string | null): number => {
      if (!value) return 0;
      const d = typeof value === 'string' ? new Date(value) : value;
      if (Number.isNaN(d.getTime())) return 0;
      return ((d.getTime() - start.getTime()) / DAY_MS) * pxPerDay;
    };

    const dateAt = (x: number, snapMinutes = 1): Date => {
      const minutes = (x / pxPerDay) * 1440;
      const snapped = Math.round(minutes / snapMinutes) * snapMinutes;
      return new Date(start.getTime() + snapped * 60_000);
    };

    const ticks: Tick[] = [];
    const bands: TimeScale['bands'] = [];

    if (zoom === 'hours') {
      // Uma marca por hora; rotulo cheio de 2 em 2 para nao empilhar texto.
      const first = new Date(start);
      first.setMinutes(0, 0, 0);
      for (let t = first; t <= end; t = new Date(t.getTime() + 3_600_000)) {
        const h = t.getHours();
        ticks.push({
          key: t.toISOString(),
          x: xOf(t),
          label: h % 2 === 0 ? `${String(h).padStart(2, '0')}:00` : '',
          major: h === 0,
        });
      }
      const firstDay = new Date(start);
      firstDay.setHours(0, 0, 0, 0);
      for (let d = firstDay; d <= end; d = new Date(d.getTime() + DAY_MS)) {
        bands.push({
          key: d.toISOString(),
          x: xOf(d),
          width: pxPerDay,
          label: `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`,
        });
      }
    } else if (zoom === 'days') {
      const first = new Date(start);
      first.setHours(0, 0, 0, 0);
      for (let d = first; d <= end; d = new Date(d.getTime() + DAY_MS)) {
        ticks.push({
          key: d.toISOString(),
          x: xOf(d),
          label: `${d.getDate()}`,
          major: d.getDay() === 1,
        });
      }
    } else if (zoom === 'weeks') {
      const cursor = new Date(start);
      cursor.setHours(0, 0, 0, 0);
      cursor.setDate(cursor.getDate() + ((8 - cursor.getDay()) % 7));
      for (let d = cursor; d <= end; d = new Date(d.getTime() + 7 * DAY_MS)) {
        ticks.push({
          key: d.toISOString(),
          x: xOf(d),
          label: `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`,
          major: d.getDate() <= 7,
        });
      }
    } else if (zoom === 'months') {
      const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
      for (let d = cursor; d <= end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        ticks.push({
          key: d.toISOString(),
          x: xOf(d),
          label: `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`,
          major: d.getMonth() % 3 === 0,
        });
      }
    } else {
      const cursor = new Date(start.getFullYear(), Math.floor(start.getMonth() / 3) * 3, 1);
      for (let d = cursor; d <= end; d = new Date(d.getFullYear(), d.getMonth() + 3, 1)) {
        ticks.push({
          key: d.toISOString(),
          x: xOf(d),
          label: `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`,
          major: d.getMonth() === 0,
        });
      }
    }

    return {
      zoom,
      pxPerDay,
      pxPerMinute,
      width,
      start,
      end,
      xOf,
      dateAt,
      ticks,
      bands,
    };
  }, [zoom, viewportStart.getTime()]);

  return useMemo(
    () => ({ ...base, todayX: base.xOf(agora) }),
    [base, agora],
  );
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
