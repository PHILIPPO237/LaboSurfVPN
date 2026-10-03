// Accès à l'API du panel LABORATOIRE DU FREE-SURF.
// La logique d'authentification est inchangée : jeton Bearer gardé uniquement en mémoire
// (jamais dans localStorage), perdu à la déconnexion ou à la fermeture de l'app.

// ADRESSE DU PANEL — configurable, jamais figée dans le code (voir js/contract.js, ApiBase) :
// - application Android : fournie par l'APK (LaboSurfNative.getApiBase(), BuildConfig.PANEL_BASE_URL, réglée à la
//   compilation : gradle -PlabosurfPanelBaseUrl=https://… ; la valeur par défaut est dans app/build.gradle.kts) ;
// - navigateur de développement : ?api=https://… (ou http://127.0.0.1:8000 pour un panel local), mémorisable
//   dans localStorage 'ls.apiBase'.
// HTTPS est OBLIGATOIRE (seule la boucle locale est tolérée en http://) et il n'existe AUCUN repli en clair.
let FREE_SURF_API_BASE = '';
const API = { state: { ok: false, reason: 'missing', source: 'none' } };
function configureApiBase(){
  let native = '';
  try{ if(isNativeApp() && typeof window.LaboSurfNative.getApiBase === 'function') native = window.LaboSurfNative.getApiBase() || ''; }catch(e){}
  let query = '';
  try{ query = new URLSearchParams(location.search).get('api') || ''; }catch(e){}
  const native_app = isNativeApp();
  API.state = ApiBase.resolve({ nativeApp: native_app, native: native, query: native_app ? '' : query, stored: native_app ? '' : store.get('apiBase', '') });
  FREE_SURF_API_BASE = API.state.ok ? API.state.base : '';
  if(API.state.ok && API.state.source === 'query') store.set('apiBase', FREE_SURF_API_BASE);
}
configureApiBase();

// Pages légales : AUCUNE URL n'est inventée ici. Quand le backend les fournit, appeler
//   setLegalUrls({ terms: 'https://…', privacy: { fr: 'https://…', en: 'https://…' } })
// (chaîne, ou objet par langue). Tant qu'une URL est absente, la ligne affiche « Bientôt disponible / Coming soon ».
const LEGAL_URLS = { terms: '', privacy: '' };
function legalUrl(kind){
  const v = LEGAL_URLS[kind];
  const url = (v && typeof v === 'object') ? (v[I18N.lang] || v[I18N.lang === 'fr' ? 'en' : 'fr']) : v;
  return (typeof url === 'string' && /^https?:\/\//i.test(url)) ? url : ''; // http(s) uniquement
}
function setLegalUrls(urls){
  Object.assign(LEGAL_URLS, urls || {});
  if(typeof renderLegalRows === 'function') renderLegalRows();
}

// Identifiant d'INSTALLATION (sessions du compte, « Mes appareils » du panel). Distinct de getDeviceId() (vpn.js,
// ANDROID_ID réservé à l'anti-abus de l'essai gratuit) : aléatoire, propre à cette installation, jamais dérivé du
// matériel ni affiché. Natif : préférences privées de l'app (LaboSurfNative.getInstallId). Navigateur : localStorage.
function getInstallId(){
  if(isNativeApp() && typeof window.LaboSurfNative.getInstallId === 'function'){
    try{ const id = window.LaboSurfNative.getInstallId(); if(id) return id; }catch(e){}
  }
  try{
    let id = localStorage.getItem('labosurf_install_id');
    if(!id){
      const bytes = new Uint8Array(16);
      if(window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
      else for(let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
      id = 'ins-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('labosurf_install_id', id);
    }
    return id;
  }catch(e){ return ''; }
}
function getDeviceLabel(){
  if(isNativeApp() && typeof window.LaboSurfNative.getDeviceLabel === 'function'){
    try{ const l = window.LaboSurfNative.getDeviceLabel(); if(l) return 'Labo Surf VPN - ' + l; }catch(e){}
  }
  return 'Labo Surf VPN';
}
// En-têtes d'appareil : envoyés SEULEMENT à l'ouverture d'une session (connexion, inscription — option device: true)
function deviceHeaders(){
  const h = {}, id = getInstallId();
  if(id) h['X-Device-Id'] = id;
  h['X-Device-Name'] = getDeviceLabel().replace(/[^\x20-\x7E]/g, '').slice(0, 80) || 'Labo Surf VPN';   // en-tête HTTP : ASCII seulement
  return h;
}

// ─── Reprise réseau après l'arrêt du tunnel ───
// Constat terrain (v1.2.1) : après un STOP, la WebView garde un état réseau hérité du VPN et chaque requête échoue AVANT
// d'atteindre le panel (aucune trace côté serveur), jusqu'au redémarrage du processus. Reprise graduée :
//   1. réinitialisation du réseau de la WebView (pont natif resetNetwork), faite dès l'arrêt du tunnel (vpn.js) ;
//   2. si une requête échoue quand même : UNE nouvelle tentative après réinitialisation ;
//   3. si elle échoue encore ET que le tunnel vient d'être arrêté : redémarrage de l'application, UNE fois par arrêt
//      de tunnel (décidé côté natif : NetworkRecovery). La session est en mémoire seulement : reconnexion au compte.
// Hors de l'application Android (navigateur), rien de tout cela n'existe : l'erreur est rendue telle quelle.
const NET_RETRY_DELAY_MS = 700;
const NET_RESTART_DELAY_MS = 2000;
const NET_RETRY_POST_PATHS = ['/api/auth/login', '/api/user/connect'];   // seuls POST relancés : ils n'ont pas atteint le serveur et sont idempotents

function nativeNet(name){
  try{
    if(isNativeApp() && typeof window.LaboSurfNative[name] === 'function') return window.LaboSurfNative[name].bind(window.LaboSurfNative);
  }catch(e){}
  return null;
}
// Réinitialise le réseau de la WebView ; false si l'application native ne le propose pas.
function resetNativeNetwork(){
  const reset = nativeNet('resetNetwork');
  if(!reset) return false;
  try{ reset(); return true; }catch(e){ return false; }
}
function netCanRetry(path, method){
  const m = String(method || 'GET').toUpperCase();
  return m === 'GET' || (m === 'POST' && NET_RETRY_POST_PATHS.indexOf(path) >= 0);
}
// Dernier recours : le natif décide s'il faut redémarrer l'application (arrêt de tunnel récent, pas déjà fait pour cet arrêt).
function offerAppRestart(){
  const needs = nativeNet('needsAppRestart'), restart = nativeNet('restartApp');
  if(!needs || !restart) return;
  let must = false;
  try{ must = needs() === true; }catch(e){}
  if(!must) return;
  if(typeof toast === 'function') toast(t('net.restarting'), 'warning', NET_RESTART_DELAY_MS);
  setTimeout(() => { try{ restart(); }catch(e){} }, NET_RESTART_DELAY_MS);
}
async function fetchWithNetworkRecovery(url, init, path){
  try{
    return await fetch(url, init);
  }catch(err){
    // Délai dépassé (AbortError) : le panel est peut-être lent ou arrêté, pas de relance. Requête non relançable : idem.
    if(!err || err.name === 'AbortError' || !netCanRetry(path, init.method)) throw err;
    if(!resetNativeNetwork()) throw err;
    await new Promise((resolve) => setTimeout(resolve, NET_RETRY_DELAY_MS));
    try{
      const res = await fetch(url, init);
      if(typeof logEvent === 'function') logEvent('info', 'log.networkRecovered');
      return res;
    }catch(err2){
      offerAppRestart();
      throw err2;
    }
  }
}

const API_TIMEOUT_MS = 15000;
let authToken = null;
let authExpiresAt = null;   // instant d'expiration de la session (ms), d'après « expires_in » du panel ; null = inconnu

async function apiFetch(path, options){
  options = options || {};
  // Adresse absente ou non sécurisée : aucune requête n'est envoyée (jamais de repli vers une autre adresse ni vers HTTP)
  if(!API.state.ok) return { ok: false, status: 0, data: null, expired: false, configError: true };
  const headers = Object.assign({}, options.device ? deviceHeaders() : {}, options.headers || {});
  if(authToken) headers['Authorization'] = 'Bearer ' + authToken;
  if(options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';   // FormData : le navigateur fixe lui-même le type (multipart + boundary)
  headers['Accept-Language'] = I18N.lang; // permet au panel de répondre dans la langue de l'app s'il le supporte (ignoré sinon)

  // Délai maximum : sans lui, un panel qui ne répond pas laisserait l'interface en attente indéfiniment.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), options.timeout || API_TIMEOUT_MS);
  try{
    // cache: no-store, credentials: omit : jamais de configuration ni de cookie conservés par le navigateur
    const res = await fetchWithNetworkRecovery(`${FREE_SURF_API_BASE}${path}`, Object.assign({ cache: 'no-store', credentials: 'omit' }, options, { headers, signal: ctrl.signal }), path);
    let data = null;
    try{ data = await res.json(); }catch(e){ data = null; }
    // Jeton refusé alors qu'on se croyait connecté -> session expirée (voir account.js)
    let expired = false;
    if(res.status === 401 && authToken){ expired = true; handleSessionExpired(); }
    return { ok: res.ok, status: res.status, data, expired };
  } finally {
    clearTimeout(timer);
  }
}

// Message d'erreur à afficher : celui du panel s'il en fournit un, sinon un texte traduit
function apiMessage(res, fallbackKey){
  if(res && res.expired) return t('err.sessionExpired');
  return localizedField(res && res.data, 'message') || t(fallbackKey);
}
