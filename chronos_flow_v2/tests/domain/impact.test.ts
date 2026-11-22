import { describe, it, expect } from 'vitest';
import {
  contributionMap,
  urgencyFromDeadline,
  rootCriticality,
  focusScore,
  projectProgress,
} from '../../server/domain/impact.js';
import { buildTree, leavesOf } from './tree.js';

describe('contributionMap', () => {
  it('a raiz vale 1', () => {
    const nodes = buildTree(4, 3);
    expect(contributionMap(nodes).get('n1')).toBeCloseTo(1, 10);
  });

  it('a soma das folhas de uma raiz e exatamente 1', () => {
    const nodes = buildTree(7, 2);
    const contrib = contributionMap(nodes);
    const total = leavesOf(nodes).reduce((sum, l) => sum + (contrib.get(l.id) ?? 0), 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('respeita pesos desiguais entre irmaos', () => {
    const nodes = [
      { id: 'r', parent_id: null, weight: 1, status: 'PENDING' },
      { id: 'a', parent_id: 'r', weight: 3, status: 'PENDING' },
      { id: 'b', parent_id: 'r', weight: 1, status: 'PENDING' },
    ];
    const contrib = contributionMap(nodes);
    expect(contrib.get('a')).toBeCloseTo(0.75, 10);
    expect(contrib.get('b')).toBeCloseTo(0.25, 10);
  });

  it('tira filhos cancelados da divisao', () => {
    const nodes = [
      { id: 'r', parent_id: null, weight: 1, status: 'PENDING' },
      { id: 'a', parent_id: 'r', weight: 1, status: 'PENDING' },
      { id: 'b', parent_id: 'r', weight: 1, status: 'CANCELLED' },
    ];
    expect(contributionMap(nodes).get('a')).toBeCloseTo(1, 10);
  });
});

describe('urgencyFromDeadline', () => {
  const today = new Date('2026-09-28T12:00:00Z');

  it('vencido ou hoje e 5', () => {
    expect(urgencyFromDeadline(new Date('2026-09-20T00:00:00Z'), today)).toBe(5);
  });

  it('cai conforme o prazo se afasta', () => {
    expect(urgencyFromDeadline(new Date('2026-10-26T00:00:00Z'), today)).toBeLessThan(
      urgencyFromDeadline(new Date('2026-10-02T00:00:00Z'), today),
    );
  });

  it('sem prazo e 1', () => {
    expect(urgencyFromDeadline(null, today)).toBe(1);
  });
});

describe('focusScore', () => {
  const today = new Date('2026-09-28T12:00:00Z');

  it('bloqueado zera o score', () => {
    const score = focusScore(
      { contribution: 0.5, rootCriticality: 25, isBlocked: true, dueDate: null },
      today,
    );
    expect(score).toBe(0);
  });

  it('ordena por contribuicao quando a criticidade empata', () => {
    const base = { rootCriticality: 20, isBlocked: false, dueDate: null };
    const alto = focusScore({ ...base, contribution: 0.4 }, today);
    const baixo = focusScore({ ...base, contribution: 0.1 }, today);
    expect(alto).toBeGreaterThan(baixo);
  });

  it('atrasada ganha peso extra', () => {
    const atrasada = focusScore(
      { contribution: 0.2, rootCriticality: 10, isBlocked: false, dueDate: new Date('2026-09-01') },
      today,
    );
    const futura = focusScore(
      { contribution: 0.2, rootCriticality: 10, isBlocked: false, dueDate: new Date('2026-12-01') },
      today,
    );
    expect(atrasada).toBeGreaterThan(futura);
  });
});

describe('rootCriticality', () => {
  it('escala de 1 a 25', () => {
    const today = new Date('2026-09-28T12:00:00Z');
    expect(rootCriticality(5, new Date('2026-09-28'), today)).toBe(25);
    expect(rootCriticality(1, null, today)).toBe(1);
  });
});

describe('projectProgress', () => {
  it('projeta o ganho das folhas selecionadas', () => {
    expect(projectProgress(68, [{ contribution: 0.042, progress: 0 }])).toBe(72.2);
  });

  it('nao passa de 100', () => {
    expect(projectProgress(99, [{ contribution: 0.5, progress: 0 }])).toBe(100);
  });

  it('folha ja concluida nao adiciona nada', () => {
    expect(projectProgress(40, [{ contribution: 0.3, progress: 100 }])).toBe(40);
  });
});
