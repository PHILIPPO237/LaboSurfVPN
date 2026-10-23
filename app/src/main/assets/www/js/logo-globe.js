// Logo animé : le globe du logo tourne lentement (une rotation en ~48 s), le cadre, le texte, la clé et l'anneau restent fixes.
// Rendu : la texture de sphère (img/globe3-tex.png, 360°) est projetée en orthographique sur un petit <canvas> ; les bords du globe
// sont assombris pour donner le volume. Aucune donnée, aucun état de connexion : décor uniquement.
// Sobriété : 30 images/s au maximum, arrêt quand la page est masquée, une seule image fixe si « réduire les animations ».
(function(){
  'use strict';
  var N = 256;                       // résolution du canvas (pixels)
  var PERIOD_MS = 48000;             // une rotation complète
  var FRAME_MS = 1000 / 30;
  var TEX_SRC = window.LG_TEX || 'img/globe3-tex.png';   // data:URI (globe-tex-data.js) : évite le blocage « canvas contaminé » de file:///android_asset

  var items = [];                    // { ctx, img }
  var tex = null;                    // { w, h, data }
  var map = null;                    // projection précalculée
  var raf = 0, last = 0, started = 0;
  var reduce = false;
  try { reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch(e){}

  function buildMap(){
    var n = N * N;
    var colBase = new Float32Array(n), row = new Int32Array(n), alpha = new Uint8Array(n);
    for(var j = 0; j < N; j++){
      for(var i = 0; i < N; i++){
        var k = j * N + i;
        var u = (i + .5) / N * 2 - 1, v = 1 - (j + .5) / N * 2;
        var r2 = u * u + v * v;
        if(r2 > 1){ alpha[k] = 0; continue; }
        var z = Math.sqrt(1 - r2);
        var lam = Math.atan2(u, z), phi = Math.asin(v);
        colBase[k] = (lam + Math.PI) / (2 * Math.PI) * tex.w;
        row[k] = Math.max(0, Math.min(tex.h - 1, ((.5 - phi / Math.PI) * tex.h) | 0));
        var r = Math.sqrt(r2);
        // volume : le centre est plein, les bords s'assombrissent ; bord extérieur adouci
        var shade = Math.pow(z, .28);
        var edge = r > .975 ? Math.max(0, (1 - r) / .025) : 1;
        alpha[k] = Math.round(255 * shade * edge);
      }
    }
    map = { colBase: colBase, row: row, alpha: alpha };
  }

  function draw(theta){
    // theta : 0..1 (tour complet) ; la surface défile de gauche à droite comme la Terre vue du dessus du pôle nord
    var shift = theta * tex.w;
    var tw = tex.w, td = tex.data;
    var out = items.length ? items[0].img : null;
    if(!out) return;
    var o = out.data;
    var cb = map.colBase, rw = map.row, al = map.alpha;
    for(var k = 0, n = N * N; k < n; k++){
      var a = al[k];
      if(!a){ o[k * 4 + 3] = 0; continue; }
      var c = cb[k] - shift;
      c = c - Math.floor(c / tw) * tw;
      var c0 = c | 0, f = c - c0, c1 = c0 + 1 === tw ? 0 : c0 + 1;
      var b0 = (rw[k] * tw + c0) * 4, b1 = (rw[k] * tw + c1) * 4;
      var ta0 = td[b0 + 3], ta1 = td[b1 + 3];
      var ta = ta0 + (ta1 - ta0) * f;
      if(ta <= 0){ o[k * 4 + 3] = 0; continue; }
      var w0 = (1 - f) * ta0, w1 = f * ta1, ws = w0 + w1 || 1;
      var p = k * 4;
      o[p]     = (td[b0] * w0 + td[b1] * w1) / ws;
      o[p + 1] = (td[b0 + 1] * w0 + td[b1 + 1] * w1) / ws;
      o[p + 2] = (td[b0 + 2] * w0 + td[b1 + 2] * w1) / ws;
      o[p + 3] = ta * a / 255;
    }
    for(var m = 0; m < items.length; m++){
      if(m > 0) items[m].img.data.set(o);
      items[m].ctx.putImageData(items[m].img, 0, 0);
    }
  }

  function loop(ts){
    raf = requestAnimationFrame(loop);
    if(ts - last < FRAME_MS) return;
    last = ts;
    if(!started) started = ts;
    draw(((ts - started) % PERIOD_MS) / PERIOD_MS);
  }
  function start(){ if(!raf && !reduce && items.length && !document.hidden) raf = requestAnimationFrame(loop); }
  function stop(){ if(raf){ cancelAnimationFrame(raf); raf = 0; } }

  function init(){
    var cvs = document.querySelectorAll('canvas.lg-globe');
    if(!cvs.length) return;
    for(var i = 0; i < cvs.length; i++){
      cvs[i].width = N; cvs[i].height = N;
      var ctx = cvs[i].getContext('2d');
      if(ctx) items.push({ ctx: ctx, img: ctx.createImageData(N, N) });
    }
    if(!items.length) return;
    var im = new Image();
    im.onload = function(){
      try{
        var c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
        var x = c.getContext('2d'); x.drawImage(im, 0, 0);
        tex = { w: c.width, h: c.height, data: x.getImageData(0, 0, c.width, c.height).data };
        buildMap();
        draw(0);                       // une image fixe tout de suite (aussi le rendu final si animations réduites)
        start();
      }catch(e){ /* décor : si la texture est illisible, le globe reste vide, rien d'autre ne change */ }
    };
    im.src = TEX_SRC;
    document.addEventListener('visibilitychange', function(){ if(document.hidden) stop(); else start(); });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
