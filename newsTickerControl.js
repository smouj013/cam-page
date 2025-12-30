/* newsTickerControl.js — RLC Ticker Control v1.0.0
   ✅ Solo para control.html
   ✅ Guarda config en localStorage (rlc_ticker_cfg_v1)
   ✅ Emite config por BroadcastChannel (rlc_bus_v1)
   ✅ No toca control.js / app.js
*/
(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const LOAD_GUARD = "__RLC_TICKER_CONTROL_LOADED_V100";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  const BUS = "rlc_bus_v1";
  const CFG_KEY = "rlc_ticker_cfg_v1";

  const qs = (s, r=document) => r.querySelector(s);
  const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
  const num = (v, fb) => {
    const n = parseFloat(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fb;
  };
  const safeStr = (v) => (typeof v === "string") ? v.trim() : "";

  const bc = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS) : null;

  function readCfg() {
    try {
      const raw = localStorage.getItem(CFG_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return (obj && typeof obj === "object") ? obj : null;
    } catch (_) {
      return null;
    }
  }

  function writeCfg(cfg) {
    try {
      localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
    } catch (_) {}
  }

  function clearCfg() {
    try { localStorage.removeItem(CFG_KEY); } catch (_) {}
  }

  function sendCfg(cfg) {
    const msg = { type: "TICKER_CFG", cfg, ts: Date.now() };
    try { if (bc) bc.postMessage(msg); } catch (_) {}
    // fallback “cross-tab” (si BC no va)
    try { localStorage.setItem("__rlc_ticker_ping", String(Date.now())); } catch (_) {}
  }

  function setStatus(text) {
    const el = qs("#ctlTickerStatus");
    if (el) el.textContent = text;
  }

  function applyUIFromCfg(cfg) {
    const on = qs("#ctlTickerOn");
    const lang = qs("#ctlTickerLang");
    const speed = qs("#ctlTickerSpeed");
    const refresh = qs("#ctlTickerRefresh");
    const top = qs("#ctlTickerTop");
    const hideOnVote = qs("#ctlTickerHideOnVote");

    if (on) on.value = (cfg?.enabled === false) ? "off" : "on";
    if (lang) lang.value = safeStr(cfg?.lang) || "auto";
    if (speed) speed.value = String(cfg?.speedPxPerSec ?? 55);
    if (refresh) refresh.value = String(cfg?.refreshMins ?? 12);
    if (top) top.value = String(cfg?.topPx ?? 10);
    if (hideOnVote) hideOnVote.value = (cfg?.hideOnVote === false) ? "off" : "on";

    const enabled = (cfg?.enabled !== false);
    setStatus(enabled ? "Ticker: ON" : "Ticker: OFF");
  }

  function collectCfgFromUI() {
    const on = qs("#ctlTickerOn")?.value || "on";
    const lang = qs("#ctlTickerLang")?.value || "auto";
    const speed = num(qs("#ctlTickerSpeed")?.value, 55);
    const refresh = num(qs("#ctlTickerRefresh")?.value, 12);
    const topPx = num(qs("#ctlTickerTop")?.value, 10);
    const hideOnVote = (qs("#ctlTickerHideOnVote")?.value || "on") !== "off";

    const cfg = {
      enabled: (on !== "off"),
      lang: (lang === "auto") ? "auto" : (lang === "es" ? "es" : "en"),
      speedPxPerSec: clamp(speed, 20, 140),
      refreshMins: clamp(refresh, 3, 60),
      topPx: clamp(topPx, 0, 120),
      hideOnVote
    };
    return cfg;
  }

  function boot() {
    // Si la card no existe, salimos sin romper nada
    if (!qs("#ctlTickerApply") || !qs("#ctlTickerOn")) return;

    // Carga config guardada o defaults
    const saved = readCfg() || {
      enabled: true,
      lang: "auto",
      speedPxPerSec: 55,
      refreshMins: 12,
      topPx: 10,
      hideOnVote: true
    };

    applyUIFromCfg(saved);

    qs("#ctlTickerApply")?.addEventListener("click", () => {
      const cfg = collectCfgFromUI();
      writeCfg(cfg);
      sendCfg(cfg);
      applyUIFromCfg(cfg);
    });

    qs("#ctlTickerReset")?.addEventListener("click", () => {
      clearCfg();
      const cfg = {
        enabled: true,
        lang: "auto",
        speedPxPerSec: 55,
        refreshMins: 12,
        topPx: 10,
        hideOnVote: true
      };
      writeCfg(cfg);
      sendCfg(cfg);
      applyUIFromCfg(cfg);
    });

    // Apply “en vivo” al cambiar campos (suave)
    const liveEls = ["#ctlTickerOn","#ctlTickerLang","#ctlTickerSpeed","#ctlTickerRefresh","#ctlTickerTop","#ctlTickerHideOnVote"];
    for (const sel of liveEls) {
      const el = qs(sel);
      if (!el) continue;
      el.addEventListener("change", () => {
        const cfg = collectCfgFromUI();
        writeCfg(cfg);
        sendCfg(cfg);
        applyUIFromCfg(cfg);
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
