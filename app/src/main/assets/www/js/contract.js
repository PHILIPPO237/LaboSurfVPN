// Contrat avec le Laboratoire du Free-Surf : fonctions PURES (aucun accès au DOM, au réseau ni au natif),
// donc testables telles quelles (voir tests/js). Trois sujets :
//   1. ApiBase        — adresse de l'API : configurable, HTTPS obligatoire (sauf boucle locale de développement) ;
//   2. ConnectContract — lecture stricte de la réponse de POST /api/user/connect ;
//   3. ProfileOptions  — lecture stricte de GET /api/user/connect/options (profils au choix) et corps de connexion.
//
// Rien n'est inventé ici : une réponse qui ne respecte pas le contrat est un ÉCHEC (jamais une configuration
// reconstruite côté Android). Le contenu de la configuration (uri) ne sort jamais de ce module dans un message.
'use strict';

// ─── 1. Adresse de l'API ───
const ApiBase = (function(){
  // Boucle locale : tolérée en http:// pour le développement (Android la bloque de toute façon hors version debug,
  // voir res/xml/network_security_config.xml). Toute autre adresse DOIT être en https://.
  const LOOPBACK = /^(localhost|127\.0\.0\.1|10\.0\.2\.2|\[::1\])$/i;

  // Valide une adresse : { ok, base } (origine seule, sans chemin ni barre finale) ou { ok:false, reason }.
  function normalize(raw){
    const text = String(raw === undefined || raw === null ? '' : raw).trim();
    if(!text) return { ok: false, reason: 'missing' };
    let u;
    try{ u = new URL(text); }catch(e){ return { ok: false, reason: 'invalid' }; }
    if(u.username || u.password) return { ok: false, reason: 'invalid' };           // jamais d'identifiants dans l'adresse
    if(u.protocol === 'https:') return { ok: true, base: u.origin };
    if(u.protocol === 'http:' && LOOPBACK.test(u.hostname)) return { ok: true, base: u.origin, insecureLocal: true };
    return { ok: false, reason: u.protocol === 'http:' ? 'insecure' : 'invalid' };  // aucun repli HTTP
  }

  // Ordre de priorité : natif (BuildConfig de l'APK) > ?api= (navigateur de développement) > réglage mémorisé (navigateur).
  // Dans l'application Android, seule la valeur du natif compte : une adresse ne peut pas être imposée depuis le contenu.
  function resolve(env){
    env = env || {};
    if(env.native) return Object.assign({ source: 'native' }, normalize(env.native));
    if(env.nativeApp) return { ok: false, reason: 'missing', source: 'native' };
    if(env.query) return Object.assign({ source: 'query' }, normalize(env.query));
    if(env.stored) return Object.assign({ source: 'stored' }, normalize(env.stored));
    return { ok: false, reason: 'missing', source: 'none' };
  }

  return { normalize: normalize, resolve: resolve };
})();

// ─── 2. POST /api/user/connect ───
const ConnectContract = (function(){
  // Codes d'erreur STABLES du panel (app/core/pro/connect.py) -> clé de traduction de l'application.
  const ERROR_CODES = {
    user_not_authenticated:    'conn.err.user_not_authenticated',
    subscription_expired:      'conn.err.subscription_expired',
    account_disabled:          'conn.err.account_disabled',
    no_service_available:      'conn.err.no_service_available',
    service_not_found:         'conn.err.service_not_found',
    service_unhealthy:         'conn.err.service_unhealthy',
    access_not_found:          'conn.err.access_not_found',
    access_disabled:           'conn.err.access_disabled',
    access_expired:            'conn.err.access_expired',
    pro_unavailable:           'conn.err.pro_unavailable',
    pro_authentication_failed: 'conn.err.pro_authentication_failed',
    pro_timeout:               'conn.err.pro_timeout',
    incompatible_version:      'conn.err.incompatible_version',
    configuration_unavailable: 'conn.err.configuration_unavailable',
    // profil choisi par l'utilisateur (hosted_profile_id)
    profile_not_found:         'conn.err.profile_not_found',
    profile_unavailable:       'conn.err.profile_unavailable',
  };
  // Erreurs après lesquelles réessayer n'a pas de sens sans action de l'utilisateur
  const NEEDS_USER_ACTION = ['user_not_authenticated', 'subscription_expired', 'account_disabled', 'access_disabled', 'access_expired'];
  // service_health accepté : « available », ou « unknown » (non vérifié — jamais présenté comme sain)
  const HEALTH_OK = ['available', 'unknown'];
  const URI_SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i;

  const fail = (fields) => Object.assign({ ok: false, code: '', key: 'conn.err.badResponse', retryAfter: null, panelMessage: '', authLost: false }, fields);

  function retryAfterOf(data){
    const n = data && typeof data.retry_after_s === 'number' && isFinite(data.retry_after_s) ? Math.round(data.retry_after_s) : null;
    return n !== null && n > 0 && n <= 3600 ? n : null;
  }

  // res : { ok, status, data, expired } tel que renvoyé par apiFetch (api.js).
  function parse(res){
    if(!res) return fail({ key: 'err.panel', kind: 'network' });
    const data = res.data && typeof res.data === 'object' ? res.data : null;

    if(res.expired || res.status === 401) return fail({ kind: 'auth', code: 'user_not_authenticated', key: ERROR_CODES.user_not_authenticated, authLost: true });

    // Refus explicite du panel : {status:'error', code, message, retry_after_s?}
    if(data && data.status === 'error'){
      const code = typeof data.code === 'string' ? data.code : '';
      const known = Object.prototype.hasOwnProperty.call(ERROR_CODES, code);
      return fail({
        kind: 'refused', code: code, key: known ? ERROR_CODES[code] : 'conn.err.unknown',
        retryAfter: NEEDS_USER_ACTION.indexOf(code) >= 0 ? null : retryAfterOf(data),
        panelMessage: known ? '' : (typeof data.message === 'string' ? data.message : ''),   // texte du panel seulement pour un code inconnu
        authLost: code === 'user_not_authenticated',
      });
    }

    // Succès : contrat strict. Tout écart = échec, jamais une configuration « réparée » ou inventée.
    if(!res.ok || !data || data.status !== 'success') return fail({ kind: 'contract', code: 'bad_response' });
    const list = data.configs;
    const cfg = Array.isArray(list) && list.length ? list[0] : null;
    if(!cfg || typeof cfg !== 'object') return fail({ kind: 'contract', code: 'no_config' });
    const uri = typeof cfg.uri === 'string' ? cfg.uri.trim() : '';
    const protocol = typeof cfg.protocol === 'string' ? cfg.protocol.trim().toLowerCase() : '';
    if(!uri || !protocol) return fail({ kind: 'contract', code: 'empty_config' });
    const scheme = URI_SCHEME.exec(uri);
    if(!scheme) return fail({ kind: 'contract', code: 'bad_uri' });

    const health = typeof data.service_health === 'string' && data.service_health ? data.service_health.toLowerCase() : 'unknown';
    if(HEALTH_OK.indexOf(health) < 0) return fail({ kind: 'contract', code: 'service_unhealthy', key: ERROR_CODES.service_unhealthy });

    const acc = data.access && typeof data.access === 'object' ? data.access : {};
    const accState = typeof acc.state === 'string' ? acc.state.toLowerCase() : '';
    if(accState === 'expired') return fail({ kind: 'contract', code: 'access_expired', key: ERROR_CODES.access_expired });
    if(accState === 'disabled') return fail({ kind: 'contract', code: 'access_disabled', key: ERROR_CODES.access_disabled });
    const expMs = typeof acc.expires_at === 'string' && acc.expires_at ? Date.parse(acc.expires_at) : NaN;

    const num = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : null);
    return {
      ok: true,
      serverId: data.server_id === undefined ? null : data.server_id,
      // profil réellement utilisé par le panel (0 = choix du panel sur ce serveur ; absent = panel plus ancien)
      hostedProfileId: typeof data.hosted_profile_id === 'number' && isFinite(data.hosted_profile_id) ? data.hosted_profile_id : null,
      health: health,                                   // available | unknown
      access: { state: accState || 'active', expiresAt: isFinite(expMs) ? expMs : null },   // null = pas d'expiration technique
      config: { uri: uri, protocol: protocol, scheme: scheme[1].toLowerCase(), format: typeof cfg.format === 'string' ? cfg.format : '', remark: typeof cfg.remark === 'string' ? cfg.remark : '' },
      trialLimitMinutes: num(data.trial_limit_minutes),
      trialQuotaMb: num(data.trial_quota_mb),
    };
  }

  // Échec avant toute réponse (réseau coupé, délai dépassé, TLS refusé…) — `online` = navigator.onLine
  function networkFailure(err, online){
    if(err && err.name === 'AbortError') return fail({ kind: 'network', code: 'timeout', key: 'err.timeout' });
    if(online === false) return fail({ kind: 'network', code: 'offline', key: 'err.offline' });
    return fail({ kind: 'network', code: 'unreachable', key: 'err.panel' });
  }

  return { parse: parse, networkFailure: networkFailure, ERROR_CODES: ERROR_CODES, HEALTH_OK: HEALTH_OK };
})();

// ─── 3. GET /api/user/connect/options ───
// Profils que l'utilisateur peut choisir (le panel n'y met que ceux réellement disponibles pour lui).
// Réponse : {status:'ok', options:[{hosted_profile_id, profile_name, server_id, server_name, country, city, service_health}]}.
// Ni moteur ni protocole : le panel ne les fournit pas, l'application ne les devine pas.
const ProfileOptions = (function(){
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const posInt = (v) => (typeof v === 'number' && isFinite(v) && v > 0 && Math.floor(v) === v ? v : null);

  // res : { ok, status, data, expired } (apiFetch). Résultat :
  //   { state:'ready', options:[…] } | { state:'unsupported' } (panel sans cette route : 404/405)
  //   | { state:'error', authLost?, code? }
  function parse(res){
    if(!res) return { state: 'error' };
    if(res.expired || res.status === 401) return { state: 'error', authLost: true };
    if(res.status === 404 || res.status === 405) return { state: 'unsupported' };
    const data = res.data && typeof res.data === 'object' ? res.data : null;
    if(data && data.status === 'error') return { state: 'error', code: typeof data.code === 'string' ? data.code : '' };
    if(!res.ok || !data || data.status !== 'ok' || !Array.isArray(data.options)) return { state: 'error', code: 'bad_response' };
    const seen = new Set();
    const options = [];
    for(const o of data.options){
      if(!o || typeof o !== 'object') continue;
      const id = posInt(o.hosted_profile_id);
      if(id === null || seen.has(id)) continue;   // sans identifiant valide, un profil ne peut pas être demandé : ignoré
      seen.add(id);
      const health = str(o.service_health).toLowerCase();
      options.push({
        id: id,
        name: str(o.profile_name),
        serverId: posInt(o.server_id),
        serverName: str(o.server_name),
        country: str(o.country),
        city: str(o.city),
        health: health === 'available' ? 'available' : 'unknown',   // le panel n'envoie que available | unknown
      });
    }
    return { state: 'ready', options: options };
  }

  // Corps de POST /api/user/connect pour un profil choisi (champ et format EXACTS du panel : entier)
  function connectBody(option, deviceId){
    const body = { hosted_profile_id: option.id };
    if(option.serverId !== null) body.server_id = option.serverId;
    if(deviceId) body.device_id = deviceId;
    return body;
  }

  return { parse: parse, connectBody: connectBody };
})();

// Chargé aussi par les tests Node (CommonJS) ; sans effet dans le navigateur
if(typeof module !== 'undefined' && module.exports) module.exports = { ApiBase: ApiBase, ConnectContract: ConnectContract, ProfileOptions: ProfileOptions };
