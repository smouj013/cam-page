/* newsTicker.js — RLC Global News Ticker v1.5.0 (KEY NAMESPACE + MULTI-SOURCE + BILINGUAL EN+ES)
   ✅ KEY namespace (bus + storage + cache + translations): rlc_bus_v1:{key}, rlc_ticker_cfg_v1:{key}...
   ✅ Fuentes:
      - GDELT (sourcelang:eng) ✅
      - RSS libres: Google News (World), BBC World, DW World, The Guardian World ✅
   ✅ Bilingüe: muestra EN + ES (MyMemory) + cache local + translateMax por refresh
   ✅ Toggle:
      - ?ticker=0 (OFF)
      - ?tickerBilingual=0/1
      - ?tickerSources=gdelt,googlenews,bbc,dw,guardian
      - ?tickerTranslateMax=10
      - ?tickerSpan=1d / 12h / 30min / 1w ...
      - ?tickerDebug=1
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const LOAD_GUARD = "__RLC_NEWS_TICKER_LOADED_V150";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  const BUS_BASE = "rlc_bus_v1";
  const CFG_KEY_BASE = "rlc_ticker_cfg_v1";
  const CACHE_KEY_BASE = "rlc_ticker_cache_v1";
  const TRANS_KEY_BASE = "rlc_ticker_trans_v1";

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

  function parseParams() {
    const u = new URL(location.href);
    return {
      key: safeStr(u.searchParams.get("key") || ""),
      ticker: u.searchParams.get("ticker") ?? "",

      lang: safeStr(u.searchParams.get("tickerLang") || ""),
      speed: safeStr(u.searchParams.get("tickerSpeed") || ""),
      refresh: safeStr(u.searchParams.get("tickerRefresh") || ""),
      top: safeStr(u.searchParams.get("tickerTop") || ""),
      hideOnVote: safeStr(u.searchParams.get("tickerHideOnVote") || ""),
      span: safeStr(u.searchParams.get("tickerSpan") || ""),

      bilingual: safeStr(u.searchParams.get("tickerBilingual") || ""),
      translateMax: safeStr(u.searchParams.get("tickerTranslateMax") || ""),

      sources: safeStr(u.searchParams.get("tickerSources") || ""),
      debug: safeStr(u.searchParams.get("tickerDebug") || "")
    };
  }

  const P = parseParams();
  if (P.ticker === "0") return;

  const KEY = P.key;

  const BUS_NS = KEY ? `${BUS_BASE}:${KEY}` : BUS_BASE;
  const BUS_LEGACY = BUS_BASE;

  const CFG_KEY_NS = KEY ? `${CFG_KEY_BASE}:${KEY}` : CFG_KEY_BASE;
  const CFG_KEY_LEGACY = CFG_KEY_BASE;

  const CACHE_KEY_NS = KEY ? `${CACHE_KEY_BASE}:${KEY}` : CACHE_KEY_BASE;
  const CACHE_KEY_LEGACY = CACHE_KEY_BASE;

  const TRANS_KEY_NS = KEY ? `${TRANS_KEY_BASE}:${KEY}` : TRANS_KEY_BASE;
  const TRANS_KEY_LEGACY = TRANS_KEY_BASE;

  const bcMain = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS_NS) : null;
  const bcLegacy = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_LEGACY) : null;

  const DEBUG = (P.debug === "1" || P.debug === "true");
  const log = (...a) => { if (DEBUG) console.log("[RLC:TICKER]", ...a); };

  function keyOk(msg, isMainChannel) {
    // si no hay KEY, aceptar todo
    if (!KEY) return true;
    // si viene del canal main (namespaced), aceptar
    if (isMainChannel) return true;
    // si viene legacy/base, exigir msg.key === KEY para evitar cross-stream
    return !!(msg && msg.key === KEY);
  }

  // UI auto (solo etiqueta)
  const uiLangAuto = (navigator.language || "").toLowerCase().startsWith("es") ? "es" : "en";

  const DEFAULTS = {
    enabled: true,
    lang: "auto",           // auto|es|en
    speedPxPerSec: 55,      // 20..140
    refreshMins: 12,        // 3..60
    topPx: 10,              // 0..120
    hideOnVote: true,
    timespan: "1d",

    bilingual: true,
    translateMax: 10,

    // ✅ fuentes (mix)
    // ids: gdelt, googlenews, bbc, dw, guardian
    sources: ["gdelt", "googlenews", "bbc", "dw", "guardian"]
  };

  function cfgFromUrl() {
    const out = {};
    if (P.lang === "es" || P.lang === "en" || P.lang === "auto") out.lang = P.lang;
    if (P.speed) out.speedPxPerSec = clamp(num(P.speed, DEFAULTS.speedPxPerSec), 20, 140);
    if (P.refresh) out.refreshMins = clamp(num(P.refresh, DEFAULTS.refreshMins), 3, 60);
    if (P.top) out.topPx = clamp(num(P.top, DEFAULTS.topPx), 0, 120);
    if (P.hideOnVote === "0") out.hideOnVote = false;
    if (P.span) out.timespan = P.span;

    if (P.bilingual === "0") out.bilingual = false;
    if (P.bilingual === "1") out.bilingual = true;

    if (P.translateMax) out.translateMax = clamp(num(P.translateMax, DEFAULTS.translateMax), 0, 22);

    if (P.sources) {
      const arr = P.sources.split(",").map(s => safeStr(s).toLowerCase()).filter(Boolean);
      if (arr.length) out.sources = arr;
    }

    return out;
  }

  function normalizeTimespan(s) {
    const t = safeStr(s).toLowerCase();
    if (!t) return DEFAULTS.timespan;
    if (/^\d+(min|h|d|w|m)$/.test(t)) return t;
    return DEFAULTS.timespan;
  }

  function normalizeSources(list) {
    const allowed = new Set(["gdelt","googlenews","bbc","dw","guardian"]);
    const arr = Array.isArray(list) ? list : [];
    const out = [];
    for (const s of arr) {
      const id = safeStr(s).toLowerCase();
      if (!id || !allowed.has(id)) continue;
      if (!out.includes(id)) out.push(id);
    }
    return out.length ? out : DEFAULTS.sources.slice();
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

    c.bilingual = (c.bilingual !== false);
    c.translateMax = clamp(num(c.translateMax, DEFAULTS.translateMax), 0, 22);

    c.sources = normalizeSources(c.sources);

    return c;
  }

  function readCfgMerged() {
    // ✅ Prioridad: NS -> Legacy
    return readJson(CFG_KEY_NS) || readJson(CFG_KEY_LEGACY) || null;
  }

  function writeCfgCompat(cfg) {
    // ✅ Persistimos en NS y también en legacy/base para compat con players viejos (sin KEY)
    try { writeJson(CFG_KEY_NS, cfg); } catch (_) {}
    try { writeJson(CFG_KEY_LEGACY, cfg); } catch (_) {}
  }

  let CFG = normalizeCfg(Object.assign({}, DEFAULTS, readCfgMerged() || {}, cfgFromUrl()));

  // ───────────────────────────────────────── Fuentes
  const API = {
    maxItems: 22,
    gdelt: {
      endpoint: "https://api.gdeltproject.org/api/v2/doc/doc",
      query_en: 'international OR world OR "breaking news" OR summit OR economy OR technology OR science OR climate OR health OR markets'
    },
    rss: {
      googlenews: "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en",
      bbc: "https://feeds.bbci.co.uk/news/world/rss.xml",
      dw: "https://rss.dw.com/rdf/rss-en-world",
      guardian: "https://www.theguardian.com/world/rss"
    }
  };

  // ───────────────────────────────────────── UI / CSS
  function injectStyles() {
    if (qs("#rlcNewsTickerStyle")) return;

    const st = document.createElement("style");
    st.id = "rlcNewsTickerStyle";
    st.textContent = `
#stage.stage{ position: relative; }

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
  pointer-events: auto;
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
#rlcNewsTicker .b2{
  opacity: .72;
  font-weight: 750;
}

@keyframes rlcTickerMove{
  from{ transform: translate3d(0,0,0); }
  to{ transform: translate3d(var(--rlcTickerEnd, -1200px),0,0); }
}

@media (prefers-reduced-motion: reduce){
  #rlcNewsTicker .track{ animation: none !important; transform:none !important; }
}

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
    // ✅ preferimos stage (evita parent con pointer-events:none)
    return (
      qs("#stage") ||
      qs("#app") ||
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

  // ───────────────────────────────────────── Fetch robusto (text)
  async function fetchText(url, timeoutMs = 9000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } finally { clearTimeout(t); }
  }

  function allOrigins(url) {
    return `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
  }
  function jina(url) {
    const u = safeStr(url);
    if (u.startsWith("https://")) return `https://r.jina.ai/https://${u.slice("https://".length)}`;
    if (u.startsWith("http://"))  return `https://r.jina.ai/http://${u.slice("http://".length)}`;
    return `https://r.jina.ai/https://${u}`;
  }

  async function fetchTextRobust(url) {
    const tries = [
      () => fetchText(url),
      () => fetchText(allOrigins(url)),
      () => fetchText(jina(url))
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

  // ───────────────────────────────────────── Helpers
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
    // filtra scripts raros (si se cuela algo)
    if (/[\u0600-\u06FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(t)) return "";
    return t;
  }

  function normalizeSourceFromUrl(u) {
    const s = safeStr(u);
    if (!s) return "NEWS";
    try {
      const url = new URL(s);
      return url.hostname.replace(/^www\./i, "").toUpperCase().slice(0, 22);
    } catch (_) {
      return s.replace(/^https?:\/\//i, "").replace(/^www\./i, "").toUpperCase().slice(0, 22) || "NEWS";
    }
  }

  function normalizeSource(a) {
    const domain = safeStr(a?.domain || a?.source || "");
    const sc = safeStr(a?.sourceCountry || a?.sourcecountry || "");
    const src = domain || sc || "";
    if (!src) return "NEWS";
    const cleaned = src.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
    return cleaned.toUpperCase().slice(0, 22);
  }

  // ───────────────────────────────────────── Traducción + cache
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
    // compat legacy (solo si no hay KEY, o si quieres compartir cache)
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

  // ───────────────────────────────────────── Headlines: GDELT
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

    log("GDELT URL:", url);

    const data = await fetchJsonRobust(url);
    const errMsg = safeStr(data?.error || data?.message || data?.status || "");
    if (errMsg && /error|invalid|failed/i.test(errMsg)) throw new Error(errMsg || "GDELT error");

    const articles = Array.isArray(data?.articles) ? data.articles
                   : Array.isArray(data?.results) ? data.results
                   : Array.isArray(data?.artlist) ? data.artlist
                   : [];

    const mapped = articles.map(a => {
      const title = cleanTitle(a?.title || a?.name || "");
      const link  = safeStr(a?.url || a?.link || a?.url_mobile || "");
      if (!title || !link) return null;
      return { titleEn: title, url: link, source: normalizeSource(a) || "GDELT" };
    }).filter(Boolean);

    return uniqBy(mapped, x => (x.titleEn + "|" + x.url).toLowerCase()).slice(0, API.maxItems);
  }

  // ───────────────────────────────────────── Headlines: RSS (libres)
  function parseRssOrAtom(xmlText, fallbackSource) {
    const txt = String(xmlText || "");
    const doc = new DOMParser().parseFromString(txt, "text/xml");

    // errores de parseo XML
    const pe = doc.querySelector("parsererror");
    if (pe) return [];

    const out = [];

    // RSS <item>
    const items = Array.from(doc.querySelectorAll("item"));
    for (const it of items) {
      const t = cleanTitle(it.querySelector("title")?.textContent || "");
      let link = safeStr(it.querySelector("link")?.textContent || "");
      if (!link) link = safeStr(it.querySelector("guid")?.textContent || "");
      if (!t || !link) continue;

      const srcNode = it.querySelector("source");
      const srcText = safeStr(srcNode?.textContent || "");
      const srcUrl = safeStr(srcNode?.getAttribute("url") || "");
      const source = (srcText || (srcUrl ? normalizeSourceFromUrl(srcUrl) : "")) || fallbackSource || "RSS";

      out.push({ titleEn: t, url: link, source });
      if (out.length >= API.maxItems) break;
    }

    // Atom <entry>
    if (!out.length) {
      const entries = Array.from(doc.querySelectorAll("entry"));
      for (const e of entries) {
        const t = cleanTitle(e.querySelector("title")?.textContent || "");
        const linkEl = e.querySelector('link[rel="alternate"]') || e.querySelector("link");
        const link = safeStr(linkEl?.getAttribute("href") || linkEl?.textContent || "");
        if (!t || !link) continue;
        out.push({ titleEn: t, url: link, source: fallbackSource || "ATOM" });
        if (out.length >= API.maxItems) break;
      }
    }

    return out;
  }

  async function getHeadlinesFromRss(id, url) {
    const xml = await fetchTextRobust(url);
    const source = ({
      googlenews: "GNEWS",
      bbc: "BBC",
      dw: "DW",
      guardian: "GUARDIAN"
    }[id] || normalizeSourceFromUrl(url));

    const items = parseRssOrAtom(xml, source);
    // dedupe por link
    return uniqBy(items, x => safeStr(x.url).toLowerCase()).slice(0, API.maxItems);
  }

  async function getHeadlinesEnMixed() {
    const srcs = CFG.sources || DEFAULTS.sources;

    const tasks = [];
    for (const id of srcs) {
      if (id === "gdelt") {
        tasks.push((async () => ({ id, items: await getHeadlinesFromGdelt() }))());
      } else if (API.rss[id]) {
        tasks.push((async () => ({ id, items: await getHeadlinesFromRss(id, API.rss[id]) }))());
      }
    }

    const res = await Promise.allSettled(tasks);
    const chunks = [];

    for (const r of res) {
      if (r.status !== "fulfilled") continue;
      const got = r.value?.items;
      if (Array.isArray(got) && got.length) chunks.push(got);
    }

    // interleave para mezclar fuentes (y que no sea todo GDELT)
    const merged = [];
    let guard = 0;
    while (merged.length < API.maxItems && guard < 500) {
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

  // ───────────────────────────────────────── Render
  function uiLangEffective() {
    return (CFG.lang === "auto") ? uiLangAuto : CFG.lang;
  }

  function setLabel(root) {
    const label = qs("#rlcNewsTickerLabel", root);
    if (!label) return;

    if (CFG.bilingual) label.textContent = "NEWS · NOTICIAS";
    else label.textContent = (uiLangEffective() === "en") ? "NEWS" : "NOTICIAS";
  }

  function buildItemsDOM(items) {
    const uiLang = uiLangEffective();
    const list = (Array.isArray(items) && items.length) ? items : [
      {
        titleEn: (uiLang === "es") ? "No hay titulares ahora mismo… reintentando." : "No headlines right now… retrying.",
        titleEs: "",
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

      if (CFG.bilingual) {
        const en = clampLen(it.titleEn || "", 110);
        const es = clampLen(it.titleEs || "", 110);
        title.textContent = es ? `${en} — ${es}` : en;
        if (es) title.classList.add("b2");
      } else {
        title.textContent = it.titleEn || "";
      }

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

    setLabel(root);

    root.style.setProperty("--rlcTickerTop", `${CFG.topPx}px`);
    document.documentElement.style.setProperty("--rlcTickerTop", `${CFG.topPx}px`);

    track.style.animation = "none";
    seg1.innerHTML = "";
    seg2.innerHTML = "";

    seg1.appendChild(buildItemsDOM(items));

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

  // ───────────────────────────────────────── Hide on vote
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
      const voteVisible = isElementVisible(vote);
      setVisible(!voteVisible);
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
      if (vote) setupHideOnVote();
    });
    domObs.observe(document.documentElement, { childList: true, subtree: true });
  }

  // ───────────────────────────────────────── Cache headlines (namespaced)
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
    // legacy solo si no hay KEY (evita pisar multi-stream)
    if (!KEY) writeJson(CACHE_KEY_LEGACY, { ts: Date.now(), key, items });
  }

  // ───────────────────────────────────────── Refresh loop
  let refreshTimer = null;
  let refreshInFlight = false;

  async function refresh(force = false) {
    if (!CFG.enabled) { setVisible(false); return; }
    setVisible(true);

    const key = cacheKey();

    if (!force) {
      const cache = readCache();
      const maxAge = Math.max(2, CFG.refreshMins) * 60 * 1000;
      if (cache && cache.key === key && (Date.now() - (cache.ts || 0) <= maxAge)) {
        log("cache hit", { key, KEY });
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
      writeCache(key, bi);
    } catch (e) {
      log("refresh error:", e?.message || e);
      const cache = readCache();
      if (cache?.items?.length) setTickerItems(cache.items);
      else setTickerItems([]);
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
    if (persist) writeCfgCompat(CFG);

    if (!CFG.enabled) setVisible(false);
    else setVisible(true);

    setupHideOnVote();
    startTimer();
    refresh(true);
  }

  function onBusMessage(msg, isMain) {
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "TICKER_CFG" && msg.cfg && typeof msg.cfg === "object") {
      if (!keyOk(msg, isMain)) return;
      applyCfg(msg.cfg, true);
    }
  }

  function boot() {
    ensureUI();
    applyCfg(CFG, false);

    // BroadcastChannel (main + legacy)
    try {
      if (bcMain) bcMain.onmessage = (ev) => onBusMessage(ev?.data, true);
      if (bcLegacy) bcLegacy.onmessage = (ev) => onBusMessage(ev?.data, false);
    } catch (_) {}

    // postMessage fallback (si control lo manda)
    window.addEventListener("message", (ev) => {
      const msg = ev?.data;
      if (!msg || typeof msg !== "object") return;
      onBusMessage(msg, false);
    });

    // storage event (otra pestaña)
    window.addEventListener("storage", (e) => {
      if (!e || !e.key) return;

      // si hay KEY, reaccionar a ns y a legacy
      if (e.key === CFG_KEY_NS || e.key === CFG_KEY_LEGACY) {
        const stored = readCfgMerged();
        if (stored) applyCfg(stored, false);
      }
    });

    setupHideOnVote();
    watchForVoteBox();

    // pinta rápido si hay cache
    const cache = readCache();
    if (cache?.items?.length) setTickerItems(cache.items);

    refresh(false);
    log("boot", { CFG, KEY, BUS_NS, CFG_KEY_NS });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
