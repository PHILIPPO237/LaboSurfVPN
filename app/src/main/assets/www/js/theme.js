// Thème : "dark" par défaut (identité de l'app), ou "system" (suit Android) / "light" au choix de la personne. Chargé dans <head> pour éviter
// tout flash au démarrage. L'apparence elle-même vit dans css/tokens.css.
(function(){
  var KEY = 'ls.theme';
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function read(){
    try{ var v = JSON.parse(localStorage.getItem(KEY)); if(v === 'light' || v === 'dark' || v === 'system') return v; }catch(e){}
    return 'dark';                                        // aucun choix enregistré -> thème sombre
  }
  var pref = read();

  function resolve(p){
    if(p === 'system') return (mq && !mq.matches) ? 'light' : 'dark';
    return p;
  }

  function apply(){
    var r = resolve(pref);
    document.documentElement.setAttribute('data-theme', r);
    document.dispatchEvent(new CustomEvent('themechange', { detail: r }));
    var meta = document.getElementById('metaTheme');
    if(meta) meta.setAttribute('content', r === 'dark' ? '#050705' : '#f2efe7');
    // Barre d'état / de navigation Android alignées sur le thème (pont natif, si présent)
    try{
      if(window.LaboSurfNative && typeof window.LaboSurfNative.setSystemBars === 'function'){
        window.LaboSurfNative.setSystemBars(r === 'dark');
      }
    }catch(e){}
  }

  window.Theme = {
    get: function(){ return pref; },
    resolved: function(){ return resolve(pref); },
    set: function(p){
      pref = p;
      try{ localStorage.setItem(KEY, JSON.stringify(p)); }catch(e){}
      apply();
    },
    apply: apply
  };

  if(mq){
    var onChange = function(){ if(pref === 'system') apply(); };
    if(mq.addEventListener) mq.addEventListener('change', onChange); else if(mq.addListener) mq.addListener(onChange);
  }
  apply();
})();
