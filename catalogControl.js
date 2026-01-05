/* catalogControl.js — RLC Catalog Control v1.3.9 (RLC 2.3.9 COMPAT / MULTI-TILES / HARDENED)
   ✅ Solo para control.html
   ✅ Compat total con RLC v2.3.9:
      - KEY auto: ?key=... o ?k=... o localStorage rlc_last_key_v1
      - BroadcastChannel keyed + legacy (sin quedarse sordo)
      - localStorage mirror (CFG keyed + legacy) + ping (keyed + legacy)
      - postMessage same-origin a parent/opener (preview/iframe) opcional
      - Boot sync doble (120ms + 1200ms) para que el Player se entere aunque cargue tarde
   ✅ Live apply suave (change/input con debounce)
   ✅ MULTI-TILES: presets + custom (tiles/cols/rows) con auto-ajuste
   ✅ Harden:
      - Singleton con destroy() (evita doble carga y listeners duplicados)
      - followSlot clamp a opciones reales del <select> y al nº de tiles
      - Dedupe por firma (ts + hash simple) para no spamear el bus
      - Debounce sin fugas (limpia timers ejecutados)
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const VER = "1.3.9";
  const INST_KEY = "__RLC_CATALOG_CONTROL_INSTANCE__";

  // ───────────────────────── Singleton (evita doble carga)
  try {
    const prev = g[INST_KEY];
    if (prev && prev.__ver === VER) return;
    if (prev && typeof prev.destroy === "function") prev.destroy();
  } catch (_) {}

  // ───────────────────────── Utils
  const qs = (s, r = document) => r.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (v, fb) => {
    const n = parseFloat(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fb;
  };
  const safeStr = (v) => (typeof v === "string") ? v.trim() : "";

  const now = () => Date.now();

  function readLS(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function writeLS(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function delLS(k) { try { localStorage.removeItem(k); } catch (_) {} }

  function readJson(k) {
    try {
      const raw = readLS(k);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return (obj && typeof obj === "object") ? obj : null;
    } catch (_) { return null; }
  }
  function writeJson(k, obj) { try { writeLS(k, JSON.stringify(obj)); } catch (_) {} }

  function parseParamsKey() {
    try {
      const u = new URL(location.href);
      return safeStr(u.searchParams.get("key") || u.searchParams.get("k") || "");
    } catch (_) { return ""; }
  }

  // ✅ KEY auto: URL (?key/?k) -> LS last_key
  const KEY = (() => {
    const kUrl = parseParamsKey();
    if (kUrl) return kUrl;
    const kLast = safeStr(readLS("rlc_last_key_v1") || "");
    return kLast || "";
  })();

  // ───────────────────────── Bus/Keys (RLC 2.3.9)
  const BUS_BASE  = "rlc_bus_v1";
  const CFG_BASE  = "rlc_catalog_cfg_v1";
  const PING_BASE = "rlc_catalog_ping_v1";

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

  // ───────────────────────── Defaults
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

    // allow "layout=12" => custom tiles=12 auto
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
    writeJson(CFG_KEY_LEGACY, c); // compat (keyless)
    return c;
  }

  // ───────────────────────── Send config (BC + LS ping + postMessage)
  function safePostBC(ch, msg) { try { ch && ch.postMessage && ch.postMessage(msg); } catch (_) {} }

  function canPostMessageTarget(win) {
    try { return !!(win && win.postMessage); } catch (_) { return false; }
  }

  function postToParentOrOpener(msg) {
    try {
      if (canPostMessageTarget(window.parent) && window.parent !== window) {
        window.parent.postMessage(msg, location.origin);
      }
    } catch (_) {}
    try {
      if (canPostMessageTarget(window.opener)) {
        window.opener.postMessage(msg, location.origin);
      }
    } catch (_) {}
  }

  // Dedupe por firma (evita spam si input dispara igual 20 veces)
  let lastSig = "";
  function sigOf(cfg) {
    try {
      const c = normalizeCfg(cfg);
      return [
        c.enabled ? 1 : 0,
        c.layout, c.tiles, c.cols, c.rows,
        c.gapPx,
        c.labels ? 1 : 0,
        c.muted ? 1 : 0,
        c.mode,
        c.followSlot,
        c.clickCycle ? 1 : 0,
        c.ytCookies ? 1 : 0,
        c.wxTiles ? 1 : 0,
        c.wxRefreshSec
      ].join("|");
    } catch (_) {
      return String(Math.random());
    }
  }

  function sendCfg(cfg, reason = "apply") {
    const c = normalizeCfg(cfg);

    const sig = sigOf(c);
    if (reason !== "boot" && sig === lastSig) return;
    lastSig = sig;

    const msg = { type: "CATALOG_CFG", cfg: c, ts: now() };
    if (KEY) msg.key = KEY;

    const cmd = { type: "cmd", cmd: "CATALOG_SET", payload: c, ts: msg.ts };
    if (KEY) cmd.key = KEY;

    safePostBC(bcMain, msg);
    safePostBC(bcLegacy, msg);

    safePostBC(bcMain, cmd);
    safePostBC(bcLegacy, cmd);

    try { writeJson(CFG_KEY, c); } catch (_) {}
    try { writeJson(CFG_KEY_LEGACY, c); } catch (_) {}

    try { writeLS(PING_KEY, String(msg.ts)); } catch (_) {}
    try { writeLS(PING_KEY_LEGACY, String(msg.ts)); } catch (_) {}

    postToParentOrOpener(msg);
    postToParentOrOpener(cmd);
  }

  // ───────────────────────── UI helpers
  function setStatus(text, ok = true) {
    const el = qs("#ctlCatalogStatus");
    if (!el) return;
    el.textContent = text;
    try {
      el.classList.toggle("pill--ok", !!ok);
      el.classList.toggle("pill--bad", !ok);
    } catch (_) {}
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
    if (opts.some(o => String(o.value) === v)) el.value = v;
  }

  function setSelectIntClampedToOptions(sel, value) {
    const el = qs(sel);
    if (!el) return;

    const opts = Array.from(el.options || []);
    if (!opts.length) { try { el.value = String(value ?? "0"); } catch (_) {} return; }

    const exact = String(value ?? "");
    if (opts.some(o => String(o.value) === exact)) { el.value = exact; return; }

    const nums = opts.map(o => parseInt(String(o.value), 10)).filter(n => Number.isFinite(n));
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

    setInputValueIfExists("#ctlCatalogTiles", c.tiles);
    setInputValueIfExists("#ctlCatalogCols", c.cols);
    setInputValueIfExists("#ctlCatalogRows", c.rows);

    setSelectValueIfExists("#ctlCatalogMode", c.mode);

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

    // compat: algunos HTML viejos usan count/cams
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

    const draft = normalizeCfg({
      enabled, layout, tiles, cols, rows,
      gapPx, labels, muted,
      mode, followSlot,
      clickCycle, ytCookies,
      wxTiles, wxRefreshSec
    });

    const hasTilesCtl = !!qs("#ctlCatalogTiles") || !!qs("#ctlCatalogCols") || !!qs("#ctlCatalogRows");
    if (hasTilesCtl && draft.layout !== "custom") {
      const uiTiles = qs("#ctlCatalogTiles");
      const uiCols  = qs("#ctlCatalogCols");
      const uiRows  = qs("#ctlCatalogRows");
      const touched =
        (!!uiTiles && safeStr(uiTiles.value) !== "" && (parseInt(uiTiles.value,10)||0) !== (LAYOUTS[draft.layout]?.tiles||draft.tiles)) ||
        (!!uiCols  && safeStr(uiCols.value)  !== "" ) ||
        (!!uiRows  && safeStr(uiRows.value)  !== "" );

      if (touched) {
        draft.layout = "custom";
        const g0 = autoGridForTiles(draft.tiles);
        draft.tiles = g0.tiles;
        draft.cols = clamp(draft.cols || g0.cols, 1, 6);
        draft.rows = clamp(draft.rows || g0.rows, 1, 6);
        if ((draft.cols * draft.rows) < draft.tiles) {
          draft.rows = clamp(Math.ceil(draft.tiles / draft.cols), 1, 6);
          if ((draft.cols * draft.rows) < draft.tiles) {
            const g1 = autoGridForTiles(draft.tiles);
            draft.cols = g1.cols; draft.rows = g1.rows;
          }
        }
      }
    }

    draft.followSlot = clamp(draft.followSlot|0, 0, Math.max(0, (draft.tiles|0) - 1));
    return normalizeCfg(draft);
  }

  // ───────────────────────── Debounce (sin fugas)
  function debounce(fn, waitMs = 140) {
    let t = null;
    return (...args) => {
      if (t) { try { clearTimeout(t); } catch (_) {} }
      t = setTimeout(() => {
        const tt = t;
        t = null;
        try { inst._timers.delete(tt); } catch (_) {}
        fn(...args);
      }, waitMs);
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

    // ✅ Boot sync doble
    try { setTimeout(() => sendCfg(saved, "boot"), 120); } catch (_) { try { sendCfg(saved, "boot"); } catch (_) {} }
    try { setTimeout(() => sendCfg(saveCfg(loadCfg()), "boot"), 1200); } catch (_) {}

    const hasToggle = !!qs("#ctlCatalogOn");
    if (hasToggle) applyUIFromCfg(saved);

    const doApply = () => {
      const cfg = saveCfg(collectCfgFromUI());
      sendCfg(cfg, "apply");
      applyUIFromCfg(cfg);
    };
    const doApplyDebounced = debounce(doApply, 160);

    on(qs("#ctlCatalogApply"), "click", doApply);

    on(qs("#ctlCatalogReset"), "click", () => {
      delLS(CFG_KEY);
      delLS(CFG_KEY_LEGACY);
      const cfg = saveCfg(DEFAULTS);
      sendCfg(cfg, "apply");
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
      if (!e || !e.key) return;
      if (e.key === CFG_KEY || e.key === CFG_KEY_LEGACY) {
        const c = loadCfg();
        applyUIFromCfg(c);
      }
    });

    on(window, "message", (ev) => {
      try {
        if (ev.origin && ev.origin !== location.origin) return;
      } catch (_) {}
      const msg = ev && ev.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "REQ_CATALOG_CFG") {
        const c = loadCfg();
        sendCfg(c, "boot");
      }
    }, { passive: true });

    setStatus(saved.enabled ? `Catálogo: ON (${saved.tiles})` : "Catálogo: OFF", saved.enabled);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
