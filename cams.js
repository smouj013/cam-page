/* cams.js — Lista de cámaras (VIDEO ONLY + AUTO-DISCOVERY + CATALOG 4-UP + OPTIONAL NEWS) v2.3.8
   ✅ Integrado para RLC v2.3.8 (Player + Control/Admin)
   ✅ Mantiene tus cams existentes (mismos ids) como "seed"
   ✅ VIDEO ONLY: exporta SOLO "youtube" y "hls" (descarta "image")
   ✅ Sanitizador (no rompe compat):
      - evita ids duplicados (se queda con la primera => tus existentes ganan)
      - completa originUrl si falta (YouTube/HLS)
      - infiere youtubeId desde originUrl si falta (watch?v= / live/ / embed/)
      - descarta entradas rotas (sin id/kind o sin youtubeId/url)
      - añade thumb para YouTube (para catálogo)
      - FILTRO EXTRA (catalog/discovery): elimina “walk/tour/recorded/timelapse/replay/loops” (solo webcams LIVE)

   ✅ OBJETIVO: +500 cams reales por defecto
      - DEFAULT: 650 (override: ?camsTarget=500/800/1200...)
      - Cache (si existe) se usa INMEDIATAMENTE
      - Auto-discovery: busca LIVE webcams en Invidious (/api/v1/search?features=live)
      - Filtra “no-webcam” (música/lofi/radio/juegos/noticias/walk tours/recorded)
      - Validación embed (best-effort; no invalida por fallos de CORS)
      - Se queda solo con las que “parecen” webcams live (cuando se puede validar)

   ✅ Failsafe (si tu player necesita SÍ o SÍ llenar el objetivo):
      - si no llega a TARGET tras discovery, rellena con ALT duplicando válidas
        (NO inventa fuentes nuevas). Desactiva con HARD_FAILSAFE_ALT_FILL=false (?camsAltFill=0)

   🧩 CATÁLOGO (4 a la vez):
      - window.CAM_CATALOG_LIST (sin alts)
      - window.RLCCams.getCatalogPage(pageIndex) => {pageIndex,pageSize,totalPages,totalItems,items}
      - window.RLCCams.getCatalogFeatured(count) => items
      - window.RLCCams.onUpdate(cb) => unsubscribe
      - window.RLCCams.refresh()/clearCache()/setTarget()/setAutoDiscovery()

   📰 NOTICIEROS ONLINE (OPCIONAL, OFF por defecto):
      - Activa: ?camsNews=1
      - Mezcla en CAM_LIST: ?camsNewsMix=1
      - Mete en catálogo: ?camsNewsCatalog=1
      - Objetivo news: ?camsNewsTarget=60
      - Exporta:
         - window.CAM_NEWS_LIST (lista news limpia, sin alts)
         - window.RLCCams.getNewsList()
         - window.RLCCams.setNewsEnabled(v) / setNewsMix(v) / setNewsInCatalog(v)
      - Discovery news usa queries propias SOLO cuando camsNews=1

   📣 Evento:
      - window.dispatchEvent("rlc_cam_list_updated") con {detail:{list,catalog,news,newsCatalog,...}}

   kind:
   - "youtube"  -> usa youtubeId (11 chars)
   - "hls"      -> usa url (.m3u8) (opcional, requiere CORS OK)

   Extra opcional:
   - maxSeconds -> si tu player lo soporta, limita cuánto tiempo se muestra esta cam.
   - tags       -> solo informativo
   - disabled   -> si true, se ignora

   Nota compat Admin (2.3.8):
   - Mantiene: CAM_LIST / CAM_LIST_READY / CAM_CATALOG_LIST / RLCCams API / rlc_cam_list_updated
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  // ─────────────────────────────────────────────────────────────
  // Guard anti doble carga + destroy() (update-safe)
  // ─────────────────────────────────────────────────────────────
  const LOAD_GUARD = "__RLC_CAMSJS_LOADED_V238_VIDEOONLY_AUTODISCOVERY_CATALOG4_NEWSOPT";
  try {
    if (g[LOAD_GUARD] && typeof g[LOAD_GUARD].destroy === "function") {
      g[LOAD_GUARD].destroy();
    }
  } catch (_) {}
  if (!g[LOAD_GUARD]) g[LOAD_GUARD] = {};
  const MOD = g[LOAD_GUARD];

  MOD._timers = MOD._timers || [];
  MOD._abort = MOD._abort || new AbortController();
  MOD._bc = null;

  MOD.destroy = function destroy() {
    try { MOD._timers.forEach((t) => clearTimeout(t)); } catch (_) {}
    MOD._timers = [];
    try { MOD._abort.abort(); } catch (_) {}
    MOD._abort = new AbortController();
    try { if (MOD._bc) MOD._bc.close(); } catch (_) {}
    MOD._bc = null;
  };

  // ─────────────────────────────────────────────────────────────
  // CONFIG (v2.3.8)
  // ─────────────────────────────────────────────────────────────
  const VERSION = "2.3.8";

  function getParam(name) {
    try {
      const u = new URL(location.href);
      return u.searchParams.get(name);
    } catch (_) {
      return null;
    }
  }
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

  // Objetivo por defecto: >500
  const TARGET_CAMS_DEFAULT = 650;
  let TARGET_CAMS = Math.max(50, Math.min(2500, parseIntSafe(getParam("camsTarget"), TARGET_CAMS_DEFAULT)));

  // Catálogo
  const CATALOG_PAGE_SIZE = 4;

  // Namespace (rooms/keys)
  const ROOM_KEY = (getParam("key") || getParam("k") || "").trim();
  const NS = ROOM_KEY ? `:${ROOM_KEY}` : "";

  // Cache: mantenemos legacy y añadimos namespaced
  const CACHE_KEY_LEGACY = "rlc_cam_cache_v1_500";            // compat
  const CACHE_KEY_V238 = `rlc_bus_v1:cams_cache_v1${NS}`;     // nuevo
  const CACHE_NEWS_KEY_V238 = `rlc_bus_v1:news_cache_v1${NS}`;// news
  const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12h

  // Auto discovery webcams ON/OFF (override: ?camsDiscovery=0/1)
  let AUTO_DISCOVERY = parseBool(getParam("camsDiscovery"), true);

  // Validación embed (si da problemas en tu hosting: ?camsValidate=0)
  let VALIDATE_EMBED = parseBool(getParam("camsValidate"), true);

  // Presupuesto de validaciones “caras” (embed/oembed/live check)
  const VALIDATE_BUDGET = Math.max(0, Math.min(2000, parseIntSafe(getParam("camsValidateBudget"), 220)));
  let __validateUsed = 0;

  // “Solo lives” (best-effort)
  let BEST_EFFORT_LIVE_CHECK = parseBool(getParam("camsLiveCheck"), true);

  // Concurrencia
  const DISCOVERY_MAX_PAGES_PER_QUERY = Math.max(1, Math.min(16, parseIntSafe(getParam("camsPages"), 6)));
  const DISCOVERY_MAX_PER_QUERY = Math.max(50, Math.min(900, parseIntSafe(getParam("camsMaxPerQuery"), 260)));
  const DISCOVERY_CONCURRENCY = Math.max(1, Math.min(8, parseIntSafe(getParam("camsConc"), 4)));
  const DISCOVERY_MAX_INSTANCES = Math.max(3, Math.min(18, parseIntSafe(getParam("camsInstances"), 12)));

  // Presupuesto global de requests (corta infinito si algo va mal)
  const DISCOVERY_REQUEST_BUDGET = Math.max(160, Math.min(2600, parseIntSafe(getParam("camsBudget"), 780)));

  // Failsafe: relleno ALT si el player exige llenar objetivo sí o sí
  let HARD_FAILSAFE_ALT_FILL = parseBool(getParam("camsAltFill"), true);

  // News (OPCIONAL)
  let NEWS_ENABLED = parseBool(getParam("camsNews"), false);
  let NEWS_MIX_IN_MAIN = parseBool(getParam("camsNewsMix"), false);
  let NEWS_IN_CATALOG = parseBool(getParam("camsNewsCatalog"), false);
  let NEWS_DISCOVERY = parseBool(getParam("camsNewsDiscovery"), true);
  let NEWS_TARGET = Math.max(10, Math.min(300, parseIntSafe(getParam("camsNewsTarget"), 60)));

  // Query pack (webcams)
  const DISCOVERY_QUERIES = [
    // --- Prioridad USA (White House / DC) ---
    "white house live cam",
    "white house webcam live",
    "washington dc live cam",
    "washington dc webcam live",
    "pennsylvania avenue live cam",
    // --- Prioridad Venezuela ---
    "venezuela live webcam",
    "venezuela webcam en vivo",
    "caracas live cam",
    "caracas webcam en vivo",
    "isla margarita live webcam",
    "margarita island webcam en vivo",
    "porlamar live webcam",
    "playa el yaque live webcam",
    // --- Genéricas multi-idioma ---
    "live webcam",
    "webcam live",
    "webcam en vivo",
    "cámara en vivo",
    "camara en vivo",
    "caméra en direct",
    "kamera na żywo",
    "telecamera live",
    "webkamera canlı",
    "kamera live",
    "live cam",
    "cctv live cam",
    // --- Categorías típicas webcams ---
    "traffic cam live",
    "traffic camera live",
    "airport webcam live",
    "harbor webcam live",
    "harbour webcam live",
    "port webcam live",
    "marina live cam",
    "beach webcam live",
    "pier webcam live",
    "downtown live cam",
    "street cam live",
    "railcam live",
    "train station webcam live",
    "ski webcam live",
    "mountain webcam live",
    "volcano webcam live",
    "crater cam live",
    // --- Marcas / hubs ---
    "earthcam live webcam",
    "skylinewebcams live webcam",
    "ozolio live webcam",
    "webcams live 24/7",
    "live webcam 24/7"
  ];

  // Queries NEWS (solo si camsNews=1)
  const NEWS_QUERIES = [
    "live news",
    "breaking news live",
    "world news live",
    "noticias en directo",
    "noticias en vivo",
    "canal de noticias en vivo",
    "directo noticias",
    "última hora en directo",
    "cnn live",
    "bbc news live",
    "al jazeera live",
    "euronews live",
    "france 24 live",
    "dw news live",
    "sky news live",
    "teleSUR en vivo",
    "noticiero en vivo"
  ];

  // ─────────────────────────────────────────────────────────────
  // Filtro: permitidos vs bloqueados (WEBCAMS)
  // ─────────────────────────────────────────────────────────────
  const BLOCK_WORDS = [
    // Música / radio / etc
    "lofi","lo-fi","radio","music","música","mix","playlist","beats",
    "podcast","audiobook","audiolibro",
    // Gaming / religión / crypto
    "gameplay","gaming","walkthrough","speedrun",
    "sermon","church","iglesia","prayer","oración",
    "crypto","trading","forex",
    // walk / grabaciones / loops / tours
    "walk","walking","walks","walking tour","city walk","virtual walk","4k walk",
    "tour","travel","travelling","viaje","paseo","recorrido",
    "recorded","replay","rerun","repeat","loop","timelapse","time-lapse","time lapse",
    "ambience","ambient","study","sleep","relax","asmr",
    "dashcam","driving","drive","ride","train ride","bus ride","metro ride",
    "vlog","vlogger","behind the scenes",
    // NOTICIAS (bloqueadas en modo webcam)
    "news","noticias","cnn","bbc","aljazeera","fox","euronews","france 24","dw news","sky news"
  ];

  const ALLOW_HINTS = [
    "webcam","web cam","live cam","livecam","camera live","cctv","traffic cam","traffic camera",
    "airport","harbor","harbour","port","pier","beach","coast","marina",
    "downtown","street cam","street camera","square","plaza",
    "railcam","rail cam","train cam","station cam","train station",
    "ski cam","snow cam","mountain cam","volcano cam","crater cam",
    "earthcam","skylinewebcams","ozolio","webcams","ipcamlive","ip cam",
    "cámara","camara","en directo","en vivo","directo",
    "telecamera","kamera","kamera na żywo","webkamera","caméra"
  ];

  const KNOWN_WEBCAM_BRANDS = [
    "earthcam","skylinewebcams","ozolio","railcam","webcams",
    "earthtv","earth tv","ip cam","ipcamlive","ipcam"
  ];

  // News filter (solo si activas camsNews=1)
  const NEWS_BLOCK_WORDS = [
    "lofi","lo-fi","music","música","beats","playlist","mix",
    "gaming","gameplay","walkthrough","speedrun",
    "walk","walking","walking tour","tour","travel","viaje",
    "recorded","replay","rerun","loop","timelapse","time lapse","time-lapse",
    "asmr","study","sleep","relax",
    "podcast","audiobook","audiolibro"
  ];
  const NEWS_ALLOW_HINTS = [
    "news","noticias","breaking","última hora","live news","en directo","en vivo","directo",
    "channel","canal","noticiero","world news","24/7"
  ];

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────
  const ALLOWED_KINDS = new Set(["youtube", "hls"]);
  const safeStr = (v) => (typeof v === "string") ? v.trim() : "";

  function toId(v, i) {
    const s = safeStr(v);
    return s ? s : `cam_${String(i).padStart(4, "0")}`;
  }

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

  function includesAny(hay, list) {
    for (let i = 0; i < list.length; i++) {
      if (hay.includes(list[i])) return true;
    }
    return false;
  }

  function camTitleOk(title, author) {
    const t = safeStr(title).toLowerCase();
    const a = safeStr(author).toLowerCase();
    const full = (t + " " + a).trim();
    if (!full) return false;

    for (let i = 0; i < BLOCK_WORDS.length; i++) {
      if (full.includes(BLOCK_WORDS[i])) return false;
    }

    if (includesAny(full, KNOWN_WEBCAM_BRANDS)) return true;

    if (includesAny(full, ALLOW_HINTS)) {
      const hasCamWord =
        full.includes("webcam") || full.includes("cam") || full.includes("cctv") ||
        full.includes("cámara") || full.includes("camara") || full.includes("telecamera") ||
        full.includes("kamera") || full.includes("caméra");
      if (hasCamWord) return true;
    }

    return false;
  }

  function newsTitleOk(title, author) {
    const t = safeStr(title).toLowerCase();
    const a = safeStr(author).toLowerCase();
    const full = (t + " " + a).trim();
    if (!full) return false;

    for (let i = 0; i < NEWS_BLOCK_WORDS.length; i++) {
      if (full.includes(NEWS_BLOCK_WORDS[i])) return false;
    }
    return includesAny(full, NEWS_ALLOW_HINTS);
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function clampInt(v, a, b) {
    v = (v | 0);
    return Math.max(a, Math.min(b, v));
  }

  function shuffleInPlace(arr) {
    if (!Array.isArray(arr) || arr.length < 2) return arr;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  // ─────────────────────────────────────────────────────────────
  // 1) LISTA BRUTA (tus existentes + ampliación)
  //    Nota: aunque existan entradas "image" aquí, NO se exportarán (VIDEO ONLY).
  // ─────────────────────────────────────────────────────────────
  const RAW = [
    // ──────────────── AMÉRICA (tus actuales) ────────────────
    {
      id: "nyc_times_square",
      title: "Times Square (NYC) — Live Cam",
      place: "Times Square, New York, USA",
      source: "EarthCam (YouTube)",
      kind: "youtube",
      youtubeId: "rnXIjl_Rzy4",
      originUrl: "https://www.youtube.com/watch?v=rnXIjl_Rzy4",
      tags: ["city","usa","nyc"]
    },
    {
      id: "niagara_falls",
      title: "Niagara Falls — Live Cam",
      place: "Niagara Falls, Canadá",
      source: "EarthCam (YouTube)",
      kind: "youtube",
      youtubeId: "gIv9J38Dax8",
      originUrl: "https://www.youtube.com/watch?v=gIv9J38Dax8",
      tags: ["nature","waterfall","canada"]
    },
    {
      id: "waikiki_sheraton",
      title: "Waikiki Beach — Live Cam",
      place: "Waikiki, Honolulu (Hawái), USA",
      source: "Ozolio / Sheraton (YouTube)",
      kind: "youtube",
      youtubeId: "06v5pzump4w",
      originUrl: "https://www.youtube.com/watch?v=06v5pzump4w",
      tags: ["beach","usa","hawaii"]
    },
    {
      id: "rio_copacabana",
      title: "Copacabana — Live Cam",
      place: "Rio de Janeiro, Brasil",
      source: "SkylineWebcams (YouTube)",
      kind: "youtube",
      youtubeId: "YRZMwOqHIEE",
      originUrl: "https://www.youtube.com/watch?v=YRZMwOqHIEE",
      tags: ["beach","brazil"]
    },

    // ✅ USA — CASA BLANCA
    {
      id: "us_white_house_earthtv",
      title: "White House — Live Cam",
      place: "Washington, D.C., USA",
      source: "earthTV (YouTube Live)",
      kind: "youtube",
      youtubeId: "XaI4meBJr20",
      originUrl: "https://www.youtube.com/watch?v=XaI4meBJr20",
      tags: ["usa","washington","white_house","landmark"]
    },
    {
      id: "us_white_house_earthtv_alt",
      title: "White House (Alt) — Live Cam",
      place: "Washington, D.C., USA",
      source: "earthTV (YouTube Live)",
      kind: "youtube",
      youtubeId: "5OYlzN9cr5w",
      originUrl: "https://www.youtube.com/watch?v=5OYlzN9cr5w",
      tags: ["usa","washington","white_house","landmark","alt"]
    },

    // (VIDEO ONLY) — entradas image se ignorarán en export
    {
      id: "grand_canyon_entrance_img",
      title: "Grand Canyon (Entrada) — Snapshot",
      place: "Grand Canyon (South Entrance), Arizona, USA",
      source: "NPS (.gov) — imagen",
      kind: "image",
      url: "https://www.nps.gov/webcams-grca/camera.jpg",
      refreshMs: 60000,
      maxSeconds: 60,
      originUrl: "https://www.nps.gov/grca/learn/photosmultimedia/webcams.htm",
      tags: ["nature","usa","snapshot"]
    },
    {
      id: "grand_canyon_pixelcaster_img",
      title: "Grand Canyon — Snapshot",
      place: "Grand Canyon, Arizona, USA",
      source: "Pixelcaster — imagen",
      kind: "image",
      url: "https://cdn.pixelcaster.com/public.pixelcaster.com/snapshots/grandcanyon-2/latest.jpg",
      refreshMs: 60000,
      maxSeconds: 60,
      originUrl: "https://www.nps.gov/grca/learn/photosmultimedia/webcams.htm",
      tags: ["nature","usa","snapshot"]
    },

    // ──────────────── EUROPA (tus actuales) ────────────────
    {
      id: "london_abbey_road",
      title: "Abbey Road Crossing — Live Cam",
      place: "Londres, Reino Unido",
      source: "EarthCam (YouTube)",
      kind: "youtube",
      youtubeId: "57w2gYXjRic",
      originUrl: "https://www.youtube.com/watch?v=57w2gYXjRic",
      tags: ["city","uk","street"]
    },
    {
      id: "rome_colosseum",
      title: "Coliseo — Live Cam",
      place: "Roma, Italia",
      source: "SkylineWebcams (YouTube)",
      kind: "youtube",
      youtubeId: "54_skPGLNhA",
      originUrl: "https://www.youtube.com/watch?v=54_skPGLNhA",
      tags: ["city","italy","landmark"]
    },
    {
      id: "reykjavik_live",
      title: "Reykjavík — Live Cam",
      place: "Reykjavík, Islandia",
      source: "YouTube",
      kind: "youtube",
      youtubeId: "ZONCgHc1cZc",
      originUrl: "https://www.youtube.com/watch?v=ZONCgHc1cZc",
      tags: ["iceland","city","weather"]
    },
    {
      id: "lofotens_henningsvaer",
      title: "Lofoten Islands — Live Cam",
      place: "Henningsvær, Noruega",
      source: "SkylineWebcams (YouTube)",
      kind: "youtube",
      youtubeId: "Q6j50GaGM9g",
      originUrl: "https://www.youtube.com/watch?v=Q6j50GaGM9g",
      tags: ["norway","nature","coast"]
    },
    {
      id: "venice_rolling",
      title: "Venecia (Rolling Cam)",
      place: "Venecia, Italia",
      source: "YouTube",
      kind: "youtube",
      youtubeId: "ph1vpnYIxJk",
      originUrl: "https://www.youtube.com/watch?v=ph1vpnYIxJk",
      tags: ["italy","city"]
    },
    {
      id: "zurich_webcam",
      title: "Zürich — Live Cam",
      place: "Zúrich, Suiza",
      source: "YouTube",
      kind: "youtube",
      youtubeId: "BFyUMaRclJI",
      originUrl: "https://www.youtube.com/watch?v=BFyUMaRclJI",
      tags: ["switzerland","city"]
    },

    // ──────────────── ASIA (tus actuales) ────────────────
    {
      id: "tokyo_shibuya",
      title: "Shibuya Crossing — Live Cam",
      place: "Shibuya, Tokio, Japón",
      source: "YouTube",
      kind: "youtube",
      youtubeId: "tujkoXI8rWM",
      originUrl: "https://www.youtube.com/watch?v=tujkoXI8rWM",
      tags: ["japan","city","street"]
    },
    {
      id: "tokyo_tower",
      title: "Tokyo Tower — Live Cam",
      place: "Tokio, Japón",
      source: "YouTube",
      kind: "youtube",
      youtubeId: "RCur8_bXL0U",
      originUrl: "https://www.youtube.com/watch?v=RCur8_bXL0U",
      tags: ["japan","landmark"]
    },
    {
      id: "dubai_marina",
      title: "Dubai Marina — Live Cam",
      place: "Dubái, Emiratos Árabes Unidos",
      source: "YouTube",
      kind: "youtube",
      youtubeId: "hcjGYYHyn2c",
      originUrl: "https://www.youtube.com/watch?v=hcjGYYHyn2c",
      tags: ["uae","city"]
    },
    {
      id: "cappadocia_turkey",
      title: "Cappadocia — Live Cam",
      place: "Cappadocia, Turquía",
      source: "SkylineWebcams (YouTube)",
      kind: "youtube",
      youtubeId: "SnlUWObWsgM",
      originUrl: "https://www.youtube.com/watch?v=SnlUWObWsgM",
      tags: ["turkey","nature"]
    },

    // ──────────────── OCEANÍA (tus actuales) ────────────────
    {
      id: "sydney_harbour_static",
      title: "Sydney Harbour — Live Cam",
      place: "Sídney, Australia",
      source: "WebcamSydney (YouTube)",
      kind: "youtube",
      youtubeId: "5uZa3-RMFos",
      originUrl: "https://www.youtube.com/watch?v=5uZa3-RMFos",
      tags: ["australia","harbour"]
    },
    {
      id: "sydney_harbour_panning",
      title: "Sydney Harbour (Pan) — Live Cam",
      place: "Sídney, Australia",
      source: "WebcamSydney (YouTube)",
      kind: "youtube",
      youtubeId: "jshwkG1ZpP8",
      originUrl: "https://www.youtube.com/watch?v=jshwkG1ZpP8",
      tags: ["australia","harbour","ptz"]
    },

    // ──────────────── ÁFRICA (tus actuales) ────────────────
    {
      id: "cape_town_table_mountain",
      title: "Table Mountain — Live Cam",
      place: "Cape Town, Sudáfrica",
      source: "YouTube",
      kind: "youtube",
      youtubeId: "i5R4ZlVLzLI",
      originUrl: "https://www.youtube.com/watch?v=i5R4ZlVLzLI",
      tags: ["south_africa","mountain"]
    },

    // ──────────────── EXTRA (tus actuales) ────────────────
    {
      id: "iceland_volcano_watch",
      title: "Volcano Watch — Live Cam",
      place: "Islandia (zona volcánica)",
      source: "YouTube",
      kind: "youtube",
      youtubeId: "Obz3FdSiWxk",
      originUrl: "https://www.youtube.com/watch?v=Obz3FdSiWxk",
      tags: ["iceland","volcano"]
    },

    // ──────────────── NUEVAS (las que ya añadiste) ───────────
    { id:"us_911_memorial", title:"9/11 Memorial & World Trade Center — Live Cam", place:"Lower Manhattan, NYC, USA", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"PI63KrE3UGo", originUrl:"https://www.youtube.com/watch?v=PI63KrE3UGo", tags:["usa","nyc","landmark"] },
    { id:"br_rio_earthcam_alt", title:"Rio de Janeiro (EarthCam) — Live Cam", place:"Rio de Janeiro, Brasil", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"bwQyNMjsG3k", originUrl:"https://www.youtube.com/watch?v=bwQyNMjsG3k", tags:["brazil","city"] },
    { id:"us_coney_island", title:"Coney Island — Live Cam", place:"Brooklyn, NYC, USA", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"xHLEKR3_8iI", originUrl:"https://www.youtube.com/watch?v=xHLEKR3_8iI", tags:["usa","beach","nyc"] },
    { id:"us_myrtle_beach", title:"Myrtle Beach — Live Cam", place:"South Carolina, USA", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"RG_-aRFPQSU", originUrl:"https://www.youtube.com/watch?v=RG_-aRFPQSU", tags:["usa","beach"] },
    { id:"us_seaside_park_nj", title:"Seaside Park — Live Cam", place:"New Jersey, USA", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"XKQKFYbaqdA", originUrl:"https://www.youtube.com/watch?v=XKQKFYbaqdA", tags:["usa","beach"] },
    { id:"ky_cayman_islands", title:"Cayman Islands — Live Cam", place:"Grand Cayman, Islas Caimán", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"ZljOTPG2i1Y", originUrl:"https://www.youtube.com/watch?v=ZljOTPG2i1Y", tags:["caribbean","beach"] },
    { id:"sx_sint_maarten", title:"Sint Maarten — Live Cam", place:"Philipsburg, Sint Maarten", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"aBpnLhWvW3A", originUrl:"https://www.youtube.com/watch?v=aBpnLhWvW3A", tags:["caribbean","port"] },
    { id:"vg_scrub_island_bvi", title:"Scrub Island — Live Cam", place:"British Virgin Islands", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"GYp4rUikGc0", originUrl:"https://www.youtube.com/watch?v=GYp4rUikGc0", tags:["caribbean","island"] },
    { id:"pr_palomino_island", title:"Palomino Island Beach — Live Cam", place:"Puerto Rico", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"MU8kI-PbVnM", originUrl:"https://www.youtube.com/watch?v=MU8kI-PbVnM", tags:["caribbean","beach"] },
    { id:"mp_saipan_beach", title:"Saipan Beach — Live Cam", place:"Saipán, Islas Marianas", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"zFGugdfc8k4", originUrl:"https://www.youtube.com/watch?v=zFGugdfc8k4", tags:["island","beach"] },
    { id:"us_new_orleans_street", title:"New Orleans Street Cam — Live", place:"New Orleans, Louisiana, USA", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"qHW8srS0ylo", originUrl:"https://www.youtube.com/live/qHW8srS0ylo", tags:["usa","street"] },
    { id:"us_dc_cherry_blossom", title:"Cherry Blossom — Live Cam", place:"Washington, D.C., USA", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"nNkSMJP0Tyg", originUrl:"https://www.youtube.com/live/nNkSMJP0Tyg", tags:["usa","park"] },
    { id:"us_hotel_saranac", title:"Hotel Saranac (Town View) — Live Cam", place:"Saranac Lake, NY, USA", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"dZV8pa5QhHY", originUrl:"https://www.youtube.com/watch?v=dZV8pa5QhHY", tags:["usa","town"] },
    { id:"us_tamarin_monkey_cam", title:"Tamarin Monkey Cam — Live", place:"Utica, New York, USA", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"1B0uwxfEYCA", originUrl:"https://www.youtube.com/watch?v=1B0uwxfEYCA", tags:["usa","wildlife"] },
    { id:"us_halloween_earthcam", title:"EarthCam Seasonal Cam — Live", place:"USA (varios puntos)", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"mBr1dGev8qM", originUrl:"https://www.youtube.com/watch?v=mBr1dGev8qM", tags:["usa"] },
    { id:"us_storm_idalia", title:"Storm Coverage — Live Cam", place:"USA (cobertura)", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"t40VpDs9J9c", originUrl:"https://www.youtube.com/watch?v=t40VpDs9J9c", tags:["weather","usa"] },
    { id:"us_times_square_4k_alt", title:"Times Square in 4K (Alt) — Live Cam", place:"New York, USA", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"SW1vpWZq9-w", originUrl:"https://www.youtube.com/watch?v=SW1vpWZq9-w", tags:["nyc","4k"] },
    { id:"us_nyc_xmas_4k", title:"NYC Holiday — Live Cam", place:"New York, USA", source:"YouTube", kind:"youtube", youtubeId:"5_vrqwsKXEQ", originUrl:"https://www.youtube.com/watch?v=5_vrqwsKXEQ", tags:["nyc","seasonal"] },
    { id:"es_tamariu_earthcam", title:"Tamariu — Live Cam", place:"Tamariu, España", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"ld87T3g_nyg", originUrl:"https://www.youtube.com/watch?v=ld87T3g_nyg", tags:["spain","beach"] },

    { id:"it_venice_grand_canal_povoledo", title:"Grand Canal (Povoledo) — Live Cam", place:"Venecia, Italia", source:"YouTube", kind:"youtube", youtubeId:"P6JA_YjHMZs", originUrl:"https://www.youtube.com/watch?v=P6JA_YjHMZs", tags:["italy","canal"] },
    { id:"it_venice_grand_canal_caangeli", title:"Grand Canal (Ca'Angeli) — Live Cam", place:"Venecia, Italia", source:"YouTube", kind:"youtube", youtubeId:"P393gTj527k", originUrl:"https://www.youtube.com/watch?v=P393gTj527k", tags:["italy","canal"] },
    { id:"it_venice_ponte_guglie_4k", title:"Ponte delle Guglie — Live Cam", place:"Venecia, Italia", source:"YouTube", kind:"youtube", youtubeId:"HpZAez2oYsA", originUrl:"https://www.youtube.com/watch?v=HpZAez2oYsA", tags:["italy","bridge"] },
    { id:"it_venice_san_cassiano", title:"Grand Canal (Hotel San Cassiano) — Live Cam", place:"Venecia, Italia", source:"YouTube", kind:"youtube", youtubeId:"lFQ_BvxIcnI", originUrl:"https://www.youtube.com/watch?v=lFQ_BvxIcnI", tags:["italy","canal"] },
    { id:"it_trevi_fountain", title:"Trevi Fountain — Live Cam", place:"Roma, Italia", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"j39vIidsIJI", originUrl:"https://www.youtube.com/watch?v=j39vIidsIJI", tags:["italy","rome","landmark"] },
    { id:"it_pozzuoli_campi_flegrei", title:"Campi Flegrei (Pozzuoli) — Live Cam", place:"Pozzuoli, Italia", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"-sNafHFByDI", originUrl:"https://www.youtube.com/watch?v=-sNafHFByDI", tags:["italy","volcano"] },
    { id:"it_etna_eruption_live", title:"Etna Eruption — Live Cam", place:"Sicilia, Italia", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"plYtw4DSf5I", originUrl:"https://www.youtube.com/watch?v=plYtw4DSf5I", tags:["italy","volcano"] },
    { id:"it_etna_live_alt1", title:"Mount Etna (Alt 1) — Live Cam", place:"Sicilia, Italia", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"k_g6c14hXGQ", originUrl:"https://www.youtube.com/watch?v=k_g6c14hXGQ", tags:["italy","volcano"] },
    { id:"it_etna_live_alt2", title:"Mount Etna (Alt 2) — Live Cam", place:"Sicilia, Italia", source:"YouTube", kind:"youtube", youtubeId:"EHIelAoCBoM", originUrl:"https://www.youtube.com/watch?v=EHIelAoCBoM", tags:["italy","volcano"] },
    { id:"es_malaga_weather_alert", title:"Málaga — Live Cam", place:"Málaga, España", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"cplErgOi_Ws", originUrl:"https://www.youtube.com/watch?v=cplErgOi_Ws", tags:["spain","weather"] },
    { id:"ch_wengen_alps", title:"Wengen Alps — Live Cam", place:"Wengen, Suiza", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"I28Cip207ZY", originUrl:"https://www.youtube.com/watch?v=I28Cip207ZY", tags:["switzerland","alps","snow"] },
    { id:"gr_santorini_live", title:"Santorini — Live Cam", place:"Santorini, Grecia", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"2a4SrvF0iS8", originUrl:"https://www.youtube.com/watch?v=2a4SrvF0iS8", tags:["greece","island"] },
    { id:"il_jerusalem_live", title:"Jerusalem — Live Cam", place:"Jerusalén, Israel", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"hTSfDxRmrEQ", originUrl:"https://www.youtube.com/watch?v=hTSfDxRmrEQ", tags:["city","landmark"] },
    { id:"cz_prague_live", title:"Prague — Live Cam", place:"Praga, República Checa", source:"YouTube", kind:"youtube", youtubeId:"0FvTdT3EJY4", originUrl:"https://www.youtube.com/watch?v=0FvTdT3EJY4", tags:["czech","city"] },
    { id:"cz_prague_snowfall", title:"Prague Snowfall — Live Cam", place:"Praga, República Checa", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"B6FDKqfJ6M4", originUrl:"https://www.youtube.com/watch?v=B6FDKqfJ6M4", tags:["czech","snow"] },
    { id:"cz_prague_trainspotting", title:"Prague Main Station — Live Cam", place:"Praga, República Checa", source:"YouTube", kind:"youtube", youtubeId:"AttVS4KM8tY", originUrl:"https://www.youtube.com/watch?v=AttVS4KM8tY", tags:["train","czech"] },

    { id:"nl_amsterdam_dam_ptz", title:"Amsterdam — De Dam (PTZ) — Live Cam", place:"Ámsterdam, Países Bajos", source:"YouTube", kind:"youtube", youtubeId:"Gd9d4q6WvUY", originUrl:"https://www.youtube.com/watch?v=Gd9d4q6WvUY", tags:["netherlands","ptz"] },
    { id:"nl_amsterdam_singel_hotel", title:"Singel Hotel — Live Cam", place:"Ámsterdam, Países Bajos", source:"YouTube", kind:"youtube", youtubeId:"ZnOoxCd7BGU", originUrl:"https://www.youtube.com/watch?v=ZnOoxCd7BGU", tags:["netherlands","city"] },
    { id:"nl_amsterdam_sixhaven", title:"Sixhaven — Live Cam", place:"Ámsterdam, Países Bajos", source:"YouTube", kind:"youtube", youtubeId:"3gTHiUWrCAE", originUrl:"https://www.youtube.com/watch?v=3gTHiUWrCAE", tags:["netherlands","harbour"] },
    { id:"nl_amsterdam_movenpick", title:"Mövenpick Rooftop — Live Cam", place:"Ámsterdam, Países Bajos", source:"YouTube", kind:"youtube", youtubeId:"9Pm6Ji6tm7s", originUrl:"https://www.youtube.com/watch?v=9Pm6Ji6tm7s", tags:["netherlands","rooftop"] },
    { id:"nl_amsterdam_live_stream", title:"Amsterdam — Live Cam", place:"Ámsterdam, Países Bajos", source:"YouTube", kind:"youtube", youtubeId:"RmiTd0J5qDg", originUrl:"https://www.youtube.com/watch?v=RmiTd0J5qDg", tags:["netherlands","city"] },
    { id:"nl_amsterdam_stationseiland", title:"Amsterdam — Station Area — Live Cam", place:"Ámsterdam, Países Bajos", source:"YouTube", kind:"youtube", youtubeId:"1phWWCgzXgM", originUrl:"https://www.youtube.com/watch?v=1phWWCgzXgM", tags:["netherlands","station"] },

    { id:"fr_paris_pont_iena", title:"Paris — Pont de Iéna (Eiffel Tower) — Live Cam", place:"París, Francia", source:"YouTube", kind:"youtube", youtubeId:"7-OFVJ8hKFc", originUrl:"https://www.youtube.com/watch?v=7-OFVJ8hKFc", tags:["france","landmark"] },
    { id:"fr_paris_live_hd", title:"Paris — Eiffel — Live Cam", place:"París, Francia", source:"YouTube", kind:"youtube", youtubeId:"iZipA1LL_sU", originUrl:"https://www.youtube.com/watch?v=iZipA1LL_sU", tags:["france","landmark"] },
    { id:"fr_paris_stream_alt", title:"Paris (Eiffel area) — Live Cam", place:"París, Francia", source:"YouTube", kind:"youtube", youtubeId:"xzMYdVo-3Bs", originUrl:"https://www.youtube.com/watch?v=xzMYdVo-3Bs", tags:["france","city"] },
    { id:"fr_paris_angles_4k", title:"Paris — Eiffel Tower — Live Cam", place:"París, Francia", source:"YouTube", kind:"youtube", youtubeId:"mvcL9--pvHw", originUrl:"https://www.youtube.com/watch?v=mvcL9--pvHw&vl=en", tags:["france","multi"] },

    { id:"es_barcelona_rough_morning", title:"Barcelona — Live Cam", place:"Barcelona, España", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"XL1hRO8EYa0", originUrl:"https://www.youtube.com/watch?v=XL1hRO8EYa0", tags:["spain","barcelona"] },
    { id:"es_tenerife_santa_cruz", title:"Santa Cruz de Tenerife — Live Cam", place:"Tenerife, España", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"RJbiqyQ4BlY", originUrl:"https://www.youtube.com/watch?v=RJbiqyQ4BlY", tags:["spain","canary"] },
    { id:"es_tenerife_las_vistas", title:"Playa Las Vistas — Live Cam", place:"Tenerife, España", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"gsTMAwBl-5E", originUrl:"https://www.youtube.com/watch?v=gsTMAwBl-5E", tags:["spain","canary","beach"] },

    { id:"ar_buenos_aires_live", title:"Buenos Aires — Live Cam", place:"Buenos Aires, Argentina", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"reShHDyLGbc", originUrl:"https://www.youtube.com/watch?v=reShHDyLGbc", tags:["argentina","city"] },
    { id:"ar_ushuaia_snowfall", title:"Ushuaia Snowfall — Live Cam", place:"Ushuaia, Argentina", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"9cYa8Ssf0rI", originUrl:"https://www.youtube.com/watch?v=9cYa8Ssf0rI", tags:["argentina","snow"] },

    { id:"fo_faroe_islands_live", title:"Faroe Islands — Live Cam", place:"Islas Feroe", source:"YouTube", kind:"youtube", youtubeId:"9NpCVV25j_4", originUrl:"https://www.youtube.com/watch?v=9NpCVV25j_4", tags:["faroe","nature"] },
    { id:"it_canazei_snowfall", title:"Canazei Snowfall — Live Cam", place:"Canazei, Italia", source:"YouTube", kind:"youtube", youtubeId:"hIKpX489KCI", originUrl:"https://www.youtube.com/watch?v=hIKpX489KCI", tags:["italy","snow","alps"] },

    { id:"th_phuket_new_year_live", title:"Night Cam — Live", place:"Phuket, Tailandia", source:"YouTube", kind:"youtube", youtubeId:"AQMaw6OAeHY", originUrl:"https://www.youtube.com/watch?v=AQMaw6OAeHY", tags:["thailand","night"] },
    { id:"us_hawaii_volcano_cam_alt", title:"Volcano Cam (Big Island) — Live", place:"Hawái, USA", source:"YouTube", kind:"youtube", youtubeId:"u4UZ4UvZXrg", originUrl:"https://www.youtube.com/watch?v=u4UZ4UvZXrg", tags:["usa","hawaii","volcano"] }
  ];

  // NEWS seeds (solo si activas camsNews=1). Son pocos a propósito: discovery hace el “gordo”.
  // Puedes añadir tus propios canales aquí cuando quieras.
  const NEWS_RAW = [
    // Ejemplos genéricos (si alguno cae, el discovery lo compensa):
    { id:"news_world_generic_1", title:"World News — Live", place:"", source:"YouTube Live", kind:"youtube", youtubeId:"", originUrl:"", tags:["news"] },
    { id:"news_world_generic_2", title:"Breaking News — Live", place:"", source:"YouTube Live", kind:"youtube", youtubeId:"", originUrl:"", tags:["news"] }
  ];

  // ─────────────────────────────────────────────────────────────
  // 2) SANITIZAR + EXPORTAR (VIDEO ONLY)
  // ─────────────────────────────────────────────────────────────
  const seenIds = new Set();
  const seenYouTube = new Set(); // youtubeId

  const OUT = [];               // lista principal (webcams + alts)
  const OUT_CATALOG = [];       // catálogo principal (sin alts)

  // News (separado)
  const NEWS_SEEN_IDS = new Set();
  const NEWS_SEEN_YT = new Set();
  const OUT_NEWS = [];
  const OUT_NEWS_CATALOG = [];

  function pushCam(cam) {
    if (!cam || !cam.id || seenIds.has(cam.id)) return false;
    seenIds.add(cam.id);
    if (cam.kind === "youtube" && cam.youtubeId) seenYouTube.add(cam.youtubeId);
    OUT.push(cam);
    if (!cam.isAlt) OUT_CATALOG.push(cam);
    return true;
  }

  function pushNews(cam) {
    if (!cam || !cam.id || NEWS_SEEN_IDS.has(cam.id)) return false;
    NEWS_SEEN_IDS.add(cam.id);
    if (cam.kind === "youtube" && cam.youtubeId) NEWS_SEEN_YT.add(cam.youtubeId);
    OUT_NEWS.push(cam);
    OUT_NEWS_CATALOG.push(cam);
    return true;
  }

  function normalizeKind(cam) {
    let kind = safeStr(cam.kind).toLowerCase();
    if (kind === "image") return ""; // VIDEO ONLY

    if (!ALLOWED_KINDS.has(kind)) {
      if (safeStr(cam.youtubeId) || extractYouTubeIdFromUrl(cam.originUrl) || extractYouTubeIdFromUrl(cam.url)) {
        kind = "youtube";
      } else if (looksLikeM3U8(cam.url)) {
        kind = "hls";
      } else {
        return "";
      }
    }
    return kind;
  }

  // Seeds webcams
  for (let i = 0; i < RAW.length; i++) {
    const cam = RAW[i];
    if (!cam || typeof cam !== "object") continue;
    if (cam.disabled === true) continue;

    const id = toId(cam.id, i);
    if (seenIds.has(id)) continue;

    const kind = normalizeKind(cam);
    if (!kind) continue;

    // Filtro webcam LIVE (heurístico)
    const tOk = camTitleOk(cam.title, cam.source);
    if (!tOk) {
      if (!(kind === "hls" && looksLikeM3U8(cam.url))) continue;
    }

    const base = {
      id,
      title: safeStr(cam.title) || "Live Cam",
      place: safeStr(cam.place) || "",
      source: safeStr(cam.source) || "",
      kind,
      tags: Array.isArray(cam.tags) ? cam.tags.slice(0, 12) : undefined,
      isAlt: false
    };

    if (kind === "youtube") {
      let youtubeId = safeStr(cam.youtubeId);
      if (!isValidYouTubeId(youtubeId)) {
        youtubeId = extractYouTubeIdFromUrl(cam.originUrl) || extractYouTubeIdFromUrl(cam.url);
      }
      if (!isValidYouTubeId(youtubeId)) continue;
      if (seenYouTube.has(youtubeId)) continue;

      base.youtubeId = youtubeId;
      base.originUrl = safeStr(cam.originUrl) || `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}`;
      base.thumb = safeStr(cam.thumb) || youtubeThumb(youtubeId);
      if (typeof cam.maxSeconds === "number" && cam.maxSeconds > 0) base.maxSeconds = cam.maxSeconds | 0;

      pushCam(base);
      continue;
    }

    if (kind === "hls") {
      const url = safeStr(cam.url);
      if (!url || !looksLikeM3U8(url)) continue;

      base.url = url;
      base.originUrl = safeStr(cam.originUrl) || url;
      if (typeof cam.maxSeconds === "number" && cam.maxSeconds > 0) base.maxSeconds = cam.maxSeconds | 0;

      pushCam(base);
      continue;
    }
  }

  // Seeds news (solo si activas)
  if (NEWS_ENABLED) {
    for (let i = 0; i < NEWS_RAW.length; i++) {
      const cam = NEWS_RAW[i];
      if (!cam || typeof cam !== "object") continue;
      if (cam.disabled === true) continue;

      const kind = normalizeKind(cam);
      if (!kind) continue;

      // Si no hay youtubeId real en seed, lo dejamos fuera (discovery lo rellena)
      if (kind !== "youtube") continue;

      const yid = safeStr(cam.youtubeId);
      if (!isValidYouTubeId(yid)) continue;

      const id = safeStr(cam.id) || `news_${yid}`;
      if (NEWS_SEEN_IDS.has(id)) continue;
      if (NEWS_SEEN_YT.has(yid)) continue;

      if (!newsTitleOk(cam.title, cam.source)) continue;

      pushNews({
        id,
        title: safeStr(cam.title) || "News Live",
        place: safeStr(cam.place) || "",
        source: safeStr(cam.source) || "YouTube Live",
        kind: "youtube",
        youtubeId: yid,
        originUrl: safeStr(cam.originUrl) || `https://www.youtube.com/watch?v=${encodeURIComponent(yid)}`,
        thumb: youtubeThumb(yid),
        tags: ["news"],
        isAlt: false
      });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 2.5) CACHE LOAD (si hay cache buena, la usamos YA)
  // ─────────────────────────────────────────────────────────────
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
            if (!looksLikeM3U8(c.url)) continue;
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
    try {
      const payload = {
        ts: Date.now(),
        v: VERSION,
        target: limit,
        list: listNonAlt.slice(0, limit)
      };
      localStorage.setItem(keyMain, JSON.stringify(payload));
      // Compat: legacy solo si no hay namespace y es cache webcams
      if (!NS && keyMain === CACHE_KEY_V238) {
        localStorage.setItem(CACHE_KEY_LEGACY, JSON.stringify({ ts: payload.ts, list: payload.list }));
      }
    } catch (_) {}
  }

  // Cache webcams
  const cached = loadCacheAny([CACHE_KEY_V238, CACHE_KEY_LEGACY], (c) => camTitleOk(c.title, c.source));
  if (cached && cached.length >= Math.min(120, TARGET_CAMS)) {
    for (let i = 0; i < cached.length; i++) {
      const c = cached[i];
      if (!c || typeof c !== "object") continue;

      const kind = safeStr(c.kind).toLowerCase();
      if (!ALLOWED_KINDS.has(kind)) continue;

      const id = safeStr(c.id);
      if (!id || seenIds.has(id)) continue;

      if (!camTitleOk(c.title, c.source)) continue;

      if (kind === "youtube") {
        const yid = safeStr(c.youtubeId);
        if (!isValidYouTubeId(yid) || seenYouTube.has(yid)) continue;
      }
      pushCam(c);
      if (OUT.length >= TARGET_CAMS) break;
    }
  }

  // Cache news (si activas)
  if (NEWS_ENABLED) {
    const cachedNews = loadCacheAny([CACHE_NEWS_KEY_V238], (c) => newsTitleOk(c.title, c.source));
    if (cachedNews && cachedNews.length >= Math.min(12, NEWS_TARGET)) {
      for (let i = 0; i < cachedNews.length; i++) {
        const c = cachedNews[i];
        if (!c || typeof c !== "object") continue;
        const kind = safeStr(c.kind).toLowerCase();
        if (kind !== "youtube") continue;

        const id = safeStr(c.id);
        if (!id || NEWS_SEEN_IDS.has(id)) continue;

        if (!newsTitleOk(c.title, c.source)) continue;

        const yid = safeStr(c.youtubeId);
        if (!isValidYouTubeId(yid) || NEWS_SEEN_YT.has(yid)) continue;

        pushNews(c);
        if (OUT_NEWS_CATALOG.length >= NEWS_TARGET) break;
      }
    }
  }

  // Export inmediato (para no romper tu player/control)
  g.CAM_LIST = OUT;
  g.CAM_CATALOG_LIST = OUT_CATALOG;
  g.CAM_NEWS_LIST = OUT_NEWS;

  // Promise opcional
  let __resolveReady = null;
  g.CAM_LIST_READY = new Promise((res) => { __resolveReady = res; });

  // ─────────────────────────────────────────────────────────────
  // CATALOGO API (4 a la vez)
  // ─────────────────────────────────────────────────────────────
  function getCatalogList() {
    return Array.isArray(g.CAM_CATALOG_LIST) ? g.CAM_CATALOG_LIST : [];
  }

  function getCatalogTotalPages(pageSize = CATALOG_PAGE_SIZE) {
    const list = getCatalogList();
    const ps = Math.max(1, (pageSize | 0));
    return Math.max(1, Math.ceil(list.length / ps));
  }

  function getCatalogPage(pageIndex, pageSize = CATALOG_PAGE_SIZE) {
    const list = getCatalogList();
    const ps = Math.max(1, (pageSize | 0));
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
    const maxTries = Math.max(40, n * 20);
    let tries = 0;
    while (out.length < n && tries++ < maxTries) {
      const c = list[(Math.random() * list.length) | 0];
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
    const n = Math.max(1, (count | 0));
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
    const h = (ev) => {
      try { cb((ev && ev.detail) || null); } catch (_) {}
    };
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
    const nn = Math.max(50, Math.min(2500, (n | 0) || TARGET_CAMS_DEFAULT));
    TARGET_CAMS = nn;
    emitUpdate();
    return TARGET_CAMS;
  };
  g.RLCCams.setAutoDiscovery = (v) => {
    AUTO_DISCOVERY = !!v;
    emitUpdate();
    return AUTO_DISCOVERY;
  };
  g.RLCCams.setValidateEmbed = (v) => {
    VALIDATE_EMBED = !!v;
    emitUpdate();
    return VALIDATE_EMBED;
  };
  g.RLCCams.clearCache = () => {
    try { localStorage.removeItem(CACHE_KEY_V238); } catch (_) {}
    try { localStorage.removeItem(CACHE_NEWS_KEY_V238); } catch (_) {}
    try { if (!NS) localStorage.removeItem(CACHE_KEY_LEGACY); } catch (_) {}
    emitUpdate();
  };

  // News API (opcional)
  g.RLCCams.getNewsList = () => Array.isArray(g.CAM_NEWS_LIST) ? g.CAM_NEWS_LIST : [];
  g.RLCCams.setNewsEnabled = (v) => { NEWS_ENABLED = !!v; emitUpdate(); return NEWS_ENABLED; };
  g.RLCCams.setNewsMix = (v) => { NEWS_MIX_IN_MAIN = !!v; emitUpdate(); return NEWS_MIX_IN_MAIN; };
  g.RLCCams.setNewsInCatalog = (v) => { NEWS_IN_CATALOG = !!v; emitUpdate(); return NEWS_IN_CATALOG; };
  g.RLCCams.setNewsTarget = (n) => { NEWS_TARGET = Math.max(10, Math.min(300, (n|0) || 60)); emitUpdate(); return NEWS_TARGET; };

  // compat extra
  g.RLC_CATALOG_PAGE_SIZE = CATALOG_PAGE_SIZE;

  emitUpdate();

  // ─────────────────────────────────────────────────────────────
  // 3) AUTO-DISCOVERY — completar a TARGET_CAMS con cams REALES
  // ─────────────────────────────────────────────────────────────
  function textLikelyBlockedEmbed(t) {
    const s = (t || "").toLowerCase();
    if (s.includes("playback on other websites has been disabled")) return true;
    if (s.includes("video unavailable")) return true;
    if (s.includes("this video is unavailable")) return true;
    if (s.includes("has been removed")) return true;
    return false;
  }

  function textLooksNotLive(t) {
    const s = (t || "").toLowerCase();
    if (s.includes("premiere")) return true;
    if (s.includes("upcoming")) return true;
    if (s.includes("scheduled")) return true;
    return false;
  }

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

  // Proxies/fallbacks
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

  async function isReallyLiveYouTube(videoId, signal) {
    if (!BEST_EFFORT_LIVE_CHECK) return true;
    if (!validateBudgetOk()) return true;
    __validateUsed++;

    try {
      const html = await fetchTextSmart(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, 11000, signal);
      if (!html) return true;
      const h = html.toLowerCase();
      if (textLooksNotLive(h)) return false;
      if (h.includes("\"islive\":true") || h.includes("\"islivecontent\":true") || h.includes("\"islivenow\":true")) return true;
      if (h.includes("livestreamability") && !h.includes("unplayable")) return true;
      return true;
    } catch (_) {
      return true;
    }
  }

  async function isEmbeddableYouTube(videoId, signal) {
    if (!VALIDATE_EMBED) return true;
    if (!validateBudgetOk()) return true;
    __validateUsed++;

    // 1) oEmbed (rápido)
    try {
      const o = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent("https://www.youtube.com/watch?v=" + videoId)}`;
      const r = await fetchWithTimeout(o, { method: "GET", cache: "no-store", signal }, 7000);
      if (r && r.ok) {
        // ok
      } else if (r && (r.status === 401 || r.status === 403 || r.status === 404)) {
        return false;
      }
    } catch (_) {}

    // 2) embed HTML (best-effort)
    try {
      const html = await fetchTextSmart(`https://www.youtube.com/embed/${videoId}`, 9000, signal);
      if (html && textLikelyBlockedEmbed(html)) return false;
    } catch (_) {}

    // 3) live check (best-effort)
    const liveOk = await isReallyLiveYouTube(videoId, signal);
    if (!liveOk) return false;

    return true;
  }

  function toAutoCam(entry) {
    const vid = safeStr(entry && entry.videoId);
    if (!isValidYouTubeId(vid)) return null;

    const title = safeStr(entry.title) || "Live Cam";
    const author = safeStr(entry.author);
    if (!camTitleOk(title, author)) return null;

    return {
      id: `yt_${vid}`,
      title,
      place: "",
      source: author ? `${author} (YouTube Live)` : "YouTube Live",
      kind: "youtube",
      youtubeId: vid,
      originUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(vid)}`,
      thumb: youtubeThumb(vid),
      tags: ["auto","live","webcam"],
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

  // Instancias Invidious
  async function getInvidiousInstances(signal) {
    const fallback = [
      "https://inv.nadeko.net",
      "https://yewtu.be",
      "https://invidious.f5.si",
      "https://invidious.nerdvpn.de",
      "https://inv.perditum.com"
    ];

    try {
      const data = await fetchJsonSmart("https://api.invidious.io/instances.json", 12000, signal);
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

  async function invidiousSearch(instance, q, page, signal) {
    if (!budgetOk()) return [];
    const base = instance.replace(/\/+$/, "");
    const url =
      `${base}/api/v1/search` +
      `?q=${encodeURIComponent(q)}` +
      `&page=${encodeURIComponent(String(page))}` +
      `&type=video` +
      `&features=live` +
      `&sort=relevance` +
      `&region=US`;
    const res = await fetchJsonSmart(url, 12000, signal);
    return Array.isArray(res) ? res : [];
  }

  async function runDiscoveryWebcams(instances, signal) {
    if (!AUTO_DISCOVERY) return;

    if (OUT.length >= TARGET_CAMS) return;

    const candidates = [];
    const addedNow = new Set();

    const tasks = [];
    let instCursor = 0;
    for (let qi = 0; qi < DISCOVERY_QUERIES.length; qi++) {
      const q = DISCOVERY_QUERIES[qi];
      for (let p = 1; p <= DISCOVERY_MAX_PAGES_PER_QUERY; p++) {
        const inst = instances[instCursor++ % instances.length];
        tasks.push({ q, p, inst });
      }
    }
    shuffleInPlace(tasks);

    let cursor = 0;
    const foundForQuery = Object.create(null);

    async function worker() {
      while (cursor < tasks.length && (OUT_CATALOG.length + candidates.length) < TARGET_CAMS) {
        if (!budgetOk()) break;

        const t = tasks[cursor++];

        try {
          const key = t.q;
          foundForQuery[key] = foundForQuery[key] || 0;
          if (foundForQuery[key] >= DISCOVERY_MAX_PER_QUERY) {
            await sleep(40);
            continue;
          }

          const results = await invidiousSearch(t.inst, t.q, t.p, signal);

          for (let i = 0; i < results.length; i++) {
            if (!budgetOk()) break;

            const r = results[i];
            if (!r || r.type !== "video") continue;
            if (r.liveNow !== true) continue;

            const cam = toAutoCam(r);
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
          await sleep(110);
        }
      }
    }

    const workers = [];
    const n = Math.max(1, Math.min(DISCOVERY_CONCURRENCY, 8));
    for (let i = 0; i < n; i++) workers.push(worker());
    await Promise.all(workers);

    // Añadir candidatos
    for (let i = 0; i < candidates.length && OUT_CATALOG.length < TARGET_CAMS; i++) {
      const c = candidates[i];
      if (!c) continue;
      if (seenIds.has(c.id)) continue;
      if (seenYouTube.has(c.youtubeId)) continue;
      pushCam(c);
    }
  }

  async function runDiscoveryNews(instances, signal) {
    if (!NEWS_ENABLED) return;
    if (!NEWS_DISCOVERY) return;
    if (OUT_NEWS_CATALOG.length >= NEWS_TARGET) return;

    const candidates = [];
    const addedNow = new Set();

    const tasks = [];
    let instCursor = 0;
    for (let qi = 0; qi < NEWS_QUERIES.length; qi++) {
      const q = NEWS_QUERIES[qi];
      for (let p = 1; p <= Math.max(2, Math.min(8, DISCOVERY_MAX_PAGES_PER_QUERY)); p++) {
        const inst = instances[instCursor++ % instances.length];
        tasks.push({ q, p, inst });
      }
    }
    shuffleInPlace(tasks);

    let cursor = 0;
    const foundForQuery = Object.create(null);

    async function worker() {
      while (cursor < tasks.length && (OUT_NEWS_CATALOG.length + candidates.length) < NEWS_TARGET) {
        if (!budgetOk()) break;

        const t = tasks[cursor++];

        try {
          const key = t.q;
          foundForQuery[key] = foundForQuery[key] || 0;
          if (foundForQuery[key] >= Math.max(40, Math.min(400, DISCOVERY_MAX_PER_QUERY))) {
            await sleep(40);
            continue;
          }

          const results = await invidiousSearch(t.inst, t.q, t.p, signal);

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
          await sleep(110);
        }
      }
    }

    const workers = [];
    const n = Math.max(1, Math.min(3, DISCOVERY_CONCURRENCY)); // news más suave
    for (let i = 0; i < n; i++) workers.push(worker());
    await Promise.all(workers);

    for (let i = 0; i < candidates.length && OUT_NEWS_CATALOG.length < NEWS_TARGET; i++) {
      const c = candidates[i];
      if (!c) continue;
      if (NEWS_SEEN_IDS.has(c.id)) continue;
      if (NEWS_SEEN_YT.has(c.youtubeId)) continue;
      pushNews(c);
    }
  }

  function applyNewsMixing() {
    // Siempre exporto CAM_NEWS_LIST aparte
    g.CAM_NEWS_LIST = OUT_NEWS;

    if (!NEWS_ENABLED) return;

    // Mix en CAM_LIST si lo pides
    if (NEWS_MIX_IN_MAIN) {
      for (let i = 0; i < OUT_NEWS_CATALOG.length; i++) {
        const n = OUT_NEWS_CATALOG[i];
        if (!n || n.kind !== "youtube") continue;
        const yid = safeStr(n.youtubeId);
        if (!isValidYouTubeId(yid)) continue;

        // Evitar duplicar por youtubeId en la lista principal
        if (seenYouTube.has(yid)) continue;

        // Clonar con id estable “news_*” pero que no choque
        let id = safeStr(n.id) || `news_${yid}`;
        if (seenIds.has(id)) id = `${id}_mix_${(Math.random() * 1e6) | 0}`;

        const cam = Object.assign({}, n, {
          id,
          tags: Array.isArray(n.tags) ? n.tags.slice(0, 11).concat(["mixed"]) : ["news","mixed"],
          isAlt: false
        });

        // Para que el catálogo sea opcional
        if (NEWS_IN_CATALOG) {
          pushCam(cam);
        } else {
          // Meter en lista principal, pero NO en catálogo
          if (!seenIds.has(cam.id)) {
            seenIds.add(cam.id);
            seenYouTube.add(yid);
            OUT.push(cam);
          }
        }
      }
    } else if (NEWS_IN_CATALOG) {
      // No mix en CAM_LIST, pero sí meterlos en el catálogo principal si lo pides
      for (let i = 0; i < OUT_NEWS_CATALOG.length; i++) {
        const n = OUT_NEWS_CATALOG[i];
        if (!n || n.kind !== "youtube") continue;
        const yid = safeStr(n.youtubeId);
        if (!isValidYouTubeId(yid)) continue;
        if (seenYouTube.has(yid)) continue;

        let id = safeStr(n.id) || `news_${yid}`;
        if (seenIds.has(id)) id = `${id}_cat_${(Math.random() * 1e6) | 0}`;

        const cam = Object.assign({}, n, {
          id,
          tags: Array.isArray(n.tags) ? n.tags.slice(0, 11).concat(["news"]) : ["news"],
          isAlt: false
        });

        pushCam(cam);
      }
    }
  }

  async function discoverMore() {
    const signal = MOD._abort.signal;

    try {
      // Si no hay discovery, guardo cache y listo
      if (!AUTO_DISCOVERY && !NEWS_ENABLED) {
        saveCache(CACHE_KEY_V238, OUT_CATALOG, TARGET_CAMS);
        emitUpdate();
        if (__resolveReady) __resolveReady(g.CAM_LIST);
        return;
      }

      // Instancias compartidas
      const instancesRaw = await getInvidiousInstances(signal);
      const instances = shuffleInPlace(instancesRaw.slice(0, Math.max(5, DISCOVERY_MAX_INSTANCES)));

      // Webcams discovery
      if (AUTO_DISCOVERY && OUT_CATALOG.length < TARGET_CAMS) {
        await runDiscoveryWebcams(instances, signal);
      }

      // News discovery (solo si activas)
      if (NEWS_ENABLED && OUT_NEWS_CATALOG.length < NEWS_TARGET) {
        await runDiscoveryNews(instances, signal);
      }

      // Mezcla/Export de news según params
      applyNewsMixing();

      // Failsafe ALT fill (solo player; catálogo limpio)
      if (HARD_FAILSAFE_ALT_FILL && OUT.length > 0 && OUT.length < TARGET_CAMS) {
        const baseLen = OUT.length;
        let k = 0;
        while (OUT.length < TARGET_CAMS && k < 60000) {
          const src = OUT[k % baseLen];
          const altN = ((k / baseLen) | 0) + 1;
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

      // Export final
      g.CAM_LIST = OUT;
      g.CAM_CATALOG_LIST = OUT_CATALOG;
      g.CAM_NEWS_LIST = OUT_NEWS;

      // Guarda cache
      saveCache(CACHE_KEY_V238, OUT_CATALOG, TARGET_CAMS);
      if (NEWS_ENABLED) saveCache(CACHE_NEWS_KEY_V238, OUT_NEWS_CATALOG, NEWS_TARGET);

      emitUpdate();
      if (__resolveReady) __resolveReady(g.CAM_LIST);
    } catch (_) {
      // Si algo explota, no bloqueamos
      try { saveCache(CACHE_KEY_V238, OUT_CATALOG, TARGET_CAMS); } catch (_) {}
      try { if (NEWS_ENABLED) saveCache(CACHE_NEWS_KEY_V238, OUT_NEWS_CATALOG, NEWS_TARGET); } catch (_) {}
      try { emitUpdate(); } catch (_) {}
      try { if (__resolveReady) __resolveReady(g.CAM_LIST); } catch (_) {}
    }
  }

  // Hook opcional (Admin): escucha BC para refresh/clear (NO rompe si no existe)
  // Mensajes soportados:
  //  - {type:"CAMS_REFRESH"}
  //  - {type:"CAMS_CLEAR_CACHE"}
  //  - {type:"CAMS_SET_TARGET", value:number}
  //  - {type:"CAMS_SET_AUTODISCOVERY", value:boolean}
  //  - {type:"CAMS_SET_VALIDATE", value:boolean}
  //  - {type:"CAMS_SET_NEWS_ENABLED", value:boolean}
  //  - {type:"CAMS_SET_NEWS_MIX", value:boolean}
  //  - {type:"CAMS_SET_NEWS_CATALOG", value:boolean}
  //  - {type:"CAMS_SET_NEWS_TARGET", value:number}
  try {
    if ("BroadcastChannel" in g) {
      MOD._bc = new BroadcastChannel("rlc_bus_v1");
      MOD._bc.onmessage = (ev) => {
        const msg = ev && ev.data;
        if (!msg || typeof msg !== "object") return;
        const t = msg.type || msg.t;

        if (t === "CAMS_CLEAR_CACHE") {
          g.RLCCams && g.RLCCams.clearCache && g.RLCCams.clearCache();
          return;
        }
        if (t === "CAMS_SET_TARGET") {
          g.RLCCams && g.RLCCams.setTarget && g.RLCCams.setTarget(msg.value);
          return;
        }
        if (t === "CAMS_SET_AUTODISCOVERY") {
          g.RLCCams && g.RLCCams.setAutoDiscovery && g.RLCCams.setAutoDiscovery(!!msg.value);
          return;
        }
        if (t === "CAMS_SET_VALIDATE") {
          g.RLCCams && g.RLCCams.setValidateEmbed && g.RLCCams.setValidateEmbed(!!msg.value);
          return;
        }
        if (t === "CAMS_SET_NEWS_ENABLED") {
          g.RLCCams && g.RLCCams.setNewsEnabled && g.RLCCams.setNewsEnabled(!!msg.value);
          return;
        }
        if (t === "CAMS_SET_NEWS_MIX") {
          g.RLCCams && g.RLCCams.setNewsMix && g.RLCCams.setNewsMix(!!msg.value);
          return;
        }
        if (t === "CAMS_SET_NEWS_CATALOG") {
          g.RLCCams && g.RLCCams.setNewsInCatalog && g.RLCCams.setNewsInCatalog(!!msg.value);
          return;
        }
        if (t === "CAMS_SET_NEWS_TARGET") {
          g.RLCCams && g.RLCCams.setNewsTarget && g.RLCCams.setNewsTarget(msg.value);
          return;
        }

        if (t === "CAMS_REFRESH") {
          try { MOD._abort.abort(); } catch (_) {}
          MOD._abort = new AbortController();
          __reqUsed = 0;
          __validateUsed = 0;
          const timer = setTimeout(() => { discoverMore(); }, 0);
          MOD._timers.push(timer);
        }
      };
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

  // Lanza discovery sin bloquear el arranque
  try {
    const timer = setTimeout(() => { discoverMore(); }, 0);
    MOD._timers.push(timer);
  } catch (_) {
    discoverMore();
  }
})();
