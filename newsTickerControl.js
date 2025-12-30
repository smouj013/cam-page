/* newsTickerControl.js — RLC Ticker Control v1.2.0 (KEY-NAMESPACE + LEGACY)
   ✅ Solo para control.html
   ✅ Guarda config en localStorage (rlc_ticker_cfg_v1 + opcional :key)
   ✅ Emite config por BroadcastChannel:
      - rlc_bus_v1
      - rlc_bus_v1:<key> (si hay key)
   ✅ Fallback storage “ping” cross-tab
   ✅ No rompe si faltan elementos UI
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const LOAD_GUARD = "__RLC_TICKER_CONTROL_LOADED_V120";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  const BUS_BASE = "rlc_bus_v1";
  const CFG_KEY_BASE = "rlc_ticker_cfg_v1";

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
  const P = parseParams();
  const KEY = String(P.key || "").trim();

  const BUS_MAIN = KEY ? `${BUS_BASE}:${KEY}` : BUS_BASE;
  const BUS_LEGACY = BUS_BASE;

  const CFG_KEY = KEY ? `${CFG_KEY_BASE}:${KEY}` : CFG_KEY_BASE;
  const CFG_KEY_LEGACY = CFG_KEY_BASE;

  const bcMain = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS_MAIN) : null;
  const bcLegacy = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_LEGACY) : null;

  function busPost(msg) {
    try { if (bcMain) bcMain.postMessage(msg); } catch (_) {}
    try { if (bcLegacy) bcLegacy.postMessage(msg); } catch (_) {}
  }

  const DEFAULTS = {
    enabled: true,
    lang: "auto",       // auto|es|en
    speedPxPerSec: 55,  // 20..140
    refreshMins: 12,    // 3..60
    topPx: 10,          // 0..120
    hideOnVote: true
  };

  function readCfgFirst(keys) {
    for (const k of keys) {
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const obj = JSON.parse(raw);
        if (obj && typeof obj === "object") return obj;
      } catch (_) {}
    }
    return null;
  }

  function normalizeCfg(inCfg) {
    const c = Object.assign({}, DEFAULTS, inCfg || {});
    c.enabled = (c.enabled !== false);

    const lang = safeStr(c.lang).toLowerCase();
    c.lang = (lang === "es" || lang === "en" || lang === "auto") ? lang : "auto";

    c.speedPxPerSec = clamp(num(c.speedPxPerSec, DEFAULTS.speedPxPerSec), 20, 140);
    c.refreshMins = clamp(num(c.refreshMins, DEFAULTS.refreshMins), 3, 60);
    c.topPx = clamp(num(c.topPx, DEFAULTS.topPx), 0, 120);
    c.hideOnVote = (c.hideOnVote !== false);

    return c;
  }

  function readCfg() {
    // prioridad: keyed -> legacy
    const obj = readCfgFirst([CFG_KEY, CFG_KEY_LEGACY]);
    return obj ? normalizeCfg(obj) : null;
  }

  function writeCfg(cfg) {
    const c = normalizeCfg(cfg);
    const raw = JSON.stringify(c);
    try { localStorage.setItem(CFG_KEY, raw); } catch (_) {}
    try { localStorage.setItem(CFG_KEY_LEGACY, raw); } catch (_) {}
    return c;
  }

  function clearCfg() {
    try { localStorage.removeItem(CFG_KEY); } catch (_) {}
    try { localStorage.removeItem(CFG_KEY_LEGACY); } catch (_) {}
  }

  function sendCfg(cfg, persist = true) {
    const c = persist ? writeCfg(cfg) : normalizeCfg(cfg);
    const msg = { type: "TICKER_CFG", cfg: c, ts: Date.now() };
    if (KEY) msg.key = KEY; // no hace daño; algunos listeners lo ignoran
    busPost(msg);

    // fallback: “ping” para disparar storage events cross-tab (otras pestañas)
    try { localStorage.setItem("__rlc_ticker_ping", String(Date.now())); } catch (_) {}
    return c;
  }

  function setStatus(text, state = "neutral") {
    const el = qs("#ctlTickerStatus");
    if (!el) return;
    el.textContent = text;

    // state: ok|bad|neutral
    el.classList.toggle("pill--ok", state === "ok");
    el.classList.toggle("pill--bad", state === "bad");
  }

  function isEditing(el) {
    if (!el) return false;
    try { return document.activeElement === el || el.matches(":focus"); }
    catch (_) { return document.activeElement === el; }
  }

  function safeSetValue(el, v) {
    if (!el) return;
    if (isEditing(el)) return;
    el.value = String(v);
  }

  function applyUIFromCfg(cfg) {
    const c = normalizeCfg(cfg);

    const on = qs("#ctlTickerOn");
    const lang = qs("#ctlTickerLang");
    const speed = qs("#ctlTickerSpeed");
    const refresh = qs("#ctlTickerRefresh");
    const top = qs("#ctlTickerTop");
    const hideOnVote = qs("#ctlTickerHideOnVote");

    if (on && !isEditing(on)) on.value = (c.enabled ? "on" : "off");
    if (lang && !isEditing(lang)) lang.value = c.lang;

    if (speed) safeSetValue(speed, c.speedPxPerSec);
    if (refresh) safeSetValue(refresh, c.refreshMins);
    if (top) safeSetValue(top, c.topPx);

    if (hideOnVote && !isEditing(hideOnVote)) hideOnVote.value = (c.hideOnVote ? "on" : "off");

    // status
    if (c.enabled) setStatus("Ticker: ON", "ok");
    else setStatus("Ticker: OFF", "neutral");
  }

  function collectCfgFromUI() {
    const on = qs("#ctlTickerOn")?.value || "on";
    const lang = qs("#ctlTickerLang")?.value || "auto";
    const speed = num(qs("#ctlTickerSpeed")?.value, DEFAULTS.speedPxPerSec);
    const refresh = num(qs("#ctlTickerRefresh")?.value, DEFAULTS.refreshMins);
    const topPx = num(qs("#ctlTickerTop")?.value, DEFAULTS.topPx);
    const hideOnVote = (qs("#ctlTickerHideOnVote")?.value || "on") !== "off";

    return normalizeCfg({
      enabled: (on !== "off"),
      lang,
      speedPxPerSec: speed,
      refreshMins: refresh,
      topPx,
      hideOnVote
    });
  }

  // Debounce suave para input/change
  let liveTimer = null;
  function liveApplySoon() {
    try { if (liveTimer) clearTimeout(liveTimer); } catch (_) {}
    liveTimer = setTimeout(() => {
      liveTimer = null;
      const cfg = collectCfgFromUI();
      const applied = sendCfg(cfg, true);
      applyUIFromCfg(applied);
    }, 140);
  }

  function boot() {
    // Si el panel no está, salimos sin romper
    if (!qs("#ctlTickerApply") || !qs("#ctlTickerOn")) return;

    // Footer bus label (si existe)
    try {
      const el = qs("#ctlBusName");
      if (el) el.textContent = `Canal: ${BUS_MAIN}`;
    } catch (_) {}

    const saved = readCfg() || normalizeCfg(DEFAULTS);
    writeCfg(saved);       // asegura estructura (keyed+legacy)
    applyUIFromCfg(saved);

    // Empuja config al player al entrar (por si ya está abierto)
    try { sendCfg(saved, false); } catch (_) {}

    qs("#ctlTickerApply")?.addEventListener("click", () => {
      const cfg = collectCfgFromUI();
      const applied = sendCfg(cfg, true);
      applyUIFromCfg(applied);
    });

    qs("#ctlTickerReset")?.addEventListener("click", () => {
      clearCfg();
      const cfg = normalizeCfg(DEFAULTS);
      const applied = sendCfg(cfg, true);
      applyUIFromCfg(applied);
    });

    // Apply en vivo (suave)
    const liveSelectors = [
      "#ctlTickerOn",
      "#ctlTickerLang",
      "#ctlTickerSpeed",
      "#ctlTickerRefresh",
      "#ctlTickerTop",
      "#ctlTickerHideOnVote"
    ];

    for (const sel of liveSelectors) {
      const el = qs(sel);
      if (!el) continue;

      el.addEventListener("change", liveApplySoon);

      // inputs num: también por input
      if (el.tagName === "INPUT") {
        el.addEventListener("input", liveApplySoon);
      }
    }

    // Si otra pestaña cambia config (keyed o legacy)
    window.addEventListener("storage", (e) => {
      if (!e) return;
      if (e.key === CFG_KEY || e.key === CFG_KEY_LEGACY) {
        const c = readCfg();
        if (c) applyUIFromCfg(c);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
