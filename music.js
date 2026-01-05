/* music.js — RLC Music (BGM LIST) v2.3.8 (SAFE + COMPAT)
   ✅ NO cambia tu API: window.BGM_LIST (mismos items/ids por defecto)
   ✅ Guard anti-doble-carga + cache-bust (APP_VERSION) + normalización + dedupe
   ✅ Si ya existe window.BGM_LIST (custom), lo respeta y lo sanea
*/
(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  // ✅ Guard anti doble carga (por SW/duplicados)
  const LOAD_GUARD = "__RLC_MUSIC_LOADED_V238";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  const APPV = String((g && g.APP_VERSION) || "").trim();

  const safeStr = (v) => (typeof v === "string") ? v.trim() : "";
  const isAbs = (u) => {
    const s = String(u || "");
    return /^(?:[a-z]+:)?\/\//i.test(s) || s.startsWith("data:") || s.startsWith("blob:");
  };

  // ✅ añade/actualiza ?v=APP_VERSION sin duplicarlo, y sin tocar URLs absolutas/data/blob
  const withV = (url) => {
    const s0 = String(url || "").trim();
    if (!s0 || !APPV || isAbs(s0)) return s0;

    // separa hash
    const hashIdx = s0.indexOf("#");
    const base = hashIdx >= 0 ? s0.slice(0, hashIdx) : s0;
    const hash = hashIdx >= 0 ? s0.slice(hashIdx) : "";

    // separa query
    const qIdx = base.indexOf("?");
    const path = qIdx >= 0 ? base.slice(0, qIdx) : base;
    const qRaw = qIdx >= 0 ? base.slice(qIdx + 1) : "";

    try {
      const sp = new URLSearchParams(qRaw);
      sp.set("v", APPV); // sobrescribe si ya existía
      const qOut = sp.toString();
      return qOut ? `${path}?${qOut}${hash}` : `${path}${hash}`;
    } catch (_) {
      // fallback ultra simple
      const join = base.includes("?") ? "&" : "?";
      // si ya hay v=, intentamos reemplazo best-effort
      if (/[?&]v=/.test(base)) {
        return (base.replace(/([?&])v=[^&#]*/g, `$1v=${encodeURIComponent(APPV)}`)) + hash;
      }
      return `${base}${join}v=${encodeURIComponent(APPV)}${hash}`;
    }
  };

  // ✅ Lista por defecto (MISMO contenido que tu v2.3.4)
  const DEFAULT_LIST = [
    { id: "ambient_01", title: "Ambient 01", url: "./assets/audio/ambient_01.mp3" },
    { id: "ambient_02", title: "Ambient 02", url: "./assets/audio/ambient_02.mp3" },
    { id: "ambient_03", title: "Ambient 03", url: "./assets/audio/ambient_03.mp3" },
    { id: "ambient_04", title: "Ambient 04", url: "./assets/audio/ambient_04.mp3" }
  ];

  function normalizeList(listLike) {
    const arr = Array.isArray(listLike) ? listLike : [];
    const out = [];
    const seen = new Set();

    for (const t of arr) {
      if (!t || typeof t !== "object") continue;

      const id = safeStr(t.id);
      const title = safeStr(t.title);
      const url = safeStr(t.url);

      if (!id || !url) continue;
      if (seen.has(id)) continue;
      seen.add(id);

      out.push({
        id,
        title: title || id,
        url: withV(url)
      });
    }

    return out;
  }

  // ✅ Si ya hay una lista custom definida, la respetamos.
  const base = (Array.isArray(g.BGM_LIST) && g.BGM_LIST.length) ? g.BGM_LIST : DEFAULT_LIST;

  // ✅ Publica EXACTAMENTE window.BGM_LIST (sin romper control.js)
  g.BGM_LIST = normalizeList(base);

  // Extra: debug suave (no obligatorio)
  try { g.RLC_MUSIC_VERSION = "2.3.8"; } catch (_) {}
})();
