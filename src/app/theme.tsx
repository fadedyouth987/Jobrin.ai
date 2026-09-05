import React, { createContext, useContext, useEffect, useState } from 'react';

// Light / Dark / System theming. The choice persists in localStorage and
// defaults to the device preference until the user picks one. The `.dark`
// class on <html> drives the CSS-variable overrides in index.css.
type Theme = 'light' | 'dark' | 'system';
const KEY = 'jobrin-ai.theme';

const ThemeContext = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({ theme: 'system', setTheme: () => undefined });

function systemDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => (localStorage.getItem(KEY) as Theme) || 'system');

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => root.classList.toggle('dark', theme === 'dark' || (theme === 'system' && systemDark()));
    apply();
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { if (theme === 'system') apply(); };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = (next: Theme) => {
    localStorage.setItem(KEY, next);
    setThemeState(next);
  };

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
