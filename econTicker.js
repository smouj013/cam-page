/* econTicker.js — RLC Global Econ Ticker v1.0.0 (FREE + KEY NAMESPACE + FLAGS + CLOCKS)
   ✅ KEY namespace (bus + storage + cache): rlc_bus_v1:{key}, rlc_econ_cfg_v1:{key}, rlc_econ_cache_v1:{key}
   ✅ Fuente FREE: Stooq (CSV) + robust fetch (direct -> AllOrigins -> r.jina.ai)
   ✅ Iconos FREE: Simple Icons (CDN) + favicon domain fallback + glyph fallback
   ✅ Hora + bandera por activo (timeZone + country)
   ✅ Hide on vote (#voteBox) + mismas CSS vars de tu ticker: --rlcTickerTop / --rlcTickerH

   URL params:
     - ?econ=0 (OFF)
     - ?econSpeed=55
     - ?econRefresh=2  (min)
     - ?econTop=10
     - ?econHideOnVote=0/1
     - ?econMode=daily|sinceLast
     - ?econClocks=0/1
     - ?econDebug=1
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const LOAD_GUARD = "__RLC_ECON_TICKER_LOADED_V100";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  const BUS_BASE = "rlc_bus_v1";
  const CFG_KEY_BASE = "rlc_econ_cfg_v1";
  const CACHE_KEY_BASE = "rlc_econ_cache_v1";

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
      econ: u.searchParams.get("econ") ?? "",
      speed: safeStr(u.searchParams.get("econSpeed") || ""),
      refresh: safeStr(u.searchParams.get("econRefresh") || ""),
      top: safeStr(u.searchParams.get("econTop") || ""),
      hideOnVote: safeStr(u.searchParams.get("econHideOnVote") || ""),
      mode: safeStr(u.searchParams.get("econMode") || ""),
      clocks: safeStr(u.searchParams.get("econClocks") || ""),
      debug: safeStr(u.searchParams.get("econDebug") || "")
    };
  }

  const P = parseParams();
  if (P.econ === "0") return;

  const KEY = P.key;

  const BUS_NS = KEY ? `${BUS_BASE}:${KEY}` : BUS_BASE;
  const BUS_LEGACY = BUS_BASE;

  const CFG_KEY_NS = KEY ? `${CFG_KEY_BASE}:${KEY}` : CFG_KEY_BASE;
  const CFG_KEY_LEGACY = CFG_KEY_BASE;

  const CACHE_KEY_NS = KEY ? `${CACHE_KEY_BASE}:${KEY}` : CACHE_KEY_BASE;
  const CACHE_KEY_LEGACY = CACHE_KEY_BASE;

  const bcMain = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS_NS) : null;
  const bcLegacy = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_LEGACY) : null;

  const DEBUG = (P.debug === "1" || P.debug === "true");
  const log = (...a) => { if (DEBUG) console.log("[RLC:ECON]", ...a); };

  function keyOk(msg, isMainChannel) {
    if (!KEY) return true;
    if (isMainChannel) return true;
    return !!(msg && msg.key === KEY);
  }

  // ───────────────────────────────────────── Defaults
  const DEFAULTS = {
    enabled: true,
    speedPxPerSec: 60,   // 20..140
    refreshMins: 2,      // 1..20 (Stooq + proxies: no spamear)
    topPx: 10,           // 0..120
    hideOnVote: true,
    mode: "daily",       // daily | sinceLast
    showClocks: true,

    // “market clocks” opcionales (chips a la izquierda)
    clocks: [
      { label: "MAD", country: "ES", tz: "Europe/Madrid" },
      { label: "NY",  country: "US", tz: "America/New_York" },
      { label: "LDN", country: "GB", tz: "Europe/London" },
      { label: "TYO", country: "JP", tz: "Asia/Tokyo" }
    ],

    // Watchlist (Stooq symbols)
    // Tipos comunes:
    // - Stocks USA: aapl.us, tsla.us, msft.us...
    // - FX: eurusd, usdjpy...
    // - Crypto: btcusd, ethusd...
    // - Index (a veces): ^spx
    // - Futuros (a veces): gc.f
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
    return (s === "sinceLast") ? "sinceLast" : "daily";
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
    if (P.speed) out.speedPxPerSec = clamp(num(P.speed, DEFAULTS.speedPxPerSec), 20, 140);
    if (P.refresh) out.refreshMins = clamp(num(P.refresh, DEFAULTS.refreshMins), 1, 20);
    if (P.top) out.topPx = clamp(num(P.top, DEFAULTS.topPx), 0, 120);
    if (P.hideOnVote === "0") out.hideOnVote = false;
    if (P.hideOnVote === "1") out.hideOnVote = true;
    if (P.mode) out.mode = normalizeMode(P.mode);
    if (P.clocks === "0") out.showClocks = false;
    if (P.clocks === "1") out.showClocks = true;
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

  // ───────────────────────────────────────── UI / CSS
  function injectStyles() {
    if (qs("#rlcEconTickerStyle")) return;

    const st = document.createElement("style");
    st.id = "rlcEconTickerStyle";
    st.textContent = `
#stage.stage{ position: relative; }

#rlcEconTicker{
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
#rlcEconTicker.hidden{ display:none !important; }

#rlcEconTicker .label{
  flex: 0 0 auto;
  height: 100%;
  display:flex;
  align-items:center;
  gap: 8px;
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
  display:flex;
  align-items:center;
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
  display:flex;
  align-items:center;
  gap: 18px;
  white-space: nowrap;
  will-change: transform;
  transform: translate3d(0,0,0);
  animation: rlcEconMove var(--rlcTickerDur, 60s) linear infinite;
}
#rlcEconTicker:hover .track{ animation-play-state: paused; }

#rlcEconTicker .seg{
  display:flex;
  align-items:center;
  gap: 18px;
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

/* Compat total con tu sistema: usa la MISMA altura/offset del ticker */
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
    return (qs("#stage") || qs("#app") || document.body);
  }

  function ensureUI() {
    injectStyles();

    let root = qs("#rlcEconTicker");
    if (root) return root;

    const host = pickHost();

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

    host.insertBefore(root, host.firstChild);
    return root;
  }

  function setVisible(on) {
    const root = ensureUI();
    if (!root) return;

    root.classList.toggle("hidden", !on);

    // IMPORTANTE: mismo contrato que tu news ticker (para offsets)
    if (!on) {
      root.style.setProperty("--rlcTickerH", `0px`);
      document.documentElement.style.setProperty("--rlcTickerH", `0px`);
    } else {
      root.style.setProperty("--rlcTickerH", `34px`);
      document.documentElement.style.setProperty("--rlcTickerH", `34px`);
    }
  }

  // ───────────────────────────────────────── Fetch robusto (igual filosofía)
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

  // ───────────────────────────────────────── Utils: flags + clocks + fmt
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

  // ───────────────────────────────────────── Icons (FREE)
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
  function iconFor(it) {
    const slug = safeStr(it.iconSlug);
    if (slug) return { type: "img", url: simpleIconUrl(slug) };
    const dom = safeStr(it.domain);
    if (dom) return { type: "img", url: faviconUrl(dom) };
    const glyph = safeStr(it.glyph) || guessGlyph(it.kind);
    return { type: "glyph", glyph };
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

  // ───────────────────────────────────────── Stooq fetch
  function stooqLastUrl(sym) {
    // Devuelve 1 fila con Close:
    // Symbol,Date,Time,Open,High,Low,Close,Volume
    // AAPL.US,2026-01-02,22:00:10,...,Close,...
    return `https://stooq.com/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlcv&h&e=csv`;
  }
  function stooqDailyUrl(sym) {
    // Serie diaria (para prev close)
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

    // Date,Open,High,Low,Close,Volume
    const head = csvSplitRow(lines[0]);
    const idxClose = head.findIndex(h => h.toLowerCase() === "close");
    if (idxClose < 0) return null;

    const row1 = csvSplitRow(lines[1]);
    const row2 = csvSplitRow(lines[2]);

    const close1 = toNum(row1[idxClose]);
    const close2 = toNum(row2[idxClose]);
    if (!Number.isFinite(close1)) return null;

    // prev close es el close del día anterior si existe, si no, el mismo
    return Number.isFinite(close2) ? close2 : close1;
  }

  // ───────────────────────────────────────── Cache
  function cacheKey() {
    // cambia si cambia modo/lista
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

  // ───────────────────────────────────────── Build DOM
  function clampLen(s, max) {
    let t = safeStr(s).replace(/\s+/g, " ").trim();
    if (t.length > max) t = t.slice(0, Math.max(8, max - 1)).trim() + "…";
    return t;
  }

  function buildItemsDOM(model) {
    // model: { items: [...], clocks: [...] }
    const frag = document.createDocumentFragment();

    const addSepDot = () => {
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.setAttribute("aria-hidden", "true");
      return sep;
    };

    // clocks (si enabled)
    if (CFG.showClocks && Array.isArray(model.clocks) && model.clocks.length) {
      for (const c of model.clocks) {
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
        clk.textContent = `${c.label} ${fmtTime(c.tz)}`;

        meta.appendChild(flag);
        meta.appendChild(clk);

        a.appendChild(addSepDot());
        a.appendChild(meta);

        frag.appendChild(a);
      }
    }

    // activos
    for (const it of model.items || []) {
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
      clk.textContent = fmtTime(it.tz || "UTC");

      meta.appendChild(flag);
      meta.appendChild(clk);

      a.appendChild(addSepDot());
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

    root.style.setProperty("--rlcTickerTop", `${CFG.topPx}px`);
    document.documentElement.style.setProperty("--rlcTickerTop", `${CFG.topPx}px`);

    track.style.animation = "none";
    seg1.innerHTML = "";
    seg2.innerHTML = "";

    seg1.appendChild(buildItemsDOM(model));

    const vw = viewport ? (viewport.clientWidth || 900) : 900;

    // si queda corto, duplica para llenar
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

  // ───────────────────────────────────────── Refresh loop
  let refreshTimer = null;
  let refreshInFlight = false;

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

        // defaults
        let price = null;
        let prev = null;
        let dt = "";
        let err = "";

        // Reusar cache para pintar algo si falla
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

        // textos
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

    // Orden original
    const order = new Map(items.map((x, i) => [x.stooq, i]));
    outItems.sort((a, b) => (order.get(a.stooq) ?? 0) - (order.get(b.stooq) ?? 0));

    // guarda cache (namespaced)
    writeCache(ck, map);

    return {
      clocks: CFG.clocks || [],
      items: outItems
    };
  }

  async function refresh(force = false) {
    if (!CFG.enabled) { setVisible(false); return; }
    setVisible(true);

    if (refreshInFlight) return;
    refreshInFlight = true;

    try {
      const model = await buildModel();
      setTickerItems(model);
    } catch (e) {
      log("refresh error:", e?.message || e);
      // si falla duro, intenta render mínimo desde cache
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

    if (msg.type === "ECON_CFG" && msg.cfg && typeof msg.cfg === "object") {
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

    setupHideOnVote();
    watchForVoteBox();

    // pinta rápido desde cache
    try { refresh(false); } catch (_) {}
    log("boot", { CFG, KEY, BUS_NS, CFG_KEY_NS });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
