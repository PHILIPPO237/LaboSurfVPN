// Animation d'ouverture (voir css/splash.css). L'animation et son retrait sont gérés par CSS ;
// ce module ne fait que : la retirer proprement de l'accessibilité, permettre de la passer (tap / retour Android)
// et prévenir les modules qui doivent attendre sa fin (ex. la présentation de première ouverture).
(function(){
  var el = document.getElementById('splash');
  var waiting = [], done = !el;

  function finish(){
    if(done) return;
    done = true;
    el.hidden = true;                       // sorti de l'arbre d'accessibilité et du rendu
    waiting.splice(0).forEach(function(fn){ try{ fn(); }catch(e){} });
    document.dispatchEvent(new Event('splashdone'));
  }
  function skip(){ if(el && !done) el.classList.add('is-skipped'); }

  if(el){
    el.addEventListener('animationend', function(e){ if(e.target === el && e.animationName === 'spOut') finish(); });
    el.addEventListener('click', skip);
    try{ if(sessionStorage.getItem('ls.cacheCleared')) el.classList.add('is-skipped'); }catch(e){}   // rechargement volontaire : pas d'animation
    setTimeout(finish, 6500);               // filet de sécurité si aucun événement d'animation n'arrive
  }

  window.Splash = {
    isDone: function(){ return done; },
    skip: skip,
    whenDone: function(fn){ if(done) fn(); else waiting.push(fn); }
  };
})();
