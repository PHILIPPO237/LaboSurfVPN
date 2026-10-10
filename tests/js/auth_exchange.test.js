'use strict';
// Session unifiée Panel <-> application : code d'échange à usage unique (POST /api/auth/exchange, /api/auth/exchange/redeem).
// Vrai code de l'interface (account.js, api.js) ; seuls le réseau (apiFetch), le pont natif et l'ouverture de lien sont simulés.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

const API = 'https://panel.example.tld';
const CODE = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE';

function app(native, respond){
  const a = loadApp({ native: Object.assign({ engine: { integrated: false, protocols: [] }, apiBase: API, installId: 'ins-aaaabbbbccccddddeeeeffff00001111' }, native || {}),
    respond: respond || (() => ({ ok: true, status: 200, data: { status: 'ok' } })) });
  a.opened = [];
  a.ctx.openExternal = (u) => { a.opened.push(u); };
  a.auth = [];
  a.ctx.afterAuth = async (name) => { a.auth.push(name); };
  return a;
}
const flush = () => new Promise((r) => setImmediate(r));

// ------------------------------------------------------------------------------------- Panel -> application
test('un code reçu par lien du panel ouvre la session de l\'application, sans mot de passe', async () => {
  const a = app({ exchangeCode: CODE }, (p) => p === '/api/auth/exchange/redeem'
    ? { ok: true, status: 200, data: { status: 'ok', token: 'jeton-app', expires_in: 3600, user: { username: 'vera' } } } : { ok: false, status: 404, data: null });
  a.ev('window.LaboOnExchange()'); await flush(); await flush();
  const call = a.calls.apiFetch.find((c) => c.path === '/api/auth/exchange/redeem');
  assert.ok(call, 'échange demandé au panel');
  assert.deepEqual(JSON.parse(call.options.body), { code: CODE, target: 'app' });
  assert.equal(call.options.device, true, 'identifiant d\'installation envoyé : la session apparaît dans « Mes appareils »');
  assert.equal(a.ev('authToken'), 'jeton-app');
  assert.deepEqual(a.auth, ['vera']);
  assert.ok(a.calls.toasts.some((t) => t.type === 'success'));
});

test('le code n\'est remis qu\'une fois par le pont natif', async () => {
  const a = app({ exchangeCode: CODE }, () => ({ ok: true, status: 200, data: { status: 'ok', token: 't', user: { username: 'v' } } }));
  a.ev('window.LaboOnExchange()'); await flush();
  a.ev("authToken = null"); a.ev('window.LaboOnExchange()'); await flush();
  assert.equal(a.calls.apiFetch.filter((c) => c.path === '/api/auth/exchange/redeem').length, 1);
});

test('code mal formé : aucun appel au panel', async () => {
  for(const bad of ['', 'court', '<script>alert(1)</script>', 'a'.repeat(101)]){
    const a = app({ exchangeCode: bad });
    a.ev('window.LaboOnExchange()'); await flush();
    assert.equal(a.calls.apiFetch.length, 0, bad);
  }
});

test('une session déjà ouverte n\'est jamais remplacée par un lien', async () => {
  const a = app({ exchangeCode: CODE });
  a.ev("authToken = 'jeton-existant'; authExpiresAt = null");
  a.ev('window.LaboOnExchange()'); await flush();
  assert.equal(a.calls.apiFetch.length, 0);
  assert.equal(a.ev('authToken'), 'jeton-existant');
});

test('code refusé par le panel (expiré, déjà utilisé) : message, aucune session', async () => {
  const a = app({ exchangeCode: CODE }, () => ({ ok: false, status: 400, data: { status: 'error', code: 'invalid_code', message: 'Lien de connexion invalide ou expiré.' } }));
  a.ev('window.LaboOnExchange()'); await flush();
  assert.equal(a.ev('authToken'), null);
  assert.ok(a.calls.toasts.some((t) => t.type === 'error' && /invalide ou expiré/.test(t.m)));
});

test('adresse du panel pas encore prête : nouvel essai programmé, code laissé côté natif', () => {
  const a = app({ exchangeCode: CODE });
  a.ev('API.state.ok = false');
  a.ev('window.LaboOnExchange()');
  assert.equal(a.calls.native.exchangeConsumed || 0, 0);
  assert.ok(a.timers.some((t) => t.ms === 500));
});

// ------------------------------------------------------------------------------------- application -> Panel
test('connecté : le panel s\'ouvre avec la session, code dans le FRAGMENT de l\'adresse', async () => {
  const url = '/auth/exchange#code=' + CODE;
  const a = app({}, (p) => p === '/api/auth/exchange' ? { ok: true, status: 200, data: { status: 'ok', code: CODE, url: url } } : { ok: false, status: 404, data: null });
  a.ev("authToken = 'jeton'; authExpiresAt = null");
  await a.ev('Actions.openPanel()');
  const call = a.calls.apiFetch.find((c) => c.path === '/api/auth/exchange');
  assert.deepEqual(JSON.parse(call.options.body), { target: 'web', next: '/dashboard' });
  assert.deepEqual(a.opened, [API + url]);
  assert.ok(!a.opened[0].includes('?'), 'rien dans la partie de l\'adresse envoyée au serveur');
});

test('non connecté : le site s\'ouvre normalement, sans appel d\'échange', async () => {
  const a = app({});
  await a.ev('Actions.openPanel()');
  assert.equal(a.calls.apiFetch.length, 0);
  assert.deepEqual(a.opened, [API + '/']);
});

test('réponse inattendue du panel : jamais d\'ouverture d\'une autre adresse', async () => {
  for(const url of ['https://evil.example/auth/exchange#code=' + CODE, '//evil.example', '/auth/exchange?code=' + CODE, '/auth/exchange#code=x']){
    const a = app({}, () => ({ ok: true, status: 200, data: { status: 'ok', url: url } }));
    a.ev("authToken = 'jeton'; authExpiresAt = null");
    await a.ev('Actions.openPanel()');
    assert.deepEqual(a.opened, [API + '/'], url);
  }
});

test('destination interne demandée (ex. espace revendeur) transmise, sinon tableau de bord', async () => {
  const a = app({}, () => ({ ok: true, status: 200, data: { status: 'ok', url: '/auth/exchange#code=' + CODE } }));
  a.ev("authToken = 'jeton'; authExpiresAt = null");
  await a.ev("Actions.openPanel('/panel-revendeur')");
  await a.ev("Actions.openPanel('https://evil.example')");
  const bodies = a.calls.apiFetch.map((c) => JSON.parse(c.options.body).next);
  assert.deepEqual(bodies, ['/panel-revendeur', '/dashboard']);
});
