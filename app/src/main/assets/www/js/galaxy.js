// ==========================================================================
// ACCUEIL LABOSURF VPN — GALAXIE DE LA VITRINE, posée sur le fond existant dont la couleur ne change pas.
// Rendu : Canvas 2D. Galaxie spirale pré-calculée, étoiles scintillantes, étoiles filantes.
// Sobriété : active seulement sur l'accueil en thème sombre, arrêtée application en arrière-plan, 30 images/s,
// image fixe si prefers-reduced-motion. Aucun lien avec le tunnel.
// ==========================================================================

(function () {
  'use strict';

  var canvas = document.getElementById('vhGalaxy');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  var FRAME_MS = 1000 / 30;
  var GALAXY_TURN_MS = 420000; // un tour de galaxie en 7 minutes
  var TWO_PI = Math.PI * 2;

  // Couleurs de la marque, avec une touche violette pour la profondeur du ciel
  var ARM_COLORS = ['47,227,154', '0,242,255', '120,170,255', '170,120,255', '255,255,255'];
  var STAR_COLORS = ['255,255,255', '255,255,255', '200,235,255', '170,255,225', '255,235,200', '205,185,255'];

  var reduceMotion = false;
  try {
    reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {}

  var W = 0;
  var H = 0;
  var dpr = 1;
  var stars = [];
  var meteors = [];
  var galaxy = null;
  var galaxySize = 0;
  var nextMeteorAt = 0;
  var rafId = 0;
  var lastTs = 0;

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function pick(list) {
    return list[(Math.random() * list.length) | 0];
  }

  // Galaxie spirale dessinée une seule fois hors écran, puis simplement tournée
  function buildGalaxy(size) {
    var c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    var g = c.getContext('2d');
    var cx = size / 2;
    var R = size / 2;
    g.globalCompositeOperation = 'lighter';

    var halo = g.createRadialGradient(cx, cx, 0, cx, cx, R);
    halo.addColorStop(0, 'rgba(215,255,240,0.7)');
    halo.addColorStop(0.1, 'rgba(47,227,154,0.3)');
    halo.addColorStop(0.32, 'rgba(70,110,240,0.15)');
    halo.addColorStop(0.65, 'rgba(120,70,220,0.07)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, size, size);

    var ARMS = 4;
    var count = Math.round(size * 9);
    for (var i = 0; i < count; i++) {
      var t = Math.pow(Math.random(), 0.72);
      var arm = (Math.random() * ARMS) | 0;
      var angle = (arm / ARMS) * TWO_PI + t * 7.4 + rand(-1, 1) * (0.42 - t * 0.28);
      var r = t * R * 0.97;
      var x = cx + Math.cos(angle) * r + rand(-1, 1) * R * 0.018;
      var y = cx + Math.sin(angle) * r + rand(-1, 1) * R * 0.018;
      var dot = Math.random() < 0.015 ? rand(1.2, 2.1) : rand(0.35, 1.05);
      var col = t < 0.16 ? '255,255,255' : pick(ARM_COLORS);
      g.fillStyle = 'rgba(' + col + ',' + rand(0.12, 0.72) * (1 - t * 0.55) + ')';
      g.beginPath();
      g.arc(x, y, dot, 0, TWO_PI);
      g.fill();
    }

    // Nuages de poussière lumineuse le long des bras
    for (var k = 0; k < 70; k++) {
      var tk = rand(0.14, 0.92);
      var ak = (((Math.random() * ARMS) | 0) / ARMS) * TWO_PI + tk * 7.4;
      var xk = cx + Math.cos(ak) * tk * R;
      var yk = cx + Math.sin(ak) * tk * R;
      var rk = rand(R * 0.04, R * 0.12);
      var cloud = g.createRadialGradient(xk, yk, 0, xk, yk, rk);
      cloud.addColorStop(0, 'rgba(' + pick(ARM_COLORS.slice(0, 4)) + ',0.14)');
      cloud.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = cloud;
      g.fillRect(xk - rk, yk - rk, rk * 2, rk * 2);
    }
    return c;
  }

  function buildStars() {
    var n = Math.min(320, Math.round((W * H) / 2800));
    stars = [];
    for (var i = 0; i < n; i++) {
      var depth = Math.random();
      var bright = Math.random() < 0.07;
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: bright ? rand(1.2, 2) : rand(0.35, 1.05),
        base: bright ? rand(0.65, 0.95) : rand(0.25, 0.75),
        speed: rand(0.0006, 0.0028),
        phase: Math.random() * TWO_PI,
        depth: 0.02 + depth * 0.09,
        color: pick(STAR_COLORS),
        bright: bright
      });
    }
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var wanted = Math.min(900, Math.round(Math.max(W, H) * 1.2));
    if (!galaxy || Math.abs(wanted - galaxySize) > 120) {
      galaxySize = wanted;
      galaxy = buildGalaxy(galaxySize);
    }
    buildStars();
  }

  function spawnMeteor(ts) {
    // Départ n'importe où dans le tiers haut ou sur les côtés, trajectoire variée
    var fromLeft = Math.random() < 0.5;
    var angle = rand(0.3, 0.85);
    var speed = rand(0.55, 1.15) * Math.max(0.75, Math.min(1.3, W / 1000));
    meteors.push({
      x: fromLeft ? rand(-0.05, 0.55) * W : rand(0.45, 1.05) * W,
      y: rand(-0.04, 0.5) * H,
      vx: Math.cos(angle) * speed * (fromLeft ? 1 : -1),
      vy: Math.sin(angle) * speed,
      len: rand(110, 260),
      born: ts,
      life: rand(650, 1250),
      color: pick(['255,255,255', '170,255,225', '160,235,255', '215,195,255'])
    });
  }

  function drawMeteors(ts) {
    if (ts >= nextMeteorAt) {
      spawnMeteor(ts);
      if (Math.random() < 0.22) spawnMeteor(ts); // parfois une pluie de deux
      nextMeteorAt = ts + rand(1800, 6500);
    }
    ctx.globalCompositeOperation = 'lighter';
    for (var i = meteors.length - 1; i >= 0; i--) {
      var m = meteors[i];
      var age = ts - m.born;
      if (age > m.life) {
        meteors.splice(i, 1);
        continue;
      }
      var p = age / m.life;
      var fade = p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85;
      var x = m.x + m.vx * age;
      var y = m.y + m.vy * age;
      var v = Math.sqrt(m.vx * m.vx + m.vy * m.vy);
      var tx = x - (m.vx / v) * m.len * Math.min(1, p * 3);
      var ty = y - (m.vy / v) * m.len * Math.min(1, p * 3);

      var tail = ctx.createLinearGradient(x, y, tx, ty);
      tail.addColorStop(0, 'rgba(' + m.color + ',' + 0.95 * fade + ')');
      tail.addColorStop(0.3, 'rgba(' + m.color + ',' + 0.38 * fade + ')');
      tail.addColorStop(1, 'rgba(' + m.color + ',0)');
      ctx.strokeStyle = tail;
      ctx.lineCap = 'round';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(tx, ty);
      ctx.stroke();

      var head = ctx.createRadialGradient(x, y, 0, x, y, 9);
      head.addColorStop(0, 'rgba(255,255,255,' + fade + ')');
      head.addColorStop(0.3, 'rgba(' + m.color + ',' + 0.55 * fade + ')');
      head.addColorStop(1, 'rgba(' + m.color + ',0)');
      ctx.fillStyle = head;
      ctx.fillRect(x - 9, y - 9, 18, 18);
    }
  }

  function drawStars(ts, scrollY) {
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var tw = 0.5 + 0.5 * Math.sin(s.phase + ts * s.speed);
      var alpha = s.base * (s.bright ? 0.35 + 0.65 * tw * tw : 0.45 + 0.55 * tw);
      var y = s.y - scrollY * s.depth;
      y = y - Math.floor(y / H) * H;

      ctx.fillStyle = 'rgba(' + s.color + ',' + alpha + ')';
      ctx.beginPath();
      ctx.arc(s.x, y, s.r, 0, TWO_PI);
      ctx.fill();

      if (s.bright) {
        // Halo et branches de lumière des étoiles les plus brillantes
        var size = s.r * (4 + 5 * tw);
        var glow = ctx.createRadialGradient(s.x, y, 0, s.x, y, size);
        glow.addColorStop(0, 'rgba(' + s.color + ',' + alpha * 0.55 + ')');
        glow.addColorStop(1, 'rgba(' + s.color + ',0)');
        ctx.fillStyle = glow;
        ctx.fillRect(s.x - size, y - size, size * 2, size * 2);
        ctx.strokeStyle = 'rgba(' + s.color + ',' + alpha * 0.6 + ')';
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(s.x - size * 1.5, y);
        ctx.lineTo(s.x + size * 1.5, y);
        ctx.moveTo(s.x, y - size * 1.5);
        ctx.lineTo(s.x, y + size * 1.5);
        ctx.stroke();
      }
    }
  }

  function drawFrame(ts) {
    var scrollY = 0;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, W, H);

    // Galaxie inclinée, derrière le logo de l'accueil
    var gx = 0.56 * W;
    var gy = 0.34 * H;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(gx, gy);
    ctx.rotate(-0.42);
    ctx.scale(1, 0.52);
    ctx.rotate((ts / GALAXY_TURN_MS) * TWO_PI);
    ctx.drawImage(galaxy, -galaxySize / 2, -galaxySize / 2);
    ctx.restore();
    ctx.globalAlpha = 1;

    drawStars(ts, scrollY);
    if (!reduceMotion) drawMeteors(ts);
  }

  function loop(ts) {
    rafId = requestAnimationFrame(loop);
    if (ts - lastTs < FRAME_MS) return;
    lastTs = ts;
    drawFrame(ts);
  }

  function wanted() {
    var root = document.documentElement;
    return root.dataset.screen === 'home' && root.dataset.theme !== 'light' && !document.hidden;
  }

  // Thème clair : les étoiles n'existent pas sur fond clair, le canvas est masqué par la CSS (css/galaxy.css).
  function sync() {
    if (wanted()) start();
    else stop();
  }

  function start() {
    if (!rafId && !reduceMotion) {
      nextMeteorAt = performance.now() + 700;
      meteors = [];
      rafId = requestAnimationFrame(loop);
    }
  }

  function stop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  var resizeTimer = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      resize();
      if (reduceMotion) drawFrame(0);
    }, 180);
  });

  document.addEventListener('visibilitychange', sync);
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-screen', 'data-theme'] });

  resize();
  drawFrame(performance.now());
  sync();
})();
