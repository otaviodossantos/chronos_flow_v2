import { describe, it, expect } from 'vitest';
import {
  findCycle,
  blockedNodeIds,
  newlyUnblocked,
  topoSort,
  criticalPath,
} from '../../server/domain/dependencies.js';

const edges = [
  { blocker_id: 'a', blocked_id: 'b' },
  { blocker_id: 'b', blocked_id: 'c' },
];

describe('findCycle', () => {
  it('detecta ciclo indireto', () => {
    expect(findCycle(edges, 'c', 'a')).toEqual(['a', 'b', 'c', 'a']);
  });

  it('detecta auto-dependencia', () => {
    expect(findCycle(edges, 'a', 'a')).toEqual(['a', 'a']);
  });

  it('aceita aresta segura', () => {
    expect(findCycle(edges, 'a', 'c')).toBeNull();
  });
});

describe('blockedNodeIds', () => {
  it('bloqueia enquanto o bloqueador nao fecha', () => {
    const status = new Map([['a', 'PENDING'], ['b', 'PENDING'], ['c', 'PENDING']]);
    expect([...blockedNodeIds(edges, status)].sort()).toEqual(['b', 'c']);
  });

  it('libera quando o bloqueador fecha', () => {
    const status = new Map([['a', 'COMPLETED'], ['b', 'PENDING'], ['c', 'PENDING']]);
    expect([...blockedNodeIds(edges, status)]).toEqual(['c']);
  });
});

describe('newlyUnblocked', () => {
  it('lista quem ficou livre agora', () => {
    const status = new Map([['a', 'PENDING'], ['b', 'PENDING'], ['c', 'PENDING']]);
    expect(newlyUnblocked(edges, status, 'a')).toEqual(['b']);
  });

  it('nao libera quem ainda tem outro bloqueador', () => {
    const many = [...edges, { blocker_id: 'd', blocked_id: 'b' }];
    const status = new Map([
      ['a', 'PENDING'],
      ['b', 'PENDING'],
      ['c', 'PENDING'],
      ['d', 'PENDING'],
    ]);
    expect(newlyUnblocked(many, status, 'a')).toEqual([]);
  });
});

describe('topoSort', () => {
  it('ordena respeitando as arestas', () => {
    expect(topoSort(['c', 'b', 'a'], edges)).toEqual(['a', 'b', 'c']);
  });

  it('devolve null com ciclo', () => {
    const cyclic = [...edges, { blocker_id: 'c', blocked_id: 'a' }];
    expect(topoSort(['a', 'b', 'c'], cyclic)).toBeNull();
  });
});

describe('criticalPath', () => {
  it('escolhe a cadeia de maior esforco acumulado', () => {
    const nodes = [
      { id: 'a', title: 'A', status: 'PENDING', estimated_minutes: 60 },
      { id: 'b', title: 'B', status: 'PENDING', estimated_minutes: 600 },
      { id: 'c', title: 'C', status: 'PENDING', estimated_minutes: 60 },
      { id: 'x', title: 'X', status: 'PENDING', estimated_minutes: 10 },
    ];
    expect(criticalPath(nodes, edges)).toEqual(['a', 'b', 'c']);
  });
});
