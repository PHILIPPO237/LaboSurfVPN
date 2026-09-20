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
  renderLogs();
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
  renderSessions();
  $('actClearRow').hidden = !(Activity.state === 'ready' && Activity.sessions.length);
  $('actLocalNote').hidden = Activity.state !== 'ready' || !Activity.sessions.length;
  $('actPrimer').hidden = Activity.state !== 'ready' || Activity.sessions.length > 0;   // mode d'emploi tant qu'aucune session n'existe
}

// Écran « Journal et cache » : événements de la session en cours (en mémoire, 200 max)
// Informations de diagnostic : uniquement des valeurs réellement lues dans l'application (rien n'est inventé)
function diagRows(){
  const online = navigator.onLine !== false;
  const srv = { idle: 'diag.srv.idle', loading: 'diag.srv.loading', error: 'diag.srv.error' }[Servers.state];
  return [
    ['diag.version', $('appVersion').textContent || '—'],
    ['diag.env', t(isNativeApp() ? 'diag.envApp' : 'diag.envBrowser')],
    ['diag.lang', I18N.lang === 'fr' ? 'Français' : 'English'],
    ['diag.theme', t(Theme.resolved() === 'dark' ? 'set.themeDark' : 'set.themeLight')],
    ['diag.account', t(authToken ? 'diag.signedIn' : 'diag.signedOut')],
    ['diag.vpn', t('pill.' + VPN.state)],
    ['diag.servers', srv ? t(srv) : tn('srv.summary', Servers.list.filter((x) => x.available).length, { total: Servers.list.length })],
    ['diag.network', t(online ? 'diag.online' : 'diag.offline')],
  ].map(([k, v]) => [t(k), v]);
}
function renderDiag(){
  $('diagCard').innerHTML = diagRows().map(([k, v]) => `<div class="info-row"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join('');
}

// « Copier le rapport » : diagnostic + journal, en texte, pour le support. Aucun identifiant, jeton ni configuration n'y figure.
Actions.copyReport = async () => {
  const lines = ['Labo Surf — ' + t('diag.title'), ...diagRows().map(([k, v]) => k + ' : ' + v), '', t('act.logTitle')];
  Activity.log.slice().reverse().forEach((l) => lines.push(new Date(l.ts).toLocaleTimeString(I18N.locale(), { hour12: false }) + '  ' + t('log.tag.' + l.tag) + '  ' + t(l.key, l.params)));
  if(!Activity.log.length) lines.push(t('act.logEmpty'));
  const text = lines.join('\n');
  let ok = false;
  try{ if(navigator.clipboard && window.isSecureContext){ await navigator.clipboard.writeText(text); ok = true; } }catch(e){}
  if(!ok){
    try{
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove();
    }catch(e){}
  }
  toast(t(ok ? 'diag.copied' : 'diag.copyFail'), ok ? 'success' : 'warning');
};

function renderLogs(){
  renderDiag();
  $('logFeed').innerHTML = Activity.log.length
    ? Activity.log.map((l) => `<div class="log-line"><span class="log-time">${esc(new Date(l.ts).toLocaleTimeString(I18N.locale(), { hour12: false }))}</span>
        <span class="log-tag ${esc(l.tag)}">${esc(t('log.tag.' + l.tag))}</span><span class="log-msg">${esc(t(l.key, l.params))}</span></div>`).join('')
    : `<div class="empty">${esc(t('act.logEmpty'))}</div>`;
  $('logClearRow').hidden = !Activity.log.length;
}

Actions.retryActivity = () => {
  Activity.state = SessionStore.available() ? 'ready' : 'error';
  if(Activity.state === 'ready') Activity.sessions = SessionStore.load();
  renderActivity();
};

Actions.clearActivity = async () => {
  const ok = await confirmDialog({ title: t('act.clearSessionsTitle'), message: t('act.clearSessionsText'), confirm: t('common.delete'), danger: true });
  if(!ok) return;
  Activity.sessions = []; SessionStore.save([]);
  renderActivity();
  toast(t('act.cleared'), 'success');
};

Actions.clearLog = async () => {
  const ok = await confirmDialog({ title: t('act.clearLogTitle'), message: t('act.clearLogText'), confirm: t('common.delete'), danger: true });
  if(!ok) return;
  Activity.log = [];
  renderLogs();
  toast(t('act.cleared'), 'success');
};

// Vider le cache : fichiers d'interface mis en cache (Cache Storage / service worker) et cache web de l'application Android
// (pont natif), puis rechargement. Le compte, les réglages et l'historique local ne sont PAS touchés.
// Refusé pendant une connexion VPN : le rechargement remet l'affichage à zéro.
Actions.clearCache = async () => {
  if(VPN.state !== 'off' && VPN.state !== 'error'){ toast(t('cache.vpnActive'), 'warning'); return; }
  const ok = await confirmDialog({ title: t('cache.confirmTitle'), message: t('cache.confirmText'), confirm: t('cache.confirm') });
  if(!ok) return;
  try{ if(window.caches){ const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); } }catch(e){}
  try{ if(navigator.serviceWorker){ const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map((r) => r.unregister())); } }catch(e){}
  try{ if(isNativeApp() && typeof window.LaboSurfNative.clearWebCache === 'function') window.LaboSurfNative.clearWebCache(); }catch(e){}
  try{ sessionStorage.setItem('ls.cacheCleared', '1'); }catch(e){}
  location.reload();
};

document.addEventListener('langchange', () => { renderActivity(); renderLogs(); });
document.addEventListener('themechange', renderLogs);
