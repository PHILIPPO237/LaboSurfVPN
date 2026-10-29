// Retour haptique : pont discret vers le vibreur natif Android (LaboSurfNative.haptic, voir MainActivity.kt).
// Dans le navigateur et les tests (pas de pont), tout est silencieux : aucun appel n'est émis.
// Une interaction = une impulsion : ce module n'est jamais appelé depuis une boucle, un
// sondage ou une animation continue, et le service Vibrator respecte de lui-même
// les réglages système (retour haptique activé/désactivé par l'utilisateur).
(function(){
  'use strict';
  var bridge = null;
  try{
    if(window.LaboSurfNative && typeof window.LaboSurfNative.haptic === 'function') bridge = window.LaboSurfNative.haptic;
  }catch(e){ bridge = null; }

  var last = { kind:'', at:0 };
  function fire(kind){
    if(!bridge) return;
    var now = Date.now();
    if(kind === last.kind && now - last.at < 90) return;   // jamais de vibration double pour une même interaction
    last = { kind:kind, at:now };
    try{ bridge(kind); }catch(e){}
  }

  // Action déléguée -> type d'impulsion (core.js appelle Haptic.forAction avant l'action).
  // Action ordinaire = micro-impulsion ; bouton principal = plus marqué.
  var KIND_FOR_ACTION = { nav:'tap', openGuide:'tap', togglePower:'press' };

  window.Haptic = {
    tap:function(){ fire('tap'); },
    press:function(){ fire('press'); },
    confirm:function(){ fire('confirm'); },
    error:function(){ fire('error'); },
    forAction:function(action){ var k = KIND_FOR_ACTION[action]; if(k) fire(k); }
  };
})();
