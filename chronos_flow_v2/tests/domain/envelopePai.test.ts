import { describe, it, expect } from 'vitest';
import {
  envelopeOf,
  grownWindow,
  planReschedule,
  type TemporalNode,
} from '../../server/domain/scheduling.js';

const d = (iso: string) => new Date(iso);
const janela = (start: string | null, due: string | null) => ({
  start_date: start ? d(start) : null,
  due_date: due ? d(due) : null,
});

describe('envelopeOf', () => {
  it('pega a menor ponta e a maior de todas as filhas', () => {
    const env = envelopeOf([
      janela('2026-10-05T00:00:00Z', '2026-10-08T00:00:00Z'),
      janela('2026-10-02T00:00:00Z', '2026-10-04T00:00:00Z'),
      janela('2026-10-06T00:00:00Z', '2026-10-20T00:00:00Z'),
    ]);
    expect(env?.start_date.toISOString()).toBe('2026-10-02T00:00:00.000Z');
    expect(env?.due_date.toISOString()).toBe('2026-10-20T00:00:00.000Z');
  });

  it('ignora filhas sem data', () => {
    const env = envelopeOf([
      janela(null, null),
      janela('2026-10-03T00:00:00Z', '2026-10-09T00:00:00Z'),
    ]);
    expect(env?.start_date.toISOString()).toBe('2026-10-03T00:00:00.000Z');
  });

  it('devolve nulo quando nenhuma filha tem data', () => {
    expect(envelopeOf([janela(null, null)])).toBeNull();
    expect(envelopeOf([])).toBeNull();
  });

  it('aceita filha com so uma das pontas', () => {
    const env = envelopeOf([janela('2026-10-03T00:00:00Z', null)]);
    expect(env?.start_date.toISOString()).toBe('2026-10-03T00:00:00.000Z');
    expect(env?.due_date.toISOString()).toBe('2026-10-03T00:00:00.000Z');
  });
});

describe('grownWindow', () => {
  const pai = janela('2026-10-01T00:00:00Z', '2026-10-10T00:00:00Z');

  it('estica o fim quando a filha passa dele', () => {
    const r = grownWindow(pai, [janela('2026-10-02T00:00:00Z', '2026-10-15T00:00:00Z')]);
    expect(r.changed).toBe(true);
    expect(r.due_date?.toISOString()).toBe('2026-10-15T00:00:00.000Z');
    // o inicio nao se move: so o lado que estourou
    expect(r.start_date?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('estica o inicio quando a filha comeca antes', () => {
    const r = grownWindow(pai, [janela('2026-09-20T00:00:00Z', '2026-10-05T00:00:00Z')]);
    expect(r.start_date?.toISOString()).toBe('2026-09-20T00:00:00.000Z');
    expect(r.due_date?.toISOString()).toBe('2026-10-10T00:00:00.000Z');
  });

  it('NAO encolhe quando as filhas ocupam menos', () => {
    // Esta e a regra que evita a reacao em cadeia: ajustar uma filha para
    // baixo nao pode reescrever um prazo que alguem escolheu.
    const r = grownWindow(pai, [janela('2026-10-03T00:00:00Z', '2026-10-04T00:00:00Z')]);
    expect(r.changed).toBe(false);
    expect(r.start_date?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(r.due_date?.toISOString()).toBe('2026-10-10T00:00:00.000Z');
  });

  it('nao acusa mudanca quando ja cabia exatamente', () => {
    const r = grownWindow(pai, [janela('2026-10-01T00:00:00Z', '2026-10-10T00:00:00Z')]);
    expect(r.changed).toBe(false);
  });

  it('adota a janela das filhas quando o pai nao tem data', () => {
    const r = grownWindow(janela(null, null), [
      janela('2026-10-02T00:00:00Z', '2026-10-06T00:00:00Z'),
    ]);
    expect(r.changed).toBe(true);
    expect(r.start_date?.toISOString()).toBe('2026-10-02T00:00:00.000Z');
  });

  it('mantem o pai de dia inteiro alinhado ao dia', () => {
    const r = grownWindow(
      { ...janela('2026-10-01T00:00:00Z', '2026-10-10T00:00:00Z'), all_day: true },
      [janela('2026-10-02T00:00:00Z', '2026-10-15T15:47:00Z')],
    );
    const fim = r.due_date!;
    expect([fim.getHours(), fim.getMinutes()]).toEqual([23, 59]);
    const ini = r.start_date!;
    expect([ini.getHours(), ini.getMinutes()]).toEqual([0, 0]);
  });

  it('cobre a filha inteira mesmo depois do alinhamento ao dia', () => {
    const filha = janela('2026-10-02T09:00:00Z', '2026-10-15T15:47:00Z');
    const r = grownWindow(
      { ...janela('2026-10-03T00:00:00Z', '2026-10-10T00:00:00Z'), all_day: true },
      [filha],
    );
    expect(r.start_date!.getTime()).toBeLessThanOrEqual(filha.start_date!.getTime());
    expect(r.due_date!.getTime()).toBeGreaterThanOrEqual(filha.due_date!.getTime());
  });

  it('nao mexe em nada quando nenhuma filha tem data', () => {
    const r = grownWindow(pai, [janela(null, null)]);
    expect(r.changed).toBe(false);
  });
});

describe('as duas direcoes nao se contaminam', () => {
  /**
   * O risco real: aumentar UMA filha faz o pai crescer; se esse crescimento
   * disparasse a cascata de cima para baixo, TODAS as irmas seriam
   * reescaladas — o oposto do que quem arrastou pediu.
   */
  it('crescer o pai pelo envelope nao reposiciona as irmas', () => {
    const irmas = [
      janela('2026-10-02T00:00:00Z', '2026-10-04T00:00:00Z'),
      janela('2026-10-05T00:00:00Z', '2026-10-07T00:00:00Z'),
    ];
    const esticada = janela('2026-10-08T00:00:00Z', '2026-10-25T00:00:00Z');

    const r = grownWindow(janela('2026-10-01T00:00:00Z', '2026-10-10T00:00:00Z'), [
      ...irmas,
      esticada,
    ]);

    // grownWindow devolve SO a janela do pai: nao ha por onde alterar as irmas.
    expect(r.due_date?.toISOString()).toBe('2026-10-25T00:00:00.000Z');
    expect(Object.keys(r).sort()).toEqual(['changed', 'due_date', 'start_date']);
  });

  it('a cascata de cima para baixo continua reescalando quando e ela que roda', () => {
    const pai: TemporalNode = {
      id: 'p',
      title: 'p',
      start_date: d('2026-10-01T00:00:00Z'),
      due_date: d('2026-10-11T00:00:00Z'),
    };
    const plan = planReschedule(
      pai,
      { start_date: d('2026-10-01T00:00:00Z'), due_date: d('2026-10-06T00:00:00Z') },
      [{ id: 'a', title: 'a', ...janela('2026-10-03T00:00:00Z', '2026-10-05T00:00:00Z') }],
      null,
      true,
    );
    expect(plan.scale).toBeCloseTo(0.5);
    expect(plan.affected).toHaveLength(1);
  });
});

/**
 * Shift no arraste: muda so a janela do pai e deixa as filhas onde estao.
 * O piso e o mesmo `grownWindow` — encolher demais volta ao limite em vez de
 * ser recusado, entao a barra para em vez de dar erro.
 */
describe('trava do redimensionamento sem levar as filhas', () => {
  const filhas = [
    janela('2026-10-03T00:00:00Z', '2026-10-06T00:00:00Z'),
    janela('2026-10-05T00:00:00Z', '2026-10-09T00:00:00Z'),
  ];

  it('deixa encolher ate o fim da ultima filha', () => {
    const pedido = janela('2026-10-01T00:00:00Z', '2026-10-09T00:00:00Z');
    const r = grownWindow(pedido, filhas);
    expect(r.changed).toBe(false);
    expect(r.due_date?.toISOString()).toBe('2026-10-09T00:00:00.000Z');
  });

  it('para no limite quando o arraste passa do fim da ultima filha', () => {
    const pedido = janela('2026-10-01T00:00:00Z', '2026-10-04T00:00:00Z');
    const r = grownWindow(pedido, filhas);
    expect(r.changed).toBe(true);
    expect(r.due_date?.toISOString()).toBe('2026-10-09T00:00:00.000Z');
  });

  it('para no limite tambem pela borda esquerda', () => {
    const pedido = janela('2026-10-04T00:00:00Z', '2026-10-20T00:00:00Z');
    const r = grownWindow(pedido, filhas);
    expect(r.start_date?.toISOString()).toBe('2026-10-03T00:00:00.000Z');
  });

  it('cresce livremente para qualquer lado', () => {
    const pedido = janela('2026-09-01T00:00:00Z', '2026-12-01T00:00:00Z');
    const r = grownWindow(pedido, filhas);
    expect(r.changed).toBe(false);
    expect(r.start_date?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(r.due_date?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('sem filhas nao ha trava', () => {
    const pedido = janela('2026-10-04T00:00:00Z', '2026-10-05T00:00:00Z');
    const r = grownWindow(pedido, []);
    expect(r.changed).toBe(false);
    expect(r.due_date?.toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });

  it('a trava nao move nenhuma filha: so devolve a janela do pai', () => {
    const antes = filhas.map((f) => [f.start_date?.getTime(), f.due_date?.getTime()]);
    grownWindow(janela('2026-10-04T00:00:00Z', '2026-10-04T12:00:00Z'), filhas);
    const depois = filhas.map((f) => [f.start_date?.getTime(), f.due_date?.getTime()]);
    expect(depois).toEqual(antes);
  });
});
