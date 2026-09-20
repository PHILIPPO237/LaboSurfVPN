// Banc d'essai : charge le VRAI code de l'interface (js/*.js, tels que livrés dans l'APK) dans un contexte Node
// (module « vm ») avec un DOM factice minimal. Aucun mock de la logique testée : seuls le DOM, le réseau
// (apiFetch), les minuteries et le pont natif (LaboSurfNative) sont simulés — c'est ce qu'on veut piloter.
//
// Usage : const app = loadApp({ native: {...} | null, api: 'https://…' });
//   app.ev('VPN.state')            évalue une expression dans le contexte de l'application
//   app.calls.apiFetch / .toasts / .native.startVpn …   ce qui s'est réellement passé
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WWW = process.env.LSVPN_WWW || path.join(__dirname, '..', '..', 'app', 'src', 'main', 'assets', 'www');   // LSVPN_WWW : variante mutée (contrôle de la sensibilité des tests)

function makeEl(id){
  const attrs = {};
  const target = {
    id: id, dataset: {}, style: { setProperty(){}, getPropertyValue(){ return ''; } },
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    children: [], hidden: false, textContent: '', value: '', innerHTML: '', className: '', disabled: false,
    addEventListener(){}, removeEventListener(){}, appendChild(){}, remove(){}, focus(){}, click(){}, insertBefore(){}, scrollIntoView(){},
    setAttribute(k, v){ attrs[k] = String(v); }, getAttribute(k){ return k in attrs ? attrs[k] : null; }, removeAttribute(k){ delete attrs[k]; },
    querySelector(){ return makeEl('q'); }, querySelectorAll(){ return []; }, closest(){ return null; },
    getBoundingClientRect(){ return { top: 0, bottom: 0, left: 0, right: 0, height: 0, width: 0 }; },
  };
  const related = ['parentNode', 'parentElement', 'firstElementChild', 'lastElementChild', 'nextElementSibling'];
  return new Proxy(target, { get(t, p){ if(p in t) return t[p]; if(related.indexOf(p) >= 0) return makeEl('rel'); return undefined; } });
}

function loadApp(opts){
  opts = opts || {};
  const els = {};
  const calls = { apiFetch: [], toasts: [], native: { startVpn: [], stopVpn: [] }, sessionExpired: 0, logs: [] };
  const timers = [];
  let timerSeq = 1;
  const storage = new Map();
  const sandbox = {
    console,
    URL, URLSearchParams, AbortController, Promise, JSON, Math, Date, Intl, Object, Array, String, Number, RegExp, Error, Map, Set, Symbol,
    isFinite, parseFloat, parseInt, encodeURIComponent, decodeURIComponent,
    FormData: class FormData {},
    CustomEvent: class CustomEvent { constructor(name, init){ this.type = name; this.detail = init && init.detail; } },
    Event: class Event { constructor(name){ this.type = name; } },
    location: { search: opts.search || '' },
    navigator: { onLine: opts.online !== false, languages: ['fr-FR'], language: 'fr-FR' },
    localStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    sessionStorage: { getItem: () => null, setItem(){}, removeItem(){} },
    innerHeight: 800,
    getComputedStyle: () => ({ getPropertyValue: () => '', paddingTop: '0', paddingBottom: '0', rowGap: '0' }),
    requestAnimationFrame: (fn) => fn(),
    setTimeout: (fn, ms) => { const id = timerSeq++; timers.push({ id, fn, ms, repeat: false }); return id; },
    setInterval: (fn, ms) => { const id = timerSeq++; timers.push({ id, fn, ms, repeat: true }); return id; },
    clearTimeout: (id) => { const i = timers.findIndex((x) => x.id === id); if(i >= 0) timers.splice(i, 1); },
    clearInterval: (id) => { const i = timers.findIndex((x) => x.id === id); if(i >= 0) timers.splice(i, 1); },
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.matchMedia = () => ({ matches: false, addEventListener(){} });
  sandbox.document = {
    getElementById: (id) => els[id] || (els[id] = makeEl(id)),
    querySelector: () => makeEl('q'), querySelectorAll: () => [],
    addEventListener(){}, dispatchEvent(){}, createElement: () => makeEl('new'),
    documentElement: makeEl('html'), body: makeEl('body'), activeElement: null, hidden: false,
  };

  // Pont natif simulé : c'est le CONTRAT que l'interface attend de Kotlin (MainActivity.NativeBridge)
  if(opts.native){
    const n = opts.native;
    sandbox.LaboSurfNative = {
      getEngineInfo: n.engine === undefined ? undefined : () => JSON.stringify(n.engine),
      getApiBase: () => n.apiBase || '',
      getDeviceId: () => n.deviceId || 'device-test',
      startVpn: (cfg) => { calls.native.startVpn.push(cfg); },
      stopVpn: () => { calls.native.stopVpn.push(true); },
      getAppVersion: () => '1.0.0-test', openVpnSettings(){}, setSystemBars(){}, clearWebCache(){},
    };
    if(n.engine === undefined) delete sandbox.LaboSurfNative.getEngineInfo;
  }
  vm.createContext(sandbox);

  const run = (file) => vm.runInContext(fs.readFileSync(path.join(WWW, file), 'utf8'), sandbox, { filename: file });
  const ev = (code) => vm.runInContext(code, sandbox);

  // Modules réels, dans l'ordre d'index.html
  ['js/i18n.js', 'js/lang/fr.js', 'js/lang/en.js', 'js/core.js', 'js/contract.js'].forEach(run);
  // Éléments d'interface que l'application suppose présents au chargement
  ev("I18N.set('fr', false)");
  // Dépendances d'autres écrans, réduites à ce que le code testé appelle
  ev(`
    var currentScreen = 'home'; var Reseller = { reset(){} }; var Theme = { get(){ return 'dark'; }, resolved(){ return 'dark'; }, set(){} };
    function loadHomeBanner(){} function showScreen(){} function setAccView(){} function fitBannerDefault(){}
    function renderHome_stub(){} function updateAccountBadge(){} function renderLogs(){}
  `);
  ['js/api.js', 'js/servers.js', 'js/services.js', 'js/vpn.js', 'js/account.js', 'js/activity.js'].forEach(run);

  // Observation : tout ce qui sort de l'application
  ev('function toast(m, type){ __calls.toasts.push({ m, type }); }');
  sandbox.__calls = calls;
  sandbox.__realApiFetch = sandbox.apiFetch;
  sandbox.apiFetch = async (p, o) => {
    calls.apiFetch.push({ path: p, options: o });
    if(typeof opts.respond === 'function') return opts.respond(p, o);
    throw new Error('aucune réponse prévue pour ' + p);
  };
  const origHandle = sandbox.handleSessionExpired;
  sandbox.handleSessionExpired = function(){ calls.sessionExpired++; return origHandle.apply(this, arguments); };

  return {
    ev, calls, ctx: sandbox, timers,
    // exécute (une fois) les minuteries dont le délai est celui donné (ex. watchdog 60000)
    fire(ms){ timers.filter((x) => x.ms === ms).forEach((x) => { if(!x.repeat) timers.splice(timers.indexOf(x), 1); x.fn(); }); },
    // signe l'utilisateur et prépare une liste de serveurs réelle (comme après loadServers)
    signIn(servers){
      ev(`authToken = 'token-de-test'; authExpiresAt = null;`);
      ev(`Servers.state = 'ready'; Servers.list = ${JSON.stringify(servers || [{ id: 7, name: 'Serveur test', country: 'CM', city: 'Douala', status: 'online' }])}.map(normalizeServer); Servers.selectedId = Servers.list[0].id;`);
    },
    native: sandbox.LaboSurfNative,
    state(){ return ev('VPN.state'); },
  };
}

module.exports = { loadApp, WWW };
