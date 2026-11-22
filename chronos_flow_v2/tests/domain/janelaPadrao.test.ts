import { describe, it, expect } from 'vitest';
import {
  proximoBloco,
  janelaPadrao,
  janelaDeCriacao,
  planReschedule,
  PASSO_BLOCO_MIN,
  DURACAO_PADRAO_MIN,
} from '../../server/domain/scheduling.js';

const em = (iso: string) => new Date(iso);
const minutosEntre = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60_000;

describe('proximoBloco', () => {
  it('sobe para a proxima marca de 15 minutos', () => {
    expect(proximoBloco(em('2026-09-29T10:07:00Z')).toISOString()).toBe(
      '2026-09-29T10:15:00.000Z',
    );
  });

  it('nao adianta quem ja esta na marca', () => {
    expect(proximoBloco(em('2026-09-29T10:30:00Z')).toISOString()).toBe(
      '2026-09-29T10:30:00.000Z',
    );
  });

  it('um segundo depois da marca ja pertence ao bloco seguinte', () => {
    expect(proximoBloco(em('2026-09-29T10:30:01Z')).toISOString()).toBe(
      '2026-09-29T10:45:00.000Z',
    );
  });

  it('vira a hora', () => {
    expect(proximoBloco(em('2026-09-29T10:52:00Z')).toISOString()).toBe(
      '2026-09-29T11:00:00.000Z',
    );
  });

  it('vira o dia', () => {
    expect(proximoBloco(em('2026-09-29T23:58:00Z')).toISOString()).toBe(
      '2026-09-30T00:00:00.000Z',
    );
  });

  it('o passo e configuravel', () => {
    expect(proximoBloco(em('2026-09-29T10:07:00Z'), 30).toISOString()).toBe(
      '2026-09-29T10:30:00.000Z',
    );
    expect(PASSO_BLOCO_MIN).toBe(15);
  });
});

describe('janelaPadrao', () => {
  const agora = em('2026-09-29T10:07:00Z');

  it('sem pai: proximo bloco de 15 min e uma hora de duracao', () => {
    const j = janelaPadrao(agora, null);
    expect(j.start_date.toISOString()).toBe('2026-09-29T10:15:00.000Z');
    expect(minutosEntre(j.start_date, j.due_date)).toBe(DURACAO_PADRAO_MIN);
  });

  it('a estimativa da tarefa manda na duracao', () => {
    const j = janelaPadrao(agora, null, 30);
    expect(minutosEntre(j.start_date, j.due_date)).toBe(30);
  });

  it('estimativa invalida cai na hora cheia', () => {
    expect(minutosEntre(...duracao(janelaPadrao(agora, null, 0)))).toBe(60);
    expect(minutosEntre(...duracao(janelaPadrao(agora, null, null)))).toBe(60);
  });

  it('pai que so comeca no futuro ancora a filha nele', () => {
    const pai = { start_date: em('2026-10-05T14:00:00Z') };
    const j = janelaPadrao(agora, pai);
    expect(j.start_date.toISOString()).toBe('2026-10-05T14:00:00.000Z');
  });

  it('ancora no pai tambem e encaixada na marca de 15 min', () => {
    const pai = { start_date: em('2026-10-05T14:03:00Z') };
    expect(janelaPadrao(agora, pai).start_date.toISOString()).toBe(
      '2026-10-05T14:15:00.000Z',
    );
  });

  it('pai ja em andamento nao puxa a filha para tras', () => {
    const pai = { start_date: em('2026-01-01T00:00:00Z') };
    const j = janelaPadrao(agora, pai);
    expect(j.start_date.toISOString()).toBe('2026-09-29T10:15:00.000Z');
  });

  it('pai sem data nenhuma se comporta como ausencia de pai', () => {
    const j = janelaPadrao(agora, { start_date: null });
    expect(j.start_date.toISOString()).toBe('2026-09-29T10:15:00.000Z');
  });

  it('a janela nunca nasce invertida nem com largura zero', () => {
    for (const est of [null, 1, 15, 60, 480]) {
      const j = janelaPadrao(agora, null, est);
      expect(j.due_date.getTime()).toBeGreaterThan(j.start_date.getTime());
    }
  });
});

function duracao(j: { start_date: Date; due_date: Date }): [Date, Date] {
  return [j.start_date, j.due_date];
}

describe('janelaDeCriacao', () => {
  const agora = em('2026-09-29T10:07:00Z');
  const pai = {
    start_date: em('2026-01-10T00:00:00Z'),
    due_date: em('2026-12-31T00:00:00Z'),
  };

  it('pedido sem data nenhuma ganha o bloco padrao, nao a janela do pai', () => {
    const j = janelaDeCriacao({ start_date: null, due_date: null }, pai, { agora });
    expect(j.start_date!.toISOString()).toBe('2026-09-29T10:15:00.000Z');
    expect(minutosEntre(j.start_date!, j.due_date!)).toBe(60);
  });

  it('a estimativa do pedido define a duracao do bloco', () => {
    const j = janelaDeCriacao({ start_date: null, due_date: null }, null, {
      agora,
      estimatedMinutes: 45,
    });
    expect(minutosEntre(j.start_date!, j.due_date!)).toBe(45);
  });

  it('com inicio pedido, o fim ainda vem do pai — heranca intacta', () => {
    const inicio = em('2026-03-01T08:00:00Z');
    const j = janelaDeCriacao({ start_date: inicio, due_date: null }, pai, { agora });
    expect(j.start_date).toBe(inicio);
    expect(j.due_date).toBe(pai.due_date);
  });

  it('com fim pedido, o inicio vem do pai', () => {
    const fim = em('2026-03-10T18:00:00Z');
    const j = janelaDeCriacao({ start_date: null, due_date: fim }, pai, { agora });
    expect(j.start_date).toBe(pai.start_date);
    expect(j.due_date).toBe(fim);
  });

  it('pedido completo passa inteiro', () => {
    const a = em('2026-04-01T09:00:00Z');
    const z = em('2026-04-01T11:00:00Z');
    const j = janelaDeCriacao({ start_date: a, due_date: z }, pai, { agora });
    expect(j).toEqual({ start_date: a, due_date: z });
  });

  it('sem pai e sem pedido, ainda assim nasce com data', () => {
    const j = janelaDeCriacao({ start_date: null, due_date: null }, null, { agora });
    expect(j.start_date).not.toBeNull();
    expect(j.due_date).not.toBeNull();
  });
});

describe('planReschedule e a janela do pai', () => {
  const pai = {
    id: 'p', title: 'Projeto',
    start_date: em('2026-09-01T09:00:00Z'),
    due_date: em('2026-09-01T18:00:00Z'),
  };
  const tarefa = {
    id: 't', title: 'Tarefa',
    start_date: em('2026-09-01T09:00:00Z'),
    due_date: em('2026-09-01T10:00:00Z'),
  };
  // Arrastada para depois do fim do pai.
  const fora = { start_date: em('2026-09-01T20:00:00Z'), due_date: em('2026-09-01T21:00:00Z') };

  it('sair da janela do pai nao e conflito: o pai cresce em seguida', () => {
    const plan = planReschedule(tarefa, fora, [], pai, true);
    expect(plan.violations).toHaveLength(0);
  });

  it('inicio depois do fim continua sendo conflito', () => {
    const invertida = { start_date: em('2026-09-01T12:00:00Z'), due_date: em('2026-09-01T11:00:00Z') };
    const plan = planReschedule(tarefa, invertida, [], pai, true);
    expect(plan.violations).toHaveLength(1);
    expect(plan.violations[0].violations[0].code).toBe('START_AFTER_DUE');
  });

  it('comecar antes do pai tambem nao e conflito', () => {
    const antes = { start_date: em('2026-08-20T09:00:00Z'), due_date: em('2026-08-20T10:00:00Z') };
    expect(planReschedule(tarefa, antes, [], pai, true).violations).toHaveLength(0);
  });

  it('quem nao cresce ancestrais ainda ve o estouro da janela do pai', () => {
    const plan = planReschedule(tarefa, fora, [], pai, true, { ancestraisCrescem: false });
    expect(plan.violations[0].violations[0].code).toBe('DUE_AFTER_PARENT');
  });

  it('filha que estoura a nova janela continua sendo acusada', () => {
    const filha = {
      id: 'f', title: 'Filha',
      start_date: em('2026-09-01T09:00:00Z'),
      due_date: em('2026-09-01T17:00:00Z'),
    };
    const encolher = { start_date: em('2026-09-01T09:00:00Z'), due_date: em('2026-09-01T10:00:00Z') };
    const plan = planReschedule(pai, encolher, [filha], null, false);
    expect(plan.violations.some((v) => v.id === 'f')).toBe(true);
  });
});
