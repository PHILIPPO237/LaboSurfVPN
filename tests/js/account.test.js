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

const gone = (a, id) => a.ev(`document.getElementById('${id}').hidden`);
const txt = (a, id) => a.ev(`document.getElementById('${id}').textContent`);
const attr = (a, id, k) => a.ev(`document.getElementById('${id}').getAttribute('${k}')`);
const render = (a, me) => a.ev(`renderAccountCard(accountFromApi(${JSON.stringify(me)}, {}, ''))`);

test('validité : barre des jours seulement avec une vraie durée (date de début fournie par le panel)', () => {
  const a = app();
  const exp = iso(10);
  const legacy = a.ev(`accountFromApi({ type: 'VIP', username: 'alice', expiration: '${exp}' }, { expires_at: '${exp}', started_at: '' }, '')`);
  assert.equal(legacy.totalDays, null);
  a.ev(`renderAccountCard(accountFromApi({ type: 'VIP', username: 'alice', expiration: '${exp}' }, { expires_at: '${exp}', started_at: '' }, ''))`);
  assert.equal(gone(a, 'passDTrack'), true, 'pas de barre sans durée de référence');
  assert.match(txt(a, 'passDVal'), /^(10|11) jours$/, 'les jours restants restent affichés');
  assert.match(txt(a, 'passDNote'), /^expire le \d{2}\/\d{2}\/\d{4}$/);
  // avec une vraie date de début : pourcentage calculé sur la durée réelle
  const start = iso(-20);
  a.ev(`renderAccountCard(accountFromApi({ type: 'VIP', username: 'alice', expiration: '${exp}' }, { expires_at: '${exp}', started_at: '${start}' }, ''))`);
  assert.equal(gone(a, 'passDTrack'), false);
  const w = parseFloat(a.ev("document.getElementById('passDFill').style.width"));
  assert.ok(Math.abs(w - 33) <= 4, 'environ 10 jours sur 30 : ' + w);
  assert.equal(attr(a, 'passDTrack', 'role'), 'progressbar');
  void iso0;
});

test('validité : paliers de couleur, expiré, sans expiration', () => {
  const a = app();
  const days = (n, extra) => a.ev(`renderAccountCard(accountFromApi({ type: 'VIP', username: 'alice', expiration: '${iso(n)}' }, { expires_at: '${iso(n)}', started_at: '${iso(-30)}' }, ''))`);
  days(20); assert.equal(attr(a, 'passDays', 'data-lvl'), 'ok');
  days(5);  assert.equal(attr(a, 'passDays', 'data-lvl'), 'mid');
  days(1);  assert.equal(attr(a, 'passDays', 'data-lvl'), 'high');
  days(-3);
  assert.equal(txt(a, 'passDVal'), 'Expiré');
  assert.equal(attr(a, 'passDays', 'data-lvl'), 'high');
  assert.match(txt(a, 'passDNote'), /^a expiré le \d{2}\/\d{2}\/\d{4}$/);
  a.ev("renderAccountCard(accountFromApi({ type: 'ADMIN', username: 'root' }, {}, ''))");
  assert.equal(txt(a, 'passDVal'), 'Sans expiration', 'pas de date de fin : jamais « 0 jour »');
  assert.equal(gone(a, 'passDTrack'), true);
});

test('pass : néon renforcé pour les offres payantes, version sobre pour le gratuit', () => {
  const a = app();
  a.ev("renderAccountCard(accountFromApi({ type: 'VIP', username: 'alice' }, {}, ''))");
  assert.equal(attr(a, 'accGaugeCard', 'data-tier'), 'premium');
  assert.equal(attr(a, 'accGaugeCard', 'data-state'), 'ready');
  a.ev("renderAccountCard(accountFromApi({ type: 'Gratuit', username: 'bob' }, {}, ''))");
  assert.equal(attr(a, 'accGaugeCard', 'data-tier'), 'std');
});

test('données : consommation lue du panel (utilisé / quota, restant, barre = % utilisé), aucun calcul local', () => {
  const a = app();
  render(a, { type: 'VIP', username: 'alice', quota_gb: 10, usage_available: true, quota_used_gb: 4.2, usage_quota_gb: 10, remaining_gb: 5.8, usage_percent: 42 });
  assert.match(txt(a, 'passQVal'), /^4[.,]20? Go$/);
  assert.equal(txt(a, 'passQOf'), '/ 10 Go');
  assert.match(txt(a, 'passQNote'), /^5[.,]8\d* Go restants$/);
  assert.equal(attr(a, 'passQuota', 'data-lvl'), 'low');
  assert.equal(gone(a, 'passQTrack'), false);
  assert.equal(a.ev("document.getElementById('passQFill').style.width"), '42%');
  assert.equal(attr(a, 'passQTrack', 'aria-valuenow'), '42');
});

test('données : paliers faible / moyen / élevé / quota atteint (seulement si le panel le confirme)', () => {
  const a = app();
  const at = (pct, rem) => render(a, { type: 'VIP', username: 'alice', quota_gb: 10, usage_available: true, quota_used_gb: pct / 10, usage_quota_gb: 10, remaining_gb: rem, usage_percent: pct });
  at(49.9, 5.0);  assert.equal(attr(a, 'passQuota', 'data-lvl'), 'low');
  at(50, 5);      assert.equal(attr(a, 'passQuota', 'data-lvl'), 'mid');
  at(85, 1.5);    assert.equal(attr(a, 'passQuota', 'data-lvl'), 'high');
  at(99.9, 0.01); assert.notEqual(txt(a, 'passQNote'), 'Quota atteint', 'pas « atteint » avant 100 %');
  at(100, 0);
  assert.equal(txt(a, 'passQNote'), 'Quota atteint');
  assert.equal(attr(a, 'passQuota', 'data-lvl'), 'high');
});

test('données indisponibles : message clair, jamais 0 ni barre, même si des chiffres traînent', () => {
  const a = app();
  const acc = a.ev(`accountFromApi({ type: 'VIP', username: 'alice', quota_gb: 10, usage_available: false, usage_reason: 'engine_not_metered', quota_used_gb: 0, remaining_gb: 0, usage_percent: 0 }, {}, '')`);
  assert.equal(acc.quotaUsedGB, null);
  assert.equal(acc.remainingGB, null);
  assert.equal(acc.usagePercent, null);
  a.ev(`renderAccountCard(accountFromApi({ type: 'VIP', username: 'alice', quota_gb: 10, usage_available: false, usage_reason: 'engine_not_metered', quota_used_gb: 0, remaining_gb: 0, usage_percent: 0 }, {}, ''))`);
  assert.equal(txt(a, 'passQVal'), 'Indisponible');
  assert.equal(txt(a, 'passQNote'), 'Consommation indisponible pour le moment.');
  assert.equal(txt(a, 'passQOf'), 'quota : 10 Go', 'le quota réel reste affiché');
  assert.equal(gone(a, 'passQTrack'), true);
  assert.equal(attr(a, 'passQuota', 'data-lvl'), 'na');
});

test('données : ancien panel (sans les champs) ou compte sans quota ni mesure = indisponible, pas 0', () => {
  const a = app();
  render(a, { type: 'VIP', username: 'alice', quota_gb: 10 });
  assert.equal(txt(a, 'passQVal'), 'Indisponible');
  assert.equal(gone(a, 'passQTrack'), true);
  render(a, { type: 'ADMIN', username: 'root' });
  assert.equal(txt(a, 'passQVal'), 'Indisponible');
  assert.equal(txt(a, 'passQNote'), 'Consommation indisponible pour le moment.');
  assert.equal(txt(a, 'passQOf'), '');
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
  render(a, { type: 'VIP', username: 'alice', usage_available: true, quota_used_gb: 0.0064, usage_quota_gb: null, remaining_gb: null, usage_percent: null });
  assert.match(txt(a, 'passQVal'), /^6[.,]6 Mo$/);
});

test('données : mesure connue mais sans quota = consommation seule, sans barre', () => {
  const a = app();
  render(a, { type: 'VIP', username: 'alice', usage_available: true, quota_used_gb: 1.2, usage_quota_gb: null, remaining_gb: null, usage_percent: null });
  assert.match(txt(a, 'passQVal'), /^1[.,]2\d* Go$/);
  assert.equal(txt(a, 'passQOf'), 'sans quota');
  assert.equal(gone(a, 'passQTrack'), true);
});

test('données : 0 réellement mesuré = « 0 Ko » avec barre vide (ce n\'est PAS indisponible)', () => {
  const a = app();
  render(a, { type: 'VIP', username: 'alice', quota_gb: 10, usage_available: true, quota_used_gb: 0, usage_quota_gb: 10, remaining_gb: 10, usage_percent: 0 });
  assert.equal(txt(a, 'passQVal'), '0 Ko');
  assert.equal(gone(a, 'passQTrack'), false);
  assert.equal(a.ev("document.getElementById('passQFill').style.width"), '0%');
});

test('pass : textes traduits (fr / en), même contrat', () => {
  const a = app();
  render(a, { type: 'VIP', username: 'alice', quota_gb: 10, usage_available: true, quota_used_gb: 4.2, usage_quota_gb: 10, remaining_gb: 5.8, usage_percent: 42 });
  a.ev("I18N.set('en', false)");
  render(a, { type: 'VIP', username: 'alice', quota_gb: 10, usage_available: true, quota_used_gb: 4.2, usage_quota_gb: 10, remaining_gb: 5.8, usage_percent: 42 });
  assert.match(txt(a, 'passQNote'), / left$/);
  render(a, { type: 'ADMIN', username: 'root' });
  assert.equal(txt(a, 'passDVal'), 'No expiration');
  assert.equal(txt(a, 'passQVal'), 'Unavailable');
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
