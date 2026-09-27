// Serveurs : liste fournie par l'API (/api/user/servers), sélection, recherche.
// Aucune donnée fictive : sans réponse de l'API, on affiche un état propre (connexion requise,
// chargement, erreur, liste vide). Les champs optionnels (ping, statut, charge) ne s'affichent
// que si l'API les fournit — voir normalizeServer().

const Servers = {
  list: [],
  state: 'idle',       // idle (non connecté) | loading | ready | error
  selectedId: store.get('server', null),
  query: '',
};
const SEARCH_THRESHOLD = 5; // la recherche apparaît au-delà de ce nombre de serveurs

// Profils au choix : GET /api/user/connect/options (le panel n'y met que ceux réellement disponibles).
// Sans choix (« Automatique »), la connexion garde le comportement historique : le panel choisit sur le serveur retenu.
const Profiles = {
  list: [],
  state: 'idle',       // idle | loading | ready | error | unsupported (panel sans cette route : section masquée)
  selectedId: store.get('hostedProfile', null),
};

function toNumber(v){
  if(typeof v === 'number' && isFinite(v)) return v;
  if(typeof v === 'string' && v.trim() !== '' && isFinite(+v)) return +v;
  return null;
}

// Champs lus dans l'API : id, name, country, city (existants) +, s'ils existent,
// ping | latency | latency_ms, status | online, load | load_percent, country_code | flag.
function normalizeServer(s, i){
  const rawStatus = String(s.status === undefined || s.status === null ? '' : s.status).toLowerCase();
  let status = null;
  if(s.online === false) status = 'offline';
  else if(['offline', 'down', 'unavailable', 'disabled'].includes(rawStatus)) status = 'offline';
  else if(rawStatus === 'maintenance') status = 'maintenance';
  else if(['busy', 'full', 'overloaded'].includes(rawStatus)) status = 'busy';
  else if(s.online === true || ['online', 'ok', 'up', 'active'].includes(rawStatus)) status = 'online';
  const code = String(s.country_code || s.flag || '').trim();
  return {
    id: s.id,
    index: i,
    name: s.name || '',
    country: s.country || '',
    city: s.city || '',
    countryCode: /^[A-Za-z]{2}$/.test(code) ? code.toUpperCase() : '',
    ping: toNumber(s.ping !== undefined ? s.ping : (s.latency !== undefined ? s.latency : s.latency_ms)),
    load: toNumber(s.load !== undefined ? s.load : s.load_percent),
    status,
    available: status !== 'offline' && status !== 'maintenance',
  };
}

const serverDisplayName = (s) => s.name || t('srv.defaultName', { n: s.index + 1 });
const sameId = (a, b) => a !== undefined && a !== null && String(a) === String(b);

function flagEmoji(code){
  return String.fromCodePoint(...[...code].map((c) => 0x1F1E6 + c.charCodeAt(0) - 65));
}
function serverAvatar(s){
  if(s.countryCode) return flagEmoji(s.countryCode);
  return esc((s.city || serverDisplayName(s)).trim().charAt(0).toUpperCase() || '?');
}
const serverLocation = (s) => [s.city, s.country].filter(Boolean).join(', ');

// Serveur choisi : mémorisé, sinon le premier disponible
function getSelectedServer(){
  if(!Servers.list.length) return null;
  return Servers.list.find((s) => sameId(s.id, Servers.selectedId) && s.id !== undefined)
    || Servers.list.find((s) => s.available)
    || Servers.list[0];
}

// Profil choisi : seulement s'il figure dans la dernière liste du panel (jamais un identifiant périmé envoyé à l'aveugle)
function getSelectedProfile(){
  if(Profiles.state !== 'ready' || Profiles.selectedId === null || Profiles.selectedId === undefined) return null;
  return Profiles.list.find((p) => sameId(p.id, Profiles.selectedId)) || null;
}
const profileDisplayName = (p) => p.name || t('prof.defaultName', { n: p.id });
const profileLocation = (p) => [p.serverName, [p.city, p.country].filter(Boolean).join(', ')].filter(Boolean).join(' · ');

function profileRowHtml(p, selected){
  const badge = p.health === 'unknown' ? `<span class="server-meta"><span class="badge badge-warn">${esc(t('prof.healthUnknown'))}</span></span>` : '';
  return `<button type="button" class="server-row${selected ? ' is-active' : ''}"
      role="radio" aria-checked="${selected}" data-action="selectProfile" data-pid="${esc(String(p.id))}">
    <span class="avatar" aria-hidden="true">${ic('layers')}</span>
    <span class="row-main"><span class="row-title" style="display:block">${esc(profileDisplayName(p))}</span><span class="row-sub" style="display:block">${esc(profileLocation(p) || t('srv.locationUnknown'))}</span>${badge}</span>
    <span class="radio" aria-hidden="true">${ic('check')}</span>
  </button>`;
}

// Section « Profil de connexion » : affichée seulement si le panel propose au moins un profil
function profilesSectionHtml(){
  if(Profiles.state !== 'ready' || !Profiles.list.length) return '';
  const chosen = getSelectedProfile();
  const auto = `<button type="button" class="server-row${chosen ? '' : ' is-active'}" role="radio" aria-checked="${!chosen}" data-action="selectProfile" data-pid="">
    <span class="avatar" aria-hidden="true">${ic('server')}</span>
    <span class="row-main"><span class="row-title" style="display:block">${esc(t('prof.auto'))}</span><span class="row-sub" style="display:block">${esc(t('prof.autoSub'))}</span></span>
    <span class="radio" aria-hidden="true">${ic('check')}</span>
  </button>`;
  return `<div class="section-title">${esc(t('prof.section'))}</div>` + auto + Profiles.list.map((p) => profileRowHtml(p, chosen === p)).join('');
}

function pingClass(p){ return p < 70 ? 'good' : (p < 150 ? 'mid' : 'bad'); }
function pingChip(s){ return s.ping === null ? '' : `<span class="ping ${pingClass(s.ping)}">${Math.round(s.ping)} ms</span>`; }

function statusBadge(s){
  if(s.status === 'offline') return `<span class="badge badge-err">${esc(t('srv.status.offline'))}</span>`;
  if(s.status === 'maintenance') return `<span class="badge badge-warn">${esc(t('srv.status.maintenance'))}</span>`;
  if(s.status === 'busy') return `<span class="badge badge-warn">${esc(t('srv.status.busy'))}</span>`;
  return '';
}

function serverRowHtml(s, selected){
  const sub = serverLocation(s) || t('srv.locationUnknown');
  const load = s.load === null ? '' : `<span class="load-bar" title="${esc(t('srv.load'))} ${Math.round(s.load)}%"><i class="${s.load >= 85 ? 'high' : (s.load >= 60 ? 'mid' : '')}" style="width:${Math.max(4, Math.min(100, s.load))}%"></i></span>`;
  const badge = statusBadge(s);
  const meta = (pingChip(s) || badge || load) ? `<span class="server-meta">${badge}${pingChip(s)}${load}</span>` : '';
  return `<button type="button" class="server-row${selected ? ' is-active' : ''}${s.available ? '' : ' is-disabled'}"
      role="radio" aria-checked="${selected}" data-action="selectServer" data-index="${s.index}">
    <span class="avatar" aria-hidden="true">${serverAvatar(s)}</span>
    <span class="row-main"><span class="row-title" style="display:block">${esc(serverDisplayName(s))}</span><span class="row-sub" style="display:block">${esc(sub)}</span>${meta}</span>
    <span class="radio" aria-hidden="true">${ic('check')}</span>
  </button>`;
}

function emptyBlock(icon, titleKey, textKey, actionHtml){
  return `<div class="empty">${ic(icon)}<div class="empty-title">${esc(t(titleKey))}</div>${textKey ? `<div>${esc(t(textKey))}</div>` : ''}${actionHtml || ''}</div>`;
}

// Contenu d'aide FIXE (texte de l'application, jamais une donnée du panel) affiché sous les états vides ou en attente de connexion.
function primerHtml(titleKey, stepKeys){
  return `<div class="card primer"><div class="card-title">${esc(t(titleKey))}</div><ol class="steps">${stepKeys.map((k) => `<li><span>${esc(t(k))}</span></li>`).join('')}</ol></div>`;
}
// Légende des pastilles de statut d'un serveur (mêmes libellés et couleurs que les lignes de la liste)
function serverLegendHtml(){
  const row = (cls, label, text) => `<li><span class="badge ${cls}">${esc(t(label))}</span><span>${esc(t(text))}</span></li>`;
  return `<div class="card primer"><div class="card-title">${esc(t('srv.legend.title'))}</div><ul class="legend">`
    + row('badge-ok', 'srv.legend.up', 'srv.legend.upText') + row('badge-warn', 'srv.status.busy', 'srv.legend.busyText')
    + row('badge-warn', 'srv.status.maintenance', 'srv.legend.maintText') + row('badge-err', 'srv.status.offline', 'srv.legend.offText') + '</ul></div>';
}

function renderServers(){
  const host = $('srvList');
  const searchWrap = $('srvSearchWrap');
  $('srvLegend').innerHTML = Servers.state === 'loading' ? '' : serverLegendHtml();   // légende des statuts (texte fixe)
  searchWrap.hidden = !(Servers.state === 'ready' && Servers.list.length > SEARCH_THRESHOLD);

  if(Servers.state === 'idle'){
    host.innerHTML = emptyBlock('lock', 'srv.loginTitle', 'srv.loginText',
      `<button class="btn btn-primary" type="button" data-action="nav" data-screen="account">${esc(t('srv.loginCta'))}</button>`);
  } else if(Servers.state === 'loading'){
    host.innerHTML = '<div class="skeleton"></div>'.repeat(4);
  } else if(Servers.state === 'error'){
    host.innerHTML = emptyBlock('alert-circle', 'srv.errorTitle', 'srv.errorText',
      `<button class="btn btn-secondary" type="button" data-action="refreshServers">${esc(t('common.retry'))}</button>`);
  } else if(!Servers.list.length){
    host.innerHTML = emptyBlock('server', 'srv.emptyTitle', 'srv.emptyText');
  } else {
    const q = Servers.query.trim().toLowerCase();
    const selected = getSelectedServer();
    const rows = Servers.list.filter((s) => !q || [serverDisplayName(s), s.country, s.city].join(' ').toLowerCase().includes(q));
    if(!rows.length){
      host.innerHTML = emptyBlock('search', 'srv.noResult', null);
    } else {
      // Hiérarchie : le serveur retenu en tête, puis les disponibles, puis les indisponibles (jamais mélangés)
      const section = (key, list) => list.length
        ? `<div class="section-title">${esc(t(key))}</div>` + list.map((s) => serverRowHtml(s, selected === s)).join('') : '';
      const chosen = selected && rows.includes(selected) ? [selected] : [];
      const others = rows.filter((s) => s !== selected);
      const availableCount = Servers.list.filter((s) => s.available).length;
      host.innerHTML = `<p class="srv-summary">${esc(tn('srv.summary', availableCount, { total: Servers.list.length }))}</p>`
        + (q ? '' : profilesSectionHtml())
        + section('srv.sectionSelected', chosen)
        + section('srv.sectionAvailable', others.filter((s) => s.available))
        + section('srv.sectionDown', others.filter((s) => !s.available));
    }
  }
  if(typeof renderServices === 'function') renderServices();   // ligne « Serveurs » de la page Services
  renderHome();   // met à jour la carte serveur ET l'état de préparation de l'accueil
}

async function loadServers(){
  if(!authToken){
    Servers.state = 'idle'; Servers.list = [];
    Profiles.state = 'idle'; Profiles.list = [];
    renderServers();
    return;
  }
  Servers.state = 'loading';
  renderServers();
  $('srvRefresh').classList.add('is-spinning');
  try{
    const res = await apiFetch('/api/user/servers');
    if(res.ok && res.data && res.data.status === 'ok' && Array.isArray(res.data.servers)){
      Servers.list = res.data.servers.map(normalizeServer);
      Servers.state = 'ready';
      if(getSelectedServer()) Servers.selectedId = getSelectedServer().id;
    } else if(!res.expired){
      Servers.state = 'error';
    }
  }catch(e){
    Servers.state = 'error';
  }finally{
    $('srvRefresh').classList.remove('is-spinning');
  }
  if(authToken) renderServers();
  if(authToken && Servers.state === 'ready') await loadProfiles();
}

// Profils au choix. Un panel qui ne connaît pas encore cette route (404) : section masquée, comportement historique.
async function loadProfiles(){
  if(!authToken){ Profiles.state = 'idle'; Profiles.list = []; return; }
  Profiles.state = 'loading';
  let parsed;
  try{
    parsed = ProfileOptions.parse(await apiFetch('/api/user/connect/options'));
  }catch(e){
    parsed = { state: 'error' };
  }
  if(parsed.authLost){ Profiles.state = 'idle'; Profiles.list = []; return; }   // la session est gérée par apiFetch/l'écran compte
  Profiles.state = parsed.state;
  Profiles.list = parsed.state === 'ready' ? parsed.options : [];
  // le profil mémorisé n'est plus proposé par le panel : on le dit, et on revient au choix automatique
  if(parsed.state === 'ready' && Profiles.selectedId !== null && Profiles.selectedId !== undefined && !getSelectedProfile()){
    Profiles.selectedId = null;
    store.set('hostedProfile', null);
    toast(t('prof.gone'), 'warning');
  }
  if(authToken) renderServers();
}

Actions.refreshServers = () => { if(authToken) loadServers(); else showScreen('account'); };

Actions.selectProfile = (el) => {
  const pid = el.dataset.pid;
  const p = pid ? Profiles.list.find((x) => String(x.id) === String(pid)) : null;
  if(pid && !p) return;
  Profiles.selectedId = p ? p.id : null;
  store.set('hostedProfile', Profiles.selectedId);
  // le serveur du profil devient le serveur retenu (carte d'accueil cohérente)
  if(p && p.serverId !== null && Servers.list.some((s) => sameId(s.id, p.serverId))){
    Servers.selectedId = p.serverId;
    store.set('server', p.serverId);
  }
  renderServers();
  if(VPN.state === 'on'){ toast(t('srv.appliedNext'), 'info'); return; }
  setTimeout(() => showScreen('home'), 220);
};

Actions.selectServer = (el) => {
  const s = Servers.list[+el.dataset.index];
  if(!s) return;
  if(!s.available){ toast(t('err.serverUnavailable'), 'warning'); return; }
  Servers.selectedId = s.id;
  store.set('server', s.id === undefined ? null : s.id);
  // choisir un autre serveur que celui du profil retenu = revenir au choix automatique sur ce serveur
  const prof = getSelectedProfile();
  if(prof && !sameId(prof.serverId, s.id)){ Profiles.selectedId = null; store.set('hostedProfile', null); }
  renderServers();
  if(VPN.state === 'on'){ toast(t('srv.appliedNext'), 'info'); return; }
  setTimeout(() => showScreen('home'), 220); // retour à l'accueil une fois le choix fait
};

$('srvSearch').addEventListener('input', (e) => { Servers.query = e.target.value; renderServers(); });
