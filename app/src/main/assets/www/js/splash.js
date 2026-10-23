// Animation d'ouverture 3D Premium (voir css/splash.css).
// Gère : la poussière cyber spatiale (canvas économe), le cycle de vie du splash,
// l'échappement au tap/retour Android et la libération complète des ressources après la transition.
(function(){
  var el = document.getElementById('splash');
  var canvas = document.getElementById('spStars');
  var waiting = [], done = !el;
  var animId = null;

  // Initialisation des particules légères
  if(canvas && !done){
    try{
      var ctx = canvas.getContext('2d');
      var W = canvas.width = window.innerWidth || 360;
      var H = canvas.height = window.innerHeight || 640;
      var particles = [];
      for(var i = 0; i < 28; i++){
        particles.push({
          x: Math.random() * W,
          y: Math.random() * H,
          z: Math.random() * 0.8 + 0.2,
          vx: (Math.random() - 0.5) * 0.25,
          vy: -Math.random() * 0.35 - 0.1,
          rad: Math.random() * 1.6 + 0.6,
          alpha: Math.random() * 0.5 + 0.2,
          color: Math.random() > 0.35 ? '#0af072' : '#06b6d4'
        });
      }

      function stepParticles(){
        if(done) return;
        ctx.clearRect(0, 0, W, H);
        for(var k = 0; k < particles.length; k++){
          var p = particles[k];
          p.x += p.vx * p.z;
          p.y += p.vy * p.z;
          if(p.y < 0){ p.y = H; p.x = Math.random() * W; }
          if(p.x < 0) p.x = W;
          if(p.x > W) p.x = 0;

          ctx.fillStyle = p.color;
          ctx.globalAlpha = p.alpha * p.z;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.rad * p.z, 0, Math.PI * 2);
          ctx.fill();
        }
        animId = requestAnimationFrame(stepParticles);
      }
      animId = requestAnimationFrame(stepParticles);
    }catch(e){}
  }

  function finish(){
    if(done) return;
    done = true;
    if(animId){ cancelAnimationFrame(animId); animId = null; }
    if(canvas){ canvas.width = 1; canvas.height = 1; } // Libère le buffer graphique
    el.hidden = true;
    waiting.splice(0).forEach(function(fn){ try{ fn(); }catch(e){} });
    document.dispatchEvent(new Event('splashdone'));
  }

  function skip(){ if(el && !done) el.classList.add('is-skipped'); }

  if(el){
    el.addEventListener('animationend', function(e){ if(e.target === el && e.animationName === 'spOut') finish(); });
    el.addEventListener('click', skip);
    try{ if(sessionStorage.getItem('ls.cacheCleared')) el.classList.add('is-skipped'); }catch(e){}
    setTimeout(finish, 5800); // Filet de sécurité
  }

  window.Splash = {
    isDone: function(){ return done; },
    skip: skip,
    whenDone: function(fn){ if(done) fn(); else waiting.push(fn); }
  };
})();
