/* newsTickerControl.js — RLC Ticker Control v1.2.0 (KEY-NAMESPACE + LEGACY COMPAT)
   ✅ Solo para control.html
   ✅ Guarda config en localStorage (namespaced si ?key=)
   ✅ Emite config por BroadcastChannel (namespaced si ?key=) + legacy
   ✅ No toca control.js / app.js
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
    return { key: safeStr(u.searchParams.get("key") || "") };
  }
  const P = parseParams();
  const KEY = String(P.key || "").trim();

  // Namespaced (si hay key) + legacy (compat)
  const BUS = KEY ? `${BUS_BASE}:${KEY}` : BUS_BASE;
  const BUS_LEGACY = BUS_BASE;

  const CFG_KEY = KEY ? `${CFG_KEY_BASE}:${KEY}` : CFG_KEY_BASE;
  const CFG_KEY_LEGACY = CFG_KEY_BASE;

  const bcMain = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS) : null;
  const bcLegacy = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_LEGACY) : null;

  const DEFAULTS = {
    enabled: true,
    lang: "auto",
    speedPxPerSec: 55,
    refreshMins: 12,
    topPx: 10,
    hideOnVote: true,
    timespan: "12h" // más “última hora” por defecto
  };

  function readCfgAny() {
    // prioridad: namespaced -> legacy
    try {
      const rawA = localStorage.getItem(CFG_KEY);
      if (rawA) {
        const objA = JSON.parse(rawA);
        if (objA && typeof objA === "object") return objA;
      }
    } catch (_) {}

    try {
      const rawB = localStorage.getItem(CFG_KEY_LEGACY);
      if (rawB) {
        const objB = JSON.parse(rawB);
        if (objB && typeof objB === "object") return objB;
      }
    } catch (_) {}

    return null;
  }

  function writeCfg(cfg) {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (_) {}
    try { localStorage.setItem(CFG_KEY_LEGACY, JSON.stringify(cfg)); } catch (_) {} // compat
  }

  function clearCfg() {
    try { localStorage.removeItem(CFG_KEY); } catch (_) {}
    try { localStorage.removeItem(CFG_KEY_LEGACY); } catch (_) {}
  }

  function sendCfg(cfg) {
    const msg = { type: "TICKER_CFG", cfg, ts: Date.now() };
    if (KEY) msg.key = KEY;

    try { if (bcMain) bcMain.postMessage(msg); } catch (_) {}
    try { if (bcLegacy) bcLegacy.postMessage(msg); } catch (_) {}

    // fallback storage ping cross-tab
    try { localStorage.setItem("__rlc_ticker_ping", String(Date.now())); } catch (_) {}
  }

  function setStatus(text, ok = true) {
    const el = qs("#ctlTickerStatus");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("pill--ok", !!ok);
    el.classList.toggle("pill--bad", !ok);
  }

  function normalizeTimespan(s) {
    const t = safeStr(s).toLowerCase();
    if (!t) return DEFAULTS.timespan;
    if (/^\d+(min|h|d|w|m)$/.test(t)) return t;
    return DEFAULTS.timespan;
  }

  function normalizeCfg(inCfg) {
    const c = Object.assign({}, DEFAULTS, inCfg || {});
    c.enabled = (c.enabled !== false);

    const lang = safeStr(c.lang);
    c.lang = (lang === "es" || lang === "en" || lang === "auto") ? lang : "auto";

    c.speedPxPerSec = clamp(num(c.speedPxPerSec, DEFAULTS.speedPxPerSec), 20, 140);
    c.refreshMins = clamp(num(c.refreshMins, DEFAULTS.refreshMins), 3, 60);
    c.topPx = clamp(num(c.topPx, DEFAULTS.topPx), 0, 120);
    c.hideOnVote = (c.hideOnVote !== false);
    c.timespan = normalizeTimespan(c.timespan);

    return c;
  }

  function applyUIFromCfg(cfg) {
    const c = normalizeCfg(cfg);

    const on = qs("#ctlTickerOn");
    const lang = qs("#ctlTickerLang");
    const speed = qs("#ctlTickerSpeed");
    const refresh = qs("#ctlTickerRefresh");
    const top = qs("#ctlTickerTop");
    const hideOnVote = qs("#ctlTickerHideOnVote");

    if (on) on.value = (c.enabled ? "on" : "off");
    if (lang) lang.value = c.lang;
    if (speed) speed.value = String(c.speedPxPerSec);
    if (refresh) refresh.value = String(c.refreshMins);
    if (top) top.value = String(c.topPx);
    if (hideOnVote) hideOnVote.value = (c.hideOnVote ? "on" : "off");

    setStatus(c.enabled ? "Ticker: ON" : "Ticker: OFF", c.enabled);
  }

  function collectCfgFromUI() {
    const on = qs("#ctlTickerOn")?.value || "on";
    const lang = qs("#ctlTickerLang")?.value || "auto";
    const speed = num(qs("#ctlTickerSpeed")?.value, DEFAULTS.speedPxPerSec);
    const refresh = num(qs("#ctlTickerRefresh")?.value, DEFAULTS.refreshMins);
    const topPx = num(qs("#ctlTickerTop")?.value, DEFAULTS.topPx);
    const hideOnVote = (qs("#ctlTickerHideOnVote")?.value || "on") !== "off";

    const cfg = normalizeCfg({
      enabled: (on !== "off"),
      lang: (lang === "es" || lang === "en" || lang === "auto") ? lang : "auto",
      speedPxPerSec: speed,
      refreshMins: refresh,
      topPx,
      hideOnVote
      // timespan no está en UI aquí: queda por defecto (12h) o del storage previo
    });

    // mantiene timespan si existía guardado
    const saved = readCfgAny();
    if (saved && saved.timespan) cfg.timespan = normalizeTimespan(saved.timespan);

    return cfg;
  }

  function boot() {
    if (!qs("#ctlTickerApply") || !qs("#ctlTickerOn")) return;

    // Migración suave: si hay key y no hay cfg namespaced pero sí legacy, se replica al namespaced
    const savedAny = normalizeCfg(readCfgAny() || DEFAULTS);
    writeCfg(savedAny);
    applyUIFromCfg(savedAny);

    const doApply = (persist = true) => {
      const cfg = collectCfgFromUI();
      if (persist) writeCfg(cfg);
      sendCfg(cfg);
      applyUIFromCfg(cfg);
    };

    qs("#ctlTickerApply")?.addEventListener("click", () => doApply(true));

    qs("#ctlTickerReset")?.addEventListener("click", () => {
      clearCfg();
      const cfg = normalizeCfg(DEFAULTS);
      writeCfg(cfg);
      sendCfg(cfg);
      applyUIFromCfg(cfg);
    });

    // Apply en vivo (suave)
    const liveEls = [
      "#ctlTickerOn",
      "#ctlTickerLang",
      "#ctlTickerSpeed",
      "#ctlTickerRefresh",
      "#ctlTickerTop",
      "#ctlTickerHideOnVote"
    ];

    for (const sel of liveEls) {
      const el = qs(sel);
      if (!el) continue;
      el.addEventListener("change", () => doApply(true));
      el.addEventListener("input", () => {
        if (el.tagName === "INPUT") doApply(true);
      });
    }

    // Si otra pestaña cambia config
    window.addEventListener("storage", (e) => {
      if (!e) return;
      if (e.key === CFG_KEY || e.key === CFG_KEY_LEGACY) {
        const c = readCfgAny();
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
