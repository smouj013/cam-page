/* econTickerControl.js — RLC Econ Ticker Control v1.0.0 (HARDENED KEY+LEGACY + MULTI-BUS + COPY URL)
   ✅ Solo para control.html
   ✅ Guarda config en localStorage (por key y legacy)
   ✅ Emite config por BroadcastChannel (namespaced + legacy + base) + postMessage fallback
   ✅ Soporta #ctlEconCopyUrl para generar URL del player con params del econ ticker
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const LOAD_GUARD = "__RLC_ECON_TICKER_CONTROL_LOADED_V100";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  const BUS_BASE = "rlc_bus_v1";
  const CFG_KEY_BASE = "rlc_econ_cfg_v1";

  const qs = (s, r = document) => r.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const safeStr = (v) => (typeof v === "string") ? v.trim() : "";
  const num = (v, fb) => {
    const n = parseFloat(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fb;
  };

  function parseParams() {
    const u = new URL(location.href);
    return { key: safeStr(u.searchParams.get("key") || "") };
  }

  const P = parseParams();
  const KEY = P.key;

  const BUS_NS = KEY ? `${BUS_BASE}:${KEY}` : BUS_BASE;
  const BUS_LEGACY = BUS_BASE;
  const BUS_BASE_ONLY = BUS_BASE;

  const bcNs = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS_NS) : null;
  const bcLegacy = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_LEGACY) : null;
  const bcBase = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_BASE_ONLY) : null;

  const CFG_KEY_NS = KEY ? `${CFG_KEY_BASE}:${KEY}` : CFG_KEY_BASE;
  const CFG_KEY_LEGACY = CFG_KEY_BASE;

  const DEFAULTS = {
    enabled: true,
    speedPxPerSec: 60,
    refreshMins: 2,
    topPx: 10,
    hideOnVote: true,
    mode: "daily",     // daily|sinceLast
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
      { id:"tsla", label:"TSLA", stooq:"tsla.us", kind:"stock", currency:"USD", decimals:2, country:"US", tz:"America/New_York", iconSlug:"tesla", domain:"tesla.com" }
    ]
  };

  function normalizeMode(v) {
    const s = safeStr(v).toLowerCase();
    return (s === "sinceLast") ? "sinceLast" : "daily";
  }

  function normalizeCfg(inCfg) {
    const c = Object.assign({}, DEFAULTS, inCfg || {});
    c.enabled = (c.enabled !== false);
    c.speedPxPerSec = clamp(num(c.speedPxPerSec, DEFAULTS.speedPxPerSec), 20, 140);
    c.refreshMins = clamp(num(c.refreshMins, DEFAULTS.refreshMins), 1, 20);
    c.topPx = clamp(num(c.topPx, DEFAULTS.topPx), 0, 120);
    c.hideOnVote = (c.hideOnVote !== false);
    c.mode = normalizeMode(c.mode);
    c.showClocks = (c.showClocks !== false);

    if (!Array.isArray(c.items)) c.items = DEFAULTS.items.slice();
    if (!Array.isArray(c.clocks)) c.clocks = DEFAULTS.clocks.slice();

    return c;
  }

  function readCfgFirst() {
    try {
      const raw1 = localStorage.getItem(CFG_KEY_NS);
      if (raw1) return JSON.parse(raw1);
    } catch (_) {}
    try {
      const raw2 = localStorage.getItem(CFG_KEY_LEGACY);
      if (raw2) return JSON.parse(raw2);
    } catch (_) {}
    return null;
  }

  function writeCfgEverywhere(cfg) {
    const raw = JSON.stringify(cfg);
    try { localStorage.setItem(CFG_KEY_NS, raw); } catch (_) {}
    try { localStorage.setItem(CFG_KEY_LEGACY, raw); } catch (_) {}
  }

  function clearCfgEverywhere() {
    try { localStorage.removeItem(CFG_KEY_NS); } catch (_) {}
    try { localStorage.removeItem(CFG_KEY_LEGACY); } catch (_) {}
  }

  function sendCfg(cfg) {
    const msg = {
      type: "ECON_CFG",
      cfg,
      ts: Date.now(),
      ...(KEY ? { key: KEY } : {})
    };

    try { bcNs && bcNs.postMessage(msg); } catch (_) {}
    try { bcLegacy && bcLegacy.postMessage(msg); } catch (_) {}
    try { bcBase && bcBase.postMessage(msg); } catch (_) {}

    try { window.postMessage(msg, "*"); } catch (_) {}
    try { localStorage.setItem("__rlc_econ_ping", String(Date.now())); } catch (_) {}
  }

  function setStatus(text, ok = true) {
    const el = qs("#ctlEconStatus");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("pill--ok", !!ok);
    el.classList.toggle("pill--bad", !ok);
  }

  function applyUIFromCfg(cfg) {
    const c = normalizeCfg(cfg);

    const on = qs("#ctlEconOn");
    const speed = qs("#ctlEconSpeed");
    const refresh = qs("#ctlEconRefresh");
    const top = qs("#ctlEconTop");
    const hideOnVote = qs("#ctlEconHideOnVote");
    const mode = qs("#ctlEconMode");
    const clocks = qs("#ctlEconClocks");
    const itemsTa = qs("#ctlEconItems");

    if (on) on.value = (c.enabled ? "on" : "off");
    if (speed) speed.value = String(c.speedPxPerSec);
    if (refresh) refresh.value = String(c.refreshMins);
    if (top) top.value = String(c.topPx);
    if (hideOnVote) hideOnVote.value = (c.hideOnVote ? "on" : "off");
    if (mode) mode.value = c.mode;
    if (clocks) clocks.value = (c.showClocks ? "on" : "off");

    if (itemsTa) itemsTa.value = JSON.stringify(c.items, null, 2);

    const where = KEY ? `KEY:${KEY}` : "SIN KEY";
    setStatus(c.enabled ? `Econ: ON · ${where}` : `Econ: OFF · ${where}`, c.enabled);
  }

  function safeJsonParse(s, fb) {
    try {
      const o = JSON.parse(String(s || ""));
      return (o && typeof o === "object") ? o : fb;
    } catch (_) { return fb; }
  }

  function collectCfgFromUI() {
    const on = qs("#ctlEconOn")?.value || "on";
    const speed = num(qs("#ctlEconSpeed")?.value, DEFAULTS.speedPxPerSec);
    const refresh = num(qs("#ctlEconRefresh")?.value, DEFAULTS.refreshMins);
    const topPx = num(qs("#ctlEconTop")?.value, DEFAULTS.topPx);
    const hideOnVote = (qs("#ctlEconHideOnVote")?.value || "on") !== "off";
    const mode = safeStr(qs("#ctlEconMode")?.value || DEFAULTS.mode);
    const showClocks = (qs("#ctlEconClocks")?.value || "on") !== "off";

    const itemsTa = qs("#ctlEconItems");
    let items = undefined;
    if (itemsTa) {
      const parsed = safeJsonParse(itemsTa.value, null);
      if (Array.isArray(parsed)) items = parsed;
    }

    return normalizeCfg({
      enabled: (on !== "off"),
      speedPxPerSec: speed,
      refreshMins: refresh,
      topPx,
      hideOnVote,
      mode,
      showClocks,
      ...(Array.isArray(items) ? { items } : {})
    });
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        ta.style.top = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return !!ok;
      } catch (_) { return false; }
    }
  }

  function buildPlayerUrlWithEcon(cfg) {
    const u = new URL(location.href);
    u.pathname = u.pathname.replace(/[^/]*$/, "index.html");

    if (KEY) u.searchParams.set("key", KEY);

    u.searchParams.set("econ", cfg.enabled ? "1" : "0");
    u.searchParams.set("econSpeed", String(cfg.speedPxPerSec));
    u.searchParams.set("econRefresh", String(cfg.refreshMins));
    u.searchParams.set("econTop", String(cfg.topPx));
    u.searchParams.set("econHideOnVote", cfg.hideOnVote ? "1" : "0");
    u.searchParams.set("econMode", cfg.mode);
    u.searchParams.set("econClocks", cfg.showClocks ? "1" : "0");

    return u.toString();
  }

  let tDeb = 0;
  function debounce(fn, ms = 160) {
    return () => {
      try { clearTimeout(tDeb); } catch (_) {}
      tDeb = setTimeout(fn, ms);
    };
  }

  function boot() {
    if (!qs("#ctlEconApply") || !qs("#ctlEconOn")) return;

    const saved = normalizeCfg(readCfgFirst() || DEFAULTS);
    writeCfgEverywhere(saved);
    applyUIFromCfg(saved);

    const doApply = (persist = true) => {
      const cfg = collectCfgFromUI();
      if (persist) writeCfgEverywhere(cfg);
      sendCfg(cfg);
      applyUIFromCfg(cfg);
    };

    qs("#ctlEconApply")?.addEventListener("click", () => doApply(true));

    qs("#ctlEconReset")?.addEventListener("click", () => {
      clearCfgEverywhere();
      const cfg = normalizeCfg(DEFAULTS);
      writeCfgEverywhere(cfg);
      sendCfg(cfg);
      applyUIFromCfg(cfg);
    });

    qs("#ctlEconCopyUrl")?.addEventListener("click", async () => {
      const cfg = collectCfgFromUI();
      const url = buildPlayerUrlWithEcon(cfg);
      const ok = await copyToClipboard(url);
      setStatus(ok ? "URL econ copiada ✅" : "No se pudo copiar ❌", ok);
      setTimeout(() => applyUIFromCfg(cfg), 900);
    });

    const liveEls = [
      "#ctlEconOn",
      "#ctlEconSpeed",
      "#ctlEconRefresh",
      "#ctlEconTop",
      "#ctlEconHideOnVote",
      "#ctlEconMode",
      "#ctlEconClocks",
      "#ctlEconItems"
    ];

    const applyDebounced = debounce(() => doApply(true), 180);

    for (const sel of liveEls) {
      const el = qs(sel);
      if (!el) continue;

      el.addEventListener("change", () => doApply(true));
      el.addEventListener("input", () => applyDebounced());
    }

    window.addEventListener("storage", (e) => {
      if (!e || !e.key) return;
      if (e.key === CFG_KEY_NS || e.key === CFG_KEY_LEGACY) {
        const c = readCfgFirst();
        if (c) applyUIFromCfg(c);
      }
    });

    try { sendCfg(saved); } catch (_) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
