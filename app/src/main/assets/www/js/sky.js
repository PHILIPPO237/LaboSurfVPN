// Fond de galaxie de la fenêtre de mise à jour : le MÊME rendu que l'accueil de l'application (js/galaxy.js) — galaxie
// spirale dessinée une fois puis tournée, étoiles qui scintillent avec halos et branches de lumière, étoiles filantes —
// posé sur la taille de la fenêtre. Décor pur : aucun lien avec le tunnel ni les données. Sobriété : 30 images/s au plus,
// arrêt dès que la fenêtre se ferme (stop) ou que l'application passe en arrière-plan, image fixe avec
// « réduire les animations ». Si l'accueil change de rendu, ce fichier doit suivre.
//
// Usage : const sky = LaboSky.attach(element); sky.start(); … sky.stop();
'use strict';
const LaboSky = (function(){
  const TWO_PI = Math.PI * 2, FRAME_MS = 1000 / 30, GALAXY_TURN_MS = 420000;
  // Mêmes couleurs que l'accueil : émeraude, cyan, bleu, violet, blanc
  const ARM_COLORS = ['47,227,154', '0,242,255', '120,170,255', '170,120,255', '255,255,255'];
  const STAR_COLORS = ['255,255,255', '255,255,255', '200,235,255', '170,255,225', '255,235,200', '205,185,255'];
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (list) => list[(Math.random() * list.length) | 0];

  function buildGalaxy(size){
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d');
    if(!g) return null;
    const cx = size / 2, R = size / 2;
    g.globalCompositeOperation = 'lighter';
    const halo = g.createRadialGradient(cx, cx, 0, cx, cx, R);
    halo.addColorStop(0, 'rgba(215,255,240,0.7)');
    halo.addColorStop(0.1, 'rgba(47,227,154,0.3)');
    halo.addColorStop(0.32, 'rgba(70,110,240,0.15)');
    halo.addColorStop(0.65, 'rgba(120,70,220,0.07)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = halo; g.fillRect(0, 0, size, size);
    const ARMS = 4, count = Math.round(size * 9);
    for(let i = 0; i < count; i++){
      const t = Math.pow(Math.random(), 0.72), arm = (Math.random() * ARMS) | 0;
      const angle = (arm / ARMS) * TWO_PI + t * 7.4 + rand(-1, 1) * (0.42 - t * 0.28);
      const r = t * R * 0.97;
      const x = cx + Math.cos(angle) * r + rand(-1, 1) * R * 0.018, y = cx + Math.sin(angle) * r + rand(-1, 1) * R * 0.018;
      const dot = Math.random() < 0.015 ? rand(1.2, 2.1) : rand(0.35, 1.05);
      const col = t < 0.16 ? '255,255,255' : pick(ARM_COLORS);
      g.fillStyle = 'rgba(' + col + ',' + rand(0.12, 0.72) * (1 - t * 0.55) + ')';
      g.beginPath(); g.arc(x, y, dot, 0, TWO_PI); g.fill();
    }
    for(let k = 0; k < 70; k++){
      const tk = rand(0.14, 0.92), ak = (((Math.random() * ARMS) | 0) / ARMS) * TWO_PI + tk * 7.4;
      const xk = cx + Math.cos(ak) * tk * R, yk = cx + Math.sin(ak) * tk * R, rk = rand(R * 0.04, R * 0.12);
      const cloud = g.createRadialGradient(xk, yk, 0, xk, yk, rk);
      cloud.addColorStop(0, 'rgba(' + pick(ARM_COLORS.slice(0, 4)) + ',0.14)');
      cloud.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = cloud; g.fillRect(xk - rk, yk - rk, rk * 2, rk * 2);
    }
    return c;
  }

  function attach(host){
    const canvas = document.createElement('canvas');
    canvas.className = 'upd-cv';
    host.insertBefore(canvas, host.firstChild);
    const ctx = canvas.getContext && canvas.getContext('2d');
    let reduce = false;
    try{ reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }catch(e){}
    let W = 0, H = 0, stars = [], meteors = [], galaxy = null, galaxySize = 0, nextMeteorAt = 0, raf = 0, lastTs = 0, running = false;

    function buildStars(){
      const n = Math.min(320, Math.round((W * H) / 1800));
      stars = [];
      for(let i = 0; i < n; i++){
        const bright = Math.random() < 0.07;
        stars.push({ x: Math.random() * W, y: Math.random() * H, r: bright ? rand(1.2, 2) : rand(0.35, 1.05), base: bright ? rand(0.65, 0.95) : rand(0.25, 0.75),
          speed: rand(0.0006, 0.0028), phase: Math.random() * TWO_PI, color: pick(STAR_COLORS), bright: bright });
      }
    }
    function resize(){
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = host.clientWidth, h = host.clientHeight;   // taille de mise en page : l'animation d'entrée ne la change pas
      if(!w || !h || !ctx) return false;
      if(w === W && h === H) return true;
      W = w; H = h;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const wanted = Math.min(900, Math.round(Math.max(W, H) * 1.2));
      if(!galaxy || Math.abs(wanted - galaxySize) > 120){ galaxySize = wanted; galaxy = buildGalaxy(galaxySize); }
      buildStars();
      return true;
    }
    function spawnMeteor(ts){
      const fromLeft = Math.random() < 0.5, angle = rand(0.3, 0.85), speed = rand(0.55, 1.15) * Math.max(0.75, Math.min(1.3, W / 1000));
      meteors.push({ x: fromLeft ? rand(-0.05, 0.55) * W : rand(0.45, 1.05) * W, y: rand(-0.04, 0.5) * H,
        vx: Math.cos(angle) * speed * (fromLeft ? 1 : -1), vy: Math.sin(angle) * speed, len: rand(110, 260), born: ts, life: rand(650, 1250),
        color: pick(['255,255,255', '170,255,225', '160,235,255', '215,195,255']) });
    }
    function drawMeteors(ts){
      if(ts >= nextMeteorAt){
        spawnMeteor(ts);
        if(Math.random() < 0.22) spawnMeteor(ts);
        nextMeteorAt = ts + rand(1800, 6500);
      }
      ctx.globalCompositeOperation = 'lighter';
      for(let i = meteors.length - 1; i >= 0; i--){
        const m = meteors[i], age = ts - m.born;
        if(age > m.life){ meteors.splice(i, 1); continue; }
        const p = age / m.life, fade = p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85;
        const x = m.x + m.vx * age, y = m.y + m.vy * age, v = Math.sqrt(m.vx * m.vx + m.vy * m.vy);
        const tx = x - (m.vx / v) * m.len * Math.min(1, p * 3), ty = y - (m.vy / v) * m.len * Math.min(1, p * 3);
        const tail = ctx.createLinearGradient(x, y, tx, ty);
        tail.addColorStop(0, 'rgba(' + m.color + ',' + 0.95 * fade + ')');
        tail.addColorStop(0.3, 'rgba(' + m.color + ',' + 0.38 * fade + ')');
        tail.addColorStop(1, 'rgba(' + m.color + ',0)');
        ctx.strokeStyle = tail; ctx.lineCap = 'round'; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.stroke();
        const head = ctx.createRadialGradient(x, y, 0, x, y, 9);
        head.addColorStop(0, 'rgba(255,255,255,' + fade + ')');
        head.addColorStop(0.3, 'rgba(' + m.color + ',' + 0.55 * fade + ')');
        head.addColorStop(1, 'rgba(' + m.color + ',0)');
        ctx.fillStyle = head; ctx.fillRect(x - 9, y - 9, 18, 18);
      }
    }
    function drawStars(ts){
      ctx.globalCompositeOperation = 'lighter';
      for(let i = 0; i < stars.length; i++){
        const s = stars[i], tw = 0.5 + 0.5 * Math.sin(s.phase + ts * s.speed);
        const alpha = s.base * (s.bright ? 0.35 + 0.65 * tw * tw : 0.45 + 0.55 * tw);
        ctx.fillStyle = 'rgba(' + s.color + ',' + alpha + ')';
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TWO_PI); ctx.fill();
        if(s.bright){
          const size = s.r * (4 + 5 * tw), glow = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, size);
          glow.addColorStop(0, 'rgba(' + s.color + ',' + alpha * 0.55 + ')');
          glow.addColorStop(1, 'rgba(' + s.color + ',0)');
          ctx.fillStyle = glow; ctx.fillRect(s.x - size, s.y - size, size * 2, size * 2);
          ctx.strokeStyle = 'rgba(' + s.color + ',' + alpha * 0.6 + ')'; ctx.lineWidth = 0.6;
          ctx.beginPath(); ctx.moveTo(s.x - size * 1.5, s.y); ctx.lineTo(s.x + size * 1.5, s.y); ctx.moveTo(s.x, s.y - size * 1.5); ctx.lineTo(s.x, s.y + size * 1.5); ctx.stroke();
        }
      }
    }
    function drawFrame(ts){
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, W, H);
      if(galaxy){
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.translate(0.56 * W, 0.34 * H); ctx.rotate(-0.42); ctx.scale(1, 0.52);
        ctx.rotate((ts / GALAXY_TURN_MS) * TWO_PI);
        ctx.drawImage(galaxy, -galaxySize / 2, -galaxySize / 2);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      drawStars(ts);
      if(!reduce) drawMeteors(ts);
    }
    function loop(ts){
      raf = requestAnimationFrame(loop);
      if(ts - lastTs < FRAME_MS) return;
      lastTs = ts;
      drawFrame(ts);
    }
    function pause(){ if(raf){ cancelAnimationFrame(raf); raf = 0; } }
    function resume(){ if(running && !raf && !reduce && !document.hidden && ctx){ nextMeteorAt = performance.now() + 700; meteors = []; raf = requestAnimationFrame(loop); } }
    const redraw = () => { if(running && resize() && reduce) drawFrame(0); };
    document.addEventListener('visibilitychange', () => { if(document.hidden) pause(); else resume(); });
    window.addEventListener('resize', redraw);
    try{ if(typeof ResizeObserver === 'function') new ResizeObserver(redraw).observe(host); }catch(e){}
    return {
      start(){ running = true; if(!ctx || !resize()) return; drawFrame(performance.now()); resume(); },
      stop(){ running = false; pause(); },
      shoot(){ spawnMeteor(performance.now()); },
    };
  }
  return { attach };
})();
