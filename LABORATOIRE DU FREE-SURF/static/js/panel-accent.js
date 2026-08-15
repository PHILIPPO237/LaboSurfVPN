(function () {
  const STORAGE_KEY = "panel_accent_map_v1";
  const DEFAULTS = {
    free: "#39ff14",
    vip: "#ffd700",
    premium: "#ffd700",
    reseller: "#00f2ff",
    admin: "#ff0044",
    chat: "#00f2ff",
  };  const PANEL_KEYS = Object.keys(DEFAULTS);

  function normalizeHex(value) {
    if (!value) return null;
    let hex = String(value).trim().toLowerCase();
    if (!hex.startsWith("#")) hex = "#" + hex;
    if (!/^#[0-9a-f]{3,8}$/.test(hex)) return null;
    if (hex.length === 4) {
      hex =
        "#" +
        hex[1] +
        hex[1] +
        hex[2] +
        hex[2] +
        hex[3] +
        hex[3];
    }
    if (hex.length >= 7) return hex.slice(0, 7);
    return null;
  }

  function hexToRgb(hex) {
    const normalized = normalizeHex(hex);
    if (!normalized) return null;
    const raw = normalized.slice(1);
    const r = parseInt(raw.slice(0, 2), 16);
    const g = parseInt(raw.slice(2, 4), 16);
    const b = parseInt(raw.slice(4, 6), 16);
    return r + ", " + g + ", " + b;
  }

  function loadMap() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      if (!parsed || typeof parsed !== "object") return {};
      const out = {};
      for (const key of PANEL_KEYS) {
        const normalized = normalizeHex(parsed[key]);
        if (normalized) out[key] = normalized;
      }
      return out;
    } catch (err) {
      return {};
    }
  }

  function emitChange() {
    try {
      const detail = { map: loadResolvedMap() };
      window.dispatchEvent(new CustomEvent("panel-accent:change", { detail: detail }));
    } catch (err) {
      // ignore event dispatch failures
    }
  }

  function saveMap(map) {
    const cleaned = {};
    for (const key of PANEL_KEYS) {
      const normalized = normalizeHex(map && map[key]);
      if (normalized) cleaned[key] = normalized;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
    } catch (err) {
      // ignore storage failures
    }
    emitChange();
  }

  function loadResolvedMap() {
    const map = loadMap();
    const out = {};
    for (const key of PANEL_KEYS) {
      out[key] = normalizeHex(map[key]) || DEFAULTS[key];
    }
    return out;
  }

  function getColor(panelKey) {
    const map = loadMap();
    const custom = normalizeHex(map[panelKey]);
    if (custom) return custom;
    return DEFAULTS[panelKey] || "#00f2ff";
  }

  function setColor(panelKey, color) {
    if (!DEFAULTS[panelKey]) return null;
    const normalized = normalizeHex(color);
    if (!normalized) return null;
    const map = loadMap();
    map[panelKey] = normalized;
    saveMap(map);
    return normalized;
  }

  function resetColor(panelKey) {
    if (!DEFAULTS[panelKey]) return null;
    const map = loadMap();
    if (Object.prototype.hasOwnProperty.call(map, panelKey)) {
      delete map[panelKey];
      saveMap(map);
    } else {
      emitChange();
    }
    return DEFAULTS[panelKey];
  }

  function resetAll() {
    saveMap({});
  }

  function applyForPanel(panelKey) {
    const color = getColor(panelKey);
    const rgb = hexToRgb(color) || "0, 242, 255";
    const root = document.documentElement;
    root.style.setProperty("--panel-accent", color);
    root.style.setProperty("--panel-accent-rgb", rgb);

    // Compatibility with existing per-page tokens.
    root.style.setProperty("--neon", color);
    root.style.setProperty("--vip", color);
    root.style.setProperty("--reseller", color);

    return { color, rgb };
  }

  function autoApplyFromBody() {
    if (!document.body) return;
    const panelKey = document.body.getAttribute("data-panel-key");
    if (!panelKey) return;
    applyForPanel(panelKey);
  }

  window.PanelAccentTheme = {
    STORAGE_KEY: STORAGE_KEY,
    DEFAULTS: DEFAULTS,
    PANEL_KEYS: PANEL_KEYS,
    normalizeHex: normalizeHex,
    hexToRgb: hexToRgb,
    loadMap: loadMap,
    loadResolvedMap: loadResolvedMap,
    saveMap: saveMap,
    getColor: getColor,
    setColor: setColor,
    resetColor: resetColor,
    resetAll: resetAll,
    applyForPanel: applyForPanel,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoApplyFromBody, { once: true });
  } else {
    autoApplyFromBody();
  }

  window.addEventListener("panel-accent:change", autoApplyFromBody);
  window.addEventListener("storage", function (event) {
    if (event && event.key === STORAGE_KEY) {
      autoApplyFromBody();
      emitChange();
    }
  });
})();



