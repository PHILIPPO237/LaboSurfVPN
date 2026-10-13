// Thème du profil : couche SECONDAIRE de l'identité LABOSURF (voir css/tokens.css, section « Accent »).
//
//   identité LABOSURF (vert néon : logo, bouton START, navigation, état connecté) — ne change jamais
// + accent du profil (carte et pastille du profil, halo de session, indicateurs de l'accueil)
// = interface personnalisée
//
// Source de l'accent, par ordre de priorité, toujours une donnée RÉELLE :
//   1. le profil choisi, si le Panel lui a donné une couleur (GET /api/user/connect/options → theme.accent) ;
//   2. l'offre du compte : VIP / revendeur / admin → or premium (déjà réservé à PREMIUM dans les jetons) ;
//   3. sinon l'identité LABOSURF par défaut (aucune propriété posée : les jetons CSS s'appliquent).
// Une couleur absente ou invalide n'est jamais appliquée. La couleur est ajustée pour rester lisible (contraste ≥ 3:1
// sur le fond du thème sombre ou clair) et le texte posé dessus est choisi noir ou blanc selon le meilleur contraste.
(function(){
  'use strict';
  var HEX = /^#[0-9a-f]{6}$/i;
  var PLAN_ACCENT = { vip: '#d8b45a', revendeur: '#d8b45a', admin: '#d8b45a' };   // or premium (--gold du thème sombre)
  var BG = { dark: '#020604', light: '#f3f6f2' };
  var MIN_CONTRAST = 3;
  var PROPS = ['--accent', '--accent-rgb', '--accent-soft', '--accent-line', '--accent-glow', '--on-accent'];

  function parseHex(v){ return typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toLowerCase() : ''; }
  function rgb(hex){ var n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function toHex(c){ return '#' + c.map(function(x){ return ('0' + Math.round(Math.max(0, Math.min(255, x))).toString(16)).slice(-2); }).join(''); }
  function lum(hex){
    var c = rgb(hex).map(function(v){ v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b){ var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function mix(hex, toward, t){ var a = rgb(hex), b = rgb(toward); return toHex(a.map(function(v, i){ return v + (b[i] - v) * t; })); }

  // Couleur lisible sur le fond du thème : éclaircie (sombre) ou assombrie (clair) par petits pas, jamais remplacée.
  function forTheme(hex, mode){
    var c = parseHex(hex);
    if(!c) return null;
    var bg = BG[mode === 'light' ? 'light' : 'dark'], toward = mode === 'light' ? '#000000' : '#ffffff';
    for(var i = 0; i < 12 && contrast(c, bg) < MIN_CONTRAST; i++) c = mix(c, toward, 0.12);
    var on = contrast(c, '#04140a') >= contrast(c, '#ffffff') ? '#04140a' : '#ffffff';
    var r = rgb(c).join(',');
    return {
      accent: c, rgb: r, on: on,
      soft: 'rgba(' + r + ',' + (mode === 'light' ? '.10' : '.14') + ')',
      line: 'rgba(' + r + ',' + (mode === 'light' ? '.34' : '.40') + ')',
      glow: 'rgba(' + r + ',' + (mode === 'light' ? '.18' : '.38') + ')',
    };
  }

  // Accent voulu à partir des données réelles : { hex, source: 'profile' | 'plan' | 'default' }
  function resolve(profile, plan){
    var p = profile && parseHex(profile.accent);
    if(p) return { hex: p, source: 'profile' };
    if(plan && PLAN_ACCENT[plan]) return { hex: PLAN_ACCENT[plan], source: 'plan' };
    return { hex: '', source: 'default' };
  }

  var current = { hex: '', source: 'default' };
  function mode(){ return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }

  function apply(want){
    current = want && want.hex ? want : { hex: '', source: 'default' };
    var root = document.documentElement, t = current.hex ? forTheme(current.hex, mode()) : null;
    root.setAttribute('data-accent', current.source);
    if(!t){ PROPS.forEach(function(p){ root.style.removeProperty(p); }); return; }   // identité LABOSURF : jetons CSS par défaut
    root.style.setProperty('--accent', t.accent);
    root.style.setProperty('--accent-rgb', t.rgb);
    root.style.setProperty('--accent-soft', t.soft);
    root.style.setProperty('--accent-line', t.line);
    root.style.setProperty('--accent-glow', t.glow);
    root.style.setProperty('--on-accent', t.on);
  }

  // Relit le profil choisi et l'offre du compte (globales des autres modules, si elles existent) puis applique.
  function refresh(){
    var profile = null, plan = '';
    try{ if(typeof getSelectedProfile === 'function') profile = getSelectedProfile(); }catch(e){}
    try{ if(typeof Account !== 'undefined' && Account.last && typeof authToken !== 'undefined' && authToken) plan = Account.last.plan || ''; }catch(e){}
    apply(resolve(profile, plan));
  }

  document.addEventListener('themechange', function(){ apply(current); });   // sombre <-> clair : contraste recalculé

  window.ProfileTheme = { parseHex: parseHex, contrast: contrast, forTheme: forTheme, resolve: resolve, apply: apply, refresh: refresh,
    current: function(){ return current; } };
})();
