'use strict';
// Profil structuré du panel (bloc `profile` de GET /api/user/me) : lecture stricte du contrat + affichage.
// L'application affiche ce que le panel décide ; elle n'accorde aucun droit et n'invente aucune valeur.
const test = require('node:test');
const assert = require('node:assert/strict');
const { ProfileContract } = require('../../app/src/main/assets/www/js/contract.js');
const { loadApp } = require('./harness.js');

const profile = (over) => Object.assign({
  version: 1, kind: 'vip', kind_label: 'VIP',
  role: { code: 'client', label: 'Utilisateur' }, offer: { code: 'premium', label: 'VIP', applies: true },
  status: { code: 'active', ok: true, expired_on: null, message: null },
  subscription: { applies: true, expires_at: '2100-01-01', days_remaining: 12, valid: true },
  reseller: { username: 'reseller' }, panel_access: { allowed: false, scope: 'none' },
  options: [
    { code: 'configs.basic', label: 'Configurations de base', group: 'common', visible: true, enabled: true, allowed: true, reason: null },
    { code: 'configs.advanced', label: 'Configurations avancées', group: 'vip', visible: true, enabled: false, allowed: false, reason: 'requires_vip' },
  ],
  permissions: ['configs.generate.basic'],
}, over || {});

test('ProfileContract : panel ancien (sans bloc profile) = absent, jamais un profil inventé', () => {
  assert.deepEqual(ProfileContract.parse({ username: 'a', type: 'VIP' }), { state: 'absent' });
  assert.deepEqual(ProfileContract.parse(null), { state: 'absent' });
});

test('ProfileContract : réponse hors contrat = invalid', () => {
  assert.equal(ProfileContract.parse({ profile: 'x' }).state, 'invalid');
  assert.equal(ProfileContract.parse({ profile: profile({ version: 2 }) }).state, 'invalid');
  assert.equal(ProfileContract.parse({ profile: profile({ kind: 'root' }) }).state, 'invalid');
  assert.equal(ProfileContract.parse({ profile: profile({ status: { code: 'weird', ok: true } }) }).state, 'invalid');
  assert.equal(ProfileContract.parse({ profile: profile({ options: 'oops' }) }).state, 'invalid');
  assert.equal(ProfileContract.parse({ profile: profile({ options: [{ label: 'sans code' }] }) }).state, 'invalid');
});

test('ProfileContract : profil valide, jours inconnus = null (jamais 0), droit lu tel que le panel le donne', () => {
  const r = ProfileContract.parse({ profile: profile() });
  assert.equal(r.state, 'ready');
  assert.equal(r.profile.kind, 'vip');
  assert.equal(r.profile.daysRemaining, 12);
  assert.equal(r.profile.options[1].allowed, false);
  assert.equal(r.profile.options[1].reason, 'requires_vip');
  assert.equal(r.profile.panelScope, 'none');
  const noDate = ProfileContract.parse({ profile: profile({ subscription: { applies: true, days_remaining: null } }) });
  assert.equal(noDate.profile.daysRemaining, null);
  const lying = ProfileContract.parse({ profile: profile({ options: [{ code: 'x', allowed: 'yes' }] }) });
  assert.equal(lying.profile.options[0].allowed, false, 'seul true (booléen) autorise');
});

const app = () => loadApp({ native: { engine: { integrated: false, protocols: [] }, apiBase: 'https://panel.example.tld' } });
const attr = (a, id, k) => a.ev(`document.getElementById('${id}').getAttribute('${k}')`);
const txt = (a, id) => a.ev(`document.getElementById('${id}').textContent`);
const hidden = (a, id) => a.ev(`document.getElementById('${id}').hidden`);

const st = (a) => a.ev("document.getElementById('accViewProfile').getAttribute('data-state')");

test("ProfileContract.failure : une panne n'est jamais un statut de compte", () => {
  assert.deepEqual(ProfileContract.failure({ status: 0 }), { state: 'network' });
  assert.deepEqual(ProfileContract.failure({ status: 503 }), { state: 'down' });
  assert.deepEqual(ProfileContract.failure({ status: 404 }), { state: 'unavailable' });
  assert.deepEqual(ProfileContract.failure(null), { state: 'network' });
});

test('écran Mon profil : profil suspendu = statut et message du panel, identité du profil', () => {
  const a = app();
  const p = profile({ kind: 'free', kind_label: 'Gratuit', offer: { code: 'free', label: 'Gratuit', applies: true },
    status: { code: 'suspended', ok: false, expired_on: null, message: 'Ton compte est suspendu.' } });
  a.ev(`renderProfileView(ProfileContract.parse({ profile: ${JSON.stringify(p)} }))`);
  assert.equal(st(a), 'ready');
  assert.equal(attr(a, 'accViewProfile', 'data-kind'), 'free');
  assert.equal(attr(a, 'accViewProfile', 'data-st'), 'suspended');
  assert.equal(txt(a, 'profStatus'), 'Suspendu');
  assert.equal(txt(a, 'profMessage'), 'Ton compte est suspendu.');
  assert.equal(hidden(a, 'profBody'), false);
});

test('écran Mon profil : chaque profil porte son identité (data-kind), sans rapport avec les droits', () => {
  const a = app();
  for(const kind of ['free', 'vip', 'reseller', 'admin', 'super_admin']){
    a.ev(`renderProfileView(ProfileContract.parse({ profile: ${JSON.stringify(profile({ kind: kind }))} }))`);
    assert.equal(attr(a, 'accViewProfile', 'data-kind'), kind);
  }
});

test("écran Mon profil : chargement, erreur réseau et panel indisponible n'affichent aucune donnée", () => {
  const a = app();
  a.ev("renderProfileView({ state: 'loading' })");
  assert.equal(st(a), 'loading');
  a.ev("Account.profileReady = false; renderProfileView({ state: 'network' })");
  assert.equal(st(a), 'error');
  assert.equal(hidden(a, 'profBody'), true);
  assert.equal(hidden(a, 'profStateCard'), false);
  assert.equal(hidden(a, 'profRetry'), false);
  assert.equal(txt(a, 'profStateTitle'), 'Connexion impossible');
  a.ev("Account.profileReady = false; renderProfileView({ state: 'down' })");
  assert.equal(txt(a, 'profStateTitle'), 'Panel temporairement indisponible');
});

test('écran Mon profil : réponse illisible ou panel ancien = message, pas de bouton réessayer', () => {
  const a = app();
  a.ev("Account.profileReady = false; renderProfileView({ state: 'invalid' })");
  assert.equal(hidden(a, 'profStateCard'), false);
  assert.equal(hidden(a, 'profRetry'), true);
  a.ev("Account.profileReady = false; renderProfileView({ state: 'absent' })");
  assert.match(txt(a, 'profStateMsg'), /pas encore/);
});

test('écran Mon profil : un échec de rafraîchissement garde la dernière version connue, signalée', () => {
  const a = app();
  a.ev(`renderProfileView(ProfileContract.parse({ profile: ${JSON.stringify(profile())} }))`);
  a.ev("renderProfileView({ state: 'network' })");
  assert.equal(st(a), 'ready');
  assert.equal(hidden(a, 'profNotice'), false);
  assert.match(txt(a, 'profNotice'), /dernière version connue/);
});

test('hors connexion : le dernier profil connu est affiché avec sa date, jamais comme une donnée à jour', () => {
  const a = app();
  a.ev(`ProfileCache.save({ username: 'alice', profile: ${JSON.stringify(profile())} })`);
  a.ev("Account.profileReady = false; profileFallback({ state: 'network' })");
  assert.equal(st(a), 'ready');
  assert.equal(hidden(a, 'profNotice'), false);
  assert.match(txt(a, 'profNotice'), /Hors connexion/);
  assert.equal(a.ev('Account.profileReady'), false, 'une copie enregistrée n\'est pas un profil à jour');
  assert.equal(txt(a, 'profName'), 'alice');
});

test('hors connexion sans copie : état explicite, aucune donnée ; déconnexion = copie effacée', () => {
  const a = app();
  a.ev("Account.profileReady = false; profileFallback({ state: 'network' })");
  assert.equal(st(a), 'error');
  assert.equal(hidden(a, 'profBody'), true);
  a.ev(`ProfileCache.save({ username: 'alice', profile: ${JSON.stringify(profile())} })`);
  assert.notEqual(a.ev('ProfileCache.load()'), null);
  a.ev('ProfileCache.clear()');
  assert.equal(a.ev('ProfileCache.load()'), null);
});
