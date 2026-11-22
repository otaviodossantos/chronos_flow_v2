import { create } from 'zustand';

type Theme = 'dark' | 'light';

const read = (): Theme => {
  try {
    const saved = localStorage.getItem('chronos_theme');
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    /* modo privado ou storage bloqueado */
  }
  return 'dark';
};

const apply = (theme: Theme) => {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.classList.toggle('light', theme === 'light');
  try {
    localStorage.setItem('chronos_theme', theme);
  } catch {
    /* ignora */
  }
};

interface ThemeState {
  theme: Theme;
  toggle: () => void;
  set: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const initial = read();
  apply(initial);
  return {
    theme: initial,
    toggle: () => {
      const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
      apply(next);
      set({ theme: next });
    },
    set: (theme) => {
      apply(theme);
      set({ theme });
    },
  };
});
