/* newsTicker.js — RLC Global News Ticker v1.6.0
   ✅ KEY namespace (bus + storage + cache + translations)
   ✅ Fuentes: GDELT + RSS (Google News, BBC, DW, Guardian)
   ✅ Bilingüe: EN + ES (MyMemory) + cache local + translateMax por refresh
   ✅ Toggle:
      - ?ticker=0 (OFF) / ?ticker=1 (FORCE ON)
      - ?tickerBilingual=0/1
      - ?tickerSources=gdelt,googlenews,bbc,dw,guardian
      - ?tickerTranslateMax=10
      - ?tickerSpan=1d / 12h / 30min / 1w ...
      - ?tickerDebug=1
   ✅ Split layout: NEWS derecha + ECON izquierda (>=980px) sin sumar alturas (RLCUiBars group)
   ✅ NO inyecta CSS (usa styles.css)
   ✅ Sanitiza URLs (evita javascript:/data:)
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const LOAD_GUARD = "__RLC_NEWS_TICKER_LOADED_V160";
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
  const log = (...a) => { if (DEBUG) console.log("[RLC:NEWS]", ...a); };

  function keyOk(msg, isMainChannel) {
    if (!KEY) return true;
    if (isMainChannel) return true;
    return !!(msg && msg.key === KEY);
  }

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

  function cfgFromUrl() {
    const out = {};

    // Forzar ON
    if (P.ticker === "1" || P.ticker === "true") out.enabled = true;

    if (P.lang === "es" || P.lang === "en" || P.lang === "auto") out.lang = P.lang;
    if (P.speed) out.speedPxPerSec = clamp(num(P.speed, DEFAULTS.speedPxPerSec), 20, 140);
    if (P.refresh) out.refreshMins = clamp(num(P.refresh, DEFAULTS.refreshMins), 3, 60);
    if (P.top) out.topPx = clamp(num(P.top, DEFAULTS.topPx), 0, 120);
    if (P.hideOnVote === "0") out.hideOnVote = false;
    if (P.hideOnVote === "1") out.hideOnVote = true;
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
    return readJson(CFG_KEY_NS) || readJson(CFG_KEY_LEGACY) || null;
  }
  function writeCfgCompat(cfg) {
    try { writeJson(CFG_KEY_NS, cfg); } catch (_) {}
    try { writeJson(CFG_KEY_LEGACY, cfg); } catch (_) {}
  }

  let CFG = normalizeCfg(Object.assign({}, DEFAULTS, readCfgMerged() || {}, cfgFromUrl()));

  // ───────────────────────────────────────── RLCUiBars v2 (group)
  function ensureUiBars() {
    const exists = g.RLCUiBars && typeof g.RLCUiBars.set === "function" && typeof g.RLCUiBars.recalc === "function";
    if (exists && g.RLCUiBars.__rlcVer === 2) return;

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

  // ───────────────────────────────────────── Split
  const SPLIT_MQ = "(min-width: 980px)";
  const isSplit = () => {
    try { return !!window.matchMedia && window.matchMedia(SPLIT_MQ).matches; }
    catch (_) { return false; }
  };

  // ───────────────────────────────────────── UI
  function ensureUI() {
    ensureUiBars();

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
      g.RLCUiBars && g.RLCUiBars.set("news", {
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
    // filtra títulos no latinos (evita feeds raros)
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

  // ───────────────────────────────────────── Headlines: RSS/Atom
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

  // ───────────────────────────────────────── Render (marquee compatible styles.css)
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

    // Decide marquee si overflow
    const textWrap = marquee.parentElement;
    const vw = textWrap ? (textWrap.clientWidth || 800) : 800;

    // medir ancho del 1er segmento
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

  // ───────────────────────────────────────── Refresh loop
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

    try {
      if (bcMain) bcMain.onmessage = (ev) => onBusMessage(ev?.data, true);
      if (bcLegacy) bcLegacy.onmessage = (ev) => onBusMessage(ev?.data, false);
    } catch (_) {}

    window.addEventListener("message", (ev) => {
      const msg = ev?.data;
      if (!msg || typeof msg !== "object") return;
      onBusMessage(msg, false);
    });

    window.addEventListener("storage", (e) => {
      if (!e || !e.key) return;
      if (e.key === CFG_KEY_NS || e.key === CFG_KEY_LEGACY) {
        const stored = readCfgMerged();
        if (stored) applyCfg(stored, false);
      }
    });

    // Re-registro de barra si cambia split
    try {
      const mm = window.matchMedia && window.matchMedia(SPLIT_MQ);
      if (mm) {
        const onCh = () => { registerBar(CFG.enabled); try { g.RLCUiBars && g.RLCUiBars.recalc(); } catch (_) {} };
        if (mm.addEventListener) mm.addEventListener("change", onCh);
        else if (mm.addListener) mm.addListener(onCh);
      }
    } catch (_) {}

    setupHideOnVote();
    watchForVoteBox();

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
