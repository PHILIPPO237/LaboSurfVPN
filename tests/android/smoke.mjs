// Test de fumee sur emulateur / telephone (APK DEBUG) : pilote la WebView de l'application reelle via le protocole
// DevTools (adb forward). Verifie le comportement quand LaboVpnService.ENGINE_INTEGRATED = false :
// aucune connexion annoncee, aucun appel au backend, aucun tunnel. Necessite Node >= 22 (WebSocket integre).
//
// Usage : node tests/android/smoke.mjs <port-devtools-local>
const port = process.argv[2] || '9222';
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'OK   ' : 'ECHEC') + ' ' + name + (detail !== undefined ? ' -> ' + JSON.stringify(detail) : '')); };

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === 'page' && /android_asset\/www\/index\.html/.test(t.url));
if (!page) { console.log('ECHEC page de l\'application introuvable', targets.map((t) => t.url)); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('websocket')); });
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const ev = (expression) => new Promise((res) => {
  const i = ++id; pending.set(i, res);
  ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
}).then((d) => { if (d.result.exceptionDetails) throw new Error(JSON.stringify(d.result.exceptionDetails.exception || d.result.exceptionDetails)); return d.result.result.value; });

// 1. L'interface est chargee (assets empaquetes) et le pont natif existe
check('pont natif LaboSurfNative present', await ev('typeof window.LaboSurfNative === "object"'));
check('interface chargee (contract.js, vpn.js, api.js)', await ev('typeof ConnectContract === "object" && typeof connectVpn === "function" && typeof apiFetch === "function"'));
check('traductions chargees', await ev('typeof t === "function" && t("err.engineUnavailable") !== "err.engineUnavailable"'));

// 2. Capacites reelles du moteur : non integre
const info = JSON.parse(await ev('LaboSurfNative.getEngineInfo()'));
check('moteur : integrated=false, aucun protocole', info.integrated === false && Array.isArray(info.protocols) && info.protocols.length === 0, info);
const base = await ev('LaboSurfNative.getApiBase()');
check('adresse API compilee en HTTPS', /^https:\/\//.test(base), base);
check('version de l\'application lue du natif', (await ev('LaboSurfNative.getAppVersion()')) === '1.0.0');
check('identifiant d\'appareil fourni', (await ev('LaboSurfNative.getDeviceId().length')) > 0);

// 3. START avec un compte connecte et un serveur disponible : refus propre, AUCUN appel au backend
await ev(`(() => {
  window.__events = []; window.__fetches = 0;
  const prev = window.onNativeVpnState;
  window.onNativeVpnState = function(s, d){ window.__events.push([s, d]); return prev.apply(this, arguments); };
  const realFetch = apiFetch; apiFetch = async function(){ window.__fetches++; return realFetch.apply(this, arguments); };
  authToken = 'jeton-de-test-local'; authExpiresAt = null;
  Servers.state = 'ready';
  getSelectedServer = () => ({ id: 1, name: 'Serveur de test', available: true });
  homeReadiness = () => 'ready';
  return true;
})()`);
await ev('connectVpn()');
const st = await ev('({ state: VPN.state, session: VPN.session, fetches: window.__fetches, events: window.__events })');
check('START refuse : état « error », jamais « on »', st.state === 'error', st.state);
check('aucune session ni chronomètre', st.session === null || st.session === undefined, st.session);
check('aucun appel au backend (connect non demandé)', st.fetches === 0, st.fetches);
check('écran d accueil en état « error » (data-state), pas « on »', (await ev("document.getElementById('home').dataset.state")) === 'error');

// 4. Appel direct du pont natif : le natif refuse aussi (pas de demande de permission VPN, pas de « connected »)
await ev('window.__events.length = 0; VPN.state = "off"; LaboSurfNative.startVpn("{}"); true');
await new Promise((r) => setTimeout(r, 1500));
const native = await ev('({ events: window.__events, state: VPN.state })');
check('natif : erreur engine_unavailable rapportée', native.events.some((e) => e[0] === 'error' && e[1] === 'engine_unavailable'), native.events);
check('natif : jamais « connected »', !native.events.some((e) => e[0] === 'connected') && native.state !== 'on', native.state);

// 5. La WebView ne redirige pas vers une autre origine
check('origine locale (assets)', /^file:\/\/\/android_asset\//.test(await ev('location.href')));

ws.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies`);
process.exit(failed.length ? 1 : 0);
