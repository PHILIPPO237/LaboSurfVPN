'use strict';
// En-tête X-LS-Engines : capacités RÉELLES du client, lues auprès du natif (LaboSurfNative.getEngineInfo), envoyées
// seulement sur les routes de connexion. Absent dès que la liste ne peut pas être établie : le Panel garde alors son
// comportement historique. L'en-tête ne confère aucun droit (le Panel ne s'en sert que pour masquer ce que le client
// ne sait pas transporter).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

const API = 'https://panel.example.tld';
const nativeApp = (engine) => loadApp({
  native: { engine, apiBase: API, deviceId: 'device-test' },
  respond: () => ({ ok: true, status: 200, data: { status: 'ok' } }),
});

// Appel du VRAI apiFetch (api.js) avec un fetch simulé : on observe les en-têtes réellement envoyés
function realFetchHeaders(app, path, options){
  const seen = [];
  app.ctx.fetch = async (url, init) => { seen.push({ url, headers: init.headers }); return { ok: true, status: 200, json: async () => ({ status: 'ok' }) }; };
  return app.ctx.__realApiFetch(path, options || {}).then(() => seen[0]);
}

test('X-LS-Engines reprend exactement les moteurs annoncés par le natif', async () => {
  const a = nativeApp({ integrated: true, protocols: ['udp', 'xray', 'hysteria2', 'wireguard', 'tuic', 'ssh', 'shssl', 'sshhttp'] });
  const opts = await realFetchHeaders(a, '/api/user/connect/options');
  assert.equal(opts.headers['X-LS-Engines'], 'udp,xray,hysteria2,wireguard,tuic,ssh,shssl,sshhttp');
  const conn = await realFetchHeaders(a, '/api/user/connect', { method: 'POST', body: '{}' });
  assert.equal(conn.headers['X-LS-Engines'], 'udp,xray,hysteria2,wireguard,tuic,ssh,shssl,sshhttp');
});

test('un moteur absent de la liste native n\'est jamais ajouté', async () => {
  const a = nativeApp({ integrated: true, protocols: ['udp'] });
  const h = await realFetchHeaders(a, '/api/user/connect/options');
  assert.equal(h.headers['X-LS-Engines'], 'udp');
});

test('l\'en-tête n\'est envoyé que sur les routes de connexion', async () => {
  const a = nativeApp({ integrated: true, protocols: ['udp', 'xray'] });
  const other = await realFetchHeaders(a, '/api/user/me');
  assert.equal(other.headers['X-LS-Engines'], undefined);
  const login = await realFetchHeaders(a, '/api/auth/login', { method: 'POST', body: '{}' });
  assert.equal(login.headers['X-LS-Engines'], undefined);
});

test('liste nettoyée : identifiants invalides ignorés, doublons retirés, minuscules', async () => {
  const a = nativeApp({ integrated: true, protocols: ['UDP', 'xray', 'bad id!', 'xray', '', 42, '../x'] });
  const h = await realFetchHeaders(a, '/api/user/connect/options');
  assert.equal(h.headers['X-LS-Engines'], 'udp,xray,42');
});

test('moteur natif non intégré, liste vide ou ancien shell : aucun en-tête (comportement historique)', async () => {
  for (const engine of [{ integrated: false, protocols: ['udp'] }, { integrated: true, protocols: [] }, { integrated: true }, undefined]) {
    const a = nativeApp(engine);
    const h = await realFetchHeaders(a, '/api/user/connect/options');
    assert.equal(h.headers['X-LS-Engines'], undefined, JSON.stringify(engine));
  }
});

test('JSON natif illisible : aucun en-tête, aucune exception', async () => {
  const a = nativeApp({ integrated: true, protocols: ['udp'] });
  a.ctx.LaboSurfNative.getEngineInfo = () => 'pas du json';
  const h = await realFetchHeaders(a, '/api/user/connect/options');
  assert.equal(h.headers['X-LS-Engines'], undefined);
});

test('navigateur (sans pont natif) : aucun en-tête', async () => {
  const a = loadApp({ search: '?api=https://panel.example.tld' });
  const h = await realFetchHeaders(a, '/api/user/connect/options');
  assert.equal(h.headers['X-LS-Engines'], undefined);
});
