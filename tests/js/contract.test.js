'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ApiBase, ConnectContract } = require('../../app/src/main/assets/www/js/contract.js');

// Réponses telles que produites par POST /api/user/connect du Laboratoire du Free-Surf (app/routers/user.py, Phase 4).
// Identifiants de TEST uniquement (aucun secret réel).
const URI = 'tuic://11111111-2222-4333-8444-555555555555:mot-de-passe-de-test@203.0.113.10:443?congestion_control=bbr&alpn=h3&sni=203.0.113.10&allow_insecure=1&udp_relay_mode=native#LABOSURF';
const success = (over) => Object.assign({
  status: 'success', server_id: 1, service_health: 'available',
  access: { state: 'active', expires_at: '2100-01-01T00:00:00Z' },
  configs: [{ protocol: 'tuic', remark: 'VIP - tuic', uri: URI, format: 'uri' }],
}, over || {});
const ok = (data) => ({ ok: true, status: 200, data, expired: false });
const refused = (status, code, extra) => ({ ok: false, status, data: Object.assign({ status: 'error', code, message: 'Message interne du panel' }, extra || {}), expired: false });

// ─── Adresse de l'API ───
test('ApiBase : HTTPS obligatoire, aucun repli en clair, origine seule', () => {
  assert.deepEqual(ApiBase.normalize('https://panel.example.tld/api/x?y=1#z'), { ok: true, base: 'https://panel.example.tld' });
  assert.equal(ApiBase.normalize('https://panel.example.tld:8443/').base, 'https://panel.example.tld:8443');
  assert.equal(ApiBase.normalize('http://panel.example.tld').reason, 'insecure');
  assert.equal(ApiBase.normalize('http://192.168.1.10:8000').reason, 'insecure');
  assert.equal(ApiBase.normalize('http://127.0.0.1:8000').insecureLocal, true);   // développement seulement (bloqué par Android hors debug)
  assert.equal(ApiBase.normalize('http://localhost:8000').ok, true);
  assert.equal(ApiBase.normalize('http://10.0.2.2:8000').ok, true);
  for(const bad of ['', '   ', null, undefined, 'panel.example.tld', 'ftp://x.tld', 'javascript:alert(1)', 'file:///etc/passwd', 'https://user:pw@panel.tld', 'http://localhost.evil.tld'])
    assert.equal(ApiBase.normalize(bad).ok, false, String(bad));
});

test("ApiBase.resolve : dans l'app Android seule la valeur du natif compte", () => {
  assert.deepEqual(ApiBase.resolve({ nativeApp: true, native: 'https://a.tld', query: 'https://evil.tld', stored: 'https://evil.tld' }), { source: 'native', ok: true, base: 'https://a.tld' });
  assert.equal(ApiBase.resolve({ nativeApp: true, native: '' }).ok, false);              // pas d'adresse fournie par l'APK : erreur, pas de valeur par défaut
  assert.equal(ApiBase.resolve({ nativeApp: true, native: 'http://prod.tld' }).ok, false);
  assert.equal(ApiBase.resolve({ nativeApp: false, query: 'https://q.tld', stored: 'https://s.tld' }).base, 'https://q.tld');
  assert.equal(ApiBase.resolve({ nativeApp: false, stored: 'https://s.tld' }).base, 'https://s.tld');
  assert.equal(ApiBase.resolve({}).ok, false);
  assert.equal(ApiBase.resolve({ nativeApp: false, query: 'http://prod.tld' }).ok, false);
});

// ─── Succès : lecture stricte ───
test('connect : succès -> configuration EXACTEMENT celle du panel', () => {
  const r = ConnectContract.parse(ok(success()));
  assert.equal(r.ok, true);
  assert.equal(r.config.uri, URI);
  assert.equal(r.config.protocol, 'tuic');
  assert.equal(r.config.scheme, 'tuic');
  assert.equal(r.config.format, 'uri');
  assert.equal(r.serverId, 1);
  assert.equal(r.health, 'available');
  assert.equal(r.access.state, 'active');
  assert.equal(r.access.expiresAt, Date.parse('2100-01-01T00:00:00Z'));
  assert.equal(r.trialLimitMinutes, null);
});

test("connect : essai (trial_*), pas d'expiration technique, santé inconnue conservée telle quelle", () => {
  const r = ConnectContract.parse(ok(success({ trial_limit_minutes: 30, trial_quota_mb: 100, service_health: 'unknown', access: { state: 'active', expires_at: '' } })));
  assert.equal(r.trialLimitMinutes, 30);
  assert.equal(r.trialQuotaMb, 100);
  assert.equal(r.health, 'unknown');                    // jamais transformé en « available »
  assert.equal(r.access.expiresAt, null);
  assert.equal(ConnectContract.parse(ok(success({ trial_limit_minutes: 0, trial_quota_mb: -5 }))).trialLimitMinutes, null);
});

test('connect : service_health absent -> unknown (jamais sain par défaut)', () => {
  const d = success(); delete d.service_health;
  assert.equal(ConnectContract.parse(ok(d)).health, 'unknown');
});

// ─── Contrat violé : jamais de configuration inventée ───
test('connect : réponse hors contrat = échec, aucune configuration', () => {
  const cases = {
    'statut inattendu': ok(success({ status: 'ok' })),
    'aucune config': ok(success({ configs: [] })),
    'configs absent': ok(success({ configs: undefined })),
    'config non objet': ok(success({ configs: ['tuic://x'] })),
    'uri vide': ok(success({ configs: [{ protocol: 'tuic', uri: '   ' }] })),
    'uri absente': ok(success({ configs: [{ protocol: 'tuic' }] })),
    'protocole absent': ok(success({ configs: [{ uri: URI }] })),
    'uri sans schéma': ok(success({ configs: [{ protocol: 'tuic', uri: 'pas une uri' }] })),
    'corps illisible': { ok: true, status: 200, data: null, expired: false },
    'HTTP 200 sans succès': { ok: true, status: 200, data: { status: 'error' }, expired: false },
    'HTTP 500 sans corps': { ok: false, status: 500, data: null, expired: false },
  };
  for(const [name, res] of Object.entries(cases)){
    const r = ConnectContract.parse(res);
    assert.equal(r.ok, false, name);
    assert.equal(r.config, undefined, name);
  }
  assert.equal(ConnectContract.parse(ok(success({ configs: [] }))).key, 'conn.err.badResponse');
});

test('connect : santé ou Access non valides malgré un « succès » -> refus', () => {
  assert.equal(ConnectContract.parse(ok(success({ service_health: 'unavailable' }))).key, 'conn.err.service_unhealthy');
  assert.equal(ConnectContract.parse(ok(success({ service_health: 'degraded' }))).ok, false);
  assert.equal(ConnectContract.parse(ok(success({ service_health: 'maintenance' }))).ok, false);
  assert.equal(ConnectContract.parse(ok(success({ access: { state: 'expired' } }))).key, 'conn.err.access_expired');
  assert.equal(ConnectContract.parse(ok(success({ access: { state: 'disabled' } }))).key, 'conn.err.access_disabled');
});

// ─── Les 14 codes d'erreur stables ───
const CODES = { user_not_authenticated: 401, subscription_expired: 403, account_disabled: 403, no_service_available: 503, service_not_found: 404,
  service_unhealthy: 503, access_not_found: 404, access_disabled: 403, access_expired: 403, pro_unavailable: 503,
  pro_authentication_failed: 502, pro_timeout: 504, incompatible_version: 502, configuration_unavailable: 503 };

test('connect : les 14 codes du panel sont couverts, chacun avec sa clé de traduction', () => {
  assert.deepEqual(Object.keys(ConnectContract.ERROR_CODES).sort(), Object.keys(CODES).sort());
  for(const [code, status] of Object.entries(CODES)){
    const r = ConnectContract.parse(refused(status, code, { retry_after_s: 30 }));
    assert.equal(r.ok, false, code);
    assert.equal(r.code, code);
    assert.equal(r.key, 'conn.err.' + code);
    assert.equal(r.panelMessage, '', code + " : le texte du panel n'est pas affiché pour un code connu (traduction de l'app)");
  }
});

test('connect : délai de réessai (retry_after_s) seulement quand réessayer a un sens', () => {
  assert.equal(ConnectContract.parse(refused(503, 'service_unhealthy', { retry_after_s: 30 })).retryAfter, 30);
  assert.equal(ConnectContract.parse(refused(503, 'configuration_unavailable', { retry_after_s: 15 })).retryAfter, 15);
  for(const code of ['subscription_expired', 'account_disabled', 'access_disabled', 'access_expired', 'user_not_authenticated'])
    assert.equal(ConnectContract.parse(refused(403, code, { retry_after_s: 30 })).retryAfter, null, code);
  assert.equal(ConnectContract.parse(refused(503, 'pro_unavailable', { retry_after_s: 'x' })).retryAfter, null);
  assert.equal(ConnectContract.parse(refused(503, 'pro_unavailable', { retry_after_s: 999999 })).retryAfter, null);
});

test('connect : code inconnu -> message du panel (texte brut), jamais une interprétation', () => {
  const r = ConnectContract.parse(refused(400, 'code_futur', { message: 'Texte du panel' }));
  assert.equal(r.key, 'conn.err.unknown');
  assert.equal(r.panelMessage, 'Texte du panel');
  assert.equal(ConnectContract.parse({ ok: false, status: 400, data: { status: 'error', message: 'Ancien format sans code' }, expired: false }).panelMessage, 'Ancien format sans code');
});

test("connect : 401 / session expirée -> perte d'authentification", () => {
  for(const res of [{ ok: false, status: 401, data: null, expired: true }, { ok: false, status: 401, data: { status: 'error', message: 'Authentification requise.' }, expired: false }, refused(401, 'user_not_authenticated')]){
    const r = ConnectContract.parse(res);
    assert.equal(r.authLost, true);
    assert.equal(r.kind, 'auth');
  }
});

test('connect : erreurs avant toute réponse (délai, hors-ligne, injoignable)', () => {
  const abort = Object.assign(new Error('x'), { name: 'AbortError' });
  assert.equal(ConnectContract.networkFailure(abort, true).key, 'err.timeout');
  assert.equal(ConnectContract.networkFailure(new TypeError('Failed to fetch'), false).key, 'err.offline');
  assert.equal(ConnectContract.networkFailure(new TypeError('Failed to fetch'), true).key, 'err.panel');   // TLS refusé, DNS…
  assert.equal(ConnectContract.networkFailure(new TypeError('x'), true).ok, false);
});

test("connect : aucun secret dans les résultats d'erreur", () => {
  const all = [ConnectContract.parse(ok(success({ configs: [{ protocol: 'tuic', uri: 'tuic://u:secret@h:1', format: 'uri' }], service_health: 'unavailable' }))),
    ConnectContract.parse(ok(success({ access: { state: 'expired' } })))];
  for(const r of all) assert.doesNotMatch(JSON.stringify(r), /secret|mot-de-passe/);
});
