// Écran d'accueil + machine d'états de la connexion VPN.
// États : off | connecting | on | disconnecting | error
// La logique de connexion (appel /api/user/connect, pont natif LaboSurfNative) est celle d'avant ;
// on y ajoute des états intermédiaires propres, des délais maximum et des messages clairs.

const VPN = {
  state: 'off',
  errorSpec: null,      // { key, data } ou { text } : le message est re-traduit à chaque rendu (changement de langue)
  target: '',           // nom du serveur visé par la tentative de connexion en cours
  session: null,        // { server, startedAt } pendant qu'un tunnel est actif
  clock: null,
  watchdog: null,       // filet de sécurité si le moteur natif ne répond jamais
  trialLimitMinutes: null,
  stats: null,          // { rx, tx, rxSpeed, txSpeed } : uniquement des valeurs réellement fournies par le moteur natif
  statsState: 'loading',// loading | ready | unavailable (jamais de valeur inventée)
  statsTimer: null,
};
// Mode aperçu (navigateur seulement, ?preview=1) : montre les écrans « connecté » pour la mise au point du design.
// Rien n'est tunnelé et un bandeau permanent l'indique — sans ce paramètre, le navigateur ne simule jamais une connexion.
const PREVIEW = /[?&]preview=1(&|$)/.test(location.search);
const STATS_FIRST_WAIT_MS = 10000;  // sans statistiques après 10 s de connexion -> « indisponibles »
const STATS_STALE_MS = 30000;       // plus aucune mise à jour depuis 30 s -> « indisponibles »
const CONNECT_WATCHDOG_MS = 60000;    // large : Android peut afficher sa boîte d'autorisation VPN
const DISCONNECT_WATCHDOG_MS = 10000;

// Message d'erreur affiché : texte du panel dans la langue courante s'il en fournit un (data.message[_fr|_en]),
// sinon texte traduit de l'app. Conserver la SPEC (et non le texte) permet de re-traduire si la langue change.
const normalizeErr = (spec) => (typeof spec === 'string' ? { text: spec } : (spec || { key: 'err.connect' }));
function errorText(spec){
  spec = normalizeErr(spec);
  if(spec.text) return spec.text;
  return localizedField(spec.data, 'message') || t(spec.key || 'err.connect');
}
function setVpnState(state, spec){
  VPN.state = state;
  VPN.errorSpec = state === 'error' ? normalizeErr(spec) : null;
  renderHome();
}

// Situation réelle de l'utilisateur AVANT de se connecter (uniquement quand le tunnel est à l'arrêt).
// Chaque valeur repose sur une donnée effectivement connue : jeton, offre/expiration du panel, état de la liste des serveurs.
function homeReadiness(){
  if(!authToken) return 'login';
  const acc = (typeof Account !== 'undefined') ? Account.last : null;
  if(acc && acc.plan !== 'gratuit' && acc.daysLeft === 0) return 'expired';   // offre payante dont la date est dépassée (période de grâce)
  if(Servers.state === 'idle' || Servers.state === 'loading') return 'loading';
  if(Servers.state === 'error') return 'srvError';
  if(Servers.state === 'ready' && !Servers.list.length) return 'noServer';
  const chosen = Servers.state === 'ready' ? getSelectedServer() : null;
  if(chosen && !chosen.available) return 'srvDown';   // le serveur retenu est en maintenance ou hors service
  return 'ready';
}

// Bouton d'action sous le statut : n'apparaît que quand il y a une vraie prochaine étape à proposer
const HOME_ACTIONS = {
  login:    { key: 'home.cta.login',   action: 'nav', screen: 'account', primary: true, guide: true },
  expired:  { key: 'home.cta.renew',   action: 'openRenewal', primary: true },
  noServer: { key: 'home.cta.refresh', action: 'refreshServers' },
  srvError: { key: 'common.retry',     action: 'refreshServers' },
  srvDown:  { key: 'home.cta.chooseServer', action: 'nav', screen: 'servers', primary: true },
};
function renderHomeAction(ready){
  const cfg = HOME_ACTIONS[ready];
  $('homeAction').hidden = !cfg;
  if(!cfg) return;
  const cta = $('homeCta');
  cta.textContent = t(cfg.key);
  cta.dataset.action = cfg.action;
  if(cfg.screen) cta.dataset.screen = cfg.screen; else delete cta.dataset.screen;
  cta.className = 'btn btn-block ' + (cfg.primary ? 'btn-primary' : 'btn-secondary');
  $('homeCtaGuide').hidden = !cfg.guide;
}

let lastStatusKey = '';
function renderHome(){
  const st = VPN.state;
  const busy = st === 'connecting' || st === 'disconnecting';
  const ready = st === 'off' ? homeReadiness() : '';
  $('home').dataset.state = st;
  $('home').dataset.ready = ready;
  const statusKey = st === 'off' ? 'home.ready.' + ready : 'home.state.' + st;
  $('statusTitle').textContent = t(statusKey + '.title');
  $('statusSub').textContent = st === 'error' ? '' : t(statusKey + '.sub');
  if(statusKey !== lastStatusKey){   // petit fondu à chaque vrai changement d'état (jamais à un simple redessin)
    lastStatusKey = statusKey;
    const box = $('statusTitle').parentNode;
    box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash');
  }
  renderHomeAction(ready);
  // Durée et serveur : uniquement avec une vraie session (VPN.session est posée par markConnected, jamais ailleurs)
  const live = (st === 'on' || st === 'disconnecting') && !!VPN.session;
  $('connMeta').hidden = !live;
  if(live) $('connServer').textContent = VPN.session.server;
  $('homeError').hidden = st !== 'error';
  $('homeErrorText').textContent = VPN.errorSpec ? errorText(VPN.errorSpec) : '';

  const btn = $('powerBtn');
  btn.setAttribute('aria-label', t(st === 'on' ? 'home.power.disconnect' : (busy ? 'home.power.wait' : 'home.power.connect')));
  btn.setAttribute('aria-disabled', String(busy));
  $('powerLbl').textContent = t({ on: 'home.btn.on', connecting: 'home.btn.connecting', disconnecting: 'home.btn.disconnecting' }[st] || 'home.btn.start');
  $('powerHint').textContent = t('home.btn.stop');   // affiché par le CSS seulement quand connecté : un appui arrête la connexion
  $('heroBrand').classList.toggle('on', st === 'on');

  const elapsed = VPN.session ? (Date.now() - VPN.session.startedAt) / 1000 : 0;
  $('timer').textContent = fmtClock(elapsed);
  renderStats();

  // Écran Historique : pastille d'état + infos de connexion réelles
  const pill = $('statusPill');
  pill.className = 'status-pill' + (st === 'on' ? ' on' : (busy ? ' busy' : ''));
  $('statusPillTxt').textContent = t('pill.' + st);
  $('connInfoCard').hidden = !(st === 'on' && VPN.session);
  if(VPN.session){ $('infoServer').textContent = VPN.session.server; $('infoDuration').textContent = fmtClock(elapsed); }
  fitHomeScreen();
}

// L'accueil est UNE page, sans défilement : logo, START, état et action en haut, bannière dans tout l'espace restant.
// Si l'écran est trop court, seules les commandes sont réduites (jamais en dessous de 62 %) pour garder à la bannière
// une hauteur minimale ; un message de bannière plus long que la place défile dans la bannière elle-même.
const HOME_BANNER_MIN = 140, HOME_BANNER_IDEAL = 250;   // hauteur minimale de la bannière, et hauteur au-delà de laquelle un long contenu défile
function fitHomeScreen(){
  const scr = $('screen-home'), main = $('homeMain');
  if(!scr || !main || !scr.classList.contains('active')) return;
  main.style.transform = 'none';
  main.style.marginBottom = '';
  const cs = getComputedStyle(scr);
  const avail = scr.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const need = main.scrollHeight;
  // hauteur réservée à la bannière = son minimum + ce qui l'entoure (crédit, marges, espacement de l'accueil)
  const foot = document.querySelector('.home-foot'), banner = $('homeBannerCard');
  const around = (foot && banner ? foot.offsetHeight - banner.offsetHeight : 0) + (parseFloat(getComputedStyle($('home')).rowGap) || 0);
  // la bannière réclame la hauteur de son contenu (entre le minimum et l'idéal) ; au-delà, son corps défile
  const inner = document.querySelector('#homeBannerDefault:not([hidden]), #homeBannerAd:not([hidden])'), bs = getComputedStyle($('homeBannerBody'));
  const natural = inner ? inner.offsetHeight + parseFloat(bs.paddingTop) + parseFloat(bs.paddingBottom) : HOME_BANNER_MIN;
  const reserve = Math.min(Math.max(natural, HOME_BANNER_MIN), HOME_BANNER_IDEAL) + around;
  let scale = 1;
  if(need > avail - reserve && avail > 0) scale = Math.max(0.62, (avail - reserve) / need);
  if(scale < 1){
    main.style.transform = 'scale(' + scale + ')';
    main.style.marginBottom = (-(need * (1 - scale))) + 'px';   // la mise à l'échelle ne réduit pas la boîte : on rend l'espace
  }
  // Le rail n'occupe que la partie haute ; si l'écran est trop court pour qu'il ne touche pas la bannière, elle reste à côté de lui
  const rail = $('rail');
  if(foot && banner && rail){
    const app = getComputedStyle($('app')), num = (v, d) => parseFloat(app.getPropertyValue(v)) || d;
    const n = num('--rail-n', 4), btn = num('--rail-btn', 48), gap = num('--rail-gap', 8);
    const railBottom = rail.getBoundingClientRect().top + 5 + n * btn + (n - 1) * gap + 6;   // rail replié
    foot.classList.toggle('is-inset', railBottom > banner.getBoundingClientRect().top - 6);
  }
}
window.addEventListener('resize', fitHomeScreen);
window.addEventListener('orientationchange', () => setTimeout(fitHomeScreen, 200));

// Trafic : trois états honnêtes. loading = connecté, on attend le moteur ; ready = valeurs réelles ;
// unavailable = le moteur n'en fournit pas (ou plus). Aucune valeur n'est jamais fabriquée.
function renderStats(){
  const tiles = $('homeTiles');
  tiles.hidden = VPN.state !== 'on';
  if(tiles.hidden) return;
  const state = VPN.stats && VPN.statsState === 'ready' ? 'ready' : VPN.statsState;
  tiles.dataset.state = state;
  $('statNote').textContent = state === 'ready' ? '' : t(state === 'loading' ? 'home.stats.loading' : 'home.stats.unavailable');
  $('statNote').hidden = state === 'ready';
  const s = VPN.stats || {};
  const val = (n) => (typeof n === 'number' && isFinite(n) && n >= 0) ? fmtBytes(n) : '—';
  $('statRx').textContent = state === 'ready' ? val(s.rx) : '';
  $('statTx').textContent = state === 'ready' ? val(s.tx) : '';
  $('statRxSpeed').textContent = state === 'ready' && typeof s.rxSpeed === 'number' && isFinite(s.rxSpeed) ? fmtBytes(s.rxSpeed) + '/s' : '';
  $('statTxSpeed').textContent = state === 'ready' && typeof s.txSpeed === 'number' && isFinite(s.txSpeed) ? fmtBytes(s.txSpeed) + '/s' : '';
}
function resetStats(){
  clearTimeout(VPN.statsTimer);
  VPN.stats = null;
  VPN.statsState = 'loading';
}
function armStatsTimer(ms){
  clearTimeout(VPN.statsTimer);
  VPN.statsTimer = setTimeout(() => {
    if(VPN.state !== 'on') return;
    VPN.statsState = 'unavailable';
    renderStats(); fitHomeScreen();
  }, ms);
}

// ─── Durée de connexion ───
function startClock(){
  stopClock();
  VPN.clock = setInterval(() => {
    if(!VPN.session) return;
    const elapsed = Math.floor((Date.now() - VPN.session.startedAt) / 1000);
    $('timer').textContent = fmtClock(elapsed);
    $('infoDuration').textContent = fmtClock(elapsed);

    // Limite d'essai éventuelle, transmise par le panel pour ce plan
    if(VPN.trialLimitMinutes !== null){
      const remaining = VPN.trialLimitMinutes * 60 - elapsed;
      if(remaining === 300) toast(t('trial.fiveMin'), 'warning');
      if(remaining <= 0){
        toast(t('trial.over'), 'warning', 4200);
        disconnectVpn();
      }
    }
  }, 1000);
}
function stopClock(){ clearInterval(VPN.clock); VPN.clock = null; }

// ─── Transitions ───
function markConnected(){
  clearTimeout(VPN.watchdog);
  VPN.session = { server: VPN.target, startedAt: Date.now() };
  resetStats(); armStatsTimer(STATS_FIRST_WAIT_MS);
  setVpnState('on');
  startClock();
  logEvent('ok', 'log.connected', { server: VPN.session.server });
  toast(t('toast.connected'), 'success');
  const pb = $('powerBtn'); pb.classList.add('pop'); setTimeout(() => pb.classList.remove('pop'), 600);
}

function markDisconnected(){
  clearTimeout(VPN.watchdog);
  stopClock();
  const wasOn = VPN.state === 'on';
  if(VPN.session){
    Activity.addSession({ server: VPN.session.server, seconds: (Date.now() - VPN.session.startedAt) / 1000, ok: true });
    logEvent('info', 'log.disconnected', { server: VPN.session.server });
  }
  VPN.session = null;
  resetStats();
  VPN.trialLimitMinutes = null;
  setVpnState('off');
  if(wasOn) toast(t('toast.connectionLost'), 'warning'); // tunnel coupé sans action de l'utilisateur
}

function failConnect(serverName, spec){
  const message = errorText(spec);
  clearTimeout(VPN.watchdog);
  stopClock();
  logEvent('err', 'log.connectFailed', { server: serverName, detail: message });
  // Un tunnel déjà établi qui échoue est enregistré comme session normale, sinon comme tentative échouée
  if(VPN.session) Activity.addSession({ server: VPN.session.server, seconds: (Date.now() - VPN.session.startedAt) / 1000, ok: true });
  else Activity.addSession({ server: serverName, seconds: 0, ok: false });
  VPN.session = null;
  resetStats();
  setVpnState('error', spec);
  toast(message, 'error');
}

async function connectVpn(){
  if(!authToken){ toast(t('err.loginFirst'), 'warning'); showScreen('account'); return; }
  if(Servers.state === 'loading'){ toast(t('err.serversLoading'), 'info'); return; }
  const target = getSelectedServer();
  if(!target){ toast(t('srv.emptyTitle'), 'warning'); showScreen('servers'); return; }
  if(!target.available){ toast(t('err.serverUnavailable'), 'warning'); showScreen('servers'); return; }

  if(homeReadiness() === 'expired'){ toast(t('err.expired'), 'warning', 4200); Actions.openRenewal(); return; }

  const name = serverDisplayName(target);
  VPN.target = name;
  if(!isNativeApp() && !PREVIEW){
    // Hors de l'application Android il n'existe aucun moteur : on le dit au lieu de simuler une connexion.
    setVpnState('error', { key: 'err.browserOnly' });
    return;
  }
  setVpnState('connecting');
  logEvent('info', 'log.connecting', { server: name });

  // La vraie configuration (uri) est récupérée ici, en direct, juste avant la connexion — jamais
  // affichée, jamais stockée au-delà de cette variable locale (voir /api/user/connect côté panel).
  let cfg = null, errSpec = null;
  try{
    const params = new URLSearchParams();
    if(target.id !== undefined && target.id !== null) params.set('server_id', target.id);
    const deviceId = getDeviceId();
    if(deviceId) params.set('device_id', deviceId);
    const res = await apiFetch('/api/user/connect' + (params.toString() ? '?' + params.toString() : ''), { timeout: 20000 });
    if(res.ok && res.data && res.data.status === 'success' && Array.isArray(res.data.configs) && res.data.configs.length){
      cfg = res.data.configs[0];
      // Limite d'essai (minutes) pour ce plan, sinon null = illimité
      VPN.trialLimitMinutes = (typeof res.data.trial_limit_minutes === 'number' && res.data.trial_limit_minutes > 0)
        ? res.data.trial_limit_minutes : null;
    } else {
      // ex : essai gratuit déjà utilisé sur cet appareil (message du panel, dans la langue courante s'il la fournit)
      errSpec = res.expired ? { key: 'err.sessionExpired' } : { key: 'err.connect', data: res.data };
    }
  }catch(e){
    errSpec = { key: 'err.panel' };
  }
  if(VPN.state !== 'connecting') return; // annulé entre-temps (déconnexion du compte, par exemple)
  if(!cfg){ failConnect(name, errSpec || { key: 'err.connect' }); return; }

  if(isNativeApp()){
    // Le natif rapportera l'état réel via window.onNativeVpnState('connected' | 'error' | ...)
    VPN.watchdog = setTimeout(() => {
      if(VPN.state === 'connecting') failConnect(name, { key: 'err.timeout' });
    }, CONNECT_WATCHDOG_MS);
    try{
      window.LaboSurfNative.startVpn(JSON.stringify({ name: target.name, proto: cfg.protocol, uri: cfg.uri }));
    }catch(e){
      failConnect(name, { key: 'err.connect' });
    }
    return;
  }
  // Aperçu navigateur (?preview=1) : pas de moteur natif. Rien n'est réellement tunnelé,
  // la simulation est visuelle uniquement et signalée par le bandeau « Aperçu ».
  setTimeout(() => { if(VPN.state === 'connecting') markConnected(); }, 1200);
}

function disconnectVpn(){
  if(VPN.state !== 'on') return;
  setVpnState('disconnecting');
  VPN.watchdog = setTimeout(() => { if(VPN.state === 'disconnecting') markDisconnected(); }, DISCONNECT_WATCHDOG_MS);
  if(isNativeApp()){
    try{ window.LaboSurfNative.stopVpn(); }catch(e){ markDisconnected(); }
    return; // l'état 'off' arrivera via onNativeVpnState('disconnected')
  }
  setTimeout(markDisconnected, 450);
}

Actions.togglePower = () => {
  if(VPN.state === 'on') disconnectVpn();
  else if(VPN.state === 'off' || VPN.state === 'error') connectVpn();
  // connecting / disconnecting : on ignore les taps (le bouton affiche un indicateur)
};

// ─── Pont natif (Kotlin -> JS) ───
// Certains détails renvoyés par le natif sont des codes (traduits ici), d'autres du texte brut.
function nativeDetailText(detail){
  if(detail === 'vpn_permission_denied') return t('err.vpnPermission');
  if(detail === 'engine_unavailable') return t('err.engineUnavailable');
  return detail || '';
}
window.onNativeVpnState = function(nativeState, detail){
  if(nativeState === 'connected'){
    if(VPN.state !== 'connecting') VPN.target = VPN.target || t('home.server.none'); // tunnel déjà actif (activité recréée)
    markConnected();
  } else if(nativeState === 'disconnected'){
    markDisconnected();
  } else if(nativeState === 'error'){
    const name = VPN.session ? VPN.session.server : (VPN.target || '');
    const raw = nativeDetailText(detail);
    const known = { vpn_permission_denied: 'err.vpnPermission', engine_unavailable: 'err.engineUnavailable' };
    failConnect(name, { key: known[detail] || 'err.connect' });
    if(raw && !known[detail]) logEvent('warn', 'log.detail', { detail: raw });
  }
};
// Statistiques de trafic (optionnel) : window.onNativeVpnStats(rxBytes, txBytes, rxBytesPerSec, txBytesPerSec)
window.onNativeVpnStats = function(rx, tx, rxSpeed, txSpeed){
  if(VPN.state !== 'on') return;
  const ok = (n) => typeof n === 'number' && isFinite(n) && n >= 0;
  if(!ok(rx) || !ok(tx)){ VPN.stats = null; VPN.statsState = 'unavailable'; clearTimeout(VPN.statsTimer); }   // null / valeurs invalides = indisponible
  else { VPN.stats = { rx: rx, tx: tx, rxSpeed: rxSpeed, txSpeed: txSpeed }; VPN.statsState = 'ready'; armStatsTimer(STATS_STALE_MS); }
  renderStats(); fitHomeScreen();
};

// Identifiant d'appareil pour l'anti-abus de l'essai gratuit (côté panel : _check_trial_abuse).
// Natif : ANDROID_ID (stable après réinstallation). Navigateur/PWA : identifiant généré une fois.
function getDeviceId(){
  if(isNativeApp() && typeof window.LaboSurfNative.getDeviceId === 'function'){
    try{ const id = window.LaboSurfNative.getDeviceId(); if(id) return id; }catch(e){}
  }
  try{
    let id = localStorage.getItem('labosurf_device_id'); // clé inchangée : ne pas réinitialiser les appareils existants
    if(!id){
      id = 'web-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
      localStorage.setItem('labosurf_device_id', id);
    }
    return id;
  }catch(e){ return ''; }
}
