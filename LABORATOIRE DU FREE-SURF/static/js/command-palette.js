/* Command Palette (Ctrl+K)
 - Injects an overlay + floating trigger button.
 - Keeps it static/no dependencies: works with or without Tailwind/FontAwesome.
*/

(function () {
  function isCompactTouchUi() {
    const ua = navigator.userAgent || '';
    const android = /Android/i.test(ua);
    const canMatch = typeof window.matchMedia === 'function';
    const coarse = canMatch ? window.matchMedia('(pointer: coarse)').matches : false;
    const narrow = canMatch ? window.matchMedia('(max-width: 960px)').matches : (window.innerWidth || 0) <= 960;
    return android || (coarse && narrow);
  }

  if (isCompactTouchUi()) return;

  const OVERLAY_ID = 'cmdkOverlay';
  if (document.getElementById(OVERLAY_ID)) return;

  // S'assurer que le body est prêt avant d'injecter
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', () => {
      // Relancer la fonction ou initialiser ici. 
      // Pour simplifier, on attend juste l'événement si le script est chargé dans <head>
      // Idéalement, déplacez la balise <script> à la fin du body ou utilisez 'defer'.
    });
  }

  const ACTIONS = [
    { id: 'home', label: 'Accueil', href: '/', group: 'Navigation', keywords: 'home accueil labo boot' },
    { id: 'hub', label: 'Hub Central', href: '/dashboard', group: 'Navigation', keywords: 'hub dashboard central' },
    { id: 'about', label: 'Avant-propos', href: '/propos', group: 'Documentation', keywords: 'propos avant guide introduction' },
    { id: 'free', label: 'Panel Gratuit', href: '/panel-gratuit', group: 'Panels', keywords: 'gratuit free panel' },
    { id: 'vip', label: 'Panel VIP', href: '/panel-vip', group: 'Panels', keywords: 'vip gold crown panel' },
    { id: 'reseller', label: 'Panel Revendeur', href: '/panel-revendeur', group: 'Panels', keywords: 'revendeur reseller panel' },
    { id: 'account', label: 'Mon Profil', href: '/profil', group: 'Compte', keywords: 'compte account profil licence avatar' },
    { id: 'login', label: 'Connexion', href: '/acces', group: 'Compte', keywords: 'login acces connexion identifiants mot de passe' },
    { id: 'signup', label: 'Inscription', href: '/inscription', group: 'Compte', keywords: 'signup inscription créer compte' },
    { id: 'upgrade', label: 'Inscriptions & Abonnements', href: '/abonnement', group: 'Compte', keywords: 'abonnement upgrade renouvellement inscription vip revendeur' },
    { id: 'vipkey', label: 'Clé VIP', href: '/vip-login', group: 'VIP', keywords: 'vip key cle token temporaire' },
    { id: 'chat', label: 'Tchat', href: '/tchat', group: 'Communauté', keywords: 'chat tchat communaute messages' },
    { id: 'admin', label: 'Admin Dashboard', href: '/admin', group: 'Admin', keywords: 'admin root dashboard' },
    { id: 'adminUsers', label: 'Admin: Gestion des abonnés', href: '/admin/users', group: 'Admin', keywords: 'admin users abonnes licences' },
    { id: 'adminCfg', label: 'Admin: Générateur de config', href: '/admin/config-generator', group: 'Admin', keywords: 'admin config generator vless tcp ssh dropbear udp slowdns banner bannière' },
    { id: 'adminDns', label: 'Admin: DNS / Cloudflare', href: '/admin/dns-cloudflare', group: 'Admin', keywords: 'admin dns cloudflare resolve ip' },
    { id: 'adminMsg', label: 'Admin: Messagerie', href: '/admin/messagerie', group: 'Admin', keywords: 'admin support messagerie tickets' },
    { id: 'logout', label: 'Déconnexion', href: '/logout', group: 'System', keywords: 'logout deconnexion sortir', kind: 'danger' },
  ];

  function stripDiacritics(s) {
    try {
      return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch {
      return String(s || '');
    }
  }

  function norm(s) {
    return stripDiacritics(String(s || '').toLowerCase().trim());
  }

  function pickAccent() {
    const styles = getComputedStyle(document.documentElement);
    const vars = ['--neon', '--revendeur', '--gold', '--vip', '--admin', '--primary', '--accent'];
    for (const v of vars) {
      const raw = (styles.getPropertyValue(v) || '').trim();
      if (raw) return raw;
    }
    return '#39ff14';
  }

  function clampByte(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.max(0, Math.min(255, Math.round(x)));
  }

  function parseToRgb(color) {
    const c = String(color || '').trim();
    if (!c) return { r: 57, g: 255, b: 20 };

    // #RGB or #RRGGBB
    if (c[0] === '#') {
      const hex = c.slice(1);
      if (hex.length === 3) {
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        if ([r, g, b].every(Number.isFinite)) return { r, g, b };
      } else if (hex.length === 6) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        if ([r, g, b].every(Number.isFinite)) return { r, g, b };
      }
    }

    // rgb(...) / rgba(...)
    const m = c.match(/^rgba?\(([^)]+)\)$/i);
    if (m) {
      const parts = m[1].split(',').map((x) => x.trim());
      const r = clampByte(parts[0]);
      const g = clampByte(parts[1]);
      const b = clampByte(parts[2]);
      return { r, g, b };
    }

    // Fallback: let the browser resolve computed color.
    try {
      const probe = document.createElement('span');
      probe.style.color = c;
      probe.style.display = 'none';
      document.body.appendChild(probe);
      const resolved = getComputedStyle(probe).color || '';
      probe.remove();
      const m2 = resolved.match(/^rgba?\(([^)]+)\)$/i);
      if (m2) {
        const parts = m2[1].split(',').map((x) => x.trim());
        return { r: clampByte(parts[0]), g: clampByte(parts[1]), b: clampByte(parts[2]) };
      }
    } catch { }

    return { r: 57, g: 255, b: 20 };
  }

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'cmdk-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = [
    '<div class="cmdk-panel" role="dialog" aria-modal="true" aria-label="Palette de commandes">',
    '  <div class="cmdk-scanline"></div>',
    '  <div class="cmdk-header">',
    '    <div class="cmdk-title">',
    '      <span class="cmdk-dot"></span>',
    '      <span id="cmdkTitle" class="cmdk-titleText">Palette de commandes</span>',
    '    </div>',
    '    <div class="cmdk-hint">CTRL + K</div>',
    '  </div>',
    '  <div class="cmdk-search">',
    '    <input id="cmdkInput" class="cmdk-input" type="text" placeholder="Tape un module: vip, admin, profil..." autocomplete="off" spellcheck="false" />',
    '  </div>',
    '  <div id="cmdkList" class="cmdk-list" role="listbox" aria-label="Actions"></div>',
    '  <div class="cmdk-footer">',
    '    <span class="cmdk-key">ENTER</span> ouvrir',
    '    <span class="cmdk-key">ESC</span> fermer',
    '    <span class="cmdk-key">UP</span><span class="cmdk-key">DOWN</span> naviguer',
    '  </div>',
    '</div>',
  ].join('\n');

  // Injection sécurisée
  function inject() {
    if (document.getElementById(OVERLAY_ID)) return;
    document.body.appendChild(overlay);
    document.body.appendChild(fab);
  }

  // document.body.appendChild(overlay); // Déplacé dans inject()

  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'cmdk-fab';
  fab.id = 'cmdkFab';
  fab.setAttribute('aria-label', 'Ouvrir la palette de commandes');
  fab.innerHTML = '<span class="cmdk-fabLabel">CTRL</span><span class="cmdk-fabPlus">+</span><span class="cmdk-fabKey">K</span>';
  // document.body.appendChild(fab); // Déplacé dans inject()

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }

  // Accent color binding (per-page theme)
  const accent = pickAccent();
  const rgb = parseToRgb(accent);
  const rgbStr = `${rgb.r}, ${rgb.g}, ${rgb.b}`;
  overlay.style.setProperty('--cmdk-accent', accent);
  overlay.style.setProperty('--cmdk-accent-rgb', rgbStr);
  fab.style.setProperty('--cmdk-accent', accent);
  fab.style.setProperty('--cmdk-accent-rgb', rgbStr);

  const input = overlay.querySelector('#cmdkInput');
  const list = overlay.querySelector('#cmdkList');
  const title = overlay.querySelector('#cmdkTitle');

  let isOpen = false;
  let navigating = false;
  let activeIndex = 0;
  let filtered = ACTIONS.slice();
  let lastFocus = null;

  function setTitle(text) {
    if (title) title.textContent = text;
  }

  function render() {
    if (!list) return;
    list.innerHTML = '';

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'cmdk-empty';
      empty.textContent = 'Aucun résultat. Essaie: vip, admin, hub, profil...';
      list.appendChild(empty);
      return;
    }

    filtered.forEach((a, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cmdk-item';
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', idx === activeIndex ? 'true' : 'false');
      btn.dataset.href = a.href;
      if (a.kind) btn.dataset.kind = a.kind;

      const left = document.createElement('div');
      left.className = 'cmdk-itemLeft';
      const label = document.createElement('div');
      label.className = 'cmdk-itemLabel';
      label.textContent = a.label;
      const group = document.createElement('div');
      group.className = 'cmdk-itemGroup';
      group.textContent = a.group || '';
      left.appendChild(label);
      left.appendChild(group);

      const right = document.createElement('div');
      right.className = 'cmdk-itemRight';
      const path = document.createElement('span');
      path.className = 'cmdk-path';
      path.textContent = a.href;
      right.appendChild(path);

      btn.appendChild(left);
      btn.appendChild(right);

      btn.addEventListener('mousemove', () => {
        if (activeIndex === idx) return;
        activeIndex = idx;
        syncSelection();
      });
      btn.addEventListener('click', () => activate(a));

      list.appendChild(btn);
    });
  }

  function syncSelection() {
    if (!list) return;
    const nodes = list.querySelectorAll('.cmdk-item');
    nodes.forEach((n, i) => n.setAttribute('aria-selected', i === activeIndex ? 'true' : 'false'));
    const current = nodes[activeIndex];
    if (current && typeof current.scrollIntoView === 'function') {
      current.scrollIntoView({ block: 'nearest' });
    }
  }

  function applyFilter(query) {
    const q = norm(query);
    if (!q) {
      filtered = ACTIONS.slice();
      activeIndex = 0;
      render();
      return;
    }
    filtered = ACTIONS.filter((a) => {
      const hay = `${a.label} ${a.group || ''} ${a.href} ${a.keywords || ''}`;
      return norm(hay).includes(q);
    });
    activeIndex = 0;
    render();
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    navigating = false;
    overlay.classList.remove('navigating');
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    lastFocus = document.activeElement;
    setTitle('Command Palette');
    if (input) {
      input.value = '';
      applyFilter('');
      input.focus();
    } else {
      applyFilter('');
    }
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    navigating = false;
    overlay.classList.remove('open');
    overlay.classList.remove('navigating');
    overlay.setAttribute('aria-hidden', 'true');
    setTitle('Command Palette');

    try {
      if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    } catch { }
    lastFocus = null;
  }

  function toggle() {
    if (isOpen) close();
    else open();
  }

  function activate(action) {
    if (!action || !action.href) return;
    if (navigating) return;
    navigating = true;
    overlay.classList.add('navigating');
    setTitle('Ouverture: ' + action.label);
    window.location.href = action.href;
  }

  function onGlobalKeyDown(e) {
    const k = String(e.key || '').toLowerCase();
    const isToggle = (k === 'k') && (e.ctrlKey || e.metaKey);
    if (isToggle) {
      e.preventDefault();
      toggle();
      return;
    }
    if (!isOpen) return;
    if (k === 'escape') {
      e.preventDefault();
      close();
    }
  }

  function onInputKeyDown(e) {
    if (!isOpen) return;
    const k = String(e.key || '').toLowerCase();
    if (k === 'arrowdown') {
      e.preventDefault();
      if (!filtered.length) return;
      activeIndex = (activeIndex + 1) % filtered.length;
      syncSelection();
      return;
    }
    if (k === 'arrowup') {
      e.preventDefault();
      if (!filtered.length) return;
      activeIndex = (activeIndex - 1 + filtered.length) % filtered.length;
      syncSelection();
      return;
    }
    if (k === 'enter') {
      e.preventDefault();
      if (!filtered.length) return;
      activate(filtered[activeIndex]);
      return;
    }
  }

  document.addEventListener('keydown', onGlobalKeyDown, { passive: false });
  if (input) {
    input.addEventListener('keydown', onInputKeyDown);
    input.addEventListener('input', () => applyFilter(input.value || ''));
  }

  fab.addEventListener('click', open);

  overlay.addEventListener('click', (e) => {
    // Click outside the panel closes it.
    if (e.target === overlay) close();
  });

  // Avoid double-inject on bfcache navigation
  window.addEventListener('pageshow', () => {
    // If coming back, ensure the palette isn't stuck open.
    if (overlay.classList.contains('open')) close();
  });
})();


