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

function renderServers(){
  const host = $('srvList');
  const searchWrap = $('srvSearchWrap');
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
}

Actions.refreshServers = () => { if(authToken) loadServers(); else showScreen('account'); };

Actions.selectServer = (el) => {
  const s = Servers.list[+el.dataset.index];
  if(!s) return;
  if(!s.available){ toast(t('err.serverUnavailable'), 'warning'); return; }
  Servers.selectedId = s.id;
  store.set('server', s.id === undefined ? null : s.id);
  renderServers();
  if(VPN.state === 'on'){ toast(t('srv.appliedNext'), 'info'); return; }
  setTimeout(() => showScreen('home'), 220); // retour à l'accueil une fois le choix fait
};

$('srvSearch').addEventListener('input', (e) => { Servers.query = e.target.value; renderServers(); });
