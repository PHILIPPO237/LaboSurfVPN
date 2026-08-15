(() => {
  const INTERACTIVE_SELECTOR = "a,button,input,select,textarea,summary,[role='button'],[role='link']";
  const CLICKABLE_SELECTOR = "[onclick]:not([data-ui-a11y='done'])";
  const INSTANT_NAV_SELECTOR = "[onclick*='location.href']:not([data-instant-nav='done']),[onclick*='window.location.href']:not([data-instant-nav='done'])";
  const PREFETCH_NAV_SELECTOR = "a[href]:not([data-nav-prefetch='done']),[onclick*='location.href']:not([data-nav-prefetch='done']),[onclick*='window.location.href']:not([data-nav-prefetch='done'])";
  const NAV_HANDLER_RE = /(?:window\.)?location\.href\s*=\s*(["'])(.*?)\1/i;
  const PREFETCH_DELAY_MS = 80;
  const prefetchedNavUrls = new Set();
  const pendingPrefetchTimers = new Map();

  function inferRole(el) {
    const handler = String(el.getAttribute("onclick") || "").toLowerCase();
    if (handler.includes("location.href") || handler.includes("window.open")) {
      return "link";
    }
    return "button";
  }

  function inferLabel(el) {
    const explicit = el.getAttribute("aria-label") || el.getAttribute("title");
    if (explicit && explicit.trim()) return explicit.trim();

    const guide = el.getAttribute("data-guide-id");
    if (guide && guide.trim()) {
      return `Ouvrir ${guide.trim().replace(/[-_]+/g, " ")}`;
    }

    const text = String(el.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    return text || "Action";
  }

  function isNativeInteractive(el) {
    return Boolean(el.closest(INTERACTIVE_SELECTOR));
  }

  function extractNavigationHref(el) {
    const handler = String(el.getAttribute("onclick") || "").trim();
    if (!handler) return "";
    const match = handler.match(NAV_HANDLER_RE);
    if (!match) return "";
    const href = String(match[2] || "").trim();
    if (!href || href.toLowerCase().startsWith("javascript:")) return "";
    return href;
  }

  function normalizeNavigationHref(href) {
    if (!href) return "";
    try {
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return "";
      if (!/^https?:$/.test(url.protocol)) return "";
      if (url.pathname === "/logout" || url.pathname.startsWith("/api/")) return "";
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return "";
      }
      url.hash = "";
      return url.href;
    } catch (_error) {
      return "";
    }
  }

  function resolveNavigationHref(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.tagName === "A") {
      if (el.hasAttribute("download")) return "";
      const target = String(el.getAttribute("target") || "").trim().toLowerCase();
      if (target && target !== "_self") return "";
      return normalizeNavigationHref(el.getAttribute("href") || el.href || "");
    }
    return normalizeNavigationHref(extractNavigationHref(el));
  }

  function cancelScheduledPrefetch(url) {
    if (!url) return;
    const timerId = pendingPrefetchTimers.get(url);
    if (timerId == null) return;
    clearTimeout(timerId);
    pendingPrefetchTimers.delete(url);
  }

  function performNavigationPrefetch(url) {
    if (!url || prefetchedNavUrls.has(url)) return;
    if (!window.fetch) return;
    if (navigator.connection && navigator.connection.saveData) return;

    prefetchedNavUrls.add(url);
    window
      .fetch(url, {
        method: "GET",
        credentials: "same-origin",
        cache: "force-cache",
        headers: { "X-FS-Prefetch": "1" }
      })
      .catch(() => {
        prefetchedNavUrls.delete(url);
      });
  }

  function scheduleNavigationPrefetch(url) {
    if (!url || prefetchedNavUrls.has(url) || pendingPrefetchTimers.has(url)) return;
    const timerId = window.setTimeout(() => {
      pendingPrefetchTimers.delete(url);
      performNavigationPrefetch(url);
    }, PREFETCH_DELAY_MS);
    pendingPrefetchTimers.set(url, timerId);
  }

  function enhanceNavigationPrefetch(el) {
    if (!el || el.nodeType !== 1) return;
    if (el.getAttribute("data-nav-prefetch") === "done") return;

    const href = resolveNavigationHref(el);
    el.setAttribute("data-nav-prefetch", "done");
    if (!href) return;

    const schedule = () => scheduleNavigationPrefetch(href);
    const cancel = () => cancelScheduledPrefetch(href);

    el.addEventListener("pointerenter", schedule, { passive: true });
    el.addEventListener("focus", schedule);
    el.addEventListener("touchstart", schedule, { passive: true, once: true });
    el.addEventListener("pointerleave", cancel, { passive: true });
    el.addEventListener("blur", cancel);
  }

  function enhanceInstantNavigation(el) {
    if (!el || el.nodeType !== 1) return;
    if (el.getAttribute("data-instant-nav") === "done") return;

    const href = resolveNavigationHref(el);
    if (!href) {
      el.setAttribute("data-instant-nav", "done");
      return;
    }

    el.setAttribute("data-instant-nav", "done");
    el.addEventListener(
      "pointerdown",
      (event) => {
        if (event.button !== 0) return;
        if (event.pointerType === "mouse" && (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)) {
          return;
        }
        event.preventDefault();
        window.location.assign(href);
      },
      { passive: false }
    );
  }

  function enhanceElement(el) {
    if (!el || el.nodeType !== 1) return;
    if (el.matches(INTERACTIVE_SELECTOR) || isNativeInteractive(el)) return;

    if (!el.hasAttribute("tabindex")) {
      el.tabIndex = 0;
    }

    if (!el.hasAttribute("role")) {
      el.setAttribute("role", inferRole(el));
    }

    if (!el.hasAttribute("aria-label")) {
      el.setAttribute("aria-label", inferLabel(el));
    }

    el.classList.add("ui-clickable");
    el.setAttribute("data-ui-a11y", "done");

    el.addEventListener("keydown", (event) => {
      const key = event.key;
      if (key !== "Enter" && key !== " ") return;
      event.preventDefault();
      el.click();
    });
  }

  function run(root = document) {
    const nodes = root.querySelectorAll(CLICKABLE_SELECTOR);
    nodes.forEach(enhanceElement);

    const navNodes = root.querySelectorAll(INSTANT_NAV_SELECTOR);
    navNodes.forEach(enhanceInstantNavigation);

    const prefetchNodes = root.querySelectorAll(PREFETCH_NAV_SELECTOR);
    prefetchNodes.forEach(enhanceNavigationPrefetch);
  }

  // --- COMPTEUR D'INACTIVITÉ (15 MINUTES) ---
  function setupIdleTimer() {
    // On ignore les pages publiques
    const path = window.location.pathname;
    if (path === '/' || path.startsWith('/acces') || path.startsWith('/inscription')) return;

    let warningTimeout;
    let forceLogoutTimeout;
    const WARNING_DELAY = 14 * 60 * 1000; // 14 minutes (en millisecondes)
    const FORCE_LOGOUT_DELAY = 60 * 1000; // 1 minute (en millisecondes)

    function performLogout() {
      window.location.assign('/logout');
    }

    function showIdleWarning() {
      if (window.showConfirmModal) {
        window.showConfirmModal({
          title: 'Inactivité détectée',
          message: 'Votre session va expirer dans 60 secondes par mesure de sécurité. Voulez-vous rester connecté ?',
          confirmText: 'Rester connecté',
          cancelText: 'Déconnexion',
          onConfirm: () => { clearTimeout(forceLogoutTimeout); resetTimer(); },
          onCancel: performLogout
        });
      }
      // Démarrage du compte à rebours fatal
      forceLogoutTimeout = setTimeout(performLogout, FORCE_LOGOUT_DELAY);
    }

    function resetTimer() {
      // Si la modale est affichée, bouger la souris ne suffit plus, l'utilisateur DOIT cliquer.
      if (document.getElementById('confirm-modal-overlay')) return;
      
      clearTimeout(warningTimeout);
      clearTimeout(forceLogoutTimeout);
      warningTimeout = setTimeout(showIdleWarning, WARNING_DELAY);
    }

    // On écoute l'activité de l'utilisateur
    ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'].forEach(evt => {
      document.addEventListener(evt, resetTimer, { passive: true });
    });

    resetTimer(); // Démarrage initial
  }

  function init() {
    run(document);

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (!node || node.nodeType !== 1) return;
          if (node.matches && node.matches(CLICKABLE_SELECTOR)) {
            enhanceElement(node);
          }
          if (node.matches && node.matches(INSTANT_NAV_SELECTOR)) {
            enhanceInstantNavigation(node);
          }
          if (node.matches && node.matches(PREFETCH_NAV_SELECTOR)) {
            enhanceNavigationPrefetch(node);
          }
          run(node);
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
    
    // Lancement du timer d'inactivité
    setupIdleTimer();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
