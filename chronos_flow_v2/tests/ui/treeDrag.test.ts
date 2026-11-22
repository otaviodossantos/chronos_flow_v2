import { describe, it, expect } from 'vitest';
import {
  dropWhereFor,
  resolveMove,
  canDrop,
} from '../../src/features/timeline/treeDrag.js';
import type { FlatRow } from '../../src/features/timeline/useVisibleNodes.js';

const node = (id: string, parent: string | null, path: string, position: number) =>
  ({ id, parent_id: parent, path, position, depth: path.split('/').length - 1 }) as never;

const row = (n: unknown): FlatRow =>
  ({ node: n, index: 0, hasChildren: false, isExpanded: false }) as FlatRow;

/**
 *  r1
 *   ├ a  (r1/a)
 *   │  └ a1 (r1/a/a1)
 *   └ b  (r1/b)
 *  r2
 */
const r1 = node('r1', null, 'r1', 0);
const a = node('a', 'r1', 'r1/a', 0);
const a1 = node('a1', 'a', 'r1/a/a1', 0);
const bNode = node('b', 'r1', 'r1/b', 1);
const r2 = node('r2', null, 'r2', 1);
const rows = [r1, a, a1, bNode, r2].map(row);

const rect = (top: number, height: number) => ({ top, height }) as DOMRect;

describe('dropWhereFor', () => {
  it('separa a linha em irma-acima, filha e irma-abaixo', () => {
    expect(dropWhereFor({ clientY: 2 }, rect(0, 40))).toBe('before');
    expect(dropWhereFor({ clientY: 20 }, rect(0, 40))).toBe('inside');
    expect(dropWhereFor({ clientY: 38 }, rect(0, 40))).toBe('after');
  });

  it('respeita o deslocamento da linha na tela', () => {
    expect(dropWhereFor({ clientY: 202 }, rect(200, 40))).toBe('before');
    expect(dropWhereFor({ clientY: 238 }, rect(200, 40))).toBe('after');
  });
});

describe('canDrop', () => {
  it('recusa soltar a tarefa sobre ela mesma', () => {
    expect(canDrop(a, a, 'inside')).toBe(false);
  });

  it('recusa soltar dentro da propria subarvore', () => {
    expect(canDrop(a, a1, 'inside')).toBe(false);
    expect(canDrop(a, a1, 'before')).toBe(false);
  });

  it('recusa aninhar em quem ja e o pai', () => {
    expect(canDrop(a, r1, 'inside')).toBe(false);
  });

  it('aceita reordenar entre irmas do pai atual', () => {
    expect(canDrop(a, bNode, 'after')).toBe(true);
  });

  it('aceita mudar de ramo', () => {
    expect(canDrop(a, r2, 'inside')).toBe(true);
  });

  it('so promove a raiz quem ainda nao e raiz', () => {
    expect(canDrop(a, null, 'inside')).toBe(true);
    expect(canDrop(r1, null, 'inside')).toBe(false);
  });
});

describe('resolveMove', () => {
  it('aninha sem posicao: o servidor anexa no fim', () => {
    expect(resolveMove({ id: 'r2', where: 'inside' }, a, rows)).toEqual({ parent_id: 'r2' });
  });

  it('conta a posicao na lista ja sem a tarefa arrastada', () => {
    // "a" antes de "b", com "a" fora da fila: "b" e o indice 0.
    expect(resolveMove({ id: 'b', where: 'before' }, a, rows)).toEqual({
      parent_id: 'r1',
      position: 0,
    });
    expect(resolveMove({ id: 'b', where: 'after' }, a, rows)).toEqual({
      parent_id: 'r1',
      position: 1,
    });
  });

  it('herda o pai do alvo ao cair na borda, nao o proprio alvo', () => {
    expect(resolveMove({ id: 'a1', where: 'after' }, bNode, rows)).toEqual({
      parent_id: 'a',
      position: 1,
    });
  });

  it('promove a raiz no fim da lista de raizes', () => {
    // r1 e r2 sao raizes; "a" nao e. Entra depois das duas.
    expect(resolveMove({ id: null, where: 'inside' }, a, rows)).toEqual({
      parent_id: null,
      position: 2,
    });
  });

  it('ignora um alvo que saiu da tela', () => {
    expect(resolveMove({ id: 'sumiu', where: 'inside' }, a, rows)).toBeNull();
  });
});
