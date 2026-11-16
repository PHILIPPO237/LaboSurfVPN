'use strict';
// Communauté intégrée : lecture stricte des réponses /api/chat/*, états d'échec distincts (une panne n'est pas un refus d'accès).
const test = require('node:test');
const assert = require('node:assert/strict');
const { CommunityContract } = require('../../app/src/main/assets/www/js/contract.js');
const { loadApp } = require('./harness.js');

const boot = (over) => Object.assign({ status: 'ok', me: { username: 'a', can_write: false }, restriction: null, limits: { max_text: 1500 },
  rooms: [{ id: 'community', label: 'Communauté', description: 'Salon général', unread: 2, can_write: false }] }, over || {});

test('CommunityContract.failure : session, refus, réseau, panne sont distincts', () => {
  assert.equal(CommunityContract.failure({ status: 401 }).state, 'login');
  assert.equal(CommunityContract.failure({ status: 200, expired: true }).state, 'login');
  assert.deepEqual(CommunityContract.failure({ status: 403, data: { code: 'chat_forbidden' } }), { state: 'forbidden', code: 'chat_forbidden' });
  assert.equal(CommunityContract.failure({ status: 0 }).state, 'network');
  assert.equal(CommunityContract.failure({ status: 503 }).state, 'down');
  assert.equal(CommunityContract.failure({ status: 404 }).state, 'unavailable');
});

test('CommunityContract.parseBootstrap : salons tels que le panel les donne, rien d\'inventé', () => {
  const r = CommunityContract.parseBootstrap(boot());
  assert.equal(r.state, 'ready');
  assert.equal(r.rooms.length, 1);
  assert.equal(r.rooms[0].canWrite, false);
  assert.equal(r.canWrite, false);
  assert.equal(r.maxText, 1500);
  assert.equal(CommunityContract.parseBootstrap(boot({ me: { can_write: 'oui' } })).canWrite, false, 'seul true autorise');
  assert.equal(CommunityContract.parseBootstrap(boot({ rooms: [{ id: 'x' }] })).state, 'invalid');
  assert.equal(CommunityContract.parseBootstrap(boot({ status: 'error' })).state, 'invalid');
  assert.equal(CommunityContract.parseBootstrap(null).state, 'invalid');
  assert.deepEqual(CommunityContract.parseBootstrap(boot({ restriction: { until: 99, reason: 'spam' } })).restriction, { until: 99, reason: 'spam' });
});

test('CommunityContract.parseMessages : lecture stricte, texte brut', () => {
  const ok = CommunityContract.parseMessages({ status: 'ok', last_id: 4, messages: [{ id: 4, text: '<b>x</b>', author: { username: 'bob', role: 'Membre' }, mine: true, file: { name: 'a' } }] });
  assert.equal(ok.state, 'ready');
  assert.equal(ok.messages[0].text, '<b>x</b>');
  assert.equal(ok.messages[0].mine, true);
  assert.equal(ok.messages[0].hasFile, true);
  assert.equal(ok.lastId, 4);
  assert.equal(CommunityContract.parseMessages({ status: 'ok', messages: [{ text: 'sans id' }] }).state, 'invalid');
  assert.equal(CommunityContract.parseMessages({ status: 'ok', messages: 'x' }).state, 'invalid');
});

test('CommunityContract.parseBootstrap : icône et libellé court du salon, tels que le panel les donne (vides si absents)', () => {
  const r = CommunityContract.parseBootstrap(boot({ rooms: [{ id: 'official', label: 'Annonces', description: 'Officiel', short: 'Annonces', icon: '📢', unread: 1, can_write: false }] }));
  assert.equal(r.rooms[0].icon, '📢');
  assert.equal(r.rooms[0].short, 'Annonces');
  const old = CommunityContract.parseBootstrap(boot());
  assert.equal(old.rooms[0].icon, '', 'panel plus ancien : vide, jamais inventé');
  assert.equal(old.rooms[0].short, '');
});

test('CommunityContract.parseMessages : carte d\'annonce officielle, publication minimale, épingles et lecteurs', () => {
  const r = CommunityContract.parseMessages({ status: 'ok', last_id: 3, has_more: true, pins: [{ id: 2 }, { id: 'x' }],
    messages: [
      { id: 2, text: 'LaboSurfVPN 1.4.1 est disponible', author: { username: 'LABOSURF', role: 'Annonce officielle', official: true },
        system: { kind: 'announcement', product: 'vpn', label: 'LaboSurfVPN', icon: '🛰️', version: '1.4.1', title: 'Mise à jour', url: 'https://panel.example.tld/a', notes: ['Plus rapide', ''] },
        pinned: true, readers: { count: 4, total: 9 } },
      { id: 3, text: 'dernier', author: { username: 'bob' }, system: { kind: 'publication' } },
    ] });
  assert.equal(r.state, 'ready');
  assert.equal(r.messages[0].pinned, true);
  assert.deepEqual(r.messages[0].readers, { count: 4, total: 9 });
  assert.deepEqual(r.messages[0].system, { kind: 'announcement', product: 'vpn', label: 'LaboSurfVPN', icon: '🛰️', version: '1.4.1', title: 'Mise à jour', url: 'https://panel.example.tld/a', notes: ['Plus rapide'] });
  assert.deepEqual(r.messages[1].system, { kind: 'publication' });
  assert.equal(r.messages[1].pinned, false);
  assert.deepEqual(r.pins, [2], 'épingles : identifiants numériques du panel seulement');
  assert.equal(r.hasMore, true);
});

test('CommunityContract.parseMessages : system ou readers non conformes -> null/false, le message reste lisible', () => {
  const r = CommunityContract.parseMessages({ status: 'ok', last_id: 1, messages: [
    { id: 1, text: 'reste affiché', author: {}, system: { kind: 'autre' }, readers: { count: 'beaucoup', total: 2 }, pinned: 'oui' },
  ] });
  assert.equal(r.state, 'ready', 'une forme inconnue n\'invalide pas tout le lot');
  assert.equal(r.messages[0].system, null);
  assert.equal(r.messages[0].readers, null);
  assert.equal(r.messages[0].pinned, false);
});

test('CommunityContract.parseMessages : le 0 des lecteurs est un vrai 0 ; has_more absent -> false', () => {
  const r = CommunityContract.parseMessages({ status: 'ok', messages: [{ id: 1, text: '', author: {}, readers: { count: 0, total: 0 } }] });
  assert.deepEqual(r.messages[0].readers, { count: 0, total: 0 });
  assert.equal(r.hasMore, false);
});

test('CommunityContract.parsePulse : non-lus par salon, lecture stricte', () => {
  assert.deepEqual(CommunityContract.parsePulse({ status: 'ok', rooms: { official: { unread: 2 }, community: { unread: 0 } } }).unread, { official: 2, community: 0 });
  assert.equal(CommunityContract.parsePulse({ status: 'ok', rooms: { official: { unread: -1 } } }).state, 'invalid');
  assert.equal(CommunityContract.parsePulse({ status: 'ok', rooms: { official: { unread: 'x' } } }).state, 'invalid');
  assert.equal(CommunityContract.parsePulse({ status: 'ok', rooms: { official: 2 } }).state, 'invalid', 'salon = objet du panel, pas un nombre nu');
  assert.equal(CommunityContract.parsePulse({ status: 'error' }).state, 'invalid');
  assert.equal(CommunityContract.parsePulse(null).state, 'invalid');
});

const app = () => loadApp({ native: { engine: { integrated: false, protocols: [] }, apiBase: 'https://panel.example.tld' } });

// Second jeu de bootstrap : salons avec les métadonnées réelles du panel (icône + libellé court)
const bootMeta = (over) => Object.assign({ status: 'ok', me: { username: 'a', can_write: false }, restriction: null, limits: { max_text: 1500 },
  rooms: [{ id: 'official', label: 'Annonces officielles', short: 'Annonces', description: 'Publications officielles', icon: '📢', unread: 3, can_write: false },
          { id: 'community', label: 'Communauté', description: 'Salon de discussion', icon: '🌍', unread: 9, can_write: true }] }, over || {});

test('Pastille de communauté sur le rail : somme réelle des non-lus du panel (bootstrap, puis pulse léger), effacée avec le compte', async () => {
  const a = loadApp({ native: { engine: { integrated: false, protocols: [] }, apiBase: 'https://panel.example.tld' },
    respond(path, options){
      if(path === '/api/chat/bootstrap') return { ok: true, status: 200, data: bootMeta() };
      if(path === '/api/chat/pulse') return { ok: true, status: 200, data: { status: 'ok', rooms: { official: { unread: 0, last_id: 5 }, community: { unread: 4, last_id: 9 } } } };
      throw new Error('route non prévue : ' + path);
    } });
  a.ev("authToken = 'token-de-test'; currentScreen = 'livechat';");
  await a.ev('lcLoadRooms()');
  assert.equal(a.ev('$("communityBadge").hidden'), false);
  assert.equal(a.ev('$("communityBadge").textContent'), '9+', '3 + 9 = 12 > 9');
  assert.equal(a.ev('LC.unread.official'), 3);
  await a.ev('lcPulse()');                                        // sondage léger branché sur le sondage du compte
  assert.equal(a.ev('LC.unread.official'), 0, 'valeur du panel, jamais une somme inventée');
  assert.equal(a.ev('$("communityBadge").textContent'), '4');
  a.ev('lcReset()');                                              // déconnexion : rien ne reste du compte
  assert.equal(a.ev('$("communityBadge").hidden'), true);
  assert.equal(a.ev('LC.rooms.length'), 0);
});

test('Salon ouvert : l\'épinglage et la fin d\'historique viennent du panel (has_more, pins), rien d\'inventé', async () => {
  const messages = { status: 'ok', has_more: true, last_id: 5, pins: [{ id: 5 }],
    messages: [{ id: 5, text: 'première', author: { username: 'LABOSURF', official: true },
      system: { kind: 'announcement', product: 'vpn', label: 'LaboSurfVPN', version: '1.4.1', title: 'Mise à jour', url: 'https://panel.example.tld/apk', notes: ['Correctif de connexion'] }, pinned: true, readers: { count: 2, total: 9 } }] };
  const a = loadApp({ native: { engine: { integrated: false, protocols: [] }, apiBase: 'https://panel.example.tld' },
    respond(path){ if(path.indexOf('/api/chat/rooms/official/messages') === 0) return { ok: true, status: 200, data: messages };
      throw new Error('route non prévue : ' + path); } });
  a.ev("authToken = 'token-de-test'; currentScreen = 'livechat';");
  a.ev('LC.rooms = [{ id: "official", label: "Annonces", description: "", icon: "📢", unread: 0, canWrite: false }];');
  await a.ev('lcOpenRoom("official")');
  assert.equal(a.ev('LC.hasMore'), true);
  assert.equal(a.ev('LC.pins.has(5)'), true);
  assert.equal(a.ev('LC.oldest'), 5);
  assert.equal(a.ev('$("lcComposer").hidden'), true, 'salon read-only : composer caché');
});

test('Communauté : sans session, ouverture = parcours de connexion avec retour direct, aucun appel au panel', () => {
  const a = app();
  a.ev('authToken = null');
  a.ev('Actions.openCommunity()');
  assert.equal(a.ev('LC.wantReturn'), true);
  assert.equal(a.calls.apiFetch.length, 0);
});

test("Communauté : le retour automatique est annulé si l'utilisateur va ailleurs (showScreen)", () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'app', 'src', 'main', 'assets', 'www', 'js', 'app.js'), 'utf8');
  assert.match(src, /name !== 'account' && name !== 'livechat'.*LC\.wantReturn = false/);
  assert.match(src, /const SCREENS = \[[^\]]*'livechat'/);
});

test("Profil : le bouton du panel complet n'est proposé que si le serveur indique un accès (jamais Gratuit ni VIP)", () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'app', 'src', 'main', 'assets', 'www', 'js', 'account.js'), 'utf8');
  assert.match(src, /profActions'\)\.hidden = !\(API\.state\.ok && p\.statusOk && p\.panelScope !== 'none'\)/);
});
