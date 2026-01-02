/* catalogControl.js — RLC Catalog Control v1.2.0
   ✅ Solo para control.html
   ✅ Guarda config en localStorage (keyed + legacy)
   ✅ Emite config por BroadcastChannel (keyed + legacy)
   ✅ Boot sync: emite config al arrancar (para que el player se entere aunque no toques nada)
   ✅ Live apply suave (change/input con debounce)
   ✅ Soporta nuevas opciones del Catalog View v1.1.3:
      - mode: "follow" | "sync"
      - followSlot: 0..3
      - clickCycle: true/false
      - ytCookies: true/false
      - wxTiles: true/false
      - wxRefreshSec: 10..180
   ✅ No rompe si tu HTML no tiene los nuevos controles:
      - Si faltan, usa defaults/guardado y no crashea
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const LOAD_GUARD = "__RLC_CATALOG_CONTROL_LOADED_V120";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  // ───────────────────────── Keys / Bus
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
    return { key: safeStr(u.searchParams.get("key") || "") };
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

  // ───────────────────────── Defaults (compat + nuevas opciones)
  const DEFAULTS = {
    enabled: false,
    layout: "quad",     // 2x2 (4)
    gapPx: 8,
    labels: true,
    muted: true,

    // v1.1.x
    mode: "follow",     // "follow" | "sync"
    followSlot: 0,      // 0..3
    clickCycle: true,
    ytCookies: true,

    // WX tiles
    wxTiles: true,
    wxRefreshSec: 30
  };

  // ───────────────────────── Storage helpers
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

  // ───────────────────────── Normalize
  function normalizeCfg(inCfg) {
    const c = Object.assign({}, DEFAULTS, inCfg || {});

    c.enabled = (c.enabled === true);

    // layout fijo
    c.layout = "quad";

    c.gapPx = clamp(num(c.gapPx, DEFAULTS.gapPx), 0, 24);
    c.labels = (c.labels !== false);
    c.muted = (c.muted !== false);

    const mode = safeStr(c.mode).toLowerCase();
    c.mode = (mode === "sync") ? "sync" : "follow";
    c.followSlot = clamp((parseInt(c.followSlot, 10) || 0), 0, 3);

    c.clickCycle = (c.clickCycle !== false);
    c.ytCookies = (c.ytCookies !== false);

    c.wxTiles = (c.wxTiles !== false);
    c.wxRefreshSec = clamp((parseInt(c.wxRefreshSec, 10) || DEFAULTS.wxRefreshSec), 10, 180);

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

  // ───────────────────────── Send config
  function sendCfg(cfg) {
    const msg = { type: "CATALOG_CFG", cfg, ts: Date.now() };
    if (KEY) msg.key = KEY;

    try { if (bcMain) bcMain.postMessage(msg); } catch (_) {}
    try { if (bcLegacy) bcLegacy.postMessage(msg); } catch (_) {}

    // fallback “storage ping” cross-tab
    try { localStorage.setItem(PING_KEY, String(Date.now())); } catch (_) {}
    try { localStorage.setItem(PING_KEY_LEGACY, String(Date.now())); } catch (_) {}
  }

  // ───────────────────────── UI helpers
  function setStatus(text, ok = true) {
    const el = qs("#ctlCatalogStatus");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("pill--ok", !!ok);
    el.classList.toggle("pill--bad", !ok);
  }

  // Lee value de select estilo on/off si existe; si no, fallback
  function readOnOff(sel, fallbackBool) {
    const el = qs(sel);
    if (!el) return fallbackBool;
    const v = safeStr(el.value).toLowerCase();
    if (v === "on") return true;
    if (v === "off") return false;
    // si el HTML usa checkbox accidentalmente
    if (typeof el.checked === "boolean") return !!el.checked;
    return fallbackBool;
  }

  function writeOnOff(sel, bool) {
    const el = qs(sel);
    if (!el) return;
    if ("value" in el) el.value = bool ? "on" : "off";
    if (typeof el.checked === "boolean") el.checked = !!bool;
  }

  function applyUIFromCfg(cfg) {
    const c = normalizeCfg(cfg);

    // existentes v1.0.1
    if (qs("#ctlCatalogOn")) writeOnOff("#ctlCatalogOn", c.enabled);
    if (qs("#ctlCatalogLayout")) qs("#ctlCatalogLayout").value = "quad";
    if (qs("#ctlCatalogGap")) qs("#ctlCatalogGap").value = String(c.gapPx);
    if (qs("#ctlCatalogLabels")) writeOnOff("#ctlCatalogLabels", c.labels);
    if (qs("#ctlCatalogMuted")) writeOnOff("#ctlCatalogMuted", c.muted);

    // nuevos (si existen)
    if (qs("#ctlCatalogMode")) qs("#ctlCatalogMode").value = c.mode;               // follow/sync
    if (qs("#ctlCatalogFollowSlot")) qs("#ctlCatalogFollowSlot").value = String(c.followSlot);
    if (qs("#ctlCatalogClickCycle")) writeOnOff("#ctlCatalogClickCycle", c.clickCycle);
    if (qs("#ctlCatalogYtCookies")) writeOnOff("#ctlCatalogYtCookies", c.ytCookies);

    if (qs("#ctlCatalogWxTiles")) writeOnOff("#ctlCatalogWxTiles", c.wxTiles);
    if (qs("#ctlCatalogWxRefreshSec")) qs("#ctlCatalogWxRefreshSec").value = String(c.wxRefreshSec);

    setStatus(c.enabled ? "Catálogo: ON" : "Catálogo: OFF", c.enabled);
  }

  function collectCfgFromUI() {
    const base = loadCfg(); // para no “perder” campos si faltan inputs

    // existentes v1.0.1
    const enabled = readOnOff("#ctlCatalogOn", base.enabled);
    const gapPx = num(qs("#ctlCatalogGap")?.value, base.gapPx);
    const labels = readOnOff("#ctlCatalogLabels", base.labels);
    const muted = readOnOff("#ctlCatalogMuted", base.muted);

    // nuevos (si existen)
    const modeEl = qs("#ctlCatalogMode");
    const mode = modeEl ? safeStr(modeEl.value).toLowerCase() : base.mode;

    const fsEl = qs("#ctlCatalogFollowSlot");
    const followSlot = fsEl ? (parseInt(fsEl.value, 10) || 0) : base.followSlot;

    const clickCycle = readOnOff("#ctlCatalogClickCycle", base.clickCycle);
    const ytCookies = readOnOff("#ctlCatalogYtCookies", base.ytCookies);

    const wxTiles = readOnOff("#ctlCatalogWxTiles", base.wxTiles);
    const wxRefreshSec = num(qs("#ctlCatalogWxRefreshSec")?.value, base.wxRefreshSec);

    return normalizeCfg({
      enabled,
      layout: "quad",
      gapPx,
      labels,
      muted,

      mode,
      followSlot,
      clickCycle,
      ytCookies,

      wxTiles,
      wxRefreshSec
    });
  }

  // ───────────────────────── Debounce (para input events)
  function debounce(fn, waitMs = 140) {
    let t = null;
    return (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => { t = null; fn(...args); }, waitMs);
    };
  }

  // ───────────────────────── Boot
  function boot() {
    // Si no existe UI mínima, salimos sin romper
    if (!qs("#ctlCatalogApply") || !qs("#ctlCatalogOn")) return;

    // Guarda/normaliza lo que hubiera
    const saved = saveCfg(loadCfg());
    applyUIFromCfg(saved);

    const doApply = () => {
      const cfg = saveCfg(collectCfgFromUI());
      sendCfg(cfg);
      applyUIFromCfg(cfg);
    };

    const doApplyDebounced = debounce(doApply, 160);

    // Botón apply
    qs("#ctlCatalogApply")?.addEventListener("click", doApply);

    // Reset
    qs("#ctlCatalogReset")?.addEventListener("click", () => {
      clearKey(CFG_KEY);
      clearKey(CFG_KEY_LEGACY);

      // opcional: no borramos ping keys, pero da igual
      const cfg = saveCfg(DEFAULTS);
      sendCfg(cfg);
      applyUIFromCfg(cfg);
    });

    // Live apply suave (inputs existentes + nuevos si están)
    const live = [
      "#ctlCatalogOn",
      "#ctlCatalogLayout",
      "#ctlCatalogGap",
      "#ctlCatalogLabels",
      "#ctlCatalogMuted",

      "#ctlCatalogMode",
      "#ctlCatalogFollowSlot",
      "#ctlCatalogClickCycle",
      "#ctlCatalogYtCookies",

      "#ctlCatalogWxTiles",
      "#ctlCatalogWxRefreshSec"
    ];

    for (const sel of live) {
      const el = qs(sel);
      if (!el) continue;

      // change (select)
      el.addEventListener("change", doApply);

      // input (range/text)
      el.addEventListener("input", () => {
        // en selects no hace falta, pero tampoco molesta
        doApplyDebounced();
      });
    }

    // Si otra pestaña cambia config
    window.addEventListener("storage", (e) => {
      if (!e) return;
      if (e.key === CFG_KEY || e.key === CFG_KEY_LEGACY) {
        const c = loadCfg();
        applyUIFromCfg(c);
      }
    });

    // Boot sync (muy importante si el player ya está abierto)
    try { setTimeout(() => sendCfg(saved), 120); } catch (_) {
      try { sendCfg(saved); } catch (_) {}
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
