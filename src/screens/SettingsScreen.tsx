import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import { useTheme } from '../context/ThemeContext';
import { Icon, FlagIcon } from '../components/SvgIcons';

export const SettingsScreen: React.FC = () => {
  const {
    openGuide,
    openOnboarding,
    openLegal,
    setCurrentScreen,
    expiryReminders,
    toggleExpiryReminders,
    apiBase,
    setApiBase,
    resetApiBase,
    apiStatus,
    addToast,
  } = useApp();

  const { lang, setLang, t } = useI18n();
  const { theme, setTheme } = useTheme();

  const [customApiUrl, setCustomApiUrl] = useState(apiBase);
  const [showApiInput, setShowApiInput] = useState(false);

  const handleSaveApi = () => {
    setApiBase(customApiUrl);
    if (/^https:\/\//i.test(customApiUrl) || /^http:\/\/(localhost|127\.0\.0\.1)/i.test(customApiUrl)) {
      addToast(t('set.apiSaved') || 'Adresse de l’API mise à jour', 'success');
      setShowApiInput(false);
    } else {
      addToast(t('err.apiInsecure') || 'HTTPS requis pour l’adresse du panel', 'error');
    }
  };

  const handleResetApi = () => {
    resetApiBase();
    setCustomApiUrl('https://laboratoire.free-surf237-4all.xyz');
    setShowApiInput(false);
    addToast(t('set.apiReset') || 'Adresse par défaut restaurée', 'info');
  };

  return (
    <section className="screen active" id="screen-settings" aria-labelledby="setTitle">
      <div className="screen-head">
        <h1 id="setTitle">{t('set.title')}</h1>
      </div>

      {/* Help Section */}
      <div className="section-title">{t('set.helpSection')}</div>
      <div className="list">
        <button
          className="row row-primary"
          type="button"
          onClick={() => openGuide('start')}
        >
          <span className="row-ico">
            <Icon name="help" />
          </span>
          <div className="row-main">
            <div className="row-title">{t('set.help')}</div>
            <div className="row-sub">{t('set.helpSub')}</div>
          </div>
          <Icon name="chevron-right" className="row-chev" />
        </button>

        <button
          className="row"
          type="button"
          onClick={() => openGuide('', 'assistant')}
        >
          <span className="row-ico">
            <Icon name="message" />
          </span>
          <div className="row-main">
            <div className="row-title">{t('assistant.title')}</div>
            <div className="row-sub">{t('set.assistantSub')}</div>
          </div>
          <Icon name="chevron-right" className="row-chev" />
        </button>

        <button className="row" type="button" onClick={openOnboarding}>
          <span className="row-ico">
            <Icon name="book" />
          </span>
          <div className="row-main">
            <div className="row-title">{t('set.replayIntro')}</div>
            <div className="row-sub">{t('set.replayIntroSub')}</div>
          </div>
          <Icon name="chevron-right" className="row-chev" />
        </button>
      </div>

      {/* General Settings */}
      <div className="section-title">{t('set.general')}</div>
      <div className="list">
        {/* Language selector */}
        <div className="setting-block">
          <div className="setting-head">
            <span className="row-ico">
              <Icon name="globe" />
            </span>
            <div className="row-main">
              <div className="row-title">{t('set.language')}</div>
              <div className="row-sub">{t('set.languageSub')}</div>
            </div>
          </div>
          <div className="segmented" role="group" aria-label={t('set.language')}>
            <button
              type="button"
              className={lang === 'fr' ? 'active' : ''}
              aria-pressed={lang === 'fr'}
              onClick={() => setLang('fr')}
            >
              <FlagIcon lang="fr" />
              <span>Français</span>
            </button>
            <button
              type="button"
              className={lang === 'en' ? 'active' : ''}
              aria-pressed={lang === 'en'}
              onClick={() => setLang('en')}
            >
              <FlagIcon lang="en" />
              <span>English</span>
            </button>
          </div>
        </div>

        {/* Theme selector */}
        <div className="setting-block">
          <div className="setting-head">
            <span className="row-ico">
              <Icon name="sun" />
            </span>
            <div className="row-main">
              <div className="row-title">{t('set.theme')}</div>
              <div className="row-sub">{t('set.themeSub')}</div>
            </div>
          </div>
          <div className="segmented" role="group" aria-label={t('set.theme')}>
            <button
              type="button"
              className={theme === 'system' ? 'active' : ''}
              aria-pressed={theme === 'system'}
              onClick={() => setTheme('system')}
            >
              {t('set.themeSystem')}
            </button>
            <button
              type="button"
              className={theme === 'light' ? 'active' : ''}
              aria-pressed={theme === 'light'}
              onClick={() => setTheme('light')}
            >
              {t('set.themeLight')}
            </button>
            <button
              type="button"
              className={theme === 'dark' ? 'active' : ''}
              aria-pressed={theme === 'dark'}
              onClick={() => setTheme('dark')}
            >
              {t('set.themeDark')}
            </button>
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div className="section-title">{t('set.notifications')}</div>
      <div className="list">
        <div className="row" style={{ cursor: 'default' }}>
          <span className="row-ico">
            <Icon name="bell" />
          </span>
          <div className="row-main">
            <div className="row-title">{t('set.notifExpiry')}</div>
            <div className="row-sub">{t('set.notifExpirySub')}</div>
          </div>
          <button
            className={`switch ${expiryReminders ? 'on' : ''}`}
            type="button"
            role="switch"
            aria-checked={expiryReminders}
            onClick={toggleExpiryReminders}
            aria-label={t('set.notifExpiry')}
          />
        </div>
      </div>

      {/* Connection / API URL */}
      <div className="section-title">{t('set.connection') || 'Connexion et API'}</div>
      <div className="list">
        <div className="setting-block">
          <div className="setting-head">
            <span className="row-ico">
              <Icon name="shield" />
            </span>
            <div className="row-main">
              <div className="row-title">Panel Laboratoire API</div>
              <div className="row-sub" style={{ wordBreak: 'break-all' }}>
                {apiBase}
              </div>
            </div>
          </div>
          {!showApiInput ? (
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              style={{ marginTop: '8px' }}
              onClick={() => setShowApiInput(true)}
            >
              {t('common.edit') || 'Modifier l’adresse'}
            </button>
          ) : (
            <div style={{ marginTop: '8px' }}>
              <input
                className="input is-mono"
                type="text"
                value={customApiUrl}
                onChange={(e) => setCustomApiUrl(e.target.value)}
                placeholder="https://laboratoire.free-surf237-4all.xyz"
              />
              <div className="btn-row" style={{ marginTop: '8px' }}>
                <button className="btn btn-primary btn-sm" type="button" onClick={handleSaveApi}>
                  {t('common.confirm') || 'Enregistrer'}
                </button>
                <button className="btn btn-secondary btn-sm" type="button" onClick={handleResetApi}>
                  {t('common.reset') || 'Restaurer'}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => setShowApiInput(false)}
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Community */}
      <div className="section-title">{t('set.communitySection')}</div>
      <div className="list">
        <button
          className="row"
          type="button"
          onClick={() => setCurrentScreen('community')}
        >
          <span className="row-ico">
            <Icon name="users" />
          </span>
          <div className="row-main">
            <div className="row-title">{t('nav.community')}</div>
            <div className="row-sub">{t('set.communitySub')}</div>
          </div>
          <Icon name="chevron-right" className="row-chev" />
        </button>
      </div>

      {/* App Info & Legal */}
      <div className="section-title">{t('set.app')}</div>
      <div className="list">
        <div className="about-block">
          <div className="about-name">
            Labo <b>Surf</b>
          </div>
          <div className="about-org">Laboratoire du Free-Surf</div>
          <p className="about-text">{t('set.aboutText')}</p>
        </div>

        <button
          className="row"
          type="button"
          onClick={() => setCurrentScreen('about')}
        >
          <span className="row-ico">
            <Icon name="info" />
          </span>
          <div className="row-main">
            <div className="row-title">{t('set.aboutRow')}</div>
            <div className="row-sub">{t('set.aboutRowSub')}</div>
          </div>
          <Icon name="chevron-right" className="row-chev" />
        </button>

        <div className="row" style={{ cursor: 'default' }}>
          <span className="row-ico">
            <Icon name="info" />
          </span>
          <div className="row-main">
            <div className="row-title">{t('set.version')}</div>
          </div>
          <span className="row-value">1.2.1</span>
        </div>

        <button className="row" type="button" onClick={() => openLegal('terms')}>
          <span className="row-ico">
            <Icon name="file" />
          </span>
          <div className="row-main">
            <div className="row-title">{t('set.terms')}</div>
          </div>
          <Icon name="chevron-right" className="row-chev" />
        </button>

        <button className="row" type="button" onClick={() => openLegal('privacy')}>
          <span className="row-ico">
            <Icon name="lock" />
          </span>
          <div className="row-main">
            <div className="row-title">{t('set.privacy')}</div>
          </div>
          <Icon name="chevron-right" className="row-chev" />
        </button>
      </div>

      {/* Signature */}
      <div className="sig sig-settings">
        <i className="sig-rule" />
        <div className="sig-org">
          <span className="sig-g">Laboratoire</span> <span className="sig-w">du Free-Surf</span>
        </div>
        <div className="sig-credit">
          <span className="sig-by">{t('sig.by')}</span> <b className="sig-name">Philippo</b>
        </div>
        <i className="sig-rule" />
      </div>
    </section>
  );
};
