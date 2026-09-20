'use strict';
// Le VRAI code de l'interface (vpn.js, api.js, account.js, servers.js…) piloté avec un pont natif et un panel simulés.
// Ce qui est vérifié : « connecté » et le chronomètre n'existent que sur la réponse du natif ; aucune configuration
// n'est fabriquée ; le backend n'est jamais sollicité quand il ne peut pas aboutir.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

const URI = 'tuic://11111111-2222-4333-8444-555555555555:mot-de-passe-de-test@203.0.113.10:443?alpn=h3&allow_insecure=1#LABOSURF';
const okResponse = (over) => ({ ok: true, status: 200, expired: false, data: Object.assign({
  status: 'success', server_id: 7, service_health: 'available', access: { state: 'active', expires_at: '2100-01-01T00:00:00Z' },
  configs: [{ protocol: 'tuic', remark: 'VIP - tuic', uri: URI, format: 'uri' }] }, over || {}) });
const errResponse = (status, code, extra) => ({ ok: false, status, expired: false, data: Object.assign({ status: 'error', code, message: 'interne' }, extra || {}) });

const NATIVE_READY = { engine: { integrated: true, protocols: ['tuic'] }, apiBase: 'https://panel.example.tld' };
const NATIVE_NO_ENGINE = { engine: { integrated: false, protocols: [] }, apiBase: 'https://panel.example.tld' };

function app(native, respond, extra){
  const a = loadApp(Object.assign({ native, respond }, extra || {}));
  a.signIn();
  return a;
}
const connect = (a) => a.ev('connectVpn()');

test('adresse : dans le natif, celle de l\'APK ; jamais 127.0.0.1 par défaut', () => {
  const a = loadApp({ native: NATIVE_READY });
  assert.equal(a.ev('API.state.ok'), true);
  assert.equal(a.ev('FREE_SURF_API_BASE'), 'https://panel.example.tld');
  const web = loadApp({});
  assert.equal(web.ev('API.state.ok'), false, 'navigateur sans ?api= : aucune adresse par défaut');
  const dev = loadApp({ search: '?api=http://127.0.0.1:8000' });
  assert.equal(dev.ev('FREE_SURF_API_BASE'), 'http://127.0.0.1:8000');
  const insecure = loadApp({ native: { engine: { integrated: true, protocols: [] }, apiBase: 'http://panel.example.tld' } });
  assert.equal(insecure.ev('API.state.ok'), false);
  assert.equal(insecure.ev('API.state.reason'), 'insecure');
});

test('apiFetch réel : aucune requête sans adresse valide (pas de repli)', async () => {
  const a = loadApp({ native: { engine: { integrated: true, protocols: [] }, apiBase: '' } });
  let fetched = 0;
  a.ctx.fetch = async () => { fetched++; return {}; };
  const res = await a.ctx.__realApiFetch('/api/user/me');
  assert.equal(fetched, 0);
  assert.equal(res.ok, false);
  assert.equal(res.configError, true);
});

test('apiFetch réel : HTTPS, jeton en-tête, aucun cookie, aucun cache', async () => {
  const a = loadApp({ native: NATIVE_READY });
  a.ev("authToken = 'jeton-de-test'");
  const seen = [];
  a.ctx.fetch = async (url, options) => { seen.push({ url, options }); return { ok: true, status: 200, json: async () => ({ status: 'ok' }) }; };
  const res = await a.ctx.__realApiFetch('/api/user/connect', { method: 'POST', body: '{}' });
  assert.equal(res.ok, true);
  assert.equal(seen[0].url, 'https://panel.example.tld/api/user/connect');
  assert.equal(seen[0].options.credentials, 'omit');
  assert.equal(seen[0].options.cache, 'no-store');
  assert.equal(seen[0].options.headers.Authorization, 'Bearer jeton-de-test');
  assert.equal(seen[0].options.headers['Content-Type'], 'application/json');
  assert.ok(seen.every((x) => x.url.startsWith('https://')));
});

test('moteur natif absent : AUCUN appel au backend, erreur claire, jamais « connecté »', async () => {
  const a = app(NATIVE_NO_ENGINE, () => { throw new Error('le backend ne doit pas être appelé'); });
  await connect(a);
  assert.equal(a.calls.apiFetch.length, 0, 'aucun /api/user/connect (il créerait un Access et consommerait l\'essai)');
  assert.equal(a.state(), 'error');
  assert.equal(a.ev('VPN.errorSpec.key'), 'err.engineUnavailable');
  assert.equal(a.calls.native.startVpn.length, 0);
  assert.equal(a.ev('VPN.session'), null);
  assert.equal(a.ev('VPN.clock'), null, 'aucun chronomètre');
});

test('ancien shell natif sans getEngineInfo : traité comme « pas de moteur »', async () => {
  const a = app({ apiBase: 'https://panel.example.tld' }, () => { throw new Error('non'); });
  await connect(a);
  assert.equal(a.calls.apiFetch.length, 0);
  assert.equal(a.ev('VPN.errorSpec.key'), 'err.engineUnavailable');
});

test('connexion réelle : POST /api/user/connect, config exacte passée au natif, « connecté » seulement sur réponse du natif', async () => {
  const a = app(NATIVE_READY, () => okResponse());
  await connect(a);
  // 1. le bon appel
  assert.equal(a.calls.apiFetch.length, 1);
  const call = a.calls.apiFetch[0];
  assert.equal(call.path, '/api/user/connect');
  assert.equal(call.options.method, 'POST');
  assert.deepEqual(JSON.parse(call.options.body), { server_id: 7, device_id: 'device-test' });
  // 2. le natif reçoit EXACTEMENT la configuration du panel
  assert.equal(a.calls.native.startVpn.length, 1);
  const sent = JSON.parse(a.calls.native.startVpn[0]);
  assert.equal(sent.uri, URI);
  assert.equal(sent.proto, 'tuic');
  assert.equal(sent.format, 'uri');
  // 3. tant que le natif n'a pas répondu : CONNECTING, pas de session, pas de chronomètre
  assert.equal(a.state(), 'connecting');
  assert.equal(a.ev('VPN.session'), null);
  assert.equal(a.ev('VPN.clock'), null);
  assert.equal(a.ev("document.getElementById('connMeta').hidden"), true);
  assert.equal(a.ev('VPN.health'), 'available');
  assert.equal(a.ev('VPN.accessExpiresAt'), Date.parse('2100-01-01T00:00:00Z'));
  // 4. réponse du natif -> CONNECTED, session, chronomètre
  a.ctx.onNativeVpnState('connected', '');
  assert.equal(a.state(), 'on');
  assert.notEqual(a.ev('VPN.session'), null);
  assert.notEqual(a.ev('VPN.clock'), null);
  assert.equal(a.ev("document.getElementById('connMeta').hidden"), false);
  // 5. arrêt réel -> chronomètre arrêté, session enregistrée dans l'historique local
  a.ev('disconnectVpn()');
  assert.equal(a.state(), 'disconnecting');
  assert.equal(a.calls.native.stopVpn.length, 1);
  assert.notEqual(a.ev('VPN.clock'), null, 'le chronomètre continue tant que le natif n\'a pas confirmé l\'arrêt');
  a.ctx.onNativeVpnState('disconnected', '');
  assert.equal(a.state(), 'off');
  assert.equal(a.ev('VPN.clock'), null);
  assert.equal(a.ev('VPN.session'), null);
  assert.equal(a.ev('VPN.accessExpiresAt'), null);
  assert.equal(a.ev('Activity.sessions.length'), 1);
});

test('la configuration n\'apparaît dans aucun journal ni message', async () => {
  const a = app(NATIVE_READY, () => okResponse());
  await connect(a);
  a.ctx.onNativeVpnState('connected', '');
  const dump = JSON.stringify([a.ev('Activity.log'), a.calls.toasts, a.ev('VPN.errorSpec'), a.ev("document.getElementById('statusSub').textContent")]);
  assert.doesNotMatch(dump, /mot-de-passe-de-test|11111111-2222/);
});

test('erreur du natif après la demande -> ERROR, aucun chronomètre', async () => {
  const a = app(NATIVE_READY, () => okResponse());
  await connect(a);
  a.ctx.onNativeVpnState('error', 'vpn_permission_denied');
  assert.equal(a.state(), 'error');
  assert.equal(a.ev('VPN.errorSpec.key'), 'err.vpnPermission');
  assert.equal(a.ev('VPN.clock'), null);
  assert.equal(a.ev('VPN.session'), null);
  // le natif signale aussi ses états intermédiaires : jamais « connecté » à cause d'eux
  const b = app(NATIVE_READY, () => okResponse());
  await connect(b);
  b.ctx.onNativeVpnState('connecting', '');
  assert.equal(b.state(), 'connecting');
  assert.equal(b.ev('VPN.session'), null);
});

test('le moteur natif ne connaît pas le protocole -> refus, le natif n\'est pas démarré', async () => {
  const a = app({ engine: { integrated: true, protocols: ['xray'] }, apiBase: 'https://panel.example.tld' }, () => okResponse());
  await connect(a);
  assert.equal(a.calls.apiFetch.length, 1);
  assert.equal(a.calls.native.startVpn.length, 0);
  assert.equal(a.state(), 'error');
  assert.equal(a.ev('VPN.errorSpec.key'), 'err.protocolUnsupported');
  assert.match(a.ev('errorText(VPN.errorSpec)'), /tuic/);
});

test('les 14 erreurs du panel : ERROR + texte traduit, jamais le natif', async () => {
  const codes = ['subscription_expired', 'account_disabled', 'no_service_available', 'service_not_found', 'service_unhealthy', 'access_not_found',
    'access_disabled', 'access_expired', 'pro_unavailable', 'pro_authentication_failed', 'pro_timeout', 'incompatible_version', 'configuration_unavailable'];
  for(const code of codes){
    const a = app(NATIVE_READY, () => errResponse(503, code, { retry_after_s: 30 }));
    await connect(a);
    assert.equal(a.state(), 'error', code);
    assert.equal(a.calls.native.startVpn.length, 0, code);
    assert.equal(a.ev('VPN.errorSpec.key'), 'conn.err.' + code, code);
    const text = a.ev('errorText(VPN.errorSpec)');
    assert.doesNotMatch(text, /^conn\.err\./, code + ' : clé de traduction manquante');
    assert.doesNotMatch(text, /interne/, code + ' : le texte brut du panel ne doit pas s\'afficher pour un code connu');
    assert.equal(a.ev('VPN.session'), null);
  }
  // délai de réessai communiqué par le panel
  const a = app(NATIVE_READY, () => errResponse(503, 'service_unhealthy', { retry_after_s: 30 }));
  await connect(a);
  assert.match(a.ev('errorText(VPN.errorSpec)'), /30 s/);
  const b = app(NATIVE_READY, () => errResponse(403, 'access_expired', { retry_after_s: 30 }));
  await connect(b);
  assert.doesNotMatch(b.ev('errorText(VPN.errorSpec)'), /30 s/, 'réessayer ne sert à rien : pas de délai affiché');
});

test('session perdue (401) pendant la connexion -> déconnexion du compte, pas d\'erreur de connexion', async () => {
  const a = app(NATIVE_READY, () => ({ ok: false, status: 401, data: null, expired: true }));
  await connect(a);
  assert.equal(a.calls.sessionExpired, 1);
  assert.equal(a.ev('authToken'), null);
  assert.equal(a.calls.native.startVpn.length, 0);
  assert.notEqual(a.state(), 'on');
});

test('panel injoignable / hors-ligne / délai dépassé -> ERROR explicites', async () => {
  const off = app(NATIVE_READY, () => { throw new TypeError('Failed to fetch'); }, { online: false });
  await connect(off);
  assert.equal(off.ev('VPN.errorSpec.key'), 'err.offline');
  const down = app(NATIVE_READY, () => { throw new TypeError('Failed to fetch'); });
  await connect(down);
  assert.equal(down.ev('VPN.errorSpec.key'), 'err.panel');
  const slow = app(NATIVE_READY, () => { throw Object.assign(new Error('abort'), { name: 'AbortError' }); });
  await connect(slow);
  assert.equal(slow.ev('VPN.errorSpec.key'), 'err.timeout');
  for(const a of [off, down, slow]){ assert.equal(a.state(), 'error'); assert.equal(a.calls.native.startVpn.length, 0); }
});

test('réponse du panel hors contrat -> ERROR, aucune configuration reconstruite', async () => {
  for(const bad of [okResponse({ configs: [] }), okResponse({ configs: [{ protocol: 'tuic', uri: '' }] }), okResponse({ status: 'ok' }), { ok: true, status: 200, expired: false, data: null }]){
    const a = app(NATIVE_READY, () => bad);
    await connect(a);
    assert.equal(a.state(), 'error');
    assert.equal(a.calls.native.startVpn.length, 0);
    assert.equal(a.ev('VPN.errorSpec.key'), 'conn.err.badResponse');
  }
});

test('service_health « unknown » : connexion permise, mais dite comme telle (journal), jamais « sain »', async () => {
  const a = app(NATIVE_READY, () => okResponse({ service_health: 'unknown' }));
  await connect(a);
  assert.equal(a.calls.native.startVpn.length, 1);
  assert.equal(a.ev('VPN.health'), 'unknown');
  assert.ok(a.ev("Activity.log.some((l) => l.key === 'log.healthUnknown')"));
});

test('Access à expiration réelle : le tunnel est coupé à l\'échéance (pas de compteur fictif)', async () => {
  const a = app(NATIVE_READY, () => okResponse({ access: { state: 'active', expires_at: new Date(Date.now() + 60000).toISOString() } }));
  await connect(a);
  a.ctx.onNativeVpnState('connected', '');
  assert.equal(a.state(), 'on');
  a.ev('VPN.accessExpiresAt = Date.now() - 1000');   // l'échéance est passée
  a.timers.filter((x) => x.repeat).forEach((x) => x.fn());
  assert.equal(a.state(), 'disconnecting');
  assert.equal(a.calls.native.stopVpn.length, 1);
  assert.ok(a.calls.toasts.some((x) => /accès est arrivé à son terme/.test(x.m)));
});

test('essai : limite annoncée par le panel (trial_limit_minutes) seulement sans expiration réelle', async () => {
  const a = app(NATIVE_READY, () => okResponse({ trial_limit_minutes: 30, access: { state: 'active', expires_at: '' } }));
  await connect(a);
  assert.equal(a.ev('VPN.trialLimitMinutes'), 30);
  assert.equal(a.ev('VPN.accessExpiresAt'), null);
});

test('hors application (navigateur) : jamais de connexion simulée, backend non sollicité', async () => {
  const a = loadApp({ search: '?api=https://panel.example.tld', respond: () => { throw new Error('non'); } });
  a.signIn();
  await connect(a);
  assert.equal(a.state(), 'error');
  assert.equal(a.ev('VPN.errorSpec.key'), 'err.browserOnly');
  assert.equal(a.calls.apiFetch.length, 0);
});

test('adresse du panel absente/non sécurisée : erreur claire, aucune requête', async () => {
  const a = app({ engine: { integrated: true, protocols: ['tuic'] }, apiBase: 'http://panel.example.tld' }, () => { throw new Error('non'); });
  await connect(a);
  assert.equal(a.state(), 'error');
  assert.equal(a.ev('VPN.errorSpec.key'), 'err.apiInsecure');
  assert.equal(a.calls.apiFetch.length, 0);
});

test('session dépassée d\'après expires_in : reconnexion demandée sans appel réseau', async () => {
  const a = app(NATIVE_READY, () => { throw new Error('non'); });
  a.ev('authExpiresAt = Date.now() - 1');
  await connect(a);
  assert.equal(a.calls.apiFetch.length, 0);
  assert.equal(a.calls.sessionExpired, 1);
});

test('watchdog : un natif qui ne répond jamais n\'est PAS présenté comme connecté', async () => {
  const a = app(NATIVE_READY, () => okResponse());
  await connect(a);
  assert.equal(a.state(), 'connecting');
  a.fire(60000);
  assert.equal(a.state(), 'error');
  assert.equal(a.ev('VPN.errorSpec.key'), 'err.timeout');
  assert.equal(a.ev('VPN.session'), null);
});

test('le mode aperçu (?preview=1) ne concerne jamais l\'application Android', async () => {
  const a = loadApp({ native: NATIVE_NO_ENGINE, search: '?preview=1', respond: () => { throw new Error('non'); } });
  a.signIn();
  await connect(a);
  assert.equal(a.state(), 'error');
  assert.equal(a.ev('VPN.session'), null);
});
