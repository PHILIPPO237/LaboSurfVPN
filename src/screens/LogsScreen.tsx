import React from 'react';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import { useTheme } from '../context/ThemeContext';
import { Icon } from '../components/SvgIcons';

export const LogsScreen: React.FC = () => {
  const {
    eventLogs,
    clearLogs,
    copyReport,
    servers,
    serversState,
    vpnState,
    user,
    apiBase,
    showDialog,
    addToast,
  } = useApp();

  const { lang, t, tn, locale } = useI18n();
  const { resolvedTheme } = useTheme();

  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;

  const serverSummary =
    serversState === 'loading'
      ? t('diag.srv.loading')
      : serversState === 'error'
      ? t('diag.srv.error')
      : tn('srv.summary', servers.filter((s) => s.available).length, { total: servers.length });

  const handleClearCache = () => {
    if (vpnState !== 'off' && vpnState !== 'error') {
      addToast(t('cache.vpnActive'), 'warning');
      return;
    }
    showDialog({
      title: t('cache.confirmTitle'),
      message: t('cache.confirmText'),
      confirm: t('cache.confirm'),
      onConfirm: () => {
        try {
          if (window.caches) {
            caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
          }
        } catch (e) {
          // ignore
        }
        addToast(t('cache.done'), 'success');
        setTimeout(() => window.location.reload(), 300);
      },
    });
  };

  const handleClearLogs = () => {
    showDialog({
      title: t('act.clearLogTitle'),
      message: t('act.clearLogText'),
      confirm: t('common.delete'),
      danger: true,
      onConfirm: clearLogs,
    });
  };

  return (
    <section className="screen active" id="screen-logs" aria-labelledby="logsTitle">
      <div className="screen-head">
        <h1 id="logsTitle">{t('logs.title')}</h1>
      </div>

      {/* Diagnostics Card */}
      <div className="section-title">{t('diag.title')}</div>
      <div className="card" id="diagCard">
        <div className="info-row">
          <span className="k">{t('diag.version')}</span>
          <span className="v">1.2.1</span>
        </div>
        <div className="info-row">
          <span className="k">{t('diag.env')}</span>
          <span className="v">{t('diag.envBrowser')}</span>
        </div>
        <div className="info-row">
          <span className="k">{t('diag.lang')}</span>
          <span className="v">{lang === 'fr' ? 'Français' : 'English'}</span>
        </div>
        <div className="info-row">
          <span className="k">{t('diag.theme')}</span>
          <span className="v">{resolvedTheme === 'dark' ? t('set.themeDark') : t('set.themeLight')}</span>
        </div>
        <div className="info-row">
          <span className="k">{t('diag.account')}</span>
          <span className="v">{user ? `${user.username} (${user.role})` : t('diag.signedOut')}</span>
        </div>
        <div className="info-row">
          <span className="k">{t('diag.vpn')}</span>
          <span className="v">{t(`pill.${vpnState}`)}</span>
        </div>
        <div className="info-row">
          <span className="k">{t('diag.servers')}</span>
          <span className="v">{serverSummary}</span>
        </div>
        <div className="info-row">
          <span className="k">{t('diag.network')}</span>
          <span className="v">{isOnline ? t('diag.online') : t('diag.offline')}</span>
        </div>
      </div>

      <div className="btn-row" style={{ marginBottom: 'var(--sp-4)' }}>
        <button className="btn btn-secondary btn-sm" type="button" onClick={copyReport}>
          <Icon name="file" />
          <span>{t('diag.copy')}</span>
        </button>
      </div>

      {/* Event Logs Feed */}
      <div className="section-title">
        <span>{t('act.logTitle')}</span>
      </div>
      <p className="hint">{t('logs.hint')}</p>

      <div className="log-feed" id="logFeed">
        {!eventLogs.length ? (
          <div className="empty">{t('act.logEmpty')}</div>
        ) : (
          eventLogs.map((l, i) => (
            <div key={i} className="log-line">
              <span className="log-time">
                {new Date(l.ts).toLocaleTimeString(locale, { hour12: false })}
              </span>
              <span className={`log-tag ${l.tag}`}>{t(`log.tag.${l.tag}`)}</span>
              <span className="log-msg">{t(l.key, l.params)}</span>
            </div>
          ))
        )}
      </div>

      {eventLogs.length > 0 ? (
        <div className="btn-row" style={{ marginTop: 'var(--sp-3)', marginBottom: 'var(--sp-5)' }}>
          <button className="btn btn-secondary btn-sm" type="button" onClick={handleClearLogs}>
            <Icon name="trash" />
            <span>{t('act.clearLog')}</span>
          </button>
        </div>
      ) : null}

      {/* Cache Storage Section */}
      <div className="section-title">{t('cache.section')}</div>
      <div className="list">
        <button className="row" type="button" onClick={handleClearCache}>
          <span className="row-ico">
            <Icon name="refresh" />
          </span>
          <div className="row-main">
            <div className="row-title">{t('cache.title')}</div>
            <div className="row-sub">{t('cache.sub')}</div>
          </div>
        </button>
      </div>
    </section>
  );
};
