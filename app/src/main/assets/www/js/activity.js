// Historique : sessions (historique local de CET appareil) et journal technique de la session en cours.
// Aucune entrée de démonstration : tout ce qui s'affiche a réellement eu lieu.
// Les sessions sont conservées localement (50 max) ; le journal reste en mémoire (200 max).
//
// États : ready (avec ou sans sessions) · loading · error. Aujourd'hui l'historique est purement local, donc il est
// prêt immédiatement ; « loading » est prévu pour le jour où l'historique viendra du serveur (voir SessionStore),
// et « error » signale que l'appareil ne permet pas de conserver l'historique.

// Point unique d'accès au stockage de l'historique : si l'historique doit un jour être conservé
// ailleurs (ou supprimé), seul cet objet change. Les données lues sont validées (jamais de confiance aveugle).
const SessionStore = {
  available(){
    try{ localStorage.setItem('ls.__probe', '1'); localStorage.removeItem('ls.__probe'); return true; }catch(e){ return false; }
  },
  load(){
    const raw = store.get('sessions', []);
    return (Array.isArray(raw) ? raw : []).filter((h) => h && typeof h.ts === 'number' && typeof h.seconds === 'number' && typeof h.ok === 'boolean').slice(0, 50);
  },
  save(list){ store.set('sessions', list); },
};

const Activity = {
  view: 'sessions',
  state: SessionStore.available() ? 'ready' : 'error',   // ready | loading | error
  sessions: SessionStore.load(),         // { server, ts (fin de session / tentative), seconds, ok }
  log: [],                               // { ts, tag, key, params } — traduit à l'affichage
  addSession(entry){
    this.sessions.unshift({ server: String(entry.server || ''), ts: Date.now(), seconds: entry.seconds, ok: entry.ok });
    if(this.sessions.length > 50) this.sessions.length = 50;
    SessionStore.save(this.sessions);
    renderActivity();
  },
};

function logEvent(tag, key, params){
  Activity.log.unshift({ ts: Date.now(), tag, key, params });
  if(Activity.log.length > 200) Activity.log.pop(); // évite une liste sans fin lors d'un usage prolongé
  renderActivity();
}

function fmtDayLabel(ts){
  const d = new Date(ts), now = new Date();
  const dayStart = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((dayStart(now) - dayStart(d)) / 86400000);
  if(diff === 0) return t('common.today');
  if(diff === 1) return t('common.yesterday');
  return d.toLocaleDateString(I18N.locale(), { weekday: 'long', day: 'numeric', month: 'long' });
}

function sessionRowHtml(h){
  // Serveur · heure de DÉBUT · durée · statut (texte + couleur, jamais la couleur seule)
  const start = h.ok ? h.ts - h.seconds * 1000 : h.ts;
  const time = new Date(start).toLocaleTimeString(I18N.locale(), { hour: '2-digit', minute: '2-digit' });
  return `<div class="server-row hist-row" role="listitem" style="cursor:default">
    <span class="hist-dot${h.ok ? '' : ' fail'}" aria-hidden="true"></span>
    <span class="row-main"><span class="row-title" style="display:block">${esc(h.server || '—')}</span><span class="row-sub" style="display:block">${esc(time)}</span></span>
    <span class="hist-meta"><span class="hist-dur">${esc(h.ok ? fmtSessionDuration(h.seconds) : '—')}</span>
      <span class="badge ${h.ok ? 'badge-ok' : 'badge-err'}">${esc(t(h.ok ? 'act.status.ok' : 'act.status.failed'))}</span></span></div>`;
}

function renderSessions(){
  const host = $('histList');
  const summary = $('actSummary');
  summary.hidden = true;
  if(Activity.state === 'loading'){
    host.innerHTML = '<div class="skeleton"></div>'.repeat(3);
    return;
  }
  if(Activity.state === 'error'){
    host.innerHTML = `<div class="empty">${ic('alert-circle')}<div class="empty-title">${esc(t('act.errorTitle'))}</div><div>${esc(t('act.errorText'))}</div>
      <button class="btn btn-secondary" type="button" data-action="retryActivity">${esc(t('common.retry'))}</button></div>`;
    return;
  }
  if(!Activity.sessions.length){
    host.innerHTML = `<div class="empty">${ic('clock')}<div class="empty-title">${esc(t('act.emptyTitle'))}</div><div>${esc(t('act.emptyText'))}</div></div>`;
    return;
  }
  const done = Activity.sessions.filter((h) => h.ok);
  $('actCount').textContent = String(Activity.sessions.length);
  $('actTotal').textContent = fmtSessionDuration(done.reduce((sum, h) => sum + h.seconds, 0));
  summary.hidden = false;
  // Groupées par jour, la plus récente d'abord (la liste est déjà ordonnée)
  let html = '', lastDay = '';
  Activity.sessions.forEach((h) => {
    const day = fmtDayLabel(h.ts);
    if(day !== lastDay){
      if(lastDay) html += '</div>';
      html += `<div class="day-head">${esc(day)}</div><div role="list">`;
      lastDay = day;
    }
    html += sessionRowHtml(h);
  });
  host.innerHTML = html + '</div>';
}

function renderActivity(){
  const view = Activity.view;
  $('actSessions').hidden = view !== 'sessions';
  $('actLog').hidden = view !== 'log';
  document.querySelectorAll('#segActivity button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === view)));

  renderSessions();

  const feed = $('logFeed');
  feed.innerHTML = Activity.log.length
    ? Activity.log.map((l) => `<div class="log-line"><span class="log-time">${esc(new Date(l.ts).toLocaleTimeString(I18N.locale(), { hour12: false }))}</span>
        <span class="log-tag ${esc(l.tag)}">${esc(t('log.tag.' + l.tag))}</span><span class="log-msg">${esc(t(l.key, l.params))}</span></div>`).join('')
    : `<div class="empty">${esc(t('act.logEmpty'))}</div>`;

  const isSessions = view === 'sessions';
  const canClear = Activity.state === 'ready' && (isSessions ? Activity.sessions.length : Activity.log.length);
  $('actClearRow').hidden = !canClear;
  $('actLocalNote').hidden = !isSessions || Activity.state !== 'ready' || !Activity.sessions.length;
  const label = $('actClearRow').querySelector('span');
  label.setAttribute('data-i18n', isSessions ? 'act.clearSessions' : 'act.clearLog');
  label.textContent = t(isSessions ? 'act.clearSessions' : 'act.clearLog');
}

Actions.setActivityView = (el) => { Activity.view = el.dataset.value; renderActivity(); };
Actions.retryActivity = () => {
  Activity.state = SessionStore.available() ? 'ready' : 'error';
  if(Activity.state === 'ready') Activity.sessions = SessionStore.load();
  renderActivity();
};

Actions.clearActivity = async () => {
  const sessions = Activity.view === 'sessions';
  const ok = await confirmDialog({
    title: t(sessions ? 'act.clearSessionsTitle' : 'act.clearLogTitle'),
    message: t(sessions ? 'act.clearSessionsText' : 'act.clearLogText'),
    confirm: t('common.delete'), danger: true,
  });
  if(!ok) return;
  if(sessions){ Activity.sessions = []; SessionStore.save([]); } else Activity.log = [];
  renderActivity();
  toast(t('act.cleared'), 'success');
};

document.addEventListener('langchange', renderActivity);
