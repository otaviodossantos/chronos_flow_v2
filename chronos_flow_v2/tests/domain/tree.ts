import { buildPath } from '../../server/domain/path.js';

export interface TestNode {
  id: string;
  parent_id: string | null;
  path: string;
  depth: number;
  weight: number;
  status: string;
  manual_progress: number | null;
}

/** Arvore sintetica: `breadth` filhos por no, ate `levels` niveis, pesos desiguais. */
export function buildTree(levels: number, breadth: number, uneven = true): TestNode[] {
  const nodes: TestNode[] = [];
  let counter = 0;

  const make = (parent: TestNode | null, depth: number) => {
    counter += 1;
    const id = `n${counter}`;
    const node: TestNode = {
      id,
      parent_id: parent?.id ?? null,
      path: buildPath(parent?.path ?? null, id),
      depth,
      weight: uneven ? 1 + (counter % 7) : 1,
      status: 'PENDING',
      manual_progress: null,
    };
    nodes.push(node);
    if (depth < levels - 1) {
      for (let i = 0; i < breadth; i += 1) make(node, depth + 1);
    }
  };

  make(null, 0);
  return nodes;
}

export function leavesOf(nodes: TestNode[]): TestNode[] {
  const parents = new Set(nodes.map((n) => n.parent_id).filter(Boolean) as string[]);
  return nodes.filter((n) => !parents.has(n.id));
}
