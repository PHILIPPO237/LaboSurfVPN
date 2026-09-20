'use strict';
// Compte : aucune valeur inventée (jauge d'abonnement, quota, session).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

const app = () => loadApp({ native: { engine: { integrated: false, protocols: [] }, apiBase: 'https://panel.example.tld' } });
const iso = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const iso0 = (days) => new Date(Date.now() + days * 86400000);

test('durée de l\'abonnement : seulement si début ET fin sont fournis par le panel', () => {
  const a = app();
  assert.equal(a.ev("subscriptionTotalDays('', '2026-10-01')"), null);
  assert.equal(a.ev("subscriptionTotalDays('2026-09-01', '')"), null);
  assert.equal(a.ev("subscriptionTotalDays('2026-09-01', '2026-09-01')"), 1);
  assert.equal(a.ev("subscriptionTotalDays('2026-09-01', '2026-10-01')"), 31);
  assert.equal(a.ev("subscriptionTotalDays('2026-10-01', '2026-09-01')"), null);
  assert.equal(a.ev("subscriptionTotalDays('n importe quoi', '2026-09-01')"), null);
});

test('jauge des jours restants : pas de pourcentage inventé sans date de début', () => {
  const a = app();
  const exp = iso(10);
  const legacy = a.ev(`accountFromApi({ type: 'VIP', username: 'alice', expiration: '${exp}' }, { expires_at: '${exp}', started_at: '' }, '')`);
  assert.equal(legacy.totalDays, null);
  a.ev(`renderAccountCard(accountFromApi({ type: 'VIP', username: 'alice', expiration: '${exp}' }, { expires_at: '${exp}', started_at: '' }, ''))`);
  assert.equal(a.ev("document.getElementById('accGaugePct').textContent"), '', 'aucun pourcentage');
  assert.match(a.ev("document.getElementById('accGaugeLabel').textContent"), /10|11/, 'les jours restants restent affichés');
  // avec une vraie date de début : pourcentage calculé sur la durée réelle
  const start = iso(-20);
  a.ev(`renderAccountCard(accountFromApi({ type: 'VIP', username: 'alice', expiration: '${exp}' }, { expires_at: '${exp}', started_at: '${start}' }, ''))`);
  const pct = a.ev("document.getElementById('accGaugePct').textContent");
  assert.match(pct, /^\d+%$/);
  assert.ok(Math.abs(parseInt(pct, 10) - 33) <= 4, 'environ 10 jours sur 30 : ' + pct);
  void iso0;
});

test('quota : jamais de consommation inventée (le panel ne la fournit pas)', () => {
  const a = app();
  const acc = a.ev("accountFromApi({ type: 'VIP', username: 'alice', quota_gb: 50 }, {}, '')");
  assert.equal(acc.quotaGB, 50);
  assert.equal(acc.quotaUsedGB, null);
});

test('session : durée lue de expires_in, jamais supposée', () => {
  const a = app();
  assert.equal(a.ev("sessionExpiryFrom({})"), null);
  assert.equal(a.ev("sessionExpiryFrom({ expires_in: 'x' })"), null);
  assert.equal(a.ev("sessionExpiryFrom({ expires_in: -5 })"), null);
  const t0 = Date.now();
  const ms = a.ev("sessionExpiryFrom({ expires_in: 3600 })");
  assert.ok(ms >= t0 + 3600000 && ms <= t0 + 3600000 + 2000);
  a.ev("authToken = 'x'; authExpiresAt = null");
  assert.equal(a.ev('sessionStillValid()'), true, 'durée inconnue : le panel reste juge (un 401 déconnecte)');
  a.ev('authExpiresAt = Date.now() - 1');
  assert.equal(a.ev('sessionStillValid()'), false);
  a.ev('authToken = null');
  assert.equal(a.ev('sessionStillValid()'), false);
});

test('déconnexion du compte : jeton et durée de session effacés, tunnel coupé', () => {
  const a = loadApp({ native: { engine: { integrated: true, protocols: ['tuic'] }, apiBase: 'https://panel.example.tld' } });
  a.signIn();
  a.ev("authExpiresAt = Date.now() + 1000000");
  a.ev("VPN.state = 'on'; VPN.session = { server: 'X', startedAt: Date.now() }");
  a.ev('Actions.logout()');
  assert.equal(a.ev('authToken'), null);
  assert.equal(a.ev('authExpiresAt'), null);
  assert.equal(a.calls.native.stopVpn.length, 1, 'un tunnel ne reste jamais actif sans compte');
});
