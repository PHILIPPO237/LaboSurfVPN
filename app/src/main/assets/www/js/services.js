// Services : liste fournie par l'API du panel (/api/user/services). Aucun service n'est inventé :
// sans réponse de l'API on affiche un état honnête (connexion requise, chargement, erreur, liste vide).
// Le panel renvoie parfois une entrée « héritée » (id nul) pour un ancien compte qui a bien un accès VPN :
// c'est une donnée du panel, affichée comme telle, sans nom ni détail ajouté.

const Services = {
  list: [],
  state: 'idle',   // idle (non connecté) | loading | ready | error
};

function normalizeService(s){
  return {
    id: s.id === undefined ? null : s.id,
    type: String(s.type || '').trim(),
    status: String(s.status || '').trim(),
    serverId: s.server_id === undefined ? null : s.server_id,
    createdAt: String(s.created_at || '').trim(),
  };
}

// Texte + style d'un statut ; un statut inconnu est affiché tel que le panel le donne (jamais traduit à tort).
function serviceStatus(status){
  const v = String(status || '').toLowerCase();
  if(['active', 'actif', 'ok'].includes(v)) return { text: t('svc.status.active'), cls: 'badge-ok', up: true };
  if(['suspended', 'blocked', 'disabled', 'inactive', 'paused'].includes(v)) return { text: t('svc.status.suspended'), cls: 'badge-warn', up: false };
  if(['expired', 'expire'].includes(v)) return { text: t('svc.status.expired'), cls: 'badge-err', up: false };
  return { text: status || t('svc.status.unknown'), cls: '', up: null };
}
const serviceName = (s) => s.type || t('svc.defaultName');

function serviceCardHtml(s){
  const st = serviceStatus(s.status);
  const acc = Account.last;
  let access = '—';
  if(acc){
    access = planLabel(acc.plan);
    if(acc.plan !== 'gratuit') access += ' · ' + (acc.daysLeft === null ? t('svc.noExpiry') : (acc.daysLeft === 0 ? t('home.access.expired') : tn('acc.daysLeft', acc.daysLeft)));
  }
  // Serveur associé : nom si le service en désigne un et que la liste est chargée, sinon rien d'inventé
  let server = t('svc.serverNone'), avail = '—';
  const availableCount = Servers.list.filter((x) => x.available).length;
  if(s.serverId !== null && Servers.state === 'ready'){
    const linked = Servers.list.find((x) => sameId(x.id, s.serverId));
    if(linked){ server = serverDisplayName(linked); avail = t(linked.available ? 'svc.avail.up' : 'svc.avail.down'); }
    else server = '#' + s.serverId;
  } else if(s.serverId !== null){
    server = '#' + s.serverId;
  } else if(Servers.state === 'ready'){
    avail = availableCount ? tn('svc.avail.count', availableCount) : t('svc.avail.none');
  }
  let since = '';
  const d = new Date(s.createdAt);
  if(s.createdAt && !isNaN(d.getTime())) since = `<div class="info-row"><span class="k">${esc(t('svc.row.since'))}</span><span class="v">${esc(d.toLocaleDateString(I18N.locale(), { day: 'numeric', month: 'long', year: 'numeric' }))}</span></div>`;
  return `<article class="svc-card">
    <div class="svc-head"><span class="row-ico" aria-hidden="true">${ic('layers')}</span><div class="svc-name">${esc(serviceName(s))}</div><span class="badge ${st.cls}">${esc(st.text)}</span></div>
    <div class="info-row"><span class="k">${esc(t('svc.row.access'))}</span><span class="v">${esc(access)}</span></div>
    <div class="info-row"><span class="k">${esc(t('svc.row.server'))}</span><span class="v">${esc(server)}</span></div>
    <div class="info-row"><span class="k">${esc(t('svc.row.availability'))}</span><span class="v">${esc(avail)}</span></div>
    ${since}
  </article>`;
}

function renderServices(){
  const host = $('svcList');
  if(!host) return;
  if(Services.state === 'idle'){
    host.innerHTML = emptyBlock('lock', 'svc.loginTitle', 'svc.loginText',
      `<button class="btn btn-primary" type="button" data-action="nav" data-screen="account">${esc(t('srv.loginCta'))}</button>`);
  } else if(Services.state === 'loading'){
    host.innerHTML = '<div class="skeleton" style="height:150px"></div>'.repeat(2);
  } else if(Services.state === 'error'){
    host.innerHTML = emptyBlock('alert-circle', 'svc.errorTitle', 'svc.errorText',
      `<button class="btn btn-secondary" type="button" data-action="refreshServices">${esc(t('common.retry'))}</button>`);
  } else if(!Services.list.length){
    host.innerHTML = emptyBlock('layers', 'svc.emptyTitle', 'svc.emptyText');
  } else {
    host.innerHTML = Services.list.map(serviceCardHtml).join('');
  }

  // Sans service à afficher (non connecté, erreur, liste vide) : mode d'emploi fixe, jamais une donnée inventée
  if(Services.state !== 'loading' && !(Services.state === 'ready' && Services.list.length))
    host.innerHTML += primerHtml('primer.svc.title', ['primer.svc.1', 'primer.svc.2', 'primer.svc.3']);

  // Ligne « Serveurs » : état réel de la liste
  const sub = $('svcServersSub');
  if(Servers.state === 'idle') sub.textContent = t('svc.serversLogin');
  else if(Servers.state === 'loading') sub.textContent = t('svc.serversLoading');
  else if(Servers.state === 'error') sub.textContent = t('svc.serversError');
  else sub.textContent = tn('srv.summary', Servers.list.filter((x) => x.available).length, { total: Servers.list.length });
}

async function loadServices(){
  if(!authToken){
    Services.state = 'idle'; Services.list = [];
    renderServices();
    return;
  }
  Services.state = 'loading';
  renderServices();
  $('svcRefresh').classList.add('is-spinning');
  try{
    const res = await apiFetch('/api/user/services');
    if(res.ok && res.data && res.data.status === 'ok' && Array.isArray(res.data.services)){
      Services.list = res.data.services.filter((x) => x && typeof x === 'object').map(normalizeService);
      Services.state = 'ready';
    } else if(!res.expired){
      Services.state = 'error';
    }
  }catch(e){
    Services.state = 'error';
  }finally{
    $('svcRefresh').classList.remove('is-spinning');
  }
  if(authToken) renderServices();
}

Actions.refreshServices = () => {
  if(!authToken){ showScreen('account'); return; }
  loadServices();
  if(Servers.state !== 'loading') loadServers();
};
