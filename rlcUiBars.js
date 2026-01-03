/* rlcUiBars.js — RLC UI Bars Manager v2.0.0
   ✅ Evita colisiones de tickers/topbars:
      - Calcula top por barra y las apila sin solaparse
      - Soporta vars por barra: --rlcNewsTop, --rlcEconTop (o cualquier cssTopVar)
   ✅ Mantiene compat legacy:
      - --rlcTickerTop (base)
      - --rlcTickerH (altura de la PRIMERA barra / legacy layout)
      - --rlcTickerStackH (altura total apilada)
   ✅ Calcula offset global:
      - --ui-top-offset (para voteBox / ads overlays / countdown, etc.)
   ✅ Auto-registra #rlcNewsTicker y #rlcEconTicker si existen
   ✅ Recalcula en resize + cambios de contenido (MutationObserver/ResizeObserver)
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;
  const LOAD_GUARD = "__RLC_UI_BARS_V200";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  // Si ya existe una versión nueva, no la machacamos
  if (g.RLCUiBars && typeof g.RLCUiBars.set === "function" && g.RLCUiBars.__ver >= 2) return;

  const bars = new Map();
  const observers = new Map();

  const DEFAULT_BASE_TOP = 10;  // tu margen clásico
  const DEFAULT_GAP = 10;       // separación entre barras
  const UI_BASELINE = 12;       // baseline típico de tus overlays (max(12px, safe-area-top))

  const qs = (s, r = document) => r.querySelector(s);
  const safeStr = (v) => (typeof v === "string") ? v.trim() : "";
  const num = (v, fb = 0) => {
    const n = parseFloat(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fb;
  };

  function setCssVar(k, v) {
    try { document.documentElement.style.setProperty(k, v); } catch (_) {}
  }
  function getCssVarNum(k, fb) {
    try {
      const raw = getComputedStyle(document.documentElement).getPropertyValue(k);
      return num(raw, fb);
    } catch (_) { return fb; }
  }

  function resolveEl(elOrSel) {
    if (!elOrSel) return null;
    if (typeof elOrSel === "string") return qs(elOrSel);
    if (elOrSel && elOrSel.nodeType === 1) return elOrSel;
    return null;
  }

  function autoEnabled(el) {
    if (!el) return false;
    try {
      const st = getComputedStyle(el);
      if (!st) return false;
      if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") return false;
    } catch (_) {}
    // si está vacío total, lo consideramos off
    const hasContent = (safeStr(el.textContent).length > 0) || (el.children && el.children.length > 0);
    if (!hasContent) {
      // pero si aún así mide altura (por estilos), lo aceptamos
      try {
        const h = Math.ceil(el.getBoundingClientRect().height || 0);
        return h > 2;
      } catch (_) { return false; }
    }
    return true;
  }

  function measureHeight(el, fallback = 0) {
    if (!el) return fallback;
    try {
      const r = el.getBoundingClientRect();
      const h = Math.ceil((r && r.height) ? r.height : 0);
      return Number.isFinite(h) ? h : fallback;
    } catch (_) { return fallback; }
  }

  let rafPending = false;
  function scheduleRecalc() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      api.recalc();
    });
  }

  function attachObservers(id, el) {
    if (!el) return;

    // Evita duplicados
    const key = String(id);
    if (observers.has(key)) return;

    const state = { mo: null, ro: null };

    // MutationObserver: cambios de contenido
    try {
      if ("MutationObserver" in window) {
        state.mo = new MutationObserver(() => scheduleRecalc());
        state.mo.observe(el, { childList: true, subtree: true, characterData: true });
      }
    } catch (_) {}

    // ResizeObserver: cambios de tamaño (mejor que polling)
    try {
      if ("ResizeObserver" in window) {
        state.ro = new ResizeObserver(() => scheduleRecalc());
        state.ro.observe(el);
      }
    } catch (_) {}

    observers.set(key, state);
  }

  function detachObservers(id) {
    const key = String(id);
    const st = observers.get(key);
    if (!st) return;
    try { if (st.mo) st.mo.disconnect(); } catch (_) {}
    try { if (st.ro) st.ro.disconnect(); } catch (_) {}
    observers.delete(key);
  }

  function ensureDefaults() {
    // Gap CSS opcional: si no existe, lo ponemos
    const gapNow = getCssVarNum("--rlcTickerGap", NaN);
    if (!Number.isFinite(gapNow)) setCssVar("--rlcTickerGap", `${DEFAULT_GAP}px`);

    // EconGap legacy: si no existe, lo ponemos
    const econGap = getCssVarNum("--rlcEconGap", NaN);
    if (!Number.isFinite(econGap)) setCssVar("--rlcEconGap", `${DEFAULT_GAP}px`);

    // Registramos news/econ si existen y no están ya
    if (!bars.has("news") && qs("#rlcNewsTicker")) {
      bars.set("news", {
        id: "news",
        enabled: null,               // auto
        wantTop: DEFAULT_BASE_TOP,
        height: null,                // auto
        cssTopVar: "--rlcNewsTop",
        el: "#rlcNewsTicker",
        priority: 10
      });
      attachObservers("news", qs("#rlcNewsTicker"));
    }
    if (!bars.has("econ") && qs("#rlcEconTicker")) {
      bars.set("econ", {
        id: "econ",
        enabled: null,               // auto
        wantTop: DEFAULT_BASE_TOP,   // se apila igualmente
        height: null,                // auto
        cssTopVar: "--rlcEconTop",
        el: "#rlcEconTicker",
        priority: 20
      });
      attachObservers("econ", qs("#rlcEconTicker"));
    }
  }

  const api = {
    __ver: 2,

    set(id, opts) {
      const key = String(id || "").trim();
      if (!key) return;

      const o = opts || {};
      const cur = bars.get(key) || { id: key };

      const next = {
        id: key,
        enabled: (o.enabled === true) ? true : (o.enabled === false) ? false : (o.enabled === null || o.enabled === undefined) ? null : !!o.enabled,
        wantTop: Number.isFinite(+o.wantTop) ? +o.wantTop : (Number.isFinite(+cur.wantTop) ? +cur.wantTop : DEFAULT_BASE_TOP),
        height: (o.height === null || o.height === undefined) ? null : (Number.isFinite(+o.height) ? +o.height : null),
        cssTopVar: safeStr(o.cssTopVar || cur.cssTopVar || ""),
        el: (o.el !== undefined) ? o.el : (cur.el !== undefined ? cur.el : null),
        priority: Number.isFinite(+o.priority) ? +o.priority : (Number.isFinite(+cur.priority) ? +cur.priority : 999)
      };

      bars.set(key, next);

      const el = resolveEl(next.el);
      if (el) attachObservers(key, el);

      scheduleRecalc();
    },

    clear(id) {
      const key = String(id || "").trim();
      if (!key) return;
      bars.delete(key);
      detachObservers(key);
      scheduleRecalc();
    },

    recalc() {
      ensureDefaults();

      const baseTop = DEFAULT_BASE_TOP; // mantenemos tu layout estable
      const gap = getCssVarNum("--rlcTickerGap", DEFAULT_GAP);

      const list = [];
      for (const [id, b] of bars.entries()) {
        if (!b) continue;
        const el = resolveEl(b.el);
        const enabled = (b.enabled === true) ? true : (b.enabled === false) ? false : autoEnabled(el);
        if (!enabled) continue;

        const wantTop = Math.max(0, Number.isFinite(+b.wantTop) ? +b.wantTop : baseTop);
        const h = (b.height !== null && b.height !== undefined)
          ? Math.max(0, Number.isFinite(+b.height) ? +b.height : 0)
          : Math.max(0, measureHeight(el, 0));

        list.push({
          id: String(id),
          priority: Number.isFinite(+b.priority) ? +b.priority : 999,
          wantTop,
          height: h,
          cssTopVar: safeStr(b.cssTopVar || ""),
          el
        });
      }

      // Si no hay barras, reseteamos offsets a valores seguros
      if (!list.length) {
        setCssVar("--rlcTickerTop", `${baseTop}px`);
        setCssVar("--rlcTickerH", `0px`);
        setCssVar("--rlcTickerStackH", `0px`);
        setCssVar("--ui-top-offset", `0px`);
        // No tocamos --rlcNewsTop/--rlcEconTop para no “pelear” si alguien los setea
        return;
      }

      // Orden: prioridad primero, luego wantTop, luego id
      list.sort((a, b) => (a.priority - b.priority) || (a.wantTop - b.wantTop) || a.id.localeCompare(b.id));

      let cursor = -Infinity;
      let maxBottom = baseTop;
      let firstBarTop = baseTop;
      let firstBarH = 0;

      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        const wantTop = Math.max(0, num(b.wantTop, baseTop));
        const h = Math.max(0, num(b.height, 0));

        const top = (cursor === -Infinity) ? wantTop : Math.max(wantTop, cursor);
        const bottom = top + h;

        if (i === 0) {
          firstBarTop = top;
          firstBarH = h;
        }

        if (b.cssTopVar) setCssVar(b.cssTopVar, `${top}px`);

        cursor = bottom + gap;
        maxBottom = Math.max(maxBottom, bottom);
      }

      const stackH = Math.max(0, maxBottom - baseTop);

      // Legacy vars para CSS antiguo:
      setCssVar("--rlcTickerTop", `${baseTop}px`);
      setCssVar("--rlcTickerH", `${Math.max(0, firstBarH)}px`);
      setCssVar("--rlcTickerStackH", `${stackH}px`);

      // Offset global para overlays: empuja desde el baseline típico (12px) hacia abajo
      // (lo dejamos "un pelín" conservador para no solapar nunca)
      const uiOffset = Math.max(0, (maxBottom - baseTop) + gap);
      setCssVar("--ui-top-offset", `${uiOffset}px`);
    }
  };

  g.RLCUiBars = api;

  // Recalc en eventos globales
  function bindGlobal() {
    window.addEventListener("resize", scheduleRecalc, { passive: true });
    window.addEventListener("orientationchange", scheduleRecalc, { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) scheduleRecalc();
    }, { passive: true });

    // Si hay font loading API, recalculamos cuando estén listas (altura puede variar)
    try {
      if (document.fonts && typeof document.fonts.ready?.then === "function") {
        document.fonts.ready.then(() => scheduleRecalc()).catch(() => {});
      }
    } catch (_) {}
  }

  function boot() {
    ensureDefaults();
    api.recalc();
    bindGlobal();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
