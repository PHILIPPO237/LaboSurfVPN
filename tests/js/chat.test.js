'use strict';
// Chat : écran dédié, bouton dans le rail réservé aux abonnés, affichage des messages (heures réelles, séparateurs de jour).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('./harness.js');

const WWW = path.join(__dirname, '..', '..', 'app', 'src', 'main', 'assets', 'www');
const empty = () => ({ ok: true, status: 200, expired: false, data: { status: 'ok', messages: [], notifications: [] } });
const app = () => loadApp({ native: { engine: { integrated: false, protocols: [] }, apiBase: 'https://panel.example.tld' }, respond: empty });
const iso = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const render = (a, me, sub) => a.ev(`renderAccountCard(accountFromApi(${JSON.stringify(me)}, ${JSON.stringify(sub || {})}, ''))`);
const railHidden = (a) => a.ev("document.getElementById('railBtn-chat').hidden");

test('rail : le bouton Chat n\'apparaît que pour un abonné (offre payante non expirée)', () => {
  const a = app();
  render(a, { type: 'VIP', username: 'a', expiration: iso(12) });
  assert.equal(railHidden(a), false, 'VIP actif : visible');
  render(a, { type: 'Gratuit', username: 'b' });
  assert.equal(railHidden(a), true, 'gratuit : caché');
  render(a, { type: 'VIP', username: 'c', expiration: iso(-3) });
  assert.equal(railHidden(a), true, 'VIP expiré : caché');
  render(a, { type: 'ADMIN', username: 'root', role_code: 'admin' });
  assert.equal(railHidden(a), false, 'admin sans expiration : visible');
});

// Le harnais remplace showScreen() par une fonction vide : la navigation est donc vérifiée sur le code source réel (app.js / account.js)
const SRC = (f) => fs.readFileSync(path.join(WWW, 'js', f), 'utf8');

test("écran Chat : sans compte on arrive sur la connexion ; avec compte on l'ouvre et on charge les messages", () => {
  const src = SRC('app.js');
  assert.match(src, /if\(name === 'chat' && !authToken\) name = 'account';/);
  assert.match(src, /if\(name === 'chat'\)\{ loadAppMessages\(\); loadAnnouncements\(true\); \}/);
  assert.match(src, /const SCREENS = \[[^\]]*'chat'/);
  assert.match(src, /const RAIL_ORDER = \['home', 'services', 'account', 'chat'/);
});

test('un compte qui cesse d'être abonné perd le bouton et est renvoyé du Chat vers le profil', () => {
  const a = app();
  render(a, { type: 'VIP', username: 'a', expiration: iso(12) });
  assert.equal(railHidden(a), false);
  render(a, { type: 'Gratuit', username: 'a' });
  assert.equal(railHidden(a), true);
  assert.match(SRC('account.js'), /if\(!sub && currentScreen === 'chat' && acc\) showScreen\('account'\);/);
});

test('déconnexion du compte : le bouton Chat disparaît', () => {
  const a = app();
  a.signIn();
  render(a, { type: 'VIP', username: 'a', expiration: iso(12) });
  assert.equal(railHidden(a), false);
  a.ev('resetToLoggedOut()');
  assert.equal(railHidden(a), true);
});

test('messages : heure et jour RÉELS ; sans date lisible, aucun séparateur ni heure inventée', () => {
  const a = app();
  const now = Date.now();
  const m = (h, role, body) => ({ sender_role: role, body, created_at: new Date(now - h * 3600e3).toISOString() });
  a.ev(`renderAppMessages(${JSON.stringify([m(30, 'admin', 'Bonjour'), m(29, 'client', 'Merci'), m(0.1, 'client', 'Re')])})`);
  const html = a.ev("document.getElementById('messagesThread').innerHTML");
  assert.equal((html.match(/class="chat-day"/g) || []).length >= 2, true, 'Hier et Aujourd\'hui');
  assert.match(html, /Hier/);
  assert.match(html, /Aujourd(&#39;|')hui/);
  assert.match(html, /\d{2}:\d{2}/);
  a.ev(`renderAppMessages(${JSON.stringify([{ sender_role: 'admin', body: 'sans date' }])})`);
  const bare = a.ev("document.getElementById('messagesThread').innerHTML");
  assert.doesNotMatch(bare, /chat-day/);
  assert.doesNotMatch(bare, /\d{2}:\d{2}/);
  assert.doesNotMatch(bare, /NaN|undefined|Invalid/);
});

test('annonces : repliées par défaut, le bouton les déplie et le dit (aria-expanded)', () => {
  const a = app();
  const el = "document.getElementById('announcementsList')";
  a.ev(el + '.hidden = true');   // état initial du HTML : repliées
  const btn = { dataset: {}, expanded: null, setAttribute(k, v) { if (k === 'aria-expanded') this.expanded = v; } };
  a.ctx.__btn = btn;
  a.ev('Actions.toggleAnnouncements(__btn)');
  assert.equal(btn.expanded, 'true');
  assert.equal(a.ev(el + '.hidden'), false);
  a.ev('Actions.toggleAnnouncements(__btn)');
  assert.equal(btn.expanded, 'false');
});

test('structure : le chat est un écran du rail (bouton caché par défaut), le profil y mène, l\'ancienne sous-vue a disparu', () => {
  const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
  assert.match(html, /<button class="rail-btn" type="button" id="railBtn-chat" data-action="nav" data-screen="chat" hidden/);
  assert.match(html, /<section class="screen" id="screen-chat"/);
  assert.match(html, /<button class="row" type="button" data-action="nav" data-screen="chat">/);
  assert.doesNotMatch(html, /accViewMessages/);
  assert.doesNotMatch(html, /data-action="accOpen" data-view="messages"/);
  for (const id of ['messagesThread', 'msgComposerInput', 'msgAttachInput', 'chatBadge', 'messagesCardBadge', 'announcementsList']) {
    assert.equal((html.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, id);
  }
});

test('textes : Chat en français et en anglais', () => {
  const a = app();
  assert.equal(a.ev("t('nav.chat')"), 'Chat');
  assert.equal(a.ev("t('chat.yesterday')"), 'Hier');
  a.ev("I18N.set('en', false)");
  assert.equal(a.ev("t('chat.yesterday')"), 'Yesterday');
  assert.equal(a.ev("t('chat.sub')"), 'Talk to your manager');
});

test('l\'assistant envoie « support » vers l\'écran Chat', () => {
  const src = fs.readFileSync(path.join(WWW, 'js', 'assistant.js'), 'utf8');
  assert.match(src, /id: 'support', go: \{ screen: 'chat' \}/);
});
