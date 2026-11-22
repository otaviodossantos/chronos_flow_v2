import { describe, it, expect } from 'vitest';
import { compactRows } from '../../src/features/timeline/useVisibleNodes.js';
import type { FlatRow } from '../../src/features/timeline/useVisibleNodes.js';

interface Cru {
  id: string;
  parent_id: string | null;
  path: string;
  title: string;
  position?: number;
  isLeaf?: boolean;
}

const no = (c: Cru) =>
  ({ position: 0, isLeaf: true, ...c }) as never;

/** Monta o mapa pai -> filhas como o hook faz antes de chamar compactRows. */
const agrupar = (nodes: unknown[]) => {
  const byParent = new Map<string, never[]>();
  for (const n of nodes as Array<{ parent_id: string | null }>) {
    const key = n.parent_id ?? '__root__';
    const list = byParent.get(key) ?? [];
    list.push(n as never);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) {
    (list as Array<{ position: number }>).sort((a, b) => a.position - b.position);
  }
  return byParent;
};

const run = (nodes: unknown[]): FlatRow[] =>
  compactRows(nodes as never[], agrupar(nodes) as never);

/**
 *  Plataforma (N0)
 *   └ Engine (N1)
 *      └ Modelagem (N2)
 *         ├ Render (folha)
 *         └ Colisao (folha)
 *      └ Testes (N2)
 *         └ Cache (folha)
 */
const arvore = [
  no({ id: 'p', parent_id: null, path: 'p', title: 'Plataforma', isLeaf: false }),
  no({ id: 'e', parent_id: 'p', path: 'p/e', title: 'Engine', isLeaf: false }),
  no({ id: 'm', parent_id: 'e', path: 'p/e/m', title: 'Modelagem', position: 0, isLeaf: false }),
  no({ id: 'r', parent_id: 'm', path: 'p/e/m/r', title: 'Render', position: 0 }),
  no({ id: 'c', parent_id: 'm', path: 'p/e/m/c', title: 'Colisao', position: 1 }),
  no({ id: 't', parent_id: 'e', path: 'p/e/t', title: 'Testes', position: 1, isLeaf: false }),
  no({ id: 'k', parent_id: 't', path: 'p/e/t/k', title: 'Cache', position: 0 }),
];

describe('compactRows', () => {
  it('troca a arvore inteira por grupo + folhas', () => {
    const rows = run(arvore);
    expect(rows.map((r) => r.node.id)).toEqual(['m', 'r', 'c', 't', 'k']);
    // 7 nos viram 5 linhas: os niveis 'p' e 'e' saem da lista.
    expect(rows).toHaveLength(5);
  });

  it('nao mostra nenhum no intermediario como linha propria', () => {
    const rows = run(arvore);
    expect(rows.some((r) => r.node.id === 'p')).toBe(false);
    expect(rows.some((r) => r.node.id === 'e')).toBe(false);
  });

  it('o cabecalho carrega o caminho ate ele, sem o proprio nome', () => {
    const grupo = run(arvore).find((r) => r.node.id === 'm')!;
    expect(grupo.isGroup).toBe(true);
    expect(grupo.crumbs).toEqual(['Plataforma', 'Engine']);
  });

  it('as folhas nao repetem o rastro do grupo acima delas', () => {
    const folha = run(arvore).find((r) => r.node.id === 'r')!;
    expect(folha.isGroup).toBeFalsy();
    expect(folha.crumbs).toEqual([]);
  });

  it('recua as folhas um nivel sob o cabecalho', () => {
    const rows = run(arvore);
    expect(rows.find((r) => r.node.id === 'm')!.indent).toBe(0);
    expect(rows.find((r) => r.node.id === 'r')!.indent).toBe(1);
  });

  it('emite o cabecalho uma vez so, por mais folhas que o grupo tenha', () => {
    const rows = run(arvore);
    expect(rows.filter((r) => r.node.id === 'm')).toHaveLength(1);
  });

  it('preserva a ordem dos irmaos', () => {
    const rows = run(arvore);
    const ids = rows.map((r) => r.node.id);
    expect(ids.indexOf('r')).toBeLessThan(ids.indexOf('c'));
    expect(ids.indexOf('m')).toBeLessThan(ids.indexOf('t'));
  });

  it('folha solta na raiz aparece sem cabecalho, com o proprio rastro', () => {
    const rows = run([no({ id: 'x', parent_id: null, path: 'x', title: 'Avulsa' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].isGroup).toBeFalsy();
    expect(rows[0].indent).toBe(0);
    expect(rows[0].crumbs).toEqual([]);
  });

  it('ramo sem nenhuma folha nao gera linha alguma', () => {
    // 'vazio' diz que tem filhas mas nenhuma esta carregada.
    const rows = run([
      no({ id: 'vazio', parent_id: null, path: 'vazio', title: 'So galhos', isLeaf: false }),
    ]);
    expect(rows).toHaveLength(0);
  });

  it('numera os indices em sequencia', () => {
    const rows = run(arvore);
    expect(rows.map((r) => r.index)).toEqual([0, 1, 2, 3, 4]);
  });

  it('toda linha continua sendo um no de verdade', () => {
    // E o que mantem barra, arraste e dependencia funcionando sem alteracao.
    for (const r of run(arvore)) {
      expect(typeof r.node.id).toBe('string');
      expect(r.node.id.length).toBeGreaterThan(0);
    }
  });
});
