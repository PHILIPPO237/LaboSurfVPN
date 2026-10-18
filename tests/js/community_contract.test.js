'use strict';
// Communauté intégrée : lecture stricte des réponses /api/chat/*, états d'échec distincts (une panne n'est pas un refus d'accès).
const test = require('node:test');
const assert = require('node:assert/strict');
const { CommunityContract } = require('../../app/src/main/assets/www/js/contract.js');
const { loadApp } = require('./harness.js');

const boot = (over) => Object.assign({ status: 'ok', me: { username: 'a', can_write: false }, restriction: null, limits: { max_text: 1500 },
  rooms: [{ id: 'community', label: 'Communauté', description: 'Salon général', unread: 2, can_write: false }] }, over || {});

test('CommunityContract.failure : session, refus, réseau, panne sont distincts', () => {
  assert.equal(CommunityContract.failure({ status: 401 }).state, 'login');
  assert.equal(CommunityContract.failure({ status: 200, expired: true }).state, 'login');
  assert.deepEqual(CommunityContract.failure({ status: 403, data: { code: 'chat_forbidden' } }), { state: 'forbidden', code: 'chat_forbidden' });
  assert.equal(CommunityContract.failure({ status: 0 }).state, 'network');
  assert.equal(CommunityContract.failure({ status: 503 }).state, 'down');
  assert.equal(CommunityContract.failure({ status: 404 }).state, 'unavailable');
});

test('CommunityContract.parseBootstrap : salons tels que le panel les donne, rien d\'inventé', () => {
  const r = CommunityContract.parseBootstrap(boot());
  assert.equal(r.state, 'ready');
  assert.equal(r.rooms.length, 1);
  assert.equal(r.rooms[0].canWrite, false);
  assert.equal(r.canWrite, false);
  assert.equal(r.maxText, 1500);
  assert.equal(CommunityContract.parseBootstrap(boot({ me: { can_write: 'oui' } })).canWrite, false, 'seul true autorise');
  assert.equal(CommunityContract.parseBootstrap(boot({ rooms: [{ id: 'x' }] })).state, 'invalid');
  assert.equal(CommunityContract.parseBootstrap(boot({ status: 'error' })).state, 'invalid');
  assert.equal(CommunityContract.parseBootstrap(null).state, 'invalid');
  assert.deepEqual(CommunityContract.parseBootstrap(boot({ restriction: { until: 99, reason: 'spam' } })).restriction, { until: 99, reason: 'spam' });
});

test('CommunityContract.parseMessages : lecture stricte, texte brut', () => {
  const ok = CommunityContract.parseMessages({ status: 'ok', last_id: 4, messages: [{ id: 4, text: '<b>x</b>', author: { username: 'bob', role: 'Membre' }, mine: true, file: { name: 'a' } }] });
  assert.equal(ok.state, 'ready');
  assert.equal(ok.messages[0].text, '<b>x</b>');
  assert.equal(ok.messages[0].mine, true);
  assert.equal(ok.messages[0].hasFile, true);
  assert.equal(ok.lastId, 4);
  assert.equal(CommunityContract.parseMessages({ status: 'ok', messages: [{ text: 'sans id' }] }).state, 'invalid');
  assert.equal(CommunityContract.parseMessages({ status: 'ok', messages: 'x' }).state, 'invalid');
});

const app = () => loadApp({ native: { engine: { integrated: false, protocols: [] }, apiBase: 'https://panel.example.tld' } });

test('Communauté : sans session, ouverture = parcours de connexion avec retour direct, aucun appel au panel', () => {
  const a = app();
  a.ev('authToken = null');
  a.ev('Actions.openCommunity()');
  assert.equal(a.ev('LC.wantReturn'), true);
  assert.equal(a.calls.apiFetch.length, 0);
});

test("Communauté : le retour automatique est annulé si l'utilisateur va ailleurs (showScreen)", () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'app', 'src', 'main', 'assets', 'www', 'js', 'app.js'), 'utf8');
  assert.match(src, /name !== 'account' && name !== 'livechat'.*LC\.wantReturn = false/);
  assert.match(src, /const SCREENS = \[[^\]]*'livechat'/);
});

test("Profil : le bouton du panel complet n'est proposé que si le serveur indique un accès (jamais Gratuit ni VIP)", () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'app', 'src', 'main', 'assets', 'www', 'js', 'account.js'), 'utf8');
  assert.match(src, /profActions'\)\.hidden = !\(API\.state\.ok && p\.statusOk && p\.panelScope !== 'none'\)/);
});
