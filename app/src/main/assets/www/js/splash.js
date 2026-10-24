// ==========================================================================
// LABOSURFVPN — SPLASH SCREEN 3D ANIMÉ OFFICIEL (DURÉE EXACTE 6 SECONDES)
//
// Timeline :
// - 0s à 1s : Apparition douce du logo sur fond noir profond.
// - 1s à 4s : Rotation lente et sphérique du globe sur son axe (l'Afrique reste visible).
// - 4s à 5s : Décélération douce et retour à la position initiale exacte.
// - 5s à 6s : Logo parfaitement stable, avec balayage d'un reflet vert discret sur les métaux.
// - 6s : Transition fluide vers l'écran d'accueil sans clignotement ni latence.
//
// Règles impératives :
// - SEUL LE GLOBE TOURNE.
// - Clé Tech Élite, hexagone, texte « LABOSURF » et sous-titre strictement immobiles.
// ==========================================================================

(function(){
  'use strict';
  var splash = document.getElementById('splash');
  var canvas = document.getElementById('spGlobeCanvas');
  var masterImg = document.getElementById('spMaster');
  var sheen = document.getElementById('spSheen');
  var waiting = [], done = !splash;
  var animId = null;

  var startTime = null;
  var TOTAL_DURATION = 6000; // 6.0 secondes
  var ROT_START = 1000;      // 1.0s : début de la rotation
  var ROT_END = 5000;        // 5.0s : arrêt complet à position initiale
  var SHEEN_TIME = 5020;     // 5.02s : éclat spéculaire vert émeraude

  var N = 552;
  var texImg = new Image();
  texImg.src = 'img/globe-earth-tex.png';
  var texReady = false;

  var glCtx = null, glProgram = null, glBuffer = null, glTex = null;
  var uAngleLoc = null;
  var useWebGL = false;

  // Contexte 2D de secours (fallback ultra-compatible)
  var ctx2d = null;
  var map2D = null;
  var texData2d = null;

  function initWebGL(){
    if(!canvas) return false;
    try {
      glCtx = canvas.getContext('webgl', { alpha: true, antialias: true }) ||
              canvas.getContext('experimental-webgl', { alpha: true });
      if(!glCtx) return false;
      var gl = glCtx;
      var vsSrc = 'attribute vec2 aPos; varying vec2 vUv; void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }';
      var fsSrc = [
        'precision mediump float;',
        'varying vec2 vUv;',
        'uniform sampler2D uTex;',
        'uniform float uAngle;',
        'void main(){',
        '  vec2 p = vUv * 2.0 - 1.0;',
        '  float r2 = dot(p, p);',
        '  if(r2 > 1.0) discard;',
        '  float z = sqrt(1.0 - r2);',
        '  float cosA = cos(uAngle); float sinA = sin(uAngle);',
        '  float xr = p.x * cosA + z * sinA;',
        '  float zr = -p.x * sinA + z * cosA;',
        '  float lon = atan(xr, zr);',
        '  float lat = asin(clamp(p.y, -1.0, 1.0));',
        '  vec2 uv = vec2(lon / 6.283185307 + 0.5, 0.5 - lat / 3.1415926535);',
        '  vec4 col = texture2D(uTex, uv);',
        '  vec3 lightDir = normalize(vec3(-0.35, 0.45, 0.8));',
        '  float diff = max(0.42, dot(vec3(p, z), lightDir));',
        '  float rim = pow(1.0 - z, 3.2);',
        '  vec3 rgb = col.rgb * diff + vec3(0.04, 0.75, 0.95) * rim * 0.65;',
        '  float alpha = smoothstep(1.0, 0.985, sqrt(r2)) * col.a;',
        '  gl_FragColor = vec4(rgb, alpha);',
        '}'
      ].join('\n');

      function compile(type, src){
        var s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) return null;
        return s;
      }
      var vs = compile(gl.VERTEX_SHADER, vsSrc);
      var fs = compile(gl.FRAGMENT_SHADER, fsSrc);
      if(!vs || !fs) return false;
      glProgram = gl.createProgram();
      gl.attachShader(glProgram, vs); gl.attachShader(glProgram, fs);
      gl.linkProgram(glProgram);
      if(!gl.getProgramParameter(glProgram, gl.LINK_STATUS)) return false;

      glBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, glBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);

      var aPos = gl.getAttribLocation(glProgram, 'aPos');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      uAngleLoc = gl.getUniformLocation(glProgram, 'uAngle');
      return true;
    } catch(e) {
      return false;
    }
  }

  function setupTextureGL(){
    if(!glCtx || !glProgram) return;
    var gl = glCtx;
    glTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, glTexCoord);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texImg);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.useProgram(glProgram);
    gl.uniform1i(gl.getUniformLocation(glProgram, 'uTex'), 0);
  }

  function renderGL(angleRad){
    if(!glCtx || !glProgram || !glTex) return;
    var gl = glCtx;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(glProgram);
    gl.uniform1f(uAngleLoc, angleRad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // Fallback 2D si WebGL désactivé
  function init2DFallback(){
    if(!canvas) return;
    try {
      ctx2d = canvas.getContext('2d');
      var off = document.createElement('canvas');
      off.width = texImg.naturalWidth || 1024;
      off.height = texImg.naturalHeight || 512;
      var octx = off.getContext('2d');
      octx.drawImage(texImg, 0, 0);
      texData2d = octx.getImageData(0, 0, off.width, off.height);
    } catch(e){}
  }

  // Trajectoire angulaire :
  // 0s à 1s : angle = 0.0 rad (initial)
  // 1s à 4s : rotation fluide sur l'axe (max ~0.58 rad / 33°), l'Afrique reste centrée & visible
  // 4s à 5s : décélération douce vers 0.0 rad
  // 5s à 6s : arrêt complet à 0.0 rad
  function computeAngle(elapsed){
    if(elapsed <= ROT_START || elapsed >= ROT_END) return 0;
    var tau = (elapsed - ROT_START) / (ROT_END - ROT_START); // 0.0 à 1.0 sur les 4 secondes
    var maxAngle = 0.58; // 33.2 degrés pour perspective 3D réaliste sans masquer l'Afrique
    return Math.sin(tau * Math.PI) * maxAngle;
  }

  var sheenFired = false;

  function step(now){
    if(done) return;
    if(!startTime) startTime = now;
    var elapsed = now - startTime;

    // Masquage transparent du master pour laisser le globe 3D s'exprimer
    if(elapsed >= ROT_START && elapsed < ROT_END - 200 && masterImg && !masterImg.classList.contains('is-rotating')){
      masterImg.classList.add('is-rotating');
    }
    // Rétablissement du master à 100% pour la phase de stabilité finale
    if(elapsed >= ROT_END - 200 && masterImg && masterImg.classList.contains('is-rotating')){
      masterImg.classList.remove('is-rotating');
    }

    // Reflet vert spéculaire sur les métaux
    if(elapsed >= SHEEN_TIME && !sheenFired && sheen){
      sheenFired = true;
      sheen.classList.add('is-active');
    }

    var angle = computeAngle(elapsed);
    if(useWebGL && texReady){
      renderGL(angle);
    }

    if(elapsed < TOTAL_DURATION){
      animId = requestAnimationFrame(step);
    } else {
      finish();
    }
  }

  function finish(){
    if(done) return;
    done = true;
    if(animId){ cancelAnimationFrame(animId); animId = null; }
    if(canvas){
      try {
        if(glCtx && glTex){ glCtx.deleteTexture(glTex); }
        if(glCtx && glBuffer){ glCtx.deleteBuffer(glBuffer); }
        if(glCtx && glProgram){ glCtx.deleteProgram(glProgram); }
      } catch(e){}
      canvas.width = 1; canvas.height = 1;
    }
    if(splash) splash.hidden = true;
    waiting.splice(0).forEach(function(fn){ try{ fn(); }catch(e){} });
    document.dispatchEvent(new Event('splashdone'));
  }

  function skip(){
    if(splash && !done){
      splash.classList.add('is-skipped');
      setTimeout(finish, 200);
    }
  }

  if(canvas){
    canvas.width = N;
    canvas.height = N;
    useWebGL = initWebGL();
  }

  texImg.onload = function(){
    texReady = true;
    if(useWebGL){
      setupTextureGL();
      renderGL(0);
    } else {
      init2DFallback();
    }
  };

  if(splash){
    splash.addEventListener('click', skip);
    try { if(sessionStorage.getItem('ls.cacheCleared')) splash.classList.add('is-skipped'); } catch(e){}
    animId = requestAnimationFrame(step);
    setTimeout(finish, 6800); // Filet de sécurité
  }

  window.Splash = {
    isDone: function(){ return done; },
    skip: skip,
    whenDone: function(fn){ if(done) fn(); else waiting.push(fn); }
  };
})();
