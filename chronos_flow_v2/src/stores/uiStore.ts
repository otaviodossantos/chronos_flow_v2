import { create } from 'zustand';

/**
 * Preferencias de janela que sobrevivem ao fechar o app. Ficam fora do
 * timelineStore de proposito: ali mora estado de navegacao que se perde entre
 * sessoes, e misturar os dois faria a barra lateral reabrir a cada reinicio.
 */

const KEY = 'chronos_sidebar_collapsed';
const VIEW_KEY = 'chronos_project_view';

/** Como a tela de projetos mostra a mesma arvore. */
export type ProjectView = 'timeline' | 'table' | 'kanban';
const VIEWS: ProjectView[] = ['timeline', 'table', 'kanban'];

const readView = (): ProjectView => {
  try {
    const v = localStorage.getItem(VIEW_KEY) as ProjectView | null;
    return v && VIEWS.includes(v) ? v : 'timeline';
  } catch {
    return 'timeline';
  }
};

const read = (): boolean => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    /* modo privado ou storage bloqueado */
    return false;
  }
};

const write = (collapsed: boolean) => {
  try {
    localStorage.setItem(KEY, collapsed ? '1' : '0');
  } catch {
    /* ignora */
  }
};

interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  /** Visao escolhida na tela de projetos; volta a mesma ao reabrir o app. */
  projectView: ProjectView;
  setProjectView: (view: ProjectView) => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  sidebarCollapsed: read(),
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    write(next);
    set({ sidebarCollapsed: next });
  },
  setSidebarCollapsed: (sidebarCollapsed) => {
    write(sidebarCollapsed);
    set({ sidebarCollapsed });
  },
  projectView: readView(),
  setProjectView: (projectView) => {
    try {
      localStorage.setItem(VIEW_KEY, projectView);
    } catch {
      /* ignora */
    }
    set({ projectView });
  },
}));
