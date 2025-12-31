/* newsTicker.js — RLC Global News Ticker v1.2.2 (FIX GDELT OR + FALLBACK RSS + KEY NAMESPACE)
   ✅ FIX: GDELT requiere paréntesis cuando usas OR (si no, responde error y viene vacío)
   ✅ mode=artlist (case “safe”)
   ✅ Fallback si GDELT falla: Google News RSS (WORLD + when:xx)
   ✅ KEY namespace: cfg/cache por key + escucha BC namespaced y legacy
   ✅ Debug opcional: ?tickerDebug=1
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const LOAD_GUARD = "__RLC_NEWS_TICKER_LOADED_V122";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  // ───────────────────────────────────────── Params / Key namespace
  function safeStr(v) { return (typeof v === "string") ? v.trim() : ""; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function num(v, fb) {
    const n = parseFloat(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fb;
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
      span: safeStr(u.searchParams.get("tickerSpan") || ""),     // 12h,1d,3d,1w...
      debug: safeStr(u.searchParams.get("tickerDebug") || "")
    };
  }

  const P = parseParams();
  if (P.ticker === "0") return;

  const KEY = P.key;

  const BUS_BASE = "rlc_bus_v1";
  const CFG_KEY_BASE = "rlc_ticker_cfg_v1";
  const CACHE_KEY_BASE = "rlc_ticker_cache_v1";

  const BUS = KEY ? `${BUS_BASE}:${KEY}` : BUS_BASE;
  const BUS_LEGACY = BUS_BASE;

  const CFG_KEY = KEY ? `${CFG_KEY_BASE}:${KEY}` : CFG_KEY_BASE;
  const CFG_KEY_LEGACY = CFG_KEY_BASE;

  const CACHE_KEY = KEY ? `${CACHE_KEY_BASE}:${KEY}` : CACHE_KEY_BASE;
  const CACHE_KEY_LEGACY = CACHE_KEY_BASE;

  const bcMain = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS) : null;
  const bcLegacy = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_LEGACY) : null;

  const DEBUG = (P.debug === "1" || P.debug === "true");
  const log = (...a) => { if (DEBUG) console.log("[RLC:TICKER]", ...a); };

  const langAuto = (navigator.language || "").toLowerCase().startsWith("es") ? "es" : "en";

  // ───────────────────────────────────────── Storage helpers (first-hit)
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
  function readJsonFirst(keys) {
    for (const k of keys) {
      const o = readJson(k);
      if (o) return o;
    }
    return null;
  }

  // ───────────────────────────────────────── Defaults / cfg
  const DEFAULTS = {
    enabled: true,
    lang: "auto",           // auto|es|en
    speedPxPerSec: 55,      // 20..140
    refreshMins: 12,        // 3..60
    topPx: 10,              // 0..120
    hideOnVote: true,
    timespan: "1d"          // GDELT timespan default (fresco)
  };

  function normalizeTimespan(s) {
    const t = safeStr(s).toLowerCase();
    if (!t) return DEFAULTS.timespan;
    // 15min, 2h, 12h, 1d, 3d, 1w, 2w, 1m...
    if (/^\d+(min|h|d|w|m)$/.test(t)) return t;
    return DEFAULTS.timespan;
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

  function normalizeCfg(inCfg) {
    const c = Object.assign({}, DEFAULTS, inCfg || {});
    c.enabled = (c.enabled !== false);
    c.lang = (c.lang === "es" || c.lang === "en" || c.lang === "auto") ? c.lang : "auto";
    c.speedPxPerSec = clamp(num(c.speedPxPerSec, DEFAULTS.speedPxPerSec), 20, 140);
    c.refreshMins = clamp(num(c.refreshMins, DEFAULTS.refreshMins), 3, 60);
    c.topPx = clamp(num(c.topPx, DEFAULTS.topPx), 0, 120);
    c.hideOnVote = (c.hideOnVote !== false);
    c.timespan = normalizeTimespan(c.timespan);
    return c;
  }

  // Prioridad: defaults <- storage (keyed) <- storage (legacy) <- URL
  let CFG = normalizeCfg(Object.assign(
    {},
    DEFAULTS,
    readJsonFirst([CFG_KEY, CFG_KEY_LEGACY]) || {},
    cfgFromUrl()
  ));

  // ───────────────────────────────────────── Providers
  const API = {
    gdelt: {
      endpoint: "https://api.gdeltproject.org/api/v2/doc/doc",
      // queries “safe” (sin acentos para evitar edge-cases raros)
      query_es: 'internacional OR mundo OR "ultima hora" OR cumbre OR economia OR tecnologia OR ciencia OR clima OR salud OR mercados',
      query_en: 'international OR world OR "breaking news" OR summit OR economy OR technology OR science OR climate OR health OR markets'
    },
    maxItems: 22
  };

  function wrapOrQuery(q) {
    const s = safeStr(q);
    if (!s) return s;
    // GDELT: OR => requiere paréntesis
    if (/\bOR\b/i.test(s)) return `(${s})`;
    return s;
  }

  // ───────────────────────────────────────── UI / CSS
  const qs = (s, r = document) => r.querySelector(s);

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

/* Empuja overlays superiores por debajo del ticker */
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

    const h = on ? 34 : 0;
    root.style.setProperty("--rlcTickerH", `${h}px`);
    document.documentElement.style.setProperty("--rlcTickerH", `${h}px`);
  }

  // ───────────────────────────────────────── Fetch robust
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

    // JSONP callback(...)
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

  async function fetchTextRobust(url) {
    const tries = [
      () => fetchText(url),
      () => fetchText(allOrigins(url)),
      () => fetchText(jina(url))
    ];
    let lastErr = null;

    for (const fn of tries) {
      try { return await fn(); }
      catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("fetchTextRobust failed");
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
    if (t.length > 140) t = t.slice(0, 137).trim() + "…";
    return t;
  }

  function normalizeSourceFromDomain(a) {
    const domain = safeStr(a?.domain || a?.source || "");
    const sc = safeStr(a?.sourceCountry || a?.sourcecountry || "");
    const src = domain || sc || "";
    if (!src) return "NEWS";
    const cleaned = src.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
    return cleaned.toUpperCase().slice(0, 22);
  }

  // ───────────────────────────────────────── Provider A: GDELT
  async function getHeadlinesGdelt() {
    const lang = (CFG.lang === "auto") ? langAuto : CFG.lang;
    const qRaw = (lang === "es") ? API.gdelt.query_es : API.gdelt.query_en;

    // ✅ FIX CLAVE: envolver OR con paréntesis
    const q = wrapOrQuery(qRaw);

    const url =
      `${API.gdelt.endpoint}` +
      `?query=${encodeURIComponent(q)}` +
      `&mode=artlist` +
      `&format=json` +
      `&sort=HybridRel` +
      `&timespan=${encodeURIComponent(CFG.timespan)}` +
      `&maxrecords=${encodeURIComponent(String(API.maxItems * 2))}`;

    log("GDELT URL:", url);

    const data = await fetchJsonRobust(url);

    const errMsg = safeStr(data?.error || data?.message || data?.status || "");
    if (errMsg && /error|invalid|failed|must be surrounded/i.test(errMsg)) {
      throw new Error(errMsg || "GDELT error");
    }

    const articles = Array.isArray(data?.articles) ? data.articles
      : Array.isArray(data?.results) ? data.results
      : Array.isArray(data?.artlist) ? data.artlist
      : [];

    const mapped = articles.map(a => {
      const title = cleanTitle(a?.title || a?.name || "");
      const link = safeStr(a?.url || a?.link || a?.url_mobile || "");
      if (!title || !link) return null;
      return { title, url: link, source: normalizeSourceFromDomain(a) };
    }).filter(Boolean);

    const uniq = uniqBy(mapped, x => (x.title + "|" + x.url).toLowerCase()).slice(0, API.maxItems);

    if (!uniq.length) throw new Error("GDELT: 0 items");
    return uniq;
  }

  // ───────────────────────────────────────── Provider B: Google News RSS (fallback)
  function googleRegion(lang) {
    if (lang === "es") return { hl: "es", gl: "ES", ceid: "ES:es", term: "mundo" };
    return { hl: "en-US", gl: "US", ceid: "US:en", term: "world" };
  }

  function timespanToGoogleWhen(ts) {
    const t = safeStr(ts).toLowerCase();
    const m = t.match(/^(\d+)(min|h|d|w|m)$/);
    if (!m) return "1d";
    const n = clamp(parseInt(m[1], 10) || 1, 1, 30);
    const unit = m[2];

    if (unit === "min") return "1h";           // google "when:" no siempre traga minutos bien
    if (unit === "h") return `${n}h`;
    if (unit === "d") return `${n}d`;
    if (unit === "w") return `${n * 7}d`;
    if (unit === "m") return `${n * 30}d`;     // mes -> días aprox
    return "1d";
  }

  function parseGoogleTitleAndSource(fullTitle) {
    // google suele traer: "Titular - Fuente"
    const t = cleanTitle(fullTitle);
    if (!t) return { title: "", source: "NEWS" };
    const idx = t.lastIndexOf(" - ");
    if (idx > 18) {
      const title = cleanTitle(t.slice(0, idx));
      const src = safeStr(t.slice(idx + 3)).toUpperCase().slice(0, 22) || "NEWS";
      return { title: title || t, source: src };
    }
    return { title: t, source: "NEWS" };
  }

  async function getHeadlinesGoogleRss() {
    const lang = (CFG.lang === "auto") ? langAuto : CFG.lang;
    const r = googleRegion(lang);
    const when = timespanToGoogleWhen(CFG.timespan);

    // Search RSS: “world/mundo when:Xd/Xh”
    const q = `${r.term} when:${when}`;
    const url =
      `https://news.google.com/rss/search` +
      `?q=${encodeURIComponent(q)}` +
      `&hl=${encodeURIComponent(r.hl)}` +
      `&gl=${encodeURIComponent(r.gl)}` +
      `&ceid=${encodeURIComponent(r.ceid)}`;

    log("Google RSS URL:", url);

    const txt = await fetchTextRobust(url);
    const xml = new DOMParser().parseFromString(txt, "text/xml");
    const nodes = Array.from(xml.querySelectorAll("item"));

    const out = [];
    for (const it of nodes) {
      const rawTitle = it.querySelector("title")?.textContent || "";
      const link = it.querySelector("link")?.textContent || "";
      const srcTag = it.querySelector("source")?.textContent || "";

      const parsed = parseGoogleTitleAndSource(rawTitle);
      const title = parsed.title;
      const source = (safeStr(srcTag) || parsed.source || "NEWS").toUpperCase().slice(0, 22);
      const url2 = safeStr(link);

      if (!title || !url2) continue;
      out.push({ title, url: url2, source });
      if (out.length >= API.maxItems) break;
    }

    if (!out.length) throw new Error("Google RSS: 0 items");
    return out;
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
          ? "No hay titulares ahora (reintentando)…"
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
    domObs = new MutationObserver(() => {
      const vote = qs("#voteBox");
      if (vote) setupHideOnVote();
    });
    domObs.observe(document.documentElement, { childList: true, subtree: true });
  }

  // ───────────────────────────────────────── Cache (por key)
  function readCache() {
    const c = readJsonFirst([CACHE_KEY, CACHE_KEY_LEGACY]);
    if (!c || typeof c !== "object") return null;
    if (!Array.isArray(c.items)) return null;
    return c;
  }

  function writeCache(lang, items) {
    const payload = { ts: Date.now(), lang, items, timespan: CFG.timespan };
    writeJson(CACHE_KEY, payload);
    writeJson(CACHE_KEY_LEGACY, payload); // compat
  }

  // ───────────────────────────────────────── Refresh loop
  let refreshTimer = null;
  let refreshInFlight = false;

  async function getHeadlinesMerged() {
    // 1) GDELT
    try {
      const items = await getHeadlinesGdelt();
      // si viene muy pobre, intentamos complementar con RSS
      if (items.length >= 8) return items;
      try {
        const rss = await getHeadlinesGoogleRss();
        return uniqBy(items.concat(rss), x => (x.title + "|" + x.url).toLowerCase()).slice(0, API.maxItems);
      } catch (_) { return items; }
    } catch (e) {
      log("GDELT fail => fallback RSS:", e?.message || e);
      // 2) Google RSS
      const rss = await getHeadlinesGoogleRss();
      return rss;
    }
  }

  async function refresh(force = false) {
    if (!CFG.enabled) { setVisible(false); return; }
    setVisible(true);

    const lang = (CFG.lang === "auto") ? langAuto : CFG.lang;

    if (!force) {
      const cache = readCache();
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
      const items = await getHeadlinesMerged();
      log("items:", items?.length || 0);
      setTickerItems(items);
      writeCache(lang, items);
    } catch (e) {
      log("refresh error:", e?.message || e);
      const cache = readCache();
      if (cache?.items?.length) setTickerItems(cache.items);
      else setTickerItems([]); // placeholder “retrying”
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
      writeJson(CFG_KEY, CFG);
      writeJson(CFG_KEY_LEGACY, CFG); // compat
    }

    setVisible(!!CFG.enabled);

    setupHideOnVote();
    startTimer();
    refresh(true);

    log("apply cfg:", CFG);
  }

  // ───────────────────────────────────────── Boot
  function boot() {
    ensureUI();
    applyCfg(CFG, false);

    // Config desde Control Room (BC namespaced + legacy)
    try {
      const handler = (ev) => {
        const msg = ev?.data;
        if (!msg || typeof msg !== "object") return;
        if (msg.type === "TICKER_CFG" && msg.cfg && typeof msg.cfg === "object") {
          applyCfg(msg.cfg, true);
        }
      };
      if (bcMain) bcMain.addEventListener("message", handler);
      if (bcLegacy) bcLegacy.addEventListener("message", handler);
    } catch (_) {}

    // storage event (otra pestaña)
    window.addEventListener("storage", (e) => {
      if (!e) return;
      if (e.key === CFG_KEY || e.key === CFG_KEY_LEGACY) {
        const stored = readJsonFirst([CFG_KEY, CFG_KEY_LEGACY]);
        if (stored) applyCfg(stored, false);
      }
    });

    setupHideOnVote();
    watchForVoteBox();

    // pinta rápido con cache
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
