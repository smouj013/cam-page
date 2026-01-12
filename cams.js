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

  // Seed de lugares (AMPLIADO CON MÁS)
  const PLACE_SEEDS = [
    // USA/CA
    "New York","Times Square","Brooklyn","Manhattan","Las Vegas","Miami","Orlando","Los Angeles","San Francisco","Seattle","Chicago","Boston","Washington DC","Philadelphia","New Orleans","Honolulu","Anchorage",
    "Dallas","Austin","Houston","San Diego","Phoenix","Denver","Portland","Atlanta","Nashville","Detroit","Minneapolis","Salt Lake City","Tampa","Key West","Savannah","Charleston","Baltimore","Pittsburgh",
    "Toronto","Vancouver","Montreal","Niagara Falls","Calgary","Ottawa","Quebec City","Edmonton","Halifax","Winnipeg",

    // LATAM
    "Caracas","Venezuela","Bogotá","Medellín","Cali","Cartagena",
    "Ciudad de México","Cancún","Guadalajara","Monterrey","Tijuana",
    "Buenos Aires","Santiago","Valparaíso","Lima","Cusco","Rio de Janeiro","São Paulo","Copacabana","Salvador","Fortaleza",
    "Montevideo","Asunción","La Paz","Santa Cruz","Quito","Guayaquil","Panama City","San José Costa Rica","Havana","San Juan Puerto Rico","Santo Domingo",

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
    "Kyiv","Odessa","Moscow","St Petersburg","Minsk","Riga","Tallinn","Vilnius",

    // Asia/Oceanía
    "Tokyo","Shibuya","Shinjuku","Osaka","Kyoto","Sapporo","Fukuoka",
    "Seoul","Busan",
    "Singapore","Hong Kong","Taipei","Bangkok","Phuket","Chiang Mai","Hanoi","Ho Chi Minh City","Da Nang",
    "Kuala Lumpur","Jakarta","Bali","Manila",
    "Dubai","Abu Dhabi","Doha","Jerusalem","Tel Aviv",
    "Sydney","Melbourne","Brisbane","Perth","Auckland","Wellington","Christchurch",

    // África
    "Cape Town","Johannesburg","Durban",
    "Marrakesh","Casablanca","Rabat","Tanger",
    "Cairo","Alexandria",
    "Nairobi","Lagos","Accra","Tunis","Algiers"
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

  // RAW (LIVE-ONLY resolvible) — mínimo 200 cams
  // ✅ Garantía REAL de “EN DIRECTO”: tu resolver debe ejecutar búsqueda con filtro LIVE (features=live)
  //    y descartar cualquier resultado que NO venga como liveNow/isLive.
  //    (Ej: Invidious /api/v1/search?type=video&features=live&q=...)
  // ⚠️ Estos entries NO traen youtubeId fijo a propósito: eso es lo que evita VOD/IDs rotos.

  const RAW = (() => {
    const mk = (id, title, place, q, tags) => ({
      id,
      title,
      place,
      source: "YouTube LIVE (resolver)",
      kind: "youtube_live_search", // <- tu app debe resolver esto a youtubeId real
      query: q,                   // <- búsqueda live-only
      youtubeId: "",              // <- se rellena tras resolver
      originUrl: "",              // <- se rellena tras resolver
      tags
    });

    const S = [
      // ──────────────── ESPAÑA ────────────────
      ["es_madrid_sol","Puerta del Sol — LIVE","Madrid, España","puerta del sol madrid live cam","spain,city,madrid"],
      ["es_madrid_granvia","Gran Vía — LIVE","Madrid, España","gran via madrid live cam","spain,city,madrid"],
      ["es_madrid_plazamayor","Plaza Mayor — LIVE","Madrid, España","plaza mayor madrid live cam","spain,city,madrid"],
      ["es_madrid_a4","Autovía A-4 tráfico — LIVE","Madrid, España","madrid traffic cam live","spain,traffic"],
      ["es_barcelona_rambla","Las Ramblas — LIVE","Barcelona, España","las ramblas barcelona live cam","spain,city,barcelona"],
      ["es_barcelona_sagrada","Sagrada Familia — LIVE","Barcelona, España","sagrada familia live cam","spain,landmark,barcelona"],
      ["es_barcelona_port","Port Vell — LIVE","Barcelona, España","port vell barcelona live cam","spain,port,barcelona"],
      ["es_valencia_playa","Playa — LIVE","Valencia, España","valencia beach live cam","spain,beach"],
      ["es_malaga_puerto","Puerto — LIVE","Málaga, España","malaga port live cam","spain,port"],
      ["es_sevilla_catedral","Centro — LIVE","Sevilla, España","sevilla live cam cathedral","spain,city"],
      ["es_bilbao_ria","Ría — LIVE","Bilbao, España","bilbao live cam","spain,city"],
      ["es_sansebastian_concha","La Concha — LIVE","San Sebastián, España","la concha san sebastian live cam","spain,beach"],
      ["es_canarias_tenerife","Tenerife — LIVE","Canarias, España","tenerife live cam","spain,island,canary"],
      ["es_canarias_gc","Gran Canaria — LIVE","Canarias, España","gran canaria live cam","spain,island,canary"],
      ["es_ibiza_port","Ibiza puerto — LIVE","Ibiza, España","ibiza port live cam","spain,island,port"],

      // ──────────────── PORTUGAL ────────────────
      ["pt_lisboa_praca","Lisboa centro — LIVE","Lisboa, Portugal","lisbon live cam city center","portugal,city"],
      ["pt_lisboa_tejo","Río Tajo — LIVE","Lisboa, Portugal","tagus river lisbon live cam","portugal,river"],
      ["pt_oporto_ribeira","Ribeira — LIVE","Oporto, Portugal","porto ribeira live cam","portugal,city"],
      ["pt_madeira_funchal","Funchal — LIVE","Madeira, Portugal","funchal madeira live cam","portugal,island"],

      // ──────────────── FRANCIA ────────────────
      ["fr_paris_eiffel","Torre Eiffel — LIVE","París, Francia","eiffel tower live cam","france,landmark,paris"],
      ["fr_paris_seine","Río Sena — LIVE","París, Francia","seine paris live cam","france,river,paris"],
      ["fr_nice_promenade","Promenade — LIVE","Niza, Francia","nice promenade des anglais live cam","france,beach"],
      ["fr_marseille_port","Vieux-Port — LIVE","Marsella, Francia","marseille vieux port live cam","france,port"],
      ["fr_chamonix_montblanc","Mont Blanc — LIVE","Chamonix, Francia","mont blanc live cam","france,alps,snow"],

      // ──────────────── ITALIA ────────────────
      ["it_roma_trevi","Fontana di Trevi — LIVE","Roma, Italia","trevi fountain live cam","italy,rome,landmark"],
      ["it_roma_colosseo","Colosseo — LIVE","Roma, Italia","colosseum live cam","italy,rome,landmark"],
      ["it_venezia_canal","Gran Canal — LIVE","Venecia, Italia","venice grand canal live cam","italy,venice,canal"],
      ["it_milano_duomo","Duomo — LIVE","Milán, Italia","milan duomo live cam","italy,city,landmark"],
      ["it_firenze_pontvecchio","Ponte Vecchio — LIVE","Florencia, Italia","ponte vecchio live cam","italy,city,landmark"],
      ["it_napoli_vesuvio","Vesubio — LIVE","Nápoles, Italia","vesuvius live cam","italy,volcano"],
      ["it_sicilia_etna","Etna — LIVE","Sicilia, Italia","etna volcano live cam","italy,volcano"],
      ["it_torino_centro","Centro — LIVE","Turín, Italia","turin live cam city","italy,city"],

      // ──────────────── REINO UNIDO / IRLANDA ────────────────
      ["uk_london_abbeyroad","Abbey Road — LIVE","Londres, Reino Unido","abbey road live cam","uk,london,landmark"],
      ["uk_london_towerbridge","Tower Bridge — LIVE","Londres, Reino Unido","tower bridge live cam","uk,london,landmark"],
      ["uk_london_thames","Río Támesis — LIVE","Londres, Reino Unido","thames london live cam","uk,river,london"],
      ["uk_manchester_city","Centro — LIVE","Manchester, Reino Unido","manchester live cam city centre","uk,city"],
      ["ie_dublin_templebar","Temple Bar — LIVE","Dublín, Irlanda","dublin temple bar live cam","ireland,city"],

      // ──────────────── PAÍSES BAJOS / BÉLGICA ────────────────
      ["nl_amsterdam_dam","Dam Square — LIVE","Ámsterdam, Países Bajos","amsterdam dam square live cam","netherlands,city"],
      ["nl_amsterdam_canal","Canales — LIVE","Ámsterdam, Países Bajos","amsterdam canal live cam","netherlands,canal"],
      ["be_brussels_grandplace","Grand-Place — LIVE","Bruselas, Bélgica","brussels grand place live cam","belgium,city"],

      // ──────────────── SUIZA / AUSTRIA / ALEMANIA ────────────────
      ["ch_zermatt_matterhorn","Matterhorn — LIVE","Zermatt, Suiza","matterhorn live cam","switzerland,alps,snow"],
      ["ch_interlaken_alps","Alpes — LIVE","Interlaken, Suiza","interlaken live cam","switzerland,alps"],
      ["at_vienna_city","Centro — LIVE","Viena, Austria","vienna live cam","austria,city"],
      ["de_berlin_brandenburg","Puerta Brandeburgo — LIVE","Berlín, Alemania","brandenburg gate live cam","germany,berlin,landmark"],
      ["de_hamburg_port","Puerto — LIVE","Hamburgo, Alemania","hamburg port live cam","germany,port"],

      // ──────────────── EUROPA ESTE / NÓRDICOS ────────────────
      ["cz_prague_oldtown","Old Town — LIVE","Praga, Chequia","prague old town live cam","czech,city"],
      ["pl_warsaw_city","Centro — LIVE","Varsovia, Polonia","warsaw live cam","poland,city"],
      ["hu_budapest_danube","Danubio — LIVE","Budapest, Hungría","budapest danube live cam","hungary,river,city"],
      ["se_stockholm_city","Centro — LIVE","Estocolmo, Suecia","stockholm live cam","sweden,city"],
      ["no_oslo_harbor","Puerto — LIVE","Oslo, Noruega","oslo harbor live cam","norway,port"],
      ["fi_helsinki_city","Centro — LIVE","Helsinki, Finlandia","helsinki live cam","finland,city"],
      ["is_reykjavik_city","Centro — LIVE","Reikiavik, Islandia","reykjavik live cam","iceland,city"],
      ["dk_copenhagen_nyhavn","Nyhavn — LIVE","Copenhague, Dinamarca","nyhavn live cam","denmark,port"],

      // ──────────────── GRECIA / TURQUÍA ────────────────
      ["gr_santorini_caldera","Caldera — LIVE","Santorini, Grecia","santorini caldera live cam","greece,island,beach"],
      ["gr_athens_acropolis","Acrópolis — LIVE","Atenas, Grecia","athens acropolis live cam","greece,landmark"],
      ["tr_istanbul_bosphorus","Bósforo — LIVE","Estambul, Turquía","istanbul bosphorus live cam","turkey,river,city"],

      // ──────────────── ORIENTE MEDIO ────────────────
      ["il_jerusalem_oldcity","Old City — LIVE","Jerusalén, Israel","jerusalem live cam old city","israel,landmark,city"],
      ["ae_dubai_marina","Dubai Marina — LIVE","Dubai, EAU","dubai marina live cam","uae,city,port"],
      ["ae_dubai_burj","Burj Khalifa — LIVE","Dubai, EAU","burj khalifa live cam","uae,landmark"],
      ["qa_doha_corniche","Corniche — LIVE","Doha, Catar","doha corniche live cam","qatar,city"],

      // ──────────────── ASIA (JAPÓN / COREA / CHINA) ────────────────
      ["jp_tokyo_shibuya","Shibuya Crossing — LIVE","Tokyo, Japón","shibuya crossing live cam","japan,city,street"],
      ["jp_tokyo_skytree","Skytree — LIVE","Tokyo, Japón","tokyo skytree live cam","japan,landmark"],
      ["jp_osaka_dotonbori","Dotonbori — LIVE","Osaka, Japón","dotonbori live cam","japan,street"],
      ["jp_kyoto_city","Centro — LIVE","Kyoto, Japón","kyoto live cam","japan,city"],
      ["kr_seoul_city","Centro — LIVE","Seúl, Corea del Sur","seoul live cam","korea,city"],
      ["kr_seoul_gangnam","Gangnam — LIVE","Seúl, Corea del Sur","gangnam live cam","korea,street"],
      ["cn_beijing_city","Centro — LIVE","Beijing, China","beijing live cam","china,city"],
      ["cn_shanghai_bund","The Bund — LIVE","Shanghai, China","shanghai bund live cam","china,city,river"],
      ["hk_hongkong_harbor","Victoria Harbour — LIVE","Hong Kong","victoria harbour live cam","hongkong,port,city"],

      // ──────────────── SUDESTE ASIÁTICO ────────────────
      ["th_bangkok_city","Centro — LIVE","Bangkok, Tailandia","bangkok live cam","thailand,city"],
      ["th_phuket_beach","Playa — LIVE","Phuket, Tailandia","phuket live cam beach","thailand,beach"],
      ["vn_hanoi_city","Centro — LIVE","Hanoi, Vietnam","hanoi live cam","vietnam,city"],
      ["vn_hcm_city","Centro — LIVE","Ho Chi Minh, Vietnam","ho chi minh city live cam","vietnam,city"],
      ["sg_singapore_marina","Marina Bay — LIVE","Singapur","marina bay singapore live cam","singapore,city,landmark"],
      ["id_bali_beach","Bali — LIVE","Bali, Indonesia","bali live cam beach","indonesia,island,beach"],
      ["ph_manila_city","Centro — LIVE","Manila, Filipinas","manila live cam","philippines,city"],

      // ──────────────── INDIA / NEPAL / SRI LANKA ────────────────
      ["in_delhi_city","Centro — LIVE","Delhi, India","delhi live cam","india,city"],
      ["in_mumbai_city","Centro — LIVE","Mumbai, India","mumbai live cam","india,city"],
      ["in_goa_beach","Goa — LIVE","Goa, India","goa beach live cam","india,beach"],
      ["np_kathmandu_city","Centro — LIVE","Kathmandu, Nepal","kathmandu live cam","nepal,city"],
      ["lk_colombo_city","Centro — LIVE","Colombo, Sri Lanka","colombo live cam","srilanka,city"],

      // ──────────────── OCEANÍA ────────────────
      ["au_sydney_harbour","Sydney Harbour — LIVE","Sydney, Australia","sydney harbour live cam","australia,port,city"],
      ["au_sydney_opera","Opera House — LIVE","Sydney, Australia","sydney opera house live cam","australia,landmark"],
      ["au_melbourne_city","Centro — LIVE","Melbourne, Australia","melbourne live cam","australia,city"],
      ["au_goldcoast_beach","Gold Coast — LIVE","Gold Coast, Australia","gold coast live cam beach","australia,beach"],
      ["nz_auckland_harbor","Auckland — LIVE","Auckland, Nueva Zelanda","auckland live cam","newzealand,port,city"],

      // ──────────────── ÁFRICA ────────────────
      ["za_cape_town_table","Table Mountain — LIVE","Cape Town, Sudáfrica","table mountain live cam","southafrica,landmark"],
      ["za_cape_town_waterfront","Waterfront — LIVE","Cape Town, Sudáfrica","v&a waterfront live cam","southafrica,port"],
      ["eg_cairo_nile","Nilo — LIVE","El Cairo, Egipto","cairo nile live cam","egypt,river,city"],
      ["eg_giza_pyramids","Pirámides — LIVE","Giza, Egipto","pyramids live cam","egypt,landmark"],
      ["ke_nairobi_city","Centro — LIVE","Nairobi, Kenia","nairobi live cam","kenya,city"],
      ["ma_marrakech_city","Centro — LIVE","Marrakech, Marruecos","marrakech live cam","morocco,city"],

      // ──────────────── USA (ciudades / calles / puertos) ────────────────
      ["us_nyc_timessquare","Times Square — LIVE","New York, USA","times square live cam 4k","usa,nyc,street"],
      ["us_nyc_brooklynbridge","Brooklyn Bridge — LIVE","New York, USA","brooklyn bridge live cam","usa,nyc,landmark"],
      ["us_nyc_statue","Statue of Liberty — LIVE","New York, USA","statue of liberty live cam","usa,nyc,landmark"],
      ["us_miami_beach","Miami Beach — LIVE","Miami, USA","miami beach live cam","usa,beach"],
      ["us_la_hollywood","Hollywood Blvd — LIVE","Los Angeles, USA","hollywood boulevard live cam","usa,city,street"],
      ["us_sf_bay","SF Bay — LIVE","San Francisco, USA","san francisco bay live cam","usa,port,city"],
      ["us_lasvegas_strip","Las Vegas Strip — LIVE","Las Vegas, USA","las vegas strip live cam","usa,city,night"],
      ["us_neworleans_bourbon","Bourbon Street — LIVE","New Orleans, USA","bourbon street live cam","usa,street"],
      ["us_chicago_river","Chicago River — LIVE","Chicago, USA","chicago river live cam","usa,river,city"],
      ["us_seattle_pike","Pike Place — LIVE","Seattle, USA","pike place market live cam","usa,city"],

      // ──────────────── CANADÁ ────────────────
      ["ca_vancouver_harbor","Harbour — LIVE","Vancouver, Canadá","vancouver harbor live cam","canada,port,city"],
      ["ca_toronto_city","Downtown — LIVE","Toronto, Canadá","toronto live cam","canada,city"],
      ["ca_niagara_falls","Niagara Falls — LIVE","Ontario, Canadá","niagara falls live cam","canada,landmark"],

      // ──────────────── LATAM ────────────────
      ["mx_cancun_beach","Cancún — LIVE","Cancún, México","cancun live cam beach","mexico,beach"],
      ["mx_mexicocity_zocalo","Zócalo — LIVE","CDMX, México","mexico city zocalo live cam","mexico,city,landmark"],
      ["br_rio_copacabana","Copacabana — LIVE","Río de Janeiro, Brasil","copacabana live cam","brazil,beach"],
      ["br_sp_paulista","Av. Paulista — LIVE","São Paulo, Brasil","avenida paulista live cam","brazil,city,street"],
      ["ar_ba_obelisco","Obelisco — LIVE","Buenos Aires, Argentina","obelisco buenos aires live cam","argentina,city,landmark"],
      ["cl_santiago_city","Centro — LIVE","Santiago, Chile","santiago chile live cam","chile,city"],
      ["co_bogota_city","Centro — LIVE","Bogotá, Colombia","bogota live cam","colombia,city"],

      // ──────────────── NATURALEZA / VOLCANES / AURORAS ────────────────
      ["volcano_etna_global","Volcán Etna — LIVE","Italia","etna live cam eruption","volcano,nature"],
      ["volcano_kilauea","Kilauea — LIVE","Hawái, USA","kilauea live cam","usa,volcano,hawaii"],
      ["aurora_northernlights","Auroras boreales — LIVE","Ártico","northern lights live cam","aurora,nature"],
      ["ocean_surf_global","Surf report — LIVE","Global","surf cam live","ocean,surf"],

      // ──────────────── WILDLIFE (directos típicos) ────────────────
      ["wildlife_bears","Osos — LIVE","Alaska, USA","brown bear live cam","wildlife,bears"],
      ["wildlife_pandas","Pandas — LIVE","China","panda live cam","wildlife,panda"],
      ["wildlife_africa_waterhole","África waterhole — LIVE","África","african watering hole live cam","wildlife,africa"],
      ["wildlife_eagles","Águilas — LIVE","USA","eagle nest live cam","wildlife,birds"],

      // ──────────────── MÁS CAMS AÑADIDAS ────────────────
      ["us_boston_harbor","Boston Harbor — LIVE","Boston, USA","boston harbor live cam","usa,port"],
      ["us_atlanta_city","Downtown — LIVE","Atlanta, USA","atlanta live cam downtown","usa,city"],
      ["us_denver_city","Union Station — LIVE","Denver, USA","denver union station live cam","usa,city,train"],
      ["ca_montreal_oldport","Old Port — LIVE","Montreal, Canadá","montreal old port live cam","canada,port"],
      ["mx_guadalajara_city","Centro — LIVE","Guadalajara, México","guadalajara live cam","mexico,city"],
      ["br_salvador_beach","Salvador Beach — LIVE","Salvador, Brasil","salvador beach live cam","brazil,beach"],
      ["ar_ushuaia_city","Ushuaia — LIVE","Ushuaia, Argentina","ushuaia live cam","argentina,city"],
      ["cl_valparaiso_port","Valparaíso Port — LIVE","Valparaíso, Chile","valparaiso port live cam","chile,port"],
      ["pe_lima_city","Miraflores — LIVE","Lima, Perú","lima miraflores live cam","peru,city,beach"],
      ["ec_galapagos","Galápagos — LIVE","Galápagos, Ecuador","galapagos live cam","ecuador,island,wildlife"],
      ["pa_panama_canal","Panama Canal — LIVE","Panamá","panama canal live cam","panama,canal"],
      ["cr_sanjose_city","San José — LIVE","San José, Costa Rica","san jose costa rica live cam","costarica,city"],
      ["cu_havana_malecon","Malecón — LIVE","Havana, Cuba","havana malecon live cam","cuba,city,coast"],
      ["pr_sanjuan_old","Old San Juan — LIVE","San Juan, Puerto Rico","old san juan live cam","puertorico,city"],
      ["do_santodomingo","Santo Domingo — LIVE","Santo Domingo, República Dominicana","santo domingo live cam","dominicanrepublic,city"],
      ["ve_caracas_city","Caracas — LIVE","Caracas, Venezuela","caracas live cam","venezuela,city"],
      ["bo_lapaz_city","La Paz — LIVE","La Paz, Bolivia","la paz bolivia live cam","bolivia,city"],
      ["py_asuncion_city","Asunción — LIVE","Asunción, Paraguay","asuncion live cam","paraguay,city"],
      ["uy_montevideo_rambla","Rambla — LIVE","Montevideo, Uruguay","montevideo rambla live cam","uruguay,city,coast"],
      ["no_bergen_city","Bergen — LIVE","Bergen, Noruega","bergen live cam","norway,city"],
      ["se_gothenburg_city","Gothenburg — LIVE","Gothenburg, Suecia","gothenburg live cam","sweden,city"],
      ["fi_rovaniemi_santa","Santa Claus Village — LIVE","Rovaniemi, Finlandia","rovaniemi santa claus live cam","finland,christmas"],
      ["is_blue_lagoon","Blue Lagoon — LIVE","Islandia","blue lagoon live cam","iceland,nature"],
      ["dk_aarhus_city","Aarhus — LIVE","Aarhus, Dinamarca","aarhus live cam","denmark,city"],
      ["pl_krakow_market","Market Square — LIVE","Krakow, Polonia","krakow market square live cam","poland,city"],
      ["cz_prague_bridge","Charles Bridge — LIVE","Praga, Chequia","prague charles bridge live cam","czech,landmark"],
      ["hu_budapest_chainbridge","Chain Bridge — LIVE","Budapest, Hungría","budapest chain bridge live cam","hungary,bridge"],
      ["sk_bratislava_city","Centro — LIVE","Bratislava, Eslovaquia","bratislava live cam","slovakia,city"],
      ["ru_moscow_redsquare","Red Square — LIVE","Moscow, Rusia","moscow red square live cam","russia,landmark"],
      ["ru_stpetersburg_neva","Neva River — LIVE","St. Petersburg, Rusia","st petersburg neva live cam","russia,river"],
      ["ua_kyiv_maiden","Maidan — LIVE","Kyiv, Ucrania","kyiv maidan live cam","ukraine,city"],
      ["by_minsk_city","Centro — LIVE","Minsk, Bielorrusia","minsk live cam","belarus,city"],
      ["lv_riga_city","Centro — LIVE","Riga, Letonia","riga live cam","latvia,city"],
      ["lt_vilnius_city","Centro — LIVE","Vilnius, Lituania","vilnius live cam","lithuania,city"],
      ["ee_tallinn_city","Centro — LIVE","Tallinn, Estonia","tallinn live cam","estonia,city"],
      ["bg_sofia_city","Centro — LIVE","Sofia, Bulgaria","sofia live cam","bulgaria,city"],
      ["ro_bucharest_city","Centro — LIVE","Bucharest, Rumanía","bucharest live cam","romania,city"],
      ["rs_belgrade_city","Centro — LIVE","Belgrade, Serbia","belgrade live cam","serbia,city"],
      ["hr_zagreb_city","Centro — LIVE","Zagreb, Croacia","zagreb live cam","croatia,city"],
      ["si_ljubljana_city","Centro — LIVE","Ljubljana, Eslovenia","ljubljana live cam","slovenia,city"],
      ["gr_mykonos_windmills","Windmills — LIVE","Mykonos, Grecia","mykonos windmills live cam","greece,island"],
      ["tr_ankara_city","Centro — LIVE","Ankara, Turquía","ankara live cam","turkey,city"],
      ["tr_izmir_city","Centro — LIVE","Izmir, Turquía","izmir live cam","turkey,city"],
      ["il_telaviv_beach","Tel Aviv Beach — LIVE","Tel Aviv, Israel","tel aviv beach live cam","israel,beach"],
      ["ae_abudhabi_city","Centro — LIVE","Abu Dhabi, EAU","abu dhabi live cam","uae,city"],
      ["qa_doha_city","Centro — LIVE","Doha, Catar","doha live cam","qatar,city"],
      ["jp_sapporo_city","Centro — LIVE","Sapporo, Japón","sapporo live cam","japan,city"],
      ["jp_fukuoka_city","Centro — LIVE","Fukuoka, Japón","fukuoka live cam","japan,city"],
      ["kr_busan_city","Centro — LIVE","Busan, Corea del Sur","busan live cam","korea,city"],
      ["cn_taipei_101","Taipei 101 — LIVE","Taipei, Taiwán","taipei 101 live cam","taiwan,landmark"],
      ["hk_hongkong_city","Centro — LIVE","Hong Kong","hong kong live cam","hongkong,city"],
      ["sg_singapore_city","Centro — LIVE","Singapur","singapore live cam","singapore,city"],
      ["th_chiangmai_city","Centro — LIVE","Chiang Mai, Tailandia","chiang mai live cam","thailand,city"],
      ["vn_danang_city","Centro — LIVE","Da Nang, Vietnam","da nang live cam","vietnam,city"],
      ["my_kualalumpur_city","Centro — LIVE","Kuala Lumpur, Malasia","kuala lumpur live cam","malaysia,city"],
      ["id_jakarta_city","Centro — LIVE","Jakarta, Indonesia","jakarta live cam","indonesia,city"],
      ["ph_manila_bay","Manila Bay — LIVE","Manila, Filipinas","manila bay live cam","philippines,bay"],
      ["in_delhi_gate","India Gate — LIVE","Delhi, India","india gate live cam","india,landmark"],
      ["np_kathmandu_temple","Pashupatinath Temple — LIVE","Kathmandu, Nepal","pashupatinath live cam","nepal,temple"],
      ["lk_colombo_port","Port — LIVE","Colombo, Sri Lanka","colombo port live cam","srilanka,port"],
      ["au_brisbane_city","Centro — LIVE","Brisbane, Australia","brisbane live cam","australia,city"],
      ["au_perth_city","Centro — LIVE","Perth, Australia","perth live cam","australia,city"],
      ["nz_wellington_city","Centro — LIVE","Wellington, Nueva Zelanda","wellington live cam","newzealand,city"],
      ["za_johannesburg_city","Centro — LIVE","Johannesburg, Sudáfrica","johannesburg live cam","southafrica,city"],
      ["za_durban_beach","Durban Beach — LIVE","Durban, Sudáfrica","durban beach live cam","southafrica,beach"],
      ["ma_casablanca_city","Centro — LIVE","Casablanca, Marruecos","casablanca live cam","morocco,city"],
      ["eg_alexandria_city","Centro — LIVE","Alexandria, Egipto","alexandria live cam","egypt,city"],
      ["tn_tunis_city","Centro — LIVE","Tunis, Túnez","tunis live cam","tunisia,city"],
      ["dz_algiers_city","Centro — LIVE","Algiers, Argelia","algiers live cam","algeria,city"],
      ["ng_lagos_city","Centro — LIVE","Lagos, Nigeria","lagos live cam","nigeria,city"],
      ["gh_accra_city","Centro — LIVE","Accra, Ghana","accra live cam","ghana,city"],
      ["wildlife_elephants","Elefantes — LIVE","África","elephant live cam","wildlife,africa,elephants"],
      ["wildlife_giraffes","Jirafas — LIVE","África","giraffe live cam","wildlife,africa,giraffes"],
      ["volcano_iceland","Volcán Islandia — LIVE","Islandia","iceland volcano live cam","volcano,iceland"],
      ["ocean_coral_reef","Coral Reef — LIVE","Ocean","coral reef live cam","ocean,underwater"],
      ["zoo_san_diego","San Diego Zoo — LIVE","San Diego, USA","san diego zoo live cam","zoo,usa"],
      ["aquarium_monterey","Monterey Bay Aquarium — LIVE","Monterey, USA","monterey bay aquarium live cam","aquarium,usa"]
    ];

    // Relleno hasta 210 con targets “genéricos” muy productivos (siempre devuelven directos distintos)
    const FILL = [
      "airport live cam",
      "harbor live cam",
      "city center live cam",
      "street cam live",
      "beach live cam",
      "ski resort live cam",
      "train station live cam",
      "traffic cam live",
      "marina live cam",
      "mountain live cam",
      "zoo live cam",
      "aquarium live cam",
      "wildlife live cam",
      "volcano live cam",
      "river live cam",
      "lake live cam",
      "bridge live cam",
      "port live cam",
      "traffic camera live",
      "cctv live"
    ];

    // Genera extras (IDs únicos) para llegar a 210+ (sin repetir)
    const extras = [];
    let n = 1;
    while ((S.length + extras.length) < 210) {
      for (const base of FILL) {
        if ((S.length + extras.length) >= 210) break;
        const id = `auto_live_${String(n).padStart(3,"0")}`;
        const place = "Global";
        const title = `AUTO LIVE — ${base.toUpperCase()}`;
        const q = `${base} 4k -timelapse -replay -recorded`;
        const tags = ["auto","global","live"];
        extras.push([id, title, place, q, tags.join(",")]);
        n++;
      }
    }

    const all = S.concat(extras);

    return all.map(([id, title, place, q, tagCsv]) =>
      mk(id, title, place, q, tagCsv.split(",").map(s => s.trim()).filter(Boolean))
    );
  })();


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
  // NUEVO: Método para añadir cam custom desde URL (integrable con panel admin vía BC)
  // ─────────────────────────────────────────────────────────────
  g.RLCCams.addCustom = async function addCustom(url, options = {}) {
    const u = safeStr(url);
    if (!u) return null;

    let kind = "";
    let youtubeId = extractYouTubeIdFromUrl(u);
    let hlsUrl = "";
    let title = safeStr(options.title) || "Custom Cam";
    let place = safeStr(options.place) || "Custom";
    let source = safeStr(options.source) || "Custom URL";
    let tags = Array.isArray(options.tags) ? options.tags.slice(0, 12) : ["custom"];

    if (youtubeId) {
      kind = "youtube";
      if (!await isEmbeddableYouTube(youtubeId, MOD._abort.signal)) return null;
    } else if (looksLikeM3U8(u)) {
      kind = "hls";
      hlsUrl = u;
    } else {
      return null; // solo youtube o hls
    }

    const id = `custom_${Math.floor(Math.random() * 1e9)}`;
    if (seenIds.has(id)) return null;

    const cam = {
      id,
      title,
      place,
      source,
      kind,
      tags,
      isAlt: false
    };

    if (kind === "youtube") {
      cam.youtubeId = youtubeId;
      cam.originUrl = u;
      cam.thumb = youtubeThumb(youtubeId);
    } else if (kind === "hls") {
      cam.url = hlsUrl;
      cam.originUrl = hlsUrl;
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
  // Hook opcional (Admin): escucha BC para refresh/clear + ADD_CUSTOM
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

    // NUEVO: Mensaje para añadir custom desde panel
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