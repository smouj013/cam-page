/* cams.js — Lista de cámaras (VIDEO ONLY + AUTO-DISCOVERY + CATALOG 4-UP + OPTIONAL NEWS) v2.3.9
   ✅ Integrado para RLC v2.3.9 (Player + Control/Admin + obs-cam-panel.html)
   ✅ VIDEO ONLY: exporta SOLO "youtube" y "hls" (descarta "image")
   ✅ Objetivo: 1200 cams reales por defecto (override: ?camsTarget=500/800/1200/1600...)
   ✅ Auto-discovery: Invidious LIVE + tolerancia CORS + backoff por instancia
   ✅ Cache compacta + fallback si localStorage revienta
   ✅ Mantiene compat total:
      - window.CAM_LIST / CAM_CATALOG_LIST / CAM_NEWS_LIST / CAM_LIST_READY
      - window.RLCCams.* API
      - evento "rlc_cam_list_updated"
      - BroadcastChannel: rlc_bus_v1 y rlc_bus_v1:{key}

   🔥 FIXES (SIN SUBIR VERSIÓN) — v2.3.9:
      - FIX REAL: Los seeds ya NO son "youtube_live_search" que se descartaba -> ahora se resuelven a youtubeId LIVE.
      - Cache se usa aunque no llegue a 60 (si hay lista válida, arranca ya con cams).
      - Validación embed NO hace falsos negativos por "403/Forbidden" de proxies (se trata como "unknown", no como "blocked").
      - Pipeline por fases: cache -> seeds live -> discovery amplio -> (opcional) news -> mixing opcional.
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  // ─────────────────────────────────────────────────────────────
  // Guard anti doble carga + destroy() (update-safe)
  // ─────────────────────────────────────────────────────────────
  const GUARD_239 = "__RLC_CAMSJS_LOADED_V239_VIDEOONLY_AUTODISCOVERY_CATALOG4_NEWSOPT";
  try { const prev = g[GUARD_239]; if (prev && typeof prev.destroy === "function") prev.destroy(); } catch (_) {}

  if (!g[GUARD_239]) g[GUARD_239] = {};
  const MOD = g[GUARD_239];

  MOD._timers = MOD._timers || [];
  MOD._abort  = MOD._abort  || new AbortController();
  MOD._bcs    = MOD._bcs    || [];
  MOD._msgSig = MOD._msgSig || "";
  MOD._readyResolved = MOD._readyResolved || false;

  MOD._embedCache = MOD._embedCache || new Map(); // videoId -> { ok, ts }
  MOD._liveCache  = MOD._liveCache  || new Map(); // videoId -> { ok, ts }
  MOD._instHealth = MOD._instHealth || new Map(); // instance -> { fail, untilTs }

  MOD.destroy = function destroy() {
    try { (MOD._timers || []).forEach(t => clearTimeout(t)); } catch (_) {}
    MOD._timers = [];
    try { MOD._abort && MOD._abort.abort(); } catch (_) {}
    MOD._abort = new AbortController();
    try { (MOD._bcs || []).forEach(c => { try { c && c.close && c.close(); } catch (_) {} }); } catch (_) {}
    MOD._bcs = [];
    MOD._msgSig = "";
    MOD._readyResolved = false;
    try { MOD._embedCache && MOD._embedCache.clear(); } catch (_) {}
    try { MOD._liveCache && MOD._liveCache.clear(); } catch (_) {}
    try { MOD._instHealth && MOD._instHealth.clear(); } catch (_) {}
  };

  // ─────────────────────────────────────────────────────────────
  // CONFIG (v2.3.9)
  // ─────────────────────────────────────────────────────────────
  const VERSION = "2.3.9";

  function getParam(name) {
    try { return new URL(location.href).searchParams.get(name); }
    catch (_) { return null; }
  }
  function lsGet(k) { try { return localStorage.getItem(k) || ""; } catch (_) { return ""; } }

  const ROOM_KEY = (getParam("key") || getParam("k") || lsGet("rlc_last_key_v1") || "").trim();
  const NS = ROOM_KEY ? `:${ROOM_KEY}` : "";

  function parseBool(v, def) {
    if (v == null) return def;
    const s = String(v).trim().toLowerCase();
    if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
    if (s === "0" || s === "false" || s === "no" || s === "off") return false;
    return def;
  }
  function parseIntSafe(v, def) {
    const n = (v == null) ? NaN : Number.parseInt(String(v), 10);
    return Number.isFinite(n) ? n : def;
  }
  const safeStr = (v) => (typeof v === "string") ? v.trim() : "";

  const TARGET_CAMS_DEFAULT = 1200;
  let TARGET_CAMS = Math.max(50, Math.min(2500, parseIntSafe(getParam("camsTarget"), TARGET_CAMS_DEFAULT)));

  const MIN_CATALOG_GOAL = Math.max(50, Math.min(1200, parseIntSafe(getParam("camsMinCatalog"), 500)));
  const CATALOG_PAGE_SIZE = 4;

  const CACHE_KEY_LEGACY = "rlc_cam_cache_v1_500";
  const CACHE_KEY_V239 = `rlc_bus_v1:cams_cache_v1${NS}`;
  const CACHE_NEWS_KEY_V239 = `rlc_bus_v1:news_cache_v1${NS}`;

  const cacheHours = Math.max(0.5, Math.min(72, Number(parseIntSafe(getParam("camsCacheHours"), 12)) || 12));
  const CACHE_MAX_AGE_MS = Math.max(30 * 60 * 1000, Math.min(72 * 60 * 60 * 1000, cacheHours * 60 * 60 * 1000));

  let AUTO_DISCOVERY = parseBool(getParam("camsDiscovery"), true);

  // IMPORTANT: en GitHub Pages a veces validación agresiva deja la lista en 0.
  // Mantengo ON por defecto, pero con FIX: no hay falsos negativos por errores de proxy.
  let VALIDATE_EMBED = parseBool(getParam("camsValidate"), true);

  const VALIDATE_BUDGET = Math.max(0, Math.min(9000, parseIntSafe(getParam("camsValidateBudget"), 1200)));
  let __validateUsed = 0;

  let BEST_EFFORT_LIVE_CHECK = parseBool(getParam("camsLiveCheck"), true);

  const DISCOVERY_MAX_PAGES_PER_QUERY = Math.max(1, Math.min(24, parseIntSafe(getParam("camsPages"), 10)));
  const DISCOVERY_MAX_PER_QUERY = Math.max(30, Math.min(2000, parseIntSafe(getParam("camsMaxPerQuery"), 600)));
  const DISCOVERY_CONCURRENCY = Math.max(1, Math.min(12, parseIntSafe(getParam("camsConc"), 8)));
  const DISCOVERY_MAX_INSTANCES = Math.max(5, Math.min(40, parseIntSafe(getParam("camsInstances"), 22)));

  const DISCOVERY_REQUEST_BUDGET = Math.max(180, Math.min(16000, parseIntSafe(getParam("camsBudget"), 2600)));
  let __reqUsed = 0;

  const QUERY_SHUFFLE = parseBool(getParam("camsQueryShuffle"), true);
  const QUERY_CAP = Math.max(120, Math.min(3200, parseIntSafe(getParam("camsQueryCap"), 1200)));

  let HARD_FAILSAFE_ALT_FILL = parseBool(getParam("camsAltFill"), true);

  // News (OPCIONAL)
  let NEWS_ENABLED = parseBool(getParam("camsNews"), false);
  let NEWS_MIX_IN_MAIN = parseBool(getParam("camsNewsMix"), false);
  let NEWS_IN_CATALOG = parseBool(getParam("camsNewsCatalog"), false);
  let NEWS_DISCOVERY = parseBool(getParam("camsNewsDiscovery"), true);
  let NEWS_TARGET = Math.max(10, Math.min(300, parseIntSafe(getParam("camsNewsTarget"), 60)));

  const RELAX_PASSES = Math.max(0, Math.min(2, parseIntSafe(getParam("camsRelaxPasses"), 2)));

  const DISCOVERY_REGIONS = [
    "US","GB","CA","ES","FR","DE","IT","NL","SE","NO","PL","PT",
    "BR","AR","MX","CL","CO","PE",
    "JP","KR","TW","HK","SG","TH","VN","PH","ID","IN",
    "AU","NZ","ZA","EG","MA","TR","IL","AE"
  ];

  // ─────────────────────────────────────────────────────────────
  // Filtros (más realistas, menos “mata-todo”)
  // ─────────────────────────────────────────────────────────────
  function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  const BLOCK_WORDS_BOUNDARY = [
    "lofi","lo-fi","radio","music","música","mix","playlist","beats",
    "podcast","audiobook","audiolibro",
    "gameplay","gaming","walkthrough","speedrun",
    "sermon","church","iglesia","prayer","oración",
    "crypto","trading","forex",
    "recorded","replay","rerun","repeat","loop","timelapse","time-lapse",
    "ambience","ambient","study","sleep","relax","asmr",
    "dashcam","driving","ride","vlog","vlogger"
  ];

  const BLOCK_PHRASES = [
    "walking tour",
    "city walk",
    "virtual walk",
    "4k walk",
    "time lapse",
    "train ride",
    "bus ride",
    "metro ride"
  ];

  const BLOCK_RE = [];
  for (let i = 0; i < BLOCK_WORDS_BOUNDARY.length; i++) {
    BLOCK_RE.push(new RegExp(`\\b${escRe(BLOCK_WORDS_BOUNDARY[i])}\\b`, "i"));
  }
  for (let i = 0; i < BLOCK_PHRASES.length; i++) {
    BLOCK_RE.push(new RegExp(escRe(BLOCK_PHRASES[i]).replace(/\s+/g, "\\s+"), "i"));
  }

  const ALLOW_HINTS = [
    "webcam","web cam","live cam","livecam","camera live","cctv","traffic cam","traffic camera",
    "airport","harbor","harbour","port","pier","beach","coast","marina",
    "downtown","street cam","street camera","square","plaza",
    "railcam","rail cam","train cam","station cam","train station",
    "ski cam","snow cam","mountain cam","volcano cam","crater cam",
    "earthcam","skylinewebcams","ozolio","webcams","ipcamlive","ip cam",
    "boardwalk","promenade",
    "cámara","camara","en directo","en vivo","directo",
    "telecamera","in diretta","webcam in diretta",
    "kamera","kamera na żywo","webkamera","canlı","ao vivo","câmera","caméra","en direct",
    "ptz","pan tilt zoom","pan-tilt-zoom"
  ];

  const KNOWN_WEBCAM_BRANDS = [
    "earthcam","skylinewebcams","ozolio","railcam","webcams",
    "earthtv","earth tv","ipcamlive","ip cam","ipcam",
    "webcam galore"
  ];

  function includesAny(hay, list) {
    for (let i = 0; i < list.length; i++) if (hay.includes(list[i])) return true;
    return false;
  }
  function matchesAnyRegex(hay, regs) {
    for (let i = 0; i < regs.length; i++) if (regs[i].test(hay)) return true;
    return false;
  }

  function camTitleOk(title, author) {
    const t = safeStr(title).toLowerCase();
    const a = safeStr(author).toLowerCase();
    const full = (t + " " + a).trim();
    if (!full) return false;

    if (matchesAnyRegex(full, BLOCK_RE)) return false;

    if (includesAny(full, KNOWN_WEBCAM_BRANDS)) return true;
    if (includesAny(full, ALLOW_HINTS)) return true;

    const hasLive =
      /\blive\b/i.test(full) ||
      /\ben vivo\b/i.test(full) ||
      /\ben directo\b/i.test(full) ||
      /\bin diretta\b/i.test(full) ||
      /\ben direct\b/i.test(full) ||
      /\bao vivo\b/i.test(full) ||
      /\bcanlı\b/i.test(full) ||
      /\b24\/7\b/.test(full) ||
      /\b24-7\b/.test(full);

    const hasCam =
      /\b(web\s?cam|webcam|cam|cctv|camera)\b/i.test(full) ||
      /\b(cámara|camara|telecamera|kamera|webkamera|câmera|caméra)\b/i.test(full);

    return !!(hasLive && hasCam);
  }

  function camTitleOkRelaxed(title, author) {
    // Relaxed solo cambia “hints” de escena, pero mantiene los BLOCK_RE.
    const t = safeStr(title).toLowerCase();
    const a = safeStr(author).toLowerCase();
    const full = (t + " " + a).trim();
    if (!full) return false;
    if (matchesAnyRegex(full, BLOCK_RE)) return false;

    if (includesAny(full, KNOWN_WEBCAM_BRANDS)) return true;
    if (includesAny(full, ALLOW_HINTS)) return true;

    const hasLive =
      /\blive\b/i.test(full) ||
      /\ben vivo\b/i.test(full) ||
      /\ben directo\b/i.test(full) ||
      /\bin diretta\b/i.test(full) ||
      /\ben direct\b/i.test(full) ||
      /\bao vivo\b/i.test(full) ||
      /\b24\/7\b/.test(full) ||
      /\b24-7\b/.test(full);

    if (!hasLive) return false;

    const sceneHints = [
      "downtown","city","harbor","harbour","port","beach","pier","boardwalk","promenade",
      "square","plaza","street","traffic","bridge","airport","station","rail","train",
      "mountain","alps","ski","snow","volcano","crater","lake","river","zoo","aquarium","wildlife",
      "marina","coast","bay","fjord","canal"
    ];
    return includesAny(full, sceneHints);
  }

  // News filter (solo si activas camsNews=1)
  const NEWS_BLOCK_WORDS = ["lofi","music","música","beats","playlist","mix","gaming","walkthrough","speedrun","walk","walking","tour","recorded","replay","loop","timelapse","asmr","study","sleep","relax","podcast"];
  const NEWS_BLOCK_RE = NEWS_BLOCK_WORDS.map(w => new RegExp(`\\b${escRe(w)}\\b`, "i"));
  const NEWS_ALLOW_HINTS = ["news","noticias","breaking","última hora","en directo","en vivo","directo","24/7","24-7","channel","canal","noticiero"];

  function newsTitleOk(title, author) {
    const t = safeStr(title).toLowerCase();
    const a = safeStr(author).toLowerCase();
    const full = (t + " " + a).trim();
    if (!full) return false;
    if (matchesAnyRegex(full, NEWS_BLOCK_RE)) return false;
    return includesAny(full, NEWS_ALLOW_HINTS);
  }

  // ─────────────────────────────────────────────────────────────
  // Helpers URL / YouTube / HLS
  // ─────────────────────────────────────────────────────────────
  function isValidYouTubeId(id) {
    const s = safeStr(id);
    return /^[a-zA-Z0-9_-]{11}$/.test(s);
  }

  function extractYouTubeIdFromUrl(url) {
    const u = safeStr(url);
    if (!u) return "";
    let m = u.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (m && m[1]) return m[1];
    m = u.match(/\/live\/([a-zA-Z0-9_-]{11})/);
    if (m && m[1]) return m[1];
    m = u.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
    if (m && m[1]) return m[1];
    m = u.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (m && m[1]) return m[1];
    return "";
  }

  function looksLikeM3U8(url) {
    const u = safeStr(url).toLowerCase();
    return !!u && (u.includes(".m3u8") || u.includes("m3u8"));
  }

  function youtubeThumb(yid) {
    const id = safeStr(yid);
    if (!isValidYouTubeId(id)) return "";
    return `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
  }

  function canonicalUrl(u) {
    const s = safeStr(u);
    if (!s) return "";
    try {
      const x = new URL(s);
      x.hash = "";
      const kill = [
        "token","sig","signature","expires","exp","e","hdnts","session","sess","auth","jwt","key","acl",
        "Policy","Signature","Key-Pair-Id",
        "X-Amz-Algorithm","X-Amz-Credential","X-Amz-Date","X-Amz-Expires","X-Amz-SignedHeaders","X-Amz-Signature",
        "wmsAuthSign","st","t","ts",
        "utm_source","utm_medium","utm_campaign","utm_term","utm_content"
      ];
      for (let i = 0; i < kill.length; i++) x.searchParams.delete(kill[i]);
      return x.toString();
    } catch (_) {
      return s;
    }
  }

  function clampInt(v, a, b) {
    v = Number(v);
    if (!Number.isFinite(v)) v = 0;
    v = Math.trunc(v);
    return Math.max(a, Math.min(b, v));
  }

  function shuffleInPlace(arr) {
    if (!Array.isArray(arr) || arr.length < 2) return arr;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ─────────────────────────────────────────────────────────────
  // LISTAS + Dedup
  // ─────────────────────────────────────────────────────────────
  const ALLOWED_KINDS = new Set(["youtube","hls"]);

  const seenIds = new Set();
  const seenYouTube = new Set();
  const seenHlsUrl = new Set();

  const OUT = [];
  const OUT_CATALOG = [];

  const NEWS_SEEN_IDS = new Set();
  const NEWS_SEEN_YT = new Set();
  const NEWS_SEEN_HLS = new Set();
  const OUT_NEWS = [];
  const OUT_NEWS_CATALOG = [];

  function pushCam(cam) {
    if (!cam || !cam.id || seenIds.has(cam.id)) return false;
    const kind = safeStr(cam.kind).toLowerCase();
    if (!ALLOWED_KINDS.has(kind)) return false;

    if (kind === "youtube") {
      const yid = safeStr(cam.youtubeId);
      if (!isValidYouTubeId(yid) || seenYouTube.has(yid)) return false;
      seenYouTube.add(yid);
      if (!cam.thumb) cam.thumb = youtubeThumb(yid);
    } else {
      const u = safeStr(cam.url) || safeStr(cam.originUrl);
      if (!u || !looksLikeM3U8(u)) return false;
      const cu = canonicalUrl(u);
      if (seenHlsUrl.has(cu)) return false;
      seenHlsUrl.add(cu);
      cam.url = u;
      if (!cam.originUrl) cam.originUrl = u;
    }

    seenIds.add(cam.id);
    OUT.push(cam);
    if (!cam.isAlt) OUT_CATALOG.push(cam);
    return true;
  }

  function pushNews(cam) {
    if (!cam || !cam.id || NEWS_SEEN_IDS.has(cam.id)) return false;
    const kind = safeStr(cam.kind).toLowerCase();
    if (!ALLOWED_KINDS.has(kind)) return false;

    if (kind === "youtube") {
      const yid = safeStr(cam.youtubeId);
      if (!isValidYouTubeId(yid) || NEWS_SEEN_YT.has(yid)) return false;
      NEWS_SEEN_YT.add(yid);
      if (!cam.thumb) cam.thumb = youtubeThumb(yid);
    } else {
      const u = safeStr(cam.url) || safeStr(cam.originUrl);
      if (!u || !looksLikeM3U8(u)) return false;
      const cu = canonicalUrl(u);
      if (NEWS_SEEN_HLS.has(cu)) return false;
      NEWS_SEEN_HLS.add(cu);
      cam.url = u;
      if (!cam.originUrl) cam.originUrl = u;
    }

    NEWS_SEEN_IDS.add(cam.id);
    OUT_NEWS.push(cam);
    OUT_NEWS_CATALOG.push(cam);
    return true;
  }

  // Export inmediato (aunque sea vacío al principio)
  g.CAM_LIST = OUT;
  g.CAM_CATALOG_LIST = OUT_CATALOG;
  g.CAM_NEWS_LIST = OUT_NEWS;

  let __resolveReady = null;
  g.CAM_LIST_READY = new Promise((res) => { __resolveReady = res; });

  // ─────────────────────────────────────────────────────────────
  // Evento update + API catálogo
  // ─────────────────────────────────────────────────────────────
  function emitUpdate() {
    const detail = {
      list: g.CAM_LIST,
      catalog: g.CAM_CATALOG_LIST,
      news: g.CAM_NEWS_LIST,
      newsCatalog: OUT_NEWS_CATALOG,
      total: Array.isArray(g.CAM_LIST) ? g.CAM_LIST.length : 0,
      catalogTotal: Array.isArray(g.CAM_CATALOG_LIST) ? g.CAM_CATALOG_LIST.length : 0,
      newsTotal: Array.isArray(g.CAM_NEWS_LIST) ? g.CAM_NEWS_LIST.length : 0,
      version: VERSION,
      key: ROOM_KEY || "",
      target: TARGET_CAMS,
      minCatalogGoal: MIN_CATALOG_GOAL,
      autoDiscovery: !!AUTO_DISCOVERY,
      validateEmbed: !!VALIDATE_EMBED,
      liveCheck: !!BEST_EFFORT_LIVE_CHECK,
      newsEnabled: !!NEWS_ENABLED,
      newsMix: !!NEWS_MIX_IN_MAIN,
      newsInCatalog: !!NEWS_IN_CATALOG,
      newsTarget: NEWS_TARGET
    };
    try { g.dispatchEvent(new CustomEvent("rlc_cam_list_updated", { detail })); } catch (_) {}
  }

  function onUpdate(cb) {
    if (typeof cb !== "function") return () => {};
    const h = (ev) => { try { cb((ev && ev.detail) || null); } catch (_) {} };
    try { g.addEventListener("rlc_cam_list_updated", h); } catch (_) {}
    return () => { try { g.removeEventListener("rlc_cam_list_updated", h); } catch (_) {} };
  }

  function getCatalogList() {
    return Array.isArray(g.CAM_CATALOG_LIST) ? g.CAM_CATALOG_LIST : [];
  }

  function getCatalogTotalPages(pageSize = CATALOG_PAGE_SIZE) {
    const list = getCatalogList();
    const ps = Math.max(1, Math.trunc(pageSize) || 1);
    return Math.max(1, Math.ceil(list.length / ps));
  }

  function getCatalogPage(pageIndex, pageSize = CATALOG_PAGE_SIZE) {
    const list = getCatalogList();
    const ps = Math.max(1, Math.trunc(pageSize) || 1);
    const totalPages = Math.max(1, Math.ceil(list.length / ps));
    const pi = clampInt(pageIndex || 0, 0, totalPages - 1);
    const start = pi * ps;
    const items = list.slice(start, start + ps);
    return { pageIndex: pi, pageSize: ps, totalPages, totalItems: list.length, items };
  }

  function pickRandomUnique(list, n) {
    const out = [];
    const used = new Set();
    if (!Array.isArray(list) || list.length === 0) return out;
    const maxTries = Math.max(60, n * 30);
    let tries = 0;
    while (out.length < n && tries++ < maxTries) {
      const c = list[Math.floor(Math.random() * list.length)];
      if (!c || !c.id || used.has(c.id)) continue;
      used.add(c.id);
      out.push(c);
    }
    for (let i = 0; out.length < n && i < list.length; i++) {
      const c = list[i];
      if (c && c.id && !used.has(c.id)) { used.add(c.id); out.push(c); }
    }
    return out.slice(0, n);
  }

  function getCatalogFeatured(count = CATALOG_PAGE_SIZE) {
    const list = getCatalogList();
    const n = Math.max(1, Math.trunc(count) || 1);
    return pickRandomUnique(list, n);
  }

  // API pública (compat)
  g.RLCCams = g.RLCCams || {};
  g.RLCCams.version = VERSION;
  g.RLCCams.pageSize = CATALOG_PAGE_SIZE;
  g.RLCCams.getCatalogList = getCatalogList;
  g.RLCCams.getCatalogTotalPages = getCatalogTotalPages;
  g.RLCCams.getCatalogPage = getCatalogPage;
  g.RLCCams.getCatalogFeatured = getCatalogFeatured;
  g.RLCCams.onUpdate = onUpdate;

  g.RLCCams.getTarget = () => TARGET_CAMS;
  g.RLCCams.setTarget = (n) => {
    const nn = Math.max(50, Math.min(2500, (Math.trunc(Number(n)) || TARGET_CAMS_DEFAULT)));
    TARGET_CAMS = nn;
    emitUpdate();
    return TARGET_CAMS;
  };
  g.RLCCams.setAutoDiscovery = (v) => { AUTO_DISCOVERY = !!v; emitUpdate(); return AUTO_DISCOVERY; };
  g.RLCCams.setValidateEmbed = (v) => { VALIDATE_EMBED = !!v; emitUpdate(); return VALIDATE_EMBED; };

  g.RLCCams.getNewsList = () => Array.isArray(g.CAM_NEWS_LIST) ? g.CAM_NEWS_LIST : [];
  g.RLCCams.getNewsCatalogList = () => Array.isArray(OUT_NEWS_CATALOG) ? OUT_NEWS_CATALOG : [];
  g.RLCCams.setNewsEnabled = (v) => { NEWS_ENABLED = !!v; emitUpdate(); return NEWS_ENABLED; };
  g.RLCCams.setNewsMix = (v) => { NEWS_MIX_IN_MAIN = !!v; emitUpdate(); return NEWS_MIX_IN_MAIN; };
  g.RLCCams.setNewsInCatalog = (v) => { NEWS_IN_CATALOG = !!v; emitUpdate(); return NEWS_IN_CATALOG; };
  g.RLCCams.setNewsTarget = (n) => { NEWS_TARGET = Math.max(10, Math.min(300, (Math.trunc(Number(n)) || 60))); emitUpdate(); return NEWS_TARGET; };

  g.RLC_CATALOG_PAGE_SIZE = CATALOG_PAGE_SIZE;

  // ─────────────────────────────────────────────────────────────
  // Cache load/save (más permisivo para no arrancar en 0)
  // ─────────────────────────────────────────────────────────────
  function safeJsonParse(s) { try { return JSON.parse(s); } catch (_) { return null; } }

  function cut(s, n) {
    const x = safeStr(s);
    return x.length > n ? x.slice(0, n) : x;
  }

  function compactCam(c) {
    const o = { id: cut(c.id, 64), kind: c.kind };
    o.title = cut(c.title, 120);
    if (c.place) o.place = cut(c.place, 110);
    if (c.source) o.source = cut(c.source, 110);
    if (c.originUrl) o.originUrl = cut(c.originUrl, 240);
    if (c.kind === "youtube") {
      o.youtubeId = c.youtubeId;
      if (c.thumb) o.thumb = cut(c.thumb, 240);
    } else {
      o.url = cut(c.url || "", 240);
    }
    if (typeof c.maxSeconds === "number" && c.maxSeconds > 0) o.maxSeconds = Math.trunc(c.maxSeconds);
    if (Array.isArray(c.tags) && c.tags.length) o.tags = c.tags.slice(0, 8);
    return o;
  }

  function saveCache(keyMain, listNonAlt, limit, alsoLegacy) {
    let lim = Math.min(limit, listNonAlt.length);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const payload = { ts: Date.now(), v: VERSION, target: limit, list: listNonAlt.slice(0, lim).map(compactCam) };
        localStorage.setItem(keyMain, JSON.stringify(payload));
        if (alsoLegacy) localStorage.setItem(CACHE_KEY_LEGACY, JSON.stringify({ ts: payload.ts, list: payload.list }));
        return;
      } catch (_) {
        lim = Math.max(120, Math.floor(lim * 0.62));
      }
    }
  }

  function loadCacheAny(keys, isOkFn) {
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k];
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const obj = safeJsonParse(raw);
        if (!obj || !Array.isArray(obj.list) || typeof obj.ts !== "number") continue;
        const age = Date.now() - obj.ts;
        if (age > CACHE_MAX_AGE_MS) continue;

        const list = [];
        const ids = new Set();
        const yts = new Set();
        const hls = new Set();

        for (let i = 0; i < obj.list.length; i++) {
          const c = obj.list[i];
          if (!c || typeof c !== "object") continue;
          const kind = safeStr(c.kind).toLowerCase();
          if (!ALLOWED_KINDS.has(kind)) continue;

          const id = safeStr(c.id);
          if (!id || ids.has(id)) continue;

          if (!isOkFn(c)) continue;

          if (kind === "youtube") {
            const yid = safeStr(c.youtubeId);
            if (!isValidYouTubeId(yid) || yts.has(yid)) continue;
            yts.add(yid);
            if (!c.thumb) c.thumb = youtubeThumb(yid);
          } else {
            const u = safeStr(c.url) || safeStr(c.originUrl);
            if (!u || !looksLikeM3U8(u)) continue;
            const cu = canonicalUrl(u);
            if (hls.has(cu)) continue;
            hls.add(cu);
            c.url = u;
            if (!c.originUrl) c.originUrl = u;
          }

          c.isAlt = false;
          ids.add(id);
          list.push(c);
        }

        if (list.length) return list;
      } catch (_) {}
    }
    return null;
  }

  // Carga cache webcams (más permisivo: con 20+ ya arranca)
  const cached = loadCacheAny([CACHE_KEY_V239, CACHE_KEY_LEGACY], (c) => camTitleOk(c.title, c.source));
  if (cached && cached.length >= 20) {
    for (let i = 0; i < cached.length; i++) {
      if (OUT_CATALOG.length >= TARGET_CAMS) break;
      pushCam(cached[i]);
    }
    g.CAM_LIST = OUT;
    g.CAM_CATALOG_LIST = OUT_CATALOG;
    emitUpdate();
  }

  // Cache news
  if (NEWS_ENABLED) {
    const cachedNews = loadCacheAny([CACHE_NEWS_KEY_V239], (c) => newsTitleOk(c.title, c.source));
    if (cachedNews && cachedNews.length >= 10) {
      for (let i = 0; i < cachedNews.length; i++) {
        if (OUT_NEWS_CATALOG.length >= NEWS_TARGET) break;
        pushNews(cachedNews[i]);
      }
      g.CAM_NEWS_LIST = OUT_NEWS;
      emitUpdate();
    }
  }

  // Clear cache API
  g.RLCCams.clearCache = () => {
    try { localStorage.removeItem(CACHE_KEY_V239); } catch (_) {}
    try { localStorage.removeItem(CACHE_NEWS_KEY_V239); } catch (_) {}
    try { if (!NS) localStorage.removeItem(CACHE_KEY_LEGACY); } catch (_) {}
    emitUpdate();
  };

  // ─────────────────────────────────────────────────────────────
  // Fetch smart (proxies) + budgets
  // ─────────────────────────────────────────────────────────────
  function budgetOk() { return __reqUsed < DISCOVERY_REQUEST_BUDGET; }
  function validateBudgetOk() { return __validateUsed < VALIDATE_BUDGET; }

  async function fetchWithTimeout(url, opts, timeoutMs) {
    if (!budgetOk()) throw new Error("budget_exhausted");
    __reqUsed++;

    const controller = new AbortController();
    const t = setTimeout(() => { try { controller.abort("timeout"); } catch (_) {} }, timeoutMs || 10000);

    const sig = opts && opts.signal ? opts.signal : null;
    const onAbort = () => { try { controller.abort("abort"); } catch (_) {} };

    if (sig) { try { sig.addEventListener("abort", onAbort, { once: true }); } catch (_) {} }
    try { MOD._abort.signal.addEventListener("abort", onAbort, { once: true }); } catch (_) {}

    try {
      return await fetch(url, Object.assign({}, opts || {}, { signal: controller.signal }));
    } finally {
      clearTimeout(t);
      if (sig) { try { sig.removeEventListener("abort", onAbort); } catch (_) {} }
      try { MOD._abort.signal.removeEventListener("abort", onAbort); } catch (_) {}
    }
  }

  function normalizeUrl(u) {
    const s = safeStr(u);
    if (!s) return "";
    if (s.startsWith("http://")) return "https://" + s.slice(7);
    return s;
  }

  // Proxies/fallbacks (más opciones = más tasa de éxito)
  const PROXIES_TEXT = [
    (u) => normalizeUrl(u),
    (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(normalizeUrl(u)),
    (u) => "https://corsproxy.io/?" + encodeURIComponent(normalizeUrl(u)),
    (u) => "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(normalizeUrl(u)),
    (u) => "https://r.jina.ai/http://" + normalizeUrl(u).replace(/^https?:\/\//, ""),
    (u) => "https://r.jina.ai/https://" + normalizeUrl(u).replace(/^https?:\/\//, "")
  ];

  async function fetchTextSmart(url, timeoutMs, signal) {
    const errs = [];
    for (let i = 0; i < PROXIES_TEXT.length; i++) {
      if (!budgetOk()) break;
      const u = PROXIES_TEXT[i](url);
      try {
        const r = await fetchWithTimeout(u, { method: "GET", cache: "no-store", signal }, timeoutMs || 9000);
        if (!r || !r.ok) throw new Error(`HTTP ${r ? r.status : "?"}`);
        const tx = await r.text();
        if (tx && tx.length > 0) return tx;
      } catch (e) {
        errs.push(e);
      }
    }
    throw (errs[errs.length - 1] || new Error("fetchTextSmart failed"));
  }

  async function fetchJsonSmart(url, timeoutMs, signal) {
    const tx = await fetchTextSmart(url, timeoutMs || 9000, signal);
    const obj = safeJsonParse(tx);
    if (obj != null) return obj;

    // intenta “recortar” JSON si viene envuelto
    const a = Math.min(
      tx.indexOf("{") >= 0 ? tx.indexOf("{") : tx.length,
      tx.indexOf("[") >= 0 ? tx.indexOf("[") : tx.length
    );
    const b = Math.max(tx.lastIndexOf("}"), tx.lastIndexOf("]"));
    if (a >= 0 && b > a) {
      const cut = tx.slice(a, b + 1);
      const obj2 = safeJsonParse(cut);
      if (obj2 != null) return obj2;
    }
    throw new Error("fetchJsonSmart: JSON parse failed");
  }

  // ─────────────────────────────────────────────────────────────
  // Validación (FIX: sin falsos negativos por páginas de error de proxies)
  // ─────────────────────────────────────────────────────────────
  const VALIDATION_CACHE_TTL_MS = Math.max(
    10 * 60 * 1000,
    Math.min(6 * 60 * 60 * 1000, parseIntSafe(getParam("camsValidationCacheMs"), 2 * 60 * 60 * 1000))
  );

  function cacheGet(map, key) {
    try {
      const it = map.get(key);
      if (!it) return null;
      if ((Date.now() - it.ts) > VALIDATION_CACHE_TTL_MS) { map.delete(key); return null; }
      return it.ok === true;
    } catch (_) { return null; }
  }
  function cacheSet(map, key, ok) { try { map.set(key, { ok: !!ok, ts: Date.now() }); } catch (_) {} }

  function isProbablyProxyErrorHtml(html) {
    const h = (html || "").toLowerCase();
    if (!h) return true;
    // páginas cortas tipo “403/blocked”
    if (h.length < 180) return true;
    if (h.includes("allorigins") || h.includes("corsproxy") || h.includes("codetabs") || h.includes("r.jina.ai")) return true;
    if (h.includes("<title>403") || h.includes("error 403") || h.includes("access denied") || h.includes("request blocked")) return true;
    return false;
  }

  function textLikelyBlockedEmbed(html) {
    const h = (html || "").toLowerCase();
    if (!h) return false;

    // SOLO frases muy específicas (NO “forbidden” genérico)
    if (h.includes("playback on other websites has been disabled")) return true;
    if (h.includes("video unavailable")) return true;
    if (h.includes("this video is unavailable")) return true;
    if (h.includes("sign in to confirm your age")) return true;

    // playability status muy específico
    if (h.includes("\"playabilitystatus\"") && (h.includes("unplayable") || h.includes("login_required") || h.includes("age_verification_required"))) return true;

    return false;
  }

  function textLooksNotLive(html) {
    const h = (html || "").toLowerCase();
    if (!h) return false;
    if (h.includes("premiere")) return true;
    if (h.includes("upcoming")) return true;
    if (h.includes("scheduled")) return true;
    return false;
  }

  async function isReallyLiveYouTube(videoId, signal) {
    if (!BEST_EFFORT_LIVE_CHECK) return true;

    const cached = cacheGet(MOD._liveCache, videoId);
    if (cached !== null) return cached;

    if (!validateBudgetOk()) return true;
    __validateUsed++;

    try {
      const html = await fetchTextSmart(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, 12000, signal);
      if (!html) { cacheSet(MOD._liveCache, videoId, true); return true; }
      const h = html.toLowerCase();

      if (textLooksNotLive(h)) { cacheSet(MOD._liveCache, videoId, false); return false; }

      const liveSignals = [
        "\"islive\":true",
        "\"islivecontent\":true",
        "\"islivenow\":true",
        "hlsmanifesturl",
        "livestreamability",
        "live stream",
        "\"is_live\":true"
      ];
      for (let i = 0; i < liveSignals.length; i++) {
        if (h.includes(liveSignals[i])) { cacheSet(MOD._liveCache, videoId, true); return true; }
      }

      // best-effort: si no hay señal, no bloqueamos
      cacheSet(MOD._liveCache, videoId, true);
      return true;
    } catch (_) {
      cacheSet(MOD._liveCache, videoId, true);
      return true;
    }
  }

  async function isEmbeddableYouTube(videoId, signal) {
    const cached = cacheGet(MOD._embedCache, videoId);
    if (cached !== null) return cached;

    // Si VALIDATE_EMBED off: solo live-check
    if (!VALIDATE_EMBED) {
      const ok = await isReallyLiveYouTube(videoId, signal);
      cacheSet(MOD._embedCache, videoId, ok);
      return ok;
    }

    if (!validateBudgetOk()) return true;
    __validateUsed++;

    // 1) oEmbed (rápido)
    let oembedSaidNo = false;
    try {
      const o = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent("https://www.youtube.com/watch?v=" + videoId)}`;
      const r = await fetchWithTimeout(o, { method: "GET", cache: "no-store", signal }, 8500);
      if (r && r.ok) {
        // ok
      } else if (r && r.status === 404) {
        oembedSaidNo = true;
      } else {
        // 401/403/rate-limit => unknown
      }
    } catch (_) {}

    if (oembedSaidNo) { cacheSet(MOD._embedCache, videoId, false); return false; }

    // 2) embed HTML (vía proxy). FIX: si parece HTML de error, NO lo contamos como "blocked".
    try {
      const html = await fetchTextSmart(`https://www.youtube.com/embed/${videoId}`, 10000, signal);
      if (html && !isProbablyProxyErrorHtml(html) && textLikelyBlockedEmbed(html)) {
        cacheSet(MOD._embedCache, videoId, false);
        return false;
      }
    } catch (_) {}

    // 3) live check (best-effort)
    const liveOk = await isReallyLiveYouTube(videoId, signal);
    if (!liveOk) { cacheSet(MOD._embedCache, videoId, false); return false; }

    cacheSet(MOD._embedCache, videoId, true);
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // Invidious instances + backoff
  // ─────────────────────────────────────────────────────────────
  function instIsInBackoff(instance) {
    const it = MOD._instHealth.get(instance);
    if (!it) return false;
    return (Date.now() < it.untilTs);
  }
  function instFail(instance) {
    try {
      const it = MOD._instHealth.get(instance) || { fail: 0, untilTs: 0 };
      it.fail = Math.min(50, (it.fail || 0) + 1);
      const backoff = Math.min(5 * 60 * 1000, 10000 * Math.pow(2, Math.min(5, it.fail - 1)));
      it.untilTs = Date.now() + backoff;
      MOD._instHealth.set(instance, it);
    } catch (_) {}
  }
  function instOk(instance) {
    try {
      const it = MOD._instHealth.get(instance);
      if (!it) return;
      it.fail = Math.max(0, (it.fail || 0) - 1);
      it.untilTs = 0;
      MOD._instHealth.set(instance, it);
    } catch (_) {}
  }

  async function getInvidiousInstances(signal) {
    const fallback = [
      "https://inv.nadeko.net",
      "https://yewtu.be",
      "https://invidious.f5.si",
      "https://invidious.nerdvpn.de",
      "https://inv.perditum.com",
      "https://invidious.tiekoetter.com"
    ];
    try {
      const data = await fetchJsonSmart("https://api.invidious.io/instances.json", 13000, signal);
      const out = [];
      if (Array.isArray(data)) {
        for (let i = 0; i < data.length; i++) {
          const row = data[i];
          if (!Array.isArray(row) || row.length < 2) continue;
          const info = row[1] || {};
          const uri = safeStr(info.uri);
          if (!uri || !uri.startsWith("http")) continue;
          const u = (uri.startsWith("http://") ? "https://" + uri.slice(7) : uri).replace(/\/+$/, "");
          out.push(u);
        }
      }
      const uniq = [];
      const s = new Set();
      for (let i = 0; i < out.length; i++) {
        const u = out[i];
        if (!u || s.has(u)) continue;
        s.add(u);
        uniq.push(u);
      }
      for (let i = 0; i < fallback.length; i++) {
        const u = fallback[i];
        if (!s.has(u)) { s.add(u); uniq.push(u); }
      }
      return uniq.slice(0, Math.max(5, DISCOVERY_MAX_INSTANCES));
    } catch (_) {
      return fallback.slice(0, Math.max(5, DISCOVERY_MAX_INSTANCES));
    }
  }

  async function invidiousSearch(instance, q, page, region, sort, signal) {
    if (!budgetOk()) return [];
    if (instIsInBackoff(instance)) return [];
    const base = instance.replace(/\/+$/, "");
    const url =
      `${base}/api/v1/search` +
      `?q=${encodeURIComponent(q)}` +
      `&page=${encodeURIComponent(String(page))}` +
      `&type=video` +
      `&features=live` +
      `&sort=${encodeURIComponent(sort || "relevance")}` +
      `&region=${encodeURIComponent(region || "US")}`;

    try {
      const res = await fetchJsonSmart(url, 13000, signal);
      instOk(instance);
      return Array.isArray(res) ? res : [];
    } catch (e) {
      instFail(instance);
      throw e;
    }
  }

  // FIX: detectar “live” aunque liveNow sea raro
  function isLiveResult(r) {
    if (!r || typeof r !== "object") return false;

    const title = safeStr(r.title).toLowerCase();
    const author = safeStr(r.author).toLowerCase();
    const full = (title + " " + author).trim();
    if (!full) return false;

    if (r.isUpcoming === true || r.upcoming === true || r.premiere === true) return false;
    if (textLooksNotLive(title)) return false;
    if (r.isShort === true || r.is_short === true) return false;

    const flags = [r.liveNow, r.live_now, r.isLive, r.is_live, r.live, r.isLiveContent, r.is_live_content];
    for (let i = 0; i < flags.length; i++) {
      if (flags[i] === true) return true;
      const s = safeStr(flags[i]).toLowerCase();
      if (s && s.includes("live")) return true;
    }

    const badges = r.badges || r.badge || r.badgeText || r.badge_text;
    if (Array.isArray(badges)) {
      for (let i = 0; i < badges.length; i++) if (safeStr(badges[i]).toLowerCase().includes("live")) return true;
    } else if (safeStr(badges).toLowerCase().includes("live")) {
      return true;
    }

    const ls = (r.lengthSeconds != null) ? Number(r.lengthSeconds) : (r.length_seconds != null ? Number(r.length_seconds) : NaN);
    if (Number.isFinite(ls) && ls === 0) return true;

    // features=live ya filtra: si no hay señal clara, no descartamos aquí.
    return true;
  }

  function toAutoCam(entry, relaxed) {
    const vid = safeStr(entry && (entry.videoId || entry.video_id));
    if (!isValidYouTubeId(vid)) return null;

    const title = safeStr(entry.title) || "Live Cam";
    const author = safeStr(entry.author);
    const okTitle = relaxed ? camTitleOkRelaxed(title, author) : camTitleOk(title, author);
    if (!okTitle) return null;

    return {
      id: `yt_${vid}`,
      title,
      place: "",
      source: author ? `${author} (YouTube Live)` : "YouTube Live",
      kind: "youtube",
      youtubeId: vid,
      originUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(vid)}`,
      thumb: youtubeThumb(vid),
      tags: relaxed ? ["auto","live","webcam","relaxed"] : ["auto","live","webcam"],
      isAlt: false
    };
  }

  function toAutoNews(entry) {
    const vid = safeStr(entry && (entry.videoId || entry.video_id));
    if (!isValidYouTubeId(vid)) return null;

    const title = safeStr(entry.title) || "News Live";
    const author = safeStr(entry.author);
    if (!newsTitleOk(title, author)) return null;

    return {
      id: `news_${vid}`,
      title,
      place: "",
      source: author ? `${author} (YouTube Live)` : "YouTube Live",
      kind: "youtube",
      youtubeId: vid,
      originUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(vid)}`,
      thumb: youtubeThumb(vid),
      tags: ["news","auto","live"],
      isAlt: false
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Queries (seeds + discovery)
  // ─────────────────────────────────────────────────────────────
  const HUB_QUERIES = [
    "earthcam live cam",
    "skylinewebcams live webcam",
    "ozolio live webcam",
    "webcam galore live cam",
    "ipcamlive webcam",
    "live traffic camera",
    "street camera live",
    "downtown live cam",
    "boardwalk live cam",
    "beach webcam live",
    "harbor webcam live",
    "airport webcam live",
    "train station live cam",
    "railcam live",
    "bridge cam live",
    "mountain webcam live",
    "ski cam live",
    "volcano live cam",
    "zoo live webcam",
    "aquarium live cam",
    "wildlife live cam",
    "webcam en vivo",
    "webcam en directo",
    "telecamera in diretta",
    "webcam ao vivo",
    "kamera na żywo"
  ];

  const PLACE_SEEDS = [
    "Madrid","Barcelona","Valencia","Sevilla","Málaga","Bilbao","San Sebastián","Palma","Tenerife","Gran Canaria",
    "Lisbon","Porto","London","Paris","Rome","Venice","Milan","Berlin","Amsterdam","Prague","Vienna","Budapest",
    "Stockholm","Oslo","Helsinki","Reykjavík","Athens","Santorini","Istanbul",
    "Tokyo","Shibuya","Osaka","Kyoto","Seoul","Busan","Singapore","Hong Kong","Taipei","Bangkok","Phuket","Hanoi",
    "Sydney","Melbourne","Auckland",
    "New York","Times Square","Miami","Los Angeles","San Francisco","Las Vegas","Chicago","Seattle",
    "Toronto","Vancouver","Montreal",
    "Rio de Janeiro","Copacabana","São Paulo","Buenos Aires","Santiago","Lima","Cancún","Ciudad de México",
    "Cape Town","Cairo","Marrakesh"
  ];

  const PLACE_SUFFIXES = [
    "live cam",
    "live webcam",
    "webcam live",
    "traffic camera live",
    "harbor webcam live",
    "airport webcam live",
    "town square live cam",
    "boardwalk live cam",
    "webcam en vivo",
    "webcam en directo",
    "cámara en vivo",
    "telecamera in diretta",
    "webcam ao vivo",
    "kamera na żywo"
  ];

  function stableRandSeed() {
    try {
      const d = new Date();
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + 1;
      const day = d.getUTCDate();
      const key = (ROOM_KEY || "nokey");
      let h = 2166136261 >>> 0;
      const s = `${y}-${m}-${day}|${key}|${TARGET_CAMS}`;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }
      return h >>> 0;
    } catch (_) { return (Date.now() >>> 0); }
  }

  function seededShuffle(arr, seed) {
    if (!Array.isArray(arr) || arr.length < 2) return arr;
    let x = (seed >>> 0) || 1;
    for (let i = arr.length - 1; i > 0; i--) {
      x ^= x << 13; x >>>= 0;
      x ^= x >> 17; x >>>= 0;
      x ^= x << 5;  x >>>= 0;
      const j = (x % (i + 1)) >>> 0;
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function buildSeedQueries() {
    const set = new Set();
    for (let i = 0; i < HUB_QUERIES.length; i++) set.add(HUB_QUERIES[i]);

    const seed = stableRandSeed();
    const places = PLACE_SEEDS.slice();
    const suffixes = PLACE_SUFFIXES.slice();
    if (QUERY_SHUFFLE) {
      seededShuffle(places, seed ^ 0xA5A5A5A5);
      seededShuffle(suffixes, seed ^ 0x5A5A5A5A);
    }

    const placeCap = Math.max(20, Math.min(places.length, TARGET_CAMS >= 1400 ? 70 : 55));
    const suffixCap = Math.max(8, Math.min(suffixes.length, 12));

    for (let i = 0; i < placeCap; i++) {
      for (let j = 0; j < suffixCap; j++) set.add(`${places[i]} ${suffixes[j]}`);
      if (i % 4 === 0) set.add(`${places[i]} live cam 24/7`);
    }

    const out = Array.from(set);
    if (QUERY_SHUFFLE) seededShuffle(out, stableRandSeed() ^ 0xC0FFEE);
    return out.slice(0, Math.max(60, Math.min(QUERY_CAP, out.length)));
  }

  const NEWS_QUERIES = [
    "breaking news live",
    "world news live",
    "noticias en directo",
    "última hora en directo",
    "euronews live",
    "france 24 live",
    "dw news live",
    "sky news live",
    "al jazeera live"
  ];

  // Seeds news (HLS muy estable)
  const NEWS_RAW = [
    { id:"news_france24_en_hls", title:"FRANCE 24 English — LIVE (HLS)", place:"Global", source:"France 24", kind:"hls", url:"https://static.france24.com/live/F24_EN_HI_HLS/live_web.m3u8", originUrl:"https://static.france24.com/live/F24_EN_HI_HLS/live_web.m3u8", tags:["news","global","en","live","hls"] },
    { id:"news_france24_es_hls", title:"FRANCE 24 Español — LIVE (HLS)", place:"Global", source:"France 24", kind:"hls", url:"https://static.france24.com/live/F24_ES_HI_HLS/live_web.m3u8", originUrl:"https://static.france24.com/live/F24_ES_HI_HLS/live_web.m3u8", tags:["news","global","es","live","hls"] },
    { id:"news_france24_fr_hls", title:"FRANCE 24 Français — LIVE (HLS)", place:"Global", source:"France 24", kind:"hls", url:"https://static.france24.com/live/F24_FR_HI_HLS/live_web.m3u8", originUrl:"https://static.france24.com/live/F24_FR_HI_HLS/live_web.m3u8", tags:["news","global","fr","live","hls"] },
    { id:"news_france24_ar_hls", title:"FRANCE 24 العربية — LIVE (HLS)", place:"Global", source:"France 24", kind:"hls", url:"https://static.france24.com/live/F24_AR_HI_HLS/live_web.m3u8", originUrl:"https://static.france24.com/live/F24_AR_HI_HLS/live_web.m3u8", tags:["news","global","ar","live","hls"] }
  ];

  // ─────────────────────────────────────────────────────────────
  // News seeding (si activas)
  // ─────────────────────────────────────────────────────────────
  if (NEWS_ENABLED) {
    for (let i = 0; i < NEWS_RAW.length; i++) {
      const n = NEWS_RAW[i];
      if (!n) continue;
      if (!newsTitleOk(n.title, n.source)) continue;
      pushNews(Object.assign({ isAlt:false }, n));
    }
    g.CAM_NEWS_LIST = OUT_NEWS;
    emitUpdate();
  }

  // ─────────────────────────────────────────────────────────────
  // Mixing news en main (opcional)
  // ─────────────────────────────────────────────────────────────
  function applyNewsMixing() {
    g.CAM_NEWS_LIST = OUT_NEWS;
    if (!NEWS_ENABLED) return;

    function canAddToMain(n) {
      const kind = safeStr(n && n.kind).toLowerCase();
      if (kind === "youtube") {
        const yid = safeStr(n.youtubeId);
        return isValidYouTubeId(yid) && !seenYouTube.has(yid);
      }
      if (kind === "hls") {
        const url = safeStr(n.url) || safeStr(n.originUrl);
        if (!url || !looksLikeM3U8(url)) return false;
        const canon = canonicalUrl(url);
        return !seenHlsUrl.has(canon);
      }
      return false;
    }

    function buildMainCamFromNews(n, suffixTag) {
      const kind = safeStr(n.kind).toLowerCase();
      if (kind === "youtube") {
        const yid = safeStr(n.youtubeId);
        let id = safeStr(n.id) || `news_${yid}`;
        if (seenIds.has(id)) id = `${id}_${suffixTag}_${Math.floor(Math.random() * 1e6)}`;
        return Object.assign({}, n, {
          id,
          tags: Array.isArray(n.tags) ? n.tags.slice(0, 11).concat([suffixTag]) : ["news", suffixTag],
          isAlt: false
        });
      }
      if (kind === "hls") {
        const url = safeStr(n.url) || safeStr(n.originUrl);
        let id = safeStr(n.id) || `news_hls_${Math.floor(Math.random() * 1e9)}`;
        if (seenIds.has(id)) id = `${id}_${suffixTag}_${Math.floor(Math.random() * 1e6)}`;
        return Object.assign({}, n, {
          id,
          url,
          originUrl: safeStr(n.originUrl) || url,
          tags: Array.isArray(n.tags) ? n.tags.slice(0, 11).concat([suffixTag]) : ["news","hls", suffixTag],
          isAlt: false
        });
      }
      return null;
    }

    if (NEWS_MIX_IN_MAIN) {
      for (let i = 0; i < OUT_NEWS_CATALOG.length; i++) {
        const n = OUT_NEWS_CATALOG[i];
        if (!n || !canAddToMain(n)) continue;
        const cam = buildMainCamFromNews(n, "mixed");
        if (!cam) continue;
        if (NEWS_IN_CATALOG) pushCam(cam);
        else {
          // en main pero no en catálogo
          if (!seenIds.has(cam.id)) {
            seenIds.add(cam.id);
            if (cam.kind === "youtube") seenYouTube.add(cam.youtubeId);
            if (cam.kind === "hls") seenHlsUrl.add(canonicalUrl(cam.url));
            OUT.push(cam);
          }
        }
      }
    } else if (NEWS_IN_CATALOG) {
      for (let i = 0; i < OUT_NEWS_CATALOG.length; i++) {
        const n = OUT_NEWS_CATALOG[i];
        if (!n || !canAddToMain(n)) continue;
        const cam = buildMainCamFromNews(n, "news");
        if (!cam) continue;
        pushCam(cam);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Seeds LIVE resolver (para NO arrancar en 0)
  // ─────────────────────────────────────────────────────────────
  async function runSeedLive(instances, signal) {
    // objetivo: garantizar un “piso” rápido (ej 120–250) antes del discovery grande
    const seedFloor = Math.max(80, Math.min(280, parseIntSafe(getParam("camsSeedFloor"), 180)));

    if (OUT_CATALOG.length >= seedFloor) return;
    const queries = buildSeedQueries();

    const tasks = [];
    let instCursor = 0;

    // pocas páginas por seed para rapidez
    const pagesPerSeed = Math.max(1, Math.min(4, parseIntSafe(getParam("camsSeedPages"), 2)));
    const sorts = ["relevance","views"];

    for (let qi = 0; qi < queries.length && tasks.length < 1200; qi++) {
      const q = queries[qi];
      for (let si = 0; si < sorts.length; si++) {
        for (let p = 1; p <= pagesPerSeed; p++) {
          const inst = instances[instCursor++ % instances.length];
          const region = DISCOVERY_REGIONS[(qi + p + si) % DISCOVERY_REGIONS.length];
          tasks.push({ q, p, inst, region, sort: sorts[si] });
        }
      }
      if (tasks.length > 1200) break;
    }

    let cursor = 0;
    const addedNow = new Set();

    async function worker() {
      while (cursor < tasks.length && OUT_CATALOG.length < seedFloor) {
        if (!budgetOk()) break;
        const t = tasks[cursor++];

        try {
          const results = await invidiousSearch(t.inst, t.q, t.p, t.region, t.sort, signal);
          for (let i = 0; i < results.length; i++) {
            if (!budgetOk()) break;
            const r = results[i];
            if (!r || String(r.type || "").toLowerCase() !== "video") continue;
            if (!isLiveResult(r)) continue;

            const cam = toAutoCam(r, false);
            if (!cam) continue;

            const vid = cam.youtubeId;
            if (seenYouTube.has(vid) || addedNow.has(vid)) continue;
            addedNow.add(vid);

            const ok = await isEmbeddableYouTube(vid, signal);
            if (!ok) continue;

            pushCam(cam);
            if (OUT_CATALOG.length >= seedFloor) break;
          }
        } catch (_) {
          // silencio
        } finally {
          await sleep(35);
        }
      }
    }

    const workers = [];
    const n = Math.max(1, Math.min(8, DISCOVERY_CONCURRENCY));
    for (let i = 0; i < n; i++) workers.push(worker());
    await Promise.all(workers);

    g.CAM_LIST = OUT;
    g.CAM_CATALOG_LIST = OUT_CATALOG;
    emitUpdate();
  }

  // ─────────────────────────────────────────────────────────────
  // Discovery grande (completar hasta TARGET_CAMS)
  // ─────────────────────────────────────────────────────────────
  function capTasks(tasks) {
    const max = Math.max(320, Math.min(42000, Math.floor(DISCOVERY_REQUEST_BUDGET * 4)));
    if (tasks.length <= max) return tasks;
    shuffleInPlace(tasks);
    return tasks.slice(0, max);
  }

  async function runDiscoveryWebcams(instances, signal, passIndex) {
    if (!AUTO_DISCOVERY) return;
    if (OUT_CATALOG.length >= TARGET_CAMS) return;

    const relaxed = (passIndex >= 1);
    const candidates = [];
    const addedNow = new Set();

    const queries = buildSeedQueries();
    const sorts = relaxed ? ["views","date","relevance"] : ["relevance"];

    const tasks = [];
    let instCursor = 0;

    for (let qi = 0; qi < queries.length; qi++) {
      const q = queries[qi];
      for (let si = 0; si < sorts.length; si++) {
        const sort = sorts[si];
        for (let p = 1; p <= DISCOVERY_MAX_PAGES_PER_QUERY; p++) {
          const inst = instances[instCursor++ % instances.length];
          const region = DISCOVERY_REGIONS[(qi + p + si) % DISCOVERY_REGIONS.length];
          tasks.push({ q, p, inst, region, sort });
        }
      }
    }

    const cappedTasks = capTasks(tasks);
    let cursor = 0;
    const foundForQuery = Object.create(null);

    async function worker() {
      while (cursor < cappedTasks.length && (OUT_CATALOG.length + candidates.length) < TARGET_CAMS) {
        if (!budgetOk()) break;
        const t = cappedTasks[cursor++];

        try {
          const key = t.q + "|" + t.sort;
          foundForQuery[key] = foundForQuery[key] || 0;
          if (foundForQuery[key] >= DISCOVERY_MAX_PER_QUERY) { await sleep(10); continue; }

          const results = await invidiousSearch(t.inst, t.q, t.p, t.region, t.sort, signal);

          for (let i = 0; i < results.length; i++) {
            if (!budgetOk()) break;
            const r = results[i];
            if (!r || String(r.type || "").toLowerCase() !== "video") continue;
            if (!isLiveResult(r)) continue;

            const cam = toAutoCam(r, relaxed);
            if (!cam) continue;

            const vid = cam.youtubeId;
            if (seenYouTube.has(vid) || addedNow.has(vid)) continue;
            addedNow.add(vid);

            const ok = await isEmbeddableYouTube(vid, signal);
            if (!ok) continue;

            candidates.push(cam);
            foundForQuery[key]++;

            if ((OUT_CATALOG.length + candidates.length) >= TARGET_CAMS) break;
          }
        } catch (_) {
          // silencio
        } finally {
          await sleep(relaxed ? 34 : 48);
        }
      }
    }

    const workers = [];
    const n = Math.max(1, Math.min(DISCOVERY_CONCURRENCY, 12));
    for (let i = 0; i < n; i++) workers.push(worker());
    await Promise.all(workers);

    for (let i = 0; i < candidates.length && OUT_CATALOG.length < TARGET_CAMS; i++) pushCam(candidates[i]);
  }

  async function runDiscoveryNews(instances, signal) {
    if (!NEWS_ENABLED || !NEWS_DISCOVERY) return;
    if (OUT_NEWS_CATALOG.length >= NEWS_TARGET) return;

    const candidates = [];
    const addedNow = new Set();

    const tasks = [];
    let instCursor = 0;

    for (let qi = 0; qi < NEWS_QUERIES.length; qi++) {
      const q = NEWS_QUERIES[qi];
      for (let p = 1; p <= Math.max(2, Math.min(10, DISCOVERY_MAX_PAGES_PER_QUERY)); p++) {
        const inst = instances[instCursor++ % instances.length];
        const region = DISCOVERY_REGIONS[(qi + p) % DISCOVERY_REGIONS.length];
        tasks.push({ q, p, inst, region, sort: "relevance" });
      }
    }

    const cappedTasks = capTasks(tasks);
    let cursor = 0;

    async function worker() {
      while (cursor < cappedTasks.length && (OUT_NEWS_CATALOG.length + candidates.length) < NEWS_TARGET) {
        if (!budgetOk()) break;
        const t = cappedTasks[cursor++];

        try {
          const results = await invidiousSearch(t.inst, t.q, t.p, t.region, t.sort, signal);

          for (let i = 0; i < results.length; i++) {
            if (!budgetOk()) break;
            const r = results[i];
            if (!r || String(r.type || "").toLowerCase() !== "video") continue;
            if (!isLiveResult(r)) continue;

            const cam = toAutoNews(r);
            if (!cam) continue;

            const vid = cam.youtubeId;
            if (NEWS_SEEN_YT.has(vid) || addedNow.has(vid)) continue;
            addedNow.add(vid);

            const ok = await isEmbeddableYouTube(vid, signal);
            if (!ok) continue;

            candidates.push(cam);
            if ((OUT_NEWS_CATALOG.length + candidates.length) >= NEWS_TARGET) break;
          }
        } catch (_) {
          // silencio
        } finally {
          await sleep(55);
        }
      }
    }

    const workers = [];
    const n = Math.max(1, Math.min(3, DISCOVERY_CONCURRENCY));
    for (let i = 0; i < n; i++) workers.push(worker());
    await Promise.all(workers);

    for (let i = 0; i < candidates.length && OUT_NEWS_CATALOG.length < NEWS_TARGET; i++) pushNews(candidates[i]);
  }

  // ─────────────────────────────────────────────────────────────
  // addCustom (compat)
  // ─────────────────────────────────────────────────────────────
  g.RLCCams.addCustom = async function addCustom(url, options = {}) {
    const u = safeStr(url);
    if (!u) return null;

    let youtubeId = extractYouTubeIdFromUrl(u);
    let kind = "";
    let title = safeStr(options.title) || "Custom Cam";
    let place = safeStr(options.place) || "Custom";
    let source = safeStr(options.source) || "Custom URL";
    let tags = Array.isArray(options.tags) ? options.tags.slice(0, 12) : ["custom"];

    if (youtubeId) {
      kind = "youtube";
      const ok = await isEmbeddableYouTube(youtubeId, MOD._abort.signal);
      if (!ok) return null;
    } else if (looksLikeM3U8(u)) {
      kind = "hls";
    } else {
      return null;
    }

    const id = `custom_${Math.floor(Math.random() * 1e9)}`;

    const cam = { id, title, place, source, kind, tags, isAlt: false };
    if (kind === "youtube") {
      cam.youtubeId = youtubeId;
      cam.originUrl = u;
      cam.thumb = youtubeThumb(youtubeId);
    } else {
      cam.url = u;
      cam.originUrl = u;
    }

    if (pushCam(cam)) {
      g.CAM_LIST = OUT;
      g.CAM_CATALOG_LIST = OUT_CATALOG;
      emitUpdate();
      return cam;
    }
    return null;
  };

  // ─────────────────────────────────────────────────────────────
  // Discover pipeline
  // ─────────────────────────────────────────────────────────────
  async function discoverMore() {
    const signal = MOD._abort.signal;

    try {
      // si ya tenemos algo, emitimos (para player/OBS)
      g.CAM_LIST = OUT;
      g.CAM_CATALOG_LIST = OUT_CATALOG;
      g.CAM_NEWS_LIST = OUT_NEWS;
      emitUpdate();

      // Si nada de discovery y no news: al menos cache/lo que haya
      if (!AUTO_DISCOVERY && !NEWS_ENABLED) {
        saveCache(CACHE_KEY_V239, OUT_CATALOG, TARGET_CAMS, (!NS));
        emitUpdate();
        if (__resolveReady && !MOD._readyResolved) { MOD._readyResolved = true; __resolveReady(g.CAM_LIST); }
        return;
      }

      const instancesRaw = await getInvidiousInstances(signal);
      const instances = shuffleInPlace(instancesRaw.slice(0, Math.max(5, DISCOVERY_MAX_INSTANCES)));

      // FASE 1: Seeds LIVE (anti “0 cams”)
      if (AUTO_DISCOVERY && OUT_CATALOG.length < Math.min(TARGET_CAMS, MIN_CATALOG_GOAL)) {
        await runSeedLive(instances, signal);
      }

      // FASE 2: Discovery grande strict
      if (AUTO_DISCOVERY && OUT_CATALOG.length < TARGET_CAMS) {
        await runDiscoveryWebcams(instances, signal, 0);
      }

      // FASE 3: Relax si seguimos por debajo del mínimo
      for (let pass = 1; pass <= RELAX_PASSES; pass++) {
        if (!AUTO_DISCOVERY) break;
        if (OUT_CATALOG.length >= TARGET_CAMS) break;
        if (OUT_CATALOG.length >= MIN_CATALOG_GOAL) break;
        if (!budgetOk()) break;
        await runDiscoveryWebcams(instances, signal, pass);
      }

      // News discovery
      if (NEWS_ENABLED && OUT_NEWS_CATALOG.length < NEWS_TARGET) {
        await runDiscoveryNews(instances, signal);
      }

      applyNewsMixing();

      // ALT fill: solo lista total, NO catálogo
      if (HARD_FAILSAFE_ALT_FILL && OUT.length > 0 && OUT.length < TARGET_CAMS) {
        const baseLen = OUT.length;
        let k = 0;
        while (OUT.length < TARGET_CAMS && k < 60000) {
          const src = OUT[k % baseLen];
          const altN = (Math.floor(k / baseLen) + 1);
          const altId = `${src.id}_alt_${altN}`;
          if (!seenIds.has(altId)) {
            seenIds.add(altId);
            const clone = Object.assign({}, src, {
              id: altId,
              title: `${src.title} (Alt ${altN})`,
              tags: Array.isArray(src.tags) ? src.tags.slice(0, 11).concat(["alt"]) : ["alt"],
              isAlt: true,
              altOf: src.id
            });
            OUT.push(clone);
          }
          k++;
        }
      }

      g.CAM_LIST = OUT;
      g.CAM_CATALOG_LIST = OUT_CATALOG;
      g.CAM_NEWS_LIST = OUT_NEWS;

      saveCache(CACHE_KEY_V239, OUT_CATALOG, TARGET_CAMS, (!NS));
      if (NEWS_ENABLED) saveCache(CACHE_NEWS_KEY_V239, OUT_NEWS_CATALOG, NEWS_TARGET, false);

      emitUpdate();
      if (__resolveReady && !MOD._readyResolved) { MOD._readyResolved = true; __resolveReady(g.CAM_LIST); }
    } catch (_) {
      try { saveCache(CACHE_KEY_V239, OUT_CATALOG, TARGET_CAMS, (!NS)); } catch (_) {}
      try { if (NEWS_ENABLED) saveCache(CACHE_NEWS_KEY_V239, OUT_NEWS_CATALOG, NEWS_TARGET, false); } catch (_) {}
      try { emitUpdate(); } catch (_) {}
      try { if (__resolveReady && !MOD._readyResolved) { MOD._readyResolved = true; __resolveReady(g.CAM_LIST); } } catch (_) {}
    }
  }

  // ─────────────────────────────────────────────────────────────
  // BroadcastChannel hook (Admin)
  // ─────────────────────────────────────────────────────────────
  function msgSig(msg) {
    try {
      const t = String(msg.type || msg.t || "");
      const k = String(msg.key || msg.k || "");
      const ts = String(msg.ts || msg.time || msg.at || "");
      const v = (msg.value === undefined) ? "" : String(msg.value);
      return `${t}|${k}|${ts}|${v}`;
    } catch (_) {
      return "";
    }
  }

  function shouldAcceptMsg(msg) {
    if (!msg || typeof msg !== "object") return false;
    const mk = String(msg.key || msg.k || "").trim();
    if (ROOM_KEY && mk && mk !== ROOM_KEY) return false;
    return true;
  }

  function handleBCMessage(ev) {
    const msg = ev && ev.data;
    if (!msg || typeof msg !== "object") return;
    if (!shouldAcceptMsg(msg)) return;

    const sig = msgSig(msg);
    if (sig && sig === MOD._msgSig) return;
    if (sig) MOD._msgSig = sig;

    const t = msg.type || msg.t;

    if (t === "CAMS_CLEAR_CACHE") { g.RLCCams && g.RLCCams.clearCache && g.RLCCams.clearCache(); return; }
    if (t === "CAMS_SET_TARGET") { g.RLCCams && g.RLCCams.setTarget && g.RLCCams.setTarget(msg.value); return; }
    if (t === "CAMS_SET_AUTODISCOVERY") { g.RLCCams && g.RLCCams.setAutoDiscovery && g.RLCCams.setAutoDiscovery(!!msg.value); return; }
    if (t === "CAMS_SET_VALIDATE") { g.RLCCams && g.RLCCams.setValidateEmbed && g.RLCCams.setValidateEmbed(!!msg.value); return; }
    if (t === "CAMS_SET_NEWS_ENABLED") { g.RLCCams && g.RLCCams.setNewsEnabled && g.RLCCams.setNewsEnabled(!!msg.value); return; }
    if (t === "CAMS_SET_NEWS_MIX") { g.RLCCams && g.RLCCams.setNewsMix && g.RLCCams.setNewsMix(!!msg.value); return; }
    if (t === "CAMS_SET_NEWS_CATALOG") { g.RLCCams && g.RLCCams.setNewsInCatalog && g.RLCCams.setNewsInCatalog(!!msg.value); return; }
    if (t === "CAMS_SET_NEWS_TARGET") { g.RLCCams && g.RLCCams.setNewsTarget && g.RLCCams.setNewsTarget(msg.value); return; }

    if (t === "CAMS_REFRESH") {
      try { MOD._abort.abort(); } catch (_) {}
      MOD._abort = new AbortController();
      __reqUsed = 0;
      __validateUsed = 0;
      const timer = setTimeout(() => { discoverMore(); }, 0);
      MOD._timers.push(timer);
      return;
    }

    if (t === "CAMS_ADD_CUSTOM") {
      const url = safeStr(msg.url || msg.value);
      if (!url) return;
      const opts = (typeof msg.options === "object") ? msg.options : {};
      g.RLCCams.addCustom(url, opts);
    }
  }

  try {
    if ("BroadcastChannel" in g) {
      const base = "rlc_bus_v1";
      const names = [base];
      if (ROOM_KEY) names.push(`${base}:${ROOM_KEY}`);

      try { (MOD._bcs || []).forEach(c => { try { c.close(); } catch (_) {} }); } catch (_) {}
      MOD._bcs = [];

      for (let i = 0; i < names.length; i++) {
        try {
          const bc = new BroadcastChannel(names[i]);
          bc.onmessage = handleBCMessage;
          MOD._bcs.push(bc);
        } catch (_) {}
      }
    }
  } catch (_) {}

  // API: refresh manual
  g.RLCCams.refresh = () => {
    try { MOD._abort.abort(); } catch (_) {}
    MOD._abort = new AbortController();
    __reqUsed = 0;
    __validateUsed = 0;
    const timer = setTimeout(() => { discoverMore(); }, 0);
    MOD._timers.push(timer);
  };

  // Emit inicial (para que el player/OBS se enganchen)
  emitUpdate();

  // Lanza discovery sin bloquear el arranque
  try {
    const timer = setTimeout(() => { discoverMore(); }, 0);
    MOD._timers.push(timer);
  } catch (_) {
    discoverMore();
  }
})();
