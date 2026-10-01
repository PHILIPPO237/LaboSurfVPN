import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  theme: ThemeChoice;
  resolvedTheme: ResolvedTheme;
  setTheme: (t: ThemeChoice) => void;
  toggleQuickTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  resolvedTheme: 'dark',
  setTheme: () => {},
  toggleQuickTheme: () => {},
});

function getSavedTheme(): ThemeChoice {
  try {
    const saved = localStorage.getItem('ls.theme');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed === 'system' || parsed === 'light' || parsed === 'dark') return parsed;
    }
  } catch (e) {
    // ignore
  }
  return 'dark'; // default in Labo Surf is dark
}

function resolveSystemTheme(): ResolvedTheme {
  if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemeChoice>(getSavedTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    theme === 'system' ? resolveSystemTheme() : theme
  );

  const setTheme = useCallback((t: ThemeChoice) => {
    setThemeState(t);
    try {
      localStorage.setItem('ls.theme', JSON.stringify(t));
    } catch (e) {
      // ignore
    }
  }, []);

  const toggleQuickTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: ThemeChoice = prev === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem('ls.theme', JSON.stringify(next));
      } catch (e) {
        // ignore
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const handleSystemChange = () => {
      if (theme === 'system') {
        const res = resolveSystemTheme();
        setResolvedTheme(res);
        document.documentElement.setAttribute('data-theme', res);
      }
    };

    const res = theme === 'system' ? resolveSystemTheme() : theme;
    setResolvedTheme(res);
    document.documentElement.setAttribute('data-theme', res);

    const mql = window.matchMedia('(prefers-color-scheme: light)');
    mql.addEventListener('change', handleSystemChange);
    return () => mql.removeEventListener('change', handleSystemChange);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggleQuickTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
