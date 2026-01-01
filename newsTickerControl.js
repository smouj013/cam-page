/* newsTickerControl.js — RLC Ticker Control v1.3.0 (KEY NAMESPACE + DUAL BUS + BILINGUAL + SOURCES)
   ✅ Solo para control.html
   ✅ Guarda config en localStorage (por key y legacy)
   ✅ Emite config por BroadcastChannel (namespaced y legacy con key)
   ✅ No toca control.js / app.js
   ✅ Si los campos UI NO existen, no rompe (solo actúa con los que haya)
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const LOAD_GUARD = "__RLC_TICKER_CONTROL_LOADED_V130";
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
  const KEY = P.key;

  const BUS = KEY ? `${BUS_BASE}:${KEY}` : BUS_BASE;
  const BUS_LEGACY = BUS_BASE;

  const CFG_KEY = KEY ? `${CFG_KEY_BASE}:${KEY}` : CFG_KEY_BASE;
  const CFG_KEY_LEGACY = CFG_KEY_BASE;

  const bcMain = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS) : null;
  const bcLegacy = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_LEGACY) : null;

  // ✅ Debe coincidir con newsTicker.js
  const DEFAULTS = {
    enabled: true,
    lang: "auto",
    speedPxPerSec: 55,
    refreshMins: 12,
    topPx: 10,
    hideOnVote: true,
    timespan: "1d",

    bilingual: true,
    translateMax: 10,

    sources: ["gdelt", "googlenews", "bbc", "guardian", "aljazeera", "dw", "nytimes"]
  };

  function readJson(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return (obj && typeof obj === "object") ? obj : null;
    } catch (_) { return null; }
  }

  function writeCfg(cfg) {
    const raw = JSON.stringify(cfg);
    try { localStorage.setItem(CFG_KEY, raw); } catch (_) {}
    try { localStorage.setItem(CFG_KEY_LEGACY, raw); } catch (_) {} // compat
  }

  function readCfgFirst() {
    const a = readJson(CFG_KEY);
    if (a) return a;
    const b = readJson(CFG_KEY_LEGACY);
    if (b) return b;
    return null;
  }

  function clearCfg() {
    try { localStorage.removeItem(CFG_KEY); } catch (_) {}
    try { localStorage.removeItem(CFG_KEY_LEGACY); } catch (_) {}
  }

  function sendCfg(cfg) {
    // ✅ en legacy incluimos key para que el player lo valide
    const msg = { type: "TICKER_CFG", cfg, ts: Date.now(), ...(KEY ? { key: KEY } : {}) };
    try { if (bcMain) bcMain.postMessage(msg); } catch (_) {}
    try { if (bcLegacy) bcLegacy.postMessage(msg); } catch (_) {}

    // fallback para disparar storage events cross-tab
    try { localStorage.setItem("__rlc_ticker_ping", String(Date.now())); } catch (_) {}
  }

  function setStatus(text, ok = true) {
    const el = qs("#ctlTickerStatus");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("pill--ok", !!ok);
    el.classList.toggle("pill--bad", !ok);
  }

  const SOURCE_IDS = new Set(["gdelt", "googlenews", "bbc", "guardian", "aljazeera", "dw", "nytimes"]);

  function parseSourcesField(v) {
    const t = safeStr(String(v || "")).toLowerCase();
    if (!t) return DEFAULTS.sources.slice();
    if (t === "all") return Array.from(SOURCE_IDS);
    const out = [];
    const seen = new Set();
    for (const part of t.split(",")) {
      const id = safeStr(part);
      if (!id) continue;
      if (!SOURCE_IDS.has(id)) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out.length ? out : DEFAULTS.sources.slice();
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

    const ts = safeStr(c.timespan).toLowerCase();
    c.timespan = ts ? ts : DEFAULTS.timespan;

    c.bilingual = (c.bilingual !== false);
    c.translateMax = clamp(num(c.translateMax, DEFAULTS.translateMax), 0, 22);

    c.sources = Array.isArray(c.sources) ? parseSourcesField(c.sources.join(",")) : parseSourcesField(c.sources);

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

    // nuevos (opcionales)
    const bilingual = qs("#ctlTickerBilingual");
    const translateMax = qs("#ctlTickerTranslateMax");
    const sources = qs("#ctlTickerSources");
    const span = qs("#ctlTickerSpan"); // opcional

    if (on) on.value = (c.enabled ? "on" : "off");
    if (lang) lang.value = c.lang;
    if (speed) speed.value = String(c.speedPxPerSec);
    if (refresh) refresh.value = String(c.refreshMins);
    if (top) top.value = String(c.topPx);
    if (hideOnVote) hideOnVote.value = (c.hideOnVote ? "on" : "off");

    if (bilingual) bilingual.value = (c.bilingual ? "on" : "off");
    if (translateMax) translateMax.value = String(c.translateMax);
    if (sources) sources.value = (c.sources || []).join(",");
    if (span) span.value = String(c.timespan || DEFAULTS.timespan);

    setStatus(c.enabled ? "Ticker: ON" : "Ticker: OFF", c.enabled);
  }

  function collectCfgFromUI() {
    const on = qs("#ctlTickerOn")?.value || "on";
    const lang = qs("#ctlTickerLang")?.value || "auto";
    const speed = num(qs("#ctlTickerSpeed")?.value, DEFAULTS.speedPxPerSec);
    const refresh = num(qs("#ctlTickerRefresh")?.value, DEFAULTS.refreshMins);
    const topPx = num(qs("#ctlTickerTop")?.value, DEFAULTS.topPx);
    const hideOnVote = (qs("#ctlTickerHideOnVote")?.value || "on") !== "off";

    // nuevos (si existen)
    const bilingualEl = qs("#ctlTickerBilingual");
    const translateMaxEl = qs("#ctlTickerTranslateMax");
    const sourcesEl = qs("#ctlTickerSources");
    const spanEl = qs("#ctlTickerSpan");

    const bilingual = bilingualEl ? ((bilingualEl.value || "on") !== "off") : undefined;
    const translateMax = translateMaxEl ? num(translateMaxEl.value, DEFAULTS.translateMax) : undefined;
    const sourcesStr = sourcesEl ? safeStr(sourcesEl.value) : "";
    const timespan = spanEl ? safeStr(spanEl.value) : "";

    const cfg = normalizeCfg({
      enabled: (on !== "off"),
      lang,
      speedPxPerSec: speed,
      refreshMins: refresh,
      topPx,
      hideOnVote,
      ...(bilingualEl ? { bilingual } : {}),
      ...(translateMaxEl ? { translateMax } : {}),
      ...(sourcesEl && sourcesStr ? { sources: parseSourcesField(sourcesStr) } : {}),
      ...(spanEl && timespan ? { timespan } : {})
    });

    return cfg;
  }

  function boot() {
    // mínimo necesario
    if (!qs("#ctlTickerApply") || !qs("#ctlTickerOn")) return;

    const saved = normalizeCfg(readCfgFirst() || DEFAULTS);
    writeCfg(saved);
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

    // live apply (si existen)
    const liveEls = [
      "#ctlTickerOn",
      "#ctlTickerLang",
      "#ctlTickerSpeed",
      "#ctlTickerRefresh",
      "#ctlTickerTop",
      "#ctlTickerHideOnVote",
      "#ctlTickerBilingual",
      "#ctlTickerTranslateMax",
      "#ctlTickerSources",
      "#ctlTickerSpan"
    ];

    for (const sel of liveEls) {
      const el = qs(sel);
      if (!el) continue;

      el.addEventListener("change", () => doApply(true));
      el.addEventListener("input", () => {
        // sliders/inputs: aplica en vivo sin esperar blur
        if (el.tagName === "INPUT") doApply(true);
      });
    }

    window.addEventListener("storage", (e) => {
      if (!e) return;
      if (e.key === CFG_KEY || e.key === CFG_KEY_LEGACY) {
        const c = readCfgFirst();
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
