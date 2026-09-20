// Compte : connexion, inscription, mot de passe oublié, abonnement, code d'activation,
// demandes de renouvellement, messagerie, annonces, badge d'expiration.
// Les appels API sont ceux du panel LABORATOIRE DU FREE-SURF, inchangés.

const PLAN_KEYS = ['gratuit', 'vip', 'revendeur', 'admin'];
const Account = { last: null, unreadMessages: 0, unreadAnnouncements: 0, pollTimer: null, attachment: null, view: 'menu' };
let fpResetToken = null;

function planKeyFromType(type){
  const v = String(type || '').trim().toLowerCase();
  if(v === 'vip' || v === 'premium') return 'vip';
  if(v === 'revendeur') return 'revendeur';
  if(v === 'admin') return 'admin';
  return 'gratuit';
}
const isProPlan = (plan) => plan !== 'gratuit';
const planLabel = (plan) => t('plan.' + plan);

function showFormError(id, message){
  const el = $(id);
  el.textContent = message;
  el.classList.add('show');
}
const clearFormError = (id) => $(id).classList.remove('show');

function daysLeftFromExpiration(expIso){
  if(!expIso) return null;
  const exp = new Date(expIso + 'T23:59:59');
  if(isNaN(exp.getTime())) return null;
  return Math.max(0, Math.ceil((exp.getTime() - Date.now()) / 86400000));
}

// ─── Carte de profil / abonnement ───
function gaugeClass(pct){ return pct >= 60 ? '' : (pct >= 25 ? 'mid' : 'low'); }

function renderAccountCard(acc){
  Account.last = acc;
  $('accNameTxt').textContent = acc.username;
  // Photo de profil si elle a été renseignée, sinon avatar par défaut (aussi en cas d'image introuvable)
  const img = $('accAvatarImg'), fallback = $('accAvatarDefault');
  if(acc.avatar){
    img.src = FREE_SURF_API_BASE + acc.avatar; // chemin relatif fourni par le panel
    img.hidden = false; fallback.style.display = 'none';
    img.onerror = () => { img.hidden = true; fallback.style.display = ''; };
  } else { img.hidden = true; img.removeAttribute('src'); fallback.style.display = ''; }

  const badge = $('accPlanBadge');
  badge.textContent = planLabel(acc.plan);
  badge.className = 'badge' + (acc.plan === 'gratuit' ? '' : ' badge-' + acc.plan);
  const pro = isProPlan(acc.plan);
  $('proBadgeAcc').hidden = !pro;
  $('proBadgeHome').hidden = !pro;
  $('accResellerRow').hidden = !(acc.plan === 'revendeur' || acc.plan === 'admin');

  // Jours restants
  const hasDays = acc.daysLeft !== null;
  $('daysGaugeBlock').hidden = !hasDays;
  if(hasDays){
    const pct = Math.max(0, Math.min(100, Math.round((acc.daysLeft / (acc.graceDays + 25)) * 100)));
    $('accGaugeFill').style.width = pct + '%';
    $('accGaugeFill').className = 'gauge-fill ' + gaugeClass(pct);
    $('accGaugeLabel').textContent = tn('acc.daysLeft', acc.daysLeft);
    $('accGaugePct').textContent = pct + '%';
  }

  // Quota : jauge seulement si l'API fournit la consommation réelle (jamais de chiffre inventé)
  const hasQuota = !!acc.quotaGB;
  const hasUsage = hasQuota && acc.quotaUsedGB !== null;
  $('quotaBlock').hidden = !hasQuota;
  $('quotaGauge').hidden = !hasUsage;
  $('quotaPlain').hidden = !(hasQuota && !hasUsage);
  if(hasUsage){
    const remaining = Math.max(0, acc.quotaGB - acc.quotaUsedGB);
    const pct = Math.max(0, Math.min(100, Math.round((remaining / acc.quotaGB) * 100)));
    $('accQuotaFill').style.width = pct + '%';
    $('accQuotaFill').className = 'gauge-fill ' + gaugeClass(pct);
    $('accQuotaLabel').textContent = t('acc.quotaLeft', { left: fmtGB(remaining), total: fmtGB(acc.quotaGB) });
    $('accQuotaPct').textContent = pct + '%';
  } else if(hasQuota){
    $('quotaPlainValue').textContent = fmtGB(acc.quotaGB);
  }
  const noSub = $('accNoSub');
  noSub.hidden = hasDays || hasQuota;
  noSub.textContent = t(acc.plan === 'gratuit' ? 'acc.freePlanNote' : 'acc.noExpiry');

  // Sous-titre du menu « Accès et abonnement » : jours restants réels, sinon l'offre
  $('accMenuAccessSub').textContent = acc.plan !== 'gratuit' && acc.daysLeft !== null
    ? (acc.daysLeft === 0 ? t('home.access.expired') : tn('acc.daysLeft', acc.daysLeft)) : planLabel(acc.plan);
  updateExpiryBanner();
  renderHome();   // l'accueil affiche « Accès expiré » dès que le panel l'indique
}

// ─── Bandeau d'expiration (paliers 7/3/1 jours, comme sur le site) ───
function expiryDismissedToday(){
  try{ return localStorage.getItem('expiryBannerDismissedOn') === new Date().toDateString(); }catch(e){ return false; }
}
function updateExpiryBanner(){
  const banner = $('expiryBanner');
  const acc = Account.last;
  const show = authToken && acc && acc.plan !== 'gratuit' && acc.daysLeft !== null && acc.daysLeft <= 7
    && store.get('expiryReminders', true) && !expiryDismissedToday();
  banner.hidden = !show;
  if(show) $('expiryBannerText').textContent = acc.daysLeft <= 1 ? t('expiry.tomorrow') : tn('expiry.days', acc.daysLeft);
}
Actions.dismissExpiry = () => {
  $('expiryBanner').hidden = true;
  try{ localStorage.setItem('expiryBannerDismissedOn', new Date().toDateString()); }catch(e){}
};
// Ouvre directement la carte de renouvellement du Compte (sans masquer le bandeau d'expiration)
Actions.openRenewal = () => {
  showScreen('account');
  setTimeout(() => { const c = $('renewalCard'); if(c) c.scrollIntoView({ behavior: 'smooth' }); }, 150);
};
Actions.renewFromBanner = () => {
  Actions.dismissExpiry();
  showScreen('account');
  setTimeout(() => { const c = $('renewalCard'); if(c) c.scrollIntoView({ behavior: 'smooth' }); }, 150);
};

// ─── Chargement du compte réel ───
function accountFromApi(me, sub, fallbackName){
  const plan = planKeyFromType(me.type);
  const expiresAt = (sub && sub.expires_at) || me.expiration || '';
  const used = toNumber(me.quota_used_gb !== undefined ? me.quota_used_gb : me.used_gb); // null tant que l'API ne le fournit pas
  return {
    username: me.username || fallbackName || '',
    avatar: me.avatar || '',
    plan,
    daysLeft: plan === 'gratuit' ? null : daysLeftFromExpiration(expiresAt),
    graceDays: 3,
    quotaGB: (me.quota_gb !== undefined && me.quota_gb !== null) ? Number(me.quota_gb) : null,
    quotaUsedGB: used,
  };
}

// Libellé « dernière synchro » : conservé comme ÉTAT (et non comme texte) pour suivre la langue
const SYNC_KEYS = { now: 'common.justNow', syncing: 'acc.syncing', failed: 'acc.syncFailed', down: 'acc.panelDown' };
function setSyncState(state){ Account.syncState = state; $('accSyncTime').textContent = t(SYNC_KEYS[state]); }

async function loadAndShowAccount(fallbackName){
  const [meRes, subRes] = await Promise.all([apiFetch('/api/user/me'), apiFetch('/api/user/subscription')]);
  if(!authToken) return; // session expirée pendant le chargement
  renderAccountCard(accountFromApi(meRes.ok ? meRes.data || {} : {}, subRes.ok ? subRes.data || {} : {}, fallbackName));
  $('accLoggedOut').hidden = true;
  $('accLoggedIn').hidden = false;
  setSyncState('now');
  loadServers();
  loadServices();
}

async function afterAuth(username){
  await loadAndShowAccount(username);
  if(!authToken) return;
  loadHomeBanner(); // le panel peut renvoyer la bannière du revendeur maintenant que le jeton existe
  loadAppMessages(); loadAnnouncements(true);
  clearInterval(Account.pollTimer);
  Account.pollTimer = setInterval(pollAccountSignals, 20000);
}

// ─── Connexion / inscription ───
Actions.togglePw = (btn) => {
  const input = $(btn.dataset.target);
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  btn.classList.toggle('is-visible', !showing);
};

Actions.login = async () => {
  const u = $('accUsername').value.trim(), p = $('accPassword').value.trim(), btn = $('accLoginBtn');
  clearFormError('accError');
  if(!u || !p){ showFormError('accError', t('acc.errFillCredentials')); return; }
  if(isBusy(btn)) return;
  setBusy(btn, true, 'acc.signingIn');
  try{
    const login = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) });
    if(!login.ok || !login.data || login.data.status !== 'ok'){
      showFormError('accError', apiMessage(login, 'acc.errBadCredentials'));
      return;
    }
    authToken = login.data.token;
    await afterAuth(u);
    $('accPassword').value = '';
  }catch(e){
    showFormError('accError', t('err.panelOffline'));
  }finally{
    setBusy(btn, false, 'acc.signIn');
  }
};

Actions.register = async () => {
  const v = (id) => $(id).value;
  const u = v('regUsername').trim(), c = v('regContact').trim(), rs = v('regRecovery').trim(), p = v('regPassword'), p2 = v('regPasswordConfirm');
  const btn = $('regSubmitBtn');
  clearFormError('regError');
  if(!u || !c || !rs || !p || !p2){ showFormError('regError', t('acc.errFillAll')); return; }
  if(p !== p2){ showFormError('regError', t('acc.errMismatch')); return; }
  if(isBusy(btn)) return;
  setBusy(btn, true, 'acc.creating');
  try{
    const reg = await apiFetch('/api/auth/register', { method: 'POST',
      body: JSON.stringify({ username: u, contact: c, recovery_secret: rs, password: p, confirm_password: p2 }) });
    if(!reg.ok || !reg.data || reg.data.status !== 'ok'){
      showFormError('regError', apiMessage(reg, 'acc.errRegister'));
      return;
    }
    authToken = reg.data.token;
    toast(t('acc.created'), 'success');
    // Photo facultative : envoyée avec l'API existante (POST /api/user/profile/avatar-upload), jeton du compte tout juste créé.
    // Un échec ne remet pas en cause le compte : il est déjà créé, la photo pourra être ajoutée depuis le profil.
    if(Account.regPhoto){
      const up = await uploadAvatar(Account.regPhoto.blob);
      if(!up.ok) toast(t('acc.photoUploadFailed'), 'warning', 4500);
    }
    resetRegPhoto();
    await afterAuth(u);
  }catch(e){
    showFormError('regError', t('err.panelOffline'));
  }finally{
    setBusy(btn, false, 'acc.createBtn');
  }
};


// ─── Photo de profil / avatar ───
// Choisie dans la galerie ou avec l'appareil photo, recadrée en carré et réduite à 512 px (JPEG) AVANT l'envoi :
// léger pour le réseau mobile, et toujours accepté par le panel (formats PNG/JPG/WEBP/GIF, 5 Mo max).
async function prepareAvatar(file){
  if(!file || !/^image\//.test(file.type)) throw new Error('bad');
  if(file.size > 20 * 1024 * 1024) throw new Error('big');
  let src, w, h, cleanup = () => {};
  if(window.createImageBitmap){
    src = await createImageBitmap(file); w = src.width; h = src.height; cleanup = () => { try{ src.close(); }catch(e){} };
  } else {
    const url = URL.createObjectURL(file);
    src = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('bad')); im.src = url; });
    w = src.naturalWidth; h = src.naturalHeight; cleanup = () => URL.revokeObjectURL(url);
  }
  if(!w || !h){ cleanup(); throw new Error('bad'); }
  const side = Math.min(w, h), out = Math.min(512, side);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = out;
  canvas.getContext('2d').drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, out, out);
  cleanup();
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('bad'))), 'image/jpeg', 0.86));
}

async function uploadAvatar(blob){
  try{
    const fd = new FormData();
    fd.append('avatar_file', blob, 'avatar.jpg');
    const res = await apiFetch('/api/user/profile/avatar-upload', { method: 'POST', body: fd, timeout: 30000 });
    if(res.ok && res.data && res.data.status === 'ok') return { ok: true, avatar: res.data.avatar || '' };
    return { ok: false, res };
  }catch(e){ return { ok: false, res: null }; }
}

function photoErrorText(e){ return t(e && e.message === 'big' ? 'acc.photoTooBig' : 'acc.photoBad'); }

// Inscription : aperçu de la photo choisie (l'avatar par défaut reste affiché tant qu'il n'y en a pas)
function resetRegPhoto(){
  if(Account.regPhoto) URL.revokeObjectURL(Account.regPhoto.url);
  Account.regPhoto = null;
  $('regAvatarImg').hidden = true; $('regAvatarImg').removeAttribute('src');
  $('regAvatarDefault').style.display = '';
  $('regAvatarRemove').hidden = true;
  $('regAvatarInput').value = '';
}
$('regAvatarInput').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  if(!file) return;
  try{
    const blob = await prepareAvatar(file);
    if(Account.regPhoto) URL.revokeObjectURL(Account.regPhoto.url);
    Account.regPhoto = { blob, url: URL.createObjectURL(blob) };
    $('regAvatarImg').src = Account.regPhoto.url; $('regAvatarImg').hidden = false;
    $('regAvatarDefault').style.display = 'none';
    $('regAvatarRemove').hidden = false;
  }catch(e){
    ev.target.value = '';
    showFormError('regError', photoErrorText(e));
  }
});
Actions.removeRegPhoto = () => resetRegPhoto();

// Profil : toucher l'avatar pour changer la photo (même envoi que l'inscription)
Actions.changePhoto = () => { if(authToken) $('profilePhotoInput').click(); };
$('profilePhotoInput').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if(!file || !authToken) return;
  try{
    const blob = await prepareAvatar(file);
    toast(t('acc.photoUpdating'), 'info', 1500);
    const up = await uploadAvatar(blob);
    if(!up.ok){ toast(apiMessage(up.res, 'acc.photoUploadFailed'), 'error'); return; }
    if(Account.last) renderAccountCard(Object.assign({}, Account.last, { avatar: up.avatar }));
    toast(t('acc.photoUpdated'), 'success');
  }catch(e){
    toast(photoErrorText(e), 'error');
  }
});

Actions.showRegister = (el) => {
  const show = el.dataset.value === '1';
  if(!show) resetRegPhoto();
  $('accLoginCard').hidden = show;
  $('accRegisterCard').hidden = !show;
  $('ctaSignup').hidden = show;
};

// ─── Mot de passe oublié ───
Actions.showForgot = () => {
  $('accLoginCard').hidden = true;
  $('ctaSignup').hidden = true;
  $('forgotPasswordCard').hidden = false;
  $('fpStep1').hidden = false; $('fpStep2').hidden = true;
  clearFormError('fpError');
};
Actions.hideForgot = () => {
  $('forgotPasswordCard').hidden = true;
  $('accLoginCard').hidden = false;
  $('ctaSignup').hidden = false;
  ['fpUsername', 'fpContact', 'fpRecoverySecret', 'fpNewPassword', 'fpConfirmPassword'].forEach((id) => { $(id).value = ''; });
  fpResetToken = null;
};

Actions.forgotVerify = async () => {
  clearFormError('fpError');
  const username = $('fpUsername').value.trim(), contact = $('fpContact').value.trim(), recoverySecret = $('fpRecoverySecret').value.trim();
  if(!username || !contact || !recoverySecret){ showFormError('fpError', t('acc.errFillAll')); return; }
  const btn = $('fpVerifyBtn');
  if(isBusy(btn)) return;
  setBusy(btn, true, 'acc.verifying');
  try{
    const res = await apiFetch('/api/auth/forgot-password/verify', { method: 'POST',
      body: JSON.stringify({ username, contact, recovery_secret: recoverySecret }) });
    if(res.ok && res.data && res.data.status === 'ok'){
      fpResetToken = res.data.reset_token;
      $('fpStep1').hidden = true; $('fpStep2').hidden = false;
    } else {
      showFormError('fpError', apiMessage(res, 'acc.errNoMatch'));
    }
  }catch(e){
    showFormError('fpError', t('err.panel'));
  }finally{
    setBusy(btn, false, 'acc.forgotVerify');
  }
};

Actions.forgotReset = async () => {
  clearFormError('fpError');
  const np = $('fpNewPassword').value.trim(), cp = $('fpConfirmPassword').value.trim();
  if(!fpResetToken){ showFormError('fpError', t('acc.errResetExpired')); return; }
  if(np.length < 6){ showFormError('fpError', t('acc.errPwShort')); return; }
  if(np !== cp){ showFormError('fpError', t('acc.errMismatch')); return; }
  const btn = $('fpResetBtn');
  if(isBusy(btn)) return;
  setBusy(btn, true, 'acc.changing');
  try{
    const res = await apiFetch('/api/auth/forgot-password/reset', { method: 'POST',
      body: JSON.stringify({ reset_token: fpResetToken, new_password: np, confirm_password: cp }) });
    if(res.ok && res.data && res.data.status === 'ok'){
      toast(t('acc.pwChanged'), 'success');
      Actions.hideForgot();
    } else {
      showFormError('fpError', apiMessage(res, 'acc.errPwChange'));
    }
  }catch(e){
    showFormError('fpError', t('err.panel'));
  }finally{
    setBusy(btn, false, 'acc.forgotReset');
  }
};

// ─── Sous-écrans du compte : menu · accès et abonnement · messages et annonces · sécurité ───
function setAccView(name){
  Account.view = ['menu', 'access', 'messages', 'security'].includes(name) ? name : 'menu';
  $('accHome').hidden = Account.view !== 'menu';
  $('accViewAccess').hidden = Account.view !== 'access';
  $('accViewMessages').hidden = Account.view !== 'messages';
  $('accViewSecurity').hidden = Account.view !== 'security';
  $('screen-account').scrollTop = 0;
  // Ouvrir les messages les marque comme lus côté serveur (comportement historique) : seulement ici, jamais en arrière-plan
  if(Account.view === 'messages'){ loadAppMessages(); loadAnnouncements(true); }
}
Actions.accOpen = (el) => setAccView(el.dataset.view);
Actions.accBack = () => setAccView('menu');

// ─── Déconnexion du compte / session expirée ───
function resetToLoggedOut(){
  authToken = null;
  Account.last = null;
  clearInterval(Account.pollTimer);
  Account.unreadMessages = 0; Account.unreadAnnouncements = 0;
  updateAccountBadge();
  $('accLoggedIn').hidden = true;
  $('accLoggedOut').hidden = false;
  $('accUsername').value = ''; $('accPassword').value = '';
  $('proBadgeHome').hidden = true;
  $('accResellerRow').hidden = true;
  $('expiryBanner').hidden = true;
  Reseller.reset();
  if(currentScreen === 'clients') showScreen('home');
  setAccView('menu');
  Servers.list = []; Servers.state = 'idle';
  Services.list = []; Services.state = 'idle';
  renderServers();   // redessine aussi la page Services
  loadHomeBanner(); // plus de jeton = plus de revendeur identifié -> bannière par défaut
}

Actions.logout = () => {
  if(VPN.state === 'on') disconnectVpn(); // ne jamais laisser un tunnel actif sans compte affiché
  resetToLoggedOut();
};

function handleSessionExpired(){
  if(!authToken) return;
  const wasOn = VPN.state === 'on';
  resetToLoggedOut();
  if(wasOn) disconnectVpn();
  else if(VPN.state === 'connecting') { setVpnState('off'); }
  toast(t('err.sessionExpired'), 'warning', 4200);
  showScreen('account');
}

// ─── Synchronisation, activation, renouvellement ───
Actions.syncAccount = async () => {
  if(!authToken) return;
  const btn = $('accSyncBtn');
  if(isBusy(btn)) return;
  setBusy(btn, true);
  setSyncState('syncing');
  try{
    const [meRes, subRes] = await Promise.all([apiFetch('/api/user/me'), apiFetch('/api/user/subscription')]);
    if(!meRes.ok){ setSyncState('failed'); return; }
    renderAccountCard(accountFromApi(meRes.data || {}, subRes.ok ? subRes.data || {} : {}, $('accNameTxt').textContent));
    setSyncState('now');
  }catch(e){
    setSyncState('down');
  }finally{
    setBusy(btn, false);
  }
};

Actions.activateKey = async () => {
  clearFormError('activationError');
  if(!authToken) return;
  const input = $('activationKeyInput'), key = input.value.trim().toUpperCase(), btn = $('activateKeyBtn');
  if(!key){ showFormError('activationError', t('acc.errEnterCode')); return; }
  if(isBusy(btn)) return;
  setBusy(btn, true, 'common.dots');
  try{
    const res = await apiFetch('/api/user/activate', { method: 'POST', body: JSON.stringify({ key }) });
    if(res.ok && res.data && res.data.status === 'ok'){
      toast(t('acc.codeActivated'), 'success');
      input.value = '';
      await loadAndShowAccount();
    } else {
      showFormError('activationError', apiMessage(res, 'acc.errCode'));
    }
  }catch(e){
    showFormError('activationError', t('err.panelRetry'));
  }finally{
    setBusy(btn, false, 'acc.activate');
  }
};

Actions.renewal = async () => {
  clearFormError('renewalError');
  if(!authToken) return;
  const kind = $('renewalKindSelect').value, message = $('renewalMessage').value.trim(), btn = $('renewalSubmitBtn');
  if(isBusy(btn)) return;
  setBusy(btn, true, 'common.sending');
  const body = { kind, message };
  if(kind === 'renewal') body.duration_days = 30;
  if(kind === 'upgrade') body.target_plan = 'VIP';
  try{
    const res = await apiFetch('/api/user/subscription/request', { method: 'POST', body: JSON.stringify(body) });
    if(res.ok && res.data && res.data.status === 'ok'){
      // Confirmation persistante (et non un simple toast) : le formulaire est remplacé par un état « envoyé »
      $('renewalFormBlock').hidden = true;
      $('renewalConfirmed').hidden = false;
      Account.renewalRes = res; renderRenewalConfirmation();
    } else {
      showFormError('renewalError', apiMessage(res, 'acc.errRequest'));
    }
  }catch(e){
    showFormError('renewalError', t('err.panelRetry'));
  }finally{
    setBusy(btn, false, 'acc.sendRequest');
  }
};
function renderRenewalConfirmation(){
  if(Account.renewalRes) $('renewalConfirmedText').textContent = apiMessage(Account.renewalRes, 'acc.requestSentText');
}
Actions.resetRenewal = () => {
  Account.renewalRes = null;
  $('renewalFormBlock').hidden = false;
  $('renewalConfirmed').hidden = true;
  $('renewalMessage').value = '';
};

// ─── Messagerie privée ───
$('msgAttachInput').addEventListener('change', (ev) => {
  const file = ev.target.files[0];
  if(!file) return;
  if(file.size > 2000000){ toast(t('acc.imageTooBig'), 'warning'); ev.target.value = ''; return; }
  const reader = new FileReader();
  reader.onload = () => {
    Account.attachment = { data: reader.result, mime: file.type, filename: file.name };
    $('msgAttachName').textContent = file.name;
    $('msgAttachPreview').hidden = false;
  };
  reader.readAsDataURL(file);
});
Actions.clearAttachment = () => {
  Account.attachment = null;
  $('msgAttachInput').value = '';
  $('msgAttachPreview').hidden = true;
};

let messagesCache = [];
function renderAppMessages(messages){
  if(messages) messagesCache = messages;
  const thread = $('messagesThread');
  if(!messagesCache.length){
    thread.innerHTML = `<div class="empty" style="padding:var(--sp-4) 0">${esc(t('acc.noMessages'))}</div>`;
    return;
  }
  thread.innerHTML = messagesCache.map((m) => {
    const mine = m.sender_role === 'client';
    const role = m.sender_role === 'admin' ? t('plan.admin') : (m.sender_role === 'revendeur' ? t('plan.revendeur') : t('acc.you'));
    let attach = '';
    if(m.attachment_data){
      if(m.message_type === 'invoice'){
        attach = `<a class="bubble-file" href="${esc(FREE_SURF_API_BASE + m.attachment_data)}" target="_blank" rel="noopener">${ic('file')} ${esc(m.attachment_filename || t('acc.invoiceDefault'))}</a>`;
      } else if((m.attachment_mime || '').startsWith('image/') || String(m.attachment_data).startsWith('data:image')){
        attach = `<img src="${esc(m.attachment_data)}" alt="">`;
      }
    }
    const avatar = mine ? '' : `<span class="avatar" style="width:26px;height:26px;border-radius:50%;font-size:10px">${
      m.sender_avatar ? `<img src="${esc(m.sender_avatar)}" alt="" onerror="this.remove()">` : esc(role.charAt(0).toUpperCase())}</span>`;
    return `<div class="bubble-row${mine ? ' mine' : ''}">${avatar}<div class="bubble">${esc(m.body)}${attach}<div class="bubble-meta">${esc(role)}</div></div></div>`;
  }).join('');
  thread.scrollTop = thread.scrollHeight;
}

async function loadAppMessages(silent){
  if(!authToken) return;
  try{
    const res = await apiFetch('/api/user/messages');
    if(res.ok && res.data && res.data.messages){
      renderAppMessages(res.data.messages);
      if(!silent){ Account.unreadMessages = 0; updateAccountBadge(); } // les charger les marque comme lus côté serveur
    }
  }catch(e){ /* silencieux : chargement d'arrière-plan */ }
}

async function pollUnreadMessages(){
  if(!authToken) return;
  try{
    const res = await apiFetch('/api/user/messages');
    if(res.ok && res.data && res.data.messages && !(currentScreen === 'account' && Account.view === 'messages')){
      Account.unreadMessages = res.data.messages.filter((m) => m.sender_role !== 'client' && !m.read_at).length;
      updateAccountBadge();
    }
  }catch(e){}
}

Actions.sendMessage = async () => {
  if(!authToken){ toast(t('err.loginFirst'), 'warning'); return; }
  const input = $('msgComposerInput'), text = input.value.trim();
  if(!text && !Account.attachment) return;
  const payload = { body: text };
  if(Account.attachment){
    payload.attachment_data = Account.attachment.data;
    payload.attachment_mime = Account.attachment.mime;
    payload.attachment_filename = Account.attachment.filename;
    payload.message_type = 'payment_proof';
  }
  try{
    const res = await apiFetch('/api/user/messages', { method: 'POST', body: JSON.stringify(payload) });
    if(res.ok && res.data && res.data.status === 'ok'){
      input.value = '';
      Actions.clearAttachment();
      await loadAppMessages();
    } else {
      toast(apiMessage(res, 'acc.errSend'), 'error');
    }
  }catch(e){
    toast(t('err.panel'), 'error');
  }
};

// ─── Annonces diffusées ───
let announcementsCache = [];
function renderAnnouncements(items){
  if(items) announcementsCache = items; else items = announcementsCache;
  const card = $('announcementsCard');
  card.hidden = !(items && items.length);
  if(card.hidden) return;
  $('announcementsList').innerHTML = items.map((n) => `
    <div style="padding:8px 0;border-bottom:1px solid var(--border)">
      <div style="font-size:var(--fs-sm);font-weight:700;${n.is_read ? 'color:var(--text-muted)' : ''}">${esc(localizedField(n, 'title'))}</div>
      <div class="muted" style="font-size:var(--fs-xs);margin-top:2px">${esc(localizedField(n, 'message'))}</div>
    </div>`).join('');
}

async function loadAnnouncements(markSeen){
  if(!authToken) return;
  try{
    const res = await apiFetch('/api/user/notifications');
    if(res.ok && res.data && res.data.notifications){
      const items = res.data.notifications;
      renderAnnouncements(items);
      Account.unreadAnnouncements = items.filter((n) => !n.is_read).length;
      const b = $('announcementsCardBadge');
      b.hidden = Account.unreadAnnouncements === 0;
      b.textContent = Account.unreadAnnouncements > 9 ? '9+' : String(Account.unreadAnnouncements);
      if(markSeen){
        // Marquées comme lues seulement quand la personne a réellement vu l'écran Compte
        await Promise.all(items.filter((n) => !n.is_read).map((n) => apiFetch(`/api/user/notifications/${n.id}/read`, { method: 'POST' })));
        Account.unreadAnnouncements = 0;
      }
      updateAccountBadge();
    }
  }catch(e){}
}

// Pastille sur l'onglet Compte : messages non lus + annonces non lues
function updateAccountBadge(){
  const total = Account.unreadMessages + Account.unreadAnnouncements;
  const tab = $('accountBadge');
  tab.hidden = total === 0;
  tab.textContent = total > 9 ? '9+' : String(total);
  const cardBadge = $('messagesCardBadge');
  cardBadge.hidden = Account.unreadMessages === 0;
  cardBadge.textContent = Account.unreadMessages > 9 ? '9+' : String(Account.unreadMessages);
  const rowBadge = $('messagesRowBadge');
  rowBadge.hidden = Account.unreadMessages + Account.unreadAnnouncements === 0;
  rowBadge.textContent = Account.unreadMessages + Account.unreadAnnouncements > 9 ? '9+' : String(Account.unreadMessages + Account.unreadAnnouncements);
}

function pollAccountSignals(){ pollUnreadMessages(); loadAnnouncements(false); }

document.addEventListener('langchange', () => {
  if(Account.last) renderAccountCard(Account.last);
  renderAppMessages();
  renderAnnouncements();
  if(Account.syncState) setSyncState(Account.syncState);
  renderRenewalConfirmation();
  // Messages d'erreur de formulaire : transitoires, effacés au changement de langue (jamais affichés dans la mauvaise langue)
  document.querySelectorAll('.form-error.show').forEach((el) => el.classList.remove('show'));
});

