import { describe, it, expect } from 'vitest';
import {
  weightedProgress,
  leafProgress,
  canComplete,
  recomputeTree,
  weightFromEstimate,
  statusAfterReopen,
} from '../../server/domain/cascade.js';
import { buildTree, leavesOf } from './tree.js';

describe('weightedProgress', () => {
  it('pondera pelo peso dos irmaos', () => {
    expect(
      weightedProgress([
        { weight: 3, progress: 100, status: 'COMPLETED' },
        { weight: 1, progress: 0, status: 'PENDING' },
      ]),
    ).toBe(75);
  });

  it('ignora filhos cancelados por completo', () => {
    expect(
      weightedProgress([
        { weight: 1, progress: 100, status: 'COMPLETED' },
        { weight: 9, progress: 0, status: 'CANCELLED' },
      ]),
    ).toBe(100);
  });

  it('cai para media simples quando todos os pesos sao zero', () => {
    expect(
      weightedProgress([
        { weight: 0, progress: 100, status: 'COMPLETED' },
        { weight: 0, progress: 0, status: 'PENDING' },
      ]),
    ).toBe(50);
  });

  it('nao quebra sem filhos vivos', () => {
    expect(weightedProgress([])).toBe(0);
    expect(weightedProgress([{ weight: 1, progress: 50, status: 'CANCELLED' }])).toBe(0);
  });
});

describe('leafProgress', () => {
  it('concluida vale 100 mesmo com manual menor', () => {
    expect(leafProgress({ status: 'COMPLETED', manual_progress: 40 })).toBe(100);
  });

  it('usa o manual quando existe', () => {
    expect(leafProgress({ status: 'IN_PROGRESS', manual_progress: 40 })).toBe(40);
  });

  it('vale 0 sem manual', () => {
    expect(leafProgress({ status: 'PENDING', manual_progress: null })).toBe(0);
  });
});

describe('canComplete', () => {
  it('recusa pai com filho pendente', () => {
    expect(canComplete([{ status: 'COMPLETED' }, { status: 'PENDING' }])).toBe(false);
  });

  it('aceita quando todos fecharam ou foram cancelados', () => {
    expect(canComplete([{ status: 'COMPLETED' }, { status: 'CANCELLED' }])).toBe(true);
  });
});

describe('cascata em arvore de 7 niveis', () => {
  const nodes = buildTree(7, 2);
  const leaves = leavesOf(nodes);

  it('raiz comeca em 0 e termina em 100', () => {
    const zeroed = recomputeTree(nodes);
    expect(zeroed.get('n1')).toBe(0);

    const allDone = nodes.map((n) => ({ ...n, status: 'COMPLETED' }));
    expect(recomputeTree(allDone).get('n1')).toBe(100);
  });

  it('a raiz sobe monotonicamente conforme folhas fecham', () => {
    const state = nodes.map((n) => ({ ...n }));
    const byId = new Map(state.map((n) => [n.id, n]));
    let previous = -1;

    for (const leaf of leaves) {
      byId.get(leaf.id)!.status = 'COMPLETED';
      const root = recomputeTree(state).get('n1')!;
      expect(root).toBeGreaterThanOrEqual(previous);
      previous = root;
    }
    expect(previous).toBe(100);
  });

  it('meia arvore concluida nunca passa de 100', () => {
    const half = nodes.map((n, i) => ({ ...n, status: i % 2 === 0 ? 'COMPLETED' : 'PENDING' }));
    const root = recomputeTree(half).get('n1')!;
    expect(root).toBeGreaterThanOrEqual(0);
    expect(root).toBeLessThanOrEqual(100);
  });
});

describe('weightFromEstimate', () => {
  it('usa o esforco estimado como peso', () => {
    expect(weightFromEstimate(360)).toBe(360);
  });

  it('cai para 1 sem estimativa', () => {
    expect(weightFromEstimate(null)).toBe(1);
    expect(weightFromEstimate(0)).toBe(1);
  });
});

describe('statusAfterReopen', () => {
  it('volta para pendente quando nao ha nada feito', () => {
    expect(statusAfterReopen(0)).toBe('PENDING');
  });

  it('volta para em andamento quando ja ha progresso', () => {
    expect(statusAfterReopen(0.5)).toBe('IN_PROGRESS');
    expect(statusAfterReopen(62.5)).toBe('IN_PROGRESS');
    expect(statusAfterReopen(100)).toBe('IN_PROGRESS');
  });

  it('ignora o progresso quando a tarefa estava cancelada', () => {
    expect(statusAfterReopen(80, true)).toBe('PENDING');
  });
});
