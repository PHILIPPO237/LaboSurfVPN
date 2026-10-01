import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import { useTheme } from '../context/ThemeContext';
import { Icon, FlagIcon } from './SvgIcons';
import { ScreenId } from '../types';

export const NavigationRail: React.FC = () => {
  const { currentScreen, setCurrentScreen, unreadCount } = useApp();
  const { lang, setLang, t } = useI18n();
  const { theme, toggleQuickTheme } = useTheme();
  const [expanded, setExpanded] = useState(false);

  const navItems: { id: ScreenId; labelKey: string; icon: string; badge?: number }[] = [
    { id: 'home', labelKey: 'nav.home', icon: 'home' },
    { id: 'services', labelKey: 'nav.services', icon: 'layers' },
    { id: 'account', labelKey: 'nav.account', icon: 'user', badge: unreadCount },
  ];

  return (
    <nav className="rail" id="rail" aria-label={t('nav.label')}>
      {navItems.map((item) => (
        <button
          key={item.id}
          className={`rail-btn ${currentScreen === item.id ? 'active' : ''}`}
          type="button"
          onClick={() => setCurrentScreen(item.id)}
          title={t(item.labelKey)}
          aria-label={t(item.labelKey)}
        >
          <Icon name={item.icon} />
          {item.badge && item.badge > 0 ? (
            <span className="rail-badge">{item.badge}</span>
          ) : null}
        </button>
      ))}

      {/* Settings with expandable quick theme & quick lang toggle */}
      <div className={`rail-group ${expanded ? 'is-open' : ''}`} id="railGroup">
        <button
          className={`rail-btn ${currentScreen === 'settings' ? 'active' : ''}`}
          type="button"
          onClick={() => setCurrentScreen('settings')}
          title={t('nav.settings')}
          aria-label={t('nav.settings')}
        >
          <Icon name="settings" />
        </button>
        <button
          className="rail-caret"
          type="button"
          aria-expanded={expanded}
          aria-controls="railExpand"
          aria-label={t('nav.shortcutsShow')}
          onClick={() => setExpanded(!expanded)}
        >
          <Icon name={expanded ? 'chevron-down' : 'chevron-down'} />
        </button>
        <div
          className="rail-expand"
          id="railExpand"
          role="group"
          aria-label={t('nav.shortcuts')}
          style={{ display: expanded ? 'flex' : 'none' }}
        >
          <button
            className="rail-mini"
            type="button"
            onClick={toggleQuickTheme}
            title={t('set.theme')}
            aria-label={t('set.theme')}
          >
            <Icon name={theme === 'dark' ? 'moon' : 'sun'} />
          </button>
          <button
            className="rail-mini"
            type="button"
            onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')}
            title={t('set.language')}
            aria-label={t('set.language')}
          >
            <FlagIcon lang={lang} />
          </button>
        </div>
      </div>

      <button
        className={`rail-btn ${currentScreen === 'logs' ? 'active' : ''}`}
        type="button"
        onClick={() => setCurrentScreen('logs')}
        title={t('nav.logs')}
        aria-label={t('nav.logs')}
      >
        <Icon name="terminal" />
      </button>

      <button
        className={`rail-btn ${currentScreen === 'about' ? 'active' : ''}`}
        type="button"
        onClick={() => setCurrentScreen('about')}
        title={t('nav.about')}
        aria-label={t('nav.about')}
      >
        <Icon name="info" />
      </button>
    </nav>
  );
};
