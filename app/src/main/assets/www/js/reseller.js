// Espace revendeur / admin : création de clients, demandes en attente, liste des clients.
// Endpoints inchangés (/api/revendeur/...). Les listes sont mises en cache pour pouvoir être
// redessinées lors d'un changement de langue sans nouvel appel réseau.

const Reseller = {
  requests: { state: 'idle', items: [] },   // idle | loading | ready | error
  clients: { state: 'idle', items: [] },
  reset(){
    this.requests = { state: 'idle', items: [] };
    this.clients = { state: 'idle', items: [] };
    renderPendingRequests(); renderClients();
  },
};

const simpleCard = (icon, text) => `<div class="card"><div class="empty" style="padding:var(--sp-3)">${ic(icon)}<div>${esc(text)}</div></div></div>`;

Actions.createClient = async () => {
  clearFormError('ccError');
  if(!authToken){ toast(t('err.loginFirst'), 'warning'); return; }
  const username = $('ccUsername').value.trim(), password = $('ccPassword').value.trim();
  if(!username){ showFormError('ccError', t('cli.errUsername')); return; }
  if(password.length < 6){ showFormError('ccError', t('acc.errPwShort')); return; }
  const btn = $('ccSubmitBtn');
  if(isBusy(btn)) return;
  setBusy(btn, true, 'cli.creating');

  const quotaRaw = $('ccQuota').value.trim();
  const payload = { username, password, user_type: $('ccUserType').value, notes: $('ccNotes').value.trim() };
  if(quotaRaw) payload.quota_gb = parseFloat(quotaRaw);
  try{
    const res = await apiFetch('/api/revendeur/users/create', { method: 'POST', body: JSON.stringify(payload) });
    if(res.ok && res.data && res.data.status === 'ok'){
      toast(apiMessage(res, 'cli.created'), 'success');
      ['ccUsername', 'ccPassword', 'ccQuota', 'ccNotes'].forEach((id) => { $(id).value = ''; });
      $('createClientCard').open = false;
      loadResellerClients();
    } else {
      showFormError('ccError', apiMessage(res, 'cli.errCreate'));
    }
  }catch(e){
    showFormError('ccError', t('err.panel'));
  }finally{
    setBusy(btn, false, 'cli.createBtn');
  }
};

// ─── Demandes en attente ───
function renderPendingRequests(){
  const host = $('pendingRequestsList');
  const { state, items } = Reseller.requests;
  if(state === 'idle') host.innerHTML = simpleCard('lock', t('cli.needLoginRequests'));
  else if(state === 'loading') host.innerHTML = '<div class="skeleton"></div>';
  else if(state === 'error') host.innerHTML = simpleCard('alert-circle', t('cli.errRequests'));
  else if(!items.length) host.innerHTML = simpleCard('check-circle', t('cli.noRequests'));
  else host.innerHTML = items.map((r) => {
    const kind = r.kind === 'upgrade' ? t('cli.kindUpgrade', { plan: r.target_plan || 'VIP' }) : t('cli.kindRenewal', { days: r.duration_days || 30 });
    const msg = r.message ? `<div class="request-msg">“${esc(r.message)}”</div>` : '';
    const proof = r.has_payment_proof ? `<span class="badge badge-ok" style="margin-top:4px">${ic('receipt')} ${esc(t('cli.proofSent'))}</span>` : '';
    return `<div class="card request">
      <div style="font-weight:700">${esc(r.username)}</div>
      <div style="font-size:var(--fs-sm);color:var(--brand)">${esc(kind)}</div>${proof}${msg}
      <div class="btn-row" style="margin-top:var(--sp-2)">
        <button class="btn btn-primary btn-sm" type="button" data-action="handleRequest" data-id="${esc(r.id)}" data-verb="approve">${ic('check')} ${esc(t('cli.approve'))}</button>
        <button class="btn btn-danger btn-sm" type="button" data-action="handleRequest" data-id="${esc(r.id)}" data-verb="reject">${ic('x')} ${esc(t('cli.reject'))}</button>
      </div></div>`;
  }).join('');
}

async function loadPendingRequests(){
  if(!authToken){ Reseller.requests = { state: 'idle', items: [] }; renderPendingRequests(); return; }
  Reseller.requests.state = 'loading'; renderPendingRequests();
  try{
    const res = await apiFetch('/api/revendeur/service-requests');
    if(res.ok && res.data && Array.isArray(res.data.requests)) Reseller.requests = { state: 'ready', items: res.data.requests };
    else Reseller.requests = { state: 'error', items: [] };
  }catch(e){ Reseller.requests = { state: 'error', items: [] }; }
  if(authToken) renderPendingRequests();
}
Actions.loadRequests = loadPendingRequests;

Actions.handleRequest = async (btn) => {
  const id = btn.dataset.id, verb = btn.dataset.verb;
  // confirm() ne fonctionne pas dans une WebView : boîte de dialogue intégrée à l'app
  if(verb === 'reject' && !(await confirmDialog({ title: t('cli.rejectTitle'), message: t('cli.rejectText'), confirm: t('cli.reject'), danger: true }))) return;
  if(isBusy(btn)) return;
  setBusy(btn, true);
  try{
    const res = await apiFetch(`/api/revendeur/service-requests/${verb}`, { method: 'POST', body: JSON.stringify({ id: isNaN(+id) ? id : +id }) });
    if(res.ok && res.data && res.data.status === 'ok'){
      toast(t(verb === 'approve' ? 'cli.approved' : 'cli.rejected'), 'success');
      loadPendingRequests();
      loadResellerClients();
    } else {
      setBusy(btn, false);
      toast(apiMessage(res, 'cli.errRequest'), 'error');
    }
  }catch(e){
    setBusy(btn, false);
    toast(t('err.panel'), 'error');
  }
};

// ─── Clients ───
function renderClients(){
  const host = $('clientsList'), summary = $('clientsSummaryCard');
  const { state, items } = Reseller.clients;
  summary.hidden = !(state === 'ready' && items.length);
  if(state === 'idle'){ host.innerHTML = simpleCard('lock', t('cli.needLoginClients')); return; }
  if(state === 'loading'){ host.innerHTML = '<div class="skeleton"></div>'.repeat(2); return; }
  if(state === 'error'){ host.innerHTML = simpleCard('alert-circle', t('cli.errClients')); return; }
  if(!items.length){ host.innerHTML = simpleCard('users', t('cli.noClients')); return; }

  const isActive = (c) => String(c.status || '').toLowerCase() === 'active';
  $('clientsCountTotal').textContent = items.length;
  $('clientsCountActive').textContent = items.filter(isActive).length;
  host.innerHTML = '<div class="list">' + items.map((c) => {
    const plan = planKeyFromType(c.type);
    // « Illimité » n'a de sens que pour les plans payants : pour un compte Gratuit, une valeur vide
    // veut dire « non définie / limitée », pas « sans limite » (éviter une fausse impression).
    const paid = plan !== 'gratuit';
    const exp = c.expiration ? c.expiration : t(paid ? 'cli.unlimited' : 'cli.trialLimited');
    const quota = (c.quota_gb !== null && c.quota_gb !== undefined && c.quota_gb !== '')
      ? fmtGB(Number(c.quota_gb)) : t(paid ? 'cli.unlimited' : 'cli.quotaLimited');
    return `<div class="row"><span class="status-dot${isActive(c) ? ' active' : ''}"></span>
      <div class="row-main"><div class="row-title">${esc(c.username)}</div>
      <div class="row-sub">${esc(planLabel(plan))} · ${esc(t('cli.exp'))} ${esc(exp)} · ${esc(quota)}</div></div></div>`;
  }).join('') + '</div>';
}

async function loadResellerClients(){
  if(!authToken){ Reseller.clients = { state: 'idle', items: [] }; renderClients(); return; }
  Reseller.clients.state = 'loading'; renderClients();
  try{
    const res = await apiFetch('/api/revendeur/clients');
    if(res.ok && res.data && res.data.status === 'ok') Reseller.clients = { state: 'ready', items: res.data.clients || [] };
    else Reseller.clients = { state: 'error', items: [] };
  }catch(e){ Reseller.clients = { state: 'error', items: [] }; }
  if(authToken) renderClients();
}
Actions.loadClients = loadResellerClients;

document.addEventListener('langchange', () => { renderPendingRequests(); renderClients(); });
