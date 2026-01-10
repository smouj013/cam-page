/* cams.js — Lista de cámaras (VIDEO ONLY + AUTO-DISCOVERY + CATALOG 4-UP + OPTIONAL NEWS) v2.3.9
   ✅ Integrado para RLC v2.3.9 (Player + Control/Admin + obs-cam-panel.html)
   ✅ VIDEO ONLY: exporta SOLO "youtube" y "hls" (descarta "image")
   ✅ Objetivo: 1200 cams reales por defecto (override: ?camsTarget=500/800/1200/1600...)
   ✅ Auto-discovery MUY ampliado:
      - Invidious /api/v1/search?features=live + tolerancia a instancias que NO devuelven liveNow correctamente
      - Multi-región (rota region)
      - Queries generadas (lugares + categorías + hubs webcam) + pack grande
      - Filtros mejorados (evita “walk/tour/recorded/loop/timelapse”, sin matar “boardwalk”)
      - Validación embed + live-check (best-effort; tolerante a CORS)
   ✅ Cache compacta + fallback si localStorage revienta
   ✅ Mantiene compat total:
      - window.CAM_LIST / CAM_CATALOG_LIST / CAM_NEWS_LIST / CAM_LIST_READY
      - window.RLCCams.* API
      - evento "rlc_cam_list_updated"
      - BroadcastChannel: rlc_bus_v1 y rlc_bus_v1:{key}

   🔥 MEJORAS/ARREGLOS (SIN SUBIR VERSIÓN) — v2.3.9 (MÁS CAMS REALISTAS):
      - Pack de QUERIES MUCHO más grande (hubs + idiomas + landmarks + transport + coastal + weather).
      - Sampling + shuffle estable de seeds para NO repetir siempre los mismos queries (mejor cobertura real).
      - Más hints multi-idioma (webcam/cámara/telecamera/kamera/webkamera/canlı/ao vivo/en directo).
      - Canonicalización HLS más agresiva (quita params volátiles típicos) para reducir duplicados.
      - Cache interna de validaciones (embed/live) para NO revalidar el mismo video 20 veces.
      - Backoff por instancia Invidious que falla (evita martilleo y sube tasa de éxito).
      - FIX REAL: Invidious “features=live” con liveNow mal: aceptamos múltiples señales y dejamos
        que embed/live-check decida.
      - Presupuestos más estables y caps dinámicos (evita arrays/tareas gigantes).
      - Limpieza extra de duplicados + canonicalización HLS.
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  // ─────────────────────────────────────────────────────────────
  // Guard anti doble carga + destroy() (update-safe)
  // ─────────────────────────────────────────────────────────────
  const GUARD_238 = "__RLC_CAMSJS_LOADED_V238_VIDEOONLY_AUTODISCOVERY_CATALOG4_NEWSOPT";
  const GUARD_239 = "__RLC_CAMSJS_LOADED_V239_VIDEOONLY_AUTODISCOVERY_CATALOG4_NEWSOPT";
  const LOAD_GUARD = GUARD_239;

  try { const prev = g[GUARD_238]; if (prev && typeof prev.destroy === "function") prev.destroy(); } catch (_) {}
  try { const prev = g[GUARD_239]; if (prev && typeof prev.destroy === "function") prev.destroy(); } catch (_) {}

  if (!g[LOAD_GUARD]) g[LOAD_GUARD] = {};
  const MOD = g[LOAD_GUARD];

  MOD._timers = MOD._timers || [];
  MOD._abort = MOD._abort || new AbortController();
  MOD._bcs = MOD._bcs || [];
  MOD._msgSig = MOD._msgSig || "";
  MOD._readyResolved = MOD._readyResolved || false;

  // caches internas (sesión) para evitar revalidaciones repetidas
  MOD._embedCache = MOD._embedCache || new Map(); // videoId -> { ok, ts }
  MOD._liveCache  = MOD._liveCache  || new Map(); // videoId -> { ok, ts }
  MOD._instHealth = MOD._instHealth || new Map(); // instance -> { fail, untilTs }

  MOD.destroy = function destroy() {
    try { MOD._timers.forEach((t) => clearTimeout(t)); } catch (_) {}
    MOD._timers = [];
    try { MOD._abort.abort(); } catch (_) {}
    MOD._abort = new AbortController();
    try { (MOD._bcs || []).forEach((c) => { try { c && c.close && c.close(); } catch (_) {} }); } catch (_) {}
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

  // ✅ Objetivo por defecto
  const TARGET_CAMS_DEFAULT = 1200;
  let TARGET_CAMS = Math.max(50, Math.min(2500, parseIntSafe(getParam("camsTarget"), TARGET_CAMS_DEFAULT)));

  const MIN_CATALOG_GOAL = Math.max(50, Math.min(1200, parseIntSafe(getParam("camsMinCatalog"), 500)));

  // Catálogo
  const CATALOG_PAGE_SIZE = 4;

  // Cache: mantenemos legacy y añadimos namespaced
  const CACHE_KEY_LEGACY = "rlc_cam_cache_v1_500";             // compat
  const CACHE_KEY_V238 = `rlc_bus_v1:cams_cache_v1${NS}`;      // nuevo (string estable)
  const CACHE_NEWS_KEY_V238 = `rlc_bus_v1:news_cache_v1${NS}`; // news (string estable)

  // ✅ Cache (12h default)
  const cacheHours = Math.max(0.5, Math.min(72, Number(parseIntSafe(getParam("camsCacheHours"), 12)) || 12));
  const CACHE_MAX_AGE_MS = Math.max(30 * 60 * 1000, Math.min(72 * 60 * 60 * 1000, cacheHours * 60 * 60 * 1000));

  // Auto discovery webcams ON/OFF (override: ?camsDiscovery=0/1)
  let AUTO_DISCOVERY = parseBool(getParam("camsDiscovery"), true);

  // Validación embed (si da problemas en tu hosting: ?camsValidate=0)
  let VALIDATE_EMBED = parseBool(getParam("camsValidate"), true);

  // Presupuesto de validaciones (sube un poco para targets grandes)
  const VALIDATE_BUDGET = Math.max(0, Math.min(9000, parseIntSafe(getParam("camsValidateBudget"), 1200)));
  let __validateUsed = 0;

  // “Solo lives” (best-effort)
  let BEST_EFFORT_LIVE_CHECK = parseBool(getParam("camsLiveCheck"), true);

  // Concurrencia
  const DISCOVERY_MAX_PAGES_PER_QUERY = Math.max(1, Math.min(28, parseIntSafe(getParam("camsPages"), 14)));
  const DISCOVERY_MAX_PER_QUERY = Math.max(50, Math.min(2000, parseIntSafe(getParam("camsMaxPerQuery"), 900)));
  const DISCOVERY_CONCURRENCY = Math.max(1, Math.min(12, parseIntSafe(getParam("camsConc"), 8)));
  const DISCOVERY_MAX_INSTANCES = Math.max(5, Math.min(40, parseIntSafe(getParam("camsInstances"), 26)));

  // Presupuesto global de requests
  const DISCOVERY_REQUEST_BUDGET = Math.max(240, Math.min(16000, parseIntSafe(getParam("camsBudget"), 3200)));

  // Shuffling extra (más variedad) — ?camsQueryShuffle=0/1
  const QUERY_SHUFFLE = parseBool(getParam("camsQueryShuffle"), true);
  const QUERY_CAP = Math.max(200, Math.min(3200, parseIntSafe(getParam("camsQueryCap"), 1400))); // cap para queries (evita sets enormes)

  // Failsafe ALT
  // ✅ Para targets grandes, si no quieres duplicados: ?camsAltFill=0
  let HARD_FAILSAFE_ALT_FILL = parseBool(getParam("camsAltFill"), true);

  // News (OPCIONAL)
  let NEWS_ENABLED = parseBool(getParam("camsNews"), false);
  let NEWS_MIX_IN_MAIN = parseBool(getParam("camsNewsMix"), false);
  let NEWS_IN_CATALOG = parseBool(getParam("camsNewsCatalog"), false);
  let NEWS_DISCOVERY = parseBool(getParam("camsNewsDiscovery"), true);
  let NEWS_TARGET = Math.max(10, Math.min(300, parseIntSafe(getParam("camsNewsTarget"), 60)));

  // “Relajación” automática si no llegamos al mínimo (sin dejar pasar tours/loops)
  const RELAX_PASSES = Math.max(0, Math.min(2, parseIntSafe(getParam("camsRelaxPasses"), 2)));

  // Regiones para discovery (rota)
  const DISCOVERY_REGIONS = [
    "US","GB","CA","ES","FR","DE","IT","NL","SE","NO","PL","PT",
    "BR","AR","MX","CL","CO","PE",
    "JP","KR","TW","HK","SG","TH","VN","PH","ID","IN",
    "AU","NZ",
    "ZA","EG","MA","TR","IL","AE"
  ];

  // ─────────────────────────────────────────────────────────────
  // Queries: generador grande (lugares + categorías + hubs webcam)
  // ─────────────────────────────────────────────────────────────
  const HUB_QUERIES = [
    // hubs/brands
    "earthcam live cam",
    "earthcam live webcam",
    "skylinewebcams live webcam",
    "skylinewebcams live cam",
    "ozolio live webcam",
    "webcam galore live cam",
    "ipcamlive webcam",
    "ip cam live",
    "live cctv camera",
    "live traffic camera",
    "traffic camera live stream",
    "street camera live",
    "downtown live cam",
    "city center live cam",
    "town square live cam",
    "boardwalk live cam",
    "promenade live cam",
    "pier cam live",
    "beach webcam live",
    "harbor webcam live",
    "harbour webcam live",
    "port webcam live",
    "marina live cam",
    "airport webcam live",
    "train station live cam",
    "railcam live",
    "rail cam live",
    "bridge cam live",
    "mountain webcam live",
    "ski cam live",
    "snow cam live",
    "volcano live cam",
    "crater cam live",
    "lake live webcam",
    "river live cam",
    "zoo live webcam",
    "aquarium live cam",
    "wildlife live cam",
    "nest cam live",

    // extra coverage (más “real webcams”)
    "webcam live 24/7",
    "live webcam 24/7",
    "24/7 live webcam",
    "live cam 24/7",
    "ptz webcam live",
    "pan tilt zoom webcam live",
    "4k live webcam",
    "live webcam 4k",
    "live skyline cam",
    "live city cam",
    "live beach cam 24/7",
    "live harbor cam 24/7",
    "live airport cam 24/7",
    "live marina webcam 24/7",
    "live traffic cam 24/7",
    "live street cam 24/7",
    "live square cam 24/7",
    "live port cam 24/7",

    // multi-idioma (sube tasa real)
    "webcam en vivo 24/7",
    "cámara en vivo 24/7",
    "camara en vivo 24/7",
    "webcam en directo 24/7",
    "cámara en directo 24/7",
    "caméra en direct webcam",
    "webcam en direct",
    "telecamera live",
    "telecamera in diretta",
    "webcam in diretta",
    "kamera na żywo",
    "kamera canlı",
    "webcam ao vivo",
    "câmera ao vivo",
    "kamera live webcam",
  ];

  // Seed de lugares (AMPLIADO)
  const PLACE_SEEDS = [
    // USA/CA
    "New York","Times Square","Brooklyn","Manhattan","Las Vegas","Miami","Orlando","Los Angeles","San Francisco","Seattle","Chicago","Boston","Washington DC","Philadelphia","New Orleans","Honolulu","Anchorage",
    "Dallas","Austin","Houston","San Diego","Phoenix","Denver","Portland","Atlanta","Nashville","Detroit","Minneapolis","Salt Lake City","Tampa","Key West","Savannah","Charleston","Baltimore","Pittsburgh",
    "Toronto","Vancouver","Montreal","Niagara Falls","Calgary","Ottawa","Quebec City",

    // LATAM
    "Caracas","Venezuela","Bogotá","Medellín","Cali","Cartagena",
    "Ciudad de México","Cancún","Guadalajara","Monterrey","Tijuana",
    "Buenos Aires","Santiago","Valparaíso","Lima","Cusco","Rio de Janeiro","São Paulo","Copacabana","Salvador","Fortaleza",
    "Montevideo","Asunción","La Paz","Santa Cruz","Quito","Guayaquil","Panama City","San José Costa Rica","Havana",

    // Europa (mucho más)
    "Madrid","Barcelona","Valencia","Sevilla","Málaga","Bilbao","Granada","Córdoba","Zaragoza","Alicante","San Sebastián","Palma","Ibiza","Tenerife","Gran Canaria","Mallorca",
    "Lisbon","Porto","Braga","Faro",
    "London","Westminster","Big Ben","Tower Bridge","Edinburgh","Glasgow","Dublin",
    "Paris","Eiffel Tower","Montmartre","Nice","Cannes","Marseille","Lyon","Bordeaux",
    "Rome","Vatican","Colosseum","Venice","Milan","Naples","Florence","Bologna","Turin",
    "Zurich","Geneva","Lucerne",
    "Amsterdam","Rotterdam","The Hague","Utrecht",
    "Prague","Vienna","Budapest","Bratislava",
    "Berlin","Munich","Hamburg","Cologne","Frankfurt","Dresden",
    "Copenhagen","Stockholm","Oslo","Bergen","Reykjavík","Helsinki",
    "Warsaw","Krakow","Gdansk","Wroclaw",
    "Brussels","Antwerp",
    "Athens","Santorini","Mykonos","Crete",
    "Istanbul","Ankara","Izmir",
    "Sofia","Bucharest","Belgrade","Zagreb","Ljubljana",
    "Kyiv","Odessa",

    // Asia/Oceanía
    "Tokyo","Shibuya","Shinjuku","Osaka","Kyoto","Sapporo","Fukuoka",
    "Seoul","Busan",
    "Singapore","Hong Kong","Taipei","Bangkok","Phuket","Chiang Mai","Hanoi","Ho Chi Minh City","Da Nang",
    "Kuala Lumpur","Jakarta","Bali","Manila",
    "Dubai","Abu Dhabi","Doha","Jerusalem","Tel Aviv",
    "Sydney","Melbourne","Brisbane","Perth","Auckland","Wellington",

    // África
    "Cape Town","Johannesburg","Durban",
    "Marrakesh","Casablanca","Rabat","Tanger",
    "Cairo","Alexandria",
    "Nairobi","Lagos"
  ];

  const PLACE_SUFFIXES = [
    // en
    "live webcam",
    "webcam live",
    "live cam",
    "cctv live",
    "street cam live",
    "street camera live",
    "downtown live cam",
    "beach webcam live",
    "harbor webcam live",
    "harbour webcam live",
    "airport webcam live",
    "traffic camera live",
    "port webcam live",
    "marina live cam",
    "town square live cam",
    "boardwalk live cam",
    "train station live cam",
    "railcam live",
    "bridge webcam live",
    "city webcam live",
    "live skyline cam",
    "ptz live cam",

    // es
    "webcam en vivo",
    "cámara en vivo",
    "camara en vivo",
    "webcam en directo",
    "cámara en directo",
    "en directo webcam",
    "camara en directo",
    "cámara tráfico en vivo",
    "camara trafico en vivo",
    "playa webcam en vivo",
    "puerto webcam en vivo",

    // fr/it/pt/pl/tr
    "caméra en direct",
    "webcam en direct",
    "telecamera live",
    "telecamera in diretta",
    "webcam in diretta",
    "webcam ao vivo",
    "câmera ao vivo",
    "kamera na żywo",
    "webkamera canlı"
  ];

  function stableRandSeed() {
    // estable por día (reduce repetición, sin “random loco”)
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
      // xorshift32
      x ^= x << 13; x >>>= 0;
      x ^= x >> 17; x >>>= 0;
      x ^= x << 5;  x >>>= 0;
      const j = (x % (i + 1)) >>> 0;
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function buildDiscoveryQueries(target) {
    const set = new Set();

    // hubs siempre
    for (let i = 0; i < HUB_QUERIES.length; i++) set.add(HUB_QUERIES[i]);

    // más target => más combinaciones
    const placeCap = Math.max(40, Math.min(PLACE_SEEDS.length, (target >= 1800 ? 160 : target >= 1400 ? 130 : target >= 1000 ? 110 : 90)));
    const suffixCap = Math.max(12, Math.min(PLACE_SUFFIXES.length, (target >= 1800 ? 28 : target >= 1400 ? 24 : target >= 1000 ? 20 : 18)));

    // sampling + shuffle estable
    const seed = stableRandSeed();
    const places = PLACE_SEEDS.slice(0, placeCap);
    const suffixes = PLACE_SUFFIXES.slice(0, suffixCap);
    if (QUERY_SHUFFLE) {
      seededShuffle(places, seed ^ 0xA5A5A5A5);
      seededShuffle(suffixes, seed ^ 0x5A5A5A5A);
    }

    for (let i = 0; i < places.length; i++) {
      const p = places[i];
      for (let j = 0; j < suffixes.length; j++) {
        set.add(`${p} ${suffixes[j]}`);
        if (target >= 1400 && j % 3 === 0) set.add(`${suffixes[j]} ${p}`);
      }
      if (i % 4 === 0) set.add(`${p} live cam 24/7`);
      if (i % 7 === 0) set.add(`${p} traffic camera live`);
      if (i % 9 === 0) set.add(`${p} harbor webcam live`);
      if (i % 11 === 0) set.add(`${p} airport webcam live`);
    }

    // queries “genéricas” para encontrar webcams reales
    const extras = [
      "live webcam",
      "webcam live",
      "live cam",
      "cctv camera live",
      "live traffic camera",
      "live street camera",
      "live harbor cam",
      "live beach cam",
      "live pier cam",
      "live marina cam",
      "live airport cam",
      "live train station cam",
      "live railcam",
      "live ski cam",
      "live mountain cam",
      "live volcano cam",
      "24/7 live webcam",
      "webcam 24/7 live",
      "city webcam live",
      "downtown webcam live",
      "bridge webcam live",
      "ptz webcam live",
      "pan tilt zoom webcam live",

      // multi-idioma
      "webcam en vivo",
      "cámara en vivo",
      "camara en vivo",
      "webcam en directo",
      "cámara en directo",
      "camara en directo",
      "caméra en direct",
      "webcam en direct",
      "telecamera in diretta",
      "webcam in diretta",
      "webcam ao vivo",
      "câmera ao vivo",
      "kamera na żywo",
      "webkamera canlı",
    ];
    for (let i = 0; i < extras.length; i++) set.add(extras[i]);

    const out = Array.from(set);
    if (QUERY_SHUFFLE) seededShuffle(out, stableRandSeed() ^ 0xC0FFEE);
    return out.slice(0, Math.max(60, Math.min(QUERY_CAP, out.length)));
  }

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
  // Filtros: regex (más fino) para NO matar “boardwalk”, etc.
  // ─────────────────────────────────────────────────────────────
  function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  // Bloqueos por palabra (con boundaries) y por frases
  const BLOCK_WORDS_BOUNDARY = [
    "lofi","lo-fi","radio","music","música","mix","playlist","beats",
    "podcast","audiobook","audiolibro",
    "gameplay","gaming","walkthrough","speedrun",
    "sermon","church","iglesia","prayer","oración",
    "crypto","trading","forex",
    "tour","travel","travelling","viaje","paseo","recorrido",
    "recorded","replay","rerun","repeat","loop","timelapse","time-lapse","ambience","ambient","study","sleep","relax","asmr",
    "dashcam","driving","ride","vlog","vlogger",
    // NOTICIAS (bloqueadas en modo webcam)
    "news","noticias","cnn","bbc","aljazeera","fox","euronews","france","dw","sky"
  ];

  const BLOCK_PHRASES = [
    "walking tour",
    "city walk",
    "virtual walk",
    "4k walk",
    "time lapse",
    "behind the scenes",
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
    "earthtv","earth tv","ip cam","ipcamlive","ipcam",
    "webcam galore","live from","city of","airport","harbor","harbour","port authority"
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

      // 🔥 Quita params volátiles típicos en HLS/CDN (reduce duplicados)
      const kill = [
        "token","sig","signature","expires","exp","e","hdnts","session","sess","auth","jwt","key","acl",
        "Policy","Signature","Key-Pair-Id",
        "X-Amz-Algorithm","X-Amz-Credential","X-Amz-Date","X-Amz-Expires","X-Amz-SignedHeaders","X-Amz-Signature",
        "wmsAuthSign","st","t","ts"
      ];
      for (let i = 0; i < kill.length; i++) x.searchParams.delete(kill[i]);

      // limpia tracking
      x.searchParams.delete("utm_source");
      x.searchParams.delete("utm_medium");
      x.searchParams.delete("utm_campaign");
      x.searchParams.delete("utm_term");
      x.searchParams.delete("utm_content");

      return x.toString();
    } catch (_) {
      return s;
    }
  }

  function includesAny(hay, list) {
    for (let i = 0; i < list.length; i++) {
      if (hay.includes(list[i])) return true;
    }
    return false;
  }

  function matchesAnyRegex(hay, regs) {
    for (let i = 0; i < regs.length; i++) {
      if (regs[i].test(hay)) return true;
    }
    return false;
  }

  function camTitleOk(title, author) {
    const t = safeStr(title).toLowerCase();
    const a = safeStr(author).toLowerCase();
    const full = (t + " " + a).trim();
    if (!full) return false;

    if (matchesAnyRegex(full, BLOCK_RE)) return false;

    // marcas/hubs conocidos
    if (includesAny(full, KNOWN_WEBCAM_BRANDS)) return true;

    // Hints típicos
    if (includesAny(full, ALLOW_HINTS)) return true;

    // último fallback: si tiene “live” + “cam/webcam/cctv”
    const hasLive = /\blive\b/i.test(full) || /\ben vivo\b/i.test(full) || /\ben directo\b/i.test(full) || /\bin diretta\b/i.test(full) || /\ben direct\b/i.test(full) || /\bao vivo\b/i.test(full) || /\bcanlı\b/i.test(full);
    const hasCam = /\b(web\s?cam|webcam|cam|cctv|camera)\b/i.test(full) || /\b(cámara|camara|telecamera|kamera|webkamera|câmera|caméra)\b/i.test(full);
    return !!(hasLive && hasCam);
  }

  // Un pelín más flexible, pero SIN permitir tours/loops/etc. (seguimos usando BLOCK_RE)
  function camTitleOkRelaxed(title, author) {
    const t = safeStr(title).toLowerCase();
    const a = safeStr(author).toLowerCase();
    const full = (t + " " + a).trim();
    if (!full) return false;
    if (matchesAnyRegex(full, BLOCK_RE)) return false;

    if (includesAny(full, KNOWN_WEBCAM_BRANDS)) return true;

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
    const hasScene = includesAny(full, sceneHints) || includesAny(full, ALLOW_HINTS);
    return !!hasScene;
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
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  // ─────────────────────────────────────────────────────────────
  // 1) LISTA BRUTA (tus existentes + seeds)
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

    // ❗️VIDEO ONLY: X broadcasts NO son youtube/hls → la deshabilitamos para no romper filtros
    //    (si quieres, conviértela a HLS real o a YouTube Live)
    {
      id: "caracas_venezuela_x",
      title: "Caracas — Live (X Broadcast)",
      place: "Caracas, Venezuela",
      source: "X",
      kind: "x",
      originUrl: "https://x.com/i/broadcasts/1nAKEEAReXyKL",
      tags: ["venezuela","caracas"],
      disabled: true
    },

    // ✅ USA — CASA BLANCA
    {
      id: "us_white_house_earthtv",
      title: "White House — Live Cam",
      place: "Washington, D.C., USA",
      source: "earthTV (YouTube Live)",
      kind: "youtube",
      youtubeId: "Fu8vYoIkaeM",
      originUrl: "https://www.youtube.com/watch?v=Fu8vYoIkaeM",
      tags: ["usa","washington","white_house","landmark"]
    },

    // (VIDEO ONLY) — entradas image se ignoran en export
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

    // ──────────────── NUEVAS (las que ya tenías) ───────────
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

  // NEWS seeds (solo si activas camsNews=1).
  const NEWS_RAW = [
    { id:"news_aljazeera_en_live", title:"Al Jazeera English — LIVE", place:"Global", source:"Al Jazeera", kind:"youtube", youtubeId:"5OqgJjGzxP8", originUrl:"https://www.youtube.com/watch?v=5OqgJjGzxP8", tags:["news","global","en","live","24-7"] },
    { id:"news_skynews_uk_live", title:"Sky News — LIVE", place:"United Kingdom", source:"Sky News", kind:"youtube", youtubeId:"YDvsBbKfLPA", originUrl:"https://www.youtube.com/watch?v=YDvsBbKfLPA", tags:["news","uk","en","live","24-7"] },
    { id:"news_abcnews_live_247", title:"ABC News Live — 24/7", place:"USA", source:"ABC News", kind:"youtube", youtubeId:"gN0PZCe-kwQ", originUrl:"https://www.youtube.com/watch?v=gN0PZCe-kwQ", tags:["news","usa","en","live","24-7"] },
    { id:"news_cbsnews_live", title:"CBS News — LIVE", place:"USA", source:"CBS News", kind:"youtube", youtubeId:"GetNifJJeso", originUrl:"https://www.youtube.com/watch?v=GetNifJJeso", tags:["news","usa","en","live"] },
    { id:"news_euronews_fr_live", title:"Euronews Français — LIVE", place:"Europe", source:"Euronews", kind:"youtube", youtubeId:"yhua7wNf4hg", originUrl:"https://www.youtube.com/watch?v=yhua7wNf4hg", tags:["news","europe","fr","live"] },

    // HLS (muy estable)
    { id:"news_france24_en_hls", title:"FRANCE 24 English — LIVE (HLS)", place:"Global", source:"France 24", kind:"hls", url:"https://static.france24.com/live/F24_EN_HI_HLS/live_web.m3u8", originUrl:"https://static.france24.com/live/F24_EN_HI_HLS/live_web.m3u8", tags:["news","global","en","live","hls"] },
    { id:"news_france24_es_hls", title:"FRANCE 24 Español — LIVE (HLS)", place:"Global", source:"France 24", kind:"hls", url:"https://static.france24.com/live/F24_ES_HI_HLS/live_web.m3u8", originUrl:"https://static.france24.com/live/F24_ES_HI_HLS/live_web.m3u8", tags:["news","global","es","live","hls"] },
    { id:"news_france24_fr_hls", title:"FRANCE 24 Français — LIVE (HLS)", place:"Global", source:"France 24", kind:"hls", url:"https://static.france24.com/live/F24_FR_HI_HLS/live_web.m3u8", originUrl:"https://static.france24.com/live/F24_FR_HI_HLS/live_web.m3u8", tags:["news","global","fr","live","hls"] },
    { id:"news_france24_ar_hls", title:"FRANCE 24 العربية — LIVE (HLS)", place:"Global", source:"France 24", kind:"hls", url:"https://static.france24.com/live/F24_AR_HI_HLS/live_web.m3u8", originUrl:"https://static.france24.com/live/F24_AR_HI_HLS/live_web.m3u8", tags:["news","global","ar","live","hls"] },
  ];

  // ─────────────────────────────────────────────────────────────
  // 2) SANITIZAR + EXPORTAR (VIDEO ONLY)
  // ─────────────────────────────────────────────────────────────
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
    seenIds.add(cam.id);

    if (cam.kind === "youtube" && cam.youtubeId) {
      seenYouTube.add(cam.youtubeId);
    } else if (cam.kind === "hls" && cam.url) {
      seenHlsUrl.add(canonicalUrl(cam.url));
    }

    OUT.push(cam);
    if (!cam.isAlt) OUT_CATALOG.push(cam);
    return true;
  }

  function pushNews(cam) {
    if (!cam || !cam.id || NEWS_SEEN_IDS.has(cam.id)) return false;
    NEWS_SEEN_IDS.add(cam.id);

    if (cam.kind === "youtube" && cam.youtubeId) {
      NEWS_SEEN_YT.add(cam.youtubeId);
    } else if (cam.kind === "hls" && cam.url) {
      NEWS_SEEN_HLS.add(canonicalUrl(cam.url));
    }

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
      } else if (looksLikeM3U8(cam.url) || looksLikeM3U8(cam.originUrl)) {
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
      // HLS: permitir si es m3u8 (algunas webcams no dicen "webcam")
      if (!(kind === "hls" && (looksLikeM3U8(cam.url) || looksLikeM3U8(cam.originUrl)))) continue;
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
      if (typeof cam.maxSeconds === "number" && cam.maxSeconds > 0) base.maxSeconds = Math.trunc(cam.maxSeconds);

      pushCam(base);
      continue;
    }

    if (kind === "hls") {
      const url = safeStr(cam.url) || safeStr(cam.originUrl);
      if (!url || !looksLikeM3U8(url)) continue;

      const canon = canonicalUrl(url);
      if (seenHlsUrl.has(canon)) continue;

      base.url = url;
      base.originUrl = safeStr(cam.originUrl) || url;
      if (typeof cam.maxSeconds === "number" && cam.maxSeconds > 0) base.maxSeconds = Math.trunc(cam.maxSeconds);

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

      if (!newsTitleOk(cam.title, cam.source)) continue;

      if (kind === "youtube") {
        const yid = safeStr(cam.youtubeId);
        if (!isValidYouTubeId(yid)) continue;

        const id = safeStr(cam.id) || `news_${yid}`;
        if (NEWS_SEEN_IDS.has(id)) continue;
        if (NEWS_SEEN_YT.has(yid)) continue;

        pushNews({
          id,
          title: safeStr(cam.title) || "News Live",
          place: safeStr(cam.place) || "",
          source: safeStr(cam.source) || "YouTube Live",
          kind: "youtube",
          youtubeId: yid,
          originUrl: safeStr(cam.originUrl) || `https://www.youtube.com/watch?v=${encodeURIComponent(yid)}`,
          thumb: youtubeThumb(yid),
          tags: Array.isArray(cam.tags) ? cam.tags.slice(0, 12) : ["news"],
          isAlt: false
        });
        continue;
      }

      if (kind === "hls") {
        const url = safeStr(cam.url) || safeStr(cam.originUrl);
        if (!url || !looksLikeM3U8(url)) continue;

        const canon = canonicalUrl(url);
        const id = safeStr(cam.id) || `news_hls_${Math.floor(Math.random() * 1e9)}`;
        if (NEWS_SEEN_IDS.has(id)) continue;
        if (NEWS_SEEN_HLS.has(canon)) continue;

        pushNews({
          id,
          title: safeStr(cam.title) || "News Live (HLS)",
          place: safeStr(cam.place) || "",
          source: safeStr(cam.source) || "HLS",
          kind: "hls",
          url,
          originUrl: safeStr(cam.originUrl) || url,
          tags: Array.isArray(cam.tags) ? cam.tags.slice(0, 12) : ["news","hls"],
          isAlt: false
        });
        continue;
      }
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

  // ✅ Cache robusta: si setItem falla por tamaño, reduce y reintenta
  function saveCache(keyMain, listNonAlt, limit, alsoLegacy) {
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
        if (alsoLegacy) {
          localStorage.setItem(CACHE_KEY_LEGACY, JSON.stringify({ ts: payload.ts, list: payload.list }));
        }
        return;
      } catch (_) {
        lim = Math.max(120, Math.floor(lim * 0.62));
      }
    }
  }

  // Cache webcams
  const cached = loadCacheAny([CACHE_KEY_V238, CACHE_KEY_LEGACY], (c) => camTitleOk(c.title, c.source));
  if (cached && cached.length >= Math.min(180, TARGET_CAMS)) {
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
      } else if (kind === "hls") {
        const url = safeStr(c.url) || safeStr(c.originUrl);
        if (!url || !looksLikeM3U8(url)) continue;
        const canon = canonicalUrl(url);
        if (seenHlsUrl.has(canon)) continue;
        c.url = url;
        if (!c.originUrl) c.originUrl = url;
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
        if (!ALLOWED_KINDS.has(kind)) continue;

        const id = safeStr(c.id);
        if (!id || NEWS_SEEN_IDS.has(id)) continue;

        if (!newsTitleOk(c.title, c.source)) continue;

        if (kind === "youtube") {
          const yid = safeStr(c.youtubeId);
          if (!isValidYouTubeId(yid) || NEWS_SEEN_YT.has(yid)) continue;
        } else if (kind === "hls") {
          const url = safeStr(c.url) || safeStr(c.originUrl);
          if (!url || !looksLikeM3U8(url)) continue;
          const canon = canonicalUrl(url);
          if (NEWS_SEEN_HLS.has(canon)) continue;
          c.url = url;
          if (!c.originUrl) c.originUrl = url;
        }

        pushNews(c);
        if (OUT_NEWS_CATALOG.length >= NEWS_TARGET) break;
      }
    }
  }

  // Export inmediato
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
    const nn = Math.max(50, Math.min(2500, (Math.trunc(Number(n)) || TARGET_CAMS_DEFAULT)));
    TARGET_CAMS = nn;
    emitUpdate();
    return TARGET_CAMS;
  };
  g.RLCCams.setAutoDiscovery = (v) => { AUTO_DISCOVERY = !!v; emitUpdate(); return AUTO_DISCOVERY; };
  g.RLCCams.setValidateEmbed = (v) => { VALIDATE_EMBED = !!v; emitUpdate(); return VALIDATE_EMBED; };
  g.RLCCams.clearCache = () => {
    try { localStorage.removeItem(CACHE_KEY_V238); } catch (_) {}
    try { localStorage.removeItem(CACHE_NEWS_KEY_V238); } catch (_) {}
    try { if (!NS) localStorage.removeItem(CACHE_KEY_LEGACY); } catch (_) {}
    emitUpdate();
  };

  // News API (opcional)
  g.RLCCams.getNewsList = () => Array.isArray(g.CAM_NEWS_LIST) ? g.CAM_NEWS_LIST : [];
  g.RLCCams.getNewsCatalogList = () => Array.isArray(OUT_NEWS_CATALOG) ? OUT_NEWS_CATALOG : [];
  g.RLCCams.setNewsEnabled = (v) => { NEWS_ENABLED = !!v; emitUpdate(); return NEWS_ENABLED; };
  g.RLCCams.setNewsMix = (v) => { NEWS_MIX_IN_MAIN = !!v; emitUpdate(); return NEWS_MIX_IN_MAIN; };
  g.RLCCams.setNewsInCatalog = (v) => { NEWS_IN_CATALOG = !!v; emitUpdate(); return NEWS_IN_CATALOG; };
  g.RLCCams.setNewsTarget = (n) => { NEWS_TARGET = Math.max(10, Math.min(300, (Math.trunc(Number(n)) || 60))); emitUpdate(); return NEWS_TARGET; };

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
    if (s.includes("sign in to confirm your age")) return true;
    if (s.includes("forbidden")) return true;

    // playability status patterns (best-effort)
    if (s.includes("\"playabilitystatus\"") && (s.includes("unplayable") || s.includes("login_required") || s.includes("age_verification_required"))) return true;
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

  // caches internos (sesión)
  const VALIDATION_CACHE_TTL_MS = Math.max(10 * 60 * 1000, Math.min(6 * 60 * 60 * 1000, parseIntSafe(getParam("camsValidationCacheMs"), 2 * 60 * 60 * 1000)));
  function cacheGet(map, key) {
    try {
      const it = map.get(key);
      if (!it) return null;
      if ((Date.now() - it.ts) > VALIDATION_CACHE_TTL_MS) { map.delete(key); return null; }
      return it.ok === true;
    } catch (_) { return null; }
  }
  function cacheSet(map, key, ok) {
    try { map.set(key, { ok: !!ok, ts: Date.now() }); } catch (_) {}
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

      // Señales típicas de live
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

      // si no hay señal clara, no bloqueamos (best-effort)
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

    // si VALIDATE_EMBED off, hacemos solo live-check (barato)
    if (!VALIDATE_EMBED) {
      const ok = await isReallyLiveYouTube(videoId, signal);
      cacheSet(MOD._embedCache, videoId, ok);
      return ok;
    }

    if (!validateBudgetOk()) return true;
    __validateUsed++;

    // 1) oEmbed (rápido)
    try {
      const o = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent("https://www.youtube.com/watch?v=" + videoId)}`;
      const r = await fetchWithTimeout(o, { method: "GET", cache: "no-store", signal }, 8000);
      if (r && r.ok) {
        // ok
      } else if (r && r.status === 404) {
        cacheSet(MOD._embedCache, videoId, false);
        return false;
      } else {
        // 401/403/rate-limit: no lo matamos aquí
      }
    } catch (_) {}

    // 2) embed HTML (best-effort)
    try {
      const html = await fetchTextSmart(`https://www.youtube.com/embed/${videoId}`, 10000, signal);
      if (html && textLikelyBlockedEmbed(html)) { cacheSet(MOD._embedCache, videoId, false); return false; }
    } catch (_) {}

    // 3) live check (best-effort)
    const liveOk = await isReallyLiveYouTube(videoId, signal);
    if (!liveOk) { cacheSet(MOD._embedCache, videoId, false); return false; }

    cacheSet(MOD._embedCache, videoId, true);
    return true;
  }

  function toAutoCam(entry, relaxed) {
    const vid = safeStr(entry && (entry.videoId || entry.video_id));
    if (!isValidYouTubeId(vid)) return null;

    const title = safeStr(entry.title) || "Live Cam";
    const author = safeStr(entry.author);

    // filtro webcam
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

  // ✅ FIX CLAVE: detectar “live” en resultados Invidious aunque liveNow venga mal
  function isLiveResult(r) {
    if (!r || typeof r !== "object") return false;

    const title = safeStr(r.title).toLowerCase();
    const author = safeStr(r.author).toLowerCase();
    const full = (title + " " + author).trim();
    if (!full) return false;

    // excluye “upcoming/premiere”
    if (r.isUpcoming === true || r.upcoming === true || r.premiere === true) return false;
    if (textLooksNotLive(title)) return false;

    // shorts (a veces cuelan)
    if (r.isShort === true || r.is_short === true) return false;

    // flags comunes
    const flags = [
      r.liveNow, r.live_now,
      r.isLive, r.is_live,
      r.live, r.isLiveContent, r.is_live_content,
      r.liveNowText, r.live_text
    ];
    for (let i = 0; i < flags.length; i++) {
      if (flags[i] === true) return true;
      const s = safeStr(flags[i]).toLowerCase();
      if (s && s.includes("live")) return true;
    }

    // badges
    const badges = r.badges || r.badge || r.badgeText || r.badge_text;
    if (Array.isArray(badges)) {
      for (let i = 0; i < badges.length; i++) {
        const b = safeStr(badges[i]).toLowerCase();
        if (b.includes("live")) return true;
      }
    } else {
      const b = safeStr(badges).toLowerCase();
      if (b.includes("live")) return true;
    }

    // lengthSeconds 0 (típico en live)
    const ls = (r.lengthSeconds != null) ? Number(r.lengthSeconds) : (r.length_seconds != null ? Number(r.length_seconds) : NaN);
    if (Number.isFinite(ls) && ls === 0) return true;

    // features=live: si no hay señal clara, NO descartamos: validación decide.
    return true;
  }

  // Instancias Invidious
  async function getInvidiousInstances(signal) {
    const fallback = [
      "https://inv.nadeko.net",
      "https://yewtu.be",
      "https://invidious.f5.si",
      "https://invidious.nerdvpn.de",
      "https://inv.perditum.com",
      "https://invidious.tiekoetter.com",
      "https://vid.puffyan.us"
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

  function instIsInBackoff(instance) {
    const it = MOD._instHealth.get(instance);
    if (!it) return false;
    return (Date.now() < it.untilTs);
  }
  function instFail(instance) {
    try {
      const it = MOD._instHealth.get(instance) || { fail: 0, untilTs: 0 };
      it.fail = Math.min(50, (it.fail || 0) + 1);
      // backoff progresivo: 10s, 20s, 40s... cap 5min
      const backoff = Math.min(5 * 60 * 1000, 10000 * Math.pow(2, Math.min(5, it.fail - 1)));
      it.untilTs = Date.now() + backoff;
      MOD._instHealth.set(instance, it);
    } catch (_) {}
  }
  function instOk(instance) {
    try {
      const it = MOD._instHealth.get(instance);
      if (!it) return;
      // si va bien, bajamos fallos gradualmente
      it.fail = Math.max(0, (it.fail || 0) - 1);
      it.untilTs = 0;
      MOD._instHealth.set(instance, it);
    } catch (_) {}
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

  function capTasks(tasks) {
    // cap dinámico: margen sin petar memoria.
    const max = Math.max(400, Math.min(52000, Math.floor(DISCOVERY_REQUEST_BUDGET * 4)));
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

    const queries = buildDiscoveryQueries(TARGET_CAMS);

    // 1ª pasada: relevance. 2ª: views/date para encontrar más directos.
    const sorts = relaxed ? ["views", "date", "relevance"] : ["relevance"];
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
          if (foundForQuery[key] >= DISCOVERY_MAX_PER_QUERY) { await sleep(12); continue; }

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
          await sleep(relaxed ? 38 : 55);
        }
      }
    }

    const workers = [];
    const n = Math.max(1, Math.min(DISCOVERY_CONCURRENCY, 12));
    for (let i = 0; i < n; i++) workers.push(worker());
    await Promise.all(workers);

    for (let i = 0; i < candidates.length && OUT_CATALOG.length < TARGET_CAMS; i++) {
      const c = candidates[i];
      if (!c) continue;
      if (seenIds.has(c.id)) continue;
      if (seenYouTube.has(c.youtubeId)) continue;
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
      for (let p = 1; p <= Math.max(2, Math.min(12, DISCOVERY_MAX_PAGES_PER_QUERY)); p++) {
        const inst = instances[instCursor++ % instances.length];
        const region = DISCOVERY_REGIONS[(qi + p) % DISCOVERY_REGIONS.length];
        tasks.push({ q, p, inst, region, sort: "relevance" });
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
          if (foundForQuery[key] >= Math.max(60, Math.min(900, DISCOVERY_MAX_PER_QUERY))) { await sleep(12); continue; }

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
            foundForQuery[key]++;

            if ((OUT_NEWS_CATALOG.length + candidates.length) >= NEWS_TARGET) break;
          }
        } catch (_) {
          // silencio
        } finally {
          await sleep(60);
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
      if (NEWS_SEEN_IDS.has(c.id)) continue;
      if (NEWS_SEEN_YT.has(c.youtubeId)) continue;
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

  async function discoverMore() {
    const signal = MOD._abort.signal;

    try {
      if (!AUTO_DISCOVERY && !NEWS_ENABLED) {
        saveCache(CACHE_KEY_V238, OUT_CATALOG, TARGET_CAMS, (!NS));
        emitUpdate();
        if (__resolveReady && !MOD._readyResolved) { MOD._readyResolved = true; __resolveReady(g.CAM_LIST); }
        return;
      }

      const instancesRaw = await getInvidiousInstances(signal);
      const instances = shuffleInPlace(instancesRaw.slice(0, Math.max(5, DISCOVERY_MAX_INSTANCES)));

      // PASADA 0: strict
      if (AUTO_DISCOVERY && OUT_CATALOG.length < TARGET_CAMS) {
        await runDiscoveryWebcams(instances, signal, 0);
      }

      // PASADAS extra: si no llegamos al mínimo (ej. 500), relaja y cambia sort
      for (let pass = 1; pass <= RELAX_PASSES; pass++) {
        if (!AUTO_DISCOVERY) break;
        if (OUT_CATALOG.length >= TARGET_CAMS) break;
        if (OUT_CATALOG.length >= MIN_CATALOG_GOAL) break;
        if (!budgetOk()) break;
        await runDiscoveryWebcams(instances, signal, pass);
      }

      if (NEWS_ENABLED && OUT_NEWS_CATALOG.length < NEWS_TARGET) {
        await runDiscoveryNews(instances, signal);
      }

      applyNewsMixing();

      // ALT fill: solo para LISTA total, NO para catálogo (catálogo requiere reales)
      if (HARD_FAILSAFE_ALT_FILL && OUT.length > 0 && OUT.length < TARGET_CAMS) {
        const baseLen = OUT.length;
        let k = 0;
        while (OUT.length < TARGET_CAMS && k < 90000) {
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

      saveCache(CACHE_KEY_V238, OUT_CATALOG, TARGET_CAMS, (!NS));
      if (NEWS_ENABLED) saveCache(CACHE_NEWS_KEY_V238, OUT_NEWS_CATALOG, NEWS_TARGET, false);

      emitUpdate();
      if (__resolveReady && !MOD._readyResolved) { MOD._readyResolved = true; __resolveReady(g.CAM_LIST); }
    } catch (_) {
      try { saveCache(CACHE_KEY_V238, OUT_CATALOG, TARGET_CAMS, (!NS)); } catch (_) {}
      try { if (NEWS_ENABLED) saveCache(CACHE_NEWS_KEY_V238, OUT_NEWS_CATALOG, NEWS_TARGET, false); } catch (_) {}
      try { emitUpdate(); } catch (_) {}
      try { if (__resolveReady && !MOD._readyResolved) { MOD._readyResolved = true; __resolveReady(g.CAM_LIST); } } catch (_) {}
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

  // Lanza discovery sin bloquear el arranque
  try {
    const timer = setTimeout(() => { discoverMore(); }, 0);
    MOD._timers.push(timer);
  } catch (_) {
    discoverMore();
  }
})();
