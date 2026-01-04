/* catalogControl.js — RLC Catalog Control v1.3.1 (MULTI-TILES + SINGLETON HARDEN)
   ✅ Solo para control.html
   ✅ Guarda config en localStorage (keyed + legacy)
   ✅ Emite config por BroadcastChannel (keyed + legacy)
   ✅ Boot sync: emite config al arrancar (player se entera aunque no toques nada)
   ✅ Live apply suave (change/input con debounce)
   ✅ MULTI-TILES:
      - layout presets: "quad"(4), "six"(6), "nine"(9), "twelve"(12), "sixteen"(16), "custom"
      - tiles: 1..25
      - cols/rows: 1..6 (auto-ajusta si cols*rows < tiles)
   ✅ Compat total: si tu HTML NO tiene los nuevos controles => usa defaults/guardado y NO crashea
   ✅ Harden:
      - singleton con destroy() para evitar doble carga y listeners duplicados
      - followSlot UI clampa al rango de options existentes (si tu select tiene solo 0..3)
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const VER = "1.3.1";
  const INST_KEY = "__RLC_CATALOG_CONTROL_INSTANCE__";

  // Singleton (si recarga por caché/hot-reload, limpia la instancia anterior)
  try {
    const prev = g[INST_KEY];
    if (prev && prev.__ver === VER) return;
    if (prev && typeof prev.destroy === "function") prev.destroy();
  } catch (_) {}

  // ───────────────────────── Keys / Bus
  const BUS_BASE  = "rlc_bus_v1";
  const CFG_BASE  = "rlc_catalog_cfg_v1";
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

  const BUS        = KEY ? `${BUS_BASE}:${KEY}` : BUS_BASE;
  const BUS_LEGACY = BUS_BASE;

  const CFG_KEY        = KEY ? `${CFG_BASE}:${KEY}` : CFG_BASE;
  const CFG_KEY_LEGACY = CFG_BASE;

  const PING_KEY        = KEY ? `${PING_BASE}:${KEY}` : PING_BASE;
  const PING_KEY_LEGACY = PING_BASE;

  const bcMain   = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS) : null;
  const bcLegacy = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_LEGACY) : null;

  // ───────────────────────── Layout presets
  const LAYOUTS = {
    quad:    { tiles: 4,  cols: 2, rows: 2 },
    six:     { tiles: 6,  cols: 3, rows: 2 },
    nine:    { tiles: 9,  cols: 3, rows: 3 },
    twelve:  { tiles: 12, cols: 4, rows: 3 },
    sixteen: { tiles: 16, cols: 4, rows: 4 }
  };

  function autoGridForTiles(tiles) {
    const t = clamp((parseInt(tiles, 10) || 4), 1, 25);
    const cols = clamp(Math.ceil(Math.sqrt(t)), 1, 6);
    const rows = clamp(Math.ceil(t / cols), 1, 6);
    return { tiles: t, cols, rows };
  }

  // ───────────────────────── Defaults (compat + multi)
  const DEFAULTS = {
    enabled: false,

    layout: "quad", // quad|six|nine|twelve|sixteen|custom
    tiles: 4,
    cols: 2,
    rows: 2,

    gapPx: 8,
    labels: true,
    muted: true,

    mode: "follow", // follow|sync
    followSlot: 0,
    clickCycle: true,
    ytCookies: true,

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

    c.gapPx  = clamp(num(c.gapPx, DEFAULTS.gapPx), 0, 24);
    c.labels = (c.labels !== false);
    c.muted  = (c.muted !== false);

    const mode = safeStr(c.mode).toLowerCase();
    c.mode = (mode === "sync") ? "sync" : "follow";

    let layout = safeStr(c.layout).toLowerCase();

    if (layout && /^\d+$/.test(layout)) {
      const g0 = autoGridForTiles(parseInt(layout, 10));
      c.layout = "custom";
      c.tiles = g0.tiles; c.cols = g0.cols; c.rows = g0.rows;
    } else if (layout in LAYOUTS) {
      const p = LAYOUTS[layout];
      c.layout = layout;
      c.tiles = p.tiles; c.cols = p.cols; c.rows = p.rows;
    } else {
      c.layout = "custom";
      const g1 = autoGridForTiles(c.tiles);
      c.tiles = g1.tiles;

      c.cols = clamp((parseInt(c.cols, 10) || g1.cols), 1, 6);
      c.rows = clamp((parseInt(c.rows, 10) || g1.rows), 1, 6);

      if ((c.cols * c.rows) < c.tiles) {
        c.rows = clamp(Math.ceil(c.tiles / c.cols), 1, 6);
        if ((c.cols * c.rows) < c.tiles) {
          const g2 = autoGridForTiles(c.tiles);
          c.cols = g2.cols; c.rows = g2.rows;
        }
      }
    }

    c.followSlot = clamp((parseInt(c.followSlot, 10) || 0), 0, Math.max(0, (c.tiles | 0) - 1));
    c.clickCycle = (c.clickCycle !== false);
    c.ytCookies  = (c.ytCookies !== false);

    c.wxTiles = (c.wxTiles !== false);
    c.wxRefreshSec = clamp((parseInt(c.wxRefreshSec, 10) || DEFAULTS.wxRefreshSec), 10, 180);

    return c;
  }

  function loadCfg() {
    const keyed  = readJson(CFG_KEY);
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

    try { bcMain && bcMain.postMessage(msg); } catch (_) {}
    try { bcLegacy && bcLegacy.postMessage(msg); } catch (_) {}

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

  function readOnOff(sel, fallbackBool) {
    const el = qs(sel);
    if (!el) return fallbackBool;
    const v = safeStr(el.value).toLowerCase();
    if (v === "on") return true;
    if (v === "off") return false;
    if (typeof el.checked === "boolean") return !!el.checked;
    return fallbackBool;
  }

  function writeOnOff(sel, bool) {
    const el = qs(sel);
    if (!el) return;
    if ("value" in el) el.value = bool ? "on" : "off";
    if (typeof el.checked === "boolean") el.checked = !!bool;
  }

  function setSelectValueIfExists(sel, value) {
    const el = qs(sel);
    if (!el) return;
    const v = String(value ?? "");
    const opts = Array.from(el.options || []);
    const has = opts.some(o => String(o.value) === v);
    if (has) el.value = v;
  }

  function setSelectIntClampedToOptions(sel, value) {
    const el = qs(sel);
    if (!el) return;

    const opts = Array.from(el.options || []);
    if (!opts.length) {
      try { el.value = String(value ?? "0"); } catch (_) {}
      return;
    }

    const exact = String(value ?? "");
    if (opts.some(o => String(o.value) === exact)) {
      el.value = exact;
      return;
    }

    const nums = opts
      .map(o => parseInt(String(o.value), 10))
      .filter(n => Number.isFinite(n));
    if (!nums.length) return;

    const lo = Math.min(...nums);
    const hi = Math.max(...nums);
    const cl = clamp((parseInt(value, 10) || 0), lo, hi);
    const v = String(cl);
    if (opts.some(o => String(o.value) === v)) el.value = v;
  }

  function setInputValueIfExists(sel, value) {
    const el = qs(sel);
    if (!el) return;
    try { el.value = String(value ?? ""); } catch (_) {}
  }

  function readFirstFoundValue(selectors, fallback) {
    for (const sel of selectors) {
      const el = qs(sel);
      if (!el) continue;
      const s = safeStr(String(el.value ?? ""));
      if (s !== "") return s;
    }
    return fallback;
  }

  function applyUIFromCfg(cfg) {
    const c = normalizeCfg(cfg);

    writeOnOff("#ctlCatalogOn", c.enabled);
    setInputValueIfExists("#ctlCatalogGap", c.gapPx);
    writeOnOff("#ctlCatalogLabels", c.labels);
    writeOnOff("#ctlCatalogMuted", c.muted);

    setSelectValueIfExists("#ctlCatalogLayout", c.layout);

    // nuevos (si existen)
    setInputValueIfExists("#ctlCatalogTiles", c.tiles);
    setInputValueIfExists("#ctlCatalogCols", c.cols);
    setInputValueIfExists("#ctlCatalogRows", c.rows);

    setSelectValueIfExists("#ctlCatalogMode", c.mode);

    // followSlot: en tu HTML actual suele tener solo 0..3 -> clamp a options disponibles
    setSelectIntClampedToOptions("#ctlCatalogFollowSlot", c.followSlot);

    writeOnOff("#ctlCatalogClickCycle", c.clickCycle);
    writeOnOff("#ctlCatalogYtCookies", c.ytCookies);

    writeOnOff("#ctlCatalogWxTiles", c.wxTiles);
    setInputValueIfExists("#ctlCatalogWxRefreshSec", c.wxRefreshSec);

    setStatus(c.enabled ? `Catálogo: ON (${c.tiles})` : "Catálogo: OFF", c.enabled);
  }

  function collectCfgFromUI() {
    const base = loadCfg();

    const enabled = readOnOff("#ctlCatalogOn", base.enabled);
    const gapPx   = num(qs("#ctlCatalogGap")?.value, base.gapPx);
    const labels  = readOnOff("#ctlCatalogLabels", base.labels);
    const muted   = readOnOff("#ctlCatalogMuted", base.muted);

    const layout = readFirstFoundValue(["#ctlCatalogLayout"], base.layout);

    const tiles = num(readFirstFoundValue(["#ctlCatalogTiles", "#ctlCatalogCount", "#ctlCatalogCams"], ""), base.tiles);
    const cols  = num(readFirstFoundValue(["#ctlCatalogCols"], ""), base.cols);
    const rows  = num(readFirstFoundValue(["#ctlCatalogRows"], ""), base.rows);

    const modeEl = qs("#ctlCatalogMode");
    const mode   = modeEl ? safeStr(modeEl.value).toLowerCase() : base.mode;

    const fsEl = qs("#ctlCatalogFollowSlot");
    const followSlot = fsEl ? (parseInt(fsEl.value, 10) || 0) : base.followSlot;

    const clickCycle = readOnOff("#ctlCatalogClickCycle", base.clickCycle);
    const ytCookies  = readOnOff("#ctlCatalogYtCookies", base.ytCookies);

    const wxTiles = readOnOff("#ctlCatalogWxTiles", base.wxTiles);
    const wxRefreshSec = num(qs("#ctlCatalogWxRefreshSec")?.value, base.wxRefreshSec);

    return normalizeCfg({
      enabled,
      layout,
      tiles,
      cols,
      rows,
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

  // ───────────────────────── Debounce
  function debounce(fn, waitMs = 140) {
    let t = null;
    return (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => { t = null; fn(...args); }, waitMs);
      inst._timers.add(t);
    };
  }

  // ───────────────────────── Instance plumbing (destroy-safe)
  const inst = {
    __ver: VER,
    _timers: new Set(),
    _unsub: [],
    destroy() {
      try {
        for (const off of inst._unsub) { try { off(); } catch (_) {} }
        inst._unsub.length = 0;
      } catch (_) {}

      try {
        for (const t of inst._timers) { try { clearTimeout(t); } catch (_) {} }
        inst._timers.clear();
      } catch (_) {}

      try { bcMain && bcMain.close && bcMain.close(); } catch (_) {}
      try { bcLegacy && bcLegacy.close && bcLegacy.close(); } catch (_) {}

      try { if (g[INST_KEY] === inst) delete g[INST_KEY]; } catch (_) {}
    }
  };
  g[INST_KEY] = inst;

  function on(el, ev, fn, opts) {
    if (!el || !el.addEventListener) return;
    el.addEventListener(ev, fn, opts);
    inst._unsub.push(() => { try { el.removeEventListener(ev, fn, opts); } catch (_) {} });
  }

  // ───────────────────────── Boot
  function boot() {
    const saved = saveCfg(loadCfg());

    // Boot sync SIEMPRE (aunque falte UI)
    try { setTimeout(() => sendCfg(saved), 120); } catch (_) { try { sendCfg(saved); } catch (_) {} }

    // Si hay UI, la sincronizamos y enganchamos listeners
    const hasToggle = !!qs("#ctlCatalogOn");
    if (hasToggle) applyUIFromCfg(saved);

    const doApply = () => {
      const cfg = saveCfg(collectCfgFromUI());
      sendCfg(cfg);
      applyUIFromCfg(cfg);
    };
    const doApplyDebounced = debounce(doApply, 160);

    on(qs("#ctlCatalogApply"), "click", doApply);

    on(qs("#ctlCatalogReset"), "click", () => {
      clearKey(CFG_KEY);
      clearKey(CFG_KEY_LEGACY);
      const cfg = saveCfg(DEFAULTS);
      sendCfg(cfg);
      applyUIFromCfg(cfg);
    });

    const live = [
      "#ctlCatalogOn",
      "#ctlCatalogLayout",
      "#ctlCatalogTiles",
      "#ctlCatalogCols",
      "#ctlCatalogRows",
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
      on(el, "change", doApply);
      on(el, "input", () => doApplyDebounced());
    }

    on(window, "storage", (e) => {
      if (!e) return;
      if (e.key === CFG_KEY || e.key === CFG_KEY_LEGACY) {
        const c = loadCfg();
        applyUIFromCfg(c);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
