/** Grafo de dependencias: ciclo, status derivado e caminho critico. Puro. */

export interface Edge {
  blocker_id: string;
  blocked_id: string;
  lag_days?: number;
}

export interface GraphNode {
  id: string;
  title: string;
  status: string;
  estimated_minutes?: number | null;
}

/** Caminho do ciclo que a nova aresta criaria, ou null se nao houver. */
export function findCycle(edges: Edge[], blockerId: string, blockedId: string): string[] | null {
  if (blockerId === blockedId) return [blockerId, blockedId];

  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.blocker_id) ?? [];
    list.push(e.blocked_id);
    adj.set(e.blocker_id, list);
  }

  // A aresta nova vai de blocker para blocked. Ha ciclo se blocked ja alcanca blocker.
  const stack: Array<{ id: string; trail: string[] }> = [{ id: blockedId, trail: [blockedId] }];
  const seen = new Set<string>();

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.id === blockerId) return [...current.trail, blockedId];
    if (seen.has(current.id)) continue;
    seen.add(current.id);
    for (const next of adj.get(current.id) ?? []) {
      stack.push({ id: next, trail: [...current.trail, next] });
    }
  }
  return null;
}

/** BLOCKED nunca e digitado: um no esta bloqueado enquanto algum bloqueador nao fechou. */
export function blockedNodeIds(edges: Edge[], statusById: Map<string, string>): Set<string> {
  const blocked = new Set<string>();
  for (const e of edges) {
    const blockerStatus = statusById.get(e.blocker_id);
    if (blockerStatus && blockerStatus !== 'COMPLETED' && blockerStatus !== 'CANCELLED') {
      blocked.add(e.blocked_id);
    }
  }
  return blocked;
}

/** Nos que passam a ficar livres quando `completedId` fecha. */
export function newlyUnblocked(
  edges: Edge[],
  statusById: Map<string, string>,
  completedId: string,
): string[] {
  const candidates = edges.filter((e) => e.blocker_id === completedId).map((e) => e.blocked_id);
  const after = new Map(statusById);
  after.set(completedId, 'COMPLETED');
  const stillBlocked = blockedNodeIds(edges, after);
  return [...new Set(candidates)].filter((id) => !stillBlocked.has(id));
}

/** Ordem topologica; devolve null se o grafo tiver ciclo. */
export function topoSort(nodeIds: string[], edges: Edge[]): string[] | null {
  const indegree = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  const adj = new Map<string, string[]>();

  for (const e of edges) {
    if (!indegree.has(e.blocker_id) || !indegree.has(e.blocked_id)) continue;
    indegree.set(e.blocked_id, (indegree.get(e.blocked_id) ?? 0) + 1);
    const list = adj.get(e.blocker_id) ?? [];
    list.push(e.blocked_id);
    adj.set(e.blocker_id, list);
  }

  const queue = nodeIds.filter((id) => (indegree.get(id) ?? 0) === 0);
  const out: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    out.push(id);
    for (const next of adj.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  return out.length === nodeIds.length ? out : null;
}

/** Maior cadeia de dependencias por esforco acumulado. */
export function criticalPath(nodes: GraphNode[], edges: Edge[]): string[] {
  const order = topoSort(nodes.map((n) => n.id), edges);
  if (!order) return [];

  const cost = new Map(nodes.map((n) => [n.id, Math.max(1, n.estimated_minutes ?? 60)]));
  const best = new Map<string, number>();
  const from = new Map<string, string | null>();

  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    const list = incoming.get(e.blocked_id) ?? [];
    list.push(e.blocker_id);
    incoming.set(e.blocked_id, list);
  }

  for (const id of order) {
    let bestPrev: string | null = null;
    let bestValue = 0;
    for (const prev of incoming.get(id) ?? []) {
      const value = best.get(prev) ?? 0;
      if (value > bestValue) {
        bestValue = value;
        bestPrev = prev;
      }
    }
    best.set(id, bestValue + (cost.get(id) ?? 0));
    from.set(id, bestPrev);
  }

  let tail: string | null = null;
  let max = -1;
  for (const [id, value] of best) {
    if (value > max) {
      max = value;
      tail = id;
    }
  }

  const path: string[] = [];
  while (tail) {
    path.unshift(tail);
    tail = from.get(tail) ?? null;
  }
  return path;
}
