'use strict';
// Chaîne PRO → Panel → VPN : le VPN ne lit que le contrat du Panel et n'appelle jamais PRO.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('./harness.js');

const app = () => loadApp({ native: { engine: { integrated: false, protocols: [] }, apiBase: 'https://panel.example.tld' } });
const WWW = path.join(__dirname, '..', '..', 'app', 'src', 'main', 'assets', 'www');
const hidden = (a, id) => a.ev(`document.getElementById('${id}').hidden`);
const render = (a, me) => a.ev(`renderAccountCard(accountFromApi(${JSON.stringify(me)}, {}, ''))`);

test('le VPN n\'appelle jamais LABOSURF_PRO : aucune route PRO / Agent dans les écrans', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of walk(WWW).filter((p) => /\.(js|html)$/.test(p))) {
    const s = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /\/api\/v1\/access|access_usage|labosurf-agent\s*:\s*\d|:8443\/api/, f);
  }
});

for (const reason of ['no_access', 'engine_not_metered', 'measure_unavailable', 'pro_unavailable', 'pro_not_configured', 'invalid_measure']) {
  test(`indisponible (${reason}) : « Consommation indisponible », jamais 0, jamais de barre`, () => {
    const a = app();
    const me = { type: 'VIP', username: 'alice', quota_gb: 10, usage_available: false, usage_reason: reason,
      quota_used_gb: null, usage_quota_gb: null, remaining_gb: null, usage_percent: null };
    const acc = a.ev(`accountFromApi(${JSON.stringify(me)}, {}, '')`);
    assert.equal(acc.usageReason, reason);
    assert.equal(acc.quotaUsedGB, null);
    render(a, me);
    assert.equal(hidden(a, 'passQTrack'), true);
    assert.equal(a.ev("document.getElementById('passQVal').textContent"), 'Indisponible');
    assert.match(a.ev("document.getElementById('passQNote').textContent"), /indisponible/);
  });
}

test('mesure à 0 réellement mesurée : barre vide (0 %), ce n\'est PAS « indisponible »', () => {
  const a = app();
  render(a, { type: 'VIP', username: 'alice', quota_gb: 10, usage_available: true, quota_used_gb: 0, usage_quota_gb: 10, remaining_gb: 10, usage_percent: 0 });
  assert.equal(hidden(a, 'passQTrack'), false);
  assert.equal(a.ev("document.getElementById('passQVal').textContent"), '0 Ko');
  assert.equal(a.ev("document.getElementById('passQFill').style.width"), '0%');
});

test('quota dépassé : barre pleine plafonnée à 100 %, « Quota atteint », pas de valeur négative', () => {
  const a = app();
  render(a, { type: 'VIP', username: 'alice', quota_gb: 10, usage_available: true, quota_used_gb: 12, usage_quota_gb: 10, remaining_gb: 0, usage_percent: 100 });
  assert.equal(a.ev("document.getElementById('passQFill').style.width"), '100%');
  assert.equal(a.ev("document.getElementById('passQNote').textContent"), 'Quota atteint');
});

test("profil : l'accès au panel est un bouton (plus un lien), affiché seulement si le panel est joignable", () => {
  const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
  assert.match(html, /<div class="panel-cta" id="accPanelRow" hidden>[\s\S]*?<button class="btn btn-primary btn-block"[^>]*data-action="openPanel"/);
  assert.doesNotMatch(html, /class="row"[^>]*data-action="openPanel"/, 'plus de ligne-lien');
  const a = app();
  assert.equal(a.ev("t('acc.panelBtn')"), 'Accès au panel');
  a.ev("I18N.set('en', false)");
  assert.equal(a.ev("t('acc.panelBtn')"), 'Open the panel');
  assert.match(fs.readFileSync(path.join(WWW, 'js', 'account.js'), 'utf8'), /\$\('accPanelRow'\)\.hidden = !API\.state\.ok/);
});

