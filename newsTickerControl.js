/* newsTickerControl.js — RLC News Ticker Control v1.4.0 (COMPAT HARDENED: KEY+LEGACY + MULTI-BUS + COPY URL)
   ✅ Solo para control.html
   ✅ Guarda config en localStorage (por key y legacy/base)
   ✅ Emite config por BroadcastChannel (namespaced + legacy/base) + postMessage fallback
   ✅ Soporta #ctlTickerCopyUrl para generar URL del player con params del ticker
   ✅ Debounce en input para no spamear BC
   ✅ Compat EXACTA con newsTicker.js v1.5.0:
        - type: "TICKER_CFG"
        - cfg: enabled, lang, speedPxPerSec, refreshMins, topPx, hideOnVote, timespan,
               bilingual, translateMax, sources[]
   ✅ Añade soporte opcional UI para sources:
        - input/textarea #ctlTickerSources (CSV: "gdelt,bbc,dw,...")
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const LOAD_GUARD = "__RLC_TICKER_CONTROL_LOADED_V140";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  const BUS_BASE = "rlc_bus_v1";
  const CFG_KEY_BASE = "rlc_ticker_cfg_v1";

  const qs = (s, r = document) => r.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const safeStr = (v) => (typeof v === "string") ? v.trim() : "";
  const num = (v, fb) => {
    const n = parseFloat(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fb;
  };

  function parseParams() {
    const u = new URL(location.href);
    return { key: safeStr(u.searchParams.get("key") || "") };
  }

  const P = parseParams();
  const KEY = P.key;

  // ✅ Buses
  const BUS_NS = KEY ? `${BUS_BASE}:${KEY}` : BUS_BASE;
  const bcNs = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS_NS) : null;
  const bcLegacy = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_BASE) : null;

  // ✅ Storage keys (NS + legacy/base)
  const CFG_KEY_NS = KEY ? `${CFG_KEY_BASE}:${KEY}` : CFG_KEY_BASE;
  const CFG_KEY_LEGACY = CFG_KEY_BASE;

  // ✅ Defaults (deben casar con newsTicker.js)
  const DEFAULTS = {
    enabled: true,
    lang: "auto",           // auto|es|en
    speedPxPerSec: 55,      // 20..140
    refreshMins: 12,        // 3..60
    topPx: 10,              // 0..120
    hideOnVote: true,
    timespan: "1d",         // 1d|12h|30min|1w|1m...

    bilingual: true,
    translateMax: 10,

    // ✅ newsTicker.js soporta sources[]
    sources: ["gdelt", "googlenews", "bbc", "dw", "guardian"]
  };

  function normalizeTimespan(v) {
    const t = safeStr(v).toLowerCase();
    if (!t) return DEFAULTS.timespan;
    if (/^\d+(min|h|d|w|m)$/.test(t)) return t;
    return DEFAULTS.timespan;
  }

  function normalizeSources(list) {
    const allowed = new Set(["gdelt","googlenews","bbc","dw","guardian"]);
    const arr = Array.isArray(list)
      ? list
      : String(list || "").split(",").map(s => safeStr(s).toLowerCase()).filter(Boolean);

    const out = [];
    for (const s of arr) {
      if (!allowed.has(s)) continue;
      if (!out.includes(s)) out.push(s);
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

    c.timespan = normalizeTimespan(c.timespan);

    c.bilingual = (c.bilingual !== false);
    c.translateMax = clamp(num(c.translateMax, DEFAULTS.translateMax), 0, 22);

    c.sources = normalizeSources(c.sources);

    return c;
  }

  function readCfgFirst() {
    try {
      const raw1 = localStorage.getItem(CFG_KEY_NS);
      if (raw1) return JSON.parse(raw1);
    } catch (_) {}
    try {
      const raw2 = localStorage.getItem(CFG_KEY_LEGACY);
      if (raw2) return JSON.parse(raw2);
    } catch (_) {}
    return null;
  }

  function writeCfgEverywhere(cfg) {
    const raw = JSON.stringify(cfg);
    try { localStorage.setItem(CFG_KEY_NS, raw); } catch (_) {}
    try { localStorage.setItem(CFG_KEY_LEGACY, raw); } catch (_) {}
  }

  function clearCfgEverywhere() {
    try { localStorage.removeItem(CFG_KEY_NS); } catch (_) {}
    try { localStorage.removeItem(CFG_KEY_LEGACY); } catch (_) {}
  }

  function sendCfg(cfg) {
    const msg = {
      type: "TICKER_CFG",
      cfg,
      ts: Date.now(),
      ...(KEY ? { key: KEY } : {})
    };

    try { bcNs && bcNs.postMessage(msg); } catch (_) {}
    try { bcLegacy && bcLegacy.postMessage(msg); } catch (_) {}

    // Fallbacks
    try { window.postMessage(msg, "*"); } catch (_) {}
    try { localStorage.setItem("__rlc_ticker_ping", String(Date.now())); } catch (_) {}
  }

  function setStatus(text, ok = true) {
    const el = qs("#ctlTickerStatus");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("pill--ok", !!ok);
    el.classList.toggle("pill--bad", !ok);
  }

  function applyUIFromCfg(cfg) {
    const c = normalizeCfg(cfg);

    const on = qs("#ctlTickerOn");
    const lang = qs("#ctlTickerLang");
    const speed = qs("#ctlTickerSpeed");
    const refresh = qs("#ctlTickerRefresh");
    const top = qs("#ctlTickerTop");
    const hideOnVote = qs("#ctlTickerHideOnVote");
    const span = qs("#ctlTickerSpan");

    // opcionales
    const bilingualEl = qs("#ctlTickerBilingual");
    const transEl = qs("#ctlTickerTranslateMax");
    const sourcesEl = qs("#ctlTickerSources"); // ✅ opcional (CSV)

    if (on) on.value = (c.enabled ? "on" : "off");
    if (lang) lang.value = c.lang;
    if (speed) speed.value = String(c.speedPxPerSec);
    if (refresh) refresh.value = String(c.refreshMins);
    if (top) top.value = String(c.topPx);
    if (hideOnVote) hideOnVote.value = (c.hideOnVote ? "on" : "off");
    if (span) span.value = c.timespan;

    if (bilingualEl) bilingualEl.value = (c.bilingual ? "on" : "off");
    if (transEl) transEl.value = String(c.translateMax);

    if (sourcesEl) sourcesEl.value = (c.sources || []).join(",");

    const where = KEY ? `KEY:${KEY}` : "SIN KEY";
    setStatus(c.enabled ? `Ticker: ON · ${where}` : `Ticker: OFF · ${where}`, c.enabled);
  }

  function collectCfgFromUI() {
    const on = qs("#ctlTickerOn")?.value || "on";
    const lang = qs("#ctlTickerLang")?.value || "auto";
    const speed = num(qs("#ctlTickerSpeed")?.value, DEFAULTS.speedPxPerSec);
    const refresh = num(qs("#ctlTickerRefresh")?.value, DEFAULTS.refreshMins);
    const topPx = num(qs("#ctlTickerTop")?.value, DEFAULTS.topPx);
    const hideOnVote = (qs("#ctlTickerHideOnVote")?.value || "on") !== "off";
    const timespan = safeStr(qs("#ctlTickerSpan")?.value || DEFAULTS.timespan);

    const bilingualEl = qs("#ctlTickerBilingual");
    const transEl = qs("#ctlTickerTranslateMax");
    const sourcesEl = qs("#ctlTickerSources");

    const bilingual = bilingualEl ? ((bilingualEl.value || "on") !== "off") : undefined;
    const translateMax = transEl ? num(transEl.value, DEFAULTS.translateMax) : undefined;

    const sources = sourcesEl ? normalizeSources(sourcesEl.value) : undefined;

    return normalizeCfg({
      enabled: (on !== "off"),
      lang,
      speedPxPerSec: speed,
      refreshMins: refresh,
      topPx,
      hideOnVote,
      timespan,
      ...(typeof bilingual === "boolean" ? { bilingual } : {}),
      ...(Number.isFinite(translateMax) ? { translateMax } : {}),
      ...(Array.isArray(sources) ? { sources } : {})
    });
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        ta.style.top = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return !!ok;
      } catch (_) { return false; }
    }
  }

  function buildPlayerUrlWithTicker(cfg) {
    const u = new URL(location.href);
    u.pathname = u.pathname.replace(/[^/]*$/, "index.html");

    if (KEY) u.searchParams.set("key", KEY);

    // ✅ Params EXACTOS newsTicker.js parseParams
    u.searchParams.set("ticker", cfg.enabled ? "1" : "0");
    u.searchParams.set("tickerLang", cfg.lang);
    u.searchParams.set("tickerSpeed", String(cfg.speedPxPerSec));
    u.searchParams.set("tickerRefresh", String(cfg.refreshMins));
    u.searchParams.set("tickerTop", String(cfg.topPx));
    u.searchParams.set("tickerHideOnVote", cfg.hideOnVote ? "1" : "0");
    u.searchParams.set("tickerSpan", cfg.timespan);

    u.searchParams.set("tickerBilingual", cfg.bilingual ? "1" : "0");
    u.searchParams.set("tickerTranslateMax", String(cfg.translateMax));

    // ✅ sources (siempre coherente con whitelist)
    const src = normalizeSources(cfg.sources);
    u.searchParams.set("tickerSources", src.join(","));

    return u.toString();
  }

  // Debounce simple
  let tDeb = 0;
  function debounce(fn, ms = 160) {
    return () => {
      try { clearTimeout(tDeb); } catch (_) {}
      tDeb = setTimeout(fn, ms);
    };
  }

  function boot() {
    // Si no existe el bloque ticker, salimos sin romper nada
    if (!qs("#ctlTickerApply") || !qs("#ctlTickerOn")) return;

    const saved = normalizeCfg(readCfgFirst() || DEFAULTS);
    writeCfgEverywhere(saved);
    applyUIFromCfg(saved);

    const doApply = (persist = true) => {
      const cfg = collectCfgFromUI();
      if (persist) writeCfgEverywhere(cfg);
      sendCfg(cfg);
      applyUIFromCfg(cfg);
    };

    qs("#ctlTickerApply")?.addEventListener("click", () => doApply(true));

    qs("#ctlTickerReset")?.addEventListener("click", () => {
      clearCfgEverywhere();
      const cfg = normalizeCfg(DEFAULTS);
      writeCfgEverywhere(cfg);
      sendCfg(cfg);
      applyUIFromCfg(cfg);
    });

    qs("#ctlTickerCopyUrl")?.addEventListener("click", async () => {
      const cfg = collectCfgFromUI();
      const url = buildPlayerUrlWithTicker(cfg);
      const ok = await copyToClipboard(url);
      setStatus(ok ? "URL ticker copiada ✅" : "No se pudo copiar ❌", ok);
      setTimeout(() => applyUIFromCfg(cfg), 900);
    });

    const liveEls = [
      "#ctlTickerOn",
      "#ctlTickerLang",
      "#ctlTickerSpeed",
      "#ctlTickerRefresh",
      "#ctlTickerTop",
      "#ctlTickerHideOnVote",
      "#ctlTickerSpan",
      "#ctlTickerBilingual",
      "#ctlTickerTranslateMax",
      "#ctlTickerSources"
    ];

    const applyDebounced = debounce(() => doApply(true), 160);

    for (const sel of liveEls) {
      const el = qs(sel);
      if (!el) continue;

      el.addEventListener("change", () => doApply(true));
      el.addEventListener("input", () => {
        // input continuo solo si es INPUT/TEXTAREA (evita “spam” raro en selects)
        const tag = (el.tagName || "").toUpperCase();
        if (tag === "INPUT" || tag === "TEXTAREA") applyDebounced();
      });
    }

    window.addEventListener("storage", (e) => {
      if (!e || !e.key) return;
      if (e.key === CFG_KEY_NS || e.key === CFG_KEY_LEGACY) {
        const c = readCfgFirst();
        if (c) applyUIFromCfg(c);
      }
    });

    // Sync inicial
    try { sendCfg(saved); } catch (_) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
