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
// Rôle et offre SÉPARÉS, calculés par le panel (/api/user/me : role = client|reseller|admin|super_admin,
// offer = free|premium). L'app ne les déduit plus d'un « type » qui les mélange ; repli sur « type » seulement si le
// panel est ancien. « plan » n'est que la clé d'AFFICHAGE du badge : le rôle prime (revendeur, administrateur).
const ROLE_CODES = ['client', 'reseller', 'admin', 'super_admin'];
function roleAndOffer(me){
  me = me || {};
  let role = ROLE_CODES.includes(me.role) ? me.role : null;
  let offer = me.offer === 'premium' || me.offer === 'free' ? me.offer : null;
  if(!role || !offer){
    const legacy = planKeyFromType(me.type);
    role = role || (legacy === 'admin' ? 'admin' : legacy === 'revendeur' ? 'reseller' : 'client');
    offer = offer || (legacy === 'vip' ? 'premium' : 'free');
  }
  const plan = role === 'reseller' ? 'revendeur' : (role === 'admin' || role === 'super_admin') ? 'admin' : (offer === 'premium' ? 'vip' : 'gratuit');
  return { role, offer, plan };
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

function fmtExpiry(iso){
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
}
// Barre de progression : cachée si le pourcentage est inconnu (jamais de barre « vide » inventée)
function setPassBar(trackId, fillId, pct, label){
  const track = $(trackId);
  track.hidden = pct === null;
  if(pct === null) return;
  $(fillId).style.width = pct + '%';
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  track.setAttribute('aria-valuenow', String(Math.round(pct)));
  track.setAttribute('aria-label', label);
}

// Pass de consommation : DONNÉES (quota) + VALIDITÉ (jours). Tous les chiffres viennent du panel, aucun calcul de consommation ici.
function renderPass(acc){
  const card = $('accGaugeCard');
  card.setAttribute('data-tier', acc.plan === 'gratuit' ? 'std' : 'premium');
  card.setAttribute('data-state', 'ready');
  $('passTier').textContent = String(planLabel(acc.plan)).toUpperCase();

  // DONNÉES
  const hasQuota = !!acc.quotaGB;
  const hasUsage = hasQuota && acc.usageAvailable && acc.remainingGB !== null && acc.usagePercent !== null;
  const usedOnly = acc.usageAvailable && !hasUsage && acc.quotaUsedGB !== null;   // mesure connue, pas de quota
  let lvl = 'na', pct = null;
  if(hasUsage){
    pct = Math.max(0, Math.min(100, acc.usagePercent));
    lvl = pct >= 85 ? 'high' : (pct >= 50 ? 'mid' : 'low');
    $('passQVal').textContent = fmtUsage(acc.quotaUsedGB);
    $('passQOf').textContent = '/ ' + fmtGB(acc.quotaGB);
    $('passQNote').textContent = pct >= 100 ? t('acc.pass.reached') : t('acc.pass.left', { left: fmtUsage(acc.remainingGB) });
  } else if(usedOnly){
    lvl = 'low';
    $('passQVal').textContent = fmtUsage(acc.quotaUsedGB);
    $('passQOf').textContent = t('acc.pass.noQuota');
    $('passQNote').textContent = '';
  } else {
    $('passQVal').textContent = t('acc.pass.unavailable');
    $('passQOf').textContent = hasQuota ? t('acc.pass.quotaOf', { quota: fmtGB(acc.quotaGB) }) : '';
    $('passQNote').textContent = t('acc.usageUnavailable');
  }
  $('passQuota').setAttribute('data-lvl', lvl);
  setPassBar('passQTrack', 'passQFill', pct, t('acc.pass.data'));

  // VALIDITÉ (jours restants ; barre seulement si la durée totale est connue)
  const date = fmtExpiry(acc.expiresAt);
  let dl = 'ok', dp = null;
  if(acc.daysLeft === null){
    $('passDVal').textContent = t('acc.pass.noExpiry');
    $('passDNote').textContent = '';
  } else if(acc.daysLeft === 0){
    dl = 'high';
    dp = acc.totalDays ? 0 : null;
    $('passDVal').textContent = t('acc.pass.expired');
    $('passDNote').textContent = date ? t('acc.pass.expiredOn', { date }) : '';
  } else {
    dl = acc.daysLeft <= 3 ? 'high' : (acc.daysLeft <= 7 ? 'mid' : 'ok');
    dp = acc.totalDays ? Math.max(0, Math.min(100, (acc.daysLeft / acc.totalDays) * 100)) : null;
    $('passDVal').textContent = tn('acc.pass.days', acc.daysLeft);
    $('passDNote').textContent = date ? t('acc.pass.expires', { date }) : '';
  }
  $('passDOf').textContent = '';
  $('passDays').setAttribute('data-lvl', dl);
  setPassBar('passDTrack', 'passDFill', dp, t('acc.pass.validity'));
}

// Abonné : une offre autre que « gratuit », non expirée. Le bouton Chat du rail n'existe que pour lui (l'écran, lui, renvoie à
// la connexion sans compte). Les comptes gratuits gardent « Messages et annonces » dans le profil : c'est par là que
// arrivent les offres de token et les factures.
function isSubscriber(acc){ return !!acc && acc.plan !== 'gratuit' && acc.daysLeft !== 0; }
function updateChatRail(acc){
  const sub = isSubscriber(acc);
  $('railBtn-chat').hidden = !sub;
  if(!sub && currentScreen === 'chat' && acc) showScreen('account');
}

function renderAccountCard(acc){
  Account.last = acc;
  if(typeof ProfileTheme !== 'undefined') ProfileTheme.refresh();   // l'offre (VIP…) peut donner l'accent premium
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
  $('accResellerRow').hidden = !['reseller', 'admin', 'super_admin'].includes(acc.role);   // droit donné par le RÔLE (panel)
  $('accMoreTitle').hidden = $('accMoreList').hidden = $('accResellerRow').hidden;   // « Plus » n'apparaît que s'il contient quelque chose
  $('accPanelRow').hidden = !API.state.ok;   // point d'accès aux fonctions avancées (paiement, offres…) : le Laboratoire du Free-Surf

  renderPass(acc);
  renderProfileView(acc.profileInfo);
  updateChatRail(acc);

  // Sous-titre du menu « Accès et abonnement » : jours restants réels, sinon l'offre
  $('accMenuAccessSub').textContent = acc.plan !== 'gratuit' && acc.daysLeft !== null
    ? (acc.daysLeft === 0 ? t('home.access.expired') : tn('acc.daysLeft', acc.daysLeft)) : planLabel(acc.plan);
  updateExpiryBanner();
  renderHome();   // l'accueil affiche « Accès expiré » dès que le panel l'indique
}

// ─── Dernier profil connu : gardé sur le téléphone pour rester consultable hors connexion ───
// Contient seulement ce que /api/user/me a déjà renvoyé pour l'écran Profil (jamais de jeton ni de mot de passe). Effacé à la déconnexion.
// Affiché UNIQUEMENT quand le panel est injoignable, toujours avec la date : jamais présenté comme une donnée à jour.
const ProfileCache = {
  KEY: 'profileCache',
  save(me){ if(me && typeof me === 'object' && me.profile) store.set(this.KEY, { at: Date.now(), username: String(me.username || ''), profile: me.profile }); },
  load(){ const v = store.get(this.KEY, null); return v && typeof v === 'object' && v.profile && typeof v.at === 'number' ? v : null; },
  clear(){ store.remove(this.KEY); },
};
function profileFallback(failure){
  const c = Account.profileReady ? null : ProfileCache.load();
  if(c){
    const info = ProfileContract.parse({ profile: c.profile });
    if(info.state === 'ready'){ info.cachedAt = c.at; info.username = c.username; renderProfileView(info); return; }
  }
  renderProfileView(failure);
}

// ─── Mon profil : AFFICHAGE du profil structuré calculé par le panel (rien n'est déduit ni accordé ici) ───
// États : loading · ready · absent (panel ancien) · invalid · network · down · unavailable. Une panne n'est jamais un statut de compte.
// La couleur (data-kind) n'est qu'une identité visuelle : les droits viennent UNIQUEMENT des options « allowed » du panel.
function renderProfileView(info){
  const view = $('accViewProfile');
  // Appareil modeste (peu de cœurs / peu de mémoire) : rendu de remplacement sans flou ni animation, même identité colorée
  try{ const lowEnd = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) || (navigator.deviceMemory && navigator.deviceMemory <= 2); view.classList.toggle('pf-lite', !!lowEnd); }catch(e){}
  const state = info && info.state ? info.state : 'loading';
  const failed = ['network', 'down', 'unavailable', 'invalid', 'absent'].indexOf(state) >= 0;
  if(failed && Account.profileReady){   // échec de rafraîchissement : on garde la dernière version connue, signalée comme telle
    $('profNotice').textContent = t('prof.stale'); $('profNotice').hidden = false;
    return;
  }
  $('profNotice').hidden = true;
  if(state === 'ready' && info.cachedAt){ $('profNotice').textContent = t('prof.cached', { d: new Date(info.cachedAt).toLocaleString(I18N.locale(), { dateStyle: 'short', timeStyle: 'short' }) }); $('profNotice').hidden = false; }
  if(state === 'ready' && !info.cachedAt) Account.profileReady = true;
  else if(failed || state === 'loading') Account.profileReady = false;
  view.setAttribute('data-state', failed ? 'error' : state);
  $('profStateCard').hidden = !failed;
  $('profBody').hidden = state !== 'ready';
  $('profOptionsOk').textContent = ''; $('profOptionsKo').textContent = '';
  if(failed){
    const k = state === 'network' || state === 'down' ? state : (state === 'unavailable' ? 'other' : state);
    $('profStateTitle').textContent = t(k === 'invalid' ? 'prof.err.invalid.t' : k === 'absent' ? 'prof.err.absent.t' : 'prof.err.' + k + '.t');
    $('profStateMsg').textContent = t(k === 'invalid' ? 'prof.invalid' : k === 'absent' ? 'prof.absent' : 'prof.err.' + k + '.m');
    $('profRetry').hidden = !(state === 'network' || state === 'down' || state === 'unavailable');
    $('profBadge').textContent = ''; $('profRole').textContent = '';
    return;
  }
  if(state !== 'ready') return;   // loading : le squelette est visible, aucune valeur n'est affichée
  const p = info.profile;
  view.setAttribute('data-kind', p.kind);
  view.setAttribute('data-st', p.statusCode);
  $('profStatusCard').setAttribute('data-st', p.statusCode);
  $('profBadge').textContent = t('prof.kind.' + p.kind);
  $('profRole').textContent = p.roleLabel || '';
  const acc = Account.last;   // même avatar et même nom que la carte du compte
  $('profName').textContent = (acc && acc.username) || info.username || '';
  const img = $('profAvImg'), fb = $('profAvDefault');
  if(acc && acc.avatar){ img.src = FREE_SURF_API_BASE + acc.avatar; img.hidden = false; fb.style.display = 'none'; img.onerror = () => { img.hidden = true; fb.style.display = ''; }; }
  else { img.hidden = true; fb.style.display = ''; }
  $('profStatus').textContent = t('prof.st.' + p.statusCode);
  const msg = $('profMessage');
  msg.textContent = p.statusMessage; msg.hidden = !p.statusMessage;
  $('profOffer').textContent = p.offerApplies ? (p.offerLabel || t('prof.unknownVal')) : t('prof.none');
  $('profValidityCell').hidden = !p.subscriptionApplies;
  $('profValidity').textContent = p.daysRemaining === null ? t('prof.noExpiry') : (p.daysRemaining < 0 ? t('prof.st.expired') : tn('prof.daysLeft', p.daysRemaining));
  $('profExpiry').textContent = p.expiresAt && p.daysRemaining !== null ? t(p.daysRemaining < 0 ? 'prof.expiredOn' : 'prof.expiresOn', { d: fmtExpiry(p.expiresAt) }) : '';
  let ok = 0, ko = 0;
  for(const o of p.options){
    const kind = o.allowed ? 'ok' : (o.reason.indexOf('profile_') === 0 ? 'wait' : 'lock');
    const card = document.createElement('div');
    card.className = 'pf-opt pf-opt-' + kind;
    const ico = document.createElement('span'); ico.className = 'pf-opt-ico';
    ico.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#' + (kind === 'ok' ? 'i-check-circle' : kind === 'wait' ? 'i-clock' : 'i-lock') + '"/></svg>';
    const body = document.createElement('span'); body.className = 'pf-opt-body';
    const title = document.createElement('span'); title.className = 'pf-opt-title'; title.textContent = o.label;
    const sub = document.createElement('span'); sub.className = 'pf-opt-sub';
    sub.textContent = o.allowed ? t('prof.allowed') : t(o.reason === 'requires_vip' ? 'prof.lockedVip' : kind === 'wait' ? 'prof.lockedStatus' : 'prof.locked');
    body.appendChild(title); body.appendChild(sub); card.appendChild(ico); card.appendChild(body);
    $(o.allowed ? 'profOptionsOk' : 'profOptionsKo').appendChild(card);
    if(o.allowed) ok++; else ko++;
  }
  $('profAllowedTitle').hidden = ok === 0;
  $('profLockedTitle').hidden = ko === 0;
  $('profResellerRow').hidden = !p.resellerName;
  $('profReseller').textContent = p.resellerName || '';
  $('profPanelRow').hidden = p.panelScope === 'none' && p.kind !== 'reseller' && p.kind !== 'admin' && p.kind !== 'super_admin';
  $('profPanel').textContent = t('prof.scope.' + (['reseller', 'admin'].indexOf(p.panelScope) >= 0 ? p.panelScope : 'none'));
  $('profExtra').hidden = $('profResellerRow').hidden && $('profPanelRow').hidden;
  $('profActions').hidden = !(API.state.ok && p.statusOk && p.panelScope !== 'none');   // seulement si le SERVEUR indique un accès au panel (revendeur, administrateur) ; les routes du panel refusent de toute façon les autres
}
Actions.profRetry = () => { renderProfileView({ state: 'loading' }); reloadAccountCard(); };

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
// « Continuer sur le Laboratoire du Free-Surf » : ouvre le site du panel (navigateur du téléphone) pour tout ce qui n'a pas sa place
// dans l'application VPN — paiement, offres, gestion avancée. Même adresse que l'API (voir ApiBase) ; jamais d'identifiant dans l'adresse.
// Connecté : la session passe au navigateur par un code d'échange à usage unique (60 s) placé dans le FRAGMENT de l'adresse
// (#code=…, jamais envoyé au serveur ni journalisé) ; le panel ouvre alors une session web sans redemander le mot de passe.
// Non connecté ou échec : le site s'ouvre normalement (connexion classique).
Actions.openPanel = async (next) => {
  if(!API.state.ok) return;
  const path = typeof next === 'string' && /^\/[a-z0-9/#-]*$/.test(next) ? next : '/dashboard';
  if(sessionStillValid()){
    try{
      const res = await apiFetch('/api/auth/exchange', { method: 'POST', body: JSON.stringify({ target: 'web', next: path }) });
      const url = res.ok && res.data && typeof res.data.url === 'string' ? res.data.url : '';
      if(/^\/auth\/exchange#code=[A-Za-z0-9_-]{32,100}$/.test(url)){ openExternal(API.state.base + url); return; }
    }catch(e){ /* repli : site sans session */ }
  }
  openExternal(API.state.base + '/');
};

// Communauté LABOSURF : le Live Chat du Laboratoire (salons officiel, communauté). Ouvert sur le site avec la session de
// l'application (code d'échange, voir openPanel) : pas de mot de passe redemandé. Sans compte : page de connexion du site.
Actions.openCommunityWeb = () => Actions.openPanel('/tchatch');   // version web (fichiers, réactions) ; la communauté intégrée est dans js/livechat.js
// Support : messages avec le revendeur ou l'administrateur (dans l'application si le compte y a accès, sinon sur le site)
Actions.openSupport = () => {
  if(authToken && !$('railBtn-chat').hidden){ showScreen('chat'); return; }
  Actions.openPanel('/mes-messages');
};

// Panel -> application : un code d'échange reçu par lien (App Link /app/open ou bouton « Ouvrir l'app » du panel) ouvre la session
// de l'application sans mot de passe. Ignoré si une session est déjà ouverte (on ne remplace jamais un compte connecté).
async function redeemExchange(code){
  if(sessionStillValid()) return;
  try{
    const res = await apiFetch('/api/auth/exchange/redeem', { method: 'POST', device: true, body: JSON.stringify({ code: code, target: 'app', remember: RememberMe.wanted() }) });
    if(!res.ok || !res.data || res.data.status !== 'ok' || !res.data.token){ toast(apiMessage(res, 'acc.exchangeFailed'), 'error', 4500); return; }
    authToken = res.data.token;
    authExpiresAt = sessionExpiryFrom(res.data);
    const name = res.data.user && res.data.user.username ? res.data.user.username : '';
    await afterAuth(name);
    toast(t('acc.exchangeDone'), 'success');
  }catch(e){ toast(t('err.panelOffline'), 'error'); }
}
window.LaboOnExchange = (attempt) => {
  if(!isNativeApp() || typeof window.LaboSurfNative.consumeExchangeCode !== 'function') return;
  if(!API.state.ok){   // adresse du panel pas encore prête au démarrage : on réessaie un peu plus tard (le code reste côté natif)
    if((attempt || 0) < 20) setTimeout(() => window.LaboOnExchange((attempt || 0) + 1), 500);
    return;
  }
  let code = '';
  try{ code = window.LaboSurfNative.consumeExchangeCode() || ''; }catch(e){ code = ''; }
  if(/^[A-Za-z0-9_-]{32,100}$/.test(code)) redeemExchange(code);
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

// Durée totale de l'abonnement en jours (début et fin fournis par le panel), sinon null
function subscriptionTotalDays(startedAt, expIso){
  if(!startedAt || !expIso) return null;
  const start = new Date(String(startedAt).slice(0, 10) + 'T00:00:00'), end = new Date(String(expIso).slice(0, 10) + 'T23:59:59');
  if(isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return null;
  return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));
}

// ─── Chargement du compte réel ───
function accountFromApi(me, sub, fallbackName){
  const { role, offer, plan } = roleAndOffer(me);
  const expiresAt = (sub && sub.expires_at) || me.expiration || '';
  // Contrat du panel : usage_available=false => tout le reste est ignoré (jamais lu comme 0)
  const usageAvailable = me.usage_available === true;
  const used = usageAvailable ? toNumber(me.quota_used_gb) : null;
  return {
    username: me.username || fallbackName || '',
    avatar: me.avatar || '',
    role,     // rôle (panel)
    offer,    // offre (panel)
    plan,     // clé d'affichage du badge
    daysLeft: plan === 'gratuit' ? null : daysLeftFromExpiration(expiresAt),
    totalDays: plan === 'gratuit' ? null : subscriptionTotalDays(sub && sub.started_at, expiresAt),   // null = inconnue (jamais inventée)
    graceDays: 3,
    quotaGB: (me.quota_gb !== undefined && me.quota_gb !== null) ? Number(me.quota_gb) : null,
    quotaUsedGB: used,
    expiresAt: expiresAt || null,
    usageAvailable,
    usageReason: usageAvailable ? null : (me.usage_reason || null),
    remainingGB: usageAvailable ? toNumber(me.remaining_gb) : null,
    usagePercent: usageAvailable ? toNumber(me.usage_percent) : null,
    profileInfo: ProfileContract.parse(me),   // profil structuré du panel (affichage seulement)
  };
}

// Libellé « dernière synchro » : conservé comme ÉTAT (et non comme texte) pour suivre la langue
const SYNC_KEYS = { now: 'common.justNow', syncing: 'acc.syncing', failed: 'acc.syncFailed', down: 'acc.panelDown' };
function setSyncState(state){ Account.syncState = state; $('accSyncTime').textContent = t(SYNC_KEYS[state]); }

async function loadAndShowAccount(fallbackName){
  const [meRes, subRes] = await Promise.all([apiFetch('/api/user/me'), apiFetch('/api/user/subscription')]);
  if(!authToken) return; // session expirée pendant le chargement
  renderAccountCard(accountFromApi(meRes.ok ? meRes.data || {} : {}, subRes.ok ? subRes.data || {} : {}, fallbackName));
  if(meRes.ok) ProfileCache.save(meRes.data); else profileFallback(ProfileContract.failure(meRes));
  $('accLoggedOut').hidden = true;
  $('accLoggedIn').hidden = false;
  setSyncState('now');
  loadServers();
  loadServices();
}

// Relecture du compte réel (me + abonnement) : SEULE source de la consommation affichée (contrat du panel, aucune
// valeur calculée ici). En cas d'échec, la dernière valeur connue est conservée — inconnu = indisponible, jamais 0.
async function reloadAccountCard(){
  try{
    const [meRes, subRes] = await Promise.all([apiFetch('/api/user/me'), apiFetch('/api/user/subscription')]);
    if(!meRes.ok){ setSyncState('failed'); profileFallback(ProfileContract.failure(meRes)); return; }
    ProfileCache.save(meRes.data);
    renderAccountCard(accountFromApi(meRes.data || {}, subRes.ok ? subRes.data || {} : {}, $('accNameTxt').textContent));
    setSyncState('now');
  }catch(e){
    setSyncState('down');   // panneau injoignable : on n'efface pas la valeur affichée
    profileFallback({ state: 'network' });
  }
}

async function afterAuth(username){
  RememberMe.save();   // « rester connecté » : la session (jamais le mot de passe) est gardée chiffrée sur le téléphone
  await loadAndShowAccount(username);
  if(!authToken) return;
  loadHomeBanner(); // le panel peut renvoyer la bannière du revendeur maintenant que le jeton existe
  loadAppMessages(); loadAnnouncements(true);
  clearInterval(Account.pollTimer);
  Account.pollTimer = setInterval(pollAccountSignals, 20000);
  if(typeof LC !== 'undefined' && LC.wantReturn){ LC.wantReturn = false; Actions.openCommunity(); }   // connexion demandée depuis la communauté : on y revient directement
}

// Durée de la session : « expires_in » (secondes) renvoyé par le panel à la connexion. Absent = inconnue (jamais inventée).
function sessionExpiryFrom(data){
  const n = data && typeof data.expires_in === 'number' && isFinite(data.expires_in) && data.expires_in > 0 ? data.expires_in : null;
  return n === null ? null : Date.now() + n * 1000;
}
// Le jeton est encore valable d'après le panel ? (le panel reste juge : un 401 déconnecte de toute façon)
const sessionStillValid = () => !!authToken && (authExpiresAt === null || Date.now() < authExpiresAt);

// ─── « Rester connecté » ───
// Le Panel ouvre une session d'appareil de confiance (30 j par défaut) quand l'application la demande (remember) en
// s'identifiant (X-Device-Id). Seul son JETON est gardé, chiffré par le Keystore Android (MainActivity -> SessionVault) :
// jamais le mot de passe, jamais dans localStorage. Effacé à la déconnexion, à l'expiration, ou si l'option est coupée.
// Le Panel reste juge : session révoquée (« Mes appareils », mot de passe changé…) = 401 = déconnexion propre.
const RememberMe = {
  supported(){
    return isNativeApp() && ['sessionSave', 'sessionLoad', 'sessionClear'].every((m) => typeof window.LaboSurfNative[m] === 'function');
  },
  wanted(){ return this.supported() && store.get('rememberMe', true) !== false; },
  save(){
    if(!this.wanted() || !authToken || !authExpiresAt) return;   // durée inconnue : rien n'est gardé
    try{ window.LaboSurfNative.sessionSave(String(authToken), Number(authExpiresAt)); }catch(e){}
  },
  clear(){ if(this.supported()){ try{ window.LaboSurfNative.sessionClear(); }catch(e){} } },
  // { token, expiresAt } si une session encore valable (plus d'une minute) est gardée, sinon null
  load(){
    if(!this.wanted()) return null;
    let raw = '';
    try{ raw = String(window.LaboSurfNative.sessionLoad() || ''); }catch(e){ return null; }
    const parts = raw.split('\n');
    const exp = parts.length === 2 ? Number(parts[1]) : NaN;
    if(!/^[A-Za-z0-9_-]{20,200}$/.test(parts[0] || '') || !isFinite(exp) || exp < Date.now() + 60000){ this.clear(); return null; }
    return { token: parts[0], expiresAt: exp };
  },
};

// Au démarrage : session gardée -> compte rouvert sans ressaisir les identifiants (le panel la revalide aussitôt).
async function restoreRememberedSession(attempt){
  if(authToken) return;
  if(!API.state.ok){ if((attempt || 0) < 20) setTimeout(() => restoreRememberedSession((attempt || 0) + 1), 500); return; }
  const s = RememberMe.load();
  if(!s) return;
  authToken = s.token;
  authExpiresAt = s.expiresAt;
  try{ await afterAuth(''); }catch(e){ /* hors ligne : le compte reste ouvert, les données se rechargeront */ }
}

Actions.toggleRemember = () => {
  const on = !(store.get('rememberMe', true) !== false);
  store.set('rememberMe', on);
  if(on) RememberMe.save(); else RememberMe.clear();   // couper l'option efface la session gardée (la session en cours continue)
  if(typeof renderSettings === 'function') renderSettings();
};

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
    const login = await apiFetch('/api/auth/login', { method: 'POST', device: true, body: JSON.stringify({ username: u, password: p, remember: RememberMe.wanted() }) });
    if(!login.ok || !login.data || login.data.status !== 'ok'){
      showFormError('accError', apiMessage(login, 'acc.errBadCredentials'));
      return;
    }
    authToken = login.data.token;
    authExpiresAt = sessionExpiryFrom(login.data);
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
    const reg = await apiFetch('/api/auth/register', { method: 'POST', device: true,
      body: JSON.stringify({ username: u, contact: c, recovery_secret: rs, password: p, confirm_password: p2, remember: RememberMe.wanted() }) });
    if(!reg.ok || !reg.data || reg.data.status !== 'ok'){
      showFormError('regError', apiMessage(reg, 'acc.errRegister'));
      return;
    }
    authToken = reg.data.token;
    authExpiresAt = sessionExpiryFrom(reg.data);
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
  if(np.length < 8){ showFormError('fpError', t('acc.errPwMin8')); return; }   // même règle que le panel (8 caractères)
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
  Account.view = ['menu', 'access', 'security', 'profile'].includes(name) ? name : 'menu';
  $('accHome').hidden = Account.view !== 'menu';
  $('accViewProfile').hidden = Account.view !== 'profile';
  $('accViewAccess').hidden = Account.view !== 'access';
  $('accViewSecurity').hidden = Account.view !== 'security';
  $('screen-account').scrollTop = 0;
  // Ouvrir les messages les marque comme lus côté serveur (comportement historique) : seulement ici, jamais en arrière-plan
  if(Account.view === 'security') loadDevices();
}

// ─── Sécurité : mes appareils, déconnexion de tous les appareils, mot de passe (API du panel /api/account/*) ───
async function loadDevices(){
  if(!authToken) return;
  const list = $('secDevicesList');
  list.innerHTML = `<div class="empty">${esc(t('common.dots'))}</div>`;
  try{
    const res = await apiFetch('/api/account/devices');
    if(!authToken) return;
    if(!res.ok || !res.data || !Array.isArray(res.data.devices)){ list.innerHTML = `<div class="empty">${esc(apiMessage(res, 'acc.sec.devicesError'))}</div>`; return; }
    Account.devices = res.data.devices;
    renderDevices();
  }catch(e){ list.innerHTML = `<div class="empty">${esc(t('err.panel'))}</div>`; }
}
function renderDevices(){
  const list = $('secDevicesList'), items = Account.devices || [];
  if(!items.length){ list.innerHTML = `<div class="empty">${esc(t('acc.sec.noDevices'))}</div>`; return; }
  list.innerHTML = items.map((d, i) => {
    const seen = d.last_seen_at ? new Date(d.last_seen_at * 1000).toLocaleString(I18N.lang === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—';
    const action = d.current ? `<span class="badge">${esc(t('acc.sec.thisDevice'))}</span>`
      : `<button class="btn btn-ghost btn-sm" type="button" data-action="revokeDevice" data-index="${i}">${esc(t('acc.sec.disconnect'))}</button>`;
    return `<div class="row"><span class="row-ico">${ic('shield')}</span><div class="row-main"><div class="row-title">${esc(d.device)}</div>
      <div class="row-sub">${esc(t('acc.sec.lastSeen', { when: seen }))}</div></div>${action}</div>`;
  }).join('');
}
Actions.revokeDevice = async (el) => {
  const d = (Account.devices || [])[Number(el.dataset.index)];
  if(!d || d.current) return;
  // appareil identifié : toutes ses sessions ; sinon (ancienne session sans identifiant) : cette session seule
  const path = d.device_id ? `/api/account/devices/${encodeURIComponent(d.device_id)}/revoke`
    : (d.session_id ? `/api/account/sessions/${encodeURIComponent(d.session_id)}/revoke` : '');
  if(!path) return;
  try{
    const res = await apiFetch(path, { method: 'POST' });
    toast(res.ok ? t('acc.sec.deviceRevoked') : apiMessage(res, 'err.panel'), res.ok ? 'success' : 'error');
  }catch(e){ toast(t('err.panel'), 'error'); }
  loadDevices();
};
Actions.logoutAllDevices = async () => {
  if(!authToken) return;
  const ok = await confirmDialog({ title: t('acc.sec.logoutAll'), message: t('acc.sec.logoutAllConfirm'), confirm: t('acc.sec.logoutAll'), danger: true });
  if(!ok || !authToken) return;
  try{
    const res = await apiFetch('/api/account/sessions/revoke-all', { method: 'POST', body: JSON.stringify({ keep_current: false }) });
    if(!res.ok){ toast(apiMessage(res, 'err.panel'), 'error'); return; }
  }catch(e){ toast(t('err.panel'), 'error'); return; }
  // toutes les sessions sont invalidées côté serveur, y compris celle-ci
  if(VPN.state === 'on') disconnectVpn();
  resetToLoggedOut();
  toast(t('acc.sec.loggedOutAll'), 'success');
};
Actions.changePassword = async () => {
  clearFormError('secPwError');
  const cur = $('secPwCurrent').value, np = $('secPwNew').value, cp = $('secPwConfirm').value, btn = $('secPwBtn');
  if(!cur || !np || !cp){ showFormError('secPwError', t('acc.errFillAll')); return; }
  if(np.length < 8){ showFormError('secPwError', t('acc.errPwMin8')); return; }
  if(np !== cp){ showFormError('secPwError', t('acc.errMismatch')); return; }
  if(isBusy(btn)) return;
  setBusy(btn, true, 'acc.changing');
  try{
    const res = await apiFetch('/api/account/password', { method: 'POST',
      body: JSON.stringify({ current_password: cur, new_password: np, confirm_password: cp }) });
    if(res.ok && res.data && res.data.status === 'ok'){
      ['secPwCurrent', 'secPwNew', 'secPwConfirm'].forEach((id) => { $(id).value = ''; });
      toast(t('acc.sec.pwChangedOthers'), 'success', 4500);
      loadDevices();
    } else {
      showFormError('secPwError', apiMessage(res, 'acc.errPwChange'));
    }
  }catch(e){
    showFormError('secPwError', t('err.panel'));
  }finally{
    setBusy(btn, false, 'acc.sec.pwChangeBtn');
  }
};
Actions.accOpen = (el) => setAccView(el.dataset.view);
Actions.accBack = () => setAccView('menu');
Actions.toggleAnnouncements = (el) => {
  const list = $('announcementsList'), open = list.hidden;
  list.hidden = !open;
  el.setAttribute('aria-expanded', String(open));
};

// ─── Déconnexion du compte / session expirée ───
function resetToLoggedOut(){
  authToken = null;
  $('railBtn-chat').hidden = true;
  if(currentScreen === 'chat') showScreen('account');
  authExpiresAt = null;
  RememberMe.clear();   // déconnexion ou session expirée : plus rien n'est gardé sur le téléphone
  Account.last = null;
  Account.profileReady = false;
  ProfileCache.clear();   // plus de compte : le dernier profil connu est effacé du téléphone
  renderProfileView({ state: 'loading' });
  if(typeof ProfileTheme !== 'undefined') ProfileTheme.refresh();   // plus de compte : identité LABOSURF par défaut
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

// Déconnexion : la session est RÉVOQUÉE côté panel (POST /api/auth/logout, jeton Bearer), pas seulement oubliée ici.
// Sans attendre la réponse : hors ligne, l'app se déconnecte quand même (la session expirera côté serveur).
function endServerSession(){
  if(!authToken) return;
  try{ Promise.resolve(apiFetch('/api/auth/logout', { method: 'POST', timeout: 5000 })).catch(() => {}); }catch(e){}
}

Actions.logout = () => {
  if(VPN.state === 'on') disconnectVpn(); // ne jamais laisser un tunnel actif sans compte affiché
  endServerSession();   // lit le jeton avant qu'il soit effacé
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
    await reloadAccountCard();
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

// Bouton ACTIVER d'une offre de token (message de l'administrateur). L'API décide : activé ou refusé avec une raison.
Actions.activateOffer = async (el) => {
  if(!authToken || !el) return;
  const id = String(el.dataset.offer || '');
  if(!/^\d{1,9}$/.test(id) || isBusy(el)) return;
  setBusy(el, true, 'common.dots');
  try{
    const res = await apiFetch('/api/user/tokens/' + id + '/activate', { method: 'POST', body: '{}' });
    if(res.ok && res.data && res.data.status === 'ok'){
      toast(apiMessage(res, 'tok.activated'), 'success');
      await loadAndShowAccount();
      await loadAppMessages();
    } else {
      toast(apiMessage(res, 'tok.refused'), 'error');   // message du serveur : token expiré, révoqué, appareils au maximum…
    }
  }catch(e){
    toast(t('err.panelRetry'), 'error');
  }finally{
    setBusy(el, false, 'tok.activate');
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

// Heure et jour RÉELS du message (created_at fourni par le panel) ; rien d'affiché si la date est absente ou illisible
function chatTime(m){
  const d = new Date(String(m.created_at || m.created || m.timestamp || ''));
  if(isNaN(d.getTime())) return { day: '', dayLabel: '', hour: '' };
  const pad = (n) => String(n).padStart(2, '0');
  const key = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const now = new Date(), yest = new Date(Date.now() - 86400000);
  const same = (x) => x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth() && x.getDate() === d.getDate();
  const label = same(now) ? t('chat.today') : (same(yest) ? t('chat.yesterday') : pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear());
  return { day: key, dayLabel: label, hour: pad(d.getHours()) + ':' + pad(d.getMinutes()) };
}

let messagesCache = [];
function renderAppMessages(messages){
  if(messages) messagesCache = messages;
  const thread = $('messagesThread');
  if(!messagesCache.length){
    thread.innerHTML = `<div class="empty" style="padding:var(--sp-4) 0">${esc(t('acc.noMessages'))}</div>`;
    return;
  }
  let lastDay = '';
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
    // Offre de token envoyée par l'administrateur : le serveur ne met JAMAIS la valeur du token dans le message ;
    // le bouton ACTIVER demande au serveur d'activer l'offre attribuée à CE compte (le serveur décide, pas l'application).
    const offerId = (m.message_type === 'token_offer' && /^token:\d{1,9}$/.test(String(m.attachment_filename || ''))) ? String(m.attachment_filename).slice(6) : '';
    const offer = offerId ? `<div style="margin-top:8px"><button class="btn btn-primary" type="button" data-action="activateOffer" data-offer="${esc(offerId)}" data-i18n="tok.activate">${esc(t('tok.activate'))}</button></div>` : '';
    const when = chatTime(m);
    const sep = (when.day && when.day !== lastDay) ? `<div class="chat-day"><span>${esc(when.dayLabel)}</span></div>` : '';
    if(when.day) lastDay = when.day;
    return `${sep}<div class="bubble-row${mine ? ' mine' : ''}">${avatar}<div class="bubble${offerId ? ' token-offer' : ''}">${esc(m.body)}${attach}${offer}<div class="bubble-meta">${mine ? '' : esc(role) + (when.hour ? ' · ' : '')}${esc(when.hour)}</div></div></div>`;
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
    if(res.ok && res.data && res.data.messages && currentScreen !== 'chat'){
      Account.unreadMessages = res.data.messages.filter((m) => m.sender_role !== 'client' && !m.read_at).length;
      updateAccountBadge();
    }
  }catch(e){}
}

// Zone de saisie : grandit avec le texte (jusqu'à 4 lignes), comme les messageries modernes
function growComposer(){
  const el = $('msgComposerInput');
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight || 0, 120) + 'px';
}
document.addEventListener('input', (e) => { if(e.target && e.target.id === 'msgComposerInput') growComposer(); });

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
      growComposer();
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
  const cnt = (n) => n > 9 ? '9+' : String(n);
  const chat = $('chatBadge');
  chat.hidden = total === 0;
  chat.textContent = cnt(total);
  const cardBadge = $('messagesCardBadge');
  cardBadge.hidden = Account.unreadMessages === 0;
  cardBadge.textContent = cnt(Account.unreadMessages);
  const rowBadge = $('messagesRowBadge');
  rowBadge.hidden = total === 0;
  rowBadge.textContent = cnt(total);
}

// Pastilles (messages + annonces) et, si le Profil est à l'écran, consommation/abonnement : sans cette
// relecture, la consommation restait figée sur la lecture faite à la connexion alors que PRO continue de mesurer.
function pollAccountSignals(){
  pollUnreadMessages();
  loadAnnouncements(false);
  if(currentScreen === 'account' && authToken) reloadAccountCard();   // écran Profil ouvert (aussi à son ouverture)
}

document.addEventListener('langchange', () => {
  if(Account.last) renderAccountCard(Account.last);
  renderAppMessages();
  renderAnnouncements();
  if(Account.syncState) setSyncState(Account.syncState);
  renderRenewalConfirmation();
  // Messages d'erreur de formulaire : transitoires, effacés au changement de langue (jamais affichés dans la mauvaise langue)
  document.querySelectorAll('.form-error.show').forEach((el) => el.classList.remove('show'));
});

