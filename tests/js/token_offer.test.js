'use strict';
// Offre de token (message de l'administrateur) : bouton ACTIVER -> l'API décide ; l'application ne valide rien seule.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

const app = (respond) => loadApp({ native: { engine: { integrated: false, protocols: [] }, apiBase: 'https://panel.example.tld' }, respond });
const thread = (a) => a.ev("document.getElementById('messagesThread').innerHTML");
const OFFER = { id: 5, sender_role: 'admin', message_type: 'token_offer', attachment_filename: 'token:12', attachment_data: '',
  body: '🎟️ NOUVEAU TOKEN\nAbonnement : VIP\nDurée : 30 jours\nQuota : 20 Go (indicatif)\nAppareils autorisés : 2\nToken : LABOSURF-…WXYZ' };

test('un message « token_offer » affiche le bouton ACTIVER avec l\'identifiant de l\'offre, jamais la valeur du token', () => {
  const a = app();
  a.ev(`renderAppMessages(${JSON.stringify([OFFER])})`);
  const html = thread(a);
  assert.match(html, /data-action="activateOffer" data-offer="12"/);
  assert.match(html, /NOUVEAU TOKEN/);
  assert.match(html, /class="bubble token-offer"/);
  assert.ok(!/LABOSURF-[A-Z2-7]{40}/.test(html), 'aucune valeur complète de token dans l\'interface');
});

test('les autres messages n\'ont pas de bouton ; un identifiant falsifié n\'en crée pas', () => {
  const a = app();
  const msgs = [
    { id: 1, sender_role: 'admin', message_type: 'text', body: 'Bonjour', attachment_filename: 'token:12' },       // mauvais type
    { id: 2, sender_role: 'admin', message_type: 'token_offer', body: 'x', attachment_filename: 'token:12"><img src=x onerror=alert(1)>' },
    { id: 3, sender_role: 'admin', message_type: 'token_offer', body: 'x', attachment_filename: 'token:abc' },
    { id: 4, sender_role: 'admin', message_type: 'token_offer', body: 'x', attachment_filename: 'autre:12' },
  ];
  a.ev(`renderAppMessages(${JSON.stringify(msgs)})`);
  const html = thread(a);
  assert.ok(!html.includes('activateOffer'), html);
  assert.ok(!html.includes('<img src=x'), 'rien d\'injecté');
});

test('ACTIVER appelle l\'API (POST /api/user/tokens/{id}/activate) puis recharge le compte et les messages', async () => {
  const a = app(async () => ({ ok: true, status: 200, data: { status: 'ok', code: 'activated', message: 'Token activé. Abonnement VIP valide jusqu\'au 2026-11-02.' } }));
  a.signIn();
  a.ev("globalThis.__reload = []; loadAndShowAccount = async function(){ __reload.push('compte'); }; loadAppMessages = async function(){ __reload.push('messages'); }");
  await a.ev("Actions.activateOffer({ dataset: { offer: '12' }, classList: { contains(){ return false; }, toggle(){} }, setAttribute(){}, removeAttribute(){}, children: [1] })");
  assert.deepEqual(a.calls.apiFetch.map((c) => [c.path, c.options.method]), [['/api/user/tokens/12/activate', 'POST']]);
  assert.equal(a.calls.toasts.at(-1).type, 'success');
  assert.match(a.calls.toasts.at(-1).m, /Token activé/);
  assert.equal(a.ev('JSON.stringify(__reload)'), '["compte","messages"]');   // (tableau d'un autre contexte : comparaison par JSON)
});

test('refus du serveur : son message est affiché tel quel, rien n\'est activé localement', async () => {
  const a = app(async () => ({ ok: false, status: 403, data: { status: 'error', code: 'not_owner', message: 'Ce token est réservé à un autre compte.' } }));
  a.signIn();
  a.ev("globalThis.__reload = []; loadAndShowAccount = async function(){ __reload.push('compte'); }");
  await a.ev("Actions.activateOffer({ dataset: { offer: '12' }, classList: { contains(){ return false; }, toggle(){} }, setAttribute(){}, removeAttribute(){}, children: [1] })");
  const last = a.calls.toasts.at(-1);
  assert.equal(last.type, 'error');
  assert.equal(last.m, 'Ce token est réservé à un autre compte.');
  assert.equal(a.ev('JSON.stringify(__reload)'), '[]', 'aucun rechargement de compte : rien n\'a changé');
});

test('identifiant d\'offre invalide ou session absente : aucun appel réseau', async () => {
  const a = app(async () => ({ ok: true, data: { status: 'ok' } }));
  const el = (offer) => `{ dataset: { offer: ${JSON.stringify(offer)} }, classList: { contains(){ return false; }, toggle(){} }, setAttribute(){}, removeAttribute(){}, children: [1] }`;
  await a.ev(`Actions.activateOffer(${el('12')})`);          // pas de session
  a.signIn();
  await a.ev(`Actions.activateOffer(${el('12/../../admin')})`);
  await a.ev(`Actions.activateOffer(${el('')})`);
  assert.equal(a.calls.apiFetch.length, 0);
});

test('l\'activation par saisie accepte un token LABOSURF- tel quel (le serveur décide) et affiche ses refus', async () => {
  const a = app(async (p, o) => ({ ok: false, status: 409, data: { status: 'error', code: 'devices_exceeded', message: 'Le nombre maximal d\'appareils pour ce token est atteint.' } }));
  a.signIn();
  a.ev("document.getElementById('activationKeyInput').value = ' labosurf-abcdefghijklmnopqrstuvwxyz234567abcdefgh '");
  await a.ev('Actions.activateKey()');
  const sent = JSON.parse(a.calls.apiFetch[0].options.body);
  assert.equal(a.calls.apiFetch[0].path, '/api/user/activate');
  assert.equal(sent.key, 'LABOSURF-ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGH');
  assert.match(a.ev("document.getElementById('activationError').textContent"), /nombre maximal d'appareils/);
});
