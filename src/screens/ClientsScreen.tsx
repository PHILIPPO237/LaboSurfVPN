import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import { Icon } from '../components/SvgIcons';
import { fmtGB } from '../utils/format';

export const ClientsScreen: React.FC = () => {
  const { clients, pendingRequests, createClient, setCurrentScreen, addToast } = useApp();
  const { t } = useI18n();

  const [openCreate, setOpenCreate] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [plan, setPlan] = useState('VIP');
  const [quota, setQuota] = useState('50');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  const activeCount = clients.filter((c) => c.active).length;

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      addToast(t('err.fillFields') || 'Veuillez remplir tous les champs', 'warning');
      return;
    }
    setLoading(true);
    await createClient({
      username: username.trim(),
      userType: plan,
      quotaGB: parseFloat(quota) || 50,
      active: true,
      notes: notes.trim(),
    });
    setLoading(false);
    setUsername('');
    setPassword('');
    setNotes('');
    setOpenCreate(false);
    addToast(t('cli.created') || 'Client créé avec succès !', 'success');
  };

  return (
    <section className="screen active" id="screen-clients" aria-labelledby="cliTitle">
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
          <h1 id="cliTitle">{t('cli.title')}</h1>
        </div>
      </div>

      {/* Collapsible Create Client Form */}
      <details
        className="card collapsible"
        id="createClientCard"
        open={openCreate}
        onToggle={(e) => setOpenCreate((e.target as HTMLDetailsElement).open)}
      >
        <summary className="card-title" style={{ marginBottom: 0, cursor: 'pointer' }}>
          <span>{t('cli.create')}</span>
          <Icon name="chevron-down" className="chev" />
        </summary>
        <form className="collapsible-body" onSubmit={handleCreateSubmit} noValidate style={{ marginTop: 'var(--sp-3)' }}>
          <label className="field">
            <span className="field-label">{t('cli.username')}</span>
            <input
              className="input"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t('cli.usernamePh')}
              autoCapitalize="off"
            />
          </label>
          <label className="field">
            <span className="field-label">{t('cli.tempPassword')}</span>
            <input
              className="input"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('cli.tempPasswordPh')}
              autoCapitalize="off"
            />
          </label>
          <label className="field">
            <span className="field-label">{t('cli.plan')}</span>
            <select className="select" value={plan} onChange={(e) => setPlan(e.target.value)}>
              <option value="VIP">VIP (Premium)</option>
              <option value="Gratuit">{t('plan.gratuit')}</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">{t('cli.quota')}</span>
            <input
              className="input"
              type="number"
              value={quota}
              onChange={(e) => setQuota(e.target.value)}
              placeholder={t('cli.quotaPh')}
            />
          </label>
          <label className="field">
            <span className="field-label">{t('cli.notes')}</span>
            <input
              className="input"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('cli.notesPh')}
            />
          </label>
          <button className={`btn btn-primary btn-block ${loading ? 'is-loading' : ''}`} type="submit" disabled={loading}>
            {t('cli.createBtn')}
          </button>
        </form>
      </details>

      {/* Pending Requests */}
      <div className="section-title">{t('cli.pending')}</div>
      <div id="pendingRequestsList">
        {!pendingRequests.length ? (
          <div className="card" style={{ padding: 'var(--sp-3)', textAlign: 'center' }}>
            <p className="hint" style={{ margin: 0 }}>
              {t('cli.noPending') || 'Aucune demande en attente.'}
            </p>
          </div>
        ) : (
          pendingRequests.map((r) => (
            <div key={r.id} className="card" style={{ marginBottom: '8px', padding: 'var(--sp-3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600 }}>{r.username}</span>
                <span className="badge badge-warn">{r.type}</span>
              </div>
              {r.message ? <p className="hint" style={{ marginTop: '4px', marginBottom: '4px' }}>{r.message}</p> : null}
              <div style={{ fontSize: '11px', color: 'var(--text-faint)' }}>{r.date}</div>
            </div>
          ))
        )}
      </div>

      {/* Summary */}
      <div className="section-title">{t('cli.myClients')}</div>
      <div className="card" id="clientsSummaryCard">
        <div className="stat-row">
          <div>
            <div className="stat-v" id="clientsCountTotal">
              {clients.length}
            </div>
            <div className="stat-k">{t('cli.total')}</div>
          </div>
          <div>
            <div className="stat-v" id="clientsCountActive">
              {activeCount}
            </div>
            <div className="stat-k">{t('cli.active')}</div>
          </div>
        </div>
      </div>

      {/* Clients List */}
      <div id="clientsList">
        {clients.map((c) => (
          <div key={c.id} className="row" style={{ cursor: 'default', marginBottom: '8px' }}>
            <span className="row-ico">
              <Icon name="user" />
            </span>
            <div className="row-main">
              <div className="row-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>{c.username}</span>
                <span className={`badge ${c.userType === 'VIP' ? 'badge-vip' : ''}`}>
                  {c.userType}
                </span>
              </div>
              <div className="row-sub">
                {fmtGB(c.quotaGB)} {c.notes ? `· ${c.notes}` : ''}
              </div>
            </div>
            <span className={`badge ${c.active ? 'badge-ok' : 'badge-err'}`}>
              {c.active ? 'Actif' : 'Bloqué'}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
};
