'use strict';
// Contrat RÉEL : réponses produites par la vraie route POST /api/user/connect du Laboratoire du Free-Surf
// (app/routers/user.py + app/core/pro/connect.py, branche phase4-real-user-connect), capturées avec le vrai code du panel
// et un faux labosurf-agent (fixtures/panel_connect_samples.json ; identifiants de test uniquement).
// Le client Android doit lire exactement ce que le panel émet, sans hypothèse.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { ConnectContract } = require('../../app/src/main/assets/www/js/contract.js');
const samples = require('./fixtures/panel_connect_samples.json');

const asRes = (s) => ({ ok: s.http_status >= 200 && s.http_status < 300, status: s.http_status, data: s.body, expired: false });

test('réponse réelle de succès : config, santé, Access, server_id', () => {
  const r = ConnectContract.parse(asRes(samples.success));
  assert.equal(r.ok, true);
  assert.equal(r.config.protocol, 'tuic');
  assert.equal(r.config.format, 'uri');
  assert.equal(r.config.uri, samples.success.body.configs[0].uri);
  assert.equal(r.serverId, samples.success.body.server_id);
  assert.equal(r.health, 'available');
  assert.equal(r.access.state, 'active');
  assert.equal(typeof r.access.expiresAt, 'number');
  assert.deepEqual(Object.keys(samples.success.body).sort(), ['access', 'configs', 'server_id', 'service_health', 'status'], 'le panel n\'a ajouté aucun champ que l\'interface ignore silencieusement');
});

test('réponses réelles d\'erreur : code stable -> texte de l\'application', () => {
  for(const name of ['service_unhealthy', 'service_not_found', 'subscription_expired', 'account_disabled', 'configuration_unavailable', 'pro_authentication_failed']){
    const r = ConnectContract.parse(asRes(samples[name]));
    assert.equal(r.ok, false, name);
    assert.equal(r.code, name);
    assert.equal(r.key, 'conn.err.' + name);
  }
  assert.equal(ConnectContract.parse(asRes(samples.service_unhealthy)).retryAfter, samples.service_unhealthy.body.retry_after_s);
  assert.equal(ConnectContract.parse(asRes(samples.configuration_unavailable)).retryAfter, samples.configuration_unavailable.body.retry_after_s);
  assert.equal(ConnectContract.parse(asRes(samples.subscription_expired)).retryAfter, null);
});

test('réponse réelle 401 : perte d\'authentification', () => {
  const r = ConnectContract.parse(asRes(samples.user_not_authenticated));
  assert.equal(r.authLost, true);
  assert.equal(r.code, 'user_not_authenticated');
});

test('les réponses d\'erreur réelles ne contiennent aucune configuration ni secret', () => {
  for(const [name, s] of Object.entries(samples)){
    if(name === 'success') continue;
    assert.equal(s.body.configs, undefined, name);
    assert.doesNotMatch(JSON.stringify(s.body), /tuic:\/\/|uuid|password|secret|panel-runtime|127\.0\.0\.1|9443/i, name);
  }
});
