import { describe, it, expect } from 'vitest';
import {
  planReschedule,
  remapInstant,
  shiftMinutes,
  type TemporalNode,
} from '../../server/domain/scheduling.js';

const d = (iso: string) => new Date(iso);

const filha = (
  id: string,
  start: string,
  due: string,
  allDay = false,
): TemporalNode => ({
  id,
  title: id,
  start_date: d(start),
  due_date: d(due),
  all_day: allDay,
});

const pai: TemporalNode = {
  id: 'pai',
  title: 'Pai',
  start_date: d('2026-10-01T00:00:00Z'),
  due_date: d('2026-10-11T00:00:00Z'), // 10 dias
};

describe('remapInstant', () => {
  const janela = {
    fromStart: d('2026-10-01T00:00:00Z'),
    fromEnd: d('2026-10-11T00:00:00Z'),
    toStart: d('2026-10-01T00:00:00Z'),
    toEnd: d('2026-10-06T00:00:00Z'), // metade
  };

  it('preserva a posicao relativa ao encolher', () => {
    // O meio da janela antiga vira o meio da nova.
    expect(remapInstant(d('2026-10-06T00:00:00Z'), janela).toISOString()).toBe(
      '2026-10-03T12:00:00.000Z',
    );
  });

  it('mantem as pontas nas pontas', () => {
    expect(remapInstant(d('2026-10-01T00:00:00Z'), janela).toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
    expect(remapInstant(d('2026-10-11T00:00:00Z'), janela).toISOString()).toBe(
      '2026-10-06T00:00:00.000Z',
    );
  });

  it('vira deslocamento puro quando a duracao nao muda', () => {
    const mover = {
      fromStart: d('2026-10-01T00:00:00Z'),
      fromEnd: d('2026-10-11T00:00:00Z'),
      toStart: d('2026-10-08T00:00:00Z'),
      toEnd: d('2026-10-18T00:00:00Z'),
    };
    expect(remapInstant(d('2026-10-03T09:30:00Z'), mover).toISOString()).toBe(
      '2026-10-10T09:30:00.000Z',
    );
  });

  it('acompanha o inicio quando a janela antiga tinha duracao zero', () => {
    const zero = {
      fromStart: d('2026-10-01T00:00:00Z'),
      fromEnd: d('2026-10-01T00:00:00Z'),
      toStart: d('2026-10-05T00:00:00Z'),
      toEnd: d('2026-10-09T00:00:00Z'),
    };
    expect(remapInstant(d('2026-10-01T00:00:00Z'), zero).toISOString()).toBe(
      '2026-10-05T00:00:00.000Z',
    );
  });

  it('arredonda no minuto', () => {
    const tres = {
      fromStart: d('2026-10-01T00:00:00Z'),
      fromEnd: d('2026-10-04T00:00:00Z'),
      toStart: d('2026-10-01T00:00:00Z'),
      toEnd: d('2026-10-02T00:00:00Z'),
    };
    expect(remapInstant(d('2026-10-02T11:11:11Z'), tres).getSeconds()).toBe(0);
  });
});

describe('planReschedule — mover o pai', () => {
  it('arrasta as filhas pelo mesmo deslocamento', () => {
    const filhas = [filha('a', '2026-10-02T09:00:00Z', '2026-10-04T18:00:00Z')];
    const plan = planReschedule(
      pai,
      { start_date: d('2026-10-08T00:00:00Z'), due_date: d('2026-10-18T00:00:00Z') },
      filhas,
      null,
      true,
    );

    expect(plan.scale).toBeCloseTo(1);
    expect(plan.affected).toHaveLength(1);
    expect(plan.affected[0].to.start_date?.toISOString()).toBe('2026-10-09T09:00:00.000Z');
    expect(plan.affected[0].to.due_date?.toISOString()).toBe('2026-10-11T18:00:00.000Z');
  });

  it('move por minutos, nao por dias', () => {
    // No zoom de horas o arraste e de 15 em 15: arredondar para dia zeraria.
    const filhas = [filha('a', '2026-10-02T09:00:00Z', '2026-10-02T10:00:00Z')];
    const plan = planReschedule(
      pai,
      { start_date: d('2026-10-01T00:45:00Z'), due_date: d('2026-10-11T00:45:00Z') },
      filhas,
      null,
      true,
    );

    expect(plan.shiftedMinutes).toBe(45);
    expect(plan.affected[0].to.start_date?.toISOString()).toBe('2026-10-02T09:45:00.000Z');
  });
});

describe('planReschedule — encolher o pai', () => {
  it('comprime as filhas proporcionalmente em vez de desliza-las', () => {
    // Pai de 10 dias vira 5. A filha que ocupava do dia 2 ao 4 (20% a 30%)
    // passa a ocupar 20% a 30% da janela nova.
    const filhas = [filha('a', '2026-10-03T00:00:00Z', '2026-10-05T00:00:00Z')];
    const plan = planReschedule(
      pai,
      { start_date: d('2026-10-01T00:00:00Z'), due_date: d('2026-10-06T00:00:00Z') },
      filhas,
      null,
      true,
    );

    expect(plan.scale).toBeCloseTo(0.5);
    expect(plan.affected[0].to.start_date?.toISOString()).toBe('2026-10-02T00:00:00.000Z');
    expect(plan.affected[0].to.due_date?.toISOString()).toBe('2026-10-03T00:00:00.000Z');
  });

  it('nao deixa nenhuma filha escapar da janela nova', () => {
    const filhas = [
      filha('a', '2026-10-01T00:00:00Z', '2026-10-03T00:00:00Z'),
      filha('b', '2026-10-05T00:00:00Z', '2026-10-08T00:00:00Z'),
      filha('c', '2026-10-09T00:00:00Z', '2026-10-11T00:00:00Z'),
    ];
    const next = { start_date: d('2026-10-01T00:00:00Z'), due_date: d('2026-10-04T00:00:00Z') };
    const plan = planReschedule(pai, next, filhas, null, true);

    for (const mudanca of plan.affected) {
      expect(mudanca.to.start_date!.getTime()).toBeGreaterThanOrEqual(next.start_date.getTime());
      expect(mudanca.to.due_date!.getTime()).toBeLessThanOrEqual(next.due_date.getTime());
    }
    expect(plan.violations).toHaveLength(0);
  });

  it('preserva a ordem das filhas', () => {
    const filhas = [
      filha('a', '2026-10-02T00:00:00Z', '2026-10-04T00:00:00Z'),
      filha('b', '2026-10-05T00:00:00Z', '2026-10-07T00:00:00Z'),
    ];
    const plan = planReschedule(
      pai,
      { start_date: d('2026-10-01T00:00:00Z'), due_date: d('2026-10-04T00:00:00Z') },
      filhas,
      null,
      true,
    );
    const [a, b] = plan.affected;
    expect(a.to.due_date!.getTime()).toBeLessThanOrEqual(b.to.start_date!.getTime());
  });

  it('cresce tambem, nao so encolhe', () => {
    const filhas = [filha('a', '2026-10-06T00:00:00Z', '2026-10-06T00:00:00Z')];
    const plan = planReschedule(
      pai,
      { start_date: d('2026-10-01T00:00:00Z'), due_date: d('2026-10-21T00:00:00Z') },
      filhas,
      null,
      true,
    );
    expect(plan.scale).toBeCloseTo(2);
    // O meio continua no meio, agora de uma janela de 20 dias.
    expect(plan.affected[0].to.start_date?.toISOString()).toBe('2026-10-11T00:00:00.000Z');
  });

  it('ancora filha de dia inteiro no comeco do dia', () => {
    const filhas = [filha('a', '2026-10-04T00:00:00Z', '2026-10-06T00:00:00Z', true)];
    const plan = planReschedule(
      pai,
      { start_date: d('2026-10-01T00:00:00Z'), due_date: d('2026-10-04T12:00:00Z') },
      filhas,
      null,
      true,
    );
    const inicio = plan.affected[0].to.start_date!;
    expect([inicio.getHours(), inicio.getMinutes(), inicio.getSeconds()]).toEqual([0, 0, 0]);
  });
});

describe('planReschedule — limites', () => {
  it('nao mexe nas filhas quando a cascata esta desligada', () => {
    const filhas = [filha('a', '2026-10-02T00:00:00Z', '2026-10-04T00:00:00Z')];
    const plan = planReschedule(
      pai,
      { start_date: d('2026-10-08T00:00:00Z'), due_date: d('2026-10-18T00:00:00Z') },
      filhas,
      null,
      false,
    );
    expect(plan.affected).toHaveLength(0);
  });

  it('desloca quando o pai nao tem as duas pontas', () => {
    const semFim: TemporalNode = { id: 'p', title: 'p', start_date: d('2026-10-01T00:00:00Z'), due_date: null };
    const filhas = [filha('a', '2026-10-02T00:00:00Z', '2026-10-04T00:00:00Z')];
    const plan = planReschedule(
      semFim,
      { start_date: d('2026-10-03T00:00:00Z'), due_date: null },
      filhas,
      null,
      true,
    );
    expect(plan.scale).toBe(1);
    expect(plan.affected[0].to.start_date?.toISOString()).toBe('2026-10-04T00:00:00.000Z');
  });

  it('nao registra mudanca quando nada se move', () => {
    const filhas = [filha('a', '2026-10-02T00:00:00Z', '2026-10-04T00:00:00Z')];
    const plan = planReschedule(
      pai,
      { start_date: pai.start_date, due_date: pai.due_date },
      filhas,
      null,
      true,
    );
    expect(plan.affected).toHaveLength(0);
  });
});

describe('shiftMinutes', () => {
  it('soma minutos sem tocar no fuso', () => {
    expect(shiftMinutes(d('2026-10-01T09:00:00Z'), 90)?.toISOString()).toBe(
      '2026-10-01T10:30:00.000Z',
    );
  });

  it('devolve o mesmo valor para zero e para nulo', () => {
    const x = d('2026-10-01T09:00:00Z');
    expect(shiftMinutes(x, 0)).toBe(x);
    expect(shiftMinutes(null, 30)).toBeNull();
  });
});
