'use strict';
// Visualisations de la refonte : elles ne dessinent QUE des mesures réelles (aucun pourcentage ni débit inventé).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

const app = () => loadApp({ native: { engine: { integrated: false, protocols: [] }, apiBase: 'https://panel.example.tld' } });

test('courbe du débit : moins de deux mesures = rien à dessiner', () => {
  const a = app();
  assert.equal(a.ev('trafficSparkPaths([], 200, 44)'), null);
  assert.equal(a.ev('trafficSparkPaths([{ rx: 10, tx: 5 }], 200, 44)'), null);
  assert.equal(a.ev('trafficSparkPaths(null, 200, 44)'), null);
});

test('courbe du débit : une échelle commune, le point le plus haut touche le haut du cadre', () => {
  const a = app();
  const p = a.ev('trafficSparkPaths([{ rx: 0, tx: 0 }, { rx: 100, tx: 50 }], 200, 44)');
  assert.equal(p.max, 100);
  assert.equal(p.rx, 'M0.0 42.0 L200.0 2.0');
  assert.equal(p.tx, 'M0.0 42.0 L200.0 22.0');
});

test('courbe du débit : seuls les débits réellement mesurés entrent dans l\'historique, borné', () => {
  const a = app();
  a.ev("VPN.state = 'on'; resetStats()");
  a.ev('onNativeVpnStats(1000, 500, 20, 10)');
  a.ev('onNativeVpnStats(2000, 900, null, 12)');   // débit absent : la mesure n'est pas ajoutée à la courbe
  assert.equal(a.ev('VPN.trafficHistory.length'), 1);
  for(let i = 0; i < 60; i++) a.ev(`onNativeVpnStats(${3000 + i}, 1000, ${i}, ${i})`);
  assert.equal(a.ev('VPN.trafficHistory.length'), a.ev('TRAFFIC_HISTORY_MAX'));
  a.ev('resetStats()');
  assert.equal(a.ev('VPN.trafficHistory.length'), 0, 'nouvelle session : la courbe repart de zéro');
});

const profile = (sub, over) => Object.assign({
  version: 1, kind: 'vip', kind_label: 'VIP', role: { code: 'client', label: 'Utilisateur' }, offer: { code: 'premium', label: 'VIP', applies: true },
  status: { code: 'active', ok: true, message: null }, subscription: sub, reseller: null, panel_access: { allowed: false, scope: 'none' }, options: [], permissions: [],
}, over || {});
const hidden = (a, id) => a.ev(`document.getElementById('${id}').getAttribute('hidden') !== null`);   // <svg> : attribut hidden

test('jauge de validité : affichée seulement avec la durée totale réelle, pourcentage = jours restants / durée', () => {
  const a = app();
  a.ev("Account.last = { username: 'u', avatar: '', totalDays: 30 }");
  a.ev(`renderProfileView(ProfileContract.parse({ profile: ${JSON.stringify(profile({ applies: true, expires_at: '2100-01-01', days_remaining: 15 }))} }))`);
  assert.equal(hidden(a, 'profRing'), false);
  assert.equal(a.ev("document.getElementById('profRingVal').getAttribute('stroke-dasharray')"), '50.0 100');
});

test('jauge de validité : durée inconnue, jours inconnus ou abonnement sans objet = aucune jauge', () => {
  const a = app();
  a.ev("Account.last = { username: 'u', avatar: '', totalDays: null }");
  a.ev(`renderProfileView(ProfileContract.parse({ profile: ${JSON.stringify(profile({ applies: true, days_remaining: 15 }))} }))`);
  assert.equal(hidden(a, 'profRing'), true, 'pas de durée totale : pas de pourcentage');
  a.ev("Account.last = { username: 'u', avatar: '', totalDays: 30 }");
  a.ev(`renderProfileView(ProfileContract.parse({ profile: ${JSON.stringify(profile({ applies: true, days_remaining: null }))} }))`);
  assert.equal(hidden(a, 'profRing'), true, 'jours restants inconnus');
  a.ev(`renderProfileView(ProfileContract.parse({ profile: ${JSON.stringify(profile({ applies: false }))} }))`);
  assert.equal(hidden(a, 'profRing'), true, 'administrateur : pas d\'abonnement');
});

test("courbe du débit : affichée par l'attribut hidden (un <svg> n'a pas de propriété .hidden)", () => {
  const a = app();
  a.ev("VPN.state = 'on'; resetStats()");
  a.ev('onNativeVpnStats(100, 50, 10, 5)');
  assert.notEqual(a.ev("document.getElementById('trafficSpark').getAttribute('hidden')"), null, 'une seule mesure : masquée');
  a.ev('onNativeVpnStats(200, 90, 20, 8)');
  assert.equal(a.ev("document.getElementById('trafficSpark').getAttribute('hidden')"), null, 'deux mesures : affichée');
});
