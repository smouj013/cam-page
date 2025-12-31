/* newsTicker.js — RLC Global News Ticker v1.3.0 (FIX HEADLINES + RSS FALLBACK + KEY-NAMESPACE)
   ✅ FIX: timespan default -> 24h (más “última hora”)
   ✅ FIX: sort default -> datedesc (más reciente)
   ✅ KEY namespace (BUS/CFG/CACHE por :key) + compat legacy sin cross-talk
   ✅ Fallback si GDELT falla o devuelve 0: RSS (via r.jina.ai) => siempre hay titulares
   ✅ HideOnVote robusto (visibilidad real)
   ✅ Debug opcional: ?tickerDebug=1
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const LOAD_GUARD = "__RLC_NEWS_TICKER_LOADED_V130";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  const BUS_BASE = "rlc_bus_v1";
  const CFG_KEY_BASE = "rlc_ticker_cfg_v1";
  const CACHE_KEY_BASE = "rlc_ticker_cache_v1";

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
      // enable/disable
      ticker: u.searchParams.get("ticker") ?? "",
      // config via url
      lang: safeStr(u.searchParams.get("tickerLang") || ""),
      speed: safeStr(u.searchParams.get("tickerSpeed") || ""),
      refresh: safeStr(u.searchParams.get("tickerRefresh") || ""),
      top: safeStr(u.searchParams.get("tickerTop") || ""),
      hideOnVote: safeStr(u.searchParams.get("tickerHideOnVote") || ""),
      span: safeStr(u.searchParams.get("tickerSpan") || ""), // ej: 1h, 24h, 1week, 6months, 3d...
      sort: safeStr(u.searchParams.get("tickerSort") || ""), // datedesc|hybridrel
      debug: safeStr(u.searchParams.get("tickerDebug") || ""),
      key: safeStr(u.searchParams.get("key") || "")
    };
  }

  const P = parseParams();
  if (P.ticker === "0") return;

  const DEBUG = (P.debug === "1" || P.debug === "true");
  const log = (...a) => { if (DEBUG) console.log("[RLC:TICKER]", ...a); };

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
    if (isMainChannel) return true;      // namespaced ya está aislado
    return (msg && msg.key === KEY);     // legacy exige key
  }

  const langAuto = (navigator.language || "").toLowerCase().startsWith("es") ? "es" : "en";

  const DEFAULTS = {
    enabled: true,
    lang: "auto",         // auto|es|en
    speedPxPerSec: 55,    // 20..140
    refreshMins: 12,      // 3..60
    topPx: 10,            // 0..120
    hideOnVote: true,
    timespan: "24h",      // ✅ FIX: antes 1d
    sort: "datedesc"      // ✅ FIX: “última hora”
  };

  function readJsonAny(keyA, keyB) {
    try { const raw = localStorage.getItem(keyA); if (raw) return JSON.parse(raw); } catch (_) {}
    try { const raw = localStorage.getItem(keyB); if (raw) return JSON.parse(raw); } catch (_) {}
    return null;
  }
  function writeJsonBoth(keyA, keyB, obj) {
    try { localStorage.setItem(keyA, JSON.stringify(obj)); } catch (_) {}
    try { localStorage.setItem(keyB, JSON.stringify(obj)); } catch (_) {}
  }

  function cfgFromUrl() {
    const out = {};
    if (P.lang === "es" || P.lang === "en" || P.lang === "auto") out.lang = P.lang;
    if (P.speed) out.speedPxPerSec = clamp(num(P.speed, DEFAULTS.speedPxPerSec), 20, 140);
    if (P.refresh) out.refreshMins = clamp(num(P.refresh, DEFAULTS.refreshMins), 3, 60);
    if (P.top) out.topPx = clamp(num(P.top, DEFAULTS.topPx), 0, 120);
    if (P.hideOnVote === "0") out.hideOnVote = false;
    if (P.span) out.timespan = P.span;
    if (P.sort) out.sort = P.sort;
    return out;
  }

  // Convierte formatos “cortos” a lo que suele tragar mejor GDELT
  function normalizeTimespan(s) {
    const t = safeStr(s).toLowerCase();
    if (!t) return DEFAULTS.timespan;

    // GDELT examples: 1h, 1week, 6months (y también suele aceptar 24h)
    if (/^\d+h$/.test(t)) return t;
    if (/^\d+min$/.test(t)) return t;
    if (/^\d+week(s)?$/.test(t)) return t.replace(/weeks$/, "week");
    if (/^\d+month(s)?$/.test(t)) return t.replace(/months$/, "month");

    // Atajos comunes del panel/usuarios:
    // 1d -> 24h, 2d -> 48h...
    const mD = t.match(/^(\d+)d$/);
    if (mD) {
      const days = clamp(parseInt(mD[1], 10) || 1, 1, 14);
      return String(days * 24) + "h";
    }
    // 1w -> 1week, 2w -> 2week (GDELT usa “1week”)
    const mW = t.match(/^(\d+)w$/);
    if (mW) {
      const w = clamp(parseInt(mW[1], 10) || 1, 1, 8);
      return String(w) + "week";
    }
    // 1m -> 1month (si alguien usa m como months)
    const mM = t.match(/^(\d+)m$/);
    if (mM) {
      const mo = clamp(parseInt(mM[1], 10) || 1, 1, 12);
      return String(mo) + "month";
    }

    return DEFAULTS.timespan;
  }

  function normalizeSort(s) {
    const t = safeStr(s).toLowerCase();
    if (t === "hybridrel" || t === "hybrid") return "hybridrel";
    return "datedesc";
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
    c.sort = normalizeSort(c.sort);
    return c;
  }

  // Prioridad: defaults <- localStorage(keyed/legacy) <- URL
  let CFG = normalizeCfg(Object.assign(
    {},
    DEFAULTS,
    readJsonAny(CFG_KEY, CFG_KEY_LEGACY) || {},
    cfgFromUrl()
  ));

  const API = {
    gdelt: {
      endpoint: "https://api.gdeltproject.org/api/v2/doc/doc",
      // queries “safe” (sin acentos para evitar proxies raros)
      query_es: 'internacional OR mundo OR "ultima hora" OR cumbre OR economia OR tecnologia OR ciencia OR clima OR salud OR mercados',
      query_en: 'international OR world OR "breaking news" OR summit OR economy OR technology OR science OR climate OR health OR markets'
    },
    maxItems: 22,
    rss: {
      en: [
        "https://feeds.bbci.co.uk/news/world/rss.xml",
        "https://rss.cnn.com/rss/edition_world.rss",
        "https://www.aljazeera.com/xml/rss/all.xml"
      ],
      es: [
        "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/internacional/portada",
        "https://www.rtve.es/api/noticias.rss",
        "https://e00-elmundo.uecdn.es/elmundo/rss/internacional.xml"
      ]
    }
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

  // ───────────────────────────────────────── Fetch helpers
  async function fetchText(url, timeoutMs = 10000) {
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
    if (t.length < 8) return ""; // más permisivo
    if (t.length > 160) t = t.slice(0, 157).trim() + "…";
    return t;
  }

  function normalizeSource(a) {
    const domain = safeStr(a?.domain || a?.source || "");
    const sc = safeStr(a?.sourceCountry || a?.sourcecountry || "");
    const src = domain || sc || "";
    if (!src) return "NEWS";
    const cleaned = src.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
    return cleaned.toUpperCase().slice(0, 24);
  }

  async function getHeadlinesGdelt() {
    const lang = (CFG.lang === "auto") ? langAuto : CFG.lang;
    const q = (lang === "es") ? API.gdelt.query_es : API.gdelt.query_en;

    const url =
      `${API.gdelt.endpoint}` +
      `?query=${encodeURIComponent(q)}` +
      `&mode=ArtList` +
      `&format=json` +
      `&sort=${encodeURIComponent(CFG.sort)}` +
      `&timespan=${encodeURIComponent(CFG.timespan)}` +
      `&maxrecords=${encodeURIComponent(String(API.maxItems * 3))}`;

    log("GDELT URL:", url);

    const data = await fetchJsonRobust(url);
    log("GDELT keys:", Object.keys(data || {}));

    const errMsg = safeStr(data?.error || data?.message || data?.status || "");
    if (errMsg && /error|invalid|failed/i.test(errMsg)) {
      throw new Error(errMsg || "GDELT error");
    }

    const articles =
      Array.isArray(data?.articles) ? data.articles :
      Array.isArray(data?.results) ? data.results :
      Array.isArray(data?.artlist) ? data.artlist :
      [];

    const mapped = articles.map(a => {
      const title = cleanTitle(a?.title || a?.name || "");
      const link = safeStr(a?.url || a?.link || a?.url_mobile || a?.urlmobile || "");
      if (!title || !link) return null;
      return { title, url: link, source: normalizeSource(a) };
    }).filter(Boolean);

    const uniq = uniqBy(mapped, x => (x.title + "|" + x.url).toLowerCase())
      .slice(0, API.maxItems);

    return uniq;
  }

  // ───────────────────────────────────────── RSS fallback (si GDELT se queda a 0)
  function extractXmlBlob(text) {
    const s = String(text || "");
    const start = Math.min(
      ...["<?xml", "<rss", "<feed"].map(t => {
        const i = s.indexOf(t);
        return i >= 0 ? i : 1e9;
      })
    );
    if (!Number.isFinite(start) || start >= 1e8) return s;
    return s.slice(start);
  }

  function parseRss(xmlText) {
    const xml = extractXmlBlob(xmlText);
    let doc = null;
    try { doc = new DOMParser().parseFromString(xml, "text/xml"); } catch (_) {}

    const out = [];

    if (doc) {
      const items = Array.from(doc.querySelectorAll("item")).slice(0, API.maxItems);
      for (const it of items) {
        const title = cleanTitle(it.querySelector("title")?.textContent || "");
        const link = safeStr(it.querySelector("link")?.textContent || "");
        if (!title || !link) continue;
        out.push({ title, url: link, source: "RSS" });
      }
      if (out.length) return out;

      // Atom
      const entries = Array.from(doc.querySelectorAll("entry")).slice(0, API.maxItems);
      for (const e of entries) {
        const title = cleanTitle(e.querySelector("title")?.textContent || "");
        const linkEl = e.querySelector("link[rel='alternate']") || e.querySelector("link");
        const link = safeStr(linkEl?.getAttribute("href") || "");
        if (!title || !link) continue;
        out.push({ title, url: link, source: "ATOM" });
      }
      if (out.length) return out;
    }

    // regex ultra fallback
    const rxItem = /<item\b[\s\S]*?<\/item>/gi;
    const chunks = xml.match(rxItem) || [];
    for (const ch of chunks.slice(0, API.maxItems)) {
      const t = cleanTitle((ch.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [,""])[1].replace(/<!\[CDATA\[|\]\]>/g, ""));
      const l = safeStr((ch.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [,""])[1].replace(/<!\[CDATA\[|\]\]>/g, ""));
      if (!t || !l) continue;
      out.push({ title: t, url: l, source: "RSS" });
    }
    return out;
  }

  async function getHeadlinesRss() {
    const lang = (CFG.lang === "auto") ? langAuto : CFG.lang;
    const feeds = (lang === "es") ? API.rss.es : API.rss.en;

    for (const feed of feeds) {
      try {
        const txt = await fetchText(jina(feed), 12000);
        const items = parseRss(txt);
        if (items && items.length) return items.slice(0, API.maxItems);
      } catch (e) {
        log("RSS fail:", feed, e?.message || e);
      }
    }
    return [];
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
          ? "No hay titulares ahora mismo (reintentando)…"
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
      if (vote) {
        log("voteBox detected");
        setupHideOnVote();
      }
    });

    domObs.observe(document.documentElement, { childList: true, subtree: true });
  }

  // ───────────────────────────────────────── Cache
  function readCacheAny() {
    const c = readJsonAny(CACHE_KEY, CACHE_KEY_LEGACY);
    if (!c || typeof c !== "object") return null;
    if (!Array.isArray(c.items)) return null;
    return c;
  }

  function writeCache(lang, items) {
    writeJsonBoth(CACHE_KEY, CACHE_KEY_LEGACY, { ts: Date.now(), lang, items });
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
      if (cache && cache.lang === lang && (Date.now() - (cache.ts || 0) <= maxAge)) {
        log("cache hit");
        setTickerItems(cache.items);
        return;
      }
    }

    if (refreshInFlight) return;
    refreshInFlight = true;

    try {
      let items = [];
      try {
        items = await getHeadlinesGdelt();
      } catch (e) {
        log("GDELT error:", e?.message || e);
      }

      // ✅ si GDELT devuelve 0 => RSS fallback
      if (!items || !items.length) {
        log("GDELT empty => RSS fallback");
        items = await getHeadlinesRss();
      }

      setTickerItems(items);
      if (items && items.length) writeCache(lang, items);
    } catch (e) {
      log("refresh fatal:", e?.message || e);
      const cache = readCacheAny();
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

  function persistCfg() {
    writeJsonBoth(CFG_KEY, CFG_KEY_LEGACY, CFG);
  }

  function applyCfg(nextCfg, persist = false) {
    CFG = normalizeCfg(Object.assign({}, CFG, nextCfg || {}));
    if (persist) persistCfg();

    if (!CFG.enabled) setVisible(false);
    else setVisible(true);

    setupHideOnVote();
    startTimer();
    refresh(true);
  }

  function boot() {
    ensureUI();
    applyCfg(CFG, false);

    // Config desde Control Room (BroadcastChannel)
    try {
      if (bcMain) {
        bcMain.addEventListener("message", (ev) => {
          const msg = ev?.data;
          if (!msg || typeof msg !== "object") return;
          if (msg.type === "TICKER_CFG" && msg.cfg && typeof msg.cfg === "object") {
            applyCfg(msg.cfg, true);
          }
        });
      }
      if (bcLegacy) {
        bcLegacy.addEventListener("message", (ev) => {
          const msg = ev?.data;
          if (!msg || typeof msg !== "object") return;
          if (!keyOk(msg, false)) return;
          if (msg.type === "TICKER_CFG" && msg.cfg && typeof msg.cfg === "object") {
            applyCfg(msg.cfg, true);
          }
        });
      }
    } catch (_) {}

    // storage event
    window.addEventListener("storage", (e) => {
      if (!e) return;
      if (e.key === CFG_KEY || e.key === CFG_KEY_LEGACY) {
        const stored = readJsonAny(CFG_KEY, CFG_KEY_LEGACY);
        if (stored) applyCfg(stored, false);
      }
    });

    setupHideOnVote();
    watchForVoteBox();

    // paint rápido con cache si existe
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
