/* music.js — RLC Music (BGM LIST) v2.3.9 (SAFE + COMPAT++)
   ✅ NO cambia tu API: window.BGM_LIST (mismos items/ids por defecto)
   ✅ Guard anti-doble-carga + cache-bust (APP_VERSION) + normalización + dedupe
   ✅ Si ya existe window.BGM_LIST (custom), lo respeta y lo sanea
   ✅ Compat extra: acepta campos legacy (src/href/name/label) y genera id estable si falta
*/
(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  // ✅ Guard anti doble carga (por SW/duplicados)
  const LOAD_GUARD = "__RLC_MUSIC_LOADED_V239";
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
      if (/[?&]v=/.test(base)) {
        return (base.replace(/([?&])v=[^&#]*/g, `$1v=${encodeURIComponent(APPV)}`)) + hash;
      }
      return `${base}${join}v=${encodeURIComponent(APPV)}${hash}`;
    }
  };

  // ✅ Default list (mantiene tu set “ambient_*”)
  // Nota: si tú ya pones tu BGM_LIST custom, esta no se usa.
  const DEFAULT_LIST = [
    { id: "ambient_01", title: "Ambient 01", url: "./assets/audio/ambient_01.mp3" },
    { id: "ambient_02", title: "Ambient 02", url: "./assets/audio/ambient_02.mp3" },
    { id: "ambient_03", title: "Ambient 03", url: "./assets/audio/ambient_03.mp3" },
    { id: "ambient_04", title: "Ambient 04", url: "./assets/audio/ambient_04.mp3" }
  ];

  // --- helpers compat ---
  const pick = (obj, keys) => {
    for (const k of keys) {
      if (obj && Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
    }
    return undefined;
  };

  // id estable desde url (si falta id) — evita “perder” tracks
  const stableIdFromUrl = (url) => {
    const s = String(url || "").trim();
    if (!s) return "";
    // Hash simple y estable (djb2)
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
    // a positivo + base36
    return "bgm_" + (h >>> 0).toString(36);
  };

  const normUrlKey = (url) => {
    const s = String(url || "").trim();
    if (!s) return "";
    // para dedupe por url: quita el v=... (porque cambia por APPV)
    return s.replace(/([?&])v=[^&#]*/g, "$1v=").replace(/[?&]$/, "");
  };

  function normalizeList(listLike) {
    // soporta array, o objeto-map {id:{...}} por compat
    let arr = [];
    if (Array.isArray(listLike)) {
      arr = listLike;
    } else if (listLike && typeof listLike === "object") {
      arr = Object.keys(listLike).map((k) => {
        const v = listLike[k];
        if (v && typeof v === "object") return { id: k, ...v };
        return { id: k, url: v };
      });
    }

    const out = [];
    const seenId = new Set();
    const seenUrl = new Set();

    for (const t of arr) {
      if (!t || typeof t !== "object") continue;

      // compat: id puede venir en id/key
      let id = safeStr(pick(t, ["id", "key"]));
      const titleRaw = pick(t, ["title", "name", "label"]);
      const urlRaw = pick(t, ["url", "src", "href", "file"]);

      const title = safeStr(titleRaw);
      const url0 = safeStr(urlRaw);

      if (!url0) continue;

      // genera id si falta
      if (!id) id = stableIdFromUrl(url0);
      if (!id) continue;

      const url = withV(url0);
      const urlKey = normUrlKey(url);

      // dedupe robusto (id primero, luego url)
      if (seenId.has(id)) continue;
      if (urlKey && seenUrl.has(urlKey)) continue;

      seenId.add(id);
      if (urlKey) seenUrl.add(urlKey);

      out.push({
        id,
        title: title || id,
        url
      });
    }

    return out;
  }

  // ✅ Si ya hay una lista custom definida, la respetamos.
  const base = (Array.isArray(g.BGM_LIST) && g.BGM_LIST.length) ? g.BGM_LIST
             : (g.BGM_LIST && typeof g.BGM_LIST === "object" && Object.keys(g.BGM_LIST).length) ? g.BGM_LIST
             : DEFAULT_LIST;

  // ✅ Publica EXACTAMENTE window.BGM_LIST (sin romper control.js)
  g.BGM_LIST = normalizeList(base);

  // Extra: debug suave (no obligatorio)
  try { g.RLC_MUSIC_VERSION = "2.3.9"; } catch (_) {}
})();
