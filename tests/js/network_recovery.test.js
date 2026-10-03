'use strict';
// Reprise réseau après l'arrêt du tunnel (api.js + vpn.js) : le VRAI code de l'interface, avec un pont natif et un
// fetch simulés. Contexte : en v1.2.1, après un STOP, chaque requête échouait avant d'atteindre le panel jusqu'au
// redémarrage du processus.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

const BASE = 'https://panel.example.tld';
const ENGINE = { integrated: true, protocols: ['udp'] };
const withNet = (needsRestart) => ({ engine: ENGINE, apiBase: BASE, network: { needsRestart } });
const ok = (body) => ({ ok: true, status: 200, json: async () => body || { status: 'ok' } });
const down = () => { throw new TypeError('Failed to fetch'); };

// fetch simulé : échoue `failures` fois puis répond ; compte les appels.
function flaky(a, failures, response){
  const state = { n: 0 };
  a.ctx.fetch = async () => { state.n++; if(state.n <= failures) return down(); return response || ok(); };
  return state;
}
// lance une requête réelle, laisse passer le délai de reprise (700 ms) et rend le résultat
async function call(a, path, options){
  const p = a.ctx.__realApiFetch(path, options);
  await new Promise((r) => setImmediate(r));
  a.fire(700);
  return p;
}

test('une requête qui échoue juste après l\'arrêt du tunnel est relancée UNE fois, après réinitialisation du réseau', async () => {
  const a = loadApp({ native: withNet(false) });
  const f = flaky(a, 1);
  const res = await call(a, '/api/user/me');
  assert.equal(res.ok, true, 'la 2e tentative aboutit');
  assert.equal(f.n, 2, 'exactement 2 requêtes');
  assert.equal(a.calls.native.resetNetwork, 1, 'le réseau de la WebView a été réinitialisé avant la relance');
  assert.equal(a.calls.native.restartApp, 0, 'pas de redémarrage quand la reprise réussit');
});

test('deux échecs de suite : l\'erreur est rendue ; pas de 3e tentative', async () => {
  const a = loadApp({ native: withNet(false) });
  const f = flaky(a, 5);
  await assert.rejects(() => call(a, '/api/user/me'), /Failed to fetch/);
  assert.equal(f.n, 2);
  assert.equal(a.calls.native.restartApp, 0, 'le natif dit qu\'aucun redémarrage n\'est nécessaire');
});

test('échec persistant juste après l\'arrêt d\'un tunnel : l\'application redémarre (après avertissement), une seule fois', async () => {
  const a = loadApp({ native: withNet(true) });
  a.ev("authToken = null");
  flaky(a, 9);
  await assert.rejects(() => call(a, '/api/user/me'), /Failed to fetch/);
  assert.equal(a.calls.toasts.length, 1, 'l\'utilisateur est prévenu');
  assert.match(a.calls.toasts[0].m, /redémarre/);
  assert.equal(a.calls.native.restartApp, 0, 'pas avant le délai d\'avertissement');
  a.fire(2000);
  assert.equal(a.calls.native.restartApp, 1);
});

test('délai dépassé (AbortError) : jamais de relance ni de redémarrage', async () => {
  const a = loadApp({ native: withNet(true) });
  let n = 0;
  a.ctx.fetch = async () => { n++; const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
  await assert.rejects(() => a.ctx.__realApiFetch('/api/user/me'), /aborted/);
  assert.equal(n, 1);
  assert.equal(a.calls.native.resetNetwork, 0);
  assert.equal(a.calls.native.restartApp, 0);
});

test('seuls les GET et les POST login / connect sont relancés (jamais un POST non idempotent)', async () => {
  const a = loadApp({ native: withNet(false) });
  const f = flaky(a, 1);
  await assert.rejects(() => a.ctx.__realApiFetch('/api/user/messages', { method: 'POST', body: '{}' }), /Failed to fetch/);
  assert.equal(f.n, 1, 'POST /messages : une seule tentative');
  assert.equal(a.calls.native.resetNetwork, 0);

  for(const path of ['/api/auth/login', '/api/user/connect']){
    const b = loadApp({ native: withNet(false) });
    const g = flaky(b, 1);
    const res = await call(b, path, { method: 'POST', body: '{}' });
    assert.equal(res.ok, true, path);
    assert.equal(g.n, 2, path);
  }
});

test('hors de l\'application Android (navigateur) : aucune relance, l\'erreur est rendue telle quelle', async () => {
  const a = loadApp({ search: '?api=https://panel.example.tld' });
  const f = flaky(a, 1);
  await assert.rejects(() => a.ctx.__realApiFetch('/api/user/me'), /Failed to fetch/);
  assert.equal(f.n, 1);
});

test('application sans les nouvelles méthodes natives (ancien pont) : comportement inchangé', async () => {
  const a = loadApp({ native: { engine: ENGINE, apiBase: BASE } });
  const f = flaky(a, 1);
  await assert.rejects(() => a.ctx.__realApiFetch('/api/user/me'), /Failed to fetch/);
  assert.equal(f.n, 1);
});

test('à la fermeture du tunnel (déconnecté ou erreur), le réseau de la WebView est réinitialisé tout de suite', () => {
  const a = loadApp({ native: withNet(false) });
  a.signIn();
  a.ev("window.onNativeVpnState('disconnected', '')");
  assert.equal(a.calls.native.resetNetwork, 1);
  a.ev("window.onNativeVpnState('error', 'tunnel_closed')");
  assert.equal(a.calls.native.resetNetwork, 2);
  a.ev("window.onNativeVpnState('connected', '')");
  assert.equal(a.calls.native.resetNetwork, 2, 'une connexion établie ne réinitialise rien');
});

test('les nouveaux textes existent en français et en anglais', () => {
  const a = loadApp({ native: withNet(false) });
  for(const lang of ['fr', 'en']){
    a.ev(`I18N.set('${lang}', false)`);
    for(const k of ['net.restarting', 'log.networkRecovered']){
      const txt = a.ev(`t('${k}')`);
      assert.ok(txt && txt !== k, `${lang} : ${k}`);
    }
  }
});
