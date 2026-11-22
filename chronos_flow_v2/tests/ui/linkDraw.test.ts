import { describe, it, expect } from 'vitest';
import {
  resolveLink,
  canLink,
  anchorAt,
  linkPath,
} from '../../src/features/timeline/linkDraw.js';

const no = (id: string, path: string, extra: Record<string, unknown> = {}) =>
  ({ id, path, blocks: [], blockedBy: [], ...extra }) as never;

/**
 *  r1
 *   ├ a  (r1/a)
 *   │  └ a1 (r1/a/a1)
 *   └ b  (r1/b)
 */
const r1 = no('r1', 'r1');
const a = no('a', 'r1/a');
const a1 = no('a1', 'r1/a/a1');
const bNode = no('b', 'r1/b');

describe('resolveLink', () => {
  it('puxar da ponta direita: a origem bloqueia o alvo', () => {
    expect(resolveLink('a', 'end', 'b')).toEqual({ blocker_id: 'a', blocked_id: 'b' });
  });

  it('puxar da ponta esquerda inverte: o alvo bloqueia a origem', () => {
    expect(resolveLink('a', 'start', 'b')).toEqual({ blocker_id: 'b', blocked_id: 'a' });
  });

  it('os dois lados sao inversos exatos um do outro', () => {
    const direita = resolveLink('a', 'end', 'b');
    const esquerda = resolveLink('a', 'start', 'b');
    expect(direita.blocker_id).toBe(esquerda.blocked_id);
    expect(direita.blocked_id).toBe(esquerda.blocker_id);
  });
});

describe('canLink', () => {
  it('aceita duas tarefas de ramos diferentes', () => {
    expect(canLink(a, bNode).ok).toBe(true);
  });

  it('recusa ligar a tarefa nela mesma', () => {
    const r = canLink(a, a);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('ela mesma');
  });

  it('recusa descendente', () => {
    const r = canLink(a, a1);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('descendente');
  });

  it('recusa ancestral', () => {
    expect(canLink(a1, a).ok).toBe(false);
    expect(canLink(a, r1).ok).toBe(false);
  });

  it('recusa vinculo que ja existe, nos dois sentidos', () => {
    const comSaida = no('a', 'r1/a', { blocks: ['b'] });
    expect(canLink(comSaida, bNode).reason).toContain('Ja existe');

    const comEntrada = no('a', 'r1/a', { blockedBy: ['b'] });
    expect(canLink(comEntrada, bNode).reason).toContain('Ja existe');
  });

  it('sem alvo nao ha recusa a explicar', () => {
    const r = canLink(a, null);
    expect(r.ok).toBe(false);
    expect(r.reason).toBeUndefined();
  });

  it('nao tenta adivinhar ciclo indireto: isso e do servidor', () => {
    // a -> b ja existe em outro lugar do grafo; daqui b -> a parece valido.
    expect(canLink(bNode, a).ok).toBe(true);
  });
});

describe('anchorAt', () => {
  it('ancora esquerda na borda de inicio, centrada na linha', () => {
    expect(anchorAt(100, 60, 2, 40, 'start')).toEqual({ x: 100, y: 100 });
  });

  it('ancora direita na borda de fim', () => {
    expect(anchorAt(100, 60, 2, 40, 'end')).toEqual({ x: 160, y: 100 });
  });
});

describe('linkPath', () => {
  it('sai para a direita quando o fio parte da ponta de fim', () => {
    const d = linkPath({ x: 100, y: 20 }, { x: 300, y: 80 }, 'end');
    const primeiroControle = Number(d.split('C ')[1].split(' ')[0]);
    expect(primeiroControle).toBeGreaterThan(100);
  });

  it('sai para a esquerda quando parte da ponta de inicio', () => {
    const d = linkPath({ x: 300, y: 20 }, { x: 100, y: 80 }, 'start');
    const primeiroControle = Number(d.split('C ')[1].split(' ')[0]);
    expect(primeiroControle).toBeLessThan(300);
  });

  it('mantem uma curvatura minima mesmo com as pontas coladas', () => {
    const d = linkPath({ x: 100, y: 20 }, { x: 104, y: 20 }, 'end');
    const primeiroControle = Number(d.split('C ')[1].split(' ')[0]);
    expect(primeiroControle - 100).toBeGreaterThanOrEqual(28);
  });

  it('nao deixa a curva explodir em distancias grandes', () => {
    const d = linkPath({ x: 0, y: 0 }, { x: 4000, y: 0 }, 'end');
    const primeiroControle = Number(d.split('C ')[1].split(' ')[0]);
    expect(primeiroControle).toBeLessThanOrEqual(120);
  });
});
