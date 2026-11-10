import type { SliceCreator } from './base';

const THEME_KEY = 'storyboard-theme';

export type Theme = 'dark' | 'light';

function readTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // localStorage 不可用时退回系统偏好
  }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export interface ThemeSlice {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const createThemeSlice: SliceCreator<ThemeSlice> = (set) => ({
  theme: readTheme(),
  setTheme: (theme) => {
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // 忽略持久化失败
    }
    document.documentElement.dataset.theme = theme;
    set({ theme });
  },
});
