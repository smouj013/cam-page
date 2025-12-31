/* catalogControl.js — RLC Catalog Control v1.0.1
   ✅ Solo para control.html
   ✅ Guarda config en localStorage (keyed + legacy)
   ✅ Emite config por BroadcastChannel (keyed + legacy)
   ✅ No toca control.js / app.js
   ✅ Boot sync: emite config al arrancar (para que el player se entere aunque no toques nada)
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const LOAD_GUARD = "__RLC_CATALOG_CONTROL_LOADED_V101";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  const BUS_BASE = "rlc_bus_v1";
  const CFG_BASE = "rlc_catalog_cfg_v1";
  const PING_BASE = "rlc_catalog_ping_v1";

  const qs = (s, r = document) => r.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (v, fb) => {
    const n = parseFloat(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fb;
  };
  const safeStr = (v) => (typeof v === "string") ? v.trim() : "";

  function parseParams() {
    const u = new URL(location.href);
    return { key: (u.searchParams.get("key") || "").trim() };
  }
  const KEY = String(parseParams().key || "").trim();

  const BUS = KEY ? `${BUS_BASE}:${KEY}` : BUS_BASE;
  const BUS_LEGACY = BUS_BASE;

  const CFG_KEY = KEY ? `${CFG_BASE}:${KEY}` : CFG_BASE;
  const CFG_KEY_LEGACY = CFG_BASE;

  const PING_KEY = KEY ? `${PING_BASE}:${KEY}` : PING_BASE;
  const PING_KEY_LEGACY = PING_BASE;

  const bcMain = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS) : null;
  const bcLegacy = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_LEGACY) : null;

  const DEFAULTS = {
    enabled: false,
    layout: "quad",     // 2x2 (4)
    gapPx: 8,
    labels: true,
    muted: true
  };

  function readJson(k) {
    try {
      const raw = localStorage.getItem(k);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return (obj && typeof obj === "object") ? obj : null;
    } catch (_) { return null; }
  }
  function writeJson(k, obj) { try { localStorage.setItem(k, JSON.stringify(obj)); } catch (_) {} }
  function clearKey(k) { try { localStorage.removeItem(k); } catch (_) {} }

  function normalizeCfg(inCfg) {
    const c = Object.assign({}, DEFAULTS, inCfg || {});
    c.enabled = (c.enabled === true);

    const layout = safeStr(c.layout).toLowerCase();
    c.layout = (layout === "quad") ? "quad" : "quad";

    c.gapPx = clamp(num(c.gapPx, DEFAULTS.gapPx), 0, 24);
    c.labels = (c.labels !== false);
    c.muted = (c.muted !== false);
    return c;
  }

  function loadCfg() {
    const keyed = readJson(CFG_KEY);
    const legacy = readJson(CFG_KEY_LEGACY);
    return normalizeCfg(keyed || legacy || DEFAULTS);
  }

  function saveCfg(cfg) {
    const c = normalizeCfg(cfg);
    writeJson(CFG_KEY, c);
    writeJson(CFG_KEY_LEGACY, c); // compat
    return c;
  }

  function sendCfg(cfg) {
    const msg = { type: "CATALOG_CFG", cfg, ts: Date.now() };
    if (KEY) msg.key = KEY;

    try { if (bcMain) bcMain.postMessage(msg); } catch (_) {}
    try { if (bcLegacy) bcLegacy.postMessage(msg); } catch (_) {}

    // fallback para disparar "storage" cross-tab
    try { localStorage.setItem(PING_KEY, String(Date.now())); } catch (_) {}
    try { localStorage.setItem(PING_KEY_LEGACY, String(Date.now())); } catch (_) {}
  }

  function setStatus(text, ok = true) {
    const el = qs("#ctlCatalogStatus");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("pill--ok", !!ok);
    el.classList.toggle("pill--bad", !ok);
  }

  function applyUIFromCfg(cfg) {
    const c = normalizeCfg(cfg);

    const on = qs("#ctlCatalogOn");
    const layout = qs("#ctlCatalogLayout");
    const gap = qs("#ctlCatalogGap");
    const labels = qs("#ctlCatalogLabels");
    const muted = qs("#ctlCatalogMuted");

    if (on) on.value = c.enabled ? "on" : "off";
    if (layout) layout.value = c.layout;
    if (gap) gap.value = String(c.gapPx);
    if (labels) labels.value = c.labels ? "on" : "off";
    if (muted) muted.value = c.muted ? "on" : "off";

    setStatus(c.enabled ? "Catálogo: ON" : "Catálogo: OFF", c.enabled);
  }

  function collectCfgFromUI() {
    const on = qs("#ctlCatalogOn")?.value || "off";
    const layout = qs("#ctlCatalogLayout")?.value || "quad";
    const gapPx = num(qs("#ctlCatalogGap")?.value, DEFAULTS.gapPx);
    const labels = (qs("#ctlCatalogLabels")?.value || "on") !== "off";
    const muted = (qs("#ctlCatalogMuted")?.value || "on") !== "off";

    return normalizeCfg({
      enabled: (on === "on"),
      layout,
      gapPx,
      labels,
      muted
    });
  }

  function boot() {
    // Si no existe UI, salimos sin romper
    if (!qs("#ctlCatalogApply") || !qs("#ctlCatalogOn")) return;

    const saved = saveCfg(loadCfg());
    applyUIFromCfg(saved);

    const doApply = () => {
      const cfg = saveCfg(collectCfgFromUI());
      sendCfg(cfg);
      applyUIFromCfg(cfg);
    };

    qs("#ctlCatalogApply")?.addEventListener("click", doApply);

    qs("#ctlCatalogReset")?.addEventListener("click", () => {
      clearKey(CFG_KEY);
      clearKey(CFG_KEY_LEGACY);
      const cfg = saveCfg(DEFAULTS);
      sendCfg(cfg);
      applyUIFromCfg(cfg);
    });

    // Live apply suave
    const live = ["#ctlCatalogOn", "#ctlCatalogLayout", "#ctlCatalogGap", "#ctlCatalogLabels", "#ctlCatalogMuted"];
    for (const sel of live) {
      const el = qs(sel);
      if (!el) continue;
      el.addEventListener("change", doApply);
      el.addEventListener("input", () => {
        // range/text inputs
        doApply();
      });
    }

    // si otra pestaña cambia config
    window.addEventListener("storage", (e) => {
      if (!e) return;
      if (e.key === CFG_KEY || e.key === CFG_KEY_LEGACY) {
        const c = loadCfg();
        applyUIFromCfg(c);
      }
    });

    // Boot sync (muy importante si el player ya está abierto)
    try { setTimeout(() => sendCfg(saved), 120); } catch (_) { try { sendCfg(saved); } catch (_) {} }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
