import React from 'react';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import { Icon } from '../components/SvgIcons';
import { fmtClock, fmtSessionDuration } from '../utils/format';

export const ActivityScreen: React.FC = () => {
  const {
    sessions,
    vpnState,
    vpnSession,
    clearSessions,
    openGuide,
    setCurrentScreen,
    showDialog,
  } = useApp();

  const { t, locale } = useI18n();

  const totalSeconds = sessions
    .filter((s) => s.ok)
    .reduce((sum, s) => sum + s.seconds, 0);

  const fmtDayLabel = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const dayStart = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((dayStart(now) - dayStart(d)) / 86400000);
    if (diff === 0) return t('common.today');
    if (diff === 1) return t('common.yesterday');
    return d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
  };

  // Group sessions by day
  const groupedSessions: { day: string; items: typeof sessions }[] = [];
  sessions.forEach((s) => {
    const day = fmtDayLabel(s.ts);
    let group = groupedSessions.find((g) => g.day === day);
    if (!group) {
      group = { day, items: [] };
      groupedSessions.push(group);
    }
    group.items.push(s);
  });

  const handleClearSessions = () => {
    showDialog({
      title: t('act.clearSessionsTitle'),
      message: t('act.clearSessionsText'),
      confirm: t('common.delete'),
      danger: true,
      onConfirm: clearSessions,
    });
  };

  return (
    <section className="screen active" id="screen-activity" aria-labelledby="actTitle">
      <div className="screen-head">
        <div className="head-title">
          <button
            className="icon-btn back-btn"
            type="button"
            onClick={() => setCurrentScreen('account')}
            aria-label={t('common.back')}
          >
            <Icon name="arrow-left" />
          </button>
          <h1 id="actTitle">{t('act.title')}</h1>
        </div>
        <button
          className="help-btn"
          type="button"
          onClick={() => openGuide('history')}
          title={t('help.open')}
          aria-label={t('help.open')}
        >
          <Icon name="help" />
        </button>
      </div>

      {/* Status Pill */}
      <div className={`status-pill ${vpnState === 'on' ? 'on' : vpnState !== 'off' ? 'busy' : ''}`}>
        <span className="dot" />
        <span>{t(`pill.${vpnState}`)}</span>
      </div>

      {/* Live Connection Info */}
      {vpnState === 'on' && vpnSession ? (
        <div className="card" id="connInfoCard">
          <div className="card-title">{t('act.connInfo')}</div>
          <div className="info-row">
            <span className="k">{t('home.server')}</span>
            <span className="v">{vpnSession.server}</span>
          </div>
          <div className="info-row">
            <span className="k">{t('act.duration')}</span>
            <span className="v">
              {fmtClock(Math.max(0, Math.floor((Date.now() - vpnSession.startedAt) / 1000)))}
            </span>
          </div>
        </div>
      ) : null}

      {/* Sessions Summary */}
      {sessions.length > 0 ? (
        <div className="card" id="actSummary">
          <div className="stat-row">
            <div>
              <div className="stat-v">{sessions.length}</div>
              <div className="stat-k">{t('act.statSessions')}</div>
            </div>
            <div>
              <div className="stat-v">{fmtSessionDuration(totalSeconds)}</div>
              <div className="stat-k">{t('act.statTime')}</div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Sessions List */}
      <div id="actSessions">
        {groupedSessions.length === 0 ? (
          <div className="card primer" style={{ textAlign: 'center', padding: 'var(--sp-5)' }}>
            <Icon
              name="clock"
              style={{ width: '32px', height: '32px', margin: '0 auto var(--sp-2)', color: 'var(--brand)' }}
            />
            <div className="empty-title">{t('act.emptyTitle')}</div>
            <p className="hint">{t('act.emptyText')}</p>
          </div>
        ) : (
          groupedSessions.map((group) => (
            <div key={group.day}>
              <div className="day-head">{group.day}</div>
              <div role="list">
                {group.items.map((item, idx) => {
                  const startTime = new Date(
                    item.ok ? item.ts - item.seconds * 1000 : item.ts
                  ).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

                  return (
                    <div
                      key={idx}
                      className="server-row hist-row"
                      role="listitem"
                      style={{ cursor: 'default' }}
                    >
                      <span className={`hist-dot ${item.ok ? '' : 'fail'}`} aria-hidden="true" />
                      <span className="row-main">
                        <span className="row-title" style={{ display: 'block' }}>
                          {item.server}
                        </span>
                        <span className="row-sub" style={{ display: 'block' }}>
                          {startTime}
                        </span>
                      </span>
                      <span className="hist-meta">
                        <span className="hist-dur">
                          {item.ok ? fmtSessionDuration(item.seconds) : '—'}
                        </span>
                        <span className={`badge ${item.ok ? 'badge-ok' : 'badge-err'}`}>
                          {t(item.ok ? 'act.status.ok' : 'act.status.failed')}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Primer Card */}
      <div className="card primer" style={{ marginTop: 'var(--sp-4)' }}>
        <div className="card-title">{t('act.primer.title')}</div>
        <p className="hint">{t('act.primer.text')}</p>
        <ul className="legend">
          <li>
            <span className="badge badge-ok">{t('act.status.ok')}</span>
            <span>{t('act.primer.ok')}</span>
          </li>
          <li>
            <span className="badge badge-err">{t('act.status.failed')}</span>
            <span>{t('act.primer.failed')}</span>
          </li>
        </ul>
      </div>

      {sessions.length > 0 ? (
        <div className="btn-row" style={{ marginTop: 'var(--sp-4)' }}>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={handleClearSessions}
          >
            <Icon name="trash" />
            <span>{t('act.clearSessions')}</span>
          </button>
        </div>
      ) : null}
    </section>
  );
};
