'use strict';
// Choix du profil : GET /api/user/connect/options puis POST /api/user/connect {"hosted_profile_id": …}.
// Réponses RÉELLES du Laboratoire du Free-Surf (fixtures/panel_profile_samples.json, capturées par
// tests/integration/real_panel_chain.py avec le vrai code du panel et son faux labosurf-agent signé).
// Le VRAI code de l'interface est piloté (harness.js) : seuls le réseau et le pont natif sont simulés.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { ConnectContract, ProfileOptions } = require('../../app/src/main/assets/www/js/contract.js');
const S = require('./fixtures/panel_profile_samples.json');

const res = (s) => ({ ok: s.http_status >= 200 && s.http_status < 300, status: s.http_status, data: s.body, expired: false });
const NATIVE = { engine: { integrated: true, protocols: ['tuic', 'xray', 'hysteria2'] }, apiBase: 'https://panel.example.tld' };
const SERVERS = { ok: true, status: 200, expired: false, data: { status: 'ok', servers: [
  { id: 1, name: 'VPS Douala', country: 'Cameroun', city: 'Douala', status: 'available' },
  { id: 2, name: 'VPS Yaoundé', country: 'Cameroun', city: 'Yaoundé', status: 'available' }] } };

// Panel simulé À PARTIR des réponses réelles : chemin -> réponse ; connect choisi par hosted_profile_id
function panel(over){
  over = over || {};
  return (path, opts) => {
    if(path === '/api/user/servers') return over.servers || SERVERS;
    if(path === '/api/user/connect/options') return over.options ? over.options() : res(S.options);
    if(path === '/api/user/connect'){
      const body = JSON.parse(opts.body);
      if(over.connect) return over.connect(body);
      const byId = { [S._ids.rapide]: 'connect_rapide', [S._ids.stable]: 'connect_stable' };
      if(body.hosted_profile_id === undefined) return res(S.connect_without_choice);
      return res(S[byId[body.hosted_profile_id]] || S.profile_not_found);
    }
    throw new Error('appel inattendu ' + path);
  };
}
async function ready(over, extra){
  const a = loadApp(Object.assign({ native: NATIVE, respond: panel(over) }, extra || {}));
  a.ev("authToken = 'token-de-test'; authExpiresAt = null;");
  await a.ev('loadServers()');
  return a;
}
const connectBodies = (a) => a.calls.apiFetch.filter((c) => c.path === '/api/user/connect').map((c) => JSON.parse(c.options.body));
const select = (a, pid) => a.ev(`Actions.selectProfile({ dataset: { pid: ${JSON.stringify(String(pid))} } })`);

// ================================================================ contrat
test('contrat : la liste réelle du panel est lue sans rien ajouter', () => {
  const r = ProfileOptions.parse(res(S.options));
  assert.equal(r.state, 'ready');
  assert.deepEqual(r.options.map((o) => [o.id, o.name, o.serverId, o.serverName, o.health]), [
    [S._ids.rapide, 'Rapide', 1, 'VPS Douala', 'available'],
    [S._ids.stable, 'Stable', 1, 'VPS Douala', 'available'],
    [S._ids.streaming, 'Streaming', 2, 'VPS Yaoundé', 'available']]);
  assert.ok(r.options.every((o) => !('engine' in o) && !('protocol' in o)), 'le panel ne fournit pas le moteur : l\'app ne l\'invente pas');
  assert.deepEqual(Object.keys(S.options.body.options[0]).sort(),
    ['city', 'country', 'hosted_profile_id', 'profile_name', 'server_id', 'server_name', 'service_health'], 'aucun champ du panel ignoré en silence');
});

test('contrat : cas limites de la liste', () => {
  assert.deepEqual(ProfileOptions.parse(res(S.options_all_down)), { state: 'ready', options: [] });
  assert.equal(ProfileOptions.parse(res(S.options_unauthenticated)).authLost, true);
  assert.equal(ProfileOptions.parse({ ok: false, status: 404, data: { detail: 'Not Found' } }).state, 'unsupported', 'panel sans la route');
  assert.equal(ProfileOptions.parse({ ok: false, status: 500, data: null }).state, 'error');
  assert.equal(ProfileOptions.parse(null).state, 'error');
  const mixed = ProfileOptions.parse({ ok: true, status: 200, data: { status: 'ok', options: [
    { profile_name: 'sans id' }, { hosted_profile_id: '3', profile_name: 'id texte' }, { hosted_profile_id: 1.5 }, null,
    { hosted_profile_id: 9, profile_name: 'ok', service_health: 'degraded' }, { hosted_profile_id: 9, profile_name: 'doublon' }] } });
  assert.deepEqual(mixed.options.map((o) => [o.id, o.name, o.health]), [[9, 'ok', 'unknown']], 'rien de réparé : sans identifiant entier, ignoré');
});

test('contrat : corps de connexion exact et réponse réelle', () => {
  const opt = ProfileOptions.parse(res(S.options)).options[1];
  assert.deepEqual(ProfileOptions.connectBody(opt, 'dev-1'), { hosted_profile_id: S._ids.stable, server_id: 1, device_id: 'dev-1' });
  const ok = ConnectContract.parse(res(S.connect_stable));
  assert.equal(ok.ok, true);
  assert.equal(ok.hostedProfileId, S._ids.stable);
  assert.equal(ok.config.protocol, 'xray');
  assert.equal(ok.config.uri, S.connect_stable.body.configs[0].uri);
  for(const [name, code, status] of [['profile_not_found', 'profile_not_found', 404], ['profile_not_authorized', 'profile_not_found', 404],
    ['profile_unavailable', 'profile_unavailable', 503], ['connect_service_down', 'service_unhealthy', 503]]){
    assert.equal(S[name].http_status, status, name);
    const r = ConnectContract.parse(res(S[name]));
    assert.equal(r.ok, false, name);
    assert.equal(r.code, code, name);
    assert.equal(r.key, 'conn.err.' + code, name);
  }
  assert.equal(ConnectContract.parse(res(S.profile_unavailable)).retryAfter, 30);
  assert.equal(ConnectContract.parse(res(S.profile_not_found)).retryAfter, null);
});

// ================================================================ interface
test('plusieurs profils : récupérés après les serveurs et affichés avec « Automatique »', async () => {
  const a = await ready();
  assert.deepEqual(a.calls.apiFetch.map((c) => c.path), ['/api/user/servers', '/api/user/connect/options']);
  assert.equal(a.ev('Profiles.state'), 'ready');
  assert.equal(a.ev('Profiles.list.length'), 3);
  const html = a.ev("document.getElementById('srvList').innerHTML");
  for(const text of ['Profil de connexion', 'Automatique', 'Rapide', 'Stable', 'Streaming', 'VPS Yaoundé · Yaoundé, Cameroun'])
    assert.ok(html.includes(text), text);
  assert.equal((html.match(/data-action="selectProfile"/g) || []).length, 4, '3 profils + Automatique');
  assert.equal(a.ev('getSelectedProfile()'), null, 'aucun profil choisi par défaut');
});

test('sélection d\'un profil : mémorisée, et son serveur devient le serveur retenu', async () => {
  const a = await ready();
  select(a, S._ids.streaming);
  assert.equal(a.ev('getSelectedProfile().name'), 'Streaming');
  assert.equal(a.ev("store.get('hostedProfile', null)"), S._ids.streaming);
  assert.equal(a.ev('Servers.selectedId'), 2);
  assert.ok(a.ev("document.getElementById('srvList').innerHTML").includes('aria-checked="true" data-action="selectProfile" data-pid="' + S._ids.streaming + '"'));
  select(a, '');   // « Automatique »
  assert.equal(a.ev('getSelectedProfile()'), null);
  assert.equal(a.ev("store.get('hostedProfile', null)"), null);
});

test('connexion avec un profil : hosted_profile_id envoyé tel quel, configuration du panel remise au natif', async () => {
  const a = await ready();
  select(a, S._ids.stable);
  await a.ev('connectVpn()');
  assert.deepEqual(connectBodies(a), [{ hosted_profile_id: S._ids.stable, server_id: 1, device_id: 'device-test' }]);
  assert.equal(a.calls.native.startVpn.length, 1);
  const sent = JSON.parse(a.calls.native.startVpn[0]);
  assert.equal(sent.proto, 'xray');
  assert.equal(sent.uri, S.connect_stable.body.configs[0].uri, 'exactement la configuration émise par PRO via le panel');
  assert.equal(sent.name, 'Stable · VPS Douala');
  assert.equal(a.state(), 'connecting', '« connecté » seulement sur la réponse du natif');
  a.ctx.onNativeVpnState('connected', '');
  assert.equal(a.state(), 'on');
});

test('profil inexistant ou non autorisé : message clair, rien envoyé au natif, liste relue', async () => {
  for(const sample of ['profile_not_found', 'profile_not_authorized']){
    const a = await ready({ connect: () => res(S[sample]) });
    select(a, S._ids.rapide);
    await a.ev('connectVpn()');
    assert.equal(a.state(), 'error', sample);
    assert.equal(a.ev('VPN.errorSpec.key'), 'conn.err.profile_not_found', sample);
    assert.equal(a.ev('errorText(VPN.errorSpec)'), "Ce profil n'existe pas ou n'est pas inclus dans ton offre. Choisis-en un autre.");
    assert.equal(a.calls.native.startVpn.length, 0);
    assert.equal(connectBodies(a).length, 1, 'aucun nouvel essai automatique, aucun repli');
    assert.equal(a.calls.apiFetch.filter((c) => c.path === '/api/user/connect/options').length, 2, 'la liste est relue');
  }
});

test('profil indisponible : message clair avec le délai du panel', async () => {
  const a = await ready({ connect: () => res(S.profile_unavailable) });
  select(a, S._ids.rapide);
  await a.ev('connectVpn()');
  assert.equal(a.ev('VPN.errorSpec.key'), 'conn.err.profile_unavailable');
  assert.equal(a.ev('VPN.errorSpec.retryAfter'), 30);
  assert.match(a.ev('errorText(VPN.errorSpec)'), /n'est pas disponible pour le moment.*30/);
  assert.equal(a.calls.native.startVpn.length, 0);
});

test('serveur du profil hors service côté PRO : erreur du panel affichée, jamais contournée', async () => {
  const a = await ready({ connect: () => res(S.connect_service_down) });
  select(a, S._ids.rapide);
  await a.ev('connectVpn()');
  assert.equal(a.ev('VPN.errorSpec.key'), 'conn.err.service_unhealthy');
  assert.equal(connectBodies(a).length, 1);
  assert.equal(a.calls.native.startVpn.length, 0);
});

test('aucun profil proposé : section absente, connexion historique (server_id seul)', async () => {
  const a = await ready({ options: () => res(S.options_all_down) });
  assert.equal(a.ev('Profiles.list.length'), 0);
  assert.ok(!a.ev("document.getElementById('srvList').innerHTML").includes('selectProfile'));
  await a.ev('connectVpn()');
  assert.deepEqual(connectBodies(a), [{ server_id: 1, device_id: 'device-test' }]);
  assert.equal(a.calls.native.startVpn.length, 1);
});

test('panel sans la route des profils (404) : comportement historique, aucune erreur affichée', async () => {
  const a = await ready({ options: () => ({ ok: false, status: 404, expired: false, data: { detail: 'Not Found' } }) });
  assert.equal(a.ev('Profiles.state'), 'unsupported');
  assert.equal(a.ev('Servers.state'), 'ready');
  await a.ev('connectVpn()');
  assert.deepEqual(connectBodies(a), [{ server_id: 1, device_id: 'device-test' }]);
});

test('profil mémorisé qui n\'est plus proposé : retour à « Automatique », signalé, jamais envoyé', async () => {
  const a = loadApp({ native: NATIVE, respond: panel() });
  a.ev("store.set('hostedProfile', 999); Profiles.selectedId = 999; authToken = 'token-de-test'; authExpiresAt = null;");
  await a.ev('loadServers()');
  assert.equal(a.ev('getSelectedProfile()'), null);
  assert.equal(a.ev("store.get('hostedProfile', null)"), null);
  assert.ok(a.calls.toasts.some((x) => x.m.includes("n'est plus disponible")));
  await a.ev('connectVpn()');
  assert.ok(!('hosted_profile_id' in connectBodies(a)[0]));
});

test('erreur réseau pendant la connexion avec un profil : comportement réseau existant', async () => {
  const a = await ready({ connect: () => { const e = new Error('coupure'); throw e; } });
  select(a, S._ids.rapide);
  await a.ev('connectVpn()');
  assert.equal(a.state(), 'error');
  assert.equal(a.ev('VPN.errorSpec.key'), 'err.panel');
  assert.equal(a.calls.native.startVpn.length, 0);
});

test('erreur réseau sur la liste des profils : serveurs intacts, connexion historique', async () => {
  const a = await ready({ options: () => { throw new Error('coupure'); } });
  assert.equal(a.ev('Profiles.state'), 'error');
  assert.equal(a.ev('Servers.state'), 'ready');
  await a.ev('connectVpn()');
  assert.deepEqual(connectBodies(a), [{ server_id: 1, device_id: 'device-test' }]);
});

test('choisir un autre serveur annule le profil d\'un autre serveur', async () => {
  const a = await ready();
  select(a, S._ids.streaming);   // serveur 2
  a.ev("Actions.selectServer({ dataset: { index: '0' } })");   // serveur 1
  assert.equal(a.ev('getSelectedProfile()'), null);
  select(a, S._ids.rapide);      // serveur 1
  a.ev("Actions.selectServer({ dataset: { index: '0' } })");   // même serveur : le profil est gardé
  assert.equal(a.ev('getSelectedProfile().name'), 'Rapide');
});

test('l\'application ne parle qu\'au panel : aucune adresse de l\'agent PRO', () => {
  const fs = require('fs');
  const path = require('path');
  const { WWW } = require('./harness.js');
  for(const f of fs.readdirSync(path.join(WWW, 'js')).filter((x) => x.endsWith('.js'))){
    const src = fs.readFileSync(path.join(WWW, 'js', f), 'utf8');
    // routes de l'agent (/api/v1/…), son port, ses en-têtes signés : rien de tout cela dans l'application
    assert.doesNotMatch(src, /\/api\/v1\/|:9443|X-LS-(Signature|Key-Id|Nonce|Timestamp)/i, f);
  }
});
