/* rlcTickers.js — RLC Unified Tickers (NEWS + ECON) v2.3.5 (HARD FIX: Z-INDEX + SAFE TOP + VOTE LAYOUT SYNC)
   ✅ NEWS + ECON con MISMO markup + MISMA piel (Neo-Atlas)
   ✅ Siempre full-width y en stack: NEWS arriba, ECON abajo
   ✅ Calcula y aplica: --rlcNewsTop, --rlcEconTop, --rlcTickerH, --rlcTickerTop
   ✅ Respeta: --ui-top-offset + safe-area-inset-top (iOS/overlay)
   ✅ Robust fetch: direct -> AllOrigins -> r.jina.ai
   ✅ No rompe IDs/clases existentes: #rlcNewsTicker #rlcEconTicker, .tickerInner/.tickerBadge/.tickerText/.tickerMarquee
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const LOAD_GUARD = "__RLC_TICKERS_LOADED_V235";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

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

      // ECON
      econ: u.searchParams.get("econ") ?? "",
      econSpeed: safeStr(u.searchParams.get("econSpeed") || ""),
      econRefresh: safeStr(u.searchParams.get("econRefresh") || ""),
      econTop: safeStr(u.searchParams.get("econTop") || ""),
      econHideOnVote: safeStr(u.searchParams.get("econHideOnVote") || ""),
      econMode: safeStr(u.searchParams.get("econMode") || ""),
      econClocks: safeStr(u.searchParams.get("econClocks") || ""),
      econDebug: safeStr(u.searchParams.get("econDebug") || "")
    };
  }

  const P = parseParams();
  const KEY = P.key;

  // ───────────────────────── Bus + storage keys (namespaced + legacy)
  const BUS_BASE = "rlc_bus_v1";
  const BUS_NS = KEY ? `${BUS_BASE}:${KEY}` : BUS_BASE;

  const bcMain = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS_NS) : null;
  const bcLegacy = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_BASE) : null;

  function keyOk(msg, fromNamespacedChannel) {
    if (!KEY) return true;
    if (fromNamespacedChannel) return true;
    return !!(msg && msg.key === KEY);
  }

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

  // ───────────────────────── HARD inline base style (para que SIEMPRE se vea)
  const BASE_Z = 2147483000; // “por encima de todo” sin romper clicks
  function ensureHardStyle(root, topVar) {
    if (!root || root.__rlcHardStyled) return;
    root.__rlcHardStyled = true;

    try {
      root.style.position = "fixed";
      root.style.left = "0";
      root.style.right = "0";
      root.style.width = "100%";
      root.style.top = `var(${topVar}, 10px)`;
      root.style.zIndex = String(BASE_Z);
      root.style.pointerEvents = "auto";
      root.style.transform = "translateZ(0)";
      root.style.willChange = "transform";
      root.style.contain = "layout paint style";
    } catch (_) {}
  }

  function dispatchLayout() {
    try { window.dispatchEvent(new Event("rlcTickers:layout")); } catch (_) {}
  }

  // ───────────────────────── Layout (NO RLCUiBars) + SAFE TOP
  const LAYOUT = (() => {
    function cssPx(varName, fb = 0) {
      try {
        const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
        const n = parseFloat(String(v).replace("px", "").trim());
        return Number.isFinite(n) ? n : fb;
      } catch (_) { return fb; }
    }

    // Leer env(safe-area-inset-top) vía un nodo temporal (JS no puede leer env() directo).
    function safeAreaTopPx() {
      try {
        const el = document.createElement("div");
        el.style.cssText = "position:fixed;top:env(safe-area-inset-top);left:0;visibility:hidden;pointer-events:none;";
        document.documentElement.appendChild(el);
        const top = parseFloat(getComputedStyle(el).top || "0") || 0;
        el.remove();
        return Number.isFinite(top) ? top : 0;
      } catch (_) { return 0; }
    }

    function setVar(name, val) {
      try { document.documentElement.style.setProperty(name, val); } catch (_) {}
    }

    function apply({ newsVis, econVis, newsCfgTop, econCfgTop, newsEl, econEl }) {
      const barH = cssPx("--rlcBarH", 34) || 34;
      const gap = cssPx("--rlcTickerGap", 12) || 12;

      const uiTop = cssPx("--ui-top-offset", 0) || 0;
      const safeTop = safeAreaTopPx();
      const baseSafe = uiTop + safeTop;

      const onN = !!newsVis;
      const onE = !!econVis;

      const nTopWanted = baseSafe + (num(newsCfgTop, 10) || 10);
      const eTopWanted = baseSafe + (num(econCfgTop, 10) || 10);

      let newsTop = nTopWanted;
      let econTop = eTopWanted;

      if (onN && onE) {
        // ECON siempre debajo de NEWS como mínimo
        const minEcon = newsTop + barH + gap;
        econTop = Math.max(econTop, minEcon);
      }

      // baseTop: el menor top visible (para --rlcTickerTop)
      const tops = [];
      if (onN) tops.push(newsTop);
      if (onE) tops.push(econTop);
      const baseTop = tops.length ? Math.min(...tops) : baseSafe + (num(newsCfgTop ?? econCfgTop, 10) || 10);

      // altura total real (si el usuario empuja econTop más abajo, se respeta)
      let totalH = 0;
      if (!onN && !onE) totalH = 0;
      else if (onN && !onE) totalH = barH;
      else if (!onN && onE) totalH = barH;
      else {
        const highestTop = Math.max(newsTop, econTop);
        totalH = (highestTop - baseTop) + barH;
      }

      setVar("--rlcTickerTop", `${baseTop}px`);
      setVar("--rlcNewsTop", `${newsTop}px`);
      setVar("--rlcEconTop", `${econTop}px`);
      setVar("--rlcTickerH", `${Math.max(0, totalH)}px`);

      // Aplicar inline TOP por si el CSS no está pillando vars
      try {
        if (newsEl) newsEl.style.top = `${newsTop}px`;
        if (econEl) econEl.style.top = `${econTop}px`;
      } catch (_) {}

      try {
        document.documentElement.dataset.rlcNewsOn = onN ? "1" : "0";
        document.documentElement.dataset.rlcEconOn = onE ? "1" : "0";
      } catch (_) {}
    }

    return { apply };
  })();

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
      sources: ["gdelt", "googlenews", "bbc", "dw", "guardian"]
    };

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

    function cfgFromUrl() {
      const out = {};
      if (P.ticker === "1" || P.ticker === "true") out.enabled = true;
      if (P.tickerLang === "es" || P.tickerLang === "en" || P.tickerLang === "auto") out.lang = P.tickerLang;
      if (P.tickerSpeed) out.speedPxPerSec = clamp(num(P.tickerSpeed, DEFAULTS.speedPxPerSec), 20, 140);
      if (P.tickerRefresh) out.refreshMins = clamp(num(P.tickerRefresh, DEFAULTS.refreshMins), 3, 60);
      if (P.tickerTop) out.topPx = clamp(num(P.tickerTop, DEFAULTS.topPx), 0, 120);
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
      if (P.ticker === "0") out.enabled = false;
      return out;
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
      return readJson(CFG_KEY_NS) || readJson(CFG_KEY_LEGACY) || null;
    }
    function writeCfgCompat(cfg) {
      try { writeJson(CFG_KEY_NS, cfg); } catch (_) {}
      try { writeJson(CFG_KEY_LEGACY, cfg); } catch (_) {}
    }

    let CFG = normalizeCfg(Object.assign({}, DEFAULTS, readCfgMerged() || {}, cfgFromUrl()));

    function ensureUI() {
      let root = qs("#rlcNewsTicker");
      if (root) return root;

      root = document.createElement("div");
      root.id = "rlcNewsTicker";
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

      document.body.appendChild(root);

      ensureHardStyle(root, "--rlcNewsTop");
      return root;
    }

    function setVisible(on) {
      const root = ensureUI();

      // no dependas de CSS .hidden
      root.classList.toggle("hidden", !on);
      root.style.display = on ? "" : "none";
      root.setAttribute("aria-hidden", on ? "false" : "true");

      dispatchLayout();
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
      // filtra scripts no latinos para evitar feeds raros
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
      const xml = await fetchTextRobust(url);
      const source = ({
        googlenews: "GNEWS",
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

      // interleave round-robin
      const merged = [];
      let guard = 0;
      while (merged.length < API.maxItems && guard < 600) {
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
        {
          titleEn: (uiLang === "es") ? "No hay titulares ahora mismo… reintentando." : "No headlines right now… retrying.",
          titleEs: "",
          url: "",
          source: "RLC"
        }
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

    function setTickerItems(items) {
      const root = ensureUI();
      setLabel(root);

      const marquee = qs("#rlcNewsMarquee", root);
      if (!marquee) return;

      marquee.innerHTML = "";
      const seg1 = buildSegment(items);
      const seg2 = seg1.cloneNode(true);

      marquee.appendChild(seg1);
      marquee.appendChild(seg2);

      const textWrap = marquee.parentElement;
      const vw = textWrap ? (textWrap.clientWidth || 800) : 800;
      const w = Math.max(300, seg1.scrollWidth || 300);

      if (w > vw * 1.05) {
        root.setAttribute("data-marquee", "1");
        const durSec = clamp(w / Math.max(20, CFG.speedPxPerSec), 12, 220);
        root.style.setProperty("--rlcTickerDur", `${durSec}s`);
      } else {
        root.setAttribute("data-marquee", "0");
        root.style.removeProperty("--rlcTickerDur");
      }
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
    let voteVisible = false;

    function computeVoteVisible() {
      const vote = qs("#voteBox");
      voteVisible = vote ? isElementVisible(vote) : false;
      return voteVisible;
    }

    function setupHideOnVote() {
      try { voteObs?.disconnect(); } catch (_) {}
      voteObs = null;

      const vote = qs("#voteBox");
      if (!vote) { computeVoteVisible(); return; }

      const apply = () => {
        computeVoteVisible();
        if (!CFG.enabled) { setVisible(false); return; }
        if (!CFG.hideOnVote) { setVisible(true); return; }
        setVisible(!voteVisible);
      };

      apply();

      voteObs = new MutationObserver(() => {
        apply();
        dispatchLayout();
      });
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

    function isVisibleNow() {
      if (!CFG.enabled) return false;
      if (!CFG.hideOnVote) return true;
      computeVoteVisible();
      return !voteVisible;
    }

    // refresh loop
    let refreshTimer = null;
    let refreshInFlight = false;

    async function refresh(force = false) {
      if (!CFG.enabled) { setVisible(false); return; }
      setVisible(true);

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
    }

    function applyCfg(nextCfg, persist = false) {
      CFG = normalizeCfg(Object.assign({}, CFG, nextCfg || {}));
      if (persist) writeCfgCompat(CFG);

      if (!CFG.enabled) setVisible(false);
      else setVisible(true);

      setupHideOnVote();
      startTimer();
      refresh(true);

      dispatchLayout();
    }

    function onMessage(msg, fromNamespaced) {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "TICKER_CFG" && msg.cfg && typeof msg.cfg === "object") {
        if (!keyOk(msg, fromNamespaced)) return;
        applyCfg(msg.cfg, true);
      }
    }

    function boot() {
      if (P.ticker === "0") { CFG.enabled = false; }

      const root = ensureUI();
      ensureHardStyle(root, "--rlcNewsTop");

      applyCfg(CFG, false);

      setupHideOnVote();
      watchForVoteBox();

      const cache = readCache();
      if (cache?.items?.length) setTickerItems(cache.items);

      refresh(false);

      log("boot", { CFG, KEY, BUS_NS, CFG_KEY_NS });
    }

    function getCfg() { return CFG; }
    function isOn() { return !!CFG.enabled; }
    function getEl() { return qs("#rlcNewsTicker"); }

    return { boot, onMessage, applyCfg, getCfg, isOn, isVisibleNow, getEl };
  })();

  // ======================================================================
  // ECON TICKER (mismo markup que NEWS)
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
      topPx: 10,           // 0..120
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
      ]
    };

    function normalizeMode(v) {
      const s = safeStr(v).toLowerCase();
      if (s === "sincelast" || s === "since_last" || s === "since-last" || s === "sincelast" || s === "sincelast" || s === "sinceLast") return "sinceLast";
      return "daily";
    }

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
      c.topPx = clamp(num(c.topPx, DEFAULTS.topPx), 0, 120);
      c.hideOnVote = (c.hideOnVote !== false);
      c.mode = normalizeMode(c.mode);
      c.showClocks = (c.showClocks !== false);
      c.clocks = normalizeClocks(c.clocks);
      c.items = normalizeItems(c.items);
      return c;
    }

    function cfgFromUrl() {
      const out = {};
      if (P.econSpeed) out.speedPxPerSec = clamp(num(P.econSpeed, DEFAULTS.speedPxPerSec), 20, 140);
      if (P.econRefresh) out.refreshMins = clamp(num(P.econRefresh, DEFAULTS.refreshMins), 1, 20);
      if (P.econTop) out.topPx = clamp(num(P.econTop, DEFAULTS.topPx), 0, 120);
      if (P.econHideOnVote === "0") out.hideOnVote = false;
      if (P.econHideOnVote === "1") out.hideOnVote = true;
      if (P.econMode) out.mode = normalizeMode(P.econMode);
      if (P.econClocks === "0") out.showClocks = false;
      if (P.econClocks === "1") out.showClocks = true;
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
      if (root) return root;

      root = document.createElement("div");
      root.id = "rlcEconTicker";
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

      document.body.appendChild(root);

      ensureHardStyle(root, "--rlcEconTop");
      return root;
    }

    function setVisible(on) {
      const root = ensureUI();
      root.classList.toggle("hidden", !on);
      root.style.display = on ? "" : "none";
      root.setAttribute("aria-hidden", on ? "false" : "true");

      dispatchLayout();
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
      const txt = await fetchTextRobust(stooqLastUrl(sym));
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

    // clocks live updater (no fetch)
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
    }

    // Render (mismo estilo que NEWS)
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

      // clocks
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

      // assets
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

    function setTickerItems(model) {
      const root = ensureUI();
      const marquee = qs("#rlcEconMarquee", root);
      if (!marquee) return;

      marquee.innerHTML = "";

      const seg1 = buildSegment(model);
      const seg2 = seg1.cloneNode(true);

      marquee.appendChild(seg1);
      marquee.appendChild(seg2);

      startClockTimer();

      const textWrap = marquee.parentElement;
      const vw = textWrap ? (textWrap.clientWidth || 800) : 800;
      const w = Math.max(300, seg1.scrollWidth || 300);

      if (w > vw * 1.05) {
        root.setAttribute("data-marquee", "1");
        const durSec = clamp(w / Math.max(20, CFG.speedPxPerSec), 12, 220);
        root.style.setProperty("--rlcTickerDur", `${durSec}s`);
      } else {
        root.setAttribute("data-marquee", "0");
        root.style.removeProperty("--rlcTickerDur");
      }
    }

    // hide-on-vote
    let voteObs = null;
    let domObs = null;
    let voteVisible = false;

    function computeVoteVisible() {
      const vote = qs("#voteBox");
      voteVisible = vote ? isElementVisible(vote) : false;
      return voteVisible;
    }

    function setupHideOnVote() {
      try { voteObs?.disconnect(); } catch (_) {}
      voteObs = null;

      const vote = qs("#voteBox");
      if (!vote) { computeVoteVisible(); return; }

      const apply = () => {
        computeVoteVisible();
        if (!CFG.enabled) { setVisible(false); return; }
        if (!CFG.hideOnVote) { setVisible(true); return; }
        setVisible(!voteVisible);
      };

      apply();

      voteObs = new MutationObserver(() => {
        apply();
        dispatchLayout();
      });
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

    function isVisibleNow() {
      if (!CFG.enabled) return false;
      if (!CFG.hideOnVote) return true;
      computeVoteVisible();
      return !voteVisible;
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
                const dailyTxt = await fetchTextRobust(stooqDailyUrl(sym));
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
      setVisible(true);

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
    }

    function applyCfg(nextCfg, persist = false) {
      CFG = normalizeCfg(Object.assign({}, CFG, nextCfg || {}));
      if (persist) writeCfgCompat(CFG);

      if (!CFG.enabled) setVisible(false);
      else setVisible(true);

      setupHideOnVote();
      startTimer();
      refresh();

      dispatchLayout();
    }

    function onMessage(msg, fromNamespaced) {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "ECON_CFG" && msg.cfg && typeof msg.cfg === "object") {
        if (!keyOk(msg, fromNamespaced)) return;
        applyCfg(msg.cfg, true);
      }
    }

    function boot() {
      if (P.econ === "0") { CFG.enabled = false; }

      const root = ensureUI();
      ensureHardStyle(root, "--rlcEconTop");

      applyCfg(CFG, false);

      setupHideOnVote();
      watchForVoteBox();

      refresh();

      log("boot", { CFG, KEY, BUS_NS, CFG_KEY_NS });
    }

    function getCfg() { return CFG; }
    function isOn() { return !!CFG.enabled; }
    function getEl() { return qs("#rlcEconTicker"); }

    return { boot, onMessage, applyCfg, getCfg, isOn, isVisibleNow, getEl };
  })();

  // ───────────────────────── Layout sync (stack always)
  function syncLayout() {
    const nCfg = NEWS.getCfg ? NEWS.getCfg() : null;
    const eCfg = ECON.getCfg ? ECON.getCfg() : null;

    const newsEl = NEWS.getEl ? NEWS.getEl() : qs("#rlcNewsTicker");
    const econEl = ECON.getEl ? ECON.getEl() : qs("#rlcEconTicker");

    // Garantiza hard style incluso si se crearon antes del CSS
    ensureHardStyle(newsEl, "--rlcNewsTop");
    ensureHardStyle(econEl, "--rlcEconTop");

    LAYOUT.apply({
      newsVis: (NEWS.isVisibleNow ? NEWS.isVisibleNow() : !!nCfg?.enabled),
      econVis: (ECON.isVisibleNow ? ECON.isVisibleNow() : !!eCfg?.enabled),
      newsCfgTop: nCfg?.topPx ?? 10,
      econCfgTop: eCfg?.topPx ?? 10,
      newsEl,
      econEl
    });
  }

  // ───────────────────────── Message routing
  function onBusMessage(msg, fromNamespaced) {
    NEWS.onMessage(msg, fromNamespaced);
    ECON.onMessage(msg, fromNamespaced);
    setTimeout(syncLayout, 0);
  }

  function boot() {
    NEWS.boot();
    ECON.boot();

    // primer layout
    syncLayout();

    // re-layout event
    window.addEventListener("rlcTickers:layout", () => syncLayout(), { passive: true });

    // Bus listeners
    try {
      if (bcMain) bcMain.onmessage = (ev) => onBusMessage(ev?.data, true);
      if (bcLegacy) bcLegacy.onmessage = (ev) => onBusMessage(ev?.data, false);
    } catch (_) {}

    // postMessage fallback
    window.addEventListener("message", (ev) => {
      const msg = ev?.data;
      if (!msg || typeof msg !== "object") return;
      onBusMessage(msg, false);
    });

    // storage sync (cfg)
    window.addEventListener("storage", (e) => {
      if (!e || !e.key) return;

      if (e.key.startsWith("rlc_ticker_cfg_v1")) {
        const stored =
          readJson(KEY ? `rlc_ticker_cfg_v1:${KEY}` : "rlc_ticker_cfg_v1") ||
          readJson("rlc_ticker_cfg_v1");
        if (stored) NEWS.applyCfg(stored, false);
        setTimeout(syncLayout, 0);
      }

      if (e.key.startsWith("rlc_econ_cfg_v1")) {
        const stored =
          readJson(KEY ? `rlc_econ_cfg_v1:${KEY}` : "rlc_econ_cfg_v1") ||
          readJson("rlc_econ_cfg_v1");
        if (stored) ECON.applyCfg(stored, false);
        setTimeout(syncLayout, 0);
      }
    });

    // Opera GX / zoom / resize
    const relayout = () => syncLayout();
    window.addEventListener("resize", relayout, { passive: true });
    window.addEventListener("orientationchange", relayout, { passive: true });

    // último “por si acaso”
    setTimeout(syncLayout, 60);
    setTimeout(syncLayout, 400);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
