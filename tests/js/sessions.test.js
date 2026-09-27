'use strict';
// Sessions et appareils : identifiant d'INSTALLATION (jamais ANDROID_ID), envoyé seulement à l'ouverture de session,
// déconnexion révoquée côté panel, écran Sécurité branché sur l'API /api/account/*.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

const API = 'https://panel.example.tld';
const nativeApp = (extra) => loadApp({ native: Object.assign({ engine: { integrated: false, protocols: [] }, apiBase: API, deviceId: 'ANDROID-ID-MATERIEL' }, extra || {}),
  respond: (p) => ({ ok: true, status: 200, data: { status: 'ok', devices: [], revoked: 0 } }) });

// Appel du VRAI apiFetch (api.js) avec un fetch simulé : on observe les en-têtes réellement envoyés
function realFetchHeaders(app, path, options){
  const seen = [];
  app.ctx.fetch = async (url, init) => { seen.push({ url, headers: init.headers }); return { ok: true, status: 200, json: async () => ({ status: 'ok' }) }; };
  return app.ctx.__realApiFetch(path, options).then(() => seen[0]);
}

test('appli native : identifiant d\'installation fourni par le pont natif, distinct de l\'ANDROID_ID', () => {
  const a = nativeApp({ installId: 'ins-0123456789abcdef0123456789abcdef' });
  assert.equal(a.ev('getInstallId()'), 'ins-0123456789abcdef0123456789abcdef');
  assert.equal(a.ev('getDeviceId()'), 'ANDROID-ID-MATERIEL', 'l\'anti-abus de l\'essai garde son identifiant, séparé');
});

test('navigateur : identifiant d\'installation aléatoire, généré une fois et conservé', () => {
  const a = loadApp({ search: '?api=https://panel.example.tld' });
  const id1 = a.ev('getInstallId()');
  assert.match(id1, /^ins-[0-9a-f]{32}$/);
  assert.equal(a.ev('getInstallId()'), id1, 'stable pour cette installation');
  const b = loadApp({ search: '?api=https://panel.example.tld' });
  assert.notEqual(b.ev('getInstallId()'), id1, 'une autre installation a un autre identifiant');
});

test('X-Device-Id / X-Device-Name envoyés à la connexion, jamais l\'ANDROID_ID, et pas sur les autres appels', async () => {
  const a = nativeApp({ installId: 'ins-aaaabbbbccccddddeeeeffff00001111', deviceLabel: 'Samsung SM-A155F' });
  const login = await realFetchHeaders(a, '/api/auth/login', { method: 'POST', device: true, body: '{}' });
  assert.equal(login.headers['X-Device-Id'], 'ins-aaaabbbbccccddddeeeeffff00001111');
  assert.equal(login.headers['X-Device-Name'], 'Labo Surf VPN - Samsung SM-A155F');
  assert.ok(!JSON.stringify(login.headers).includes('ANDROID-ID-MATERIEL'));
  a.ev("authToken = 'jeton'");
  const other = await realFetchHeaders(a, '/api/user/me', {});
  assert.equal(other.headers['X-Device-Id'], undefined, 'identifiant non exposé inutilement');
  assert.equal(other.headers['Authorization'], 'Bearer jeton');
});

test('connexion et inscription demandent l\'envoi des en-têtes d\'appareil', async () => {
  const a = nativeApp({ installId: 'ins-x' });
  a.ev("document.getElementById('accUsername').value = 'alice'; document.getElementById('accPassword').value = 'Mot-de-passe-1'");
  a.ctx.apiFetch = async (p, o) => { a.calls.apiFetch.push({ path: p, options: o }); return { ok: false, status: 401, data: { status: 'error', message: 'x' } }; };
  await a.ev('Actions.login()');
  const call = a.calls.apiFetch.find((c) => c.path === '/api/auth/login');
  assert.equal(call.options.device, true);
});

test('déconnexion : la session est révoquée côté panel (POST /api/auth/logout avec le jeton)', () => {
  const a = nativeApp();
  a.ev("authToken = 'jeton-a'");
  let sentWith = null;
  a.ctx.apiFetch = async (p, o) => { if(p === '/api/auth/logout') sentWith = a.ev('authToken'); return { ok: true, status: 200, data: {} }; };
  a.ev('Actions.logout()');
  assert.equal(sentWith, 'jeton-a', 'le jeton est encore présent au moment de l\'appel');
  assert.equal(a.ev('authToken'), null);
});

test('déconnexion hors ligne : l\'app se déconnecte quand même', () => {
  const a = nativeApp();
  a.ev("authToken = 'jeton-b'");
  a.ctx.apiFetch = async () => { throw new Error('hors ligne'); };
  a.ev('Actions.logout()');
  assert.equal(a.ev('authToken'), null);
});

test('mes appareils : révoquer un appareil, ou une ancienne session sans identifiant', async () => {
  const a = nativeApp();
  a.ev("authToken = 'jeton'");
  a.ev("Account.devices = [{ device: 'A', current: true, device_id: 'ins-a' }, { device: 'B', current: false, device_id: 'ins-b' }, { device: 'Web', current: false, device_id: '', session_id: 's_42' }]");
  const paths = [];
  a.ctx.apiFetch = async (p, o) => { paths.push(p); return { ok: true, status: 200, data: { status: 'ok', devices: [] } }; };
  await a.ev("Actions.revokeDevice({ dataset: { index: '1' } })");
  await a.ev("Account.devices = [{ device: 'A', current: true, device_id: 'ins-a' }, { device: 'Web', current: false, device_id: '', session_id: 's_42' }]; Actions.revokeDevice({ dataset: { index: '1' } })");
  await a.ev("Account.devices = [{ device: 'A', current: true, device_id: 'ins-a' }]; Actions.revokeDevice({ dataset: { index: '0' } })");
  assert.ok(paths.includes('/api/account/devices/ins-b/revoke'));
  assert.ok(paths.includes('/api/account/sessions/s_42/revoke'));
  assert.ok(!paths.some((p) => p.includes('ins-a')), 'l\'appareil courant ne se révoque pas par erreur');
});

test('changement de mot de passe : même règle que le panel (8 caractères) et bon appel', async () => {
  const a = nativeApp();
  a.ev("authToken = 'jeton'");
  const bodies = [];
  a.ctx.apiFetch = async (p, o) => { bodies.push({ p, b: o && o.body }); return { ok: true, status: 200, data: { status: 'ok', devices: [] } }; };
  a.ev("document.getElementById('secPwCurrent').value = 'Ancien-mdp-1'; document.getElementById('secPwNew').value = 'court'; document.getElementById('secPwConfirm').value = 'court'");
  await a.ev('Actions.changePassword()');
  assert.equal(bodies.length, 0, 'trop court : refusé avant tout appel');
  a.ev("document.getElementById('secPwNew').value = 'Nouveau-mdp-2'; document.getElementById('secPwConfirm').value = 'Nouveau-mdp-2'");
  await a.ev('Actions.changePassword()');
  assert.equal(bodies[0].p, '/api/account/password');
  assert.deepEqual(JSON.parse(bodies[0].b), { current_password: 'Ancien-mdp-1', new_password: 'Nouveau-mdp-2', confirm_password: 'Nouveau-mdp-2' });
});
