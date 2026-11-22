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
  /**
   * Quem esta aberto no painel de detalhe, por cima da timeline.
   *
   * Nao e o mesmo que `marcadoId`: um toque na barra marca, e so o botao
   * "Abrir" leva ate aqui. Eram a mesma coisa ate o arraste na timeline se
   * mostrar impossivel no aparelho — ver `marcadoId`.
   */
  selectedId: string | null;
  /**
   * A tarefa escolhida na timeline, que a barra de ajuste comanda.
   *
   * O desktop move e redimensiona por arraste. No iPhone esse gesto nao
   * sobreviveu: o WebKit decide, antes de qualquer codigo nosso, que um toque
   * que se desloca e rolagem — e cancela o ponteiro. Em vez de continuar
   * brigando com ele, a escolha passou a ser um toque e o ajuste passou a ser
   * botao: toca-se na barra, ela fica marcada, e setas a movem.
   */
  marcadoId: string | null;
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

  setZoom: (zoom: ZoomLevel) => void;
  panMinutes: (minutes: number) => void;
  setViewportStart: (d: Date) => void;
  goToNow: () => void;
  setExpanded: (id: string, expanded: boolean) => void;
  expandMany: (ids: string[]) => void;
  collapseAll: () => void;
  setMaxDepth: (depth: number) => void;
  select: (id: string | null) => void;
  marcar: (id: string | null) => void;
  setSpace: (id: string | null) => void;
  setAssignee: (id: string | null) => void;
  toggleStatus: (status: string) => void;
  setSearch: (value: string) => void;
  toggleDependencies: () => void;
  setViewMode: (mode: 'tree' | 'compact') => void;
  setConclusao: (filtro: ConclusaoFiltro) => void;
  togglePalette: () => void;
  setDraggingTemplate: (id: string | null) => void;
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

export const useTimelineStore = create<TimelineState>((set, get) => ({
  zoom: 'months',
  viewportStart: startFor('months'),
  overrides: new Map<string, boolean>(),
  maxDepth: 2,
  selectedId: null,
  marcadoId: null,
  spaceId: null,
  assigneeId: null,
  statusFilter: [],
  search: '',
  showDependencies: true,
  viewMode: 'tree',
  conclusao: 'abertas',
  paletteOpen: false,
  draggingTemplateId: null,

  // Troca de zoom preserva o centro da janela: o olho nao perde o lugar.
  setZoom: (zoom) => {
    const { viewportStart } = get();
    set({ zoom, viewportStart: startFor(zoom, viewportStart) });
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
  // Abrir o detalhe de uma tarefa tambem a marca: ao fechar o painel, a barra
  // de ajuste continua ali, apontando para a mesma tarefa.
  select: (selectedId) =>
    set((s) => ({ selectedId, marcadoId: selectedId ?? s.marcadoId })),
  marcar: (marcadoId) => set({ marcadoId }),
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
}));
