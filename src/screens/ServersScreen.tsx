import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import { Icon } from '../components/SvgIcons';
import { Server } from '../types';

export const ServersScreen: React.FC = () => {
  const {
    servers,
    serversState,
    profiles,
    selectedServerId,
    selectedProfileId,
    setSelectedServerId,
    setSelectedProfileId,
    refreshServers,
    openGuide,
    setCurrentScreen,
    addToast,
  } = useApp();

  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredServers = servers.filter((s) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.country.toLowerCase().includes(q) ||
      s.city.toLowerCase().includes(q)
    );
  });

  const handleSelectServer = (server: Server) => {
    setSelectedServerId(server.id);
    setSelectedProfileId(null); // return to automatic profile on new server
    addToast(t('srv.appliedNext'), 'info');
  };

  const handleSelectProfile = (profileId: number | null) => {
    setSelectedProfileId(profileId);
    addToast(t('srv.appliedNext'), 'info');
  };

  const countryFlagEmoji = (code: string) => {
    if (!code || code.length !== 2) return '🌐';
    return String.fromCodePoint(
      ...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
    );
  };

  return (
    <section className="screen active" id="screen-servers" aria-labelledby="srvTitle">
      <div className="screen-head">
        <div className="head-title">
          <button
            className="icon-btn back-btn"
            type="button"
            onClick={() => setCurrentScreen('services')}
            aria-label={t('common.back')}
          >
            <Icon name="arrow-left" />
          </button>
          <h1 id="srvTitle">{t('srv.title')}</h1>
        </div>
        <div className="head-actions">
          <button
            className="help-btn"
            type="button"
            onClick={() => openGuide('server')}
            title={t('help.open')}
            aria-label={t('help.open')}
          >
            <Icon name="help" />
          </button>
          <button
            className="icon-btn"
            id="srvRefresh"
            type="button"
            onClick={refreshServers}
            aria-label={t('srv.refresh')}
          >
            <Icon name="refresh" />
          </button>
        </div>
      </div>

      <p className="hint">{t('srv.note')}</p>

      {/* Search Bar */}
      <div className="search" id="srvSearchWrap" style={{ display: 'flex' }}>
        <Icon name="search" />
        <input
          className="input"
          id="srvSearch"
          type="search"
          autoComplete="off"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('srv.search')}
          aria-label={t('srv.search')}
        />
      </div>

      {/* Profiles Section */}
      {profiles.length > 0 ? (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <div className="section-title">{t('prof.section')}</div>
          {/* Automatic */}
          <button
            type="button"
            className={`server-row ${selectedProfileId === null ? 'is-active' : ''}`}
            role="radio"
            aria-checked={selectedProfileId === null}
            onClick={() => handleSelectProfile(null)}
          >
            <span className="avatar" aria-hidden="true">
              <Icon name="server" />
            </span>
            <span className="row-main">
              <span className="row-title" style={{ display: 'block' }}>
                {t('prof.auto')}
              </span>
              <span className="row-sub" style={{ display: 'block' }}>
                {t('prof.autoSub')}
              </span>
            </span>
            <span className="radio" aria-hidden="true">
              <Icon name="check" />
            </span>
          </button>

          {/* Profile options */}
          {profiles.map((p) => {
            const isSelected = selectedProfileId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                className={`server-row ${isSelected ? 'is-active' : ''}`}
                role="radio"
                aria-checked={isSelected}
                onClick={() => handleSelectProfile(p.id)}
              >
                <span className="avatar" aria-hidden="true">
                  <Icon name="layers" />
                </span>
                <span className="row-main">
                  <span className="row-title" style={{ display: 'block' }}>
                    {p.name}
                  </span>
                  <span className="row-sub" style={{ display: 'block' }}>
                    {p.serverName} · {p.city}, {p.country}
                  </span>
                </span>
                <span className="radio" aria-hidden="true">
                  <Icon name="check" />
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Server list */}
      <div className="section-title">{t('nav.servers')}</div>
      <div id="srvList" role="radiogroup" aria-label={t('srv.title')}>
        {serversState === 'loading' ? (
          <div className="skeleton" style={{ height: '60px', marginBottom: '8px' }} />
        ) : !filteredServers.length ? (
          <div className="card" style={{ textAlign: 'center', padding: 'var(--sp-4)' }}>
            <p className="hint">{t('srv.noResult')}</p>
          </div>
        ) : (
          filteredServers.map((s) => {
            const isSelected = String(s.id) === String(selectedServerId) && selectedProfileId === null;
            const flag = countryFlagEmoji(s.countryCode);
            const statusLabel =
              s.status === 'offline'
                ? t('srv.status.offline')
                : s.status === 'maintenance'
                ? t('srv.status.maintenance')
                : s.status === 'busy'
                ? t('srv.status.busy')
                : null;

            return (
              <button
                key={s.id}
                type="button"
                className={`server-row ${isSelected ? 'is-active' : ''} ${!s.available ? 'is-down' : ''}`}
                role="radio"
                aria-checked={isSelected}
                onClick={() => handleSelectServer(s)}
                disabled={!s.available}
              >
                <span className="avatar" aria-hidden="true" style={{ fontSize: '20px' }}>
                  {flag}
                </span>
                <span className="row-main">
                  <span className="row-title" style={{ display: 'block' }}>
                    {s.name}
                  </span>
                  <span className="row-sub" style={{ display: 'block' }}>
                    {s.city ? `${s.city}, ${s.country}` : s.country}
                  </span>
                  <span className="server-meta">
                    {s.ping !== null ? (
                      <span className="meta-pill">{s.ping} ms</span>
                    ) : null}
                    {s.load !== null ? (
                      <span className="meta-pill">
                        {t('srv.load')} {s.load}%
                      </span>
                    ) : null}
                    {statusLabel ? (
                      <span className={`badge ${s.status === 'busy' ? 'badge-warn' : 'badge-err'}`}>
                        {statusLabel}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="radio" aria-hidden="true">
                  <Icon name="check" />
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* Legend Card */}
      <div className="card primer" style={{ marginTop: 'var(--sp-5)' }}>
        <div className="card-title">{t('srv.legend.title')}</div>
        <ul className="legend">
          <li>
            <span className="badge badge-ok">{t('srv.legend.up')}</span>
            <span>{t('srv.legend.upText')}</span>
          </li>
          <li>
            <span className="badge badge-warn">{t('srv.status.busy')}</span>
            <span>{t('srv.legend.busyText')}</span>
          </li>
          <li>
            <span className="badge badge-err">{t('srv.status.offline')}</span>
            <span>{t('srv.legend.offText')}</span>
          </li>
        </ul>
      </div>
    </section>
  );
};
