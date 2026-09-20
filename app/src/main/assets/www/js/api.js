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

const API_TIMEOUT_MS = 15000;
let authToken = null;
let authExpiresAt = null;   // instant d'expiration de la session (ms), d'après « expires_in » du panel ; null = inconnu

async function apiFetch(path, options){
  options = options || {};
  // Adresse absente ou non sécurisée : aucune requête n'est envoyée (jamais de repli vers une autre adresse ni vers HTTP)
  if(!API.state.ok) return { ok: false, status: 0, data: null, expired: false, configError: true };
  const headers = Object.assign({}, options.headers || {});
  if(authToken) headers['Authorization'] = 'Bearer ' + authToken;
  if(options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';   // FormData : le navigateur fixe lui-même le type (multipart + boundary)
  headers['Accept-Language'] = I18N.lang; // permet au panel de répondre dans la langue de l'app s'il le supporte (ignoré sinon)

  // Délai maximum : sans lui, un panel qui ne répond pas laisserait l'interface en attente indéfiniment.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), options.timeout || API_TIMEOUT_MS);
  try{
    // cache: no-store, credentials: omit : jamais de configuration ni de cookie conservés par le navigateur
    const res = await fetch(`${FREE_SURF_API_BASE}${path}`, Object.assign({ cache: 'no-store', credentials: 'omit' }, options, { headers, signal: ctrl.signal }));
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
