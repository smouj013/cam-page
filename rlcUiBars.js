/* rlcUiBars.js — RLC UI Bars v1.2.0 (TICKER-OFFSET SAFE + NO LEGACY DEP)
   ✅ Calcula --rlcTickerH y --rlcHudH sin depender de newsTicker.js antiguo
   ✅ Detecta el ticker por IDs comunes (#rlcNewsTicker / #rlcTickers / #rlcTicker...)
   ✅ Usa ResizeObserver + MutationObserver para cambios dinámicos
   ✅ API global: window.RLCUiBars.refresh(), setTickerHeightPx()
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;
  const LOAD_GUARD = "__RLC_UIBARS_LOADED_V120";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  const root = document.documentElement;

  const selTicker = [
    "#rlcNewsTicker",
    "#rlcTickers",
    "#rlcTicker",
    "#rlcTopTicker",
    "[data-rlc-ticker]",
    "[data-rlc-tickers]"
  ].join(",");

  const selHud = "#hud";

  let ro = null;
  let mo = null;

  function px(n) {
    const v = Math.max(0, Math.round(+n || 0));
    return `${v}px`;
  }

  function setVar(name, valuePx) {
    try { root.style.setProperty(name, valuePx); } catch (_) {}
  }

  function isVisible(el) {
    if (!el) return false;
    try {
      const cs = getComputedStyle(el);
      if (!cs) return false;
      if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
      const r = el.getBoundingClientRect();
      return (r.height > 0.5 && r.width > 0.5);
    } catch (_) {
      return false;
    }
  }

  function measureHeight(el) {
    if (!el) return 0;
    try {
      const r = el.getBoundingClientRect();
      return Math.max(0, r.height || 0);
    } catch (_) {
      return 0;
    }
  }

  function findTickerEl() {
    return document.querySelector(selTicker);
  }

  function findHudEl() {
    return document.querySelector(selHud);
  }

  function refresh() {
    const tickerEl = findTickerEl();
    const hudEl = findHudEl();

    const tickerH = (tickerEl && isVisible(tickerEl)) ? measureHeight(tickerEl) : 0;
    const hudH = (hudEl && isVisible(hudEl) && !hudEl.classList.contains("hidden")) ? measureHeight(hudEl) : 0;

    setVar("--rlcTickerH", px(tickerH));
    setVar("--rlcHudH", px(hudH));

    try {
      root.toggleAttribute("data-rlc-has-ticker", tickerH > 0);
      root.toggleAttribute("data-rlc-has-hud", hudH > 0);
    } catch (_) {}
  }

  function setTickerHeightPx(h) {
    const v = Math.max(0, Math.round(+h || 0));
    setVar("--rlcTickerH", px(v));
    try { root.toggleAttribute("data-rlc-has-ticker", v > 0); } catch (_) {}
  }

  function bindObservers() {
    try { ro?.disconnect?.(); } catch (_) {}
    try { mo?.disconnect?.(); } catch (_) {}
    ro = null;
    mo = null;

    try {
      if ("ResizeObserver" in window) {
        ro = new ResizeObserver(() => refresh());
        const t = findTickerEl();
        const h = findHudEl();
        if (t) ro.observe(t);
        if (h) ro.observe(h);
      }
    } catch (_) {}

    try {
      mo = new MutationObserver(() => refresh());
      mo.observe(document.documentElement, {
        attributes: true,
        childList: true,
        subtree: true
      });
    } catch (_) {}
  }

  // Eventos opcionales que puede emitir el ticker (si quiere)
  window.addEventListener("RLC_TICKER_HEIGHT", (ev) => {
    try {
      const h = ev?.detail?.height;
      if (h != null) setTickerHeightPx(h);
      else refresh();
    } catch (_) {}
  });

  // Cuando el player emite eventos, a veces el ticker se monta tarde -> refrescamos
  window.addEventListener("RLC_PLAYER_EVENT", () => {
    // micro-debounce
    try { requestAnimationFrame(refresh); } catch (_) { refresh(); }
  });

  function boot() {
    refresh();
    bindObservers();

    // Refrescos extra por si el CSS/DOM tarda
    setTimeout(refresh, 120);
    setTimeout(refresh, 380);
    window.addEventListener("resize", refresh, { passive: true });
    window.addEventListener("orientationchange", refresh, { passive: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  // API
  g.RLCUiBars = Object.freeze({
    refresh,
    setTickerHeightPx
  });
})();
