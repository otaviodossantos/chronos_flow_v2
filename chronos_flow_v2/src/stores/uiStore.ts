import { create } from 'zustand';

/**
 * Preferencias de janela que sobrevivem ao fechar o app. Ficam fora do
 * timelineStore de proposito: ali mora estado de navegacao que se perde entre
 * sessoes, e misturar os dois faria a barra lateral reabrir a cada reinicio.
 */

const KEY = 'chronos_sidebar_collapsed';

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
}));
