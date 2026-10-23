// « À propos » (Avant-propos du Panel) : apparition progressive des sections au défilement, et boutons « Devenir VIP / Revendeur »
// qui ouvrent la page « Abonnement » du Panel (même mécanisme que les autres liens vers le Panel : Actions.openPanel).
(function(){
  'use strict';
  var reduce = false;
  try { reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch(e){}

  function initReveal(){
    var els = document.querySelectorAll('#screen-about .ap-reveal');
    if(!els.length) return;
    if(reduce || !('IntersectionObserver' in window)){ for(var i = 0; i < els.length; i++) els[i].classList.add('visible'); return; }
    document.documentElement.classList.add('ap-js');
    var io = new IntersectionObserver(function(list){
      list.forEach(function(en){ if(en.isIntersecting){ en.target.classList.add('visible'); io.unobserve(en.target); } });
    }, { threshold: .08 });
    for(var j = 0; j < els.length; j++) io.observe(els[j]);
    // filet de sécurité : si l'observateur ne se déclenche jamais, tout reste lisible
    setTimeout(function(){ for(var k = 0; k < els.length; k++) els[k].classList.add('visible'); }, 6000);
  }

  function open(path){
    try { if(window.Actions && typeof Actions.openPanel === 'function') Actions.openPanel(path); } catch(e){}
  }
  document.addEventListener('click', function(ev){
    var b = ev.target.closest && ev.target.closest('[data-ap-panel]');
    if(b) open(b.getAttribute('data-ap-panel'));
  });
  document.addEventListener('keydown', function(ev){
    if(ev.key !== 'Enter' && ev.key !== ' ') return;
    var b = ev.target.closest && ev.target.closest('[data-ap-panel]');
    if(b){ ev.preventDefault(); open(b.getAttribute('data-ap-panel')); }
  });

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initReveal); else initReveal();
})();
