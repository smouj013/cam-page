/* rlcTickers.js — RLC Unified Tickers v2.0.0 (NEWS + ECON)
   ✅ Unifica:
      - newsTicker.js (v1.6.x)
      - econTicker.js (v1.0.x)
   ✅ KEY namespace: rlc_bus_v1:{key}, cfg/cache por {key} + legacy
   ✅ Split layout >=980px: ECON izquierda + NEWS derecha (mismo “row” en RLCUiBars)
   ✅ Stack layout <980px: NEWS arriba + ECON abajo (RLCUiBars)
   ✅ Robust fetch: direct -> AllOrigins -> r.jina.ai
   ✅ No rompe tu CSS: solo inyecta “split fixes” + estilo base del ECON (porque no existía)
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const LOAD_GUARD = "__RLC_TICKERS_LOADED_V200";
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
    if (fromNamespacedChannel) return true; // ya viene por rlc_bus_v1:{key}
    return !!(msg && msg.key === KEY);
  }

  const SPLIT_MQ = "(min-width: 980px)";
  const isSplit = () => {
    try { return !!window.matchMedia && window.matchMedia(SPLIT_MQ).matches; }
    catch (_) { return false; }
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

    // JSONP wrapper: foo({...})
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

  // ───────────────────────── RLCUiBars v2
  function ensureUiBars() {
    const ok = g.RLCUiBars && typeof g.RLCUiBars.set === "function" && typeof g.RLCUiBars.recalc === "function" && g.RLCUiBars.__rlcVer === 2;
    if (ok) return;

    const bars = new Map();

    const safeNum = (x, fb) => {
      const n = parseFloat(String(x ?? "").trim());
      return Number.isFinite(n) ? n : fb;
    };
    const cssNum = (varName, fb) => {
      try {
        const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
        return safeNum(v, fb);
      } catch (_) { return fb; }
    };
    const setVar = (name, val) => {
      try { document.documentElement.style.setProperty(name, val); } catch (_) {}
    };

    const API = {
      __rlcVer: 2,
      set(id, cfg) {
        const c = Object.assign({}, cfg || {});
        c.enabled = !!c.enabled;
        c.height = Number.isFinite(+c.height) ? +c.height : 0;
        c.wantTop = Number.isFinite(+c.wantTop) ? +c.wantTop : 10;
        c.cssTopVar = safeStr(c.cssTopVar) || "";
        c.priority = Number.isFinite(+c.priority) ? +c.priority : 999;
        c.group = safeStr(c.group) || "";
        bars.set(String(id), c);
        API.recalc();
      },
      remove(id) {
        bars.delete(String(id));
        API.recalc();
      },
      recalc() {
        // gap default
        const gapRaw = (() => {
          try { return getComputedStyle(document.documentElement).getPropertyValue("--rlcTickerGap").trim(); }
          catch (_) { return ""; }
        })();
        if (!gapRaw) setVar("--rlcTickerGap", "12px");

        const gap = cssNum("--rlcTickerGap", 12);

        const enabled = Array.from(bars.entries())
          .map(([id, c]) => ({ id, ...c }))
          .filter(b => b.enabled);

        const baseTop = enabled.length
          ? Math.min(...enabled.map(b => Number.isFinite(b.wantTop) ? b.wantTop : 10))
          : cssNum("--rlcTickerTop", 10);

        const rowsMap = new Map();
        for (const b of enabled) {
          const rowKey = b.group ? `g:${b.group}` : `i:${b.id}`;
          if (!rowsMap.has(rowKey)) rowsMap.set(rowKey, []);
          rowsMap.get(rowKey).push(b);
        }

        const rows = Array.from(rowsMap.entries()).map(([rowKey, list]) => {
          const pri = Math.min(...list.map(x => x.priority));
          const wantTopRow = Math.min(...list.map(x => x.wantTop));
          const h = Math.max(...list.map(x => x.height));
          return { rowKey, list, priority: pri, wantTop: wantTopRow, height: h };
        });

        rows.sort((a, b) => (a.priority - b.priority) || String(a.rowKey).localeCompare(String(b.rowKey)));

        let y = 0;
        for (const row of rows) {
          const top = baseTop + y;
          for (const b of row.list) {
            if (b.cssTopVar) setVar(b.cssTopVar, `${top}px`);
          }
          y += row.height + gap;
        }

        const totalH = rows.length ? Math.max(0, y - gap) : 0;
        setVar("--rlcTickerTop", `${baseTop}px`);
        setVar("--rlcTickerH", `${totalH}px`);
      }
    };

    g.RLCUiBars = API;
  }

  // ───────────────────────── Split layout patch (solo “colocación”)
  function injectSplitFixesOnce() {
    if (qs("#rlcTickersSplitFix")) return;
    const st = document.createElement("style");
    st.id = "rlcTickersSplitFix";
    st.textContent = `
/* Split layout (>=980px): ECON izquierda / NEWS derecha, misma fila */
@media (min-width: 980px){
  #rlcEconTicker{
    right: calc(50% + 8px) !important;
    left: 10px !important;
  }
  #rlcNewsTicker{
    left: calc(50% + 8px) !important;
    right: 10px !important;
  }
}
`.trim();
    document.head.appendChild(st);
  }

  // ───────────────────────── Hide on vote shared helper
  function isElementVisible(el) {
    if (!el) return false;
    const cs = window.getComputedStyle(el);
    if (!cs) return false;
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity || "1") <= 0) return false;
    const r = el.getBoundingClientRect();
    return (r.width > 0 && r.height > 0);
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

    // UI
    function ensureUI() {
      ensureUiBars();
      injectSplitFixesOnce();

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
      return root;
    }

    function registerBar(on) {
      try {
        ensureUiBars();
        const group = isSplit() ? "topline" : "";
        g.RLCUiBars.set("news", {
          enabled: !!on,
          wantTop: CFG.topPx,
          height: 34,
          cssTopVar: "--rlcNewsTop",
          priority: 10,
          group
        });
      } catch (_) {}
    }

    function setVisible(on) {
      const root = ensureUI();
      root.classList.toggle("hidden", !on);
      root.setAttribute("aria-hidden", on ? "false" : "true");
      registerBar(on);
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

    // helpers
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

    // fetch headlines
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

    // render
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

    // cache
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

      try { g.RLCUiBars && g.RLCUiBars.recalc(); } catch (_) {}

      setupHideOnVote();
      startTimer();
      refresh(true);
    }

    function onMessage(msg, fromNamespaced) {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "TICKER_CFG" && msg.cfg && typeof msg.cfg === "object") {
        if (!keyOk(msg, fromNamespaced)) return;
        applyCfg(msg.cfg, true);
      }
    }

    function boot() {
      if (P.ticker === "0") return; // OFF by URL
      ensureUI();
      applyCfg(CFG, false);

      setupHideOnVote();
      watchForVoteBox();

      const cache = readCache();
      if (cache?.items?.length) setTickerItems(cache.items);

      refresh(false);

      // re-register on split changes
      try {
        const mm = window.matchMedia && window.matchMedia(SPLIT_MQ);
        if (mm) {
          const onCh = () => { registerBar(CFG.enabled); try { g.RLCUiBars && g.RLCUiBars.recalc(); } catch (_) {} };
          if (mm.addEventListener) mm.addEventListener("change", onCh);
          else if (mm.addListener) mm.addListener(onCh);
        }
      } catch (_) {}

      log("boot", { CFG, KEY, BUS_NS, CFG_KEY_NS });
    }

    return { boot, onMessage, applyCfg };
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
      if (s === "sincelast" || s === "since_last" || s === "since-last" || s === "sinceLast") return "sinceLast";
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

    // ───────────────────────── ECON CSS (base) + uses UiBars vars
    function injectEconStylesOnce() {
      if (qs("#rlcEconTickerStyle")) return;

      const st = document.createElement("style");
      st.id = "rlcEconTickerStyle";
      st.textContent = `
#rlcEconTicker{
  position: fixed;
  left: 10px; right: 10px;
  top: var(--rlcEconTop, var(--rlcTickerTop, 10px));
  height: 34px;
  z-index: 999999;
  display:flex; align-items:center;
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(10,14,20,.88), rgba(8,10,14,.78));
  border: 1px solid rgba(255,255,255,.10);
  box-shadow: 0 14px 40px rgba(0,0,0,.45);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  overflow: hidden;
  pointer-events: auto;
}
#rlcEconTicker.hidden{ display:none !important; }

#rlcEconTicker .label{
  flex: 0 0 auto;
  height: 100%;
  display:flex; align-items:center; gap: 8px;
  padding: 0 12px;
  border-right: 1px solid rgba(255,255,255,.10);
  background: linear-gradient(90deg, rgba(25,226,138,.22), rgba(25,226,138,0));
  font: 900 12px/1 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: rgba(255,255,255,.92);
  user-select:none;
  white-space: nowrap;
}
#rlcEconTicker .dot{
  width: 8px; height: 8px; border-radius: 999px;
  background: #19e28a;
  box-shadow: 0 0 0 3px rgba(25,226,138,.18), 0 0 16px rgba(25,226,138,.45);
}

#rlcEconTicker .viewport{
  position: relative;
  overflow:hidden;
  height: 100%;
  flex: 1 1 auto;
  display:flex; align-items:center;
}
#rlcEconTicker .fadeL,
#rlcEconTicker .fadeR{
  position:absolute; top:0; bottom:0; width: 46px;
  z-index: 2; pointer-events:none;
}
#rlcEconTicker .fadeL{ left:0; background: linear-gradient(90deg, rgba(8,10,14,1), rgba(8,10,14,0)); }
#rlcEconTicker .fadeR{ right:0; background: linear-gradient(270deg, rgba(8,10,14,1), rgba(8,10,14,0)); }

#rlcEconTicker .track{
  position: relative;
  z-index: 1;
  display:flex; align-items:center; gap: 14px;
  white-space: nowrap;
  will-change: transform;
  transform: translate3d(0,0,0);
  animation: rlcEconMove var(--rlcTickerDur, 60s) linear infinite;
}
#rlcEconTicker:hover .track{ animation-play-state: paused; }

#rlcEconTicker .seg{
  display:flex; align-items:center; gap: 14px;
  white-space: nowrap;
}
#rlcEconTicker .item{
  display:inline-flex;
  align-items:center;
  gap: 10px;
  font: 800 12px/1.1 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
  color: rgba(255,255,255,.92);
  text-decoration: none;
  opacity: .92;
}
#rlcEconTicker .item:hover{ opacity: 1; text-decoration: underline; }
#rlcEconTicker .sep{
  width: 5px; height: 5px; border-radius:999px;
  background: rgba(255,255,255,.28);
  box-shadow: 0 0 0 3px rgba(255,255,255,.06);
}

#rlcEconTicker .ico{
  width: 18px; height: 18px; border-radius: 6px;
  display:inline-flex; align-items:center; justify-content:center;
  background: rgba(255,255,255,.08);
  border: 1px solid rgba(255,255,255,.12);
  overflow:hidden;
  flex: 0 0 auto;
}
#rlcEconTicker .ico img{
  width: 16px; height: 16px; object-fit: contain;
  filter: invert(1);
  opacity: .95;
}
#rlcEconTicker .ico .glyph{ font-size: 14px; line-height: 1; }

#rlcEconTicker .nm{ font-weight: 950; letter-spacing: .02em; }
#rlcEconTicker .px{ font-variant-numeric: tabular-nums; opacity: .92; }
#rlcEconTicker .chg{ font-variant-numeric: tabular-nums; opacity: .92; }
#rlcEconTicker .chg.up{ color:#19e28a; }
#rlcEconTicker .chg.down{ color:#ff5a5a; }
#rlcEconTicker .meta{
  display:inline-flex; align-items:center; gap:6px;
  opacity: .70;
  font-weight: 850;
}
#rlcEconTicker .flag{ font-size: 14px; line-height: 1; }
#rlcEconTicker .clk{ font-variant-numeric: tabular-nums; }

@keyframes rlcEconMove{
  from{ transform: translate3d(0,0,0); }
  to{ transform: translate3d(var(--rlcTickerEnd, -1200px),0,0); }
}

@media (prefers-reduced-motion: reduce){
  #rlcEconTicker .track{ animation: none !important; transform:none !important; }
}
`.trim();

      document.head.appendChild(st);
    }

    function ensureUI() {
      ensureUiBars();
      injectSplitFixesOnce();
      injectEconStylesOnce();

      let root = qs("#rlcEconTicker");
      if (root) return root;

      root = document.createElement("div");
      root.id = "rlcEconTicker";
      root.setAttribute("aria-label", "Ticker económico");
      root.innerHTML = `
        <div class="label" title="Mercados">
          <span class="dot" aria-hidden="true"></span>
          <span id="rlcEconTickerLabel">MARKETS · MERCADOS</span>
        </div>
        <div class="viewport">
          <div class="fadeL" aria-hidden="true"></div>
          <div class="fadeR" aria-hidden="true"></div>
          <div class="track" id="rlcEconTickerTrack" aria-live="polite">
            <div class="seg" id="rlcEconTickerSeg"></div>
            <div class="seg" id="rlcEconTickerSeg2" aria-hidden="true"></div>
          </div>
        </div>
      `.trim();

      document.body.appendChild(root);
      return root;
    }

    function registerBar(on) {
      try {
        ensureUiBars();
        const group = isSplit() ? "topline" : "";
        g.RLCUiBars.set("econ", {
          enabled: !!on,
          wantTop: CFG.topPx,
          height: 34,
          cssTopVar: "--rlcEconTop",
          priority: 20, // debajo del news en stack; mismo row en split por group
          group
        });
      } catch (_) {}
    }

    function setVisible(on) {
      const root = ensureUI();
      root.classList.toggle("hidden", !on);
      root.setAttribute("aria-hidden", on ? "false" : "true");
      registerBar(on);
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

    // ───────────────────────── Icons (FREE)
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
    function stooqLastUrl(sym) {
      return `https://stooq.com/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlcv&h&e=csv`;
    }
    function stooqDailyUrl(sym) {
      return `https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d`;
    }

    function csvLineSplit(text) {
      return String(text || "").trim().split(/\r?\n/).filter(Boolean);
    }
    function csvSplitRow(line) {
      return String(line || "").split(",").map(s => s.trim());
    }
    function toNum(v) {
      const s = String(v ?? "").trim();
      if (!s || s === "N/D" || s === "ND" || s === "NA") return null;
      const n = parseFloat(s.replace(",", "."));
      return Number.isFinite(n) ? n : null;
    }

    async function getLastClose(sym) {
      const txt = await fetchTextRobust(stooqLastUrl(sym));
      const lines = csvLineSplit(txt);
      if (lines.length < 2) throw new Error("CSV short");
      const head = csvSplitRow(lines[0]);
      const row = csvSplitRow(lines[1]);

      const idxClose = head.findIndex(h => h.toLowerCase() === "close");
      const idxDate = head.findIndex(h => h.toLowerCase() === "date");
      const idxTime = head.findIndex(h => h.toLowerCase() === "time");

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
    function cacheKey() {
      const list = (CFG.items || []).map(x => safeStr(x.stooq)).join(",");
      return `m=${CFG.mode}|list=${list}`;
    }

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

    // clock live updater (no fetch)
    let clockTimer = null;
    function startClockTimer() {
      if (clockTimer) return;
      clockTimer = setInterval(() => {
        try {
          const nodes = document.querySelectorAll("[data-rlc-tz][data-rlc-clock='1']");
          nodes.forEach((n) => {
            const tz = n.getAttribute("data-rlc-tz") || "UTC";
            const label = n.getAttribute("data-rlc-label") || "";
            n.textContent = label ? `${label} ${fmtTime(tz)}` : fmtTime(tz);
          });
        } catch (_) {}
      }, 1000);
    }

    function buildItemsDOM(model) {
      const frag = document.createDocumentFragment();
      const pushSep = () => {
        const sep = document.createElement("span");
        sep.className = "sep";
        sep.setAttribute("aria-hidden", "true");
        frag.appendChild(sep);
      };

      let first = true;

      // clocks
      if (CFG.showClocks && Array.isArray(model.clocks) && model.clocks.length) {
        for (const c of model.clocks) {
          if (!first) pushSep();
          first = false;

          const a = document.createElement("a");
          a.className = "item";
          a.href = "#";
          a.addEventListener("click", (e) => e.preventDefault());

          const meta = document.createElement("span");
          meta.className = "meta";

          const flag = document.createElement("span");
          flag.className = "flag";
          flag.textContent = flagEmoji(c.country);

          const clk = document.createElement("span");
          clk.className = "clk";
          clk.setAttribute("data-rlc-clock", "1");
          clk.setAttribute("data-rlc-tz", c.tz || "UTC");
          clk.setAttribute("data-rlc-label", c.label || "");
          clk.textContent = `${c.label || "CLK"} ${fmtTime(c.tz || "UTC")}`;

          meta.appendChild(flag);
          meta.appendChild(clk);
          a.appendChild(meta);

          frag.appendChild(a);
        }
      }

      // assets
      for (const it of model.items || []) {
        if (!first) pushSep();
        first = false;

        const a = document.createElement("a");
        a.className = "item";
        a.href = `https://stooq.com/q/?s=${encodeURIComponent(it.stooq)}`;
        a.target = "_blank";
        a.rel = "noreferrer noopener";

        const icoWrap = document.createElement("span");
        icoWrap.className = "ico";
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
              sp.className = "glyph";
              sp.textContent = safeStr(it.glyph) || guessGlyph(it.kind);
              icoWrap.appendChild(sp);
            } catch (_) {}
          };
          icoWrap.appendChild(img);
        } else {
          const sp = document.createElement("span");
          sp.className = "glyph";
          sp.textContent = ic.glyph;
          icoWrap.appendChild(sp);
        }

        const nm = document.createElement("span");
        nm.className = "nm";
        nm.textContent = clampLen(it.label || it.stooq.toUpperCase(), 18);

        const px = document.createElement("span");
        px.className = "px";
        px.textContent = it.priceText || "—";

        const chg = document.createElement("span");
        chg.className = "chg";
        if (it.changeText) {
          chg.textContent = it.changeText;
          if (it.changeDir === "up") chg.classList.add("up");
          else if (it.changeDir === "down") chg.classList.add("down");
        } else {
          chg.textContent = "";
        }

        const meta = document.createElement("span");
        meta.className = "meta";

        const flag = document.createElement("span");
        flag.className = "flag";
        flag.textContent = flagEmoji(it.country);

        const clk = document.createElement("span");
        clk.className = "clk";
        clk.setAttribute("data-rlc-clock", "1");
        clk.setAttribute("data-rlc-tz", it.tz || "UTC");
        clk.setAttribute("data-rlc-label", "");
        clk.textContent = fmtTime(it.tz || "UTC");

        meta.appendChild(flag);
        meta.appendChild(clk);

        a.appendChild(icoWrap);
        a.appendChild(nm);
        a.appendChild(px);
        if (it.changeText) a.appendChild(chg);
        a.appendChild(meta);

        frag.appendChild(a);
      }

      return frag;
    }

    function setTickerItems(model) {
      const root = ensureUI();
      const track = qs("#rlcEconTickerTrack", root);
      const seg1 = qs("#rlcEconTickerSeg", root);
      const seg2 = qs("#rlcEconTickerSeg2", root);
      const viewport = track ? track.parentElement : null;
      if (!root || !track || !seg1 || !seg2) return;

      // stop animation
      track.style.animation = "none";
      void track.offsetHeight;

      seg1.innerHTML = "";
      seg2.innerHTML = "";

      seg1.appendChild(buildItemsDOM(model));
      startClockTimer();

      const vw = viewport ? (viewport.clientWidth || 900) : 900;

      // Si queda corto, duplica contenido (rápido y efectivo)
      let guard = 0;
      while ((seg1.scrollWidth || 0) < vw * 1.15 && guard < 8) {
        seg1.innerHTML += seg1.innerHTML;
        guard++;
      }
      seg2.innerHTML = seg1.innerHTML;

      const segW = Math.max(1200, seg1.scrollWidth || 1200);
      const endPx = -segW;
      const durSec = Math.max(18, Math.min(220, Math.abs(endPx) / CFG.speedPxPerSec));

      track.style.setProperty("--rlcTickerEnd", `${endPx}px`);
      track.style.setProperty("--rlcTickerDur", `${durSec}s`);

      // restart animation
      requestAnimationFrame(() => { track.style.animation = ""; });
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

    // model build
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
              } catch (_) {
                prev = null;
              }
            } else {
              prev = (cached && Number.isFinite(cached.price)) ? cached.price : null;
            }

            map[sym] = {
              ts: Date.now(),
              price,
              prev: Number.isFinite(prev) ? prev : null,
              dt
            };
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

          outItems.push(Object.assign({}, it, {
            priceText,
            changeText,
            changeDir,
            _dt: dt
          }));
        }
      }

      const workers = [];
      for (let k = 0; k < Math.min(maxConc, items.length); k++) workers.push(worker());
      await Promise.allSettled(workers);

      const order = new Map(items.map((x, i) => [x.stooq, i]));
      outItems.sort((a, b) => (order.get(a.stooq) ?? 0) - (order.get(b.stooq) ?? 0));

      writeCache(ck, map);

      return {
        clocks: CFG.clocks || [],
        items: outItems
      };
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

        // fallback desde cache
        const cache = readCache();
        const ck = cacheKey();
        const map = (cache && cache.key === ck && cache.map) ? cache.map : {};
        const fallback = {
          clocks: CFG.clocks || [],
          items: (CFG.items || []).map(it => {
            const c = map[it.stooq] || {};
            const price = Number.isFinite(c.price) ? c.price : null;
            const prev = Number.isFinite(c.prev) ? c.prev : null;

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
            }
            return Object.assign({}, it, { priceText, changeText, changeDir });
          })
        };
        setTickerItems(fallback);
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

      try { g.RLCUiBars && g.RLCUiBars.recalc(); } catch (_) {}

      setupHideOnVote();
      startTimer();
      refresh();
    }

    function onMessage(msg, fromNamespaced) {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "ECON_CFG" && msg.cfg && typeof msg.cfg === "object") {
        if (!keyOk(msg, fromNamespaced)) return;
        applyCfg(msg.cfg, true);
      }
    }

    function boot() {
      if (P.econ === "0") return; // OFF by URL
      ensureUI();
      applyCfg(CFG, false);

      setupHideOnVote();
      watchForVoteBox();

      refresh();

      // re-register on split changes
      try {
        const mm = window.matchMedia && window.matchMedia(SPLIT_MQ);
        if (mm) {
          const onCh = () => { registerBar(CFG.enabled); try { g.RLCUiBars && g.RLCUiBars.recalc(); } catch (_) {} };
          if (mm.addEventListener) mm.addEventListener("change", onCh);
          else if (mm.addListener) mm.addListener(onCh);
        }
      } catch (_) {}

      log("boot", { CFG, KEY, BUS_NS, CFG_KEY_NS });
    }

    return { boot, onMessage, applyCfg };
  })();

  // ───────────────────────── Message routing (one bus for both)
  function onBusMessage(msg, fromNamespaced) {
    NEWS.onMessage(msg, fromNamespaced);
    ECON.onMessage(msg, fromNamespaced);
  }

  function boot() {
    ensureUiBars();

    // Boot each module
    NEWS.boot();
    ECON.boot();

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

    // storage sync (both cfg types)
    window.addEventListener("storage", (e) => {
      if (!e || !e.key) return;
      // NEWS
      if (e.key.startsWith("rlc_ticker_cfg_v1")) {
        const stored = readJson(KEY ? `rlc_ticker_cfg_v1:${KEY}` : "rlc_ticker_cfg_v1") || readJson("rlc_ticker_cfg_v1");
        if (stored) NEWS.applyCfg(stored, false);
      }
      // ECON
      if (e.key.startsWith("rlc_econ_cfg_v1")) {
        const stored = readJson(KEY ? `rlc_econ_cfg_v1:${KEY}` : "rlc_econ_cfg_v1") || readJson("rlc_econ_cfg_v1");
        if (stored) ECON.applyCfg(stored, false);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
