// Mise à jour depuis l'application : lecture de l'annonce, numérotation « ORBITE 1.6.0 (261103001) », ouverture au
// lancement, versions affichées, barre de progression, suites d'états.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadApp } = require('./harness');

const SHA = 'a'.repeat(64);
const ANNOUNCE = { version: '1.6.0', build: 261103001, name: 'ORBITE', url: 'https://github.com/PHILIPPO237/LaboSurfVPN/releases/download/v1.6.0/a.apk', sha256: SHA, size: 52428800, title: 'Grande version', notes: ['Connexion plus stable', 'Nouvelle page'], published_at: '03/11/2026' };
// Application installée avant ORBITE : numéro 1.5.1, build 14, sans nom
const LEGACY = { version: '1.5.1', build: '14', name: '' };

function start(data, installed, nativeExtra){
  const inst = installed || LEGACY;
  const calls = { download: [], install: 0, cancel: 0, cleanup: 0 };
  const app = loadApp({ native: { engine: undefined }, respond: async () => ({ ok: true, status: 200, data }) });
  Object.assign(app.native, {
    getAppVersion: () => inst.version,
    getAppBuild: () => inst.build,
    getReleaseName: () => inst.name,
    updateDownload: (u, s, size) => calls.download.push([u, s, size]),
    updateCancel: () => { calls.cancel++; },
    updateInstall: () => { calls.install++; return (nativeExtra && nativeExtra.install) || 'started'; },
    updateCanInstall: () => !!(nativeExtra && nativeExtra.canInstall),
    updateAllowInstall: () => true,
    updateCleanup: () => { calls.cleanup++; },
    updateIsMetered: () => !!(nativeExtra && nativeExtra.metered),
  });
  return { app, calls, el: (id) => app.ctx.document.getElementById(id) };
}
const cur = (v, b, n) => ({ version: v, build: b, name: n || '' });

test('comparaison des versions', () => {
  const { app } = start(ANNOUNCE);
  assert.strictEqual(app.ev("UpdateLogic.compare('1.10.0', '1.9.9')"), 1);
  assert.strictEqual(app.ev("UpdateLogic.compare('v1.6', '1.6.0')"), 0);
  assert.strictEqual(app.ev("UpdateLogic.compare('1.5.1', '1.6.0')"), -1);
  assert.strictEqual(app.ev("UpdateLogic.compare('n/a', '1.6.0')"), null);
});

test('la suite continue : 1.5.1 → 1.6.0 est une mise à jour, sans repartir à 1.0.0', () => {
  const { app } = start(ANNOUNCE);
  const read = (d, c) => app.ev('UpdateLogic.read(' + JSON.stringify(d) + ', ' + JSON.stringify(c) + ')');
  assert.strictEqual(read(ANNOUNCE, cur('1.5.1', 14)).info.newer, true);
  assert.strictEqual(read(ANNOUNCE, cur('1.6.0', 261103001)).info.newer, false, 'même numéro, même build');
  assert.strictEqual(read(Object.assign({}, ANNOUNCE, { version: '1.0.0' }), cur('1.5.1', 14)).info.newer, false, 'un numéro plus ancien n\'est jamais proposé');
});

test('même numéro : le build départage, jamais un build inconnu', () => {
  const { app } = start(ANNOUNCE);
  const newer = (b, c) => app.ev('UpdateLogic.read(' + JSON.stringify(Object.assign({}, ANNOUNCE, { build: b })) + ', ' + JSON.stringify(c) + ').info.newer');
  assert.strictEqual(newer(261203001, cur('1.6.0', 261103001)), true);
  assert.strictEqual(newer(261103001, cur('1.6.0', 261203001)), false);
  assert.strictEqual(newer(0, cur('1.6.0', 261103001)), false, 'annonce sans build : on ne propose pas');
  assert.strictEqual(newer(261203001, cur('1.6.0', 0)), false, 'build installé inconnu : on ne propose pas');
});

test('le nom et le build de l\'annonce sont nettoyés', () => {
  const { app } = start(ANNOUNCE);
  const info = (d) => app.ev('UpdateLogic.read(' + JSON.stringify(Object.assign({}, ANNOUNCE, d)) + ', ' + JSON.stringify(cur('1.5.1', 14)) + ').info');
  assert.strictEqual(info({ name: '  orbite <b>x</b> ' }).name, 'ORBITE BXB', 'les symboles sont retirés, jamais interprétés');
  assert.strictEqual(info({ name: 'N'.repeat(60) }).name.length, 24);
  assert.strictEqual(info({ build: 'abc' }).build, 0);
  assert.strictEqual(info({ build: -5 }).build, 0);
  assert.strictEqual(info({ build: 9999999999 }).build, 0, 'au-delà de la limite d\'Android');
});

test('libellé : « ORBITE 1.6.0 (261103001) », sans nom « 1.5.1 (14) »', () => {
  const { app } = start(ANNOUNCE);
  assert.strictEqual(app.ev("UpdateLogic.label('ORBITE', '1.6.0', 261103001)"), 'ORBITE 1.6.0 (261103001)');
  assert.strictEqual(app.ev("UpdateLogic.label('', '1.5.1', 14)"), '1.5.1 (14)');
  assert.strictEqual(app.ev("UpdateLogic.label('ORBITE', '1.6.0', 0)"), 'ORBITE 1.6.0');
});

test('une annonce incomplète ou douteuse n\'est jamais proposée', () => {
  const { app } = start(ANNOUNCE);
  const read = (d) => app.ev('UpdateLogic.read(' + JSON.stringify(d) + ', ' + JSON.stringify(cur('1.5.1', 14)) + ')');
  assert.strictEqual(read(ANNOUNCE).ok, true);
  assert.strictEqual(read(Object.assign({}, ANNOUNCE, { url: 'http://x/a.apk' })).reason, 'url');
  assert.strictEqual(read(Object.assign({}, ANNOUNCE, { sha256: '' })).reason, 'sha256');
  assert.strictEqual(read(Object.assign({}, ANNOUNCE, { version: 'dernier' })).reason, 'version');
  assert.strictEqual(read(null).reason, 'format');
});

test('version minimale : la mise à jour devient obligatoire', () => {
  const { app } = start(ANNOUNCE);
  const req = (min) => app.ev('UpdateLogic.read(' + JSON.stringify(Object.assign({}, ANNOUNCE, { min_version: min })) + ', ' + JSON.stringify(cur('1.5.1', 14)) + ').info.required');
  assert.strictEqual(req('1.6.0'), true);
  assert.strictEqual(req('1.5.0'), false);
});

test('à l\'ouverture : ancienne version sans nom, nouvelle avec nom et build, nouveautés', async () => {
  const { app, el } = start(ANNOUNCE);
  await app.ev('checkForUpdate(false, true)');
  assert.strictEqual(app.ev('Update.open'), true);
  assert.strictEqual(el('updPage').hidden, false);
  assert.strictEqual(el('updVerOldName').textContent, '', 'ORBITE n\'existait pas : aucun nom inventé');
  assert.strictEqual(el('updVerOld').textContent, '1.5.1');
  assert.strictEqual(el('updVerOldBuild').textContent, '(14)');
  assert.strictEqual(el('updVerNewName').textContent, 'ORBITE');
  assert.strictEqual(el('updVerNew').textContent, '1.6.0');
  assert.strictEqual(el('updVerNewBuild').textContent, '(261103001)');
  assert.strictEqual(el('updBadge').textContent, 'ORBITE 1.6.0');
  assert.strictEqual(app.ev('Update.info.notes.length'), 2);
  assert.strictEqual(el('updNotesEmpty').hidden, true);
  assert.strictEqual(el('updBtnDownload').hidden, false);
});

test('la barre de progression est toujours là : vide, puis pleine, puis complète', async () => {
  const { app, el } = start(ANNOUNCE);
  await app.ev('checkForUpdate(false, true)');
  assert.strictEqual(el('updBar').getAttribute('aria-valuenow'), '0');
  assert.match(el('updPc').textContent, /50,0/, 'avant le téléchargement : la taille');
  app.ev('Actions.updDownload()');
  app.ev(`LaboUpdateEvent('progress', '{"done":26214400,"total":52428800}')`);
  assert.strictEqual(el('updBar').getAttribute('aria-valuenow'), '50');
  assert.strictEqual(el('updPc').textContent, '50 %');
  assert.match(el('updStats').textContent, /25,0 Mo \/ 50,0 Mo/);
  app.ev("LaboUpdateEvent('verifying', '{}')");
  assert.strictEqual(el('updBar').getAttribute('aria-valuenow'), '100');
  assert.strictEqual(el('updPc').textContent, '100 %');
});

test('version déjà installée : rien ne s\'ouvre', async () => {
  const { app } = start(ANNOUNCE, { version: '1.6.0', build: '261103001', name: 'ORBITE' });
  await app.ev('checkForUpdate(false, true)');
  assert.strictEqual(app.ev('Update.open'), false);
  assert.strictEqual(app.ev('Update.state'), 'idle');
});

test('même numéro mais build plus récent : proposé, avec le nom des deux côtés', async () => {
  const { app, el } = start(Object.assign({}, ANNOUNCE, { build: 261203001 }), { version: '1.6.0', build: '261103001', name: 'ORBITE' });
  await app.ev('checkForUpdate(false, true)');
  assert.strictEqual(app.ev('Update.open'), true);
  assert.strictEqual(el('updVerOldName').textContent, 'ORBITE');
  assert.strictEqual(el('updVerOldBuild').textContent, '(261103001)');
  assert.strictEqual(el('updVerNewBuild').textContent, '(261203001)');
});

test('ancien pont (sans build ni nom) : les numéros suffisent', async () => {
  const app = loadApp({ native: { engine: undefined }, respond: async () => ({ ok: true, status: 200, data: ANNOUNCE }) });
  Object.assign(app.native, { getAppVersion: () => '1.5.1', updateDownload(){}, updateCleanup(){}, updateIsMetered: () => false });
  await app.ev('checkForUpdate(false, true)');
  assert.strictEqual(app.ev('Update.open'), true);
  assert.strictEqual(app.ctx.document.getElementById('updVerOldBuild').textContent, '');
});

test('panel injoignable au lancement : aucune gêne ni message', async () => {
  const { app } = start(ANNOUNCE);
  app.ctx.apiFetch = async () => ({ ok: false, status: 0, data: null });
  await app.ev('checkForUpdate(false, true)');
  assert.strictEqual(app.ev('Update.open'), false);
  assert.strictEqual(app.calls.toasts.length, 0);
});

test('« Plus tard » : la page revient au prochain lancement, l\'invitation se tait 24 h', async () => {
  const { app, el } = start(ANNOUNCE);
  await app.ev('checkForUpdate(false, true)');
  app.ev('Actions.updLater()');
  assert.strictEqual(app.ev('Update.open'), false);
  el('updSheet').hidden = true;
  await app.ev('checkForUpdate(false)');
  assert.strictEqual(el('updSheet').hidden, true);
  await app.ev('checkForUpdate(false, true)');
  assert.strictEqual(app.ev('Update.open'), true);
});

test('obligatoire : ni « Plus tard » ni retour arrière', async () => {
  const { app, el } = start(Object.assign({}, ANNOUNCE, { min_version: '1.6.0' }));
  await app.ev('checkForUpdate(false, true)');
  assert.strictEqual(el('updBtnLater').hidden, true);
  assert.strictEqual(el('updClose').hidden, true);
  assert.strictEqual(app.ev('updClose()'), false);
  assert.strictEqual(app.ev('Update.open'), true);
});

test('parcours complet : téléchargement, vérification, installation', async () => {
  const { app, calls, el } = start(ANNOUNCE);
  await app.ev('checkForUpdate(false, true)');
  app.ev('Actions.updDownload()');
  assert.deepStrictEqual(calls.download[0], [ANNOUNCE.url, SHA, '52428800']);
  assert.strictEqual(app.ev('Update.state'), 'downloading');
  app.ev("LaboUpdateEvent('verifying', '{}')");
  assert.strictEqual(app.ev('Update.state'), 'verifying');
  app.ev("LaboUpdateEvent('ready', '{}')");
  assert.strictEqual(calls.install, 1);
  assert.strictEqual(app.ev('Update.state'), 'installing');
  const pending = app.ev("store.get('update.pending', null)");
  assert.strictEqual(pending.from, '1.5.1');
  assert.strictEqual(String(pending.fromBuild), '14');
  assert.strictEqual(pending.name, 'ORBITE');
  assert.strictEqual(pending.build, 261103001);
  assert.strictEqual(el('updBtnCancel').hidden, true);
});

test('fichier refusé : le motif est dit, et on peut réessayer', async () => {
  const { app, calls, el } = start(ANNOUNCE);
  await app.ev('checkForUpdate(false, true)');
  app.ev('Actions.updDownload()');
  app.ev(`LaboUpdateEvent('failed', '{"code":"signature"}')`);
  assert.strictEqual(app.ev('Update.state'), 'failed');
  assert.match(el('updSub').textContent, /signé/);
  assert.strictEqual(el('updBtnRetry').hidden, false);
  assert.strictEqual(calls.install, 0);
});

test('autorisation Android manquante : demandée, puis installation au retour', async () => {
  const flags = { install: 'need_permission', canInstall: false };
  const { app, calls } = start(ANNOUNCE, null, flags);
  await app.ev('checkForUpdate(false, true)');
  app.ev('Actions.updDownload()');
  app.ev("LaboUpdateEvent('ready', '{}')");
  assert.strictEqual(app.ev('Update.state'), 'permission');
  flags.install = 'started'; flags.canInstall = true;
  app.ev('updOnVisible()');
  assert.strictEqual(calls.install, 2);
  assert.strictEqual(app.ev('Update.state'), 'installing');
});

test('fenêtre d\'Android refermée sans installer : l\'installation reste proposée', async () => {
  const { app } = start(ANNOUNCE);
  await app.ev('checkForUpdate(false, true)');
  app.ev('Actions.updDownload()');
  app.ev("LaboUpdateEvent('ready', '{}')");
  app.ev('updOnVisible()');
  assert.strictEqual(app.ev('Update.state'), 'ready');
});

test('après l\'installation : page de réussite avec ancienne et nouvelle version, nom et nouveautés', () => {
  const { app, el } = start(ANNOUNCE, { version: '1.6.0', build: '261103001', name: 'ORBITE' });
  app.ev(`store.set('update.pending', { version: '1.6.0', build: 261103001, name: 'ORBITE', from: '1.5.1', fromBuild: 14, fromName: '', title: '', notes: ['Connexion plus stable'] })`);
  assert.strictEqual(app.ev('updCheckInstalled()'), true);
  assert.strictEqual(app.ev('Update.state'), 'done');
  assert.strictEqual(el('updVerOld').textContent, '1.5.1');
  assert.strictEqual(el('updVerOldBuild').textContent, '(14)');
  assert.strictEqual(el('updVerNewName').textContent, 'ORBITE');
  assert.strictEqual(el('updVerNew').textContent, '1.6.0');
  assert.strictEqual(el('updStats').textContent, 'ORBITE 1.6.0 (261103001) installée');
  assert.strictEqual(el('updBtnDone').hidden, false);
  assert.strictEqual(app.ev("store.get('update.pending', null)"), null);
});

test('installation non aboutie (ancienne version encore là) : aucune fausse réussite', () => {
  const { app } = start(ANNOUNCE);
  app.ev(`store.set('update.pending', { version: '1.6.0', build: 261103001, name: 'ORBITE', from: '1.5.1', notes: [] })`);
  assert.strictEqual(app.ev('updCheckInstalled()'), false);
  assert.notStrictEqual(app.ev('Update.state'), 'done');
});

test('même numéro, build ancien encore installé : aucune fausse réussite', () => {
  const { app } = start(ANNOUNCE, { version: '1.6.0', build: '261003001', name: 'ORBITE' });
  app.ev(`store.set('update.pending', { version: '1.6.0', build: 261103001, name: 'ORBITE', from: '1.6.0', notes: [] })`);
  assert.strictEqual(app.ev('updCheckInstalled()'), false);
});

test('navigateur (hors application) : aucune mise à jour proposée', async () => {
  const app = loadApp({ native: null, respond: async () => ({ ok: true, status: 200, data: ANNOUNCE }) });
  await app.ev('checkForUpdate(false, true)');
  assert.strictEqual(app.calls.apiFetch.length, 0);
});
