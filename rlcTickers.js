/* rlcTickers.js — RLC Unified Tickers (NEWS + ECON) v2.3.9 (NO RLCUiBars)
   ✅ NEWS + ECON con MISMO markup + MISMA piel (Neo-Atlas)
   ✅ Siempre full-width y en stack: NEWS arriba, ECON abajo
   ✅ Calcula y aplica: --rlcNewsTop, --rlcEconTop, --rlcTickerH
   ✅ Hide-on-vote ajusta layout (sin gap fantasma)
   ✅ Robust fetch: direct -> AllOrigins -> (solo JSON) r.jina.ai
   ✅ No rompe IDs/clases existentes: #rlcNewsTicker #rlcEconTicker, .tickerInner/.tickerBadge/.tickerText/.tickerMarquee
   ✅ v2.3.9:
      - Update-aware singleton (no dupes)
      - Escalado PRO (uiScale/barH/fontPx) sin glitches (layout mide alturas reales)
      - Fallback CSS “noticiero” suave (sin pisar tu theme)
      - Sources ampliadas (GDELT + RSS clásicos + GoogleNews search packs)
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  // ───────────────────────── Update-aware singleton
  const INSTANCE_KEY = "__RLC_TICKERS_PLAYER_INSTANCE";
  try {
    if (g[INSTANCE_KEY] && typeof g[INSTANCE_KEY].destroy === "function") g[INSTANCE_KEY].destroy();
  } catch (_) {}

  const instance = { version: "2.3.9", destroy: () => {} };
  try { g[INSTANCE_KEY] = instance; } catch (_) {}

  // ───────────────────────── Helpers
  const qs = (s, r = document) => r.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const safeStr = (v) => (typeof v === "string") ? v.trim() : "";
  const num = (v, fb) => {
    const n = parseFloat(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fb;
  };

  function readJson(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return (obj && typeof obj === "object") ? obj : null;
    } catch (_) { return null; }
  }
  function writeJson(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch (_) {}
  }

  function parseKey() {
    try {
      const u = new URL(location.href);
      const k = safeStr(u.searchParams.get("key") || "");
      if (k) return k;
    } catch (_) {}
    try {
      const k = safeStr(localStorage.getItem("rlc_last_key_v1") || "");
      if (k) return k;
    } catch (_) {}
    try {
      const k = safeStr(g.RLC_KEY || "");
      if (k) return k;
    } catch (_) {}
    return "";
  }

  function parseParams() {
    const u = new URL(location.href);
    return {
      key: safeStr(u.searchParams.get("key") || ""),

      // NEWS
      ticker: u.searchParams.get("ticker") ?? "",
      tickerLang: safeStr(u.searchParams.get("tickerLang") || ""),
      tickerSpeed: safeStr(u.searchParams.get("tickerSpeed") || ""),
      tickerRefresh: safeStr(u.searchParams.get("tickerRefresh") || ""),
      tickerTop: safeStr(u.searchParams.get("tickerTop") || ""),
      tickerHideOnVote: safeStr(u.searchParams.get("tickerHideOnVote") || ""),
      tickerSpan: safeStr(u.searchParams.get("tickerSpan") || ""),
      tickerBilingual: safeStr(u.searchParams.get("tickerBilingual") || ""),
      tickerTranslateMax: safeStr(u.searchParams.get("tickerTranslateMax") || ""),
      tickerSources: safeStr(u.searchParams.get("tickerSources") || ""),
      tickerDebug: safeStr(u.searchParams.get("tickerDebug") || ""),

      // ✅ v2.3.9 visuals
      tickerScale: safeStr(u.searchParams.get("tickerScale") || ""),
      tickerBarH: safeStr(u.searchParams.get("tickerBarH") || ""),
      tickerFontPx: safeStr(u.searchParams.get("tickerFontPx") || ""),

      // ECON
      econ: u.searchParams.get("econ") ?? "",
      econSpeed: safeStr(u.searchParams.get("econSpeed") || ""),
      econRefresh: safeStr(u.searchParams.get("econRefresh") || ""),
      econTop: safeStr(u.searchParams.get("econTop") || ""),
      econHideOnVote: safeStr(u.searchParams.get("econHideOnVote") || ""),
      econMode: safeStr(u.searchParams.get("econMode") || ""),
      econClocks: safeStr(u.searchParams.get("econClocks") || ""),
      econDebug: safeStr(u.searchParams.get("econDebug") || ""),

      // ✅ v2.3.9 visuals
      econScale: safeStr(u.searchParams.get("econScale") || ""),
      econBarH: safeStr(u.searchParams.get("econBarH") || ""),
      econFontPx: safeStr(u.searchParams.get("econFontPx") || "")
    };
  }

  const P = parseParams();
  const KEY = P.key || parseKey();

  // ───────────────────────── Bus + keys (namespaced + legacy)
  const BUS_BASE = "rlc_bus_v1";
  const BUS_NS = KEY ? `${BUS_BASE}:${KEY}` : BUS_BASE;

  const bcMain = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS_NS) : null;
  const bcLegacy = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_BASE) : null;

  function keyOk(msg, fromNamespacedChannel) {
    if (!KEY) return true;
    if (fromNamespacedChannel) return true;
    return !!(msg && msg.key === KEY);
  }

  // ───────────────────────── Cleanup
  const _cleanup = { listeners: [], intervals: [], observers: [] };
  function on(el, ev, fn, opts) {
    if (!el) return;
    el.addEventListener(ev, fn, opts);
    _cleanup.listeners.push(() => el.removeEventListener(ev, fn, opts));
  }
  function onWin(ev, fn, opts) { on(window, ev, fn, opts); }

  instance.destroy = () => {
    try { _cleanup.listeners.forEach(fn => fn()); } catch (_) {}
    try { _cleanup.intervals.forEach(id => clearInterval(id)); } catch (_) {}
    try { _cleanup.observers.forEach(o => { try { o.disconnect(); } catch (_) {} }); } catch (_) {}
    try { if (bcMain) bcMain.close(); } catch (_) {}
    try { if (bcLegacy) bcLegacy.close(); } catch (_) {}
    try { if (g[INSTANCE_KEY] === instance) delete g[INSTANCE_KEY]; } catch (_) {}
  };

  // ───────────────────────── Robust fetch
  async function fetchText(url, timeoutMs = 9000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } finally { clearTimeout(t); }
  }
  const allOrigins = (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
  const jina = (url) => {
    const u = safeStr(url);
    if (u.startsWith("https://")) return `https://r.jina.ai/https://${u.slice("https://".length)}`;
    if (u.startsWith("http://"))  return `https://r.jina.ai/http://${u.slice("http://".length)}`;
    return `https://r.jina.ai/https://${u}`;
  };

  async function fetchTextRobust(url, { allowJina = false } = {}) {
    const tries = [
      () => fetchText(url),
      () => fetchText(allOrigins(url)),
      ...(allowJina ? [() => fetchText(jina(url))] : [])
    ];
    let lastErr = null;
    for (const fn of tries) {
      try {
        const txt = await fn();
        const s = safeStr(txt);
        if (s) return txt;
        throw new Error("Empty response");
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("fetchTextRobust failed");
  }

  function tryParseJson(txt) {
    const s = safeStr(txt);
    if (!s) return null;

    const m = s.match(/^[a-zA-Z_$][\w$]*\(([\s\S]+)\)\s*;?\s*$/);
    if (m && m[1]) { try { return JSON.parse(m[1]); } catch (_) {} }

    try { return JSON.parse(s); } catch (_) {}

    const a = s.indexOf("{");
    const b = s.lastIndexOf("}");
    if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (_) {} }
    return null;
  }

  async function fetchJsonRobust(url) {
    const tries = [
      () => fetchText(url),
      () => fetchText(allOrigins(url)),
      () => fetchText(jina(url))
    ];
    let lastErr = null;
    for (const fn of tries) {
      try {
        const txt = await fn();
        const obj = tryParseJson(txt);
        if (obj) return obj;
        throw new Error("No JSON parseable");
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("fetchJsonRobust failed");
  }

  // ───────────────────────── Shared DOM utils
  function sanitizeUrl(u) {
    const s = safeStr(u);
    if (!s) return "";
    try {
      const url = new URL(s, location.href);
      const p = url.protocol.toLowerCase();
      if (p === "http:" || p === "https:") return url.toString();
      return "";
    } catch (_) { return ""; }
  }

  function isElementVisible(el) {
    if (!el) return false;
    const cs = window.getComputedStyle(el);
    if (!cs) return false;
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity || "1") <= 0) return false;
    const r = el.getBoundingClientRect();
    return (r.width > 0 && r.height > 0);
  }

  // ───────────────────────── Fallback CSS (noticiero suave, NO pisa tu theme)
  function ensureTickerStyles() {
    if (qs("#rlcTickersStyle_v239")) return;
    const st = document.createElement("style");
    st.id = "rlcTickersStyle_v239";
    st.textContent = `
:root{
  --rlcTickerZ: 70;
  --rlcTickerGap: 10px;
  --rlcTickerPadX: 10px;
  --rlcTickerRadius: 14px;
  --rlcTickerStroke: rgba(255,255,255,.12);
  --rlcTickerBg: rgba(8,10,14,.62);
  --rlcTickerBg2: rgba(8,10,14,.82);
  --rlcTickerGlow: rgba(42,170,255,.10);
}

#rlcNewsTicker, #rlcEconTicker{
  position: fixed;
  left: 10px; right: 10px;
  z-index: var(--rlcTickerZ, 70);
  pointer-events: auto;
  user-select: none;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
#rlcNewsTicker.hidden, #rlcEconTicker.hidden{ display:none !important; }

#rlcNewsTicker .tickerInner,
#rlcEconTicker .tickerInner{
  height: var(--rlcBarH, 34px);
  border-radius: var(--rlcTickerRadius, 14px);
  border: 1px solid var(--rlcTickerStroke, rgba(255,255,255,.12));
  background:
    radial-gradient(900px 80px at 10% 30%, var(--rlcTickerGlow, rgba(42,170,255,.10)), transparent 60%),
    linear-gradient(180deg, var(--rlcTickerBg, rgba(8,10,14,.62)), var(--rlcTickerBg2, rgba(8,10,14,.82)));
  backdrop-filter: blur(10px);
  box-shadow: 0 10px 30px rgba(0,0,0,.28);
  overflow: hidden;
  display:flex; align-items:center; gap:10px;
  padding: 0 var(--rlcTickerPadX, 10px);
  transform-origin: left center;
}

#rlcNewsTicker{ top: var(--rlcNewsTop, 10px); }
#rlcEconTicker{ top: var(--rlcEconTop, 56px); }

#rlcNewsTicker .tickerBadge,
#rlcEconTicker .tickerBadge{
  display:flex; align-items:center; gap:8px;
  font: 900 11px/1 ui-sans-serif,system-ui;
  letter-spacing: .14em;
  text-transform: uppercase;
  opacity:.95;
  white-space: nowrap;
}
#rlcNewsTicker .tickerBadge{ color: rgba(255,255,255,.96); }
#rlcEconTicker .tickerBadge{ color: rgba(255,255,255,.96); }

#rlcNewsTicker .tickerText,
#rlcEconTicker .tickerText{
  flex:1;
  min-width: 0;
  overflow: hidden;
  font-size: var(--rlcTickerFontPx, 13px);
  color: rgba(255,255,255,.94);
}

.tickerMarquee{
  display:flex;
  gap: 14px;
  white-space: nowrap;
  will-change: transform;
}

[data-marquee="1"] .tickerMarquee{
  animation: rlcTickerMarquee var(--rlcTickerDur, 40s) linear infinite;
}
@keyframes rlcTickerMarquee{
  0%{ transform: translateX(0); }
  100%{ transform: translateX(-50%); }
}

/* Items */
.tkItem{
  display:inline-flex;
  align-items:center;
  gap:10px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,.10);
  background: rgba(255,255,255,.04);
  color: inherit;
  text-decoration: none;
  transition: background .12s ease, border-color .12s ease;
}
.tkItem:hover{ background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.16); }
.tkSep{ opacity:.55; padding: 0 6px; }
.tkTitle{ opacity:.95; }
.tkSrc{
  font: 900 10px/1 ui-sans-serif,system-ui;
  letter-spacing: .10em;
  text-transform: uppercase;
  opacity: .75;
  margin-left: 6px;
}
.tkMeta{ opacity:.80; font-variant-numeric: tabular-nums; }
.tkNm{ font-weight: 800; opacity:.92; }
.tkPx{ font-variant-numeric: tabular-nums; opacity:.95; }
.tkChg{ font-variant-numeric: tabular-nums; font-weight: 900; }
.tkChg.up{ color: rgba(25,226,138,.95); }
.tkChg.down{ color: rgba(255,90,90,.95); }

.tkIco{ width:18px; height:18px; display:inline-flex; align-items:center; justify-content:center; }
.tkIco img{ width:18px; height:18px; display:block; filter: drop-shadow(0 1px 2px rgba(0,0,0,.35)); }
.tkGlyph{ font-size: 16px; line-height:1; }

/* per-ticker scale hooks (si tu theme ya lo hace, esto NO rompe) */
#rlcNewsTicker{ --_rlcScale: var(--rlcNewsUiScale, 1); --_rlcBarH: var(--rlcNewsBarH, var(--rlcBarH, 34px)); --_rlcFont: var(--rlcNewsFontPx, var(--rlcTickerFontPx, 13px)); }
#rlcEconTicker{ --_rlcScale: var(--rlcEconUiScale, 1); --_rlcBarH: var(--rlcEconBarH, var(--rlcBarH, 34px)); --_rlcFont: var(--rlcEconFontPx, var(--rlcTickerFontPx, 13px)); }

#rlcNewsTicker .tickerInner{ height: var(--_rlcBarH); transform: scale(var(--_rlcScale)); }
#rlcEconTicker .tickerInner{ height: var(--_rlcBarH); transform: scale(var(--_rlcScale)); }

#rlcNewsTicker .tickerText{ font-size: var(--_rlcFont); }
#rlcEconTicker .tickerText{ font-size: var(--_rlcFont); }
`.trim();
    document.head.appendChild(st);
  }

  // ───────────────────────── Layout scheduler
  let _layoutQueued = false;
  function requestLayoutSync() {
    if (_layoutQueued) return;
    _layoutQueued = true;
    queueMicrotask(() => {
      _layoutQueued = false;
      syncLayout();
    });
  }

  function cssPx(varName, fb) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
      const n = parseFloat(String(v).replace("px", "").trim());
      return Number.isFinite(n) ? n : fb;
    } catch (_) { return fb; }
  }
  function setVar(name, val) {
    try { document.documentElement.style.setProperty(name, val); } catch (_) {}
  }

  // ======================================================================
  // NEWS TICKER
  // ======================================================================
  const NEWS = (() => {
    const CFG_KEY_BASE = "rlc_ticker_cfg_v1";
    const CACHE_KEY_BASE = "rlc_ticker_cache_v1";
    const TRANS_KEY_BASE = "rlc_ticker_trans_v1";

    const CFG_KEY_NS = KEY ? `${CFG_KEY_BASE}:${KEY}` : CFG_KEY_BASE;
    const CFG_KEY_LEGACY = CFG_KEY_BASE;

    const CACHE_KEY_NS = KEY ? `${CACHE_KEY_BASE}:${KEY}` : CACHE_KEY_BASE;
    const CACHE_KEY_LEGACY = CACHE_KEY_BASE;

    const TRANS_KEY_NS = KEY ? `${TRANS_KEY_BASE}:${KEY}` : TRANS_KEY_BASE;
    const TRANS_KEY_LEGACY = TRANS_KEY_BASE;

    const DEBUG = (P.tickerDebug === "1" || P.tickerDebug === "true");
    const log = (...a) => { if (DEBUG) console.log("[RLC:NEWS]", ...a); };

    const uiLangAuto = (navigator.language || "").toLowerCase().startsWith("es") ? "es" : "en";

    // ✅ Sources ampliadas (ids)
    const API = {
      maxItems: 22,
      gdelt: {
        endpoint: "https://api.gdeltproject.org/api/v2/doc/doc",
        query_en: 'international OR world OR "breaking news" OR summit OR economy OR technology OR science OR climate OR health OR markets'
      },
      rss: {
        // clásicos
        bbc: "https://feeds.bbci.co.uk/news/world/rss.xml",
        dw: "https://rss.dw.com/rdf/rss-en-world",
        guardian: "https://www.theguardian.com/world/rss",

        // Google News RSS (search) — súper útil para ampliar sin depender de RSS privados
        googlenews: "https://news.google.com/rss/search?q=world&hl=en-US&gl=US&ceid=US:en",
        gnews_world: "https://news.google.com/rss/search?q=world&hl=en-US&gl=US&ceid=US:en",
        gnews_us: "https://news.google.com/rss/search?q=US%20breaking%20news&hl=en-US&gl=US&ceid=US:en",
        gnews_eu: "https://news.google.com/rss/search?q=Europe%20breaking%20news&hl=en-US&gl=US&ceid=US:en",
        gnews_latam: "https://news.google.com/rss/search?q=Latin%20America%20breaking%20news&hl=en-US&gl=US&ceid=US:en",
        gnews_business: "https://news.google.com/rss/search?q=business%20markets%20global&hl=en-US&gl=US&ceid=US:en",
        gnews_markets: "https://news.google.com/rss/search?q=markets%20stocks%20bonds%20oil&hl=en-US&gl=US&ceid=US:en",
        gnews_tech: "https://news.google.com/rss/search?q=technology%20AI%20cybersecurity&hl=en-US&gl=US&ceid=US:en",
        gnews_science: "https://news.google.com/rss/search?q=science%20space%20research&hl=en-US&gl=US&ceid=US:en",
        gnews_climate: "https://news.google.com/rss/search?q=climate%20weather%20extreme&hl=en-US&gl=US&ceid=US:en",
        gnews_health: "https://news.google.com/rss/search?q=health%20WHO%20outbreak&hl=en-US&gl=US&ceid=US:en",

        // site-based
        gnews_reuters: "https://news.google.com/rss/search?q=site%3Areuters.com%20world&hl=en-US&gl=US&ceid=US:en",
        gnews_ap: "https://news.google.com/rss/search?q=site%3Aapnews.com%20world&hl=en-US&gl=US&ceid=US:en",
        gnews_cnn: "https://news.google.com/rss/search?q=site%3Acnn.com%20world&hl=en-US&gl=US&ceid=US:en",
        gnews_bloomberg: "https://news.google.com/rss/search?q=site%3Abloomberg.com%20markets&hl=en-US&gl=US&ceid=US:en",
        gnews_nyt: "https://news.google.com/rss/search?q=site%3Anytimes.com%20world&hl=en-US&gl=US&ceid=US:en",
        gnews_ft: "https://news.google.com/rss/search?q=site%3Aft.com%20global%20economy&hl=en-US&gl=US&ceid=US:en",
        gnews_aljazeera: "https://news.google.com/rss/search?q=site%3Aaljazeera.com%20world&hl=en-US&gl=US&ceid=US:en"
      }
    };

    const DEFAULTS = {
      enabled: true,
      lang: "auto",           // auto|es|en
      speedPxPerSec: 55,      // 20..140
      refreshMins: 12,        // 3..60
      topPx: 10,              // 0..180
      hideOnVote: true,
      timespan: "1d",
      bilingual: true,
      translateMax: 10,
      sources: ["gdelt", "googlenews", "bbc", "dw", "guardian"],

      // ✅ v2.3.9 visuals
      uiScale: 1.0,
      barH: 34,
      fontPx: 13
    };

    function normalizeTimespan(s) {
      const t = safeStr(s).toLowerCase();
      if (!t) return DEFAULTS.timespan;
      if (/^\d+(min|h|d|w|m)$/.test(t)) return t;
      return DEFAULTS.timespan;
    }

    function normalizeSources(list) {
      const allowed = new Set(["gdelt", ...Object.keys(API.rss)]);
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

    function cfgFromUrl() {
      const out = {};
      if (P.ticker === "1" || P.ticker === "true") out.enabled = true;
      if (P.tickerLang === "es" || P.tickerLang === "en" || P.tickerLang === "auto") out.lang = P.tickerLang;
      if (P.tickerSpeed) out.speedPxPerSec = clamp(num(P.tickerSpeed, DEFAULTS.speedPxPerSec), 20, 140);
      if (P.tickerRefresh) out.refreshMins = clamp(num(P.tickerRefresh, DEFAULTS.refreshMins), 3, 60);
      if (P.tickerTop) out.topPx = clamp(num(P.tickerTop, DEFAULTS.topPx), 0, 180);
      if (P.tickerHideOnVote === "0") out.hideOnVote = false;
      if (P.tickerHideOnVote === "1") out.hideOnVote = true;
      if (P.tickerSpan) out.timespan = P.tickerSpan;

      if (P.tickerBilingual === "0") out.bilingual = false;
      if (P.tickerBilingual === "1") out.bilingual = true;

      if (P.tickerTranslateMax) out.translateMax = clamp(num(P.tickerTranslateMax, DEFAULTS.translateMax), 0, 22);

      if (P.tickerSources) {
        const arr = P.tickerSources.split(",").map(s => safeStr(s).toLowerCase()).filter(Boolean);
        if (arr.length) out.sources = arr;
      }

      // ✅ v2.3.9 visuals
      if (P.tickerScale) out.uiScale = clamp(num(P.tickerScale, DEFAULTS.uiScale), 0.75, 1.60);
      if (P.tickerBarH) out.barH = clamp(num(P.tickerBarH, DEFAULTS.barH), 22, 72);
      if (P.tickerFontPx) out.fontPx = clamp(num(P.tickerFontPx, DEFAULTS.fontPx), 10, 20);

      if (P.ticker === "0") out.enabled = false;
      return out;
    }

    function normalizeCfg(inCfg) {
      const c = Object.assign({}, inCfg || {});
      c.enabled = (c.enabled !== false);
      c.lang = (c.lang === "es" || c.lang === "en" || c.lang === "auto") ? c.lang : "auto";
      c.speedPxPerSec = clamp(num(c.speedPxPerSec, DEFAULTS.speedPxPerSec), 20, 140);
      c.refreshMins = clamp(num(c.refreshMins, DEFAULTS.refreshMins), 3, 60);
      c.topPx = clamp(num(c.topPx, DEFAULTS.topPx), 0, 180);
      c.hideOnVote = (c.hideOnVote !== false);
      c.timespan = normalizeTimespan(c.timespan);
      c.bilingual = (c.bilingual !== false);
      c.translateMax = clamp(num(c.translateMax, DEFAULTS.translateMax), 0, 22);
      c.sources = normalizeSources(c.sources);

      // ✅ visuals
      c.uiScale = clamp(num(c.uiScale, DEFAULTS.uiScale), 0.75, 1.60);
      c.barH = clamp(num(c.barH, DEFAULTS.barH), 22, 72);
      c.fontPx = clamp(num(c.fontPx, DEFAULTS.fontPx), 10, 20);

      return c;
    }

    function readCfgMerged() {
      return readJson(CFG_KEY_NS) || readJson(CFG_KEY_LEGACY) || null;
    }
    function writeCfgCompat(cfg) {
      try { writeJson(CFG_KEY_NS, cfg); } catch (_) {}
      try { writeJson(CFG_KEY_LEGACY, cfg); } catch (_) {}
    }

    let CFG = normalizeCfg(Object.assign({}, DEFAULTS, readCfgMerged() || {}, cfgFromUrl()));

    function ensureUI() {
      let root = qs("#rlcNewsTicker");
      if (!root) {
        root = document.createElement("div");
        root.id = "rlcNewsTicker";
        document.body.appendChild(root);
      }

      const needs =
        !qs(".tickerInner", root) ||
        !qs("#rlcNewsMarquee", root) ||
        !qs("#rlcNewsTickerLabel", root);

      if (needs) {
        root.setAttribute("role", "region");
        root.setAttribute("aria-label", "Ticker de noticias");
        root.innerHTML = `
          <div class="tickerInner">
            <div class="tickerBadge"><span id="rlcNewsTickerLabel"></span></div>
            <div class="tickerText">
              <div class="tickerMarquee" id="rlcNewsMarquee" aria-live="polite"></div>
            </div>
          </div>
        `.trim();
      }

      return root;
    }

    function applyVisualVars() {
      const root = ensureUI();
      root.style.setProperty("--rlcNewsUiScale", String(CFG.uiScale));
      root.style.setProperty("--rlcNewsBarH", `${CFG.barH}px`);
      root.style.setProperty("--rlcNewsFontPx", `${CFG.fontPx}px`);
    }

    function setVisible(on) {
      const root = ensureUI();
      root.classList.toggle("hidden", !on);
      root.setAttribute("aria-hidden", on ? "false" : "true");
      root.style.display = on ? "" : "none";
      requestLayoutSync();
    }

    function uiLangEffective() {
      return (CFG.lang === "auto") ? uiLangAuto : CFG.lang;
    }

    function setLabel(root) {
      const label = qs("#rlcNewsTickerLabel", root);
      if (!label) return;
      if (CFG.bilingual) label.textContent = "NEWS · NOTICIAS";
      else label.textContent = (uiLangEffective() === "en") ? "NEWS" : "NOTICIAS";
    }

    function uniqBy(arr, keyFn) {
      const seen = new Set();
      const out = [];
      for (const it of arr) {
        const k = keyFn(it);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(it);
      }
      return out;
    }

    function clampLen(s, max) {
      let t = safeStr(s).replace(/\s+/g, " ").trim();
      if (t.length > max) t = t.slice(0, Math.max(8, max - 1)).trim() + "…";
      return t;
    }

    function cleanTitle(s) {
      let t = safeStr(s).replace(/\s+/g, " ").trim();
      if (t.length < 14) return "";
      if (t.length > 140) t = t.slice(0, 137).trim() + "…";
      // filtra scripts que suelen romper look
      if (/[\u0600-\u06FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(t)) return "";
      return t;
    }

    function normalizeSourceFromUrl(u) {
      const s = safeStr(u);
      if (!s) return "NEWS";
      try {
        const url = new URL(s);
        return url.hostname.replace(/^www\./i, "").toUpperCase().slice(0, 18);
      } catch (_) {
        return s.replace(/^https?:\/\//i, "").replace(/^www\./i, "").toUpperCase().slice(0, 18) || "NEWS";
      }
    }

    function normalizeSource(a) {
      const domain = safeStr(a?.domain || a?.source || "");
      const sc = safeStr(a?.sourceCountry || a?.sourcecountry || "");
      const src = domain || sc || "";
      if (!src) return "NEWS";
      const cleaned = src.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
      return cleaned.toUpperCase().slice(0, 18);
    }

    // translation cache
    function simpleHash(str) {
      const s = String(str || "");
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return (h >>> 0).toString(16);
    }

    function readTransStore() {
      const o = readJson(TRANS_KEY_NS) || readJson(TRANS_KEY_LEGACY);
      if (!o || typeof o !== "object") return { ts: Date.now(), map: {}, order: [] };
      if (!o.map || typeof o.map !== "object") o.map = {};
      if (!Array.isArray(o.order)) o.order = [];
      return o;
    }

    function writeTransStore(store) {
      try { writeJson(TRANS_KEY_NS, store); } catch (_) {}
      try { if (!KEY) writeJson(TRANS_KEY_LEGACY, store); } catch (_) {}
    }

    function getCachedEs(titleEn) {
      const store = readTransStore();
      const k = simpleHash(titleEn);
      const it = store.map[k];
      if (!it || !it.es) return "";
      const age = Date.now() - (it.ts || 0);
      if (age > 7 * 24 * 60 * 60 * 1000) return "";
      return String(it.es || "");
    }

    function putCachedEs(titleEn, es) {
      const store = readTransStore();
      const k = simpleHash(titleEn);
      store.map[k] = { ts: Date.now(), es: String(es || "") };
      store.order = store.order.filter(x => x !== k);
      store.order.push(k);
      while (store.order.length > 500) {
        const old = store.order.shift();
        if (old) delete store.map[old];
      }
      store.ts = Date.now();
      writeTransStore(store);
    }

    function decodeEntities(s) {
      return String(s || "")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
    }

    async function translateEnToEs(titleEn) {
      const cached = getCachedEs(titleEn);
      if (cached) return cached;

      const q = encodeURIComponent(titleEn);
      const url = `https://api.mymemory.translated.net/get?q=${q}&langpair=en|es`;

      try {
        const data = await fetchJsonRobust(url);
        const t = decodeEntities(safeStr(data?.responseData?.translatedText || ""));
        const out = clampLen(t, 140);
        if (out && out.length >= 6) {
          putCachedEs(titleEn, out);
          return out;
        }
      } catch (e) {
        log("translate fail:", e?.message || e);
      }
      return "";
    }

    async function getHeadlinesFromGdelt() {
      const q = API.gdelt.query_en;
      const finalQ = `(${q}) sourcelang:eng`;

      const url =
        `${API.gdelt.endpoint}` +
        `?query=${encodeURIComponent(finalQ)}` +
        `&mode=ArtList` +
        `&format=json` +
        `&sort=HybridRel` +
        `&timespan=${encodeURIComponent(CFG.timespan)}` +
        `&maxrecords=${encodeURIComponent(String(API.maxItems * 2))}`;

      const data = await fetchJsonRobust(url);
      const errMsg = safeStr(data?.error || data?.message || data?.status || "");
      if (errMsg && /error|invalid|failed/i.test(errMsg)) throw new Error(errMsg || "GDELT error");

      const articles = Array.isArray(data?.articles) ? data.articles
                     : Array.isArray(data?.results) ? data.results
                     : Array.isArray(data?.artlist) ? data.artlist
                     : [];

      const mapped = articles.map(a => {
        const title = cleanTitle(a?.title || a?.name || "");
        const link  = sanitizeUrl(a?.url || a?.link || a?.url_mobile || "");
        if (!title || !link) return null;
        return { titleEn: title, url: link, source: normalizeSource(a) || "GDELT" };
      }).filter(Boolean);

      return uniqBy(mapped, x => (x.titleEn + "|" + x.url).toLowerCase()).slice(0, API.maxItems);
    }

    function parseRssOrAtom(xmlText, fallbackSource) {
      const txt = String(xmlText || "");
      const doc = new DOMParser().parseFromString(txt, "text/xml");
      if (doc.querySelector("parsererror")) return [];

      const out = [];

      const items = Array.from(doc.querySelectorAll("item"));
      for (const it of items) {
        const t = cleanTitle(it.querySelector("title")?.textContent || "");
        let link = safeStr(it.querySelector("link")?.textContent || "");
        if (!link) link = safeStr(it.querySelector("guid")?.textContent || "");
        link = sanitizeUrl(link);
        if (!t || !link) continue;

        const srcNode = it.querySelector("source");
        const srcText = safeStr(srcNode?.textContent || "");
        const srcUrl = safeStr(srcNode?.getAttribute("url") || "");
        const source = (srcText || (srcUrl ? normalizeSourceFromUrl(srcUrl) : "")) || fallbackSource || "RSS";

        out.push({ titleEn: t, url: link, source });
        if (out.length >= API.maxItems) break;
      }

      if (!out.length) {
        const entries = Array.from(doc.querySelectorAll("entry"));
        for (const e of entries) {
          const t = cleanTitle(e.querySelector("title")?.textContent || "");
          const linkEl = e.querySelector('link[rel="alternate"]') || e.querySelector("link");
          const link = sanitizeUrl(linkEl?.getAttribute("href") || linkEl?.textContent || "");
          if (!t || !link) continue;
          out.push({ titleEn: t, url: link, source: fallbackSource || "ATOM" });
          if (out.length >= API.maxItems) break;
        }
      }

      return out;
    }

    async function getHeadlinesFromRss(id, url) {
      const xml = await fetchTextRobust(url, { allowJina: false });
      const source = ({
        googlenews: "GNEWS",
        gnews_world: "GNEWS",
        gnews_us: "GNEWS",
        gnews_eu: "GNEWS",
        gnews_latam: "GNEWS",
        gnews_business: "GNEWS",
        gnews_markets: "GNEWS",
        gnews_tech: "GNEWS",
        gnews_science: "GNEWS",
        gnews_climate: "GNEWS",
        gnews_health: "GNEWS",
        gnews_reuters: "REUTERS",
        gnews_ap: "AP",
        gnews_cnn: "CNN",
        gnews_bloomberg: "BLOOMBERG",
        gnews_nyt: "NYT",
        gnews_ft: "FT",
        gnews_aljazeera: "ALJAZEERA",
        bbc: "BBC",
        dw: "DW",
        guardian: "GUARDIAN"
      }[id] || normalizeSourceFromUrl(url));

      const items = parseRssOrAtom(xml, source);
      return uniqBy(items, x => safeStr(x.url).toLowerCase()).slice(0, API.maxItems);
    }

    async function getHeadlinesEnMixed() {
      const srcs = CFG.sources || DEFAULTS.sources;

      const tasks = [];
      for (const id of srcs) {
        if (id === "gdelt") tasks.push((async () => ({ id, items: await getHeadlinesFromGdelt() }))());
        else if (API.rss[id]) tasks.push((async () => ({ id, items: await getHeadlinesFromRss(id, API.rss[id]) }))());
      }

      const res = await Promise.allSettled(tasks);
      const chunks = [];
      for (const r of res) {
        if (r.status !== "fulfilled") continue;
        const got = r.value?.items;
        if (Array.isArray(got) && got.length) chunks.push(got);
      }

      const merged = [];
      let guard = 0;
      while (merged.length < API.maxItems && guard < 800) {
        guard++;
        let pushed = false;
        for (const arr of chunks) {
          if (!arr.length) continue;
          merged.push(arr.shift());
          pushed = true;
          if (merged.length >= API.maxItems) break;
        }
        if (!pushed) break;
      }

      return uniqBy(merged.filter(Boolean), x => (safeStr(x.titleEn) + "|" + safeStr(x.url)).toLowerCase())
        .slice(0, API.maxItems);
    }

    async function makeBilingual(items) {
      if (!CFG.bilingual) return items;
      const maxN = CFG.translateMax | 0;
      if (maxN <= 0) return items;

      const out = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it || !it.titleEn) { out.push(it); continue; }

        let es = "";
        if (i < maxN) es = await translateEnToEs(it.titleEn);
        else es = getCachedEs(it.titleEn) || "";

        out.push(Object.assign({}, it, { titleEs: es }));
      }
      return out;
    }

    function buildSegment(items) {
      const uiLang = uiLangEffective();
      const list = (Array.isArray(items) && items.length) ? items : [
        { titleEn: (uiLang === "es") ? "No hay titulares ahora mismo… reintentando." : "No headlines right now… retrying.", titleEs: "", url: "", source: "RLC" }
      ];

      const seg = document.createElement("span");
      seg.className = "tkSeg";

      let first = true;
      const addSep = () => {
        const s = document.createElement("span");
        s.className = "tkSep";
        s.textContent = "•";
        seg.appendChild(s);
      };

      for (const it of list) {
        const link = sanitizeUrl(it.url || "");
        const isLink = !!link;

        if (!first) addSep();
        first = false;

        const el = document.createElement(isLink ? "a" : "span");
        el.className = "tkItem";
        if (isLink) {
          el.href = link;
          el.target = "_blank";
          el.rel = "noreferrer noopener";
        }

        const t = document.createElement("span");
        t.className = "tkTitle";

        if (CFG.bilingual) {
          const en = clampLen(it.titleEn || "", 110);
          const es = clampLen(it.titleEs || "", 110);
          t.textContent = es ? `${en} — ${es}` : en;
        } else {
          t.textContent = clampLen(it.titleEn || "", 130);
        }

        const src = document.createElement("span");
        src.className = "tkSrc";
        src.textContent = safeStr(it.source || "NEWS");

        el.appendChild(t);
        el.appendChild(src);
        seg.appendChild(el);
      }

      return seg;
    }

    function applyMarqueeSpeed(root, seg1, marquee) {
      // Medición REAL (incluye scale)
      const wrap = marquee?.parentElement || null;
      const vw = wrap ? (wrap.getBoundingClientRect().width || 800) : 800;
      const w = Math.max(300, seg1.getBoundingClientRect().width || 300);

      if (w > vw * 1.05) {
        root.setAttribute("data-marquee", "1");
        const durSec = clamp(w / Math.max(20, CFG.speedPxPerSec), 12, 220);
        root.style.setProperty("--rlcTickerDur", `${durSec}s`);
      } else {
        root.setAttribute("data-marquee", "0");
        root.style.removeProperty("--rlcTickerDur");
      }
    }

    function setTickerItems(items) {
      const root = ensureUI();
      applyVisualVars();
      setLabel(root);

      const marquee = qs("#rlcNewsMarquee", root);
      if (!marquee) return;

      marquee.innerHTML = "";
      const seg1 = buildSegment(items);
      const seg2 = seg1.cloneNode(true);
      marquee.appendChild(seg1);
      marquee.appendChild(seg2);

      // medir tras layout real
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try { applyMarqueeSpeed(root, seg1, marquee); } catch (_) {}
          requestLayoutSync();
        });
      });
    }

    function cacheKey() {
      const srcKey = (CFG.sources || []).join(",");
      return `${CFG.timespan}|src=${srcKey}|b=${CFG.bilingual ? 1 : 0}|mx=${CFG.translateMax|0}`;
    }

    function readCache() {
      const c = readJson(CACHE_KEY_NS) || readJson(CACHE_KEY_LEGACY);
      if (!c || typeof c !== "object") return null;
      if (!Array.isArray(c.items)) return null;
      return c;
    }

    function writeCache(key, items) {
      writeJson(CACHE_KEY_NS, { ts: Date.now(), key, items });
      if (!KEY) writeJson(CACHE_KEY_LEGACY, { ts: Date.now(), key, items });
    }

    // hide-on-vote
    let voteObs = null;
    let domObs = null;

    function setupHideOnVote() {
      try { voteObs?.disconnect(); } catch (_) {}
      voteObs = null;

      const vote = qs("#voteBox");
      if (!vote) return;

      const apply = () => {
        if (!CFG.enabled) { setVisible(false); return; }
        if (!CFG.hideOnVote) { setVisible(true); return; }
        const voteVisible = isElementVisible(vote);
        setVisible(!voteVisible);
      };

      apply();

      voteObs = new MutationObserver(apply);
      voteObs.observe(vote, { attributes: true, attributeFilter: ["class", "style"] });
      _cleanup.observers.push(voteObs);
    }

    function watchForVoteBox() {
      try { domObs?.disconnect(); } catch (_) {}
      domObs = null;

      domObs = new MutationObserver(() => {
        const vote = qs("#voteBox");
        if (vote) setupHideOnVote();
      });
      domObs.observe(document.documentElement, { childList: true, subtree: true });
      _cleanup.observers.push(domObs);
    }

    // refresh loop
    let refreshTimer = null;
    let refreshInFlight = false;

    async function refresh(force = false) {
      if (!CFG.enabled) { setVisible(false); return; }
      if (!CFG.hideOnVote) setVisible(true);

      const ck = cacheKey();

      if (!force) {
        const cache = readCache();
        const maxAge = Math.max(2, CFG.refreshMins) * 60 * 1000;
        if (cache && cache.key === ck && (Date.now() - (cache.ts || 0) <= maxAge)) {
          setTickerItems(cache.items);
          return;
        }
      }

      if (refreshInFlight) return;
      refreshInFlight = true;

      try {
        const en = await getHeadlinesEnMixed();
        const bi = await makeBilingual(en);
        setTickerItems(bi);
        writeCache(ck, bi);
      } catch (e) {
        const cache = readCache();
        if (cache?.items?.length) setTickerItems(cache.items);
        else setTickerItems([]);
        log("refresh fail", e?.message || e);
      } finally {
        refreshInFlight = false;
      }
    }

    function startTimer() {
      if (refreshTimer) clearInterval(refreshTimer);
      const every = Math.max(180000, CFG.refreshMins * 60 * 1000);
      refreshTimer = setInterval(() => refresh(false), every);
      _cleanup.intervals.push(refreshTimer);
    }

    function applyCfg(nextCfg, persist = false) {
      CFG = normalizeCfg(Object.assign({}, CFG, nextCfg || {}));
      if (persist) writeCfgCompat(CFG);

      applyVisualVars();

      if (!CFG.enabled) setVisible(false);
      else {
        if (!CFG.hideOnVote) setVisible(true);
      }

      setupHideOnVote();
      startTimer();
      refresh(true);
      requestLayoutSync();
    }

    function onMessage(msg, fromNamespaced) {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "TICKER_CFG" && msg.cfg && typeof msg.cfg === "object") {
        if (!keyOk(msg, fromNamespaced)) return;
        applyCfg(msg.cfg, true);
      }
    }

    function boot() {
      if (P.ticker === "0") CFG.enabled = false;
      ensureUI();
      applyCfg(CFG, false);

      setupHideOnVote();
      watchForVoteBox();

      const cache = readCache();
      if (cache?.items?.length) setTickerItems(cache.items);

      refresh(false);
      log("boot", { CFG, KEY, BUS_NS, CFG_KEY_NS });
    }

    function getCfg() { return CFG; }
    function isEnabled() { return !!CFG.enabled; }
    function isVisibleNow() {
      const root = qs("#rlcNewsTicker");
      return !!(CFG.enabled && root && !root.classList.contains("hidden") && isElementVisible(root));
    }
    function getLayoutState() {
      const root = qs("#rlcNewsTicker");
      const h = (root && isVisibleNow()) ? (root.getBoundingClientRect().height || 0) : 0;
      return { enabled: isEnabled(), visible: isVisibleNow(), topPx: CFG.topPx ?? 10, heightPx: h };
    }

    return { boot, onMessage, applyCfg, getCfg, isEnabled, isVisibleNow, getLayoutState };
  })();

  // ======================================================================
  // ECON TICKER
  // ======================================================================
  const ECON = (() => {
    const CFG_KEY_BASE = "rlc_econ_cfg_v1";
    const CACHE_KEY_BASE = "rlc_econ_cache_v1";

    const CFG_KEY_NS = KEY ? `${CFG_KEY_BASE}:${KEY}` : CFG_KEY_BASE;
    const CFG_KEY_LEGACY = CFG_KEY_BASE;

    const CACHE_KEY_NS = KEY ? `${CACHE_KEY_BASE}:${KEY}` : CACHE_KEY_BASE;
    const CACHE_KEY_LEGACY = CACHE_KEY_BASE;

    const DEBUG = (P.econDebug === "1" || P.econDebug === "true");
    const log = (...a) => { if (DEBUG) console.log("[RLC:ECON]", ...a); };

    const DEFAULTS = {
      enabled: true,
      speedPxPerSec: 60,   // 20..140
      refreshMins: 2,      // 1..20
      topPx: 10,           // 0..180
      hideOnVote: true,
      mode: "daily",       // daily|sinceLast
      showClocks: true,
      clocks: [
        { label: "MAD", country: "ES", tz: "Europe/Madrid" },
        { label: "NY",  country: "US", tz: "America/New_York" },
        { label: "LDN", country: "GB", tz: "Europe/London" },
        { label: "TYO", country: "JP", tz: "Asia/Tokyo" }
      ],
      items: [
        { id:"btc",  label:"BTC/USD", stooq:"btcusd", kind:"crypto", currency:"USD", decimals:0, country:"UN", tz:"UTC", iconSlug:"bitcoin" },
        { id:"eth",  label:"ETH/USD", stooq:"ethusd", kind:"crypto", currency:"USD", decimals:0, country:"UN", tz:"UTC", iconSlug:"ethereum" },
        { id:"eurusd", label:"EUR/USD", stooq:"eurusd", kind:"fx", currency:"USD", decimals:4, country:"EU", tz:"Europe/Brussels", iconSlug:"euro" },
        { id:"aapl", label:"AAPL", stooq:"aapl.us", kind:"stock", currency:"USD", decimals:2, country:"US", tz:"America/New_York", iconSlug:"apple", domain:"apple.com" },
        { id:"tsla", label:"TSLA", stooq:"tsla.us", kind:"stock", currency:"USD", decimals:2, country:"US", tz:"America/New_York", iconSlug:"tesla", domain:"tesla.com" },
        { id:"spx",  label:"S&P 500", stooq:"^spx", kind:"index", currency:"USD", decimals:2, country:"US", tz:"America/New_York", glyph:"📈" },
        { id:"gold", label:"GOLD", stooq:"gc.f", kind:"commodity", currency:"USD", decimals:2, country:"US", tz:"America/New_York", glyph:"🪙" }
      ],

      // ✅ v2.3.9 visuals
      uiScale: 1.0,
      barH: 34,
      fontPx: 13
    };

    function normalizeClocks(list) {
      const arr = Array.isArray(list) ? list : [];
      const out = [];
      for (const c of arr) {
        const label = safeStr(c?.label).slice(0, 8) || "CLK";
        const country = safeStr(c?.country).toUpperCase() || "UN";
        const tz = safeStr(c?.tz) || "UTC";
        if (!tz) continue;
        out.push({ label, country, tz });
      }
      return out.length ? out : DEFAULTS.clocks.slice();
    }

    function normalizeItems(list) {
      const arr = Array.isArray(list) ? list : [];
      const out = [];
      for (const it of arr) {
        const stooq = safeStr(it?.stooq);
        if (!stooq) continue;

        out.push({
          id: safeStr(it?.id) || stooq,
          label: safeStr(it?.label) || stooq.toUpperCase(),
          stooq,
          kind: safeStr(it?.kind) || "asset",
          currency: safeStr(it?.currency).toUpperCase() || "USD",
          decimals: clamp(num(it?.decimals, 2), 0, 8),
          country: safeStr(it?.country).toUpperCase() || "UN",
          tz: safeStr(it?.tz) || "UTC",
          iconSlug: safeStr(it?.iconSlug) || "",
          domain: safeStr(it?.domain) || "",
          glyph: safeStr(it?.glyph) || ""
        });
      }
      return out.length ? out : DEFAULTS.items.slice();
    }

    function normalizeCfg(inCfg) {
      const c = Object.assign({}, inCfg || {});
      c.enabled = (c.enabled !== false);
      c.speedPxPerSec = clamp(num(c.speedPxPerSec, DEFAULTS.speedPxPerSec), 20, 140);
      c.refreshMins = clamp(num(c.refreshMins, DEFAULTS.refreshMins), 1, 20);
      c.topPx = clamp(num(c.topPx, DEFAULTS.topPx), 0, 180);
      c.hideOnVote = (c.hideOnVote !== false);
      c.mode = (safeStr(c.mode).toLowerCase().includes("since")) ? "sinceLast" : "daily";
      c.showClocks = (c.showClocks !== false);
      c.clocks = normalizeClocks(c.clocks);
      c.items = normalizeItems(c.items);

      c.uiScale = clamp(num(c.uiScale, DEFAULTS.uiScale), 0.75, 1.60);
      c.barH = clamp(num(c.barH, DEFAULTS.barH), 22, 72);
      c.fontPx = clamp(num(c.fontPx, DEFAULTS.fontPx), 10, 20);

      return c;
    }

    function cfgFromUrl() {
      const out = {};
      if (P.econSpeed) out.speedPxPerSec = clamp(num(P.econSpeed, DEFAULTS.speedPxPerSec), 20, 140);
      if (P.econRefresh) out.refreshMins = clamp(num(P.econRefresh, DEFAULTS.refreshMins), 1, 20);
      if (P.econTop) out.topPx = clamp(num(P.econTop, DEFAULTS.topPx), 0, 180);
      if (P.econHideOnVote === "0") out.hideOnVote = false;
      if (P.econHideOnVote === "1") out.hideOnVote = true;
      if (P.econMode) out.mode = (safeStr(P.econMode).toLowerCase().includes("since")) ? "sinceLast" : "daily";
      if (P.econClocks === "0") out.showClocks = false;
      if (P.econClocks === "1") out.showClocks = true;

      // ✅ v2.3.9 visuals
      if (P.econScale) out.uiScale = clamp(num(P.econScale, DEFAULTS.uiScale), 0.75, 1.60);
      if (P.econBarH) out.barH = clamp(num(P.econBarH, DEFAULTS.barH), 22, 72);
      if (P.econFontPx) out.fontPx = clamp(num(P.econFontPx, DEFAULTS.fontPx), 10, 20);

      if (P.econ === "0") out.enabled = false;
      return out;
    }

    function readCfgMerged() {
      return readJson(CFG_KEY_NS) || readJson(CFG_KEY_LEGACY) || null;
    }

    function writeCfgCompat(cfg) {
      try { writeJson(CFG_KEY_NS, cfg); } catch (_) {}
      try { writeJson(CFG_KEY_LEGACY, cfg); } catch (_) {}
    }

    let CFG = normalizeCfg(Object.assign({}, DEFAULTS, readCfgMerged() || {}, cfgFromUrl()));

    function ensureUI() {
      let root = qs("#rlcEconTicker");
      if (!root) {
        root = document.createElement("div");
        root.id = "rlcEconTicker";
        document.body.appendChild(root);
      }

      const needs =
        !qs(".tickerInner", root) ||
        !qs("#rlcEconMarquee", root) ||
        !qs("#rlcEconTickerLabel", root);

      if (needs) {
        root.setAttribute("role", "region");
        root.setAttribute("aria-label", "Ticker económico");
        root.innerHTML = `
          <div class="tickerInner">
            <div class="tickerBadge"><span id="rlcEconTickerLabel">MARKETS · MERCADOS</span></div>
            <div class="tickerText">
              <div class="tickerMarquee" id="rlcEconMarquee" aria-live="polite"></div>
            </div>
          </div>
        `.trim();
      }

      return root;
    }

    function applyVisualVars() {
      const root = ensureUI();
      root.style.setProperty("--rlcEconUiScale", String(CFG.uiScale));
      root.style.setProperty("--rlcEconBarH", `${CFG.barH}px`);
      root.style.setProperty("--rlcEconFontPx", `${CFG.fontPx}px`);
    }

    function setVisible(on) {
      const root = ensureUI();
      root.classList.toggle("hidden", !on);
      root.setAttribute("aria-hidden", on ? "false" : "true");
      root.style.display = on ? "" : "none";
      requestLayoutSync();
    }

    // ───────────────────────── Flags + clocks + fmt
    function flagEmoji(country2) {
      const cc = safeStr(country2).toUpperCase();
      if (!cc) return "🏳️";
      if (cc === "UN") return "🌐";
      if (cc === "EU") return "🇪🇺";
      if (!/^[A-Z]{2}$/.test(cc)) return "🏳️";
      const A = 0x1F1E6;
      const c1 = cc.charCodeAt(0) - 65;
      const c2 = cc.charCodeAt(1) - 65;
      return String.fromCodePoint(A + c1, A + c2);
    }

    function fmtTime(tz) {
      try {
        return new Intl.DateTimeFormat(undefined, {
          hour: "2-digit", minute: "2-digit", second: "2-digit",
          hour12: false, timeZone: tz
        }).format(new Date());
      } catch (_) {
        const d = new Date();
        return d.toTimeString().slice(0, 8);
      }
    }

    function fmtNum(n, decimals) {
      if (!Number.isFinite(n)) return "—";
      const d = clamp(num(decimals, 2), 0, 8);
      return new Intl.NumberFormat(undefined, {
        minimumFractionDigits: d,
        maximumFractionDigits: d
      }).format(n);
    }

    function currencyPrefix(ccy) {
      const c = safeStr(ccy).toUpperCase();
      if (c === "USD") return "$";
      if (c === "EUR") return "€";
      if (c === "GBP") return "£";
      if (c === "JPY") return "¥";
      return c ? (c + " ") : "";
    }

    // Icons (FREE)
    function simpleIconUrl(slug) {
      const s = safeStr(slug).toLowerCase();
      if (!s) return "";
      return `https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/${encodeURIComponent(s)}.svg`;
    }
    function faviconUrl(domain) {
      const d = safeStr(domain).toLowerCase();
      if (!d) return "";
      return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64`;
    }
    function guessGlyph(kind) {
      const k = safeStr(kind).toLowerCase();
      if (k === "crypto") return "🪙";
      if (k === "fx") return "💱";
      if (k === "stock") return "🏛️";
      if (k === "index") return "📈";
      if (k === "commodity") return "⛏️";
      return "•";
    }
    function iconFor(it) {
      const slug = safeStr(it.iconSlug);
      if (slug) return { type: "img", url: simpleIconUrl(slug) };
      const dom = safeStr(it.domain);
      if (dom) return { type: "img", url: faviconUrl(dom) };
      const glyph = safeStr(it.glyph) || guessGlyph(it.kind);
      return { type: "glyph", glyph };
    }

    // ───────────────────────── Stooq
    const stooqLastUrl  = (sym) => `https://stooq.com/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlcv&h&e=csv`;
    const stooqDailyUrl = (sym) => `https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d`;

    const csvLineSplit = (text) => String(text || "").trim().split(/\r?\n/).filter(Boolean);
    const csvSplitRow  = (line) => String(line || "").split(",").map(s => s.trim());
    const toNum = (v) => {
      const s = String(v ?? "").trim();
      if (!s || s === "N/D" || s === "ND" || s === "NA") return null;
      const n = parseFloat(s.replace(",", "."));
      return Number.isFinite(n) ? n : null;
    };

    async function getLastClose(sym) {
      const txt = await fetchTextRobust(stooqLastUrl(sym), { allowJina: false });
      const lines = csvLineSplit(txt);
      if (lines.length < 2) throw new Error("CSV short");
      const head = csvSplitRow(lines[0]);
      const row  = csvSplitRow(lines[1]);

      const idxClose = head.findIndex(h => h.toLowerCase() === "close");
      const idxDate  = head.findIndex(h => h.toLowerCase() === "date");
      const idxTime  = head.findIndex(h => h.toLowerCase() === "time");

      const close = toNum(row[idxClose]);
      const dt = `${row[idxDate] || ""} ${row[idxTime] || ""}`.trim();

      if (!Number.isFinite(close)) throw new Error("No close");
      return { close, dt };
    }

    function parseDailyPrevClose(txt) {
      const lines = csvLineSplit(txt);
      if (lines.length < 3) return null;

      const head = csvSplitRow(lines[0]);
      const idxClose = head.findIndex(h => h.toLowerCase() === "close");
      if (idxClose < 0) return null;

      const row1 = csvSplitRow(lines[1]);
      const row2 = csvSplitRow(lines[2]);

      const close1 = toNum(row1[idxClose]);
      const close2 = toNum(row2[idxClose]);
      if (!Number.isFinite(close1)) return null;

      return Number.isFinite(close2) ? close2 : close1;
    }

    // cache
    const cacheKey = () => {
      const list = (CFG.items || []).map(x => safeStr(x.stooq)).join(",");
      return `m=${CFG.mode}|list=${list}`;
    };

    function readCache() {
      const c = readJson(CACHE_KEY_NS) || readJson(CACHE_KEY_LEGACY);
      if (!c || typeof c !== "object") return null;
      if (!c.map || typeof c.map !== "object") return null;
      return c;
    }

    function writeCache(key, map) {
      writeJson(CACHE_KEY_NS, { ts: Date.now(), key, map });
      if (!KEY) writeJson(CACHE_KEY_LEGACY, { ts: Date.now(), key, map });
    }

    function clampLen(s, max) {
      let t = safeStr(s).replace(/\s+/g, " ").trim();
      if (t.length > max) t = t.slice(0, Math.max(8, max - 1)).trim() + "…";
      return t;
    }

    // clocks live updater
    let clockTimer = null;
    function startClockTimer() {
      if (clockTimer) return;
      clockTimer = setInterval(() => {
        try {
          const nodes = document.querySelectorAll("[data-rlc-tz][data-rlc-clock='1']");
          nodes.forEach((n) => {
            const tz = n.getAttribute("data-rlc-tz") || "UTC";
            n.textContent = fmtTime(tz);
          });
        } catch (_) {}
      }, 1000);
      _cleanup.intervals.push(clockTimer);
    }

    function buildSegment(model) {
      const seg = document.createElement("span");
      seg.className = "tkSeg";

      let first = true;
      const addSep = () => {
        const s = document.createElement("span");
        s.className = "tkSep";
        s.textContent = "•";
        seg.appendChild(s);
      };

      if (CFG.showClocks && Array.isArray(model.clocks) && model.clocks.length) {
        for (const c of model.clocks) {
          if (!first) addSep();
          first = false;

          const el = document.createElement("span");
          el.className = "tkItem";

          const meta = document.createElement("span");
          meta.className = "tkMeta";
          meta.textContent = `${flagEmoji(c.country)} ${c.label || "CLK"} `;

          const clk = document.createElement("span");
          clk.className = "tkMeta";
          clk.setAttribute("data-rlc-clock", "1");
          clk.setAttribute("data-rlc-tz", c.tz || "UTC");
          clk.textContent = fmtTime(c.tz || "UTC");

          el.appendChild(meta);
          el.appendChild(clk);
          seg.appendChild(el);
        }
      }

      for (const it of (model.items || [])) {
        if (!first) addSep();
        first = false;

        const a = document.createElement("a");
        a.className = "tkItem";
        a.href = `https://stooq.com/q/?s=${encodeURIComponent(it.stooq)}`;
        a.target = "_blank";
        a.rel = "noreferrer noopener";

        const icoWrap = document.createElement("span");
        icoWrap.className = "tkIco";
        const ic = iconFor(it);

        if (ic.type === "img") {
          const img = document.createElement("img");
          img.loading = "lazy";
          img.referrerPolicy = "no-referrer";
          img.src = ic.url;
          img.alt = "";
          img.onerror = () => {
            try {
              img.remove();
              const sp = document.createElement("span");
              sp.className = "tkGlyph";
              sp.textContent = safeStr(it.glyph) || guessGlyph(it.kind);
              icoWrap.appendChild(sp);
            } catch (_) {}
          };
          icoWrap.appendChild(img);
        } else {
          const sp = document.createElement("span");
          sp.className = "tkGlyph";
          sp.textContent = ic.glyph;
          icoWrap.appendChild(sp);
        }

        const nm = document.createElement("span");
        nm.className = "tkNm";
        nm.textContent = clampLen(it.label || it.stooq.toUpperCase(), 18);

        const px = document.createElement("span");
        px.className = "tkPx";
        px.textContent = it.priceText || "—";

        const chg = document.createElement("span");
        chg.className = "tkChg";
        if (it.changeText) {
          chg.textContent = it.changeText;
          if (it.changeDir === "up") chg.classList.add("up");
          else if (it.changeDir === "down") chg.classList.add("down");
        } else {
          chg.textContent = "";
        }

        const meta = document.createElement("span");
        meta.className = "tkMeta";
        meta.textContent = `${flagEmoji(it.country)} ${fmtTime(it.tz || "UTC")}`;

        a.appendChild(icoWrap);
        a.appendChild(nm);
        a.appendChild(px);
        if (it.changeText) a.appendChild(chg);
        a.appendChild(meta);

        seg.appendChild(a);
      }

      return seg;
    }

    function applyMarqueeSpeed(root, seg1, marquee) {
      const wrap = marquee?.parentElement || null;
      const vw = wrap ? (wrap.getBoundingClientRect().width || 800) : 800;
      const w = Math.max(300, seg1.getBoundingClientRect().width || 300);

      if (w > vw * 1.05) {
        root.setAttribute("data-marquee", "1");
        const durSec = clamp(w / Math.max(20, CFG.speedPxPerSec), 12, 220);
        root.style.setProperty("--rlcTickerDur", `${durSec}s`);
      } else {
        root.setAttribute("data-marquee", "0");
        root.style.removeProperty("--rlcTickerDur");
      }
    }

    function setTickerItems(model) {
      const root = ensureUI();
      applyVisualVars();

      const marquee = qs("#rlcEconMarquee", root);
      if (!marquee) return;

      marquee.innerHTML = "";

      const seg1 = buildSegment(model);
      const seg2 = seg1.cloneNode(true);

      marquee.appendChild(seg1);
      marquee.appendChild(seg2);

      startClockTimer();

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try { applyMarqueeSpeed(root, seg1, marquee); } catch (_) {}
          requestLayoutSync();
        });
      });
    }

    // hide-on-vote
    let voteObs = null;
    let domObs = null;

    function setupHideOnVote() {
      try { voteObs?.disconnect(); } catch (_) {}
      voteObs = null;

      const vote = qs("#voteBox");
      if (!vote) return;

      const apply = () => {
        if (!CFG.enabled) { setVisible(false); return; }
        if (!CFG.hideOnVote) { setVisible(true); return; }
        const voteVisible = isElementVisible(vote);
        setVisible(!voteVisible);
      };

      apply();

      voteObs = new MutationObserver(apply);
      voteObs.observe(vote, { attributes: true, attributeFilter: ["class", "style"] });
      _cleanup.observers.push(voteObs);
    }

    function watchForVoteBox() {
      try { domObs?.disconnect(); } catch (_) {}
      domObs = null;

      domObs = new MutationObserver(() => {
        const vote = qs("#voteBox");
        if (vote) setupHideOnVote();
      });
      domObs.observe(document.documentElement, { childList: true, subtree: true });
      _cleanup.observers.push(domObs);
    }

    async function buildModel() {
      const items = CFG.items || [];
      const cache = readCache();
      const ck = cacheKey();
      const map = (cache && cache.key === ck && cache.map && typeof cache.map === "object") ? cache.map : {};

      const outItems = [];
      const maxConc = 3;

      let idx = 0;
      async function worker() {
        while (idx < items.length) {
          const i = idx++;
          const it = items[i];
          const sym = it.stooq;

          let price = null;
          let prev = null;
          let dt = "";
          let err = "";

          const cached = map[sym] || null;

          try {
            const last = await getLastClose(sym);
            price = last.close;
            dt = last.dt || "";

            if (CFG.mode === "daily") {
              try {
                const dailyTxt = await fetchTextRobust(stooqDailyUrl(sym), { allowJina: false });
                prev = parseDailyPrevClose(dailyTxt);
              } catch (_) { prev = null; }
            } else {
              prev = (cached && Number.isFinite(cached.price)) ? cached.price : null;
            }

            map[sym] = { ts: Date.now(), price, prev: Number.isFinite(prev) ? prev : null, dt };
          } catch (e) {
            err = String(e?.message || e || "");
            if (cached && Number.isFinite(cached.price)) {
              price = cached.price;
              prev = cached.prev ?? null;
              dt = cached.dt || "";
            }
          }

          let priceText = "—";
          let changeText = "";
          let changeDir = "";

          if (Number.isFinite(price)) {
            priceText = `${currencyPrefix(it.currency)}${fmtNum(price, it.decimals)}`;

            if (Number.isFinite(prev) && prev !== 0) {
              const d = price - prev;
              const p = (d / prev) * 100;
              const sign = (d > 0) ? "+" : (d < 0) ? "−" : "";
              changeText = `${sign}${fmtNum(Math.abs(d), 2)} (${sign}${Math.abs(p).toFixed(2)}%)`;
              changeDir = (d > 0) ? "up" : (d < 0) ? "down" : "";
            }
          } else if (err && DEBUG) {
            log("quote fail", sym, err);
          }

          outItems.push(Object.assign({}, it, { priceText, changeText, changeDir, _dt: dt }));
        }
      }

      const workers = [];
      for (let k = 0; k < Math.min(maxConc, items.length); k++) workers.push(worker());
      await Promise.allSettled(workers);

      const order = new Map(items.map((x, i) => [x.stooq, i]));
      outItems.sort((a, b) => (order.get(a.stooq) ?? 0) - (order.get(b.stooq) ?? 0));

      writeCache(ck, map);

      return { clocks: CFG.clocks || [], items: outItems };
    }

    // refresh loop
    let refreshTimer = null;
    let refreshInFlight = false;

    async function refresh() {
      if (!CFG.enabled) { setVisible(false); return; }
      if (!CFG.hideOnVote) setVisible(true);

      if (refreshInFlight) return;
      refreshInFlight = true;

      try {
        const model = await buildModel();
        setTickerItems(model);
      } catch (e) {
        log("refresh error:", e?.message || e);
        setTickerItems({ clocks: CFG.clocks || [], items: [] });
      } finally {
        refreshInFlight = false;
      }
    }

    function startTimer() {
      if (refreshTimer) clearInterval(refreshTimer);
      const every = Math.max(60000, CFG.refreshMins * 60 * 1000);
      refreshTimer = setInterval(refresh, every);
      _cleanup.intervals.push(refreshTimer);
    }

    function applyCfg(nextCfg, persist = false) {
      CFG = normalizeCfg(Object.assign({}, CFG, nextCfg || {}));
      if (persist) writeCfgCompat(CFG);

      applyVisualVars();

      if (!CFG.enabled) setVisible(false);
      else {
        if (!CFG.hideOnVote) setVisible(true);
      }

      setupHideOnVote();
      startTimer();
      refresh();
      requestLayoutSync();
    }

    function onMessage(msg, fromNamespaced) {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "ECON_CFG" && msg.cfg && typeof msg.cfg === "object") {
        if (!keyOk(msg, fromNamespaced)) return;
        applyCfg(msg.cfg, true);
      }
    }

    function boot() {
      if (P.econ === "0") CFG.enabled = false;
      ensureUI();
      applyCfg(CFG, false);

      setupHideOnVote();
      watchForVoteBox();

      refresh();
      log("boot", { CFG, KEY, BUS_NS, CFG_KEY_NS });
    }

    function getCfg() { return CFG; }
    function isEnabled() { return !!CFG.enabled; }
    function isVisibleNow() {
      const root = qs("#rlcEconTicker");
      return !!(CFG.enabled && root && !root.classList.contains("hidden") && isElementVisible(root));
    }
    function getLayoutState() {
      const root = qs("#rlcEconTicker");
      const h = (root && isVisibleNow()) ? (root.getBoundingClientRect().height || 0) : 0;
      return { enabled: isEnabled(), visible: isVisibleNow(), topPx: CFG.topPx ?? 10, heightPx: h };
    }

    return { boot, onMessage, applyCfg, getCfg, isEnabled, isVisibleNow, getLayoutState };
  })();

  // ───────────────────────── Layout sync (stack always, mide alturas reales)
  function syncLayout() {
    const n = NEWS.getLayoutState ? NEWS.getLayoutState() : { visible: false, topPx: 10, heightPx: 0 };
    const e = ECON.getLayoutState ? ECON.getLayoutState() : { visible: false, topPx: 10, heightPx: 0 };

    const gap = cssPx("--rlcTickerGap", 10);

    const onN = !!n.visible;
    const onE = !!e.visible;

    const baseTop =
      (onN && onE) ? Math.min(n.topPx ?? 10, e.topPx ?? 10)
      : (onN ? (n.topPx ?? 10)
      : (onE ? (e.topPx ?? 10) : 0));

    const newsTop = baseTop;
    const econTop = baseTop + (onN ? ((n.heightPx || 34) + gap) : 0);

    const count = (onN ? 1 : 0) + (onE ? 1 : 0);
    const totalH = (count === 0) ? 0 : ((onN ? (n.heightPx || 34) : 0) + (onE ? (e.heightPx || 34) : 0) + ((count > 1) ? gap : 0));

    setVar("--rlcTickerTop", `${baseTop}px`);
    setVar("--rlcNewsTop", `${newsTop}px`);
    setVar("--rlcEconTop", `${econTop}px`);
    setVar("--rlcTickerH", `${totalH}px`);

    const nEl = qs("#rlcNewsTicker");
    if (nEl) nEl.style.top = "var(--rlcNewsTop, 10px)";
    const eEl = qs("#rlcEconTicker");
    if (eEl) eEl.style.top = "var(--rlcEconTop, 56px)";

    try {
      document.documentElement.dataset.rlcNewsOn = onN ? "1" : "0";
      document.documentElement.dataset.rlcEconOn = onE ? "1" : "0";
    } catch (_) {}
  }

  // ───────────────────────── Message routing
  function onBusMessage(msg, fromNamespaced) {
    NEWS.onMessage(msg, fromNamespaced);
    ECON.onMessage(msg, fromNamespaced);
    requestLayoutSync();
  }

  function boot() {
    ensureTickerStyles();

    NEWS.boot();
    ECON.boot();

    requestLayoutSync();

    // Bus listeners
    try {
      if (bcMain) bcMain.onmessage = (ev) => onBusMessage(ev?.data, true);
      if (bcLegacy) bcLegacy.onmessage = (ev) => onBusMessage(ev?.data, false);
    } catch (_) {}

    // postMessage fallback
    onWin("message", (ev) => {
      const msg = ev?.data;
      if (!msg || typeof msg !== "object") return;
      onBusMessage(msg, false);
    });

    // storage sync (cfg)
    onWin("storage", (e) => {
      if (!e || !e.key) return;

      if (e.key.startsWith("rlc_ticker_cfg_v1")) {
        const stored =
          readJson(KEY ? `rlc_ticker_cfg_v1:${KEY}` : "rlc_ticker_cfg_v1") ||
          readJson("rlc_ticker_cfg_v1");
        if (stored) NEWS.applyCfg(stored, false);
        requestLayoutSync();
      }

      if (e.key.startsWith("rlc_econ_cfg_v1")) {
        const stored =
          readJson(KEY ? `rlc_econ_cfg_v1:${KEY}` : "rlc_econ_cfg_v1") ||
          readJson("rlc_econ_cfg_v1");
        if (stored) ECON.applyCfg(stored, false);
        requestLayoutSync();
      }
    });

    // resize/zoom
    onWin("resize", () => requestLayoutSync(), { passive: true });

    // fonts (cuando cargan cambia ancho/alto -> recalcular)
    try {
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => requestLayoutSync()).catch(() => {});
      }
    } catch (_) {}
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
