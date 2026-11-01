import base64
import os

def b64(path):
    with open(path, 'rb') as f:
        return base64.b64encode(f.read()).decode('ascii')

overlay_b64 = b64(r'C:\Users\atsan\vpn_ux\app\src\main\assets\www\img\logo-overlay-static.png')
master_b64 = b64(r'C:\Users\atsan\vpn_ux\app\src\main\assets\www\img\logo-master-1024.jpg')
tex_b64 = b64(r'C:\Users\atsan\vpn_ux\app\src\main\assets\www\img\globe-earth-tex.png')

html_content = f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>LABOSURF — Splash Screen 3D Galaxie (8s)</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    background: #050806;
    color: #e2e8f0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 30px 20px;
  }}
  header {{
    text-align: center;
    max-width: 840px;
    margin-bottom: 25px;
  }}
  h1 {{
    font-size: 26px;
    font-weight: 800;
    letter-spacing: 1px;
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
  }}
  .badge {{
    background: rgba(10, 240, 114, 0.15);
    color: #0af072;
    border: 1px solid rgba(10, 240, 114, 0.4);
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 20px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }}
  p.subtitle {{
    color: #94a3b8;
    margin-top: 8px;
    font-size: 14px;
    line-height: 1.5;
  }}
  .main-container {{
    display: flex;
    flex-wrap: wrap;
    gap: 40px;
    align-items: flex-start;
    justify-content: center;
    max-width: 1140px;
    width: 100%;
  }}
  /* Phone Frame 9:16 */
  .phone-frame {{
    width: 320px;
    height: 640px;
    background: #000000;
    border-radius: 42px;
    border: 9px solid #1e293b;
    box-shadow: 0 25px 60px rgba(0, 0, 0, 0.9), 0 0 35px rgba(10, 240, 114, 0.18);
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }}
  .phone-speaker {{
    position: absolute;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    width: 65px;
    height: 4px;
    background: #334155;
    border-radius: 3px;
    z-index: 9999;
  }}
  /* Splash View inside phone */
  .splash-view {{
    width: 100%;
    height: 100%;
    position: relative;
    background: #000000;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }}
  .sp-galaxy-canvas {{
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 0;
  }}
  .sp-ambient-glow {{
    position: absolute;
    width: 300px;
    height: 300px;
    border-radius: 50%;
    background: radial-gradient(circle at 50% 41%, rgba(10, 240, 114, 0.2) 0%, rgba(6, 182, 212, 0.06) 45%, transparent 70%);
    filter: blur(28px);
    pointer-events: none;
    z-index: 1;
  }}
  .sp-stage {{
    position: relative;
    width: 270px;
    height: 270px;
    opacity: 1;
    z-index: 2;
  }}
  .sp-globe-canvas {{
    position: absolute;
    left: 23.44%;
    top: 13.87%;
    width: 53.125%;
    height: 53.125%;
    border-radius: 50%;
    z-index: 1;
    display: block;
  }}
  .sp-overlay-img {{
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    z-index: 2;
    pointer-events: none;
    display: block;
  }}
  .sp-master-img {{
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    z-index: 3;
    pointer-events: none;
    opacity: 1;
    transition: opacity 0.4s ease;
  }}
  .sp-master-img.is-rotating {{
    opacity: 0;
  }}
  .sp-metal-sheen {{
    position: absolute;
    inset: 0;
    z-index: 4;
    pointer-events: none;
    opacity: 0;
    mix-blend-mode: screen;
    background: linear-gradient(125deg, transparent 35%, rgba(10, 240, 114, 0.45) 50%, rgba(255, 255, 255, 0.22) 53%, transparent 68%);
    background-size: 260% 260%;
    background-position: -80% -80%;
  }}
  .sp-metal-sheen.is-active {{
    animation: spSheenSweep 0.95s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
  }}
  @keyframes spSheenSweep {{
    0% {{ opacity: 0; background-position: -80% -80%; }}
    25% {{ opacity: 0.95; }}
    80% {{ opacity: 0.85; }}
    100% {{ opacity: 0; background-position: 180% 180%; }}
  }}
  /* Fake home screen revealed at 8s */
  .home-screen {{
    position: absolute;
    inset: 0;
    background: #020604;
    z-index: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #475569;
    font-size: 13px;
    letter-spacing: 0.5px;
  }}
  .home-screen .card {{
    width: 82%;
    padding: 16px;
    background: #06150b;
    border: 1px solid #0f2e1a;
    border-radius: 16px;
    text-align: center;
    color: #0af072;
    font-weight: 600;
  }}
  /* Sidebar info & controls */
  .panel {{
    flex: 1;
    min-width: 320px;
    max-width: 520px;
    background: #0a130e;
    border: 1px solid #142a1b;
    border-radius: 20px;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }}
  .panel-title {{
    font-size: 18px;
    font-weight: 700;
    color: #f1f5f9;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }}
  .timer-display {{
    font-family: monospace;
    font-size: 24px;
    color: #0af072;
    background: #05140a;
    padding: 6px 14px;
    border-radius: 10px;
    border: 1px solid #0f381a;
  }}
  .progress-wrap {{
    display: flex;
    flex-direction: column;
    gap: 8px;
  }}
  .progress-bar-bg {{
    width: 100%;
    height: 10px;
    background: #1e293b;
    border-radius: 5px;
    overflow: hidden;
    position: relative;
    cursor: pointer;
  }}
  .progress-bar-fill {{
    height: 100%;
    width: 0%;
    background: linear-gradient(90deg, #0af072, #06b6d4);
    border-radius: 5px;
    transition: width 0.05s linear;
  }}
  .timeline-steps {{
    display: flex;
    flex-direction: column;
    gap: 10px;
  }}
  .step-row {{
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    background: #061109;
    border: 1px solid #102616;
    border-radius: 12px;
    font-size: 13px;
    transition: all 0.25s ease;
  }}
  .step-row.is-current {{
    border-color: #0af072;
    background: rgba(10, 240, 114, 0.12);
    color: #ffffff;
    box-shadow: 0 0 14px rgba(10, 240, 114, 0.25);
  }}
  .step-time {{
    font-family: monospace;
    font-weight: 700;
    color: #0af072;
    font-size: 12px;
    min-width: 65px;
  }}
  .btn-row {{
    display: flex;
    gap: 12px;
  }}
  button {{
    flex: 1;
    background: #0af072;
    color: #011408;
    border: none;
    padding: 12px;
    border-radius: 10px;
    font-weight: 700;
    cursor: pointer;
    font-size: 14px;
    transition: transform 0.1s, background 0.2s;
  }}
  button:hover {{ background: #26f885; }}
  button:active {{ transform: scale(0.98); }}
  button.btn-sec {{
    background: #1e293b;
    color: #cbd5e1;
  }}
  button.btn-sec:hover {{ background: #334155; }}
  .rule-pill {{
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #94a3b8;
    background: #08150d;
    padding: 4px 8px;
    border-radius: 6px;
    border: 1px solid #142a1b;
  }}
  .rule-pill.check {{ color: #0af072; border-color: rgba(10, 240, 114, 0.4); }}
</style>
</head>
<body>

<header>
  <h1>LABOSURF <span>SPLASH SCREEN 3D</span> <span class="badge">8.0 SECONDES</span></h1>
  <p class="subtitle">Fond Galaxie Mouvementée 3D (starfield hyperspatial, nébuleuses cosmiques). Seul le globe terrestre tourne avec l'Afrique visible. La clé Tech Élite, l'hexagone, le texte et le sous-titre restent parfaitement immobiles.</p>
</header>

<div class="main-container">
  <!-- Phone Simulation 9:16 -->
  <div class="phone-frame">
    <div class="phone-speaker"></div>
    
    <div class="home-screen">
      <div class="card">
        ÉCRAN D'ACCUEIL VPN<br>
        <span style="font-size:11px; color:#94a3b8; font-weight:normal;">Transition fluide terminée à 8.0s</span>
      </div>
    </div>

    <div class="splash-view" id="spView">
      <canvas class="sp-galaxy-canvas" id="spGalaxyCanvas"></canvas>
      <div class="sp-ambient-glow"></div>
      <div class="sp-stage">
        <canvas class="sp-globe-canvas" id="spCanvas" width="544" height="544"></canvas>
        <img class="sp-overlay-img" id="spOverlay" src="data:image/png;base64,{overlay_b64}" alt="LABOSURF">
        <img class="sp-master-img" id="spMaster" src="data:image/jpeg;base64,{master_b64}" alt="">
        <div class="sp-metal-sheen" id="spSheen"></div>
      </div>
    </div>
  </div>

  <!-- Controls & Phase telemetry -->
  <div class="panel">
    <div class="panel-title">
      <span>CHRONOMÉTRAGE OFFICIEL</span>
      <div class="timer-display" id="timerText">0.00 s</div>
    </div>

    <div class="progress-wrap">
      <div class="progress-bar-bg" id="progressBar">
        <div class="progress-bar-fill" id="progressFill"></div>
      </div>
    </div>

    <div class="timeline-steps">
      <div class="step-row" id="step1">
        <div class="step-time">0s - 1.2s</div>
        <div>Vol à travers la galaxie et apparition du logo officiel</div>
      </div>
      <div class="step-row" id="step2">
        <div class="step-time">1.2s - 5.5s</div>
        <div><strong>Seul le globe tourne</strong> sur son axe (Afrique visible & centrée)</div>
      </div>
      <div class="step-row" id="step3">
        <div class="step-time">5.5s - 6.8s</div>
        <div>Décélération douce du globe vers sa position initiale</div>
      </div>
      <div class="step-row" id="step4">
        <div class="step-time">6.8s - 8.0s</div>
        <div>Logo stable + Reflet vert discret sur contours métalliques</div>
      </div>
      <div class="step-row" id="step5">
        <div class="step-time">8.0s</div>
        <div>Transition fluide vers l'écran d'accueil</div>
      </div>
    </div>

    <div class="btn-row">
      <button onclick="restartAnimation()">↺ Rejouer (depuis 0s)</button>
      <button class="btn-sec" id="btnPause" onclick="togglePlay()">⏸ Pause</button>
    </div>

    <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:10px;">
      <div class="rule-pill check">✓ Galaxie 3D Mouvementée</div>
      <div class="rule-pill check">✓ Format vertical 9:16</div>
      <div class="rule-pill check">✓ Clé Tech Élite immobile</div>
      <div class="rule-pill check">✓ Hexagone & Textes immobiles</div>
      <div class="rule-pill check">✓ Afrique centrée & visible</div>
      <div class="rule-pill check">✓ Durée 8 secondes</div>
    </div>
  </div>
</div>

<script>
  var canvas = document.getElementById('spCanvas');
  var galCanvas = document.getElementById('spGalaxyCanvas');
  var spView = document.getElementById('spView');
  var masterImg = document.getElementById('spMaster');
  var sheen = document.getElementById('spSheen');
  var timerText = document.getElementById('timerText');
  var progressFill = document.getElementById('progressFill');
  var btnPause = document.getElementById('btnPause');

  // GALAXY ENGINE
  var gCtx = galCanvas.getContext('2d');
  var GW = galCanvas.width = 320;
  var GH = galCanvas.height = 640;
  var stars = [];
  var NUM_STARS = 140;
  var FOV = 240;

  function createStar(randomZ){{
    return {{
      x: (Math.random() - 0.5) * GW * 2.2,
      y: (Math.random() - 0.5) * GH * 2.2,
      z: randomZ ? Math.random() * 900 + 50 : 950,
      vz: Math.random() * 2.8 + 1.8,
      rad: Math.random() * 1.5 + 0.6,
      color: Math.random() > 0.45 ? '#ffffff' : (Math.random() > 0.5 ? '#0af072' : '#38bdf8'),
      tail: Math.random() > 0.3
    }};
  }}

  for(var i = 0; i < NUM_STARS; i++) stars.push(createStar(true));

  function renderGalaxy(elapsed){{
    if(!gCtx) return;
    gCtx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    gCtx.fillRect(0, 0, GW, GH);
    var cx = GW / 2, cy = GH * 0.45;

    // Nébuleuses diffuses
    var nebAngle = elapsed * 0.0004;
    var n1x = cx + Math.cos(nebAngle) * 70, n1y = cy + Math.sin(nebAngle) * 50;
    var g1 = gCtx.createRadialGradient(n1x, n1y, 10, n1x, n1y, GW * 0.6);
    g1.addColorStop(0, 'rgba(10, 240, 114, 0.08)');
    g1.addColorStop(0.5, 'rgba(6, 182, 212, 0.03)');
    g1.addColorStop(1, 'transparent');
    gCtx.fillStyle = g1; gCtx.fillRect(0, 0, GW, GH);

    var spin = 0.0007;
    var cosSpin = Math.cos(spin), sinSpin = Math.sin(spin);

    for(var j = 0; j < stars.length; j++){{
      var s = stars[j];
      var rx = s.x * cosSpin - s.y * sinSpin;
      var ry = s.x * sinSpin + s.y * cosSpin;
      s.x = rx; s.y = ry;
      var prevZ = s.z;
      s.z -= s.vz;
      if(s.z <= 20){{ stars[j] = createStar(false); continue; }}

      var scale = FOV / s.z;
      var px = cx + s.x * scale, py = cy + s.y * scale;
      var prevScale = FOV / prevZ;
      var oldX = cx + s.x * prevScale, oldY = cy + s.y * prevScale;

      if(px < -20 || px > GW + 20 || py < -20 || py > GH + 20){{
        stars[j] = createStar(false); continue;
      }}
      var alpha = Math.min(1, (1000 - s.z) / 500);
      var radius = Math.max(0.6, s.rad * scale * 1.8);
      gCtx.globalAlpha = alpha;
      gCtx.fillStyle = s.color;
      gCtx.strokeStyle = s.color;
      if(s.tail && scale > 0.6){{
        gCtx.lineWidth = Math.min(1.8, radius * 0.8);
        gCtx.beginPath(); gCtx.moveTo(oldX, oldY); gCtx.lineTo(px, py); gCtx.stroke();
      }}
      gCtx.beginPath(); gCtx.arc(px, py, radius, 0, Math.PI * 2); gCtx.fill();
    }}
    gCtx.globalAlpha = 1.0;
  }}

  // GLOBE WEBGL
  var texImg = new Image();
  texImg.src = 'data:image/png;base64,{tex_b64}';

  var gl = canvas.getContext('webgl', {{ alpha: true, antialias: true }});
  var uAngleLoc = null;
  var glProgram = null;

  if (gl) {{
    var vsSrc = 'attribute vec2 aPos; varying vec2 vUv; void main(){{ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }}';
    var fsSrc = [
      'precision mediump float;',
      'varying vec2 vUv;',
      'uniform sampler2D uTex;',
      'uniform float uAngle;',
      'void main(){{',
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
      '}}'
    ].join('\\n');

    function compile(type, src){{
      var s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      return s;
    }}
    var vs = compile(gl.VERTEX_SHADER, vsSrc);
    var fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    glProgram = gl.createProgram();
    gl.attachShader(glProgram, vs); gl.attachShader(glProgram, fs);
    gl.linkProgram(glProgram);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);

    var aPos = gl.getAttribLocation(glProgram, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    uAngleLoc = gl.getUniformLocation(glProgram, 'uAngle');

    texImg.onload = function(){{
      var glTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, glTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texImg);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.useProgram(glProgram);
      gl.uniform1i(gl.getUniformLocation(glProgram, 'uTex'), 0);
      drawAtTime(0);
    }};
  }}

  var currentTime = 0;
  var isPlaying = true;
  var lastTs = null;

  function computeAngle(ms){{
    if(ms <= 1200 || ms >= 6800) return 0;
    var tau = (ms - 1200) / (6800 - 1200);
    return Math.sin(tau * Math.PI) * 0.58;
  }}

  function drawAtTime(ms){{
    currentTime = ms;
    var sec = (ms / 1000).toFixed(2);
    timerText.textContent = sec + ' s';
    progressFill.style.width = Math.min(100, (ms / 8000 * 100)) + '%';

    // Step highlight
    for(var i = 1; i <= 5; i++){{
      document.getElementById('step' + i).classList.remove('is-current');
    }}
    if(ms < 1200) document.getElementById('step1').classList.add('is-current');
    else if(ms < 5500) document.getElementById('step2').classList.add('is-current');
    else if(ms < 6800) document.getElementById('step3').classList.add('is-current');
    else if(ms < 8000) document.getElementById('step4').classList.add('is-current');
    else document.getElementById('step5').classList.add('is-current');

    // Master crossfade
    if(ms >= 1200 && ms < 6550){{
      masterImg.classList.add('is-rotating');
    }} else {{
      masterImg.classList.remove('is-rotating');
    }}

    // Sheen
    if(ms >= 6840 && ms <= 7850){{
      sheen.classList.add('is-active');
    }} else if(ms < 6800){{
      sheen.classList.remove('is-active');
    }}

    // View transition at 8s
    if(ms >= 7600){{
      var pOut = (ms - 7600) / 400;
      spView.style.opacity = Math.max(0, 1 - pOut);
      spView.style.transform = 'scale(' + (1 + 0.05 * pOut) + ')';
    }} else {{
      spView.style.opacity = '1';
      spView.style.transform = 'scale(1)';
    }}

    // WebGL render
    if(gl && glProgram){{
      var ang = computeAngle(ms);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(glProgram);
      gl.uniform1f(uAngleLoc, ang);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }}
  }}

  function loop(ts){{
    if(!lastTs) lastTs = ts;
    var dt = ts - lastTs;
    lastTs = ts;

    if(isPlaying){{
      currentTime += dt;
      if(currentTime > 8500){{
        currentTime = 8500;
        isPlaying = false;
        btnPause.textContent = '▶ Reprendre';
      }}
      drawAtTime(currentTime);
      renderGalaxy(currentTime);
    }}
    requestAnimationFrame(loop);
  }}
  requestAnimationFrame(loop);

  function restartAnimation(){{
    currentTime = 0;
    isPlaying = true;
    lastTs = null;
    btnPause.textContent = '⏸ Pause';
    drawAtTime(0);
  }}

  function togglePlay(){{
    isPlaying = !isPlaying;
    btnPause.textContent = isPlaying ? '⏸ Pause' : '▶ Reprendre';
    lastTs = null;
  }}

  document.getElementById('progressBar').addEventListener('click', function(e){{
    var rect = this.getBoundingClientRect();
    var p = (e.clientX - rect.left) / rect.width;
    currentTime = p * 8000;
    drawAtTime(currentTime);
  }});
</script>

</body>
</html>
"""

for target in [r'C:\Users\atsan\.gemini\antigravity\brain\9823005a-8818-400f-b1d6-3d82093ecf03\showcase.html',
               r'C:\Users\atsan\.gemini\antigravity\brain\9823005a-8818-400f-b1d6-3d82093ecf03\showcase_splash_3d.html']:
    with open(target, 'w', encoding='utf-8') as f:
        f.write(html_content)
    print('Written:', target, 'size:', os.path.getsize(target))
