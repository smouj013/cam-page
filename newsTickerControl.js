/* newsTickerControl.js — RLC Ticker Control v1.3.0 (HARDENED KEY+LEGACY + MULTI-BUS + COPY URL)
   ✅ Solo para control.html
   ✅ Guarda config en localStorage (por key y legacy + fallback sin key)
   ✅ Emite config por BroadcastChannel (namespaced + legacy + base) + postMessage fallback
   ✅ Soporta #ctlTickerCopyUrl para generar URL del player con params del ticker
   ✅ Debounce en input para no spamear BC
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const LOAD_GUARD = "__RLC_TICKER_CONTROL_LOADED_V130";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  const BUS_BASE = "rlc_bus_v1";
  const CFG_KEY_BASE = "rlc_ticker_cfg_v1";

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

  // ✅ Buses
  const BUS_NS = KEY ? `${BUS_BASE}:${KEY}` : BUS_BASE;
  const BUS_LEGACY = BUS_BASE;
  const BUS_BASE_ONLY = BUS_BASE;

  const bcNs = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS_NS) : null;
  const bcLegacy = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_LEGACY) : null;
  const bcBase = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_BASE_ONLY) : null;

  // ✅ Storage keys (HARDENED)
  // - Por key: CFG_KEY_BASE:key
  // - Legacy: CFG_KEY_BASE
  // - Fallback “sin key”: por si el player lee sólo base o sólo legacy
  const CFG_KEY_NS = KEY ? `${CFG_KEY_BASE}:${KEY}` : CFG_KEY_BASE;
  const CFG_KEY_LEGACY = CFG_KEY_BASE;
  const CFG_KEY_FALLBACK_NO_KEY = CFG_KEY_BASE; // igual que legacy, pero lo tratamos explícito
  const CFG_KEY_FALLBACK_NSLESS = CFG_KEY_BASE; // mismo; mantenemos por claridad

  // ✅ Defaults (deben casar con newsTicker.js)
  const DEFAULTS = {
    enabled: true,
    lang: "auto",           // auto|es|en
    speedPxPerSec: 55,      // 20..140
    refreshMins: 12,        // 3..60
    topPx: 10,              // 0..120
    hideOnVote: true,
    timespan: "1d",         // 1d|12h|30min|1w|1m...
    bilingual: true,        // si tu newsTicker.js lo soporta
    translateMax: 10        // si tu newsTicker.js lo soporta
  };

  function normalizeTimespan(v) {
    const t = safeStr(v).toLowerCase();
    if (!t) return DEFAULTS.timespan;
    // min/h/d/w/m
    if (/^\d+(min|h|d|w|m)$/.test(t)) return t;
    return DEFAULTS.timespan;
  }

  function normalizeCfg(inCfg) {
    const c = Object.assign({}, DEFAULTS, inCfg || {});
    c.enabled = (c.enabled !== false);

    const lang = safeStr(c.lang);
    c.lang = (lang === "es" || lang === "en" || lang === "auto") ? lang : "auto";

    c.speedPxPerSec = clamp(num(c.speedPxPerSec, DEFAULTS.speedPxPerSec), 20, 140);
    c.refreshMins = clamp(num(c.refreshMins, DEFAULTS.refreshMins), 3, 60);
    c.topPx = clamp(num(c.topPx, DEFAULTS.topPx), 0, 120);
    c.hideOnVote = (c.hideOnVote !== false);

    c.timespan = normalizeTimespan(c.timespan);

    // opcionales (si tu ticker los usa)
    c.bilingual = (c.bilingual !== false);
    c.translateMax = clamp(num(c.translateMax, DEFAULTS.translateMax), 0, 22);

    return c;
  }

  function readCfgFirst() {
    // ✅ prioriza NS, luego legacy
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
    // ✅ Guardar en NS (si hay KEY)
    try { localStorage.setItem(CFG_KEY_NS, raw); } catch (_) {}
    // ✅ Guardar en legacy/base (compat total)
    try { localStorage.setItem(CFG_KEY_LEGACY, raw); } catch (_) {}
  }

  function clearCfgEverywhere() {
    try { localStorage.removeItem(CFG_KEY_NS); } catch (_) {}
    try { localStorage.removeItem(CFG_KEY_LEGACY); } catch (_) {}
  }

  function sendCfg(cfg) {
    const msg = {
      type: "TICKER_CFG",
      cfg,
      ts: Date.now(),
      ...(KEY ? { key: KEY } : {})
    };

    // ✅ Emitir por todos los BC posibles
    try { bcNs && bcNs.postMessage(msg); } catch (_) {}
    try { bcLegacy && bcLegacy.postMessage(msg); } catch (_) {}
    try { bcBase && bcBase.postMessage(msg); } catch (_) {}

    // ✅ Fallback: postMessage (por si OBS/Chromium raro con BC)
    try { window.postMessage(msg, "*"); } catch (_) {}

    // ✅ Fallback: storage ping para tabs
    try { localStorage.setItem("__rlc_ticker_ping", String(Date.now())); } catch (_) {}
  }

  function setStatus(text, ok = true) {
    const el = qs("#ctlTickerStatus");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("pill--ok", !!ok);
    el.classList.toggle("pill--bad", !ok);
  }

  function applyUIFromCfg(cfg) {
    const c = normalizeCfg(cfg);

    const on = qs("#ctlTickerOn");
    const lang = qs("#ctlTickerLang");
    const speed = qs("#ctlTickerSpeed");
    const refresh = qs("#ctlTickerRefresh");
    const top = qs("#ctlTickerTop");
    const hideOnVote = qs("#ctlTickerHideOnVote");
    const span = qs("#ctlTickerSpan");

    // opcionales (si los añades al HTML en el futuro)
    const bilingualEl = qs("#ctlTickerBilingual");
    const transEl = qs("#ctlTickerTranslateMax");

    if (on) on.value = (c.enabled ? "on" : "off");
    if (lang) lang.value = c.lang;
    if (speed) speed.value = String(c.speedPxPerSec);
    if (refresh) refresh.value = String(c.refreshMins);
    if (top) top.value = String(c.topPx);
    if (hideOnVote) hideOnVote.value = (c.hideOnVote ? "on" : "off");
    if (span) span.value = c.timespan;

    if (bilingualEl) bilingualEl.value = (c.bilingual ? "on" : "off");
    if (transEl) transEl.value = String(c.translateMax);

    const where = KEY ? `KEY:${KEY}` : "SIN KEY";
    setStatus(c.enabled ? `Ticker: ON · ${where}` : `Ticker: OFF · ${where}`, c.enabled);
  }

  function collectCfgFromUI() {
    const on = qs("#ctlTickerOn")?.value || "on";
    const lang = qs("#ctlTickerLang")?.value || "auto";
    const speed = num(qs("#ctlTickerSpeed")?.value, DEFAULTS.speedPxPerSec);
    const refresh = num(qs("#ctlTickerRefresh")?.value, DEFAULTS.refreshMins);
    const topPx = num(qs("#ctlTickerTop")?.value, DEFAULTS.topPx);
    const hideOnVote = (qs("#ctlTickerHideOnVote")?.value || "on") !== "off";
    const timespan = safeStr(qs("#ctlTickerSpan")?.value || DEFAULTS.timespan);

    // opcionales si existieran
    const bilingualEl = qs("#ctlTickerBilingual");
    const transEl = qs("#ctlTickerTranslateMax");
    const bilingual = bilingualEl ? ((bilingualEl.value || "on") !== "off") : undefined;
    const translateMax = transEl ? num(transEl.value, DEFAULTS.translateMax) : undefined;

    return normalizeCfg({
      enabled: (on !== "off"),
      lang,
      speedPxPerSec: speed,
      refreshMins: refresh,
      topPx,
      hideOnVote,
      timespan,
      ...(typeof bilingual === "boolean" ? { bilingual } : {}),
      ...(Number.isFinite(translateMax) ? { translateMax } : {})
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

  function buildPlayerUrlWithTicker(cfg) {
    // ✅ Genera una URL del player (mismo origin/path base), con params ticker
    // - Si tú usas otra ruta distinta, ajusta aquí: "index.html" o "/cam-page/"
    const u = new URL(location.href);
    // Intento razonable: mismo directorio pero index.html
    u.pathname = u.pathname.replace(/[^/]*$/, "index.html");

    // Mantener key si existe
    if (KEY) u.searchParams.set("key", KEY);

    // Parámetros del ticker (coinciden con newsTicker.js parseParams)
    u.searchParams.set("ticker", cfg.enabled ? "1" : "0");
    u.searchParams.set("tickerLang", cfg.lang);
    u.searchParams.set("tickerSpeed", String(cfg.speedPxPerSec));
    u.searchParams.set("tickerRefresh", String(cfg.refreshMins));
    u.searchParams.set("tickerTop", String(cfg.topPx));
    u.searchParams.set("tickerHideOnVote", cfg.hideOnVote ? "1" : "0");
    u.searchParams.set("tickerSpan", cfg.timespan);

    // opcionales
    u.searchParams.set("tickerBilingual", cfg.bilingual ? "1" : "0");
    u.searchParams.set("tickerTranslateMax", String(cfg.translateMax));

    return u.toString();
  }

  // Debounce simple para inputs
  let tDeb = 0;
  function debounce(fn, ms = 160) {
    return () => {
      try { clearTimeout(tDeb); } catch (_) {}
      tDeb = setTimeout(fn, ms);
    };
  }

  function boot() {
    // Si no existe el bloque ticker, salimos sin romper nada
    if (!qs("#ctlTickerApply") || !qs("#ctlTickerOn")) return;

    const saved = normalizeCfg(readCfgFirst() || DEFAULTS);
    writeCfgEverywhere(saved);
    applyUIFromCfg(saved);

    const doApply = (persist = true) => {
      const cfg = collectCfgFromUI();
      if (persist) writeCfgEverywhere(cfg);
      sendCfg(cfg);
      applyUIFromCfg(cfg);
    };

    qs("#ctlTickerApply")?.addEventListener("click", () => doApply(true));

    qs("#ctlTickerReset")?.addEventListener("click", () => {
      clearCfgEverywhere();
      const cfg = normalizeCfg(DEFAULTS);
      writeCfgEverywhere(cfg);
      sendCfg(cfg);
      applyUIFromCfg(cfg);
    });

    // ✅ Botón “Copiar URL Stream (con ticker)”
    qs("#ctlTickerCopyUrl")?.addEventListener("click", async () => {
      const cfg = collectCfgFromUI();
      const url = buildPlayerUrlWithTicker(cfg);
      const ok = await copyToClipboard(url);
      setStatus(ok ? "URL ticker copiada ✅" : "No se pudo copiar ❌", ok);
      setTimeout(() => applyUIFromCfg(cfg), 900);
    });

    const liveEls = [
      "#ctlTickerOn",
      "#ctlTickerLang",
      "#ctlTickerSpeed",
      "#ctlTickerRefresh",
      "#ctlTickerTop",
      "#ctlTickerHideOnVote",
      "#ctlTickerSpan",
      "#ctlTickerBilingual",
      "#ctlTickerTranslateMax"
    ];

    const applyDebounced = debounce(() => doApply(true), 160);

    for (const sel of liveEls) {
      const el = qs(sel);
      if (!el) continue;

      el.addEventListener("change", () => doApply(true));

      // input continuo sólo en INPUT/number/text (evita spam)
      el.addEventListener("input", () => {
        if (el.tagName === "INPUT") applyDebounced();
      });
    }

    // Si cambian en otra pestaña, reflejar UI
    window.addEventListener("storage", (e) => {
      if (!e || !e.key) return;
      if (e.key === CFG_KEY_NS || e.key === CFG_KEY_LEGACY) {
        const c = readCfgFirst();
        if (c) applyUIFromCfg(c);
      }
    });

    // Pintado inicial + envío suave (para sincronizar player aunque no haya tocado nada)
    try { sendCfg(saved); } catch (_) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
