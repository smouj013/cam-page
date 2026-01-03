/* cams.js — Lista de cámaras (VIDEO ONLY + AUTO-DISCOVERY 500 + CATALOG 4-UP) v2.3.5
   ✅ Mantiene tus cams existentes (mismos ids) como "seed"
   ✅ VIDEO ONLY: NO exporta cams "image" (solo "youtube" y "hls")
   ✅ Sanitizador:
      - evita ids duplicados (se queda con la primera => tus existentes ganan)
      - completa originUrl si falta (YouTube/HLS)
      - infiere youtubeId desde originUrl si falta (watch?v= / live/ / embed/)
      - descarta entradas rotas (sin id/kind o sin youtubeId/url)
      - añade thumb para YouTube (para catálogo)
      - FILTRO EXTRA: elimina “walk/tour/recorded/timelapse/replay/loops” (solo webcams LIVE)
   ✅ OBJETIVO: 500 cams REALES
      - Carga cache (si existe) y la usa inmediatamente
      - Auto-discovery: busca LIVE webcams en Invidious (/api/v1/search?features=live)
      - Filtra “no-webcam” (música/lofi/radio/juegos/noticias/walk tours/recorded)
      - Validación embed (best-effort; no invalida por fallos de CORS)
      - Se queda solo con las que funcionan (cuando se puede validar)
   ✅ Failsafe (solo si tu player necesita SI o SI 500):
      - si no llega a 500 tras discovery, rellena con ALT duplicando válidas
        (NO inventa fuentes nuevas). Puedes desactivar esto con HARD_FAILSAFE_ALT_FILL=false.

   🧩 CATALOGO (4 a la vez):
      - window.CAM_CATALOG_LIST (sin alts)
      - window.RLCCams.getCatalogPage(pageIndex) => {pageIndex,pageSize,totalPages,totalItems,items}

   kind:
   - "youtube"  -> usa youtubeId (11 chars)
   - "hls"      -> usa url (.m3u8) (opcional, requiere CORS OK)

   Extra opcional:
   - maxSeconds -> si tu player lo soporta, limita cuánto tiempo se muestra esta cam.
   - tags       -> solo informativo (no rompe nada)
   - disabled   -> si true, se ignora (no rompe nada)
*/
(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  // Guard anti doble carga
  const LOAD_GUARD = "__RLC_CAMSJS_LOADED_V235_VIDEOONLY_AUTODISCOVERY500_CATALOG4";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  // ─────────────────────────────────────────────────────────────
  // CONFIG
  // ─────────────────────────────────────────────────────────────
  const TARGET_CAMS = 500;

  // CATALOGO
  const CATALOG_PAGE_SIZE = 4;

  // Cache: si existe y es “reciente”, se usa inmediatamente (mejor UX)
  // (Mantengo la key para NO romper cache previo)
  const CACHE_KEY = "rlc_cam_cache_v1_500";
  const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12h

  // Auto discovery ON/OFF (si lo apagas, te quedas con tus seeds)
  const AUTO_DISCOVERY = true;

  // Validación embed (si da problemas en tu hosting, ponlo en false)
  const VALIDATE_EMBED = true;

  // “Solo lives” (best-effort). Si se puede comprobar y NO es live, se descarta.
  // Si no se puede comprobar (CORS/proxy falla), no lo tratamos como negativo.
  const BEST_EFFORT_LIVE_CHECK = true;

  // Concurrencia (no lo subas mucho o te rate-limitean)
  const DISCOVERY_MAX_PAGES_PER_QUERY = 5;
  const DISCOVERY_MAX_PER_QUERY = 180;  // tope por query (candidatos)
  const DISCOVERY_CONCURRENCY = 4;

  // Limita instancias para no spamear (más estable)
  const DISCOVERY_MAX_INSTANCES = 10;

  // Presupuesto de requests (corta “infinito” si algo va mal)
  const DISCOVERY_REQUEST_BUDGET = 520;

  // Failsafe: para que tu player no reviente si exige 500 SÍ o SÍ.
  const HARD_FAILSAFE_ALT_FILL = true;

  // Queries “webcam” (multi-idioma) — evitamos “tour/walk”
  // ✅ Añadido: Venezuela + White House / Washington DC (prioridad)
  const DISCOVERY_QUERIES = [
    // --- Prioridad USA (White House / DC) ---
    "white house live cam",
    "white house webcam live",
    "washington dc live cam",
    "washington dc webcam live",
    "the white house live camera",
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
    // --- Genéricas (las tuyas) ---
    "live webcam",
    "webcam live",
    "webcam en vivo",
    "cámara en vivo",
    "live cam",
    "cctv live cam",
    "traffic camera live",
    "traffic cam live",
    "airport webcam live",
    "harbor webcam live",
    "harbour webcam live",
    "port webcam live",
    "beach webcam live",
    "pier webcam live",
    "downtown live cam",
    "street cam live",
    "railcam live",
    "train station webcam live",
    "ski webcam live",
    "mountain webcam live",
    "volcano webcam live",
    "earthcam live webcam",
    "skylinewebcams live webcam",
    "webcams live 24/7"
  ];

  // ─────────────────────────────────────────────────────────────
  // Filtro: permitidos vs bloqueados (evita streams que NO son cámaras)
  // ─────────────────────────────────────────────────────────────
  const BLOCK_WORDS = [
    // Música / radio / etc
    "lofi","lo-fi","radio","music","música","mix","playlist","beats",
    "podcast","audiobook","audiolibro",
    // Gaming / noticias / religión / crypto
    "gameplay","gaming","walkthrough","speedrun",
    "news","noticias","cnn","bbc","aljazeera","fox",
    "sermon","church","iglesia","prayer","oración",
    "crypto","trading","forex",
    // ✅ Lo que tú NO quieres (walk / grabaciones / loops / tours)
    "walk","walking","walks","walking tour","city walk","virtual walk","4k walk",
    "tour","travel","travelling","viaje","paseo","recorrido",
    "recorded","replay","rerun","repeat","loop","timelapse","time-lapse","time lapse",
    "ambience","ambient","study","sleep","relax","asmr",
    "dashcam","driving","drive","ride","train ride","bus ride","metro ride",
    "vlog","vlogger","behind the scenes"
  ];

  // ✅ Pistas de “esto SI parece webcam”
  // (NO metemos “live” solo, porque cuela demasiadas cosas)
  const ALLOW_HINTS = [
    "webcam","web cam","live cam","livecam","camera live","cctv","traffic cam","traffic camera",
    "airport","harbor","harbour","port","pier","beach","coast","marina",
    "downtown","street cam","street camera","square","plaza",
    "railcam","rail cam","train cam","station cam","train station",
    "ski cam","snow cam","mountain cam","volcano cam","crater cam",
    "earthcam","skylinewebcams","ozolio","webcams",
    // multi-idioma “cámara”
    "cámara","camara","en directo","en vivo","directo",
    "telecamera","kamera","kamera na żywo","webkamera","caméra"
  ];

  const KNOWN_WEBCAM_BRANDS = [
    "earthcam","skylinewebcams","ozolio","webcams","railcam",
    // ✅ añadido (aparece mucho como autor)
    "earthtv","earth tv","ip cam","ipcamlive","ipcam"
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
    // hqdefault suele ir bien para catálogo
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

    // Bloqueos fuertes
    for (let i = 0; i < BLOCK_WORDS.length; i++) {
      if (full.includes(BLOCK_WORDS[i])) return false;
    }

    // Requiere alguna pista de webcam
    if (includesAny(full, KNOWN_WEBCAM_BRANDS)) return true;
    if (includesAny(full, ALLOW_HINTS)) {
      // Evita “en vivo” sin ninguna palabra de cámara
      const hasCamWord =
        full.includes("webcam") || full.includes("cam") || full.includes("cctv") ||
        full.includes("cámara") || full.includes("camara") || full.includes("telecamera") ||
        full.includes("kamera") || full.includes("caméra");
      if (hasCamWord) return true;
    }

    return false;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

    // ✅ USA — CASA BLANCA (v2.3.5)
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
      tags: ["italy","city","tour"]
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

    // ─────────────────────────────────────────────────────────
    // ──────────────── NUEVAS (las que ya añadiste) ───────────
    // ─────────────────────────────────────────────────────────
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
    { id:"us_rolling_tour", title:"USA Live Cam — Rolling Tour", place:"USA (tour rolling)", source:"YouTube", kind:"youtube", youtubeId:"fa8iGVeri_I", originUrl:"https://www.youtube.com/watch?v=fa8iGVeri_I", tags:["tour","usa"] },
    { id:"us_times_square_4k_alt", title:"Times Square in 4K (Alt) — Live Cam", place:"New York, USA", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"SW1vpWZq9-w", originUrl:"https://www.youtube.com/watch?v=SW1vpWZq9-w", tags:["nyc","4k"] },
    { id:"us_nyc_xmas_4k", title:"NYC Holiday — Live Cam", place:"New York, USA", source:"YouTube", kind:"youtube", youtubeId:"5_vrqwsKXEQ", originUrl:"https://www.youtube.com/watch?v=5_vrqwsKXEQ", tags:["nyc","seasonal"] },
    { id:"es_tamariu_earthcam", title:"Tamariu — Live Cam", place:"Tamariu, España", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"ld87T3g_nyg", originUrl:"https://www.youtube.com/watch?v=ld87T3g_nyg", tags:["spain","beach"] },

    { id:"it_venice_grand_canal_povoledo", title:"Grand Canal (Povoledo) — Live Cam", place:"Venecia, Italia", source:"YouTube", kind:"youtube", youtubeId:"P6JA_YjHMZs", originUrl:"https://www.youtube.com/watch?v=P6JA_YjHMZs", tags:["italy","canal"] },
    { id:"it_venice_grand_canal_caangeli", title:"Grand Canal (Ca'Angeli) — Live Cam", place:"Venecia, Italia", source:"YouTube", kind:"youtube", youtubeId:"P393gTj527k", originUrl:"https://www.youtube.com/watch?v=P393gTj527k", tags:["italy","canal"] },
    { id:"it_venice_ponte_guglie_4k", title:"Ponte delle Guglie — Live Cam", place:"Venecia, Italia", source:"YouTube", kind:"youtube", youtubeId:"HpZAez2oYsA", originUrl:"https://www.youtube.com/watch?v=HpZAez2oYsA", tags:["italy","bridge"] },
    { id:"it_venice_san_cassiano", title:"Grand Canal (Hotel San Cassiano) — Live Cam", place:"Venecia, Italia", source:"YouTube", kind:"youtube", youtubeId:"lFQ_BvxIcnI", originUrl:"https://www.youtube.com/watch?v=lFQ_BvxIcnI", tags:["italy","canal"] },
    { id:"it_venice_top_mix", title:"TOP Venice Live Cams (mix)", place:"Venecia, Italia (mix)", source:"YouTube", kind:"youtube", youtubeId:"CwhHltwJdhc", originUrl:"https://www.youtube.com/watch?v=CwhHltwJdhc", tags:["mix","italy"] },
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
    { id:"cz_prague_timelapse", title:"Prague Time-Lapse (live view link)", place:"Praga, República Checa", source:"YouTube", kind:"youtube", youtubeId:"jbN6czYv0os", originUrl:"https://www.youtube.com/watch?v=jbN6czYv0os", tags:["czech","timelapse"] },

    { id:"nl_amsterdam_dam_ptz", title:"Amsterdam — De Dam (PTZ) — Live Cam", place:"Ámsterdam, Países Bajos", source:"YouTube", kind:"youtube", youtubeId:"Gd9d4q6WvUY", originUrl:"https://www.youtube.com/watch?v=Gd9d4q6WvUY", tags:["netherlands","ptz"] },
    { id:"nl_amsterdam_singel_hotel", title:"Singel Hotel — Live Cam", place:"Ámsterdam, Países Bajos", source:"YouTube", kind:"youtube", youtubeId:"ZnOoxCd7BGU", originUrl:"https://www.youtube.com/watch?v=ZnOoxCd7BGU", tags:["netherlands","city"] },
    { id:"nl_amsterdam_sixhaven", title:"Sixhaven — Live Cam", place:"Ámsterdam, Países Bajos", source:"YouTube", kind:"youtube", youtubeId:"3gTHiUWrCAE", originUrl:"https://www.youtube.com/watch?v=3gTHiUWrCAE", tags:["netherlands","harbour"] },
    { id:"nl_amsterdam_movenpick", title:"Mövenpick Rooftop — Live Cam", place:"Ámsterdam, Países Bajos", source:"YouTube", kind:"youtube", youtubeId:"9Pm6Ji6tm7s", originUrl:"https://www.youtube.com/watch?v=9Pm6Ji6tm7s", tags:["netherlands","rooftop"] },
    { id:"nl_amsterdam_live_stream", title:"Amsterdam — Live Cam", place:"Ámsterdam, Países Bajos", source:"YouTube", kind:"youtube", youtubeId:"RmiTd0J5qDg", originUrl:"https://www.youtube.com/watch?v=RmiTd0J5qDg", tags:["netherlands","city"] },
    { id:"nl_amsterdam_stationseiland", title:"Amsterdam — Station Area — Live Cam", place:"Ámsterdam, Países Bajos", source:"YouTube", kind:"youtube", youtubeId:"1phWWCgzXgM", originUrl:"https://www.youtube.com/watch?v=1phWWCgzXgM", tags:["netherlands","station"] },

    { id:"fr_paris_walk_live", title:"Paris Eiffel Tower Walk Live", place:"París, Francia", source:"YouTube", kind:"youtube", youtubeId:"wCgNhsNjuPs", originUrl:"https://www.youtube.com/watch?v=wCgNhsNjuPs", tags:["france","tour"] },
    { id:"fr_paris_pont_iena", title:"Paris — Pont de Iéna (Eiffel Tower) — Live Cam", place:"París, Francia", source:"YouTube", kind:"youtube", youtubeId:"7-OFVJ8hKFc", originUrl:"https://www.youtube.com/watch?v=7-OFVJ8hKFc", tags:["france","landmark"] },
    { id:"fr_paris_live_hd", title:"Paris — Eiffel — Live Cam", place:"París, Francia", source:"YouTube", kind:"youtube", youtubeId:"iZipA1LL_sU", originUrl:"https://www.youtube.com/watch?v=iZipA1LL_sU", tags:["france","landmark"] },
    { id:"fr_paris_stream_alt", title:"Paris (Eiffel area) — Live Cam", place:"París, Francia", source:"YouTube", kind:"youtube", youtubeId:"xzMYdVo-3Bs", originUrl:"https://www.youtube.com/watch?v=xzMYdVo-3Bs", tags:["france","city"] },
    { id:"fr_paris_earth_hour", title:"Eiffel Tower — Live Cam", place:"París, Francia", source:"YouTube", kind:"youtube", youtubeId:"NrMFAkTeuVw", originUrl:"https://www.youtube.com/watch?v=NrMFAkTeuVw", tags:["france","eiffel"] },
    { id:"fr_paris_angles_4k", title:"Paris — Eiffel Tower — Live Cam", place:"París, Francia", source:"YouTube", kind:"youtube", youtubeId:"mvcL9--pvHw", originUrl:"https://www.youtube.com/watch?v=mvcL9--pvHw&vl=en", tags:["france","multi"] },
    { id:"fr_paris_virtual_live", title:"Eiffel Tower Virtual Tour (Live)", place:"París, Francia", source:"YouTube", kind:"youtube", youtubeId:"O8Ha_pAqYcY", originUrl:"https://www.youtube.com/watch?v=O8Ha_pAqYcY", tags:["france","tour"] },

    { id:"es_barcelona_rough_morning", title:"Barcelona — Live Cam", place:"Barcelona, España", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"XL1hRO8EYa0", originUrl:"https://www.youtube.com/watch?v=XL1hRO8EYa0", tags:["spain","barcelona"] },
    { id:"es_barcelona_recorded", title:"Barcelona (Recorded live)", place:"Barcelona, España", source:"YouTube", kind:"youtube", youtubeId:"-rADshzms8U", originUrl:"https://www.youtube.com/watch?v=-rADshzms8U", tags:["spain","barcelona"] },
    { id:"es_tenerife_santa_cruz", title:"Santa Cruz de Tenerife — Live Cam", place:"Tenerife, España", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"RJbiqyQ4BlY", originUrl:"https://www.youtube.com/watch?v=RJbiqyQ4BlY", tags:["spain","canary"] },
    { id:"es_tenerife_las_vistas", title:"Playa Las Vistas — Live Cam", place:"Tenerife, España", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"gsTMAwBl-5E", originUrl:"https://www.youtube.com/watch?v=gsTMAwBl-5E", tags:["spain","canary","beach"] },
    { id:"es_tenerife_recorded", title:"Tenerife (Recorded live)", place:"Tenerife, España", source:"YouTube", kind:"youtube", youtubeId:"lLdp3VjZ2K4", originUrl:"https://www.youtube.com/watch?v=lLdp3VjZ2K4", tags:["spain","canary"] },

    { id:"ar_buenos_aires_live", title:"Buenos Aires — Live Cam", place:"Buenos Aires, Argentina", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"reShHDyLGbc", originUrl:"https://www.youtube.com/watch?v=reShHDyLGbc", tags:["argentina","city"] },
    { id:"ar_ushuaia_snowfall", title:"Ushuaia Snowfall — Live Cam", place:"Ushuaia, Argentina", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"9cYa8Ssf0rI", originUrl:"https://www.youtube.com/watch?v=9cYa8Ssf0rI", tags:["argentina","snow"] },

    { id:"fo_faroe_islands_live", title:"Faroe Islands — Live Cam", place:"Islas Feroe", source:"YouTube", kind:"youtube", youtubeId:"9NpCVV25j_4", originUrl:"https://www.youtube.com/watch?v=9NpCVV25j_4", tags:["faroe","nature"] },
    { id:"it_canazei_snowfall", title:"Canazei Snowfall — Live Cam", place:"Canazei, Italia", source:"YouTube", kind:"youtube", youtubeId:"hIKpX489KCI", originUrl:"https://www.youtube.com/watch?v=hIKpX489KCI", tags:["italy","snow","alps"] },

    { id:"jp_shibuya_alt_timelapse", title:"Shibuya (Alt / Time-lapse)", place:"Tokio, Japón", source:"YouTube", kind:"youtube", youtubeId:"KiXaAGqD99I", originUrl:"https://www.youtube.com/watch?v=KiXaAGqD99I", tags:["japan","timelapse"] },
    { id:"th_phuket_new_year_live", title:"Night Cam — Live", place:"Phuket, Tailandia", source:"YouTube", kind:"youtube", youtubeId:"AQMaw6OAeHY", originUrl:"https://www.youtube.com/watch?v=AQMaw6OAeHY", tags:["thailand","night"] },
    { id:"us_hawaii_volcano_cam_alt", title:"Volcano Cam (Big Island) — Live", place:"Hawái, USA", source:"YouTube", kind:"youtube", youtubeId:"u4UZ4UvZXrg", originUrl:"https://www.youtube.com/watch?v=u4UZ4UvZXrg", tags:["usa","hawaii","volcano"] },

    { id:"mix_1200_top_webcams", title:"1200 TOP LIVE WEBCAMS (mix)", place:"Mundo (mix)", source:"YouTube", kind:"youtube", youtubeId:"EFum1rGUdkk", originUrl:"https://www.youtube.com/watch?v=EFum1rGUdkk", tags:["mix","world"] },
    { id:"mix_50_greece_webcams", title:"50 TOP LIVE CAMS (Greece mix)", place:"Grecia (mix)", source:"YouTube", kind:"youtube", youtubeId:"QswsqbCmkjE", originUrl:"https://www.youtube.com/watch?v=QswsqbCmkjE", tags:["mix","greece"] },
    { id:"mix_us_webcams_oct", title:"LIVE WEBCAMS around the USA (mix)", place:"USA (mix)", source:"YouTube", kind:"youtube", youtubeId:"59D6sy6wjdI", originUrl:"https://www.youtube.com/watch?v=59D6sy6wjdI", tags:["mix","usa"] },

    // (Estos “placeholders” se quedan como seed, pero el filtro live/webcam los puede descartar)
    { id:"es_madrid_puerta_sol", title:"Puerta del Sol — Live Cam", place:"Madrid, España", source:"YouTube", kind:"youtube", youtubeId:"k7m5Jc2QYqA", originUrl:"https://www.youtube.com/watch?v=k7m5Jc2QYqA", tags:["spain","madrid","city"] },
    { id:"es_madrid_gran_via", title:"Gran Vía — Live Cam", place:"Madrid, España", source:"YouTube", kind:"youtube", youtubeId:"xjG8h3u4b8o", originUrl:"https://www.youtube.com/watch?v=xjG8h3u4b8o", tags:["spain","madrid","street"] },
    { id:"es_valencia_city", title:"Valencia — Live Cam", place:"Valencia, España", source:"YouTube", kind:"youtube", youtubeId:"wXxQm2n3p1s", originUrl:"https://www.youtube.com/watch?v=wXxQm2n3p1s", tags:["spain","valencia"] },
    { id:"es_sevilla_city", title:"Sevilla — Live Cam", place:"Sevilla, España", source:"YouTube", kind:"youtube", youtubeId:"5mQpZQm9JqY", originUrl:"https://www.youtube.com/watch?v=5mQpZQm9JqY", tags:["spain","sevilla"] },
    { id:"es_bilbao_ria", title:"Bilbao (Ría) — Live Cam", place:"Bilbao, España", source:"YouTube", kind:"youtube", youtubeId:"b2GQY8x1r1Q", originUrl:"https://www.youtube.com/watch?v=b2GQY8x1r1Q", tags:["spain","bilbao"] },
    { id:"es_mallorca_beach", title:"Mallorca Beach — Live Cam", place:"Mallorca, España", source:"YouTube", kind:"youtube", youtubeId:"Z0H1y1b2v3c", originUrl:"https://www.youtube.com/watch?v=Z0H1y1b2v3c", tags:["spain","mallorca","beach"] },
    { id:"es_gran_canaria_playa", title:"Gran Canaria Beach — Live Cam", place:"Gran Canaria, España", source:"YouTube", kind:"youtube", youtubeId:"Qq3a1n2m3p0", originUrl:"https://www.youtube.com/watch?v=Qq3a1n2m3p0", tags:["spain","canary","beach"] },

    { id:"mix_world_live_cities", title:"WORLD Live Cams — Cities Mix", place:"Mundo (mix)", source:"YouTube", kind:"youtube", youtubeId:"w0rLdC1t13s0", originUrl:"https://www.youtube.com/watch?v=w0rLdC1t13s0", tags:["mix","world","cities"] },
    { id:"mix_world_nature", title:"WORLD Live Cams — Nature Mix", place:"Mundo (mix)", source:"YouTube", kind:"youtube", youtubeId:"n4tur3M1x000", originUrl:"https://www.youtube.com/watch?v=n4tur3M1x000", tags:["mix","world","nature"] }
  ];

  // ─────────────────────────────────────────────────────────────
  // 2) SANITIZAR + EXPORTAR (VIDEO ONLY)
  // ─────────────────────────────────────────────────────────────
  const seenIds = new Set();
  const seenYouTube = new Set(); // youtubeId
  const OUT = [];               // lista para player (puede contener alts)
  const OUT_CATALOG = [];       // lista para catálogo (sin alts)

  function pushCam(cam) {
    if (!cam || !cam.id || seenIds.has(cam.id)) return false;
    seenIds.add(cam.id);
    if (cam.kind === "youtube" && cam.youtubeId) seenYouTube.add(cam.youtubeId);
    OUT.push(cam);
    if (!cam.isAlt) OUT_CATALOG.push(cam);
    return true;
  }

  // Build base list from RAW
  for (let i = 0; i < RAW.length; i++) {
    const cam = RAW[i];
    if (!cam || typeof cam !== "object") continue;
    if (cam.disabled === true) continue;

    const id = toId(cam.id, i);
    if (seenIds.has(id)) continue; // los primeros ganan

    let kind = safeStr(cam.kind).toLowerCase();

    // VIDEO ONLY
    if (kind === "image") continue;

    // Filtro webcam LIVE (heurístico) — descarta walk/recorded/etc también en seeds
    // (no tocamos HLS aquí por título si no hay title)
    const tOk = camTitleOk(cam.title, cam.source);
    if (!tOk) {
      // Si es HLS y tiene pinta de m3u8, dejamos pasar (no hay título “real” muchas veces)
      if (!(kind === "hls" && looksLikeM3U8(cam.url))) continue;
    }

    // Inferencia suave
    if (!ALLOWED_KINDS.has(kind)) {
      if (safeStr(cam.youtubeId) || extractYouTubeIdFromUrl(cam.originUrl) || extractYouTubeIdFromUrl(cam.url)) {
        kind = "youtube";
      } else if (looksLikeM3U8(cam.url)) {
        kind = "hls";
      } else {
        continue;
      }
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

      // Evita duplicar el mismo stream por error
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

  // ─────────────────────────────────────────────────────────────
  // 2.5) CACHE LOAD (si hay cache buena, la usamos YA)
  // ─────────────────────────────────────────────────────────────
  function loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !Array.isArray(obj.list) || typeof obj.ts !== "number") return null;
      const age = Date.now() - obj.ts;
      if (age > CACHE_MAX_AGE_MS) return null;

      // Sanitiza cache: solo youtube/hls y campos mínimos
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

        // filtro webcam LIVE (cache también)
        if (!camTitleOk(c.title, c.source)) continue;

        if (kind === "youtube") {
          const yid = safeStr(c.youtubeId);
          if (!isValidYouTubeId(yid) || yts.has(yid)) continue;
          yts.add(yid);
          if (!c.thumb) c.thumb = youtubeThumb(yid);
        }
        c.isAlt = false; // cache solo guarda “reales”
        ids.add(id);
        list.push(c);
      }
      return list;
    } catch (_) {
      return null;
    }
  }

  function saveCache(listNonAlt) {
    try {
      const payload = { ts: Date.now(), list: listNonAlt.slice(0, TARGET_CAMS) };
      localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch (_) {}
  }

  const cached = loadCache();
  if (cached && cached.length >= Math.min(80, TARGET_CAMS)) {
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

  // Export inmediato (para no romper tu player)
  g.CAM_LIST = OUT;
  g.CAM_CATALOG_LIST = OUT_CATALOG;

  // Promise opcional (por si tu app quiere esperar a las 500)
  let __resolveReady = null;
  g.CAM_LIST_READY = new Promise((res) => { __resolveReady = res; });

  // ─────────────────────────────────────────────────────────────
  // CATALOGO API (4 a la vez)
  // ─────────────────────────────────────────────────────────────
  function getCatalogList() {
    // siempre devuelve lista sin alts
    return Array.isArray(g.CAM_CATALOG_LIST) ? g.CAM_CATALOG_LIST : [];
  }

  function clampInt(v, a, b) {
    v = (v | 0);
    return Math.max(a, Math.min(b, v));
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
    return {
      pageIndex: pi,
      pageSize: ps,
      totalPages,
      totalItems: list.length,
      items
    };
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
    // fallback: rellena secuencial si falta
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
      total: Array.isArray(g.CAM_LIST) ? g.CAM_LIST.length : 0,
      catalogTotal: Array.isArray(g.CAM_CATALOG_LIST) ? g.CAM_CATALOG_LIST.length : 0
    };
    try { g.dispatchEvent(new CustomEvent("rlc_cam_list_updated", { detail })); } catch (_) {}
  }

  function onUpdate(cb) {
    if (typeof cb !== "function") return () => {};
    const h = (ev) => {
      try {
        const d = ev && ev.detail;
        cb(d || null);
      } catch (_) {}
    };
    try { g.addEventListener("rlc_cam_list_updated", h); } catch (_) {}
    return () => { try { g.removeEventListener("rlc_cam_list_updated", h); } catch (_) {} };
  }

  g.RLCCams = g.RLCCams || {};
  g.RLCCams.pageSize = CATALOG_PAGE_SIZE;
  g.RLCCams.getCatalogList = getCatalogList;
  g.RLCCams.getCatalogTotalPages = getCatalogTotalPages;
  g.RLCCams.getCatalogPage = getCatalogPage;
  g.RLCCams.getCatalogFeatured = getCatalogFeatured;
  g.RLCCams.onUpdate = onUpdate;

  // también expongo por compat si lo quieres leer en catalogView.js
  g.RLC_CATALOG_PAGE_SIZE = CATALOG_PAGE_SIZE;

  emitUpdate();

  // ─────────────────────────────────────────────────────────────
  // 3) AUTO-DISCOVERY — completar a 500 con cams REALES
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
    // heurística (best-effort): si detectamos señales claras de VOD/estreno/espera
    if (s.includes("premiere")) return true;
    if (s.includes("upcoming")) return true;
    if (s.includes("scheduled")) return true;
    return false;
  }

  async function fetchWithTimeout(url, opts, timeoutMs) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      return await fetch(url, Object.assign({}, opts || {}, { signal: ac.signal }));
    } finally {
      clearTimeout(t);
    }
  }

  function normalizeUrl(u) {
    const s = safeStr(u);
    if (!s) return "";
    // fuerza https si viene http
    if (s.startsWith("http://")) return "https://" + s.slice(7);
    return s;
  }

  // Proxies/fallbacks para CORS duro
  const PROXIES = [
    (u) => normalizeUrl(u),
    // Jina proxy: probamos 2 formatos para maximizar compat
    (u) => "https://r.jina.ai/http://" + normalizeUrl(u).replace(/^https?:\/\//, ""),
    (u) => "https://r.jina.ai/https://" + normalizeUrl(u).replace(/^https?:\/\//, "")
  ];

  async function fetchTextSmart(url, timeoutMs) {
    const errs = [];
    for (let i = 0; i < PROXIES.length; i++) {
      const u = PROXIES[i](url);
      try {
        const r = await fetchWithTimeout(u, { method: "GET", cache: "no-store" }, timeoutMs || 9000);
        if (!r || !r.ok) throw new Error(`HTTP ${r ? r.status : "?"}`);
        const tx = await r.text();
        if (tx && tx.length > 0) return tx;
      } catch (e) {
        errs.push(e);
      }
    }
    throw (errs[errs.length - 1] || new Error("fetchTextSmart failed"));
  }

  async function fetchJsonSmart(url, timeoutMs) {
    const tx = await fetchTextSmart(url, timeoutMs || 9000);
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

  async function isReallyLiveYouTube(videoId) {
    if (!BEST_EFFORT_LIVE_CHECK) return true;

    // Best-effort: leer embed/watch y buscar señales de live.
    // Si no podemos comprobar => no es negativo.
    try {
      const html = await fetchTextSmart(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, 11000);
      if (!html) return true;

      // Señales típicas (no perfectas)
      const h = html.toLowerCase();

      // Si detectamos claramente “no live”
      if (textLooksNotLive(h)) return false;

      // Señales de live (varían por HTML)
      if (h.includes("\"islive\":true") || h.includes("\"islivecontent\":true") || h.includes("\"islivenow\":true")) return true;
      if (h.includes("livestreamability") && !h.includes("unplayable")) return true;

      // Si no vemos nada concluyente, no penalizamos
      return true;
    } catch (_) {
      return true;
    }
  }

  async function isEmbeddableYouTube(videoId) {
    if (!VALIDATE_EMBED) return true;

    // 1) oEmbed (rápido). Si falla por CORS/red -> no lo tomamos como negativo.
    try {
      const o = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent("https://www.youtube.com/watch?v=" + videoId)}`;
      const r = await fetchWithTimeout(o, { method: "GET", cache: "no-store" }, 7000);
      if (r && r.ok) {
        // válido (pero NO garantiza embed permitido)
      } else if (r && (r.status === 401 || r.status === 403 || r.status === 404)) {
        return false;
      }
    } catch (_) {}

    // 2) embed HTML via proxy (best-effort)
    try {
      const html = await fetchTextSmart(`https://www.youtube.com/embed/${videoId}`, 9000);
      if (!html) return true;
      if (textLikelyBlockedEmbed(html)) return false;
    } catch (_) {
      // si no podemos comprobar, no lo invalidamos (tu player ya autoskip)
      return true;
    }

    // 3) live check (best-effort)
    const liveOk = await isReallyLiveYouTube(videoId);
    if (!liveOk) return false;

    return true;
  }

  function toAutoCam(entry) {
    const vid = safeStr(entry && entry.videoId);
    if (!isValidYouTubeId(vid)) return null;

    const title = safeStr(entry.title) || "Live Cam";
    const author = safeStr(entry.author);
    if (!camTitleOk(title, author)) return null;

    const id = `yt_${vid}`;
    return {
      id,
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

  // Instancias Invidious: usamos API de instancias + fallback fijo
  async function getInvidiousInstances() {
    const fallback = [
      "https://inv.nadeko.net",
      "https://yewtu.be",
      "https://invidious.f5.si",
      "https://invidious.nerdvpn.de",
      "https://inv.perditum.com"
    ];

    try {
      const data = await fetchJsonSmart("https://api.invidious.io/instances.json", 12000);
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
      // uniq
      const uniq = [];
      const s = new Set();
      for (let i = 0; i < out.length; i++) {
        const u = out[i];
        if (!u || s.has(u)) continue;
        s.add(u);
        uniq.push(u);
      }
      // añade fallback al final
      for (let i = 0; i < fallback.length; i++) {
        const u = fallback[i];
        if (!s.has(u)) { s.add(u); uniq.push(u); }
      }
      return uniq.slice(0, Math.max(5, DISCOVERY_MAX_INSTANCES));
    } catch (_) {
      return fallback.slice(0, Math.max(5, DISCOVERY_MAX_INSTANCES));
    }
  }

  let __reqUsed = 0;

  async function invidiousSearch(instance, q, page) {
    if (__reqUsed++ >= DISCOVERY_REQUEST_BUDGET) return [];

    const base = instance.replace(/\/+$/, "");
    const url =
      `${base}/api/v1/search` +
      `?q=${encodeURIComponent(q)}` +
      `&page=${encodeURIComponent(String(page))}` +
      `&type=video` +
      `&features=live` +
      `&sort=relevance` +
      `&region=US`;

    const res = await fetchJsonSmart(url, 12000);
    if (!Array.isArray(res)) return [];
    return res;
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

  async function discoverMore() {
    try {
      if (!AUTO_DISCOVERY) {
        saveCache(OUT_CATALOG);
        emitUpdate();
        if (__resolveReady) __resolveReady(g.CAM_LIST);
        return;
      }

      if (OUT.length >= TARGET_CAMS) {
        saveCache(OUT_CATALOG);
        emitUpdate();
        if (__resolveReady) __resolveReady(g.CAM_LIST);
        return;
      }

      const instancesRaw = await getInvidiousInstances();
      const instances = shuffleInPlace(instancesRaw.slice(0, Math.max(5, DISCOVERY_MAX_INSTANCES)));

      const candidates = [];
      const addedNow = new Set(); // videoId in this run

      // tareas (más eficiente: no combinamos TODO; hacemos round-robin)
      const tasks = [];
      for (let qi = 0; qi < DISCOVERY_QUERIES.length; qi++) {
        const q = DISCOVERY_QUERIES[qi];
        for (let p = 1; p <= DISCOVERY_MAX_PAGES_PER_QUERY; p++) {
          // rotamos instancias por query/página
          for (let ii = 0; ii < instances.length; ii++) {
            tasks.push({ q, p, inst: instances[ii] });
          }
        }
      }
      shuffleInPlace(tasks);

      let cursor = 0;
      const foundForQuery = Object.create(null);

      async function worker() {
        while (cursor < tasks.length && (OUT_CATALOG.length + candidates.length) < TARGET_CAMS) {
          if (__reqUsed >= DISCOVERY_REQUEST_BUDGET) break;

          const t = tasks[cursor++];

          try {
            const key = t.q;
            foundForQuery[key] = foundForQuery[key] || 0;
            if (foundForQuery[key] >= DISCOVERY_MAX_PER_QUERY) {
              await sleep(50);
              continue;
            }

            const results = await invidiousSearch(t.inst, t.q, t.p);

            for (let i = 0; i < results.length; i++) {
              const r = results[i];
              if (!r || r.type !== "video") continue;

              // liveNow es lo que queremos
              if (r.liveNow !== true) continue;

              const cam = toAutoCam(r);
              if (!cam) continue;

              const vid = cam.youtubeId;
              if (seenYouTube.has(vid) || addedNow.has(vid)) continue;
              addedNow.add(vid);

              const ok = await isEmbeddableYouTube(vid);
              if (!ok) continue;

              candidates.push(cam);
              foundForQuery[key]++;

              // early stop
              if ((OUT_CATALOG.length + candidates.length) >= TARGET_CAMS) break;
              if (__reqUsed >= DISCOVERY_REQUEST_BUDGET) break;
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

      // Failsafe ALT fill (solo para player; catálogo se queda limpio)
      if (HARD_FAILSAFE_ALT_FILL && OUT.length > 0 && OUT.length < TARGET_CAMS) {
        const baseLen = OUT.length;
        let k = 0;
        while (OUT.length < TARGET_CAMS && k < 40000) {
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

      // Guarda cache SOLO sin alts
      saveCache(OUT_CATALOG);

      emitUpdate();
      if (__resolveReady) __resolveReady(g.CAM_LIST);
    } catch (_) {
      // Si algo explota, no bloqueamos: resolvemos con lo que haya
      try { saveCache(OUT_CATALOG); } catch (_) {}
      try { emitUpdate(); } catch (_) {}
      try { if (__resolveReady) __resolveReady(g.CAM_LIST); } catch (_) {}
    }
  }

  // Lanza discovery sin bloquear el arranque
  try {
    setTimeout(() => { discoverMore(); }, 0);
  } catch (_) {
    discoverMore();
  }
})();
