'use strict';
// Thème du profil (js/profile-theme.js) : couche secondaire de l'identité LABOSURF. Couleur venue du Panel uniquement,
// validée, rendue lisible dans les deux thèmes ; absente ou invalide -> identité LABOSURF par défaut (aucune propriété posée).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ProfileOptions } = require('../../app/src/main/assets/www/js/contract.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'src', 'main', 'assets', 'www', 'js', 'profile-theme.js'), 'utf8');

function load(theme){
  const props = {}, attrs = { 'data-theme': theme || 'dark' }, listeners = {};
  const root = {
    getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = String(v); },
    style: { setProperty: (k, v) => { props[k] = v; }, removeProperty: (k) => { delete props[k]; } },
  };
  const document = { documentElement: root, addEventListener: (n, f) => { listeners[n] = f; } };
  const ctx = { document, window: {} };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { PT: ctx.window.ProfileTheme, props, attrs, ctx, fire: (n) => listeners[n] && listeners[n]() };
}

test('couleur : seul « #rrggbb » est accepté', () => {
  const { PT } = load();
  assert.equal(PT.parseHex('#39FF6A'), '#39ff6a');
  for (const bad of ['', null, undefined, '#fff', 'vert', '#12345g', 'rgb(1,2,3)', 42]) assert.equal(PT.parseHex(bad), '', String(bad));
});

test('priorité : profil du Panel, puis offre premium, puis identité LABOSURF', () => {
  const { PT } = load();
  assert.deepEqual(PT.resolve({ accent: '#4fd1ff' }, 'vip'), { hex: '#4fd1ff', source: 'profile' });
  assert.deepEqual(PT.resolve({ accent: '' }, 'vip'), { hex: '#d8b45a', source: 'plan' });
  assert.deepEqual(PT.resolve({ accent: 'invalide' }, 'gratuit'), { hex: '', source: 'default' });
  assert.deepEqual(PT.resolve(null, ''), { hex: '', source: 'default' });
});

test('lisibilité : contraste >= 3:1 sur le fond des deux thèmes, texte noir ou blanc selon le meilleur contraste', () => {
  const { PT } = load();
  for (const hex of ['#39ff6a', '#d8b45a', '#4fd1ff', '#0a0a0a', '#ffffff', '#b18cff', '#06361a']) {
    const d = PT.forTheme(hex, 'dark'), l = PT.forTheme(hex, 'light');
    assert.ok(PT.contrast(d.accent, '#020604') >= 3, `${hex} sombre -> ${d.accent}`);
    assert.ok(PT.contrast(l.accent, '#f3f6f2') >= 3, `${hex} clair -> ${l.accent}`);
    for (const t of [d, l]) {
      const other = t.on === '#ffffff' ? '#04140a' : '#ffffff';
      assert.ok(PT.contrast(t.accent, t.on) >= PT.contrast(t.accent, other), `${hex} : texte posé sur l'accent`);
    }
  }
  assert.equal(PT.forTheme('pas une couleur', 'dark'), null);
});

test('application : propriétés posées pour un accent, retirées pour l\'identité par défaut', () => {
  const { PT, props, attrs } = load();
  PT.apply({ hex: '#d8b45a', source: 'plan' });
  assert.equal(attrs['data-accent'], 'plan');
  assert.match(props['--accent'], /^#[0-9a-f]{6}$/);
  assert.ok(props['--accent-soft'].startsWith('rgba(') && props['--on-accent']);
  PT.apply({ hex: '', source: 'default' });
  assert.equal(attrs['data-accent'], 'default');
  assert.deepEqual(Object.keys(props), [], 'aucune couleur vide ou invalide posée : les jetons CSS LABOSURF s\'appliquent');
});

test('changement sombre <-> clair : le contraste est recalculé', () => {
  const t = load('dark');
  t.PT.apply({ hex: '#ffe680', source: 'profile' });
  const dark = t.props['--accent'];
  t.attrs['data-theme'] = 'light';
  t.fire('themechange');
  assert.notEqual(t.props['--accent'], dark, 'un jaune clair est assombri sur fond clair');
  assert.ok(t.PT.contrast(t.props['--accent'], '#f3f6f2') >= 3);
});

test('refresh : lit le profil choisi et l\'offre du compte réels, sans compte -> identité par défaut', () => {
  const t = load();
  t.ctx.getSelectedProfile = () => ({ accent: '#ff8a3d' });
  vm.runInContext('var Account = { last: { plan: "vip" } }; var authToken = "x";', t.ctx);
  t.PT.refresh();
  assert.equal(t.attrs['data-accent'], 'profile');
  t.ctx.getSelectedProfile = () => null;
  t.PT.refresh();
  assert.equal(t.attrs['data-accent'], 'plan');
  vm.runInContext('authToken = null;', t.ctx);
  t.PT.refresh();
  assert.equal(t.attrs['data-accent'], 'default');
});

test('contrat : theme.accent du Panel lu seulement s\'il est valide', () => {
  const r = ProfileOptions.parse({ ok: true, status: 200, data: { status: 'ok', options: [
    { hosted_profile_id: 1, profile_name: 'Or', theme: { accent: '#D8B45A' } },
    { hosted_profile_id: 2, profile_name: 'Sans' },
    { hosted_profile_id: 3, profile_name: 'Mauvais', theme: { accent: 'rouge' } },
    { hosted_profile_id: 4, profile_name: 'Pas un objet', theme: '#39ff6a' }] } });
  assert.deepEqual(r.options.map((o) => [o.id, o.accent]), [[1, '#d8b45a'], [2, ''], [3, ''], [4, '']]);
});
