// ==========================================================================
// LABOSURFVPN — SPLASH SCREEN 3D ANIMÉ OFFICIEL (DURÉE : 8 SECONDES)
// Fond : Galaxie cosmique mouvementée 3D (starfield hyperspatial, nébuleuses)
//
// Timeline :
// - 0s à 1.2s : Vol à travers la galaxie et apparition douce du logo officiel.
// - 1.2s à 5.5s : Dérive galactique et rotation 3D sphérique du globe (Afrique visible).
// - 5.5s à 6.8s : Décélération douce du globe vers sa position initiale.
// - 6.8s à 8.0s : Logo parfaitement stable, balayage d'un reflet vert discret sur les chromes.
// - 8.0s : Transition cinématographique fluide vers l'écran d'accueil.
//
// Règles impératives :
// - SEUL LE GLOBE TOURNE.
// - Clé Tech Élite, hexagone, texte « LABOSURF » et sous-titre strictement immobiles.
// ==========================================================================

(function(){
  'use strict';
  var splash = document.getElementById('splash');
  var globeCanvas = document.getElementById('spGlobeCanvas');
  var galaxyCanvas = document.getElementById('spGalaxyCanvas');
  var masterImg = document.getElementById('spMaster');
  var sheen = document.getElementById('spSheen');
  var waiting = [], done = !splash;
  var animId = null;

  var startTime = null;
  var TOTAL_DURATION = 8000; // 8.0 secondes
  var ROT_START = 1200;      // 1.2s : début de la rotation du globe
  var ROT_END = 6800;        // 6.8s : arrêt complet à la position initiale
  var SHEEN_TIME = 6840;     // 6.84s : reflet vert émeraude sur les contours chromés

  // ------------------------------------------------------------------------
  // 1. MOTEUR DE FOND : GALAXIE MOUVEMENTÉE 3D (Starfield & Nébuleuses)
  // ------------------------------------------------------------------------
  var gCtx = null;
  var GW = 360, GH = 640;
  var stars = [];
  var NUM_STARS = 140;
  var FOV = 280;

  function initGalaxy(){
    if(!galaxyCanvas) return;
    try {
      gCtx = galaxyCanvas.getContext('2d');
      resizeGalaxy();
      stars = [];
      for(var i = 0; i < NUM_STARS; i++){
        stars.push(createStar(true));
      }
    } catch(e){}
  }

  function resizeGalaxy(){
    if(!galaxyCanvas) return;
    GW = galaxyCanvas.width = window.innerWidth || 360;
    GH = galaxyCanvas.height = window.innerHeight || 640;
  }

  function createStar(randomZ){
    return {
      x: (Math.random() - 0.5) * GW * 2.2,
      y: (Math.random() - 0.5) * GH * 2.2,
      z: randomZ ? Math.random() * 900 + 50 : 950,
      vz: Math.random() * 2.8 + 1.8,
      rad: Math.random() * 1.5 + 0.6,
      color: Math.random() > 0.45 ? '#ffffff' : (Math.random() > 0.5 ? '#0af072' : '#38bdf8'),
      tail: Math.random() > 0.3
    };
  }

  function renderGalaxy(elapsed){
    if(!gCtx || !galaxyCanvas) return;
    
    // Léger fondu cosmique pour traînées galactiques
    gCtx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    gCtx.fillRect(0, 0, GW, GH);

    var cx = GW / 2;
    var cy = GH * 0.45; // Centré autour du logo

    // Nébuleuses galactiques diffuses en arrière-plan
    var nebAngle = elapsed * 0.0004;
    var n1x = cx + Math.cos(nebAngle) * 90;
    var n1y = cy + Math.sin(nebAngle) * 60;
    var g1 = gCtx.createRadialGradient(n1x, n1y, 10, n1x, n1y, GW * 0.55);
    g1.addColorStop(0, 'rgba(10, 240, 114, 0.08)');
    g1.addColorStop(0.5, 'rgba(6, 182, 212, 0.03)');
    g1.addColorStop(1, 'transparent');
    gCtx.fillStyle = g1;
    gCtx.fillRect(0, 0, GW, GH);

    var n2x = cx - Math.cos(nebAngle * 0.8) * 110;
    var n2y = cy - Math.sin(nebAngle * 0.8) * 80;
    var g2 = gCtx.createRadialGradient(n2x, n2y, 10, n2x, n2y, GW * 0.6);
    g2.addColorStop(0, 'rgba(79, 70, 229, 0.05)');
    g2.addColorStop(0.6, 'rgba(6, 182, 212, 0.02)');
    g2.addColorStop(1, 'transparent');
    gCtx.fillStyle = g2;
    gCtx.fillRect(0, 0, GW, GH);

    // Rendu des étoiles 3D avec perspective spatiale
    var spin = 0.0007;
    var cosSpin = Math.cos(spin), sinSpin = Math.sin(spin);

    for(var i = 0; i < stars.length; i++){
      var s = stars[i];

      // Rotation vortex galactique
      var rx = s.x * cosSpin - s.y * sinSpin;
      var ry = s.x * sinSpin + s.y * cosSpin;
      s.x = rx; s.y = ry;

      // Avancement en profondeur vers la caméra
      var prevZ = s.z;
      s.z -= s.vz;
      if(s.z <= 20){
        stars[i] = createStar(false);
        continue;
      }

      // Projection perspective
      var scale = FOV / s.z;
      var px = cx + s.x * scale;
      var py = cy + s.y * scale;

      var prevScale = FOV / prevZ;
      var oldX = cx + s.x * prevScale;
      var oldY = cy + s.y * prevScale;

      if(px < -20 || px > GW + 20 || py < -20 || py > GH + 20){
        stars[i] = createStar(false);
        continue;
      }

      var alpha = Math.min(1, (1000 - s.z) / 500);
      var radius = Math.max(0.6, s.rad * scale * 1.8);

      gCtx.globalAlpha = alpha;
      gCtx.fillStyle = s.color;
      gCtx.strokeStyle = s.color;

      // Traînée de vitesse cinématique
      if(s.tail && scale > 0.6){
        gCtx.lineWidth = Math.min(1.8, radius * 0.8);
        gCtx.beginPath();
        gCtx.moveTo(oldX, oldY);
        gCtx.lineTo(px, py);
        gCtx.stroke();
      }

      gCtx.beginPath();
      gCtx.arc(px, py, radius, 0, Math.PI * 2);
      gCtx.fill();
    }
    gCtx.globalAlpha = 1.0;
  }

  // ------------------------------------------------------------------------
  // 2. MOTEUR DU GLOBE 3D : SPHERE WEBGL & FALLBACK
  // ------------------------------------------------------------------------
  var N = 544;
  var texImg = new Image();
  texImg.src = window.SP_EARTH_TEX || 'img/globe-earth-tex.png';
  var texReady = false;

  var glCtx = null, glProgram = null, glBuffer = null, glTex = null;
  var uAngleLoc = null;
  var useWebGL = false;

  function initWebGL(){
    if(!globeCanvas) return false;
    try {
      glCtx = globeCanvas.getContext('webgl', { alpha: true, antialias: true }) ||
              globeCanvas.getContext('experimental-webgl', { alpha: true });
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
    gl.viewport(0, 0, globeCanvas.width, globeCanvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(glProgram);
    gl.uniform1f(uAngleLoc, angleRad);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // Trajectoire angulaire :
  // 0s à 1.2s : angle = 0.0 rad (initial)
  // 1.2s à 5.5s : rotation fluide sur l'axe (max ~0.58 rad / 33°), l'Afrique reste centrée & visible
  // 5.5s à 6.8s : décélération douce vers 0.0 rad
  // 6.8s à 8.0s : arrêt complet à 0.0 rad
  function computeAngle(elapsed){
    if(elapsed <= ROT_START || elapsed >= ROT_END) return 0;
    var tau = (elapsed - ROT_START) / (ROT_END - ROT_START);
    var maxAngle = 0.58; // 33.2 degrés pour perspective 3D réaliste sans masquer l'Afrique
    return Math.sin(tau * Math.PI) * maxAngle;
  }

  // ------------------------------------------------------------------------
  // 3. BOUCLE PRINCIPALE D'ANIMATION (8 SECONDES)
  // ------------------------------------------------------------------------
  var sheenFired = false;

  function step(now){
    if(done) return;
    if(!startTime) startTime = now;
    var elapsed = now - startTime;

    // Rendu galaxie spatiale
    renderGalaxy(elapsed);

    // Masquage transparent du master pour laisser le globe 3D s'exprimer
    if(elapsed >= ROT_START && elapsed < ROT_END - 250 && masterImg && !masterImg.classList.contains('is-rotating')){
      masterImg.classList.add('is-rotating');
    }
    // Rétablissement du master à 100% pour la phase de stabilité finale
    if(elapsed >= ROT_END - 250 && masterImg && masterImg.classList.contains('is-rotating')){
      masterImg.classList.remove('is-rotating');
    }

    // Reflet vert spéculaire sur les métaux
    if(elapsed >= SHEEN_TIME && !sheenFired && sheen){
      sheenFired = true;
      sheen.classList.add('is-active');
    }

    // Rendu du globe 3D
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
    if(globeCanvas){
      try {
        if(glCtx && glTex){ glCtx.deleteTexture(glTex); }
        if(glCtx && glBuffer){ glCtx.deleteBuffer(glBuffer); }
        if(glCtx && glProgram){ glCtx.deleteProgram(glProgram); }
      } catch(e){}
      globeCanvas.width = 1; globeCanvas.height = 1;
    }
    if(galaxyCanvas){
      galaxyCanvas.width = 1; galaxyCanvas.height = 1;
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

  if(globeCanvas){
    globeCanvas.width = N;
    globeCanvas.height = N;
    useWebGL = initWebGL();
  }

  initGalaxy();
  window.addEventListener('resize', resizeGalaxy, { passive: true });

  texImg.onload = function(){
    texReady = true;
    if(useWebGL){
      setupTextureGL();
      renderGL(0);
    }
  };

  if(splash){
    splash.addEventListener('click', skip);
    try { if(sessionStorage.getItem('ls.cacheCleared')) splash.classList.add('is-skipped'); } catch(e){}
    animId = requestAnimationFrame(step);
    setTimeout(finish, 8800); // Filet de sécurité
  }

  window.Splash = {
    isDone: function(){ return done; },
    skip: skip,
    whenDone: function(fn){ if(done) fn(); else waiting.push(fn); }
  };
})();
