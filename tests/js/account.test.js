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

const gone = (a, id) => a.ev(`document.getElementById('${id}').hidden`);
const txt = (a, id) => a.ev(`document.getElementById('${id}').textContent`);

test('consommation : lue du panel, jauge = restant, aucun calcul local', () => {
  const a = app();
  a.ev(`renderAccountCard(accountFromApi({ type: 'VIP', username: 'alice', quota_gb: 10, usage_available: true, quota_used_gb: 2.5, usage_quota_gb: 10, remaining_gb: 7.5, usage_percent: 25 }, {}, ''))`);
  assert.equal(gone(a, 'quotaGauge'), false);
  assert.equal(gone(a, 'quotaUnavailable'), true);
  assert.equal(txt(a, 'accQuotaPct'), '75%');
  assert.match(txt(a, 'accQuotaLabel'), /7[.,]5/);
});

test('consommation indisponible : message clair, jamais 0 ni jauge, même si des chiffres traînent', () => {
  const a = app();
  const acc = a.ev(`accountFromApi({ type: 'VIP', username: 'alice', quota_gb: 10, usage_available: false, usage_reason: 'engine_not_metered', quota_used_gb: 0, remaining_gb: 0, usage_percent: 0 }, {}, '')`);
  assert.equal(acc.quotaUsedGB, null);
  assert.equal(acc.remainingGB, null);
  assert.equal(acc.usagePercent, null);
  a.ev(`renderAccountCard(accountFromApi({ type: 'VIP', username: 'alice', quota_gb: 10, usage_available: false, usage_reason: 'engine_not_metered' }, {}, ''))`);
  assert.equal(gone(a, 'quotaGauge'), true);
  assert.equal(gone(a, 'quotaUnavailable'), false);
  assert.equal(gone(a, 'quotaPlain'), false, 'le quota reste affiché');
});

test('consommation : ancien panel (sans les champs) = indisponible, pas 0', () => {
  const a = app();
  a.ev(`renderAccountCard(accountFromApi({ type: 'VIP', username: 'alice', quota_gb: 10 }, {}, ''))`);
  assert.equal(gone(a, 'quotaGauge'), true);
  assert.equal(gone(a, 'quotaUnavailable'), false);
});

test('consommation : unité adaptée, jamais « 0.0 Go » pour une vraie mesure de quelques Mo', () => {
  const a = app();
  assert.equal(a.ev('fmtUsage(0.0064)'), '6.6 Mo');
  assert.equal(a.ev('fmtUsage(0)'), '0 Ko');
  assert.equal(a.ev('fmtUsage(0.0000005)'), '1 Ko');
  assert.equal(a.ev('fmtUsage(0.5)'), '512 Mo');
  assert.equal(a.ev('fmtUsage(1.234)'), '1.23 Go');
  assert.equal(a.ev('fmtUsage(2)'), '2 Go');
  assert.equal(a.ev('fmtUsage(null)'), '');
  assert.equal(a.ev('fmtUsage(-1)'), '');
  a.ev(`renderAccountCard(accountFromApi({ type: 'VIP', username: 'alice', usage_available: true, quota_used_gb: 0.0064, usage_quota_gb: null, remaining_gb: null, usage_percent: null }, {}, ''))`);
  assert.match(txt(a, 'quotaPlainValue'), /6[.,]6 Mo/);
  assert.equal(a.ev("document.getElementById('quotaPlainKey').textContent"), 'Consommation');
});

test('consommation mesurée mais quota illimité : consommation seule, sans jauge', () => {
  const a = app();
  a.ev(`renderAccountCard(accountFromApi({ type: 'VIP', username: 'alice', usage_available: true, quota_used_gb: 1.2, usage_quota_gb: null, remaining_gb: null, usage_percent: null }, {}, ''))`);
  assert.equal(gone(a, 'quotaGauge'), true);
  assert.equal(gone(a, 'quotaPlain'), false);
  assert.match(txt(a, 'quotaPlainValue'), /1[.,]2/);
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

test('rôle et offre : lus séparément depuis le panel, jamais déduits l\'un de l\'autre', () => {
  const a = app();
  const ro = (me) => JSON.parse(a.ev(`JSON.stringify(roleAndOffer(${JSON.stringify(me)}))`));
  assert.deepEqual(ro({ role: 'client', offer: 'premium', type: 'VIP' }), { role: 'client', offer: 'premium', plan: 'vip' });
  assert.deepEqual(ro({ role: 'client', offer: 'free', type: 'Gratuit' }), { role: 'client', offer: 'free', plan: 'gratuit' });
  // un super administrateur garde son offre propre ; le badge affiche le rôle
  assert.deepEqual(ro({ role: 'super_admin', offer: 'free', type: 'ADMIN' }), { role: 'super_admin', offer: 'free', plan: 'admin' });
  assert.deepEqual(ro({ role: 'reseller', offer: 'premium', type: 'REVENDEUR' }), { role: 'reseller', offer: 'premium', plan: 'revendeur' });
  // panel ancien (sans role/offer) : repli sur « type »
  assert.deepEqual(ro({ type: 'VIP' }), { role: 'client', offer: 'premium', plan: 'vip' });
  assert.deepEqual(ro({ type: 'ADMIN' }), { role: 'admin', offer: 'free', plan: 'admin' });
  // valeurs inconnues : jamais de rôle inventé
  assert.equal(ro({ role: 'dieu', offer: 'or', type: 'Gratuit' }).role, 'client');
});

test('espace revendeur : visible selon le RÔLE donné par le panel', () => {
  const a = app();
  const row = (me) => { a.ev(`renderAccountCard(accountFromApi(${JSON.stringify(me)}, {}, ''))`); return a.ev("document.getElementById('accResellerRow').hidden"); };
  assert.equal(row({ username: 'u', role: 'client', offer: 'premium' }), true, 'un VIP n\'est pas revendeur');
  assert.equal(row({ username: 'u', role: 'reseller', offer: 'free' }), false);
  assert.equal(row({ username: 'u', role: 'super_admin', offer: 'free' }), false);
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
