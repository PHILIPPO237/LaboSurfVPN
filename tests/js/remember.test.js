'use strict';
// « Rester connecté » : la session du compte (jeton du Panel, jamais le mot de passe) est gardée par le pont natif
// (SessionVault, chiffrée par le Keystore) et rouvre le compte au démarrage. Vrai code de l'interface (account.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

const API = 'https://panel.example.tld';
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCd';
const app = (vault, extra) => loadApp({ native: Object.assign({ engine: { integrated: false, protocols: [] }, apiBase: API, installId: 'ins-x' },
  vault ? { vault } : {}, extra || {}), respond: () => ({ ok: false, status: 401, data: { status: 'error', message: 'x' } }) });

test('connexion : « rester connecté » demandé au panel seulement si le pont sait garder la session', async () => {
  for (const [vault, wanted] of [[{}, true], [null, false]]) {
    const a = app(vault);
    a.ev("document.getElementById('accUsername').value = 'alice'; document.getElementById('accPassword').value = 'Mot-de-passe-1'");
    await a.ev('Actions.login()');
    const call = a.calls.apiFetch.find((c) => c.path === '/api/auth/login');
    assert.equal(JSON.parse(call.options.body).remember, wanted);
    assert.equal(call.options.device, true, 'le panel exige l\'identifiant d\'installation pour une session d\'appareil de confiance');
  }
});

test('sauvegarde : le jeton et son expiration, jamais le mot de passe ; rien si la durée est inconnue', () => {
  const vault = {};
  const a = app(vault);
  const exp = Date.now() + 30 * 86400 * 1000;
  a.ev(`authToken = '${TOKEN}'; authExpiresAt = ${exp}; RememberMe.save();`);
  assert.equal(vault.stored, TOKEN + '\n' + exp);
  assert.ok(!vault.stored.includes('Mot-de-passe'));
  const b = {};
  app(b).ev(`authToken = '${TOKEN}'; authExpiresAt = null; RememberMe.save();`);
  assert.equal(b.stored, undefined, 'expiration inconnue : rien n\'est gardé');
});

test('démarrage : une session gardée rouvre le compte sans ressaisir les identifiants', async () => {
  const exp = Date.now() + 3600 * 1000;
  const a = app({ stored: TOKEN + '\n' + exp });
  const opened = [];
  a.ctx.afterAuth = async (n) => { opened.push(n); };
  await a.ev('restoreRememberedSession()');
  assert.equal(a.ev('authToken'), TOKEN);
  assert.equal(a.ev('authExpiresAt'), exp);
  assert.equal(opened.length, 1, 'compte rechargé auprès du panel (qui reste juge de la session)');
});

test('démarrage : session gardée expirée, presque expirée ou illisible -> effacée, rien rouvert', async () => {
  for (const stored of [TOKEN + '\n' + (Date.now() - 1000), TOKEN + '\n' + (Date.now() + 10000), 'n\'importe quoi', 'court\n9999999999999']) {
    const vault = { stored };
    const a = app(vault);
    a.ctx.afterAuth = async () => { throw new Error('ne doit pas être appelé'); };
    await a.ev('restoreRememberedSession()');
    assert.equal(a.ev('authToken'), null, stored);
    assert.equal(vault.stored, '', 'contenu effacé : ' + stored);
  }
});

test('déconnexion ou session expirée : la session gardée est effacée', () => {
  const vault = { stored: TOKEN + '\n' + (Date.now() + 3600 * 1000) };
  const a = app(vault);
  a.ctx.apiFetch = async () => ({ ok: true, status: 200, data: {} });
  a.ev(`authToken = '${TOKEN}'`);
  a.ev('Actions.logout()');
  assert.equal(vault.stored, '');
  assert.ok(vault.clears >= 1);
});

test('option coupée : session gardée effacée, plus rien demandé ni gardé ; réactivée : la session en cours est gardée', () => {
  const vault = { stored: TOKEN + '\n' + (Date.now() + 3600 * 1000) };
  const a = app(vault);
  a.ctx.renderSettings = () => {};
  a.ev('Actions.toggleRemember()');
  assert.equal(vault.stored, '');
  assert.equal(a.ev('RememberMe.wanted()'), false);
  const exp = Date.now() + 3600 * 1000;
  a.ev(`authToken = '${TOKEN}'; authExpiresAt = ${exp}; RememberMe.save();`);
  assert.equal(vault.stored, '', 'option coupée : rien n\'est gardé');
  a.ev('Actions.toggleRemember()');
  assert.equal(vault.stored, TOKEN + '\n' + exp);
});
