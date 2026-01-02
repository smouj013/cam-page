/* music.js — RLC Music (BGM LIST) v2.3.4 (SAFE UPGRADE)
   ✅ NO cambia tu API: sigue siendo window.BGM_LIST con los mismos items/ids
   ✅ Solo añade: guard anti-doble-carga + cache-bust opcional (APP_VERSION) + normalización mínima
   ✅ Si no existe window.APP_VERSION, no toca las URLs
*/
(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  // ✅ Guard anti doble carga (por SW/duplicados)
  const LOAD_GUARD = "__RLC_MUSIC_LOADED";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  // Cache-bust opcional usando window.APP_VERSION (si está definido)
  const VERSION = String((g && g.APP_VERSION) || "");
  const isAbs = (u) => /^(?:[a-z]+:)?\/\//i.test(String(u || "")) || String(u || "").startsWith("data:");
  const withV = (url) => {
    const s = String(url || "");
    if (!s || !VERSION || isAbs(s)) return s;
    const join = s.includes("?") ? "&" : "?";
    return `${s}${join}v=${encodeURIComponent(VERSION)}`;
  };

  // ✅ Tu lista ORIGINAL (mismos ids/titles/paths)
  const ORIGINAL = [
    { id: "ambient_01", title: "Ambient 01", url: "./assets/audio/ambient_01.mp3" },
    { id: "ambient_02", title: "Ambient 02", url: "./assets/audio/ambient_02.mp3" },
    { id: "ambient_03", title: "Ambient 03", url: "./assets/audio/ambient_03.mp3" },
    { id: "ambient_04", title: "Ambient 04", url: "./assets/audio/ambient_04.mp3" }
  ];

  // ✅ Publica EXACTAMENTE window.BGM_LIST (sin romper control.js)
  // Solo: sanea strings y añade ?v=APP_VERSION si existe.
  g.BGM_LIST = ORIGINAL.map((t) => ({
    id: String(t.id || "").trim(),
    title: String(t.title || "").trim(),
    url: withV(String(t.url || "").trim())
  }));
})();
