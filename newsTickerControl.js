/* newsTickerControl.js — RLC Ticker Control v1.1.0
   ✅ Solo para control.html
   ✅ Guarda config en localStorage (rlc_ticker_cfg_v1)
   ✅ Emite config por BroadcastChannel (rlc_bus_v1)
   ✅ No toca control.js / app.js
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const LOAD_GUARD = "__RLC_TICKER_CONTROL_LOADED_V110";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  const BUS = "rlc_bus_v1";
  const CFG_KEY = "rlc_ticker_cfg_v1";

  const qs = (s, r = document) => r.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (v, fb) => {
    const n = parseFloat(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fb;
  };
  const safeStr = (v) => (typeof v === "string") ? v.trim() : "";

  const bc = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS) : null;

  const DEFAULTS = {
    enabled: true,
    lang: "auto",
    speedPxPerSec: 55,
    refreshMins: 12,
    topPx: 10,
    hideOnVote: true
  };

  function readCfg() {
    try {
      const raw = localStorage.getItem(CFG_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return (obj && typeof obj === "object") ? obj : null;
    } catch (_) { return null; }
  }

  function writeCfg(cfg) {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (_) {}
  }

  function clearCfg() {
    try { localStorage.removeItem(CFG_KEY); } catch (_) {}
  }

  function sendCfg(cfg) {
    const msg = { type: "TICKER_CFG", cfg, ts: Date.now() };
    try { if (bc) bc.postMessage(msg); } catch (_) {}
    // fallback: “ping” para disparar storage events cross-tab
    try { localStorage.setItem("__rlc_ticker_ping", String(Date.now())); } catch (_) {}
  }

  function setStatus(text, ok = true) {
    const el = qs("#ctlTickerStatus");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("pill--ok", !!ok);
    el.classList.toggle("pill--bad", !ok);
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
    });

    return cfg;
  }

  function boot() {
    // Si el panel no está, salimos sin romper
    if (!qs("#ctlTickerApply") || !qs("#ctlTickerOn")) return;

    const saved = normalizeCfg(readCfg() || DEFAULTS);
    writeCfg(saved); // asegura estructura
    applyUIFromCfg(saved);

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
        // solo para inputs num/range
        if (el.tagName === "INPUT") doApply(true);
      });
    }

    // Si otra pestaña cambia config
    window.addEventListener("storage", (e) => {
      if (!e) return;
      if (e.key === CFG_KEY) {
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
