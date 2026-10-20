'use strict';
// Retour haptique : un seul mécanisme (Haptics), une vibration par interaction, rien hors de l'application Android,
// et sur la connexion uniquement le RÉSULTAT réel (connecté / erreur), jamais l'animation « connexion en cours ».
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

const app = () => loadApp({ native: { engine: { integrated: false, protocols: [] }, apiBase: 'https://panel.example.tld' } });
const spy = (a) => a.ev("window.__h = []; LaboSurfNative.haptic = (k) => window.__h.push(k); window.__h");

test('haptique : appel natif avec le bon type, et deux appels rapprochés n\'en font qu\'un', () => {
  const a = app();
  spy(a);
  a.ev("Haptics.tap('press'); Haptics.tap('tick')");
  assert.equal(a.ev('JSON.stringify(window.__h)'), '["press"]');
});

test('haptique : sans pont natif (navigateur), aucune erreur et aucun appel', () => {
  const a = loadApp({ native: null });
  assert.doesNotThrow(() => a.ev("Haptics.tap('tick')"));
});

test('haptique : type selon l\'action (connexion plus marquée, choix de serveur confirmé, le reste discret)', () => {
  const a = app();
  assert.equal(a.ev("Haptics.forAction('togglePower')"), 'press');
  assert.equal(a.ev("Haptics.forAction('selectServer')"), 'confirm');
  assert.equal(a.ev("Haptics.forAction('selectProfile')"), 'confirm');
  assert.equal(a.ev("Haptics.forAction('nav')"), 'tick');
  assert.equal(a.ev("Haptics.forAction('openCommunity')"), 'tick');
});

test('haptique : seulement le résultat réel de la connexion (rien pendant « connexion en cours »)', () => {
  const a = app();
  spy(a);
  a.ev("setVpnState('connecting')");
  assert.equal(a.ev('JSON.stringify(window.__h)'), '[]');
  a.ev("setVpnState('on')");
  assert.equal(a.ev('JSON.stringify(window.__h)'), '["confirm"]');
});
