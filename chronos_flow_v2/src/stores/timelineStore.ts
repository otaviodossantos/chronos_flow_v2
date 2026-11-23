import type { ConclusaoFiltro } from '@/features/timeline/useVisibleNodes';
import { create } from 'zustand';

export type ZoomLevel = 'quarters' | 'months' | 'weeks' | 'days' | 'hours';

/** Uma escala unica converte instante em pixel; todo o resto da timeline deriva dela. */
export const PX_PER_DAY: Record<ZoomLevel, number> = {
  quarters: 0.8,
  months: 2.5,
  weeks: 12,
  days: 48,
  hours: 1440, // 1 px por minuto
};

export const ZOOM_LABEL: Record<ZoomLevel, string> = {
  quarters: 'Trimestres',
  months: 'Meses',
  weeks: 'Semanas',
  days: 'Dias',
  hours: 'Horas',
};

/** Passo do arraste em minutos: no zoom de horas o encaixe e de 15 em 15. */
/**
 * Passo do arraste, aplicado ao deslocamento (nao a posicao absoluta), o que
 * preserva o horario da tarefa quando o passo e de dias inteiros.
 *
 * No zoom de dias sao 48px por dia, ou seja 2px por hora: havia resolucao de
 * sobra para posicionar por hora, e o passo de um dia inteiro obrigava a tarefa
 * a pular de 48 em 48px — nao dava para deixar a barra onde se queria. Nos
 * zooms mais largos o dia continua sendo o passo, porque ali um punhado de
 * pixels de tremor na mao viraria horas de diferenca sem querer.
 */
export const SNAP_MINUTES: Record<ZoomLevel, number> = {
  quarters: 1440,
  months: 1440,
  weeks: 1440,
  days: 60,
  hours: 15,
};

/** Quanto o botao de navegacao avanca, em minutos. */
export const PAN_MINUTES: Record<ZoomLevel, number> = {
  quarters: 90 * 1440,
  months: 30 * 1440,
  weeks: 14 * 1440,
  days: 7 * 1440,
  hours: 6 * 60,
};

export const ROW_HEIGHT = 40;

/** Abas da gaveta da tarefa. Atualizacoes por padrao, como no Monday. */
export type DetailTab = 'updates' | 'subtarefas' | 'dependencias' | 'atividade';

interface TimelineState {
  zoom: ZoomLevel;
  viewportStart: Date;
  /**
   * Preferencia explicita por no. Ausente = segue `maxDepth`; true = aberto
   * na marra; false = fechado na marra. Um Set so nao daria conta: sem o
   * terceiro estado, nao ha como fechar um no que `maxDepth` manda abrir.
   */
  overrides: Map<string, boolean>;
  maxDepth: number;
  selectedId: string | null;
  /** Aba do painel de detalhe: o balao de atualizacoes abre direto no feed. */
  detailTab: DetailTab;
  spaceId: string | null;
  assigneeId: string | null;
  statusFilter: string[];
  search: string;
  showDependencies: boolean;
  /** 'compact' lista so as folhas, agrupadas pela tarefa-mae. */
  viewMode: 'tree' | 'compact';
  /**
   * 'abertas' e o padrao: o que ja fechou sai da frente. Uma timeline que
   * acumula tudo o que ja foi feito vira arquivo morto em poucas semanas.
   */
  conclusao: ConclusaoFiltro;
  paletteOpen: boolean;
  /**
   * Modelo sendo arrastado da paleta. Fica no store, e nao no dataTransfer,
   * porque durante o `dragover` o navegador so deixa ler os TIPOS do
   * dataTransfer, nunca o valor — e a arvore e o canvas precisam saber qual
   * modelo e para desenhar a previa.
   */
  draggingTemplateId: string | null;

  /**
   * Troca o zoom mantendo `ancora.centro` no meio da area visivel (de
   * `ancora.largura` pixels). Sem ancora, abre na janela padrao em volta de
   * hoje (`startFor`).
   */
  setZoom: (zoom: ZoomLevel, ancora?: { centro: Date; largura: number }) => void;
  panMinutes: (minutes: number) => void;
  setViewportStart: (d: Date) => void;
  goToNow: () => void;
  setExpanded: (id: string, expanded: boolean) => void;
  expandMany: (ids: string[]) => void;
  collapseAll: () => void;
  setMaxDepth: (depth: number) => void;
  select: (id: string | null) => void;
  /** Seleciona e ja escolhe a aba do painel. */
  openNode: (id: string, tab?: DetailTab) => void;
  setDetailTab: (tab: DetailTab) => void;
  setSpace: (id: string | null) => void;
  setAssignee: (id: string | null) => void;
  toggleStatus: (status: string) => void;
  setSearch: (value: string) => void;
  toggleDependencies: () => void;
  setViewMode: (mode: 'tree' | 'compact') => void;
  setConclusao: (filtro: ConclusaoFiltro) => void;
  togglePalette: () => void;
  setDraggingTemplate: (id: string | null) => void;
  /** Esquece selecao e filtros: ao trocar de conta eles apontariam para dados de outra pessoa. */
  esquecerConta: () => void;
}

/**
 * Onde a janela comeca para cada zoom. Nos zooms longos, um pouco antes de hoje;
 * no zoom de horas, no inicio do dia de hoje — ninguem quer olhar 02:00 da manha.
 */
function startFor(zoom: ZoomLevel, around = new Date()): Date {
  const d = new Date(around);
  if (zoom === 'hours') {
    // Quem pede a visao de horas quer ver o proprio dia. Se a janela atual
    // esta longe de hoje, ancorar nela abriria uma madrugada aleatoria.
    const today = new Date();
    const farFromToday = Math.abs(d.getTime() - today.getTime()) > 36 * 3_600_000;
    const anchor = farFromToday ? today : d;
    const result = new Date(anchor);
    result.setHours(0, 0, 0, 0);
    return result;
  }
  d.setHours(0, 0, 0, 0);
  const back = { quarters: 120, months: 30, weeks: 14, days: 3, hours: 0 }[zoom];
  d.setDate(d.getDate() - back);
  return d;
}

export const useTimelineStore = create<TimelineState>((set) => ({
  zoom: 'months',
  viewportStart: startFor('months'),
  overrides: new Map<string, boolean>(),
  maxDepth: 2,
  selectedId: null,
  detailTab: 'updates',
  spaceId: null,
  assigneeId: null,
  statusFilter: [],
  search: '',
  showDependencies: true,
  viewMode: 'tree',
  conclusao: 'abertas',
  paletteOpen: false,
  draggingTemplateId: null,

  /**
   * Troca de zoom preserva o que estava no meio da tela: o olho nao perde o
   * lugar. Antes a ancora era a borda esquerda, e cada troca ainda recuava
   * alguns dias (o "um pouco antes de hoje" de `startFor`): Trimestres ->
   * Meses -> Semanas ia escorregando para o passado ate a tela ficar vazia.
   *
   * Quem chama zera a rolagem horizontal: a janela nova ja comeca onde o
   * centro precisa estar.
   */
  setZoom: (zoom, ancora) => {
    const centro = ancora?.centro ?? new Date();
    // O zoom de horas tem regra propria: abre no comeco do dia (ver startFor).
    if (zoom === 'hours') {
      set({ zoom, viewportStart: startFor('hours', centro) });
      return;
    }
    if (!ancora || ancora.largura <= 0) {
      set({ zoom, viewportStart: startFor(zoom, centro) });
      return;
    }
    // Sem arredondar para a meia-noite: arredondar sempre para baixo perdia ate
    // um dia por troca, o mesmo escorregao em miniatura. A regua posiciona as
    // marcas pelas datas reais, e a grade do canvas acompanha as marcas.
    const metadeEmDias = ancora.largura / 2 / PX_PER_DAY[zoom];
    set({ zoom, viewportStart: new Date(centro.getTime() - metadeEmDias * 86_400_000) });
  },
  panMinutes: (minutes) =>
    set((s) => ({ viewportStart: new Date(s.viewportStart.getTime() + minutes * 60_000) })),
  setViewportStart: (viewportStart) => set({ viewportStart }),
  goToNow: () => set((s) => ({ viewportStart: startFor(s.zoom) })),

  setExpanded: (id, expanded) =>
    set((s) => {
      const next = new Map(s.overrides);
      next.set(id, expanded);
      return { overrides: next };
    }),
  expandMany: (ids) =>
    set((s) => {
      const next = new Map(s.overrides);
      for (const id of ids) next.set(id, true);
      return { overrides: next };
    }),
  collapseAll: () => set({ overrides: new Map<string, boolean>(), maxDepth: 0 }),

  // Escolher um nivel e redefinir o padrao: as preferencias por no somem,
  // senao o botao pareceria nao fazer efeito nos nos ja tocados a mao.
  setMaxDepth: (maxDepth) => set({ maxDepth, overrides: new Map<string, boolean>() }),
  select: (selectedId) => set({ selectedId }),
  openNode: (selectedId, detailTab = 'updates') => set({ selectedId, detailTab }),
  setDetailTab: (detailTab) => set({ detailTab }),
  setSpace: (spaceId) => set({ spaceId }),
  setAssignee: (assigneeId) => set({ assigneeId }),
  toggleStatus: (status) =>
    set((s) => ({
      statusFilter: s.statusFilter.includes(status)
        ? s.statusFilter.filter((x) => x !== status)
        : [...s.statusFilter, status],
    })),
  setSearch: (search) => set({ search }),
  toggleDependencies: () => set((s) => ({ showDependencies: !s.showDependencies })),
  // Trocar de modo limpa as preferencias de abrir/fechar: elas descrevem a
  // arvore, e no modo compacto nao ha arvore a que se referir.
  setViewMode: (viewMode) => set({ viewMode, overrides: new Map<string, boolean>() }),
  setConclusao: (conclusao) => set({ conclusao }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  setDraggingTemplate: (draggingTemplateId) => set({ draggingTemplateId }),
  esquecerConta: () =>
    set({
      selectedId: null,
      detailTab: 'updates',
      spaceId: null,
      assigneeId: null,
      statusFilter: [],
      search: '',
      overrides: new Map<string, boolean>(),
      draggingTemplateId: null,
    }),
}));
