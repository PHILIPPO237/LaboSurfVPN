// Test sur emulateur / telephone (APK DEBUG) : pilote la WebView de l'application reelle via le protocole DevTools (adb forward).
// Necessite Node >= 22 (WebSocket integre).
//
// Usage : node tests/android/smoke.mjs <port-devtools-local> <phase> [args]
//   base        moteur reel (UDP integre), refus des protocoles non supportes, serveur muet -> erreur, jamais « connecte »
//   connect     <hote> <port> <mot de passe> : reponse « panel » simulee -> moteur UDP natif -> attend l'etat REEL « on »
//   badauth     <hote> <port> : mot de passe refuse par le serveur -> erreur auth_failed, jamais « on »
//   disconnect  coupe le tunnel et attend l'etat « off »
//
// Le « panel » est simule UNIQUEMENT ici (reponse de POST /api/user/connect au format reel du contrat) ; le moteur natif, le
// VpnService, l'interface TUN, le handshake et la verification du chemin de donnees sont ceux de l'APK.
const [port = '9222', phase = 'base', ...args] = process.argv.slice(2);
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'OK   ' : 'ECHEC') + ' ' + name + (detail !== undefined ? ' -> ' + JSON.stringify(detail) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === 'page' && /android_asset\/www\/index\.html/.test(t.url));
if (!page) { console.log('ECHEC page de l\'application introuvable', targets.map((t) => t.url)); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('websocket')); });
ws.onclose = () => { console.log('ECHEC la page de l application s est fermee (application ou emulateur arrete)'); process.exit(1); };
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const ev = (expression) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, res);
  const timer = setTimeout(() => { pending.delete(i); rej(new Error('delai depasse : la page ne repond plus')); }, 20000);
  pending.set(i, (d) => { clearTimeout(timer); res(d); });
  ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
}).then((d) => { if (d.result.exceptionDetails) throw new Error(JSON.stringify(d.result.exceptionDetails.exception || d.result.exceptionDetails)); return d.result.result.value; });
const waitFor = async (expr, ms, step = 250) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await sleep(step); } return false; };

// Prepare l'interface : compte « connecte », serveur choisi, et un « panel » simule qui repond au format REEL du contrat.
async function prepare(uri) {
  await ev(`(() => {
    window.__events = window.__events || []; window.__fetches = 0; window.__connectBodies = [];
    if (!window.__hooked) {
      const prev = window.onNativeVpnState;
      window.onNativeVpnState = function(s, d){ window.__events.push([s, d]); return prev.apply(this, arguments); };
      window.__hooked = true;
    }
    window.__uri = ${JSON.stringify(uri)};
    window.__proto = ${JSON.stringify(uri.split(':')[0])};
    apiFetch = async function(path, opts){
      window.__fetches++;
      if (path === '/api/user/connect') {
        return { ok: true, status: 200, expired: false, data: { status: 'success', server_id: 1, service_health: 'available',
          access: { state: 'active', expires_at: '2100-01-01T00:00:00Z' },
          configs: [{ protocol: window.__proto, remark: 'test', uri: window.__uri, format: 'uri' }] } };
      }
      return { ok: false, status: 404, data: {} };
    };
    authToken = 'jeton-de-test-local'; authExpiresAt = null;
    Servers.state = 'ready';
    getSelectedServer = () => ({ id: 1, name: 'Serveur de test', available: true });
    homeReadiness = () => 'ready';
    window.__events.length = 0;
    setVpnState('off');
    return true;
  })()`);
}

if (phase === 'base') {
  check('pont natif LaboSurfNative present', await ev('typeof window.LaboSurfNative === "object"'));
  check('interface chargee (contract.js, vpn.js, api.js)', await ev('typeof ConnectContract === "object" && typeof connectVpn === "function" && typeof apiFetch === "function"'));
  check('traductions chargees', await ev('typeof t === "function" && t("err.native.auth_failed") !== "err.native.auth_failed"'));
  const info = JSON.parse(await ev('LaboSurfNative.getEngineInfo()'));
  check('moteur : UDP integre, seul protocole supporte', info.integrated === true && JSON.stringify(info.protocols) === '["udp"]', info);
  const base = await ev('LaboSurfNative.getApiBase()');
  check('adresse API compilee en HTTPS', /^https:\/\//.test(base), base);
  check('version de l\'application lue du natif', (await ev('LaboSurfNative.getAppVersion()')) === '1.1.0');   // = versionName de app/build.gradle.kts
  check('identifiant d\'appareil fourni', (await ev('LaboSurfNative.getDeviceId().length')) > 0);
  check('origine locale (assets)', /^file:\/\/\/android_asset\//.test(await ev('location.href')));

  // Protocole non supporte (tuic) : refuse, jamais « connecte », aucun tunnel
  await prepare('tuic://u:p@192.0.2.1:443?allow_insecure=1');
  await ev('connectVpn()');
  await waitFor('VPN.state === "error"', 8000);
  check('protocole tuic refuse (non integre) : etat « error »', (await ev('VPN.state')) === 'error');
  check('  ... jamais « on », aucune session', (await ev('VPN.session === null || VPN.session === undefined')) === true);

  // Configuration invalide pour le moteur UDP : refus natif
  await prepare('udp://sans-mot-de-passe@10.0.2.2:5667');
  await ev('connectVpn()');
  await waitFor('VPN.state === "error"', 10000);
  const ev1 = await ev('window.__events');
  check('lien udp invalide : erreur native invalid_config', ev1.some((e) => e[0] === 'error' && e[1] === 'invalid_config'), ev1);
  check('  ... jamais « connected »', !ev1.some((e) => e[0] === 'connected'));
}

if (phase === 'connect') {
  const [host, prt, pass] = args;
  await prepare(`udp://t-android@${host}:${prt}?pass=${pass}`);
  await ev('connectVpn()');
  const on = await waitFor('VPN.state === "on"', 45000, 500);
  const events = await ev('window.__events');
  check('CONNECTE (etat reel « on ») apres handshake + verification du chemin + TUN', on, events);
  check('  ... « connected » emis par le natif, apres « connecting »', events.findIndex((e) => e[0] === 'connected') > events.findIndex((e) => e[0] === 'connecting') && events.some((e) => e[0] === 'connected'), events);
  check('  ... une session (chronometre) existe', (await ev('!!VPN.session')) === true);
  check('  ... ecran d accueil en etat « on »', (await ev("document.getElementById('home').dataset.state")) === 'on');
  check('  ... le panel simule a ete appele une fois (POST /api/user/connect)', (await ev('window.__fetches')) === 1);
}

if (phase === 'badauth') {
  const [host, prt] = args;
  await prepare(`udp://t-android@${host}:${prt}?pass=mot-de-passe-refuse-par-le-serveur`);
  await ev('connectVpn()');
  await waitFor('VPN.state === "error"', 20000, 500);
  const events = await ev('window.__events');
  check('mot de passe refuse : erreur native auth_failed', events.some((e) => e[0] === 'error' && e[1] === 'auth_failed'), events);
  check('  ... jamais « connected », etat final « error »', !events.some((e) => e[0] === 'connected') && (await ev('VPN.state')) === 'error');
  check('  ... le message affiche est celui de l\'application (pas du serveur)', /refus/i.test(await ev('document.getElementById("home").innerText')));
}

if (phase === 'disconnect') {
  await ev('window.__events.length = 0; disconnectVpn(); true');
  const off = await waitFor('VPN.state === "off"', 15000, 500);
  const events = await ev('window.__events');
  check('deconnexion : etat « off »', off, events);
  check('  ... « stopping » puis « disconnected » emis par le natif', events.some((e) => e[0] === 'disconnected'), events);
  check('  ... plus de session', (await ev('VPN.session === null || VPN.session === undefined')) === true);
}

ws.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verifications reussies (phase ${phase})`);
process.exit(failed.length ? 1 : 0);
