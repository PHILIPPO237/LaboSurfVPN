'use strict';
// Diagnostic « Tester la connexion au panel » (api.js probeNetwork + activity.js Actions.testPanel) : il doit dire LAQUELLE des
// causes de « Failed to fetch » est en jeu — pas d'Internet, DNS, panel injoignable, réponse bloquée, erreur HTTP.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

const BASE = 'https://panel.example.tld';
const IP = 'https://1.1.1.1/cdn-cgi/trace';
const NAME = 'https://www.cloudflare.com/cdn-cgi/trace';
const fail = (msg) => new TypeError(msg || 'Failed to fetch');

// rules(url, mode) -> 'ok' | un code HTTP (nombre) | une Error à lever
function fakeFetch(rules){
  const seen = [];
  const fn = async (url, o) => {
    seen.push({ url, mode: o && o.mode, options: o });
    const r = rules(url, o && o.mode);
    if(r instanceof Error) throw r;
    return { status: typeof r === 'number' ? r : 200 };
  };
  return { seen, fn };
}
const app = () => loadApp({ native: { engine: { integrated: true, protocols: ['udp'] }, apiBase: BASE } });
const probe = (a, f, base) => a.ctx.probeNetwork(f.fn, base === undefined ? BASE : base);

test('tout fonctionne : verdict « ok », les 4 contrôles ont été faits', async () => {
  const a = app(), f = fakeFetch(() => 'ok');
  const p = await probe(a, f);
  assert.equal(p.verdict, 'ok');
  assert.equal(f.seen.length, 4);
  assert.equal(p.panelCors.status, 200);
});

test('aucun accès à Internet (même par adresse) : « no_internet »', async () => {
  const a = app(), f = fakeFetch(() => fail());
  assert.equal((await probe(a, f)).verdict, 'no_internet');
});

test('Internet par adresse mais pas par nom : « dns »', async () => {
  const a = app(), f = fakeFetch((u) => (u === IP ? 'ok' : fail('net::ERR_NAME_NOT_RESOLVED')));
  assert.equal((await probe(a, f)).verdict, 'dns');
});

test('Internet et DNS corrects mais panel non atteint : « panel_unreachable »', async () => {
  const a = app(), f = fakeFetch((u) => (u.startsWith(BASE) ? fail() : 'ok'));
  assert.equal((await probe(a, f)).verdict, 'panel_unreachable');
});

test('panel atteint (opaque) mais réponse refusée en mode cors : « blocked » (cas Cloudflare / CORS)', async () => {
  const a = app(), f = fakeFetch((u, mode) => (u.startsWith(BASE) && mode === 'cors' ? fail() : 'ok'));
  const p = await probe(a, f);
  assert.equal(p.verdict, 'blocked');
  assert.equal(p.panelReach.ok, true);
  assert.equal(p.panelCors.ok, false);
});

test('le panel répond mais avec une erreur HTTP : « http_status » avec le code', async () => {
  const a = app(), f = fakeFetch((u, mode) => (u.startsWith(BASE) && mode === 'cors' ? 503 : 'ok'));
  const p = await probe(a, f);
  assert.equal(p.verdict, 'http_status');
  assert.equal(p.panelCors.status, 503);
});

test('sans adresse de panel : « no_base », et aucune requête vers le panel', async () => {
  const a = app(), f = fakeFetch(() => 'ok');
  const p = await probe(a, f, '');
  assert.equal(p.verdict, 'no_base');
  assert.ok(f.seen.every((s) => !s.url.includes('panel.example.tld')));
});

test('un délai dépassé est rapporté comme tel', async () => {
  const a = app();
  const e = new Error('aborted'); e.name = 'AbortError';
  const f = fakeFetch((u) => (u === IP ? e : 'ok'));
  const p = await probe(a, f);
  assert.equal(p.internetIp.error, 'timeout');
  assert.equal(p.verdict, 'no_internet');
});

test('aucune donnée personnelle : ni jeton, ni en-tête, ni cookie dans les contrôles', async () => {
  const a = app();
  a.ev("authToken = 'jeton-secret-de-test'");
  const f = fakeFetch(() => 'ok');
  await probe(a, f);
  for(const s of f.seen){
    assert.equal(s.options.headers, undefined, s.url);
    assert.equal(s.options.credentials, 'omit', s.url);
    assert.ok(!JSON.stringify(s.options).includes('jeton'), s.url);
  }
});

test('l\'action du bouton enregistre le verdict, réactive le bouton et le met dans le rapport', async () => {
  const a = app();
  const f = fakeFetch((u, mode) => (u.startsWith(BASE) && mode === 'cors' ? fail() : 'ok'));
  a.ctx.fetch = f.fn;
  const btn = { disabled: false };
  a.ctx.__btn = btn;
  await a.ev('Actions.testPanel(__btn)');
  assert.equal(btn.disabled, false, 'le bouton est réactivé');
  assert.equal(a.ev('Activity.probe.verdict'), 'blocked');
  const rows = a.ev("probeRows(Activity.probe).map((r) => r.join(' : ')).join('\\n')");
  assert.match(rows, /Cloudflare|CORS/);
  assert.match(rows, /Internet \(par adresse\)/);
});

test('les textes du diagnostic existent en français et en anglais', () => {
  const a = app();
  const keys = ['diag.test', 'diag.testing', 'diag.p.ok', 'diag.p.fail', 'diag.p.internetIp', 'diag.p.internetName', 'diag.p.panelReach', 'diag.p.panelCors', 'diag.p.verdict']
    .concat(['ok', 'no_internet', 'dns', 'panel_unreachable', 'blocked', 'http_status', 'no_base'].map((v) => 'diag.v.' + v));
  for(const lang of ['fr', 'en']){
    a.ev(`I18N.set('${lang}', false)`);
    for(const k of keys){
      const txt = a.ev(`t('${k}')`);
      assert.ok(txt && txt !== k, `${lang} : ${k}`);
    }
  }
});
