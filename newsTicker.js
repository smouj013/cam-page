/* newsTicker.js — RLC Global News Ticker v1.2.0 (CONTROL + STORAGE + ROBUST)
   ✅ Inserta ticker en #stage .layer-ui (o fallback)
   ✅ Gratis (GDELT) + CORS robust (directo → allorigins → r.jina.ai)
   ✅ Cache local (titulares) para resiliencia
   ✅ Config desde Control Room:
      - localStorage: rlc_ticker_cfg_v1
      - BroadcastChannel: rlc_bus_v1, msg { type:"TICKER_CFG", cfg }
   ✅ URL params (prioridad más alta):
      ?ticker=0
      ?tickerLang=es|en|auto
      ?tickerSpeed=70
      ?tickerRefresh=10
      ?tickerTop=12
      ?tickerHideOnVote=0
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const LOAD_GUARD = "__RLC_NEWS_TICKER_LOADED_V120";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  const BUS = "rlc_bus_v1";
  const CFG_KEY = "rlc_ticker_cfg_v1";
  const CACHE_KEY = "rlc_ticker_cache_v1"; // { ts, lang, items }

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
      hideOnVote: safeStr(u.searchParams.get("tickerHideOnVote") || "")
    };
  }

  const P = parseParams();
  if (P.ticker === "0") return;

  const langAuto = (navigator.language || "").toLowerCase().startsWith("es") ? "es" : "en";

  const DEFAULTS = {
    enabled: true,
    lang: "auto",           // auto|es|en
    speedPxPerSec: 55,      // 20..140
    refreshMins: 12,        // 3..60
    topPx: 10,              // 0..120
    hideOnVote: true
  };

  function cfgFromUrl() {
    const out = {};
    if (P.lang === "es" || P.lang === "en" || P.lang === "auto") out.lang = P.lang;
    if (P.speed) out.speedPxPerSec = clamp(num(P.speed, DEFAULTS.speedPxPerSec), 20, 140);
    if (P.refresh) out.refreshMins = clamp(num(P.refresh, DEFAULTS.refreshMins), 3, 60);
    if (P.top) out.topPx = clamp(num(P.top, DEFAULTS.topPx), 0, 120);
    if (P.hideOnVote === "0") out.hideOnVote = false;
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
    return c;
  }

  // Prioridad: defaults <- localStorage <- URL
  let CFG = normalizeCfg(Object.assign({}, DEFAULTS, readJson(CFG_KEY) || {}, cfgFromUrl()));

  const API = {
    gdelt: {
      endpoint: "https://api.gdeltproject.org/api/v2/doc/doc",
      // queries “safe” (sin términos sensibles/violentos explícitos) pero útiles
      query_es: 'internacional OR mundo OR "última hora" OR cumbre OR economía OR tecnología OR ciencia OR clima OR salud OR mercados',
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

/* ✅ Empuja overlays de arriba para que queden por debajo del ticker */
:root{
  --rlcTickerH: 34px;
  --rlcTickerGap: 10px;
}
#voteBox,
.vote{
  top: calc(max(12px, env(safe-area-inset-top)) + var(--rlcTickerTop, 10px) + var(--rlcTickerH, 34px) + var(--rlcTickerGap, 10px)) !important;
}

/* Intento seguro para overlays de anuncios (si existen con estos IDs comunes) */
#adsBox, #adBox, #adsNotice, #adNotice, #rlcAdsBox, #rlcAdBox, #rlcAdsNotice, #rlcAdNotice, #rlcAdsOverlay, #rlcAdOverlay{
  top: calc(max(12px, env(safe-area-inset-top)) + var(--rlcTickerTop, 10px) + var(--rlcTickerH, 34px) + var(--rlcTickerGap, 10px)) !important;
}
`.trim();

    document.head.appendChild(st);
  }

  function ensureUI() {
    injectStyles();

    let root = qs("#rlcNewsTicker");
    if (root) return root;

    const host =
      qs("#stage .layer.layer-ui") ||
      qs("#stage .layer-ui") ||
      qs("#stage") ||
      document.body;

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

    // Si se oculta, no empujamos overlays
    if (!on) {
      root.style.setProperty("--rlcTickerH", `0px`);
      document.documentElement.style.setProperty("--rlcTickerH", `0px`);
    } else {
      root.style.setProperty("--rlcTickerH", `34px`);
      document.documentElement.style.setProperty("--rlcTickerH", `34px`);
    }
  }

  // ───────────────────────────────────────── Fetch (robusto)
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
        // parse directo
        try { return JSON.parse(txt); } catch (_) {}
        // intenta recortar JSON si viene envuelto
        const a = txt.indexOf("{");
        const b = txt.lastIndexOf("}");
        if (a >= 0 && b > a) return JSON.parse(txt.slice(a, b + 1));
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
    if (t.length < 14) return "";
    if (t.length > 140) t = t.slice(0, 137).trim() + "…";
    return t;
  }

  function normalizeSource(a) {
    const domain = safeStr(a?.domain || a?.source || "");
    const sc = safeStr(a?.sourceCountry || "");
    const src = domain || sc || "";
    if (!src) return "NEWS";
    // limpia dominio tipo "www.bbc.co.uk" => "BBC.CO.UK"
    const cleaned = src.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
    return cleaned.toUpperCase().slice(0, 22);
  }

  async function getHeadlines() {
    const lang = (CFG.lang === "auto") ? langAuto : CFG.lang;
    const q = (lang === "es") ? API.gdelt.query_es : API.gdelt.query_en;

    // DOC API (ArtList) — sin API key
    const url =
      `${API.gdelt.endpoint}` +
      `?query=${encodeURIComponent(q)}` +
      `&mode=ArtList` +
      `&format=json` +
      `&sort=hybrid` +
      `&maxrecords=${encodeURIComponent(String(API.maxItems * 2))}`;

    const data = await fetchJsonRobust(url);

    const articles = Array.isArray(data?.articles) ? data.articles
                   : Array.isArray(data?.results) ? data.results
                   : [];

    const mapped = articles.map(a => {
      const title = cleanTitle(a?.title || a?.name || "");
      const link  = safeStr(a?.url || a?.link || "");
      if (!title || !link) return null;
      return { title, url: link, source: normalizeSource(a) };
    }).filter(Boolean);

    const uniq = uniqBy(mapped, x => (x.title + "|" + x.url).toLowerCase()).slice(0, API.maxItems);
    return uniq;
  }

  // ───────────────────────────────────────── Render (loop suave)
  function setLabel(root, lang) {
    const label = qs("#rlcNewsTickerLabel", root);
    if (label) label.textContent = (lang === "en") ? "NEWS" : "NOTICIAS";
  }

  function buildItemsDOM(items, lang) {
    const list = (Array.isArray(items) && items.length) ? items : [
      {
        title: (lang === "es")
          ? "Conectando a noticias internacionales…"
          : "Connecting to international news…",
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

    // reset
    track.style.animation = "none";
    seg1.innerHTML = "";
    seg2.innerHTML = "";

    const frag = buildItemsDOM(items, lang);
    seg1.appendChild(frag);

    // si el contenido es corto, repetimos dentro del seg1 hasta cubrir
    const vw = viewport ? (viewport.clientWidth || 900) : 900;

    let guard = 0;
    while ((seg1.scrollWidth || 0) < vw * 1.2 && guard < 8) {
      // duplica contenido del seg1
      seg1.innerHTML += seg1.innerHTML;
      guard++;
    }

    // clona seg1 en seg2 para loop perfecto
    seg2.innerHTML = seg1.innerHTML;

    // calcula duración / end
    const segW = Math.max(1200, seg1.scrollWidth || 1200);
    const endPx = -segW;
    const durSec = Math.max(18, Math.min(220, Math.abs(endPx) / CFG.speedPxPerSec));

    track.style.setProperty("--rlcTickerEnd", `${endPx}px`);
    track.style.setProperty("--rlcTickerDur", `${durSec}s`);

    requestAnimationFrame(() => { track.style.animation = ""; });
  }

  // ───────────────────────────────────────── Hide on vote
  let voteObs = null;

  function setupHideOnVote() {
    try { voteObs?.disconnect(); } catch (_) {}
    voteObs = null;

    const vote = qs("#voteBox");
    if (!vote) return;

    const apply = () => {
      if (!CFG.enabled) { setVisible(false); return; }
      if (!CFG.hideOnVote) { setVisible(true); return; }
      const isVoteHidden = vote.classList.contains("hidden");
      // Si voto visible => ocultar ticker
      setVisible(isVoteHidden);
    };

    apply();

    voteObs = new MutationObserver(apply);
    voteObs.observe(vote, { attributes: true, attributeFilter: ["class"] });
  }

  // ───────────────────────────────────────── Cache
  function readCache() {
    const c = readJson(CACHE_KEY);
    if (!c || typeof c !== "object") return null;
    if (!Array.isArray(c.items)) return null;
    return c;
  }

  function writeCache(lang, items) {
    writeJson(CACHE_KEY, { ts: Date.now(), lang, items });
  }

  // ───────────────────────────────────────── Refresh loop
  let refreshTimer = null;
  let refreshInFlight = false;

  async function refresh(force = false) {
    if (!CFG.enabled) { setVisible(false); return; }
    setVisible(true);

    const lang = (CFG.lang === "auto") ? langAuto : CFG.lang;

    // cache-first si no force
    if (!force) {
      const cache = readCache();
      const maxAge = Math.max(2, CFG.refreshMins) * 60 * 1000;
      if (cache && cache.lang === lang && (Date.now() - (cache.ts || 0) <= maxAge)) {
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
    } catch (_) {
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

    // primera carga: si hay cache, pinta rápido
    const cache = readCache();
    if (cache?.items?.length) setTickerItems(cache.items);
    refresh(false);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
