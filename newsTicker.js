/* newsTicker.js — RLC Global News Ticker v1.4.0 (BILINGUAL EN+ES + TRANSLATE CACHE)
   ✅ Titulares: GDELT con sourcelang:eng (evita árabe/chino/coreano/etc)
   ✅ Bilingüe: muestra MISMA noticia con título EN + traducción ES
   ✅ Traducción gratuita (MyMemory) + cache local + limit por refresh
   ✅ Toggle: ?tickerBilingual=0 (OFF) / 1 (ON)
   ✅ timespan configurable (por defecto 1d)
   ✅ HideOnVote robusto + Debug opcional: ?tickerDebug=1
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const LOAD_GUARD = "__RLC_NEWS_TICKER_LOADED_V140";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  const BUS = "rlc_bus_v1";
  const CFG_KEY = "rlc_ticker_cfg_v1";
  const CACHE_KEY = "rlc_ticker_cache_v1";     // { ts, key, items }
  const TRANS_KEY = "rlc_ticker_trans_v1";     // { ts, map: { hash: { ts, es } }, order: [hash...] }

  const qs = (s, r = document) => r.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const safeStr = (v) => (typeof v === "string") ? v.trim() : "";
  const num = (v, fb) => {
    const n = parseFloat(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fb;
  };

  const bc = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS) : null;

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
      ticker: u.searchParams.get("ticker") ?? "",
      lang: safeStr(u.searchParams.get("tickerLang") || ""),
      speed: safeStr(u.searchParams.get("tickerSpeed") || ""),
      refresh: safeStr(u.searchParams.get("tickerRefresh") || ""),
      top: safeStr(u.searchParams.get("tickerTop") || ""),
      hideOnVote: safeStr(u.searchParams.get("tickerHideOnVote") || ""),
      span: safeStr(u.searchParams.get("tickerSpan") || ""),
      bilingual: safeStr(u.searchParams.get("tickerBilingual") || ""),
      debug: safeStr(u.searchParams.get("tickerDebug") || "")
    };
  }

  const P = parseParams();
  if (P.ticker === "0") return;

  const DEBUG = (P.debug === "1" || P.debug === "true");
  const log = (...a) => { if (DEBUG) console.log("[RLC:TICKER]", ...a); };

  // UI auto (solo etiqueta)
  const uiLangAuto = (navigator.language || "").toLowerCase().startsWith("es") ? "es" : "en";

  const DEFAULTS = {
    enabled: true,
    lang: "auto",           // auto|es|en (UI/intención)
    speedPxPerSec: 55,      // 20..140
    refreshMins: 12,        // 3..60
    topPx: 10,              // 0..120
    hideOnVote: true,
    timespan: "1d",

    // ✅ Bilingüe (misma noticia EN + ES)
    bilingual: true,        // ON por defecto
    translateMax: 10        // máximo titulares a traducir por refresh
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

    c.bilingual = (c.bilingual !== false);
    c.translateMax = clamp(num(c.translateMax, DEFAULTS.translateMax), 0, 22);

    return c;
  }

  let CFG = normalizeCfg(Object.assign({}, DEFAULTS, readJson(CFG_KEY) || {}, cfgFromUrl()));

  const API = {
    gdelt: {
      endpoint: "https://api.gdeltproject.org/api/v2/doc/doc",
      query_en: 'international OR world OR "breaking news" OR summit OR economy OR technology OR science OR climate OR health OR markets'
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

  // ───────────────────────────────────────── Fetch robusto
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
    return t;
  }

  function normalizeSource(a) {
    const domain = safeStr(a?.domain || a?.source || "");
    const sc = safeStr(a?.sourceCountry || a?.sourcecountry || "");
    const src = domain || sc || "";
    if (!src) return "NEWS";
    const cleaned = src.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
    return cleaned.toUpperCase().slice(0, 22);
  }

  // ───────────────────────────────────────── Traducción (gratis) + cache
  function simpleHash(str) {
    // hash barato pero estable
    const s = String(str || "");
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  function readTransStore() {
    const o = readJson(TRANS_KEY);
    if (!o || typeof o !== "object") return { ts: Date.now(), map: {}, order: [] };
    if (!o.map || typeof o.map !== "object") o.map = {};
    if (!Array.isArray(o.order)) o.order = [];
    return o;
  }

  function writeTransStore(store) {
    try { writeJson(TRANS_KEY, store); } catch (_) {}
  }

  function getCachedEs(titleEn) {
    const store = readTransStore();
    const k = simpleHash(titleEn);
    const it = store.map[k];
    if (!it || !it.es) return "";
    // TTL “suave” 7 días
    const age = Date.now() - (it.ts || 0);
    if (age > 7 * 24 * 60 * 60 * 1000) return "";
    return String(it.es || "");
  }

  function putCachedEs(titleEn, es) {
    const store = readTransStore();
    const k = simpleHash(titleEn);
    store.map[k] = { ts: Date.now(), es: String(es || "") };
    // orden LRU simple
    store.order = store.order.filter(x => x !== k);
    store.order.push(k);

    // cap 500 entradas
    while (store.order.length > 500) {
      const old = store.order.shift();
      if (old) delete store.map[old];
    }

    store.ts = Date.now();
    writeTransStore(store);
  }

  function decodeEntities(s) {
    // decodificación básica (MyMemory a veces devuelve entidades)
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
    // MyMemory (gratis)
    const url = `https://api.mymemory.translated.net/get?q=${q}&langpair=en|es`;

    try {
      const data = await fetchJsonRobust(url);
      const t = decodeEntities(
        safeStr(data?.responseData?.translatedText || "")
      );

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

  // ───────────────────────────────────────── Headlines (GDELT)
  async function getHeadlinesEn() {
    const q = API.gdelt.query_en;

    // ✅ clave: sourcelang:eng (filtra idiomas raros)
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
      return { titleEn: title, url: link, source: normalizeSource(a) };
    }).filter(Boolean);

    return uniqBy(mapped, x => (x.titleEn + "|" + x.url).toLowerCase()).slice(0, API.maxItems);
  }

  async function makeBilingual(items) {
    if (!CFG.bilingual) return items;

    const maxN = CFG.translateMax | 0;
    if (maxN <= 0) return items;

    const out = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it || !it.titleEn) { out.push(it); continue; }

      // traducimos solo primeros N por refresh (el resto va con cache si existe)
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

        // EN / ES en una línea (misma noticia)
        title.textContent = es
          ? `${en} — ${es}`
          : en;
        if (es) title.classList.add("b2"); // look sutil (opcional)
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

  // ───────────────────────────────────────── Cache headlines
  function cacheKey() {
    return `${CFG.timespan}|b=${CFG.bilingual ? 1 : 0}|mx=${CFG.translateMax|0}`;
  }

  function readCache() {
    const c = readJson(CACHE_KEY);
    if (!c || typeof c !== "object") return null;
    if (!Array.isArray(c.items)) return null;
    return c;
  }

  function writeCache(key, items) {
    writeJson(CACHE_KEY, { ts: Date.now(), key, items });
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
        log("cache hit");
        setTickerItems(cache.items);
        return;
      }
    }

    if (refreshInFlight) return;
    refreshInFlight = true;

    try {
      const en = await getHeadlinesEn();
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
    if (persist) writeJson(CFG_KEY, CFG);

    if (!CFG.enabled) setVisible(false);
    else setVisible(true);

    setupHideOnVote();
    startTimer();
    refresh(true);
  }

  function boot() {
    ensureUI();
    applyCfg(CFG, false);

    // Config desde Control Room
    try {
      if (bc) {
        bc.addEventListener("message", (ev) => {
          const msg = ev?.data;
          if (!msg || typeof msg !== "object") return;
          if (msg.type === "TICKER_CFG" && msg.cfg && typeof msg.cfg === "object") {
            applyCfg(msg.cfg, true);
          }
        });
      }
    } catch (_) {}

    // storage event (otra pestaña)
    window.addEventListener("storage", (e) => {
      if (!e) return;
      if (e.key === CFG_KEY) {
        const stored = readJson(CFG_KEY);
        if (stored) applyCfg(stored, false);
      }
    });

    setupHideOnVote();
    watchForVoteBox();

    // pinta rápido si hay cache
    const cache = readCache();
    if (cache?.items?.length) setTickerItems(cache.items);

    refresh(false);
    log("boot cfg:", CFG);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
