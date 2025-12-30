/* newsTicker.js — RLC Global News Ticker v1.3.0 (JSONP FALLBACK + KEY-NAMESPACE + LATEST-FIRST)
   ✅ Si fetch falla (CORS/OBS/SW), usa JSONP a GDELT => entran noticias
   ✅ Fallback de queries + sort DateDesc para “última hora”
   ✅ timespan configurable (default 12h)
   ✅ HideOnVote robusto
   ✅ Debug: ?tickerDebug=1
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const LOAD_GUARD = "__RLC_NEWS_TICKER_LOADED_V130";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  const BUS_BASE = "rlc_bus_v1";
  const CFG_KEY_BASE = "rlc_ticker_cfg_v1";
  const CACHE_KEY_BASE = "rlc_ticker_cache_v1"; // { ts, lang, items, timespan }

  const qs = (s, r = document) => r.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const safeStr = (v) => (typeof v === "string") ? v.trim() : "";
  const num = (v, fb) => {
    const n = parseFloat(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fb;
  };

  function parseParams() {
    const u = new URL(location.href);
    return {
      ticker: u.searchParams.get("ticker") ?? "",
      key: safeStr(u.searchParams.get("key") || ""),
      lang: safeStr(u.searchParams.get("tickerLang") || ""),
      speed: safeStr(u.searchParams.get("tickerSpeed") || ""),
      refresh: safeStr(u.searchParams.get("tickerRefresh") || ""),
      top: safeStr(u.searchParams.get("tickerTop") || ""),
      hideOnVote: safeStr(u.searchParams.get("tickerHideOnVote") || ""),
      span: safeStr(u.searchParams.get("tickerSpan") || ""),     // 12h, 1d, 3d...
      debug: safeStr(u.searchParams.get("tickerDebug") || "")
    };
  }

  const P = parseParams();
  if (P.ticker === "0") return;

  const KEY = String(P.key || "").trim();

  const BUS = KEY ? `${BUS_BASE}:${KEY}` : BUS_BASE;
  const BUS_LEGACY = BUS_BASE;

  const CFG_KEY = KEY ? `${CFG_KEY_BASE}:${KEY}` : CFG_KEY_BASE;
  const CFG_KEY_LEGACY = CFG_KEY_BASE;

  const CACHE_KEY = KEY ? `${CACHE_KEY_BASE}:${KEY}` : CACHE_KEY_BASE;
  const CACHE_KEY_LEGACY = CACHE_KEY_BASE;

  const bcMain = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS) : null;
  const bcLegacy = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_LEGACY) : null;

  function keyOk(msg, isMainChannel) {
    if (!KEY) return true;
    if (isMainChannel) return true;          // en canal namespaced aceptamos aunque msg no traiga key
    return (msg && msg.key === KEY);         // en legacy exige key
  }

  const DEBUG = (P.debug === "1" || P.debug === "true");
  const log = (...a) => { if (DEBUG) console.log("[RLC:TICKER]", ...a); };

  const langAuto = (navigator.language || "").toLowerCase().startsWith("es") ? "es" : "en";

  const DEFAULTS = {
    enabled: true,
    lang: "auto",           // auto|es|en
    speedPxPerSec: 55,      // 20..140
    refreshMins: 12,        // 3..60
    topPx: 10,              // 0..120
    hideOnVote: true,
    timespan: "12h"         // 🔥 “última hora” (mejor que 1d)
  };

  function readJsonAny(keys) {
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

  function writeJson(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch (_) {}
  }

  function cfgFromUrl() {
    const out = {};
    if (P.lang === "es" || P.lang === "en" || P.lang === "auto") out.lang = P.lang;
    if (P.speed) out.speedPxPerSec = clamp(num(P.speed, DEFAULTS.speedPxPerSec), 20, 140);
    if (P.refresh) out.refreshMins = clamp(num(P.refresh, DEFAULTS.refreshMins), 3, 60);
    if (P.top) out.topPx = clamp(num(P.top, DEFAULTS.topPx), 0, 120);
    if (P.hideOnVote === "0") out.hideOnVote = false;
    if (P.span) out.timespan = P.span;
    return out;
  }

  function normalizeTimespan(s) {
    const t = safeStr(s).toLowerCase();
    if (!t) return DEFAULTS.timespan;
    if (/^\d+(min|h|d|w|m)$/.test(t)) return t;
    return DEFAULTS.timespan;
  }

  function normalizeCfg(inCfg) {
    const c = Object.assign({}, inCfg || {});
    c.enabled = (c.enabled !== false);
    c.lang = (c.lang === "es" || c.lang === "en" || c.lang === "auto") ? c.lang : "auto";
    c.speedPxPerSec = clamp(num(c.speedPxPerSec, DEFAULTS.speedPxPerSec), 20, 140);
    c.refreshMins = clamp(num(c.refreshMins, DEFAULTS.refreshMins), 3, 60);
    c.topPx = clamp(num(c.topPx, DEFAULTS.topPx), 0, 120);
    c.hideOnVote = (c.hideOnVote !== false);
    c.timespan = normalizeTimespan(c.timespan);
    return c;
  }

  // Prioridad: defaults <- localStorage(namespaced) <- localStorage(legacy) <- URL
  let CFG = normalizeCfg(Object.assign(
    {},
    DEFAULTS,
    readJsonAny([CFG_KEY, CFG_KEY_LEGACY]) || {},
    cfgFromUrl()
  ));

  // Persistencia suave para que quede consistente
  try {
    writeJson(CFG_KEY, CFG);
    writeJson(CFG_KEY_LEGACY, CFG);
  } catch (_) {}

  const API = {
    gdelt: {
      endpoint: "https://api.gdeltproject.org/api/v2/doc/doc",
      // queries “safe”
      query_es: 'mundo OR internacional OR "ultima hora" OR cumbre OR economia OR tecnologia OR ciencia OR clima OR salud OR mercados',
      query_en: 'world OR international OR "breaking news" OR summit OR economy OR technology OR science OR climate OR health OR markets'
    },
    maxItems: 22
  };

  // ───────────────────────────────────────── UI / CSS
  function injectStyles() {
    if (qs("#rlcNewsTickerStyle")) return;

    const st = document.createElement("style");
    st.id = "rlcNewsTickerStyle";
    st.textContent = `
#stage.stage{ position: relative; }

/* Ticker */
#rlcNewsTicker{
  position: absolute;
  left: 10px;
  right: 10px;
  top: var(--rlcTickerTop, 10px);
  height: 34px;
  z-index: 999999;
  display:flex;
  align-items:center;
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(10,14,20,.88), rgba(8,10,14,.78));
  border: 1px solid rgba(255,255,255,.10);
  box-shadow: 0 14px 40px rgba(0,0,0,.45);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  overflow: hidden;
}
#rlcNewsTicker.hidden{ display:none !important; }

#rlcNewsTicker .label{
  flex: 0 0 auto;
  height: 100%;
  display:flex;
  align-items:center;
  gap: 8px;
  padding: 0 12px;
  border-right: 1px solid rgba(255,255,255,.10);
  background: linear-gradient(90deg, rgba(255,55,95,.20), rgba(255,55,95,0));
  font: 900 12px/1 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: rgba(255,255,255,.92);
  user-select:none;
  white-space: nowrap;
}
#rlcNewsTicker .dot{
  width: 8px; height: 8px; border-radius: 999px;
  background: #ff375f;
  box-shadow: 0 0 0 3px rgba(255,55,95,.18), 0 0 16px rgba(255,55,95,.45);
}

#rlcNewsTicker .viewport{
  position: relative;
  overflow:hidden;
  height: 100%;
  flex: 1 1 auto;
  display:flex;
  align-items:center;
}
#rlcNewsTicker .fadeL,
#rlcNewsTicker .fadeR{
  position:absolute; top:0; bottom:0; width: 46px;
  z-index: 2; pointer-events:none;
}
#rlcNewsTicker .fadeL{ left:0; background: linear-gradient(90deg, rgba(8,10,14,1), rgba(8,10,14,0)); }
#rlcNewsTicker .fadeR{ right:0; background: linear-gradient(270deg, rgba(8,10,14,1), rgba(8,10,14,0)); }

#rlcNewsTicker .track{
  position: relative;
  z-index: 1;
  display:flex;
  align-items:center;
  gap: 18px;
  white-space: nowrap;
  will-change: transform;
  transform: translate3d(0,0,0);
  animation: rlcTickerMove var(--rlcTickerDur, 60s) linear infinite;
}
#rlcNewsTicker:hover .track{ animation-play-state: paused; }

#rlcNewsTicker .seg{
  display:flex;
  align-items:center;
  gap: 18px;
  white-space: nowrap;
}
#rlcNewsTicker .item{
  display:inline-flex;
  align-items:center;
  gap: 10px;
  font: 800 12px/1.1 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
  color: rgba(255,255,255,.88);
  text-decoration: none;
  opacity: .92;
}
#rlcNewsTicker .item:hover{ opacity: 1; text-decoration: underline; }
#rlcNewsTicker .sep{
  width: 5px; height: 5px; border-radius:999px;
  background: rgba(255,255,255,.28);
  box-shadow: 0 0 0 3px rgba(255,255,255,.06);
}
#rlcNewsTicker .src{
  font-weight: 950;
  color: rgba(255,255,255,.70);
  letter-spacing: .02em;
}

@keyframes rlcTickerMove{
  from{ transform: translate3d(0,0,0); }
  to{ transform: translate3d(var(--rlcTickerEnd, -1200px),0,0); }
}

@media (prefers-reduced-motion: reduce){
  #rlcNewsTicker .track{ animation: none !important; transform:none !important; }
}

/* Empuja overlays de arriba para que queden por debajo del ticker */
:root{
  --rlcTickerH: 34px;
  --rlcTickerGap: 10px;
}
#voteBox,
.vote{
  top: calc(max(12px, env(safe-area-inset-top)) + var(--rlcTickerTop, 10px) + var(--rlcTickerH, 34px) + var(--rlcTickerGap, 10px)) !important;
}
#adsBox, #adBox, #adsNotice, #adNotice, #rlcAdsBox, #rlcAdBox, #rlcAdsNotice, #rlcAdNotice, #rlcAdsOverlay, #rlcAdOverlay{
  top: calc(max(12px, env(safe-area-inset-top)) + var(--rlcTickerTop, 10px) + var(--rlcTickerH, 34px) + var(--rlcTickerGap, 10px)) !important;
}
`.trim();

    document.head.appendChild(st);
  }

  function pickHost() {
    return (
      qs("#stage .layer.layer-ui") ||
      qs("#stage .layer-ui") ||
      qs("#stage") ||
      document.body
    );
  }

  function ensureUI() {
    injectStyles();

    let root = qs("#rlcNewsTicker");
    if (root) return root;

    const host = pickHost();

    root = document.createElement("div");
    root.id = "rlcNewsTicker";
    root.setAttribute("aria-label", "Ticker de noticias");
    root.innerHTML = `
      <div class="label" title="Noticias internacionales">
        <span class="dot" aria-hidden="true"></span>
        <span id="rlcNewsTickerLabel"></span>
      </div>
      <div class="viewport">
        <div class="fadeL" aria-hidden="true"></div>
        <div class="fadeR" aria-hidden="true"></div>
        <div class="track" id="rlcNewsTickerTrack" aria-live="polite">
          <div class="seg" id="rlcNewsTickerSeg"></div>
          <div class="seg" id="rlcNewsTickerSeg2" aria-hidden="true"></div>
        </div>
      </div>
    `.trim();

    host.insertBefore(root, host.firstChild);
    return root;
  }

  function setVisible(on) {
    const root = ensureUI();
    if (!root) return;

    root.classList.toggle("hidden", !on);

    if (!on) {
      root.style.setProperty("--rlcTickerH", `0px`);
      document.documentElement.style.setProperty("--rlcTickerH", `0px`);
    } else {
      root.style.setProperty("--rlcTickerH", `34px`);
      document.documentElement.style.setProperty("--rlcTickerH", `34px`);
    }
  }

  // ───────────────────────────────────────── Fetch + JSONP fallback
  async function fetchText(url, timeoutMs = 9000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {
        signal: ctrl.signal,
        cache: "no-store",
        headers: { "accept": "application/json,text/plain,*/*" }
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } finally { clearTimeout(t); }
  }

  function allOrigins(url) {
    return `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
  }

  function tryParseJson(txt) {
    const s = safeStr(txt);
    if (!s) return null;

    // JSONP: callback(...)
    const m = s.match(/^[a-zA-Z_$][\w$]*\(([\s\S]+)\)\s*;?\s*$/);
    if (m && m[1]) {
      try { return JSON.parse(m[1]); } catch (_) {}
    }

    try { return JSON.parse(s); } catch (_) {}

    const a = s.indexOf("{");
    const b = s.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try { return JSON.parse(s.slice(a, b + 1)); } catch (_) {}
    }
    return null;
  }

  async function fetchJsonRobust(url) {
    const tries = [
      () => fetchText(url),
      () => fetchText(allOrigins(url))
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

  function jsonp(url, timeoutMs = 9500) {
    return new Promise((resolve, reject) => {
      const cb = `__rlc_gdelt_cb_${Math.random().toString(16).slice(2)}_${Date.now()}`;
      const u = new URL(url);

      // GDELT JSONP
      u.searchParams.set("format", "jsonp");
      u.searchParams.set("callback", cb);

      let done = false;
      const cleanup = () => {
        try { delete g[cb]; } catch (_) { g[cb] = undefined; }
        try { script.remove(); } catch (_) {}
      };

      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error("JSONP timeout"));
      }, timeoutMs);

      g[cb] = (data) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        cleanup();
        resolve(data);
      };

      const script = document.createElement("script");
      script.async = true;
      script.src = u.toString();
      script.onerror = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        cleanup();
        reject(new Error("JSONP error"));
      };

      document.head.appendChild(script);
    });
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

  function cleanTitle(s) {
    let t = safeStr(s).replace(/\s+/g, " ").trim();
    if (t.length < 10) return "";
    if (t.length > 160) t = t.slice(0, 157).trim() + "…";
    return t;
  }

  function normalizeSource(a) {
    const domain = safeStr(a?.domain || a?.source || a?.sourceDomain || "");
    const sc = safeStr(a?.sourceCountry || a?.sourcecountry || "");
    const src = domain || sc || "";
    if (!src) return "NEWS";
    const cleaned = src.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
    return cleaned.toUpperCase().slice(0, 22);
  }

  function extractArticles(data) {
    if (!data || typeof data !== "object") return [];
    if (Array.isArray(data.articles)) return data.articles;
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.artlist)) return data.artlist;
    if (Array.isArray(data.data)) return data.data;
    return [];
  }

  function buildGdeltUrl(q, sort) {
    // sort recomendado para “última hora”: DateDesc
    return (
      `${API.gdelt.endpoint}` +
      `?query=${encodeURIComponent(q)}` +
      `&mode=ArtList` +
      `&format=json` +
      `&sort=${encodeURIComponent(sort)}` +
      `&timespan=${encodeURIComponent(CFG.timespan)}` +
      `&maxrecords=${encodeURIComponent(String(API.maxItems * 2))}`
    );
  }

  async function getHeadlines() {
    const lang = (CFG.lang === "auto") ? langAuto : CFG.lang;

    // probamos varias queries (si alguna devuelve 0)
    const queries = (lang === "es")
      ? [
          API.gdelt.query_es,
          'mundo OR internacional OR guerra OR economia OR tecnologia OR ciencia OR clima',
          'ultima hora OR mundo OR internacional'
        ]
      : [
          API.gdelt.query_en,
          'world OR international OR war OR economy OR technology OR science OR climate',
          'breaking news OR world OR international'
        ];

    const sorts = ["DateDesc", "HybridRel"]; // DateDesc primero para “ahora”

    let lastErr = null;

    for (const q of queries) {
      for (const sort of sorts) {
        const url = buildGdeltUrl(q, sort);
        try {
          log("GDELT TRY:", { sort, q, url, timespan: CFG.timespan });

          // 1) fetch directo / allorigins
          let data = null;
          try { data = await fetchJsonRobust(url); }
          catch (e) {
            lastErr = e;
            log("fetch fail => JSONP fallback:", e?.message || e);
            // 2) JSONP fallback
            data = await jsonp(url);
          }

          const errMsg = safeStr(data?.error || data?.message || data?.status || "");
          if (errMsg && /error|invalid|failed/i.test(errMsg)) throw new Error(errMsg || "GDELT error");

          const articles = extractArticles(data);
          const mapped = articles.map(a => {
            const title = cleanTitle(a?.title || a?.name || a?.headline || "");
            const link  = safeStr(a?.url || a?.link || a?.url_mobile || a?.urlMobile || "");
            if (!title || !link) return null;
            return { title, url: link, source: normalizeSource(a) };
          }).filter(Boolean);

          const uniq = uniqBy(mapped, x => (x.title + "|" + x.url).toLowerCase()).slice(0, API.maxItems);
          log("items:", uniq.length);

          if (uniq.length >= 3) return uniq; // ✅ suficiente
          // si viene casi vacío, seguimos probando
        } catch (e) {
          lastErr = e;
          log("try error:", e?.message || e);
        }
      }
    }

    throw lastErr || new Error("No headlines");
  }

  // ───────────────────────────────────────── Render
  function setLabel(root, lang) {
    const label = qs("#rlcNewsTickerLabel", root);
    if (label) label.textContent = (lang === "en") ? "NEWS" : "NOTICIAS";
  }

  function buildItemsDOM(items, lang) {
    const list = (Array.isArray(items) && items.length) ? items : [
      {
        title: (lang === "es")
          ? "Sin noticias ahora mismo (reintentando)…"
          : "No headlines right now (retrying)…",
        url: "#",
        source: "RLC"
      }
    ];

    const frag = document.createDocumentFragment();

    for (const it of list) {
      const a = document.createElement("a");
      a.className = "item";
      a.href = it.url || "#";
      if (a.href !== "#") {
        a.target = "_blank";
        a.rel = "noreferrer noopener";
      } else {
        a.addEventListener("click", (e) => e.preventDefault());
      }

      const sep = document.createElement("span");
      sep.className = "sep";
      sep.setAttribute("aria-hidden", "true");

      const title = document.createElement("span");
      title.className = "t";
      title.textContent = it.title;

      const src = document.createElement("span");
      src.className = "src";
      src.textContent = it.source || "NEWS";

      a.appendChild(sep);
      a.appendChild(title);
      a.appendChild(src);

      frag.appendChild(a);
    }

    return frag;
  }

  function setTickerItems(items) {
    const root = ensureUI();
    const track = qs("#rlcNewsTickerTrack", root);
    const seg1 = qs("#rlcNewsTickerSeg", root);
    const seg2 = qs("#rlcNewsTickerSeg2", root);
    const viewport = track ? track.parentElement : null;

    if (!root || !track || !seg1 || !seg2) return;

    const lang = (CFG.lang === "auto") ? langAuto : CFG.lang;
    setLabel(root, lang);

    root.style.setProperty("--rlcTickerTop", `${CFG.topPx}px`);
    document.documentElement.style.setProperty("--rlcTickerTop", `${CFG.topPx}px`);

    track.style.animation = "none";
    seg1.innerHTML = "";
    seg2.innerHTML = "";

    const frag = buildItemsDOM(items, lang);
    seg1.appendChild(frag);

    const vw = viewport ? (viewport.clientWidth || 900) : 900;

    let guard = 0;
    while ((seg1.scrollWidth || 0) < vw * 1.2 && guard < 8) {
      seg1.innerHTML += seg1.innerHTML;
      guard++;
    }

    seg2.innerHTML = seg1.innerHTML;

    const segW = Math.max(1200, seg1.scrollWidth || 1200);
    const endPx = -segW;
    const durSec = Math.max(18, Math.min(220, Math.abs(endPx) / CFG.speedPxPerSec));

    track.style.setProperty("--rlcTickerEnd", `${endPx}px`);
    track.style.setProperty("--rlcTickerDur", `${durSec}s`);

    requestAnimationFrame(() => { track.style.animation = ""; });
  }

  // ───────────────────────────────────────── Hide on vote (robusto)
  let voteObs = null;
  let domObs = null;

  function isElementVisible(el) {
    if (!el) return false;
    const cs = window.getComputedStyle(el);
    if (!cs) return false;
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity || "1") <= 0) return false;
    const r = el.getBoundingClientRect();
    return (r.width > 0 && r.height > 0);
  }

  function setupHideOnVote() {
    try { voteObs?.disconnect(); } catch (_) {}
    voteObs = null;

    const vote = qs("#voteBox");
    if (!vote) return;

    const apply = () => {
      if (!CFG.enabled) { setVisible(false); return; }
      if (!CFG.hideOnVote) { setVisible(true); return; }
      setVisible(!isElementVisible(vote));
    };

    apply();

    voteObs = new MutationObserver(apply);
    voteObs.observe(vote, { attributes: true, attributeFilter: ["class", "style"] });
  }

  function watchForVoteBox() {
    try { domObs?.disconnect(); } catch (_) {}
    domObs = null;

    domObs = new MutationObserver(() => {
      const vote = qs("#voteBox");
      if (vote) {
        log("voteBox detected");
        setupHideOnVote();
      }
    });

    domObs.observe(document.documentElement, { childList: true, subtree: true });
  }

  // ───────────────────────────────────────── Cache
  function readCacheAny() {
    return readJsonAny([CACHE_KEY, CACHE_KEY_LEGACY]);
  }

  function writeCache(lang, items) {
    const obj = { ts: Date.now(), lang, items, timespan: CFG.timespan };
    try { writeJson(CACHE_KEY, obj); } catch (_) {}
    try { writeJson(CACHE_KEY_LEGACY, obj); } catch (_) {}
  }

  // ───────────────────────────────────────── Refresh loop
  let refreshTimer = null;
  let refreshInFlight = false;

  async function refresh(force = false) {
    if (!CFG.enabled) { setVisible(false); return; }
    setVisible(true);

    const lang = (CFG.lang === "auto") ? langAuto : CFG.lang;

    if (!force) {
      const cache = readCacheAny();
      const maxAge = Math.max(2, CFG.refreshMins) * 60 * 1000;
      if (cache && cache.lang === lang && cache.timespan === CFG.timespan && (Date.now() - (cache.ts || 0) <= maxAge)) {
        log("cache hit");
        setTickerItems(cache.items);
        return;
      }
    }

    if (refreshInFlight) return;
    refreshInFlight = true;

    try {
      const items = await getHeadlines();
      setTickerItems(items);
      writeCache(lang, items);
    } catch (e) {
      log("refresh error:", e?.message || e);
      const cache = readCacheAny();
      if (cache?.items?.length) setTickerItems(cache.items);
      else setTickerItems([]); // mostrará “retrying…”
    } finally {
      refreshInFlight = false;
    }
  }

  function startTimer() {
    if (refreshTimer) clearInterval(refreshTimer);
    const every = Math.max(180000, CFG.refreshMins * 60 * 1000);
    refreshTimer = setInterval(() => refresh(false), every);
  }

  function applyCfg(nextCfg, persist = false) {
    CFG = normalizeCfg(Object.assign({}, CFG, nextCfg || {}));
    if (persist) {
      try { writeJson(CFG_KEY, CFG); } catch (_) {}
      try { writeJson(CFG_KEY_LEGACY, CFG); } catch (_) {}
    }

    setVisible(!!CFG.enabled);
    setupHideOnVote();
    startTimer();
    refresh(true);
  }

  function boot() {
    ensureUI();
    applyCfg(CFG, false);

    // Config desde Control Room (main + legacy)
    try {
      const onMsg = (msg, isMain) => {
        if (!msg || typeof msg !== "object") return;
        if (msg.type === "TICKER_CFG" && msg.cfg && typeof msg.cfg === "object") {
          if (!keyOk(msg, isMain)) return;
          applyCfg(msg.cfg, true);
        }
      };

      if (bcMain) bcMain.addEventListener("message", (ev) => onMsg(ev?.data, true));
      if (bcLegacy) bcLegacy.addEventListener("message", (ev) => onMsg(ev?.data, false));
    } catch (_) {}

    // storage event (otra pestaña)
    window.addEventListener("storage", (e) => {
      if (!e) return;
      if (e.key === CFG_KEY || e.key === CFG_KEY_LEGACY) {
        const stored = readJsonAny([CFG_KEY, CFG_KEY_LEGACY]);
        if (stored) applyCfg(stored, false);
      }
    });

    setupHideOnVote();
    watchForVoteBox();

    // primera carga: pinta cache rápido
    const cache = readCacheAny();
    if (cache?.items?.length) setTickerItems(cache.items);

    refresh(false);

    log("boot cfg:", CFG, "KEY:", KEY || "(none)");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
