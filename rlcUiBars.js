/* rlcUiBars.js — RLC UI Bars Manager v1.0.0
   - Evita colisiones de --rlcTickerTop/--rlcTickerH
   - Apila barras (news/econ/lo-que-sea) si se solapan
   - Calcula offset global para #voteBox / ads overlays
*/
(() => {
  "use strict";
  const g = (typeof globalThis !== "undefined") ? globalThis : window;
  if (g.RLCUiBars) return;

  const bars = new Map();
  const DEFAULT_BASE_TOP = 10;      // tu “margen” clásico
  const STACK_GAP = 6;              // separación entre barras apiladas

  function num(v, fb = 0) {
    const n = parseFloat(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fb;
  }

  function setCss(k, v) {
    try { document.documentElement.style.setProperty(k, v); } catch (_) {}
  }

  function recalc() {
    // 1) lista visible
    const list = [];
    for (const [id, b] of bars.entries()) {
      if (!b || !b.enabled) continue;
      list.push({ id, ...b });
    }

    // 2) ordenar por top deseado (y estable por id)
    list.sort((a, b) => (a.wantTop - b.wantTop) || String(a.id).localeCompare(String(b.id)));

    // 3) apilar
    let cursor = -Infinity;
    let maxBottom = DEFAULT_BASE_TOP;

    for (const b of list) {
      const wantTop = Math.max(0, num(b.wantTop, DEFAULT_BASE_TOP));
      const h = Math.max(0, num(b.height, 0));

      const top = (cursor === -Infinity) ? wantTop : Math.max(wantTop, cursor);
      const bottom = top + h;

      // escribir var de top propia de esa barra (si la define)
      if (b.cssTopVar) setCss(b.cssTopVar, `${top}px`);

      cursor = bottom + STACK_GAP;
      maxBottom = Math.max(maxBottom, bottom);
    }

    // 4) compat con tu CSS actual: --rlcTickerTop + --rlcTickerH
    //    (vote/ads top = safeArea + top + h + gap)
    const baseTop = DEFAULT_BASE_TOP;
    const hTotal = Math.max(0, maxBottom - baseTop);

    setCss("--rlcTickerTop", `${baseTop}px`);
    setCss("--rlcTickerH", `${hTotal}px`);
  }

  g.RLCUiBars = {
    set(id, opts) {
      const o = opts || {};
      bars.set(String(id), {
        enabled: !!o.enabled,
        wantTop: num(o.wantTop, DEFAULT_BASE_TOP),
        height: num(o.height, 0),
        cssTopVar: String(o.cssTopVar || "").trim() || ""
      });
      recalc();
    },
    clear(id) {
      bars.delete(String(id));
      recalc();
    },
    recalc
  };
})();
