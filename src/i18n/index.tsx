import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { fr } from './fr';
import { en } from './en';

type Lang = 'fr' | 'en';

const dicts: Record<Lang, Record<string, string>> = { fr, en };

interface I18nContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  tn: (key: string, n: number, params?: Record<string, string | number>) => string;
  locale: string;
}

const I18nContext = createContext<I18nContextValue>({
  lang: 'fr',
  setLang: () => {},
  t: (k) => k,
  tn: (k) => k,
  locale: 'fr-FR',
});

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem('ls.lang');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed === 'fr' || parsed === 'en') return parsed;
    }
  } catch (e) {
    // ignore
  }
  const nav = String(
    (navigator.languages && navigator.languages[0]) || navigator.language || 'fr'
  ).toLowerCase();
  return nav.indexOf('fr') === 0 ? 'fr' : 'en';
}

export const I18nProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Lang>(detectLang);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem('ls.lang', JSON.stringify(l));
    } catch (e) {
      // ignore
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('lang', lang);
    const appTitle = dicts[lang]['app.title'] || 'Labo Surf';
    document.title = appTitle;
  }, [lang]);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      const d = dicts[lang] || {};
      let s = d[key];
      if (s === undefined) s = (dicts.fr || {})[key];
      if (s === undefined) return key;
      if (params) {
        s = s.replace(/\{(\w+)\}/g, (_m, k) =>
          params[k] !== undefined ? String(params[k]) : `{${k}}`
        );
      }
      return s;
    },
    [lang]
  );

  const tn = useCallback(
    (key: string, n: number, params?: Record<string, string | number>): string => {
      const one = lang === 'fr' ? (n === 0 || n === 1) : n === 1;
      const p: Record<string, string | number> = { n, ...(params || {}) };
      return t(key + (one ? '_one' : '_other'), p);
    },
    [lang, t]
  );

  const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';

  return (
    <I18nContext.Provider value={{ lang, setLang, t, tn, locale }}>
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = () => useContext(I18nContext);
