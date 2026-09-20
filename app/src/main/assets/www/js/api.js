// Accès à l'API du panel LABORATOIRE DU FREE-SURF.
// La logique d'authentification est inchangée : jeton Bearer gardé uniquement en mémoire
// (jamais dans localStorage), perdu à la déconnexion ou à la fermeture de l'app.

// ADRESSE DU PANEL — à changer selon la situation :
// - Test EN LOCAL sur le téléphone (Termux + app sur le même appareil) : 127.0.0.1 (valeur actuelle).
// - Avec un VRAI VPS/domaine : remplacer par le domaine réel, ex. 'https://laboratoire.free-surf237-4all.xyz'.
const FREE_SURF_API_BASE = 'http://127.0.0.1:8000';

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

async function apiFetch(path, options){
  options = options || {};
  const headers = Object.assign({}, options.headers || {});
  if(authToken) headers['Authorization'] = 'Bearer ' + authToken;
  if(options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';   // FormData : le navigateur fixe lui-même le type (multipart + boundary)
  headers['Accept-Language'] = I18N.lang; // permet au panel de répondre dans la langue de l'app s'il le supporte (ignoré sinon)

  // Délai maximum : sans lui, un panel qui ne répond pas laisserait l'interface en attente indéfiniment.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), options.timeout || API_TIMEOUT_MS);
  try{
    const res = await fetch(`${FREE_SURF_API_BASE}${path}`, Object.assign({}, options, { headers, signal: ctrl.signal }));
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
