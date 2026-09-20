'use strict';
// Identité visuelle : les deux thèmes définissent les mêmes jetons, les contrastes restent lisibles (WCAG AA),
// et aucun vert « néon » n'est réintroduit en dur en dehors du logo (jeton --logo-*) et des styles de bannière choisis par l'admin.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const WWW = path.join(__dirname, '..', '..', 'app', 'src', 'main', 'assets', 'www');
const read = (f) => fs.readFileSync(path.join(WWW, f), 'utf8');
const tokens = read('css/tokens.css');

function block(selectorStart) {
  const i = tokens.indexOf(selectorStart);
  assert.ok(i >= 0, selectorStart);
  const open = tokens.indexOf('{', i);
  let depth = 0, j = open;
  for (; j < tokens.length; j++) { if (tokens[j] === '{') depth++; if (tokens[j] === '}' && --depth === 0) break; }
  return tokens.slice(open + 1, j);
}
function vars(body) {
  const out = {};
  body.replace(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi, (_, k, v) => { out[k] = v.trim(); return ''; });
  return out;
}
const dark = vars(block(':root{\n  color-scheme: dark;'));
const light = vars(block(':root[data-theme="light"]'));

const lum = (hex) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('les deux thèmes redéfinissent les mêmes jetons de couleur (pas de thème à moitié fini)', () => {
  const colorKeys = (o) => Object.keys(o).filter((k) => !/^--(font|fs|r|sp|tap|maxw|ease|spring|dur|z|shadow-|ring|state|logo)/.test(k));
  const missingInLight = colorKeys(dark).filter((k) => !(k in light) && !['--btn-fill', '--font-emoji'].includes(k));
  // Ce qui est volontairement commun aux deux thèmes (couleurs sémantiques identiques, etc.) est listé ici, rien d'autre.
  const allowedShared = ['--orange-soft', '--orange'];
  const real = missingInLight.filter((k) => !allowedShared.includes(k));
  assert.deepEqual(real, [], 'jetons du thème sombre absents du thème clair : ' + real.join(', '));
});

test('palette sombre de référence', () => {
  assert.equal(dark['--bg'], '#050706');
  assert.equal(dark['--bg-2'], '#08100b');
  assert.equal(dark['--surface'], '#0d1510');
  assert.equal(dark['--surface-2'], '#111a14');
  assert.equal(dark['--brand'], '#19c763');
  assert.equal(dark['--brand-hi'], '#35e879');
  assert.equal(dark['--brand-deep'], '#07351d');
  assert.equal(dark['--text'], '#f1f5f2');
  assert.equal(dark['--text-muted'], '#b7c0ba');
  assert.equal(dark['--text-faint'], '#7d8981');
  assert.equal(dark['--gold'], '#d8b45a');
});

test('le logo garde son contour d\'origine (jeton --logo-line inchangé)', () => {
  assert.match(tokens, /--logo-line:#39ff6a/);
});

test('contrastes lisibles (WCAG AA) dans les deux thèmes', () => {
  for (const [name, t] of [['sombre', dark], ['clair', light]]) {
    const surface = t['--surface'];
    const pairs = [
      ['texte / carte', t['--text'], surface, 4.5],
      ['texte secondaire / carte', t['--text-muted'], surface, 4.5],
      ['texte discret / carte', t['--text-faint'], surface, 4.5],
      ['texte discret / fond', t['--text-faint'], t['--bg'], 4.5],
      ['vert / carte', t['--brand'], surface, 4.5],
      ['titres de section / carte', t['--brand-title'], surface, 4.5],
      ['or PREMIUM / carte', t['--gold'], surface, 4.5],
      ['avertissement / carte', t['--warning'], surface, 4.5],
      ['danger / carte', t['--danger'], surface, 4.5],
      ['texte du bouton principal / début du dégradé', t['--on-btn'], t['--btn-from'], 4.5],
      ['texte du bouton principal / fin du dégradé', t['--on-btn'], t['--btn-to'], 4.5],
      ['texte sur aplat vert', t['--on-brand'], t['--brand'], 4.5],
      ['icône de navigation inactive / carte', t['--rail-icon'], t['--rail-bg'], 3],
    ];
    for (const [label, fg, bg, min] of pairs) {
      assert.ok(/^#[0-9a-f]{6}$/i.test(fg) && /^#[0-9a-f]{6}$/i.test(bg), `${name} : ${label} doit être une couleur unie (${fg} / ${bg})`);
      const c = contrast(fg, bg);
      assert.ok(c >= min, `${name} : ${label} = ${c.toFixed(2)} (minimum ${min})`);
    }
  }
});

test('aucun vert néon en dur hors logo et styles de bannière choisis dans le panel admin', () => {
  const NEON = /39ff6a|57,\s?255,\s?106|9dffb6|c4ffd3|8dffab|#16c751|#00ff41/i;
  const files = ['css/base.css', 'css/components.css', 'css/screens.css', 'css/splash.css', 'index.html', 'js/banner.js', 'js/theme.js'];
  for (const f of files) {
    for (const [i, line] of read(f).split('\n').entries()) {
      if (!NEON.test(line)) continue;
      // styles nommés du panel admin (Publicités) : « neon » est un choix explicite de l'annonceur, pas la palette de l'app
      assert.ok(/banner-style-(neon|hacker)/.test(line), `${f}:${i + 1} contient un vert néon en dur : ${line.trim().slice(0, 100)}`);
    }
  }
});

test('l\'or reste réservé à PREMIUM : plus utilisé pour les états de connexion ni les jauges', () => {
  assert.equal(tokens.match(/--state-busy:var\(--warning\)/) !== null, true);
  const screens = read('css/screens.css') + read('css/components.css');
  assert.doesNotMatch(screens, /\.gauge-fill\.mid\{[^}]*var\(--gold\)/);
  assert.doesNotMatch(screens, /\.status-pill\.busy\{[^}]*var\(--gold\)/);
  assert.doesNotMatch(screens, /\.load-bar i\.mid\{[^}]*var\(--gold\)/);
});
