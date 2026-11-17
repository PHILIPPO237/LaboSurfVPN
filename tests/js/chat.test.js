'use strict';
// Messagerie privée : elle s'ouvre désormais sur la page autonome community.html#dm.
// Plus d'écran Chat interne ni de variable messagesAvailable : le contrat est l'ouverture de la page web.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('./harness.js');

const WWW = path.join(__dirname, '..', '..', 'app', 'src', 'main', 'assets', 'www');
const empty = () => ({ ok: true, status: 200, expired: false, data: { status: 'ok', messages: [], notifications: [] } });
const app = () => loadApp({ native: { engine: { integrated: false, protocols: [] }, apiBase: 'https://panel.example.tld' }, respond: empty });

test('messagerie : le bouton du compte ouvre la page autonome community.html#dm', () => {
  const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
  assert.match(html, /data-action="openPage" data-page="community#dm"/);
  const src = fs.readFileSync(path.join(WWW, 'js', 'account.js'), 'utf8');
  assert.match(src, /Actions\.openSupport = \(\) => openPage\('community\.html#dm'\)/);
  const community = fs.readFileSync(path.join(WWW, 'community.html'), 'utf8');
  assert.match(community, /\^dm\(\?:=\(\\d\+\)\)\?\$/);
});

// Le harnais remplace showScreen() par une fonction vide : la navigation est donc vérifiée sur le code source réel (app.js / account.js)
const SRC = (f) => fs.readFileSync(path.join(WWW, 'js', f), 'utf8');

test('navigation : aucun écran Chat interne, openPage conserve le hash #dm', () => {
  const src = SRC('app.js');
  assert.doesNotMatch(src, /const SCREENS = \[[^\]]*'chat'/);
  assert.doesNotMatch(src, /const RAIL_ORDER = \[[^\]]*'chat'/);
  assert.match(src, /community: 'community\.html'/);
  assert.match(src, /const cut = raw\.indexOf\('#'\)/);
  assert.match(src, /location\.href = url \+ hash/);
});

test('compte : les messages ne sont pas marqués comme lus à l’ouverture du compte', () => {
  const src = SRC('account.js');
  assert.match(src, /loadAppMessages\(true\); loadAnnouncements\(false\)/);
  assert.doesNotMatch(src, /showScreen\('chat'\)/);
  assert.doesNotMatch(src, /messagesAvailable/);
});

test('déconnexion : la session miroir est effacée sans écran Chat à refermer', () => {
  const a = app();
  a.signIn();
  a.ev('resetToLoggedOut()');
  assert.equal(a.ev('authToken'), null);
  assert.doesNotMatch(SRC('account.js'), /currentScreen === 'chat'/);
});

test('messages : heure et jour RÉELS ; sans date lisible, aucun séparateur ni heure inventée', () => {
  const a = app();
  // Jours ancrés sur le CALENDRIER (hier / aujourd'hui) : un décalage en heures échoue après minuit,
  // « il y a 30 h » tombant sur avant-hier entre 00h et 06h (échec aléatoire constaté en CI la nuit).
  const at = (dayOffset, h, min, role, body) => {
    const d = new Date(Date.now());
    d.setDate(d.getDate() + dayOffset);
    d.setHours(h, min, 0, 0);
    return { sender_role: role, body, created_at: d.toISOString() };
  };
  a.ev(`renderAppMessages(${JSON.stringify([at(-1, 14, 30, 'admin', 'Bonjour'), at(-1, 15, 10, 'client', 'Merci'), at(0, 9, 5, 'client', 'Re')])})`);
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

test('structure : plus de vue Chat interne, le bouton du compte ouvre community.html#dm', () => {
  const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /id="railBtn-chat"/);
  assert.doesNotMatch(html, /id="chatBadge"/);
  assert.doesNotMatch(html, /id="screen-chat"/);
  assert.doesNotMatch(html, /id="screen-livechat"/);
  assert.doesNotMatch(html, /data-action="nav" data-screen="chat"/);
  assert.match(html, /data-action="openPage" data-page="community#dm"/);
  assert.doesNotMatch(html, /accViewMessages/);
  assert.doesNotMatch(html, /data-action="accOpen" data-view="messages"/);
});

test('textes : Chat en français et en anglais', () => {
  const a = app();
  assert.equal(a.ev("t('nav.chat')"), 'Chat');
  assert.equal(a.ev("t('chat.yesterday')"), 'Hier');
  a.ev("I18N.set('en', false)");
  assert.equal(a.ev("t('chat.yesterday')"), 'Yesterday');
  assert.equal(a.ev("t('chat.sub')"), 'Talk to your manager');
});

test('l’assistant envoie « support » vers la messagerie privée autonome', () => {
  const src = fs.readFileSync(path.join(WWW, 'js', 'assistant.js'), 'utf8');
  assert.match(src, /id: 'support', go: \{ page: 'community#dm' \}/);
  assert.match(src, /if\(g\.page\)\{ openPage\(g\.page\); return; \}/);
});
