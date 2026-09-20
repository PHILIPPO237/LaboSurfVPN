// Internationalisation (FR / EN).
// - Les textes vivent dans js/lang/fr.js et js/lang/en.js (mêmes clés dans les deux).
// - HTML statique : data-i18n="clé" (texte) et data-i18n-attr="placeholder:clé;aria-label:clé" (attributs).
// - JS : t('clé', {param}) et tn('clé', n) pour les pluriels (clé_one / clé_other).
// - Changer de langue : I18N.set('en') -> réapplique le HTML statique et émet l'événement "langchange",
//   que chaque module écoute pour redessiner son contenu dynamique.
(function(){
  var LS_KEY = 'ls.lang';
  var dicts = {};

  var I18N = {
    lang: 'fr',
    supported: ['fr', 'en'],
    locales: { fr: 'fr-FR', en: 'en-GB' },

    register: function(lang, dict){ dicts[lang] = dict; },

    // Langue enregistrée, sinon langue du téléphone, sinon français
    detect: function(){
      try{ var saved = JSON.parse(localStorage.getItem(LS_KEY)); if(I18N.supported.indexOf(saved) >= 0) return saved; }catch(e){}
      var nav = String((navigator.languages && navigator.languages[0]) || navigator.language || 'fr').toLowerCase();
      return nav.indexOf('fr') === 0 ? 'fr' : 'en';
    },

    t: function(key, params){
      var d = dicts[I18N.lang] || {};
      var s = d[key];
      if(s === undefined) s = (dicts.fr || {})[key];
      if(s === undefined) return key;
      if(params){
        s = s.replace(/\{(\w+)\}/g, function(m, k){ return params[k] !== undefined ? params[k] : m; });
      }
      return s;
    },

    // Pluriel : clé_one si n vaut 0 ou 1 (règle française) / 1 (règle anglaise), sinon clé_other
    tn: function(key, n, params){
      var one = I18N.lang === 'fr' ? (n === 0 || n === 1) : n === 1;
      var p = { n: n };
      if(params) for(var k in params) p[k] = params[k];
      return I18N.t(key + (one ? '_one' : '_other'), p);
    },

    apply: function(root){
      root = root || document;
      root.querySelectorAll('[data-i18n]').forEach(function(el){ el.textContent = I18N.t(el.getAttribute('data-i18n')); });
      root.querySelectorAll('[data-i18n-attr]').forEach(function(el){
        el.getAttribute('data-i18n-attr').split(';').forEach(function(pair){
          var i = pair.indexOf(':');
          if(i > 0) el.setAttribute(pair.slice(0, i).trim(), I18N.t(pair.slice(i + 1).trim()));
        });
      });
    },

    set: function(lang, persist){
      if(I18N.supported.indexOf(lang) < 0) return;
      I18N.lang = lang;
      if(persist !== false){ try{ localStorage.setItem(LS_KEY, JSON.stringify(lang)); }catch(e){} }
      document.documentElement.setAttribute('lang', lang);
      document.title = I18N.t('app.title');
      I18N.apply();
      document.dispatchEvent(new CustomEvent('langchange', { detail: lang }));
    },

    locale: function(){ return I18N.locales[I18N.lang] || 'fr-FR'; }
  };

  window.I18N = I18N;
  window.t = I18N.t;
  window.tn = I18N.tn;
})();
