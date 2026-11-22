import { useMemo } from 'react';
import type { NodeDTO } from '@shared/types';

export type ViewMode = 'tree' | 'compact';

/** 'abertas' esconde galho fechado; 'tudo' mostra o historico inteiro. */
export type ConclusaoFiltro = 'abertas' | 'tudo';

export interface FlatRow {
  node: NodeDTO;
  index: number;
  hasChildren: boolean;
  isExpanded: boolean;
  /**
   * Modo compacto: recuo em niveis, ja resolvido aqui, porque ali a
   * profundidade real do no nao serve de indentacao.
   */
  indent?: number;
  /** Modo compacto: titulos dos ancestrais, para o cabecalho do grupo. */
  crumbs?: string[];
  /** Modo compacto: a linha e o cabecalho do grupo, nao uma tarefa a fazer. */
  isGroup?: boolean;
}

/**
 * Lista plana do que esta visivel. `maxDepth` define o padrao ("expandir ate
 * o nivel N") e a preferencia por no sobrepoe esse padrao nas duas direcoes —
 * e o que permite fechar um no raso que o padrao mandaria abrir.
 */
export function useVisibleNodes(
  nodes: NodeDTO[],
  overrides: Map<string, boolean>,
  maxDepth: number,
  mode: ViewMode = 'tree',
  conclusao: ConclusaoFiltro = 'abertas',
): FlatRow[] {
  return useMemo(() => {
    const agrupar = (lista: NodeDTO[]) => {
      const mapa = new Map<string, NodeDTO[]>();
      for (const n of lista) {
        const key = n.parent_id ?? '__root__';
        const atual = mapa.get(key) ?? [];
        atual.push(n);
        mapa.set(key, atual);
      }
      for (const filhas of mapa.values()) filhas.sort((a, b) => a.position - b.position);
      return mapa;
    };

    // O corte vem antes do achatamento e reagrupa: um bloco que sumiu nao pode
    // continuar contando como pai de ninguem.
    const visiveis =
      conclusao === 'tudo' ? nodes : comTrabalhoAberto(nodes, agrupar(nodes));
    const byParent = agrupar(visiveis);

    if (mode === 'compact') return compactRows(visiveis, byParent);

    const rows: FlatRow[] = [];
    const walk = (parentKey: string, depth: number) => {
      for (const node of byParent.get(parentKey) ?? []) {
        const children = byParent.get(node.id) ?? [];
        const hasChildren = children.length > 0 || !node.isLeaf;
        const isExpanded = overrides.get(node.id) ?? depth < maxDepth;

        rows.push({ node, index: rows.length, hasChildren, isExpanded });
        if (hasChildren && isExpanded) walk(node.id, depth + 1);
      }
    };
    walk('__root__', 0);
    return rows;
  }, [nodes, overrides, maxDepth, mode, conclusao]);
}

/** Concluida ou cancelada: nos dois casos nao ha mais o que fazer ali. */
function resolvido(node: NodeDTO): boolean {
  return node.status === 'COMPLETED' || node.status === 'CANCELLED';
}

/**
 * Um galho sem filhas carregadas — recolhido, ou mais fundo que a profundidade
 * pedida — precisa responder por si mesmo.
 *
 * Para uma folha, o status basta. Para um no que tem filhas, nao: a cascata
 * atualiza o `progress` do pai mas NUNCA muda o `status` dele, entao um pai com
 * tudo fechado abaixo continua "Pendente" para sempre. O progresso e derivado
 * das folhas, e por isso e o unico sinal confiavel de galho fechado.
 */
function galhoFechado(node: NodeDTO): boolean {
  if (resolvido(node)) return true;
  return !node.isLeaf && node.progress >= 99.99;
}

/**
 * Tira da vista o que ja foi feito, sem quebrar os grupos que sobram.
 *
 * Sao duas regras, e a diferenca entre elas e o ponto todo:
 *
 *  - um BLOCO some quando o proprio galho nao tem mais nenhuma folha aberta.
 *    Vale em qualquer nivel: um ramo inteiro concluido desaparece mesmo que o
 *    avo dele siga cheio de trabalho em outro ramo;
 *  - uma FOLHA segue o bloco a que pertence. Enquanto uma irma estiver aberta,
 *    a folha concluida continua a vista — furar o grupo para esconde-la tiraria
 *    justamente a nocao de quanto daquele bloco ja andou.
 */
export function comTrabalhoAberto(
  nodes: NodeDTO[],
  byParent: Map<string, NodeDTO[]>,
): NodeDTO[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const cache = new Map<string, number>();

  /** Folhas ainda abertas no galho deste no. */
  const abertas = (node: NodeDTO): number => {
    const memo = cache.get(node.id);
    if (memo !== undefined) return memo;

    const filhas = byParent.get(node.id) ?? [];
    const total =
      filhas.length > 0
        ? filhas.reduce((soma, f) => soma + abertas(f), 0)
        : galhoFechado(node)
          ? 0
          : 1;

    cache.set(node.id, total);
    return total;
  };

  return nodes.filter((node) => {
    const temFilhas = (byParent.get(node.id)?.length ?? 0) > 0;
    if (temFilhas || !node.isLeaf) return abertas(node) > 0;

    const pai = node.parent_id ? byId.get(node.parent_id) : null;
    return pai ? abertas(pai) > 0 : abertas(node) > 0;
  });
}

/**
 * Visao reduzida: so as tarefas que de fato se executa (as folhas), cada
 * grupo precedido pela tarefa-mae com o caminho inteiro escrito ao lado.
 *
 * Os niveis intermediarios somem como LINHAS, nao como informacao: eles
 * reaparecem no rastro "N0 › N1 › N2" do cabecalho. Numa arvore de quatro
 * niveis isso troca dezenas de linhas de agrupamento por uma por grupo.
 *
 * O cabecalho e a propria tarefa-mae, nao um rotulo inventado: assim toda
 * linha continua sendo um no de verdade, com barra na timeline, arraste,
 * dependencia e tudo o mais que ja funciona.
 */
export function compactRows(
  nodes: NodeDTO[],
  byParent: Map<string, NodeDTO[]>,
): FlatRow[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rows: FlatRow[] = [];
  const cabecalhoEmitido = new Set<string>();

  /** Titulos do caminho ate o no, sem incluir ele proprio. */
  const rastro = (node: NodeDTO): string[] =>
    node.path
      .split('/')
      .slice(0, -1)
      .map((id) => byId.get(id)?.title)
      .filter((t): t is string => Boolean(t));

  const walk = (parentKey: string) => {
    for (const node of byParent.get(parentKey) ?? []) {
      const filhas = byParent.get(node.id) ?? [];
      const ehFolha = filhas.length === 0 && node.isLeaf;

      if (!ehFolha) {
        walk(node.id);
        continue;
      }

      const pai = node.parent_id ? byId.get(node.parent_id) : null;
      if (pai && !cabecalhoEmitido.has(pai.id)) {
        cabecalhoEmitido.add(pai.id);
        rows.push({
          node: pai,
          index: rows.length,
          hasChildren: true,
          isExpanded: true,
          indent: 0,
          crumbs: rastro(pai),
          isGroup: true,
        });
      }

      rows.push({
        node,
        index: rows.length,
        hasChildren: false,
        isExpanded: false,
        // Folha solta na raiz nao tem cabecalho acima: nao recua.
        indent: pai ? 1 : 0,
        crumbs: pai ? [] : rastro(node),
      });
    }
  };

  walk('__root__');
  return rows;
}
