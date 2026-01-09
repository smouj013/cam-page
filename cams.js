/* cams.js — Lista de cámaras (VIDEO ONLY + REAL LIVE STRICT + CURATED SEEDS + AUTO-DISCOVERY + CATALOG 4-UP + OPTIONAL NEWS) v2.3.9
   ✅ Integrado para RLC v2.3.9 (Player + Control/Admin + obs-cam-panel.html)
   ✅ VIDEO ONLY: exporta SOLO "youtube" y "hls" (descarta TODO lo demás)
   ✅ REAL LIVE STRICT: quita lo grabado / no-live / no-embeddable (best-effort, pero por defecto ESTRICTO)
   ✅ Objetivo: 1200 cams reales por defecto (override: ?camsTarget=500/800/1200/1600...)
   ✅ Curated Seeds por búsqueda (EarthCam / SkylineWebcams / Ozolio / hubs webcam): evita IDs que se quedan viejas
   ✅ Auto-discovery ampliado (Invidious /api/v1/search?features=live + liveNow + multi-región)
   ✅ Cache compacta + fallback si localStorage revienta
   ✅ Mantiene compat total:
      - window.CAM_LIST / CAM_CATALOG_LIST / CAM_NEWS_LIST / CAM_LIST_READY
      - window.RLCCams.* API
      - evento "rlc_cam_list_updated"
      - BroadcastChannel: rlc_bus_v1 y rlc_bus_v1:{key}

   🔧 Hotfix v2.3.9 (sin subir versión):
      - Validación estricta LIVE para seeds y discovery (si no confirma LIVE, fuera)
      - Curated-seeds por query para iconos (Times Square, Abbey Road, etc.)
      - Evita arrays de tareas gigantes (cap dinámico por presupuesto)
      - Evita bitwise en horas de cache (más seguro)
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  // ─────────────────────────────────────────────────────────────
  // Guard anti doble carga + destroy() (update-safe)
  // ─────────────────────────────────────────────────────────────
  const GUARD_238 = "__RLC_CAMSJS_LOADED_V238_VIDEOONLY_AUTODISCOVERY_CATALOG4_NEWSOPT";
  const GUARD_239 = "__RLC_CAMSJS_LOADED_V239_VIDEOONLY_AUTODISCOVERY_CATALOG4_NEWSOPT_REALSTRICT";
  const LOAD_GUARD = GUARD_239;

  try { const prev = g[GUARD_238]; if (prev && typeof prev.destroy === "function") prev.destroy(); } catch (_) {}
  try { const prev = g[GUARD_239]; if (prev && typeof prev.destroy === "function") prev.destroy(); } catch (_) {}

  if (!g[LOAD_GUARD]) g[LOAD_GUARD] = {};
  const MOD = g[LOAD_GUARD];

  MOD._timers = MOD._timers || [];
  MOD._abort = MOD._abort || new AbortController();
  MOD._bcs = MOD._bcs || [];
  MOD._msgSig = "";

  MOD.destroy = function destroy() {
    try { MOD._timers.forEach((t) => clearTimeout(t)); } catch (_) {}
    MOD._timers = [];
    try { MOD._abort.abort(); } catch (_) {}
    MOD._abort = new AbortController();
    try { (MOD._bcs || []).forEach((c) => { try { c && c.close && c.close(); } catch (_) {} }); } catch (_) {}
    MOD._bcs = [];
    MOD._msgSig = "";
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

  // ✅ ROOM_KEY con fallback (compat con control.js v2.3.9: rlc_last_key_v1)
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
  function clampInt(v, a, b) {
    const n = Number.isFinite(v) ? v : parseIntSafe(v, a);
    const x = Math.trunc(n);
    return Math.max(a, Math.min(b, x));
  }

  // ✅ Objetivo por defecto: ~1200
  const TARGET_CAMS_DEFAULT = 1200;
  let TARGET_CAMS = Math.max(50, Math.min(2500, parseIntSafe(getParam("camsTarget"), TARGET_CAMS_DEFAULT)));

  // Catálogo
  const CATALOG_PAGE_SIZE = 4;

  // Cache: legacy + namespaced
  const CACHE_KEY_LEGACY = "rlc_cam_cache_v1_500";             // compat
  const CACHE_KEY_V238   = `rlc_bus_v1:cams_cache_v1${NS}`;    // nuevo
  const CACHE_NEWS_KEY   = `rlc_bus_v1:news_cache_v1${NS}`;    // news

  // Cache horas (default 12h)
  const cacheHours = Math.max(0.5, Math.min(72, Number(parseIntSafe(getParam("camsCacheHours"), 12)) || 12));
  const CACHE_MAX_AGE_MS = Math.max(30 * 60 * 1000, Math.min(72 * 60 * 60 * 1000, cacheHours * 60 * 60 * 1000));

  // Auto discovery webcams ON/OFF (override: ?camsDiscovery=0/1)
  let AUTO_DISCOVERY = parseBool(getParam("camsDiscovery"), true);

  // Validación embed LIVE (si da problemas en hosting: ?camsValidate=0)
  let VALIDATE_EMBED = parseBool(getParam("camsValidate"), true);

  // STRICT: si no podemos CONFIRMAR LIVE, lo descartamos (default ON)
  let STRICT_LIVE = parseBool(getParam("camsStrictLive"), true);

  // Seeds strict validation (default ON) — descarta seeds si no confirma LIVE/EMBED
  let SEED_VALIDATE = parseBool(getParam("camsSeedValidate"), true);
  const SEED_VALIDATE_MAX  = Math.max(10, Math.min(240, parseIntSafe(getParam("camsSeedValidateMax"), 120)));
  const SEED_VALIDATE_CONC = Math.max(1, Math.min(8, parseIntSafe(getParam("camsSeedValidateConc"), 4)));

  // “Solo lives” (best-effort)
  let BEST_EFFORT_LIVE_CHECK = parseBool(getParam("camsLiveCheck"), true);

  // Concurrencia discovery
  const DISCOVERY_MAX_PAGES_PER_QUERY = Math.max(1, Math.min(20, parseIntSafe(getParam("camsPages"), 10)));
  const DISCOVERY_MAX_PER_QUERY       = Math.max(50, Math.min(1200, parseIntSafe(getParam("camsMaxPerQuery"), 520)));
  const DISCOVERY_CONCURRENCY         = Math.max(1, Math.min(10, parseIntSafe(getParam("camsConc"), 6)));
  const DISCOVERY_MAX_INSTANCES       = Math.max(5, Math.min(28, parseIntSafe(getParam("camsInstances"), 18)));

  // Presupuesto global requests
  const DISCOVERY_REQUEST_BUDGET = Math.max(240, Math.min(8000, parseIntSafe(getParam("camsBudget"), 1800)));

  // Presupuesto de validaciones (embed/live)
  const VALIDATE_BUDGET = Math.max(0, Math.min(8000, parseIntSafe(getParam("camsValidateBudget"), 900)));
  let __validateUsed = 0;

  // ALT failsafe (si quieres sin duplicados: ?camsAltFill=0)
  let HARD_FAILSAFE_ALT_FILL = parseBool(getParam("camsAltFill"), true);

  // News (OPCIONAL)
  let NEWS_ENABLED      = parseBool(getParam("camsNews"), false);
  let NEWS_MIX_IN_MAIN  = parseBool(getParam("camsNewsMix"), false);
  let NEWS_IN_CATALOG   = parseBool(getParam("camsNewsCatalog"), false);
  let NEWS_DISCOVERY    = parseBool(getParam("camsNewsDiscovery"), true);
  let NEWS_TARGET       = Math.max(10, Math.min(300, parseIntSafe(getParam("camsNewsTarget"), 60)));

  // Regiones discovery (rota)
  const DISCOVERY_REGIONS = [
    "US","GB","CA","ES","FR","DE","IT","NL","SE","NO","PL","PT",
    "BR","AR","MX","CL","CO","PE",
    "JP","KR","TW","HK","SG","TH","VN","PH","ID","IN",
    "AU","NZ",
    "ZA","EG","MA","TR","IL","AE"
  ];

  // ─────────────────────────────────────────────────────────────
  // Queries: hubs + lugares (para discovery masivo)
  // ─────────────────────────────────────────────────────────────
  const HUB_QUERIES = [
    "earthcam live cam",
    "earthcam live webcam",
    "skylinewebcams live webcam",
    "skylinewebcams live cam",
    "ozolio live webcam",
    "webcam galore live cam",
    "ipcamlive webcam live",
    "railcam live",
    "airport webcam live",
    "harbor webcam live",
    "port webcam live",
    "marina live cam",
    "downtown live cam",
    "street camera live",
    "traffic camera live",
    "bridge cam live",
    "beach webcam live",
    "boardwalk live cam",
    "mountain webcam live",
    "ski cam live",
    "volcano live cam",
    "zoo live webcam",
    "aquarium live cam",
    "wildlife live cam"
  ];

  const PLACE_SEEDS = [
    "New York","Times Square","Brooklyn","Manhattan","Las Vegas","Miami","Orlando","Los Angeles","San Francisco","Seattle","Chicago","Boston","Washington DC",
    "Toronto","Vancouver","Montreal","Niagara Falls",
    "Caracas","Bogotá","Ciudad de México","Buenos Aires","Santiago","Lima","Rio de Janeiro","São Paulo","Copacabana",
    "Madrid","Barcelona","Valencia","Sevilla","Málaga","Bilbao","Tenerife","Gran Canaria",
    "Lisbon","London","Paris","Rome","Venice","Milan","Naples","Florence","Amsterdam","Prague","Vienna","Berlin","Munich","Copenhagen","Stockholm","Oslo","Dublin","Edinburgh","Athens","Santorini","Istanbul",
    "Tokyo","Shibuya","Osaka","Seoul","Singapore","Hong Kong","Taipei","Bangkok","Dubai","Jerusalem",
    "Sydney","Melbourne","Auckland",
    "Cape Town","Marrakesh","Casablanca","Cairo"
  ];

  const PLACE_SUFFIXES = [
    "live webcam","webcam live","live cam","cctv live",
    "street cam live","downtown live cam","beach webcam live",
    "harbor webcam live","airport webcam live","traffic camera live",
    "port webcam live","marina live cam","town square live cam",
    "boardwalk live cam",
    "webcam en vivo","cámara en vivo","camara en vivo","en directo webcam",
    "telecamera live","webkamera canlı","kamera na żywo"
  ];

  function buildDiscoveryQueries(target) {
    const set = new Set();
    for (let i = 0; i < HUB_QUERIES.length; i++) set.add(HUB_QUERIES[i]);

    const placeCap  = Math.max(30, Math.min(PLACE_SEEDS.length, (target >= 1400 ? 90 : target >= 1000 ? 70 : 55)));
    const suffixCap = Math.max(8,  Math.min(PLACE_SUFFIXES.length, (target >= 1400 ? 18 : target >= 1000 ? 14 : 12)));

    for (let i = 0; i < placeCap; i++) {
      const p = PLACE_SEEDS[i];
      for (let j = 0; j < suffixCap; j++) set.add(`${p} ${PLACE_SUFFIXES[j]}`);
    }
    return Array.from(set);
  }

  // Curated icon seeds por búsqueda (para “sitios” y lugares clave) — NO depende de IDs estáticas
  // Se resuelven con Invidious (live), luego se valida embeddable+live.
  const CURATED_SEEDS = [
    { id:"seed_times_square", label:"Times Square", place:"Times Square, New York, USA", query:"Times Square EarthCam live cam", tags:["city","usa","nyc","earthcam"] },
    { id:"seed_abbey_road", label:"Abbey Road", place:"London, UK", query:"Abbey Road crossing live cam EarthCam", tags:["city","uk","street","earthcam"] },
    { id:"seed_niagara", label:"Niagara Falls", place:"Niagara Falls, Canada", query:"Niagara Falls live cam EarthCam", tags:["nature","waterfall","canada","earthcam"] },
    { id:"seed_waikiki", label:"Waikiki", place:"Waikiki, Honolulu, Hawaii, USA", query:"Waikiki Beach Ozolio Sheraton live webcam", tags:["beach","usa","hawaii","ozolio"] },
    { id:"seed_copacabana", label:"Copacabana", place:"Rio de Janeiro, Brazil", query:"Copacabana SkylineWebcams live cam", tags:["beach","brazil","skylinewebcams"] },
    { id:"seed_colosseum", label:"Colosseum", place:"Rome, Italy", query:"Colosseum SkylineWebcams live cam", tags:["italy","rome","landmark","skylinewebcams"] },
    { id:"seed_venice", label:"Venice", place:"Venice, Italy", query:"Venice Grand Canal live cam", tags:["italy","venice","canal"] },
    { id:"seed_shibuya", label:"Shibuya Crossing", place:"Tokyo, Japan", query:"Shibuya crossing live cam", tags:["japan","tokyo","street"] },
    { id:"seed_dubai_marina", label:"Dubai Marina", place:"Dubai, UAE", query:"Dubai Marina live cam", tags:["uae","dubai","city"] },
    { id:"seed_sydney", label:"Sydney Harbour", place:"Sydney, Australia", query:"Sydney Harbour live cam", tags:["australia","harbour"] },
    { id:"seed_santorini", label:"Santorini", place:"Santorini, Greece", query:"Santorini SkylineWebcams live cam", tags:["greece","island","skylinewebcams"] },
    { id:"seed_cape_town", label:"Table Mountain", place:"Cape Town, South Africa", query:"Table Mountain live cam Cape Town", tags:["south_africa","mountain"] },
  ];

  // News queries (solo si camsNews=1)
  const NEWS_QUERIES = [
    "live news","breaking news live","world news live",
    "noticias en directo","noticias en vivo",
    "france 24 live","dw news live","euronews live","al jazeera live","sky news live"
  ];

  // ─────────────────────────────────────────────────────────────
  // Filtros finos (webcam vs grabado)
  // ─────────────────────────────────────────────────────────────
  function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  const BLOCK_WORDS_BOUNDARY = [
    "lofi","lo-fi","radio","music","música","mix","playlist","beats",
    "podcast","audiobook","audiolibro",
    "gameplay","gaming","walkthrough","speedrun",
    "sermon","church","iglesia","prayer","oración",
    "crypto","trading","forex",
    "tour","travel","travelling","viaje","paseo","recorrido",
    "recorded","replay","rerun","repeat","loop","timelapse","time-lapse","ambience","ambient","study","sleep","relax","asmr",
    "dashcam","driving","ride","vlog","vlogger"
  ];

  const BLOCK_PHRASES = [
    "walking tour","city walk","virtual walk","4k walk",
    "time lapse","behind the scenes","train ride","bus ride","metro ride"
  ];

  const BLOCK_RE = [];
  for (let i = 0; i < BLOCK_WORDS_BOUNDARY.length; i++) BLOCK_RE.push(new RegExp(`\\b${escRe(BLOCK_WORDS_BOUNDARY[i])}\\b`, "i"));
  for (let i = 0; i < BLOCK_PHRASES.length; i++) BLOCK_RE.push(new RegExp(escRe(BLOCK_PHRASES[i]).replace(/\s+/g, "\\s+"), "i"));

  const ALLOW_HINTS = [
    "webcam","web cam","live cam","livecam","camera live","cctv","traffic cam","traffic camera",
    "airport","harbor","harbour","port","pier","beach","coast","marina",
    "downtown","street cam","street camera","square","plaza",
    "railcam","rail cam","station cam","train station",
    "ski cam","snow cam","mountain cam","volcano cam","crater cam",
    "earthcam","skylinewebcams","ozolio","ipcamlive","ip cam",
    "boardwalk","promenade",
    "cámara","camara","en directo","en vivo","directo",
    "telecamera","kamera","kamera na żywo","webkamera","caméra"
  ];

  const KNOWN_WEBCAM_BRANDS = [
    "earthcam","skylinewebcams","ozolio","railcam","ipcamlive","ip cam",
    "webcam","webcams","live cam"
  ];

  // News filter
  const NEWS_BLOCK_WORDS_BOUNDARY = [
    "lofi","lo-fi","music","música","beats","playlist","mix",
    "gaming","gameplay","walkthrough","speedrun",
    "walk","walking","tour","travel","viaje",
    "recorded","replay","rerun","loop","timelapse","time","lapse",
    "asmr","study","sleep","relax",
    "podcast","audiobook","audiolibro"
  ];
  const NEWS_BLOCK_RE = NEWS_BLOCK_WORDS_BOUNDARY.map(w => new RegExp(`\\b${escRe(w)}\\b`, "i"));

  const NEWS_ALLOW_HINTS = [
    "news","noticias","breaking","última hora","live news","en directo","en vivo","directo",
    "channel","canal","noticiero","world news","24/7","24-7"
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

    // fallback: live + cam/webcam/cctv
    const hasLive = /\blive\b/i.test(full) || /\ben vivo\b/i.test(full) || /\ben directo\b/i.test(full);
    const hasCam  = /\b(web\s?cam|webcam|cam|cctv|camera)\b/i.test(full) || /\b(cámara|camara)\b/i.test(full);
    return !!(hasLive && hasCam);
  }

  function newsTitleOk(title, author) {
    const t = safeStr(title).toLowerCase();
    const a = safeStr(author).toLowerCase();
    const full = (t + " " + a).trim();
    if (!full) return false;
    if (matchesAnyRegex(full, NEWS_BLOCK_RE)) return false;
    return includesAny(full, NEWS_ALLOW_HINTS);
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function shuffleInPlace(arr) {
    if (!Array.isArray(arr) || arr.length < 2) return arr;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // ─────────────────────────────────────────────────────────────
  // Video kinds + helpers
  // ─────────────────────────────────────────────────────────────
  const ALLOWED_KINDS = new Set(["youtube", "hls"]);

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
      return x.toString();
    } catch (_) {
      return s;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Cache load/save (compacta)
  // ─────────────────────────────────────────────────────────────
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
    } else if (c.kind === "hls") {
      o.url = cut(c.url || "", 240);
    }

    if (typeof c.maxSeconds === "number" && c.maxSeconds > 0) o.maxSeconds = Math.trunc(c.maxSeconds);
    if (Array.isArray(c.tags) && c.tags.length) o.tags = c.tags.slice(0, 8);
    return o;
  }

  function loadCacheAny(keys, isOkFn) {
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k];
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const obj = JSON.parse(raw);
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
          } else if (kind === "hls") {
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

  function saveCache(keyMain, listNonAlt, limit) {
    let lim = Math.min(limit, listNonAlt.length);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const payload = {
          ts: Date.now(),
          v: VERSION,
          target: limit,
          list: listNonAlt.slice(0, lim).map(compactCam)
        };
        localStorage.setItem(keyMain, JSON.stringify(payload));
        if (!NS && keyMain === CACHE_KEY_V238) {
          localStorage.setItem(CACHE_KEY_LEGACY, JSON.stringify({ ts: payload.ts, list: payload.list }));
        }
        return;
      } catch (_) {
        lim = Math.max(120, Math.floor(lim * 0.62));
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Estado (dedupe)
  // ─────────────────────────────────────────────────────────────
  const seenIds = new Set();
  const seenYouTube = new Set();
  const seenHlsUrl = new Set();

  const OUT = [];
  const OUT_CATALOG = [];

  const NEWS_SEEN_IDS = new Set();
  const NEWS_SEEN_YT  = new Set();
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
    } else if (kind === "hls") {
      const url = safeStr(cam.url) || safeStr(cam.originUrl);
      if (!url || !looksLikeM3U8(url)) return false;
      const canon = canonicalUrl(url);
      if (seenHlsUrl.has(canon)) return false;
      seenHlsUrl.add(canon);
      cam.url = url;
      if (!cam.originUrl) cam.originUrl = url;
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
    } else if (kind === "hls") {
      const url = safeStr(cam.url) || safeStr(cam.originUrl);
      if (!url || !looksLikeM3U8(url)) return false;
      const canon = canonicalUrl(url);
      if (NEWS_SEEN_HLS.has(canon)) return false;
      NEWS_SEEN_HLS.add(canon);
      cam.url = url;
      if (!cam.originUrl) cam.originUrl = url;
    }

    NEWS_SEEN_IDS.add(cam.id);
    OUT_NEWS.push(cam);
    OUT_NEWS_CATALOG.push(cam);
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // Export inmediato + READY promise
  // ─────────────────────────────────────────────────────────────
  g.CAM_LIST = OUT;
  g.CAM_CATALOG_LIST = OUT_CATALOG;
  g.CAM_NEWS_LIST = OUT_NEWS;

  let __resolveReady = null;
  g.CAM_LIST_READY = new Promise((res) => { __resolveReady = res; });

  // ─────────────────────────────────────────────────────────────
  // API CATALOGO (4-up)
  // ─────────────────────────────────────────────────────────────
  function getCatalogList() {
    return Array.isArray(g.CAM_CATALOG_LIST) ? g.CAM_CATALOG_LIST : [];
  }
  function getCatalogTotalPages(pageSize = CATALOG_PAGE_SIZE) {
    const list = getCatalogList();
    const ps = Math.max(1, Math.trunc(pageSize));
    return Math.max(1, Math.ceil(list.length / ps));
  }
  function getCatalogPage(pageIndex, pageSize = CATALOG_PAGE_SIZE) {
    const list = getCatalogList();
    const ps = Math.max(1, Math.trunc(pageSize));
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
    const n = Math.max(1, Math.trunc(count));
    return pickRandomUnique(list, n);
  }

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
      autoDiscovery: !!AUTO_DISCOVERY,
      validateEmbed: !!VALIDATE_EMBED,
      strictLive: !!STRICT_LIVE,
      liveCheck: !!BEST_EFFORT_LIVE_CHECK,
      seedValidate: !!SEED_VALIDATE,
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

  // API pública (compat)
  g.RLCCams = g.RLCCams || {};
  g.RLCCams.version = VERSION;
  g.RLCCams.pageSize = CATALOG_PAGE_SIZE;
  g.RLCCams.getCatalogList = getCatalogList;
  g.RLCCams.getCatalogTotalPages = getCatalogTotalPages;
  g.RLCCams.getCatalogPage = getCatalogPage;
  g.RLCCams.getCatalogFeatured = getCatalogFeatured;
  g.RLCCams.onUpdate = onUpdate;

  // Utilidades
  g.RLCCams.getTarget = () => TARGET_CAMS;
  g.RLCCams.setTarget = (n) => {
    const nn = Math.max(50, Math.min(2500, Math.trunc(n || TARGET_CAMS_DEFAULT)));
    TARGET_CAMS = nn;
    emitUpdate();
    return TARGET_CAMS;
  };
  g.RLCCams.setAutoDiscovery = (v) => { AUTO_DISCOVERY = !!v; emitUpdate(); return AUTO_DISCOVERY; };
  g.RLCCams.setValidateEmbed = (v) => { VALIDATE_EMBED = !!v; emitUpdate(); return VALIDATE_EMBED; };
  g.RLCCams.setStrictLive = (v) => { STRICT_LIVE = !!v; emitUpdate(); return STRICT_LIVE; };
  g.RLCCams.setSeedValidate = (v) => { SEED_VALIDATE = !!v; emitUpdate(); return SEED_VALIDATE; };
  g.RLCCams.clearCache = () => {
    try { localStorage.removeItem(CACHE_KEY_V238); } catch (_) {}
    try { localStorage.removeItem(CACHE_NEWS_KEY); } catch (_) {}
    try { if (!NS) localStorage.removeItem(CACHE_KEY_LEGACY); } catch (_) {}
    emitUpdate();
  };

  // News API (opcional)
  g.RLCCams.getNewsList = () => Array.isArray(g.CAM_NEWS_LIST) ? g.CAM_NEWS_LIST : [];
  g.RLCCams.getNewsCatalogList = () => Array.isArray(OUT_NEWS_CATALOG) ? OUT_NEWS_CATALOG : [];
  g.RLCCams.setNewsEnabled = (v) => { NEWS_ENABLED = !!v; emitUpdate(); return NEWS_ENABLED; };
  g.RLCCams.setNewsMix = (v) => { NEWS_MIX_IN_MAIN = !!v; emitUpdate(); return NEWS_MIX_IN_MAIN; };
  g.RLCCams.setNewsInCatalog = (v) => { NEWS_IN_CATALOG = !!v; emitUpdate(); return NEWS_IN_CATALOG; };
  g.RLCCams.setNewsTarget = (n) => { NEWS_TARGET = Math.max(10, Math.min(300, Math.trunc(n || 60))); emitUpdate(); return NEWS_TARGET; };

  // compat extra
  g.RLC_CATALOG_PAGE_SIZE = CATALOG_PAGE_SIZE;

  // ─────────────────────────────────────────────────────────────
  // NETWORK helpers (timeouts + proxies)
  // ─────────────────────────────────────────────────────────────
  let __reqUsed = 0;
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

  const PROXIES_TEXT = [
    (u) => normalizeUrl(u),
    (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(normalizeUrl(u)),
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
    try { return JSON.parse(tx); } catch (_) {}
    const a = Math.min(
      tx.indexOf("{") >= 0 ? tx.indexOf("{") : tx.length,
      tx.indexOf("[") >= 0 ? tx.indexOf("[") : tx.length
    );
    const b = Math.max(tx.lastIndexOf("}"), tx.lastIndexOf("]"));
    if (a >= 0 && b > a) {
      const cut = tx.slice(a, b + 1);
      try { return JSON.parse(cut); } catch (_) {}
    }
    throw new Error("fetchJsonSmart: JSON parse failed");
  }

  // ─────────────────────────────────────────────────────────────
  // STRICT LIVE / EMBED checks (YouTube)
  // ─────────────────────────────────────────────────────────────
  function textLikelyBlockedEmbed(t) {
    const s = (t || "").toLowerCase();
    if (s.includes("playback on other websites has been disabled")) return true;
    if (s.includes("video unavailable")) return true;
    if (s.includes("this video is unavailable")) return true;
    if (s.includes("has been removed")) return true;
    if (s.includes("sign in to confirm your age")) return true;
    return false;
  }

  function textLooksNotLive(t) {
    const s = (t || "").toLowerCase();
    if (s.includes("\"isupcoming\":true") || s.includes("\"isupcoming\": true")) return true;
    if (s.includes("upcoming") || s.includes("scheduled")) return true;
    if (s.includes("premiere")) return true;
    return false;
  }

  function textStrongLiveSignal(htmlLower) {
    const h = htmlLower || "";
    // señales típicas en páginas live
    if (h.includes("\"islivenow\":true") || h.includes("\"islivenow\": true")) return true;
    if (h.includes("\"islive\":true") || h.includes("\"islive\": true")) return true;
    if (h.includes("\"islivecontent\":true") || h.includes("\"islivecontent\": true")) return true;
    if (h.includes("\"hlsmanifesturl\"") || h.includes("hlsmanifesturl")) return true;
    if (h.includes("livestreamability")) return true;
    // “isLiveDvrEnabled” aparece a menudo en directos
    if (h.includes("\"islivedvrenabled\":true") || h.includes("\"islivedvrenabled\": true")) return true;
    return false;
  }

  async function isReallyLiveYouTubeStrict(videoId, signal) {
    if (!BEST_EFFORT_LIVE_CHECK) return true;
    if (!validateBudgetOk()) return !STRICT_LIVE; // si no hay presupuesto, en strict -> false, en no-strict -> true
    __validateUsed++;

    try {
      const html = await fetchTextSmart(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, 12000, signal);
      if (!html) return !STRICT_LIVE;

      const h = html.toLowerCase();
      if (textLooksNotLive(h)) return false;

      // Si STRICT, exige señal fuerte
      const strong = textStrongLiveSignal(h);
      return STRICT_LIVE ? strong : true;
    } catch (_) {
      return !STRICT_LIVE;
    }
  }

  async function isEmbeddableYouTube(videoId, signal) {
    if (!VALIDATE_EMBED) return true;
    if (!validateBudgetOk()) return !STRICT_LIVE;
    __validateUsed++;

    // 1) oEmbed
    try {
      const o = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent("https://www.youtube.com/watch?v=" + videoId)}`;
      const r = await fetchWithTimeout(o, { method: "GET", cache: "no-store", signal }, 8000);
      if (r && r.ok) {
        // ok
      } else if (r && (r.status === 401 || r.status === 403 || r.status === 404)) {
        return false;
      } else if (STRICT_LIVE) {
        // en strict, si no es ok y no es una de las “ok”, lo consideramos fallo
        return false;
      }
    } catch (e) {
      if (STRICT_LIVE) return false;
    }

    // 2) embed HTML (best-effort)
    try {
      const html = await fetchTextSmart(`https://www.youtube.com/embed/${videoId}`, 10000, signal);
      if (html && textLikelyBlockedEmbed(html)) return false;
    } catch (_) {
      if (STRICT_LIVE) return false;
    }

    // 3) live strict
    const liveOk = await isReallyLiveYouTubeStrict(videoId, signal);
    if (!liveOk) return false;

    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // Invidious instances + search
  // ─────────────────────────────────────────────────────────────
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
          const u = uri.startsWith("http://") ? "https://" + uri.slice(7) : uri;
          out.push(u.replace(/\/+$/, ""));
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

  async function invidiousSearch(instance, q, page, region, signal) {
    if (!budgetOk()) return [];
    const base = instance.replace(/\/+$/, "");
    const url =
      `${base}/api/v1/search` +
      `?q=${encodeURIComponent(q)}` +
      `&page=${encodeURIComponent(String(page))}` +
      `&type=video` +
      `&features=live` +
      `&sort=relevance` +
      `&region=${encodeURIComponent(region || "US")}`;
    const res = await fetchJsonSmart(url, 13000, signal);
    return Array.isArray(res) ? res : [];
  }

  function capTasks(tasks) {
    const max = Math.max(250, Math.min(30000, Math.floor(DISCOVERY_REQUEST_BUDGET * 3)));
    if (tasks.length <= max) return tasks;
    shuffleInPlace(tasks);
    return tasks.slice(0, max);
  }

  function toAutoCam(entry, forcedMeta) {
    const vid = safeStr(entry && entry.videoId);
    if (!isValidYouTubeId(vid)) return null;

    const title = safeStr(entry.title) || "Live Cam";
    const author = safeStr(entry.author);

    if (!camTitleOk(title, author)) return null;

    const meta = forcedMeta || null;
    const id = meta && meta.id ? meta.id : `yt_${vid}`;

    return {
      id,
      title: meta && meta.label ? `${meta.label} — ${title}` : title,
      place: meta && meta.place ? meta.place : "",
      source: author ? `${author} (YouTube Live)` : "YouTube Live",
      kind: "youtube",
      youtubeId: vid,
      originUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(vid)}`,
      thumb: youtubeThumb(vid),
      tags: meta && Array.isArray(meta.tags) ? meta.tags.slice(0, 10).concat(["auto","live"]) : ["auto","live","webcam"],
      isAlt: false
    };
  }

  function toAutoNews(entry) {
    const vid = safeStr(entry && entry.videoId);
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
  // 0) Carga cache (si hay buena, úsala ya)
  // ─────────────────────────────────────────────────────────────
  const cached = loadCacheAny([CACHE_KEY_V238, CACHE_KEY_LEGACY], (c) => camTitleOk(c.title, c.source));
  if (cached && cached.length >= Math.min(180, TARGET_CAMS)) {
    for (let i = 0; i < cached.length; i++) {
      const c = cached[i];
      if (!c || typeof c !== "object") continue;
      c.isAlt = false;
      pushCam(c);
      if (OUT.length >= TARGET_CAMS) break;
    }
  }

  // Seeds NEWS (HLS estables + youtube se resuelve por discovery si activas)
  if (NEWS_ENABLED) {
    // France 24 HLS (suele ser estable)
    pushNews({ id:"news_france24_en_hls", title:"FRANCE 24 English — LIVE (HLS)", place:"Global", source:"France 24", kind:"hls", url:"https://static.france24.com/live/F24_EN_HI_HLS/live_web.m3u8", originUrl:"https://static.france24.com/live/F24_EN_HI_HLS/live_web.m3u8", tags:["news","global","en","live","hls"], isAlt:false });
    pushNews({ id:"news_france24_es_hls", title:"FRANCE 24 Español — LIVE (HLS)", place:"Global", source:"France 24", kind:"hls", url:"https://static.france24.com/live/F24_ES_HI_HLS/live_web.m3u8", originUrl:"https://static.france24.com/live/F24_ES_HI_HLS/live_web.m3u8", tags:["news","global","es","live","hls"], isAlt:false });
    pushNews({ id:"news_france24_fr_hls", title:"FRANCE 24 Français — LIVE (HLS)", place:"Global", source:"France 24", kind:"hls", url:"https://static.france24.com/live/F24_FR_HI_HLS/live_web.m3u8", originUrl:"https://static.france24.com/live/F24_FR_HI_HLS/live_web.m3u8", tags:["news","global","fr","live","hls"], isAlt:false });
    pushNews({ id:"news_france24_ar_hls", title:"FRANCE 24 العربية — LIVE (HLS)", place:"Global", source:"France 24", kind:"hls", url:"https://static.france24.com/live/F24_AR_HI_HLS/live_web.m3u8", originUrl:"https://static.france24.com/live/F24_AR_HI_HLS/live_web.m3u8", tags:["news","global","ar","live","hls"], isAlt:false });

    // Cache news si existe
    const cachedNews = loadCacheAny([CACHE_NEWS_KEY], (c) => newsTitleOk(c.title, c.source));
    if (cachedNews && cachedNews.length >= Math.min(12, NEWS_TARGET)) {
      for (let i = 0; i < cachedNews.length; i++) {
        const c = cachedNews[i];
        if (!c || typeof c !== "object") continue;
        c.isAlt = false;
        pushNews(c);
        if (OUT_NEWS_CATALOG.length >= NEWS_TARGET) break;
      }
    }
  }

  // Export rápido
  g.CAM_LIST = OUT;
  g.CAM_CATALOG_LIST = OUT_CATALOG;
  g.CAM_NEWS_LIST = OUT_NEWS;
  emitUpdate();

  // ─────────────────────────────────────────────────────────────
  // Curated Seeds resolver + Seed validation purge
  // ─────────────────────────────────────────────────────────────
  async function runCuratedSeeds(instances, signal) {
    if (!budgetOk()) return;
    // Si ya tenemos algo, igual intentamos meter iconos si faltan
    const need = Math.max(0, Math.min(CURATED_SEEDS.length, 18) - OUT_CATALOG.length);
    if (need <= 0) return;

    const tasks = [];
    let instCursor = 0;

    for (let i = 0; i < CURATED_SEEDS.length; i++) {
      const meta = CURATED_SEEDS[i];
      // una sola página suele bastar, pero damos 2 por si acaso
      for (let p = 1; p <= 2; p++) {
        const inst = instances[instCursor++ % instances.length];
        const region = DISCOVERY_REGIONS[(i + p) % DISCOVERY_REGIONS.length];
        tasks.push({ meta, p, inst, region });
      }
    }

    const capped = capTasks(tasks);
    let cursor = 0;

    async function worker() {
      while (cursor < capped.length && budgetOk()) {
        const t = capped[cursor++];
        const meta = t.meta;
        if (!meta || !meta.query) continue;

        // si ya existe el seed id (o se llenó), saltar
        if (seenIds.has(meta.id)) continue;

        try {
          const res = await invidiousSearch(t.inst, meta.query, t.p, t.region, signal);
          for (let i = 0; i < res.length; i++) {
            const r = res[i];
            if (!r || r.type !== "video") continue;
            if (r.liveNow !== true) continue;

            const cam = toAutoCam(r, meta);
            if (!cam) continue;
            if (seenIds.has(cam.id) || seenYouTube.has(cam.youtubeId)) continue;

            const ok = await isEmbeddableYouTube(cam.youtubeId, signal);
            if (!ok) continue;

            pushCam(cam);
            emitUpdate();
            break;
          }
        } catch (_) {}
        await sleep(60);
      }
    }

    const w = [];
    const n = Math.max(1, Math.min(3, SEED_VALIDATE_CONC));
    for (let i = 0; i < n; i++) w.push(worker());
    await Promise.all(w);
  }

  async function validateSeedsAndPurge(signal) {
    if (!SEED_VALIDATE) return;

    const list = OUT_CATALOG.slice(0, SEED_VALIDATE_MAX);
    if (!list.length) return;

    const checks = [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c || c.kind !== "youtube") continue;
      checks.push(c);
    }
    if (!checks.length) return;

    let idx = 0;
    const badIds = new Set();

    async function worker() {
      while (idx < checks.length && validateBudgetOk()) {
        const c = checks[idx++];
        if (!c || !isValidYouTubeId(c.youtubeId)) continue;

        const ok = await isEmbeddableYouTube(c.youtubeId, signal);
        if (!ok) badIds.add(c.id);

        await sleep(45);
      }
    }

    const ws = [];
    const n = Math.max(1, Math.min(SEED_VALIDATE_CONC, 6));
    for (let i = 0; i < n; i++) ws.push(worker());
    await Promise.all(ws);

    if (!badIds.size) return;

    // reconstruir arrays sin los bad
    const keep = (arr) => arr.filter(c => c && c.id && !badIds.has(c.id));
    const newOutCatalog = keep(OUT_CATALOG);
    const newOut = keep(OUT);

    // reset dedupe sets y re-aplicar
    seenIds.clear(); seenYouTube.clear(); seenHlsUrl.clear();
    OUT.length = 0; OUT_CATALOG.length = 0;

    for (let i = 0; i < newOutCatalog.length; i++) pushCam(newOutCatalog[i]); // re-push añade a OUT y OUT_CATALOG
    // reinsertar extras que no estaban en catalog (p.ej. mixed/news) sin romper dedupe
    for (let i = 0; i < newOut.length; i++) {
      const c = newOut[i];
      if (!c || !c.id) continue;
      if (seenIds.has(c.id)) continue;
      pushCam(c);
    }

    g.CAM_LIST = OUT;
    g.CAM_CATALOG_LIST = OUT_CATALOG;
    emitUpdate();
  }

  // ─────────────────────────────────────────────────────────────
  // DISCOVERY masivo
  // ─────────────────────────────────────────────────────────────
  async function runDiscoveryWebcams(instances, signal) {
    if (!AUTO_DISCOVERY) return;
    if (OUT_CATALOG.length >= TARGET_CAMS) return;

    const candidates = [];
    const addedNow = new Set();

    const queries = buildDiscoveryQueries(TARGET_CAMS);
    const tasks = [];
    let instCursor = 0;

    for (let qi = 0; qi < queries.length; qi++) {
      const q = queries[qi];
      for (let p = 1; p <= DISCOVERY_MAX_PAGES_PER_QUERY; p++) {
        const inst = instances[instCursor++ % instances.length];
        const region = DISCOVERY_REGIONS[(qi + p) % DISCOVERY_REGIONS.length];
        tasks.push({ q, p, inst, region });
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
          const key = t.q;
          foundForQuery[key] = foundForQuery[key] || 0;
          if (foundForQuery[key] >= DISCOVERY_MAX_PER_QUERY) { await sleep(20); continue; }

          const results = await invidiousSearch(t.inst, t.q, t.p, t.region, signal);

          for (let i = 0; i < results.length; i++) {
            if (!budgetOk()) break;
            const r = results[i];
            if (!r || r.type !== "video") continue;
            if (r.liveNow !== true) continue;

            const cam = toAutoCam(r, null);
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
          await sleep(70);
        }
      }
    }

    const workers = [];
    const n = Math.max(1, Math.min(DISCOVERY_CONCURRENCY, 10));
    for (let i = 0; i < n; i++) workers.push(worker());
    await Promise.all(workers);

    for (let i = 0; i < candidates.length && OUT_CATALOG.length < TARGET_CAMS; i++) {
      const c = candidates[i];
      if (!c) continue;
      pushCam(c);
    }
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
        tasks.push({ q, p, inst, region });
      }
    }

    const cappedTasks = capTasks(tasks);
    let cursor = 0;
    const foundForQuery = Object.create(null);

    async function worker() {
      while (cursor < cappedTasks.length && (OUT_NEWS_CATALOG.length + candidates.length) < NEWS_TARGET) {
        if (!budgetOk()) break;
        const t = cappedTasks[cursor++];

        try {
          const key = t.q;
          foundForQuery[key] = foundForQuery[key] || 0;
          if (foundForQuery[key] >= Math.max(60, Math.min(600, DISCOVERY_MAX_PER_QUERY))) { await sleep(20); continue; }

          const results = await invidiousSearch(t.inst, t.q, t.p, t.region, signal);

          for (let i = 0; i < results.length; i++) {
            if (!budgetOk()) break;
            const r = results[i];
            if (!r || r.type !== "video") continue;
            if (r.liveNow !== true) continue;

            const cam = toAutoNews(r);
            if (!cam) continue;

            const vid = cam.youtubeId;
            if (NEWS_SEEN_YT.has(vid) || addedNow.has(vid)) continue;
            addedNow.add(vid);

            const ok = await isEmbeddableYouTube(vid, signal);
            if (!ok) continue;

            candidates.push(cam);
            foundForQuery[key]++;

            if ((OUT_NEWS_CATALOG.length + candidates.length) >= NEWS_TARGET) break;
          }
        } catch (_) {
          // silencio
        } finally {
          await sleep(80);
        }
      }
    }

    const workers = [];
    const n = Math.max(1, Math.min(3, DISCOVERY_CONCURRENCY));
    for (let i = 0; i < n; i++) workers.push(worker());
    await Promise.all(workers);

    for (let i = 0; i < candidates.length && OUT_NEWS_CATALOG.length < NEWS_TARGET; i++) {
      const c = candidates[i];
      if (!c) continue;
      pushNews(c);
    }
  }

  function applyNewsMixing() {
    g.CAM_NEWS_LIST = OUT_NEWS;
    if (!NEWS_ENABLED) return;

    function canAddToMain(n) {
      const kind = safeStr(n && n.kind).toLowerCase();
      if (kind === "youtube") {
        const yid = safeStr(n.youtubeId);
        if (!isValidYouTubeId(yid)) return false;
        if (seenYouTube.has(yid)) return false;
        return true;
      }
      if (kind === "hls") {
        const url = safeStr(n.url) || safeStr(n.originUrl);
        if (!url || !looksLikeM3U8(url)) return false;
        const canon = canonicalUrl(url);
        if (seenHlsUrl.has(canon)) return false;
        return true;
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
        if (!n) continue;
        if (!canAddToMain(n)) continue;

        const cam = buildMainCamFromNews(n, "mixed");
        if (!cam) continue;

        if (NEWS_IN_CATALOG) {
          pushCam(cam);
        } else {
          // meter en main sin catálogo
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
        if (!n) continue;
        if (!canAddToMain(n)) continue;

        const cam = buildMainCamFromNews(n, "news");
        if (!cam) continue;

        pushCam(cam);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // MAIN: discoverMore
  // ─────────────────────────────────────────────────────────────
  async function discoverMore() {
    const signal = MOD._abort.signal;

    try {
      // Si no hay nada y no hay cache, seguimos igual.
      const instancesRaw = await getInvidiousInstances(signal);
      const instances = shuffleInPlace(instancesRaw.slice(0, Math.max(5, DISCOVERY_MAX_INSTANCES)));

      // Curated seeds por búsqueda (iconos)
      await runCuratedSeeds(instances, signal);

      // Purga seeds no-live/no-embed (STRICT)
      await validateSeedsAndPurge(signal);

      // Discovery masivo
      if (AUTO_DISCOVERY && OUT_CATALOG.length < TARGET_CAMS) {
        await runDiscoveryWebcams(instances, signal);
      }

      // News discovery
      if (NEWS_ENABLED && OUT_NEWS_CATALOG.length < NEWS_TARGET) {
        await runDiscoveryNews(instances, signal);
      }

      applyNewsMixing();

      // Failsafe ALT (si faltan para target)
      if (HARD_FAILSAFE_ALT_FILL && OUT.length > 0 && OUT.length < TARGET_CAMS) {
        const baseLen = OUT.length;
        let k = 0;
        while (OUT.length < TARGET_CAMS && k < 90000) {
          const src = OUT[k % baseLen];
          const altN = Math.floor(k / baseLen) + 1;
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

      saveCache(CACHE_KEY_V238, OUT_CATALOG, TARGET_CAMS);
      if (NEWS_ENABLED) saveCache(CACHE_NEWS_KEY, OUT_NEWS_CATALOG, NEWS_TARGET);

      emitUpdate();
      if (__resolveReady) __resolveReady(g.CAM_LIST);
    } catch (_) {
      try { saveCache(CACHE_KEY_V238, OUT_CATALOG, TARGET_CAMS); } catch (_) {}
      try { if (NEWS_ENABLED) saveCache(CACHE_NEWS_KEY, OUT_NEWS_CATALOG, NEWS_TARGET); } catch (_) {}
      try { emitUpdate(); } catch (_) {}
      try { if (__resolveReady) __resolveReady(g.CAM_LIST); } catch (_) {}
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Hook opcional (Admin): escucha BC para refresh/clear
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
    if (t === "CAMS_SET_STRICT") { g.RLCCams && g.RLCCams.setStrictLive && g.RLCCams.setStrictLive(!!msg.value); return; }
    if (t === "CAMS_SET_SEED_VALIDATE") { g.RLCCams && g.RLCCams.setSeedValidate && g.RLCCams.setSeedValidate(!!msg.value); return; }

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
    }
  }

  try {
    if ("BroadcastChannel" in g) {
      const base = "rlc_bus_v1";
      const names = [base];
      if (ROOM_KEY) names.push(`${base}:${ROOM_KEY}`);

      try { (MOD._bcs || []).forEach((c) => { try { c.close(); } catch (_) {} }); } catch (_) {}
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

  // Start async (no bloquea)
  try {
    const timer = setTimeout(() => { discoverMore(); }, 0);
    MOD._timers.push(timer);
  } catch (_) {
    discoverMore();
  }
})();
