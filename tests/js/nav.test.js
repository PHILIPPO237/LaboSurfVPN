'use strict';
// Navigation : le rail latéral n'appartient qu'à l'écran PRINCIPAL (accueil) ; ailleurs il disparaît complètement,
// l'écran secondaire récupère toute la largeur (marges harmonieuses, jamais collées aux bords) et chaque page
// secondaire possède son bouton Retour. Aucune barre de remplacement n'est créée ; les routes restent inchangées.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { WWW } = require('./harness.js');

const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
const css = (f) => fs.readFileSync(path.join(WWW, 'css', f), 'utf8');

test('rail : un seul rail, masqué en CSS hors de l\'accueil, la goutte réservée libérée, aucune barre basse de remplacement', () => {
  assert.equal((html.match(/<nav class="rail"/g) || []).length, 1, 'un seul rail : pas de copie par écran');
  const base = css('base.css');
  assert.match(base, /:root:not\(\[data-screen="home"\]\) \.rail\{ display:none/);
  assert.match(base, /:root:not\(\[data-screen="home"\]\) \.screen\{ padding-left:var\(--sp-4\)/);
  assert.equal((html.match(/class="nav-bottom|id="navBottom|class="bottom-nav/g) || []).length, 0, 'pas de barre de navigation basse ajoutée');
});

test('retour : tout écran secondaire a un bouton Retour visible ; l\'accueil n\'en a pas', () => {
  const screens = ['services', 'servers', 'activity', 'account', 'chat', 'clients', 'community', 'livechat', 'settings', 'about', 'logs', 'legal'];
  for(const s of screens){
    const i = html.indexOf('id="screen-' + s + '"');
    assert.ok(i > 0, 'screen-' + s + ' existe');
    const j = html.indexOf('<section', i + 1);
    const block = html.slice(i, j < 0 ? html.length : j);
    assert.match(block, /back-btn/, 'pas de bouton Retour dans screen-' + s);
  }
  const home = html.slice(html.indexOf('id="screen-home"'), html.indexOf('id="screen-services"'));
  assert.doesNotMatch(home, /back-btn/, 'l\'accueil se navigue au rail, pas au retour');
});

test('badge de communauté sur le rail de l\'accueil (les pastilles restent la seule signalétique de non-lus)', () => {
  assert.match(html, /id="railBtn-livechat"[^>]*>[\s\S]*?id="communityBadge"/);
});

test('rendu sûr : aucune donnée du panel ne passe par innerHTML (annonces, salons, lecteurs, url)', () => {
  const lc = fs.readFileSync(path.join(WWW, 'js', 'livechat.js'), 'utf8');
  // les innerHTML sont des gabarits DE STATIQUE (icônes) : tout contenu du panel est posé par textContent
  assert.match(lc, /querySelector\('\.lc-room-ico'\)\.textContent = r\.icon/);
  assert.match(lc, /const body = document\.createElement\('div'\); body\.className = 'lc-an-text';\s*body\.textContent = m\.text;/);
  assert.match(lc, /lc\.an\.more/);
  assert.ok(lc.indexOf('/^https?:\\/\\//i') >= 0, 'le lien d\'annonce du panel n\'est rendu qu\'en http(s)');
  assert.match(lc, /function lcPrepend\(messages, thread\)/, 'pagination : prépend distinct de l\'append (ordre + scroll restauré)');
  const acc = fs.readFileSync(path.join(WWW, 'js', 'account.js'), 'utf8');
  const ann = acc.slice(acc.indexOf('function renderAnnouncements'), acc.indexOf('async function loadAnnouncements'));
  assert.doesNotMatch(ann, /style="/, 'annonces du compte : plus de styles en ligne, classes du design system');
});
