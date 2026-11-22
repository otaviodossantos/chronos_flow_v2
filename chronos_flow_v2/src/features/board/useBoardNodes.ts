import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import type { NodeDTO } from '@shared/types';
import { api } from '@/lib/api';
import { useTimelineStore } from '@/stores/timelineStore';
import { comTrabalhoAberto } from '@/features/timeline/useVisibleNodes';

/**
 * A Tabela e o Kanban carregam a arvore inteira do espaco e filtram aqui.
 *
 * A timeline filtra no servidor, mas la a busca devolve so os nos que casam —
 * numa tabela agrupada isso deixaria a tarefa achada sem o grupo e sem a mae.
 * Filtrando no cliente da para manter o caminho ate ela.
 *
 * A chave comeca com 'tree' de proposito: toda tela que ja invalida a arvore
 * depois de uma mudanca atualiza estas visoes junto, sem saber que existem.
 */
export const boardQueryKey = (spaceId: string | null) => ['tree', 'board', spaceId] as const;

export function useBoardNodes() {
  const spaceId = useTimelineStore((s) => s.spaceId);
  const search = useTimelineStore((s) => s.search);
  const assigneeId = useTimelineStore((s) => s.assigneeId);
  const conclusao = useTimelineStore((s) => s.conclusao);

  const query = useQuery({
    queryKey: boardQueryKey(spaceId),
    queryFn: () => api.tree({ spaceId: spaceId ?? undefined, maxDepth: 12 }),
  });
  const all = query.data ?? [];

  const derived = useMemo(() => {
    const byId = new Map(all.map((n) => [n.id, n]));
    const base = conclusao === 'tudo' ? all : comTrabalhoAberto(all, groupByParent(all));

    const q = normalize(search.trim());
    const filtering = Boolean(q || assigneeId);
    const matches = (n: NodeDTO) =>
      (!q || normalize(n.title).includes(q)) && (!assigneeId || n.assignee_id === assigneeId);

    let visible = base;
    /** Ancestrais de algo que casou: abertos na marra para a tarefa aparecer. */
    const forcedOpen = new Set<string>();
    const matched = new Set<string>();

    if (filtering) {
      const baseIds = new Set(base.map((n) => n.id));
      const keep = new Set<string>();
      for (const n of base) {
        if (!matches(n)) continue;
        matched.add(n.id);
        keep.add(n.id);
        for (const id of n.path.split('/').slice(0, -1)) {
          if (baseIds.has(id)) {
            keep.add(id);
            forcedOpen.add(id);
          }
        }
      }
      visible = base.filter((n) => keep.has(n.id));
    }

    /** Titulos do caminho ate o no, sem ele. */
    const crumbs = (n: NodeDTO) =>
      n.path
        .split('/')
        .slice(0, -1)
        .map((id) => byId.get(id)?.title)
        .filter((t): t is string => Boolean(t));

    return {
      byId,
      visible,
      byParent: groupByParent(visible),
      filtering,
      /** O filtro de busca e responsavel, para quem parte de outra lista (Kanban). */
      matches,
      forcedOpen,
      matched,
      crumbs,
    };
  }, [all, conclusao, search, assigneeId]);

  return { ...derived, all, isLoading: query.isLoading, spaceId };
}

export function groupByParent(nodes: NodeDTO[]) {
  const map = new Map<string, NodeDTO[]>();
  for (const n of nodes) {
    const key = n.parent_id ?? '__root__';
    const list = map.get(key) ?? [];
    list.push(n);
    map.set(key, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.position - b.position);
  return map;
}

/** Busca sem acento e sem caixa: "reuniao" acha "Reunião". */
export function normalize(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Abrir e fechar da Tabela. Fica fora do store da timeline: la a expansao
 * descreve outra coisa (profundidade da arvore no canvas), e dividir o mesmo
 * mapa faria uma visao bagunçar a outra.
 */
interface BoardUiState {
  /** Linhas: ausente = fechada (subitens recolhidos, como no Monday). */
  expanded: Map<string, boolean>;
  /** Grupos (metas macro): ausente = aberto. */
  collapsedGroups: Set<string>;
  setExpanded: (id: string, open: boolean) => void;
  expandMany: (ids: string[]) => void;
  collapseAll: () => void;
  toggleGroup: (id: string) => void;
}

export const useBoardUi = create<BoardUiState>((set) => ({
  expanded: new Map(),
  collapsedGroups: new Set(),
  setExpanded: (id, open) =>
    set((s) => {
      const next = new Map(s.expanded);
      next.set(id, open);
      return { expanded: next };
    }),
  expandMany: (ids) =>
    set(() => ({ expanded: new Map(ids.map((id) => [id, true])), collapsedGroups: new Set() })),
  collapseAll: () => set({ expanded: new Map() }),
  toggleGroup: (id) =>
    set((s) => {
      const next = new Set(s.collapsedGroups);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { collapsedGroups: next };
    }),
}));
