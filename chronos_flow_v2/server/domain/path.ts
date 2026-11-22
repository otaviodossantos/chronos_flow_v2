/**
 * Materialized path: "raizId/n1Id/n2Id" — inclui o proprio id no fim.
 * Dai saem ancestrais, profundidade e prefixo de subarvore sem nenhuma query.
 */
export const PATH_SEP = '/';

export function buildPath(parentPath: string | null, id: string): string {
  return parentPath ? `${parentPath}${PATH_SEP}${id}` : id;
}

export function pathSegments(path: string): string[] {
  return path ? path.split(PATH_SEP).filter(Boolean) : [];
}

/** Ancestrais da raiz ate o pai, sem incluir o proprio no. */
export function ancestorIds(path: string): string[] {
  return pathSegments(path).slice(0, -1);
}

/** Ancestrais do pai ate a raiz — a ordem em que a cascata sobe. */
export function ancestorIdsBottomUp(path: string): string[] {
  return ancestorIds(path).reverse();
}

export function rootIdOf(path: string): string | null {
  return pathSegments(path)[0] ?? null;
}

export function depthOf(path: string): number {
  return Math.max(0, pathSegments(path).length - 1);
}

export function selfIdOf(path: string): string | null {
  return pathSegments(path).at(-1) ?? null;
}

/** Prefixo usado em "WHERE path LIKE :prefix" para pegar a subarvore inteira. */
export function subtreePrefix(path: string): string {
  return `${path}${PATH_SEP}%`;
}

export function isDescendantOf(path: string, ancestorPath: string): boolean {
  return path.startsWith(`${ancestorPath}${PATH_SEP}`);
}

/** Um id repetido no proprio path denuncia arvore corrompida. */
export function hasCycle(path: string): boolean {
  const segs = pathSegments(path);
  return new Set(segs).size !== segs.length;
}

/** Reescreve o path de um descendente quando a subarvore inteira e movida. */
export function rebasePath(path: string, oldPrefix: string, newPrefix: string): string {
  if (path === oldPrefix) return newPrefix;
  if (!isDescendantOf(path, oldPrefix)) return path;
  return newPrefix + path.slice(oldPrefix.length);
}
