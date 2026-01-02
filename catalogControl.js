/* catalogControl.js — RLC Catalog Control v1.3.0
   ✅ Solo para control.html
   ✅ Guarda config en localStorage (keyed + legacy)
   ✅ Emite config por BroadcastChannel (keyed + legacy)
   ✅ Boot sync: emite config al arrancar
   ✅ Live apply suave (change/input con debounce)
   ✅ Compat total: si faltan controles nuevos NO crashea

   🗳️ NUEVO (VOTO 4 OPCIONES / CAMBIO 1 TILE):
   - voteEnabled: true/false
   - voteWindowSec: duración de la votación (seg)
   - voteEveryMinSec / voteEveryMaxSec: intervalo ALEATORIO entre votaciones (seg)
   - voteAnnounce: si true, el player puede pedir al bot anunciar (si lo soportas)
   - voteAllowNoVotes: si true y nadie vota => se elige un slot random igualmente
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const LOAD_GUARD = "__RLC_CATALOG_CONTROL_LOADED_V130";
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
    layout: "quad",     // fijo 2x2
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
    wxRefreshSec: 30,

    // 🗳️ voto 4 opciones
    voteEnabled: true,
    voteWindowSec: 18,
    voteEveryMinSec: 55,
    voteEveryMaxSec: 120,
    voteAnnounce: true,
    voteAllowNoVotes: true
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

    // 🗳️ voto
    c.voteEnabled = (c.voteEnabled !== false);
    c.voteWindowSec = clamp((parseInt(c.voteWindowSec, 10) || DEFAULTS.voteWindowSec), 8, 60);

    c.voteEveryMinSec = clamp((parseInt(c.voteEveryMinSec, 10) || DEFAULTS.voteEveryMinSec), 15, 900);
    c.voteEveryMaxSec = clamp((parseInt(c.voteEveryMaxSec, 10) || DEFAULTS.voteEveryMaxSec), 20, 1200);
    if (c.voteEveryMaxSec < c.voteEveryMinSec + 5) c.voteEveryMaxSec = c.voteEveryMinSec + 5;

    c.voteAnnounce = (c.voteAnnounce !== false);
    c.voteAllowNoVotes = (c.voteAllowNoVotes !== false);

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

    // existentes
    if (qs("#ctlCatalogOn")) writeOnOff("#ctlCatalogOn", c.enabled);
    if (qs("#ctlCatalogLayout")) qs("#ctlCatalogLayout").value = "quad";
    if (qs("#ctlCatalogGap")) qs("#ctlCatalogGap").value = String(c.gapPx);
    if (qs("#ctlCatalogLabels")) writeOnOff("#ctlCatalogLabels", c.labels);
    if (qs("#ctlCatalogMuted")) writeOnOff("#ctlCatalogMuted", c.muted);

    // v1.1.x
    if (qs("#ctlCatalogMode")) qs("#ctlCatalogMode").value = c.mode;
    if (qs("#ctlCatalogFollowSlot")) qs("#ctlCatalogFollowSlot").value = String(c.followSlot);
    if (qs("#ctlCatalogClickCycle")) writeOnOff("#ctlCatalogClickCycle", c.clickCycle);
    if (qs("#ctlCatalogYtCookies")) writeOnOff("#ctlCatalogYtCookies", c.ytCookies);

    // WX
    if (qs("#ctlCatalogWxTiles")) writeOnOff("#ctlCatalogWxTiles", c.wxTiles);
    if (qs("#ctlCatalogWxRefreshSec")) qs("#ctlCatalogWxRefreshSec").value = String(c.wxRefreshSec);

    // 🗳️ NUEVOS (si tu HTML los tiene)
    if (qs("#ctlCatalogVoteOn")) writeOnOff("#ctlCatalogVoteOn", c.voteEnabled);
    if (qs("#ctlCatalogVoteWindowSec")) qs("#ctlCatalogVoteWindowSec").value = String(c.voteWindowSec);
    if (qs("#ctlCatalogVoteEveryMinSec")) qs("#ctlCatalogVoteEveryMinSec").value = String(c.voteEveryMinSec);
    if (qs("#ctlCatalogVoteEveryMaxSec")) qs("#ctlCatalogVoteEveryMaxSec").value = String(c.voteEveryMaxSec);
    if (qs("#ctlCatalogVoteAnnounce")) writeOnOff("#ctlCatalogVoteAnnounce", c.voteAnnounce);
    if (qs("#ctlCatalogVoteAllowNoVotes")) writeOnOff("#ctlCatalogVoteAllowNoVotes", c.voteAllowNoVotes);

    setStatus(c.enabled ? "Catálogo: ON" : "Catálogo: OFF", c.enabled);
  }

  function collectCfgFromUI() {
    const base = loadCfg();

    // existentes
    const enabled = readOnOff("#ctlCatalogOn", base.enabled);
    const gapPx = num(qs("#ctlCatalogGap")?.value, base.gapPx);
    const labels = readOnOff("#ctlCatalogLabels", base.labels);
    const muted = readOnOff("#ctlCatalogMuted", base.muted);

    // v1.1.x
    const modeEl = qs("#ctlCatalogMode");
    const mode = modeEl ? safeStr(modeEl.value).toLowerCase() : base.mode;

    const fsEl = qs("#ctlCatalogFollowSlot");
    const followSlot = fsEl ? (parseInt(fsEl.value, 10) || 0) : base.followSlot;

    const clickCycle = readOnOff("#ctlCatalogClickCycle", base.clickCycle);
    const ytCookies = readOnOff("#ctlCatalogYtCookies", base.ytCookies);

    // WX
    const wxTiles = readOnOff("#ctlCatalogWxTiles", base.wxTiles);
    const wxRefreshSec = num(qs("#ctlCatalogWxRefreshSec")?.value, base.wxRefreshSec);

    // 🗳️ VOTO (si faltan inputs, no se pierde lo guardado)
    const voteEnabled = readOnOff("#ctlCatalogVoteOn", base.voteEnabled);
    const voteWindowSec = num(qs("#ctlCatalogVoteWindowSec")?.value, base.voteWindowSec);
    const voteEveryMinSec = num(qs("#ctlCatalogVoteEveryMinSec")?.value, base.voteEveryMinSec);
    const voteEveryMaxSec = num(qs("#ctlCatalogVoteEveryMaxSec")?.value, base.voteEveryMaxSec);
    const voteAnnounce = readOnOff("#ctlCatalogVoteAnnounce", base.voteAnnounce);
    const voteAllowNoVotes = readOnOff("#ctlCatalogVoteAllowNoVotes", base.voteAllowNoVotes);

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
      wxRefreshSec,

      voteEnabled,
      voteWindowSec,
      voteEveryMinSec,
      voteEveryMaxSec,
      voteAnnounce,
      voteAllowNoVotes
    });
  }

  // ───────────────────────── Debounce
  function debounce(fn, waitMs = 140) {
    let t = null;
    return (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => { t = null; fn(...args); }, waitMs);
    };
  }

  // ───────────────────────── Boot
  function boot() {
    // UI mínima
    if (!qs("#ctlCatalogApply") || !qs("#ctlCatalogOn")) return;

    const saved = saveCfg(loadCfg());
    applyUIFromCfg(saved);

    const doApply = () => {
      const cfg = saveCfg(collectCfgFromUI());
      sendCfg(cfg);
      applyUIFromCfg(cfg);
    };
    const doApplyDebounced = debounce(doApply, 160);

    qs("#ctlCatalogApply")?.addEventListener("click", doApply);

    qs("#ctlCatalogReset")?.addEventListener("click", () => {
      clearKey(CFG_KEY);
      clearKey(CFG_KEY_LEGACY);
      const cfg = saveCfg(DEFAULTS);
      sendCfg(cfg);
      applyUIFromCfg(cfg);
    });

    // Live apply
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
      "#ctlCatalogWxRefreshSec",

      // 🗳️ nuevos
      "#ctlCatalogVoteOn",
      "#ctlCatalogVoteWindowSec",
      "#ctlCatalogVoteEveryMinSec",
      "#ctlCatalogVoteEveryMaxSec",
      "#ctlCatalogVoteAnnounce",
      "#ctlCatalogVoteAllowNoVotes"
    ];

    for (const sel of live) {
      const el = qs(sel);
      if (!el) continue;
      el.addEventListener("change", doApply);
      el.addEventListener("input", () => doApplyDebounced());
    }

    window.addEventListener("storage", (e) => {
      if (!e) return;
      if (e.key === CFG_KEY || e.key === CFG_KEY_LEGACY) {
        const c = loadCfg();
        applyUIFromCfg(c);
      }
    });

    // Boot sync
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
