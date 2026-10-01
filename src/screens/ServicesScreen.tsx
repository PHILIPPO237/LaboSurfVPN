import React from 'react';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import { Icon } from '../components/SvgIcons';

export const ServicesScreen: React.FC = () => {
  const {
    services,
    servicesState,
    servers,
    serversState,
    refreshServices,
    openGuide,
    setCurrentScreen,
    user,
    authToken,
  } = useApp();

  const { t, tn, locale } = useI18n();

  const availableServersCount = servers.filter((s) => s.available).length;

  return (
    <section className="screen active" id="screen-services" aria-labelledby="svcTitle">
      <div className="screen-head">
        <h1 id="svcTitle">{t('svc.title')}</h1>
        <div className="head-actions">
          <button
            className="help-btn"
            type="button"
            onClick={() => openGuide('service')}
            title={t('help.open')}
            aria-label={t('help.open')}
          >
            <Icon name="help" />
          </button>
          <button
            className="icon-btn"
            id="svcRefresh"
            type="button"
            onClick={refreshServices}
            title={t('svc.refresh')}
            aria-label={t('svc.refresh')}
          >
            <Icon name="refresh" />
          </button>
        </div>
      </div>

      <p className="hint">{t('svc.note')}</p>

      {/* Services List */}
      <div id="svcList" aria-live="polite">
        {!authToken ? (
          <div className="card" style={{ textAlign: 'center', padding: 'var(--sp-5)' }}>
            <Icon name="lock" style={{ width: '32px', height: '32px', margin: '0 auto var(--sp-3)', color: 'var(--brand)' }} />
            <div className="empty-title">{t('svc.loginTitle')}</div>
            <p className="hint">{t('svc.loginText')}</p>
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => setCurrentScreen('account')}
            >
              {t('srv.loginCta')}
            </button>
          </div>
        ) : servicesState === 'loading' ? (
          <div className="skeleton" style={{ height: '150px', marginBottom: 'var(--sp-3)' }} />
        ) : !services.length ? (
          <div className="card" style={{ textAlign: 'center', padding: 'var(--sp-5)' }}>
            <Icon name="layers" style={{ width: '32px', height: '32px', margin: '0 auto var(--sp-3)', color: 'var(--brand)' }} />
            <div className="empty-title">{t('svc.emptyTitle')}</div>
            <p className="hint">{t('svc.emptyText')}</p>
          </div>
        ) : (
          services.map((s) => {
            const isActive = s.status === 'active' || s.status === 'actif' || s.status === 'ok';
            const isSuspended = ['suspended', 'blocked', 'disabled', 'inactive'].includes(s.status);
            const badgeClass = isActive ? 'badge-ok' : isSuspended ? 'badge-warn' : 'badge-err';
            const badgeText = isActive ? t('svc.status.active') : isSuspended ? t('svc.status.suspended') : t('svc.status.expired');

            let accessLabel = user ? t(`plan.${user.plan}`) : '—';
            if (user && user.plan !== 'gratuit') {
              accessLabel += ` · ${user.daysLeft !== null ? tn('acc.daysLeft', user.daysLeft) : t('svc.noExpiry')}`;
            }

            const linkedServer = s.serverId !== null ? servers.find((x) => String(x.id) === String(s.serverId)) : null;
            const serverName = linkedServer ? linkedServer.name : s.serverId !== null ? `#${s.serverId}` : t('svc.serverNone');
            const availText = linkedServer ? t(linkedServer.available ? 'svc.avail.up' : 'svc.avail.down') : tn('svc.avail.count', availableServersCount);

            const dateStr = s.createdAt
              ? new Date(s.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
              : '';

            return (
              <article key={s.id || s.type} className="svc-card">
                <div className="svc-head">
                  <span className="row-ico" aria-hidden="true">
                    <Icon name="layers" />
                  </span>
                  <div className="svc-name">{s.type || t('svc.defaultName')}</div>
                  <span className={`badge ${badgeClass}`}>{badgeText}</span>
                </div>
                <div className="info-row">
                  <span className="k">{t('svc.row.access')}</span>
                  <span className="v">{accessLabel}</span>
                </div>
                <div className="info-row">
                  <span className="k">{t('svc.row.server')}</span>
                  <span className="v">{serverName}</span>
                </div>
                <div className="info-row">
                  <span className="k">{t('svc.row.availability')}</span>
                  <span className="v">{availText}</span>
                </div>
                {dateStr ? (
                  <div className="info-row">
                    <span className="k">{t('svc.row.since')}</span>
                    <span className="v">{dateStr}</span>
                  </div>
                ) : null}
              </article>
            );
          })
        )}

        {/* Primer card */}
        <div className="card primer" style={{ marginTop: 'var(--sp-4)' }}>
          <div className="card-title">{t('primer.svc.title')}</div>
          <ol className="steps">
            <li>{t('primer.svc.1')}</li>
            <li>{t('primer.svc.2')}</li>
            <li>{t('primer.svc.3')}</li>
          </ol>
        </div>
      </div>

      {/* Row link to Servers Screen */}
      <div className="section-title">{t('svc.serversTitle')}</div>
      <div className="list">
        <button
          className="row"
          id="svcServersRow"
          type="button"
          onClick={() => setCurrentScreen('servers')}
        >
          <span className="row-ico">
            <Icon name="server" />
          </span>
          <div className="row-main">
            <div className="row-title">{t('nav.servers')}</div>
            <div className="row-sub" id="svcServersSub">
              {serversState === 'loading'
                ? t('svc.serversLoading')
                : tn('srv.summary', availableServersCount, { total: servers.length })}
            </div>
          </div>
          <Icon name="chevron-right" className="row-chev" />
        </button>
      </div>
    </section>
  );
};
