'use strict';
// Traductions : mêmes clés en FR et EN, aucun texte de connexion manquant, aucune clé utilisée sans traduction.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ConnectContract } = require('../../app/src/main/assets/www/js/contract.js');
const { WWW } = require('./harness.js');

function dict(lang){
  const out = {};
  vm.runInContext(fs.readFileSync(path.join(WWW, 'js', 'lang', lang + '.js'), 'utf8'), vm.createContext({ I18N: { register(l, d){ out[l] = d; } } }));
  return out[lang];
}
const fr = dict('fr'), en = dict('en');

test('FR et EN ont exactement les mêmes clés', () => {
  const onlyFr = Object.keys(fr).filter((k) => !(k in en));
  const onlyEn = Object.keys(en).filter((k) => !(k in fr));
  assert.deepEqual(onlyFr, [], 'clés absentes de en.js');
  assert.deepEqual(onlyEn, [], 'clés absentes de fr.js');
});

test('chaque code d\'erreur de POST /api/user/connect a un texte FR et EN', () => {
  for(const key of Object.values(ConnectContract.ERROR_CODES).concat(['conn.err.badResponse', 'conn.err.unknown', 'conn.retryIn', 'err.offline', 'err.apiConfig', 'err.apiInsecure',
    'err.protocolUnsupported', 'err.invalidConfig', 'err.engineUnavailable', 'err.vpnPermission', 'err.timeout', 'err.panel', 'log.engineUnavailable', 'log.healthUnknown',
    'access.fiveMin', 'access.ended', 'acc.menu.panel', 'acc.menu.panelSub'])){
    assert.ok(typeof fr[key] === 'string' && fr[key].trim(), 'fr : ' + key);
    assert.ok(typeof en[key] === 'string' && en[key].trim(), 'en : ' + key);
  }
});

test('les paramètres {…} des textes existent dans les deux langues', () => {
  const params = (s) => (String(s).match(/\{(\w+)\}/g) || []).sort().join(',');
  for(const k of Object.keys(fr)) if(k in en) assert.equal(params(fr[k]), params(en[k]), k);
});

test('toute clé écrite en dur dans le code (t(\'…\'), data-i18n) existe', () => {
  const files = ['index.html'].concat(fs.readdirSync(path.join(WWW, 'js')).filter((f) => f.endsWith('.js')).map((f) => 'js/' + f));
  const missing = [];
  for(const f of files){
    const text = fs.readFileSync(path.join(WWW, f), 'utf8');
    const keys = new Set();
    let m;
    const rxT = /\bt\(\s*'([a-zA-Z][\w.]*)'/g, rxN = /\btn\(\s*'([a-zA-Z][\w.]*)'/g, rxD = /data-i18n="([a-zA-Z][\w.]*)"/g;
    while((m = rxT.exec(text))) keys.add(m[1]);
    while((m = rxD.exec(text))) keys.add(m[1]);
    while((m = rxN.exec(text))) { keys.add(m[1] + '_one'); keys.add(m[1] + '_other'); }
    for(const k of keys) if(!k.endsWith('.') && !(k in fr)) missing.push(f + ' : ' + k);   // « t('plan.' + x) » : préfixe dynamique, ignoré
  }
  assert.deepEqual(missing, []);
});
