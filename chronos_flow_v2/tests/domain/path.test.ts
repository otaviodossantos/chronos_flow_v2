import { describe, it, expect } from 'vitest';
import {
  buildPath,
  ancestorIds,
  ancestorIdsBottomUp,
  rootIdOf,
  depthOf,
  subtreePrefix,
  isDescendantOf,
  hasCycle,
  rebasePath,
} from '../../server/domain/path.js';

describe('materialized path', () => {
  const path = buildPath(buildPath('r', 'a'), 'b');

  it('monta o caminho incluindo o proprio id', () => {
    expect(path).toBe('r/a/b');
  });

  it('da os ancestrais sem query', () => {
    expect(ancestorIds(path)).toEqual(['r', 'a']);
    expect(ancestorIdsBottomUp(path)).toEqual(['a', 'r']);
  });

  it('da raiz e profundidade', () => {
    expect(rootIdOf(path)).toBe('r');
    expect(depthOf(path)).toBe(2);
    expect(depthOf('r')).toBe(0);
  });

  it('monta o prefixo de subarvore', () => {
    expect(subtreePrefix('r/a')).toBe('r/a/%');
    expect(isDescendantOf('r/a/b', 'r/a')).toBe(true);
    expect(isDescendantOf('r/a', 'r/a')).toBe(false);
  });

  it('denuncia id repetido no proprio caminho', () => {
    expect(hasCycle('r/a/r')).toBe(true);
    expect(hasCycle(path)).toBe(false);
  });

  it('reescreve o caminho ao mover a subarvore', () => {
    expect(rebasePath('r/a/b', 'r/a', 'z/q')).toBe('z/q/b');
    expect(rebasePath('r/a', 'r/a', 'z/q')).toBe('z/q');
    expect(rebasePath('r/x', 'r/a', 'z/q')).toBe('r/x');
  });
});
