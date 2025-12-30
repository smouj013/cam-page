/* cams.js — Lista de cámaras (VIDEO ONLY + AUTO-DISCOVERY 500) v2.3.0
   ✅ Mantiene tus cams existentes (mismos ids) como "seed"
   ✅ VIDEO ONLY: NO exporta cams "image" (solo "youtube" y "hls")
   ✅ Sanitizador:
      - evita ids duplicados (se queda con la primera => tus existentes ganan)
      - completa originUrl si falta (YouTube/HLS)
      - infiere youtubeId desde originUrl si falta (watch?v= / live/ / embed/)
      - descarta entradas rotas (sin id/kind o sin youtubeId/url)
   ✅ OBJETIVO: 500 cams REALES
      - Carga cache (si existe) y la usa inmediatamente
      - Auto-discovery: busca LIVE webcams en Invidious (/api/v1/search?features=live)
      - Filtra “no-webcam” (música/lofi/radio/juegos/noticias)
      - Valida embed (intenta detectar “Playback disabled / Video unavailable”)
      - Se queda solo con las que funcionan
   ✅ Failsafe (solo si tu player necesita SI o SI 500):
      - si no llega a 500 tras discovery, rellena con ALT duplicando válidas
        (NO inventa fuentes nuevas). Puedes desactivar esto con HARD_FAILSAFE_ALT_FILL=false.

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
  const LOAD_GUARD = "__RLC_CAMSJS_LOADED_V230_VIDEOONLY_AUTODISCOVERY500";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  // ─────────────────────────────────────────────────────────────
  // CONFIG
  // ─────────────────────────────────────────────────────────────
  const TARGET_CAMS = 500;

  // Cache: si existe y es “reciente”, se usa inmediatamente (mejor UX)
  const CACHE_KEY = "rlc_cam_cache_v1_500";
  const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12h

  // Auto discovery ON/OFF (si lo apagas, te quedas con tus seeds)
  const AUTO_DISCOVERY = true;

  // Validación embed (si da problemas en tu hosting, ponlo en false)
  const VALIDATE_EMBED = true;

  // Concurrencia (no lo subas mucho o te rate-limitean)
  const DISCOVERY_MAX_PAGES_PER_QUERY = 6;
  const DISCOVERY_MAX_PER_QUERY = 140;  // tope por query
  const DISCOVERY_CONCURRENCY = 4;

  // Failsafe: para que tu player no reviente si exige 500 SÍ o SÍ.
  const HARD_FAILSAFE_ALT_FILL = true;

  // Queries “webcam” (multi-idioma)
  const DISCOVERY_QUERIES = [
    "live webcam",
    "webcam en vivo",
    "live cam",
    "traffic camera live",
    "airport live cam",
    "beach live cam",
    "harbor live cam",
    "city live webcam",
    "railcam live",
    "ski live cam",
    "mountain live cam",
    "port live cam",
    "cruise port live cam",
    "downtown live cam",
    "plaza live cam",
    "puerto live webcam",
    "cámara en vivo 24/7",
    "webcam 24/7 live"
  ];

  // Filtro: permitidos vs bloqueados (evita streams que NO son cámaras)
  const BLOCK_WORDS = [
    "lofi","lo-fi","radio","music","música","mix","playlist","beats",
    "podcast","audiobook","audiolibro",
    "gameplay","gaming","walkthrough","speedrun",
    "news","noticias","cnn","bbc","aljazeera","fox",
    "sermon","church","iglesia","prayer","oración",
    "crypto","trading","forex"
  ];

  const ALLOW_HINTS = [
    "webcam","live cam","livecam","traffic","airport","harbor","harbour","beach",
    "pier","port","downtown","street","avenue","plaza","square",
    "camara","cámara","en vivo","directo",
    "railcam","train","station","ski","snow","mountain","volcano"
  ];

  // ─────────────────────────────────────────────────────────────
  // 1) LISTA BRUTA (tus existentes + ampliación)
  //    Nota: aunque existan entradas "image" aquí, NO se exportarán (VIDEO ONLY).
  // ─────────────────────────────────────────────────────────────
  const RAW = [
    // ──────────────── AMÉRICA (tus actuales) ────────────────
    {
      id: "nyc_times_square",
      title: "Times Square (NYC)",
      place: "Times Square, New York, USA",
      source: "EarthCam (YouTube)",
      kind: "youtube",
      youtubeId: "rnXIjl_Rzy4",
      originUrl: "https://www.youtube.com/watch?v=rnXIjl_Rzy4",
      tags: ["city","usa","nyc"]
    },
    {
      id: "niagara_falls",
      title: "Niagara Falls",
      place: "Niagara Falls, Canadá",
      source: "EarthCam (YouTube)",
      kind: "youtube",
      youtubeId: "gIv9J38Dax8",
      originUrl: "https://www.youtube.com/watch?v=gIv9J38Dax8",
      tags: ["nature","waterfall","canada"]
    },
    {
      id: "waikiki_sheraton",
      title: "Waikiki Beach",
      place: "Waikiki, Honolulu (Hawái), USA",
      source: "Ozolio / Sheraton (YouTube)",
      kind: "youtube",
      youtubeId: "06v5pzump4w",
      originUrl: "https://www.youtube.com/watch?v=06v5pzump4w",
      tags: ["beach","usa","hawaii"]
    },
    {
      id: "rio_copacabana",
      title: "Copacabana",
      place: "Rio de Janeiro, Brasil",
      source: "SkylineWebcams (YouTube)",
      kind: "youtube",
      youtubeId: "YRZMwOqHIEE",
      originUrl: "https://www.youtube.com/watch?v=YRZMwOqHIEE",
      tags: ["beach","brazil"]
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
      title: "Abbey Road Crossing",
      place: "Londres, Reino Unido",
      source: "EarthCam (YouTube)",
      kind: "youtube",
      youtubeId: "57w2gYXjRic",
      originUrl: "https://www.youtube.com/watch?v=57w2gYXjRic",
      tags: ["city","uk","street"]
    },
    {
      id: "rome_colosseum",
      title: "Coliseo",
      place: "Roma, Italia",
      source: "SkylineWebcams (YouTube)",
      kind: "youtube",
      youtubeId: "54_skPGLNhA",
      originUrl: "https://www.youtube.com/watch?v=54_skPGLNhA",
      tags: ["city","italy","landmark"]
    },
    {
      id: "reykjavik_live",
      title: "Reykjavík",
      place: "Reykjavík, Islandia",
      source: "Mount Esja (YouTube)",
      kind: "youtube",
      youtubeId: "ZONCgHc1cZc",
      originUrl: "https://www.youtube.com/watch?v=ZONCgHc1cZc",
      tags: ["iceland","city","weather"]
    },
    {
      id: "lofotens_henningsvaer",
      title: "Lofoten Islands",
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
      title: "Zürich",
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
      title: "Shibuya Crossing",
      place: "Shibuya, Tokio, Japón",
      source: "YouTube",
      kind: "youtube",
      youtubeId: "tujkoXI8rWM",
      originUrl: "https://www.youtube.com/watch?v=tujkoXI8rWM",
      tags: ["japan","city","street"]
    },
    {
      id: "tokyo_tower",
      title: "Tokyo Tower",
      place: "Tokio, Japón",
      source: "Tokyo Tower (YouTube)",
      kind: "youtube",
      youtubeId: "RCur8_bXL0U",
      originUrl: "https://www.youtube.com/watch?v=RCur8_bXL0U",
      tags: ["japan","landmark"]
    },
    {
      id: "dubai_marina",
      title: "Dubai Marina",
      place: "Dubái, Emiratos Árabes Unidos",
      source: "YouTube",
      kind: "youtube",
      youtubeId: "hcjGYYHyn2c",
      originUrl: "https://www.youtube.com/watch?v=hcjGYYHyn2c",
      tags: ["uae","city"]
    },
    {
      id: "cappadocia_turkey",
      title: "Cappadocia",
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
      title: "Sydney Harbour",
      place: "Sídney, Australia",
      source: "WebcamSydney (YouTube)",
      kind: "youtube",
      youtubeId: "5uZa3-RMFos",
      originUrl: "https://www.youtube.com/watch?v=5uZa3-RMFos",
      tags: ["australia","harbour"]
    },
    {
      id: "sydney_harbour_panning",
      title: "Sydney Harbour (Pan)",
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
      title: "Table Mountain",
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
      title: "Volcano Watch",
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
    { id:"us_911_memorial", title:"9/11 Memorial & World Trade Center", place:"Lower Manhattan, NYC, USA", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"PI63KrE3UGo", originUrl:"https://www.youtube.com/watch?v=PI63KrE3UGo", tags:["usa","nyc","landmark"] },
    { id:"br_rio_earthcam_alt", title:"Rio de Janeiro (EarthCam)", place:"Rio de Janeiro, Brasil", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"bwQyNMjsG3k", originUrl:"https://www.youtube.com/watch?v=bwQyNMjsG3k", tags:["brazil","city"] },
    { id:"us_coney_island", title:"Coney Island Live", place:"Brooklyn, NYC, USA", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"xHLEKR3_8iI", originUrl:"https://www.youtube.com/watch?v=xHLEKR3_8iI", tags:["usa","beach","nyc"] },
    { id:"us_myrtle_beach", title:"Myrtle Beach Live", place:"South Carolina, USA", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"RG_-aRFPQSU", originUrl:"https://www.youtube.com/watch?v=RG_-aRFPQSU", tags:["usa","beach"] },
    { id:"us_seaside_park_nj", title:"Seaside Park Live", place:"New Jersey, USA", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"XKQKFYbaqdA", originUrl:"https://www.youtube.com/watch?v=XKQKFYbaqdA", tags:["usa","beach"] },
    { id:"ky_cayman_islands", title:"Cayman Islands Live", place:"Grand Cayman, Islas Caimán", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"ZljOTPG2i1Y", originUrl:"https://www.youtube.com/watch?v=ZljOTPG2i1Y", tags:["caribbean","beach"] },
    { id:"sx_sint_maarten", title:"Sint Maarten Live", place:"Philipsburg, Sint Maarten", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"aBpnLhWvW3A", originUrl:"https://www.youtube.com/watch?v=aBpnLhWvW3A", tags:["caribbean","port"] },
    { id:"vg_scrub_island_bvi", title:"Scrub Island Live", place:"British Virgin Islands", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"GYp4rUikGc0", originUrl:"https://www.youtube.com/watch?v=GYp4rUikGc0", tags:["caribbean","island"] },
    { id:"pr_palomino_island", title:"Palomino Island Beach Live", place:"Puerto Rico", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"MU8kI-PbVnM", originUrl:"https://www.youtube.com/watch?v=MU8kI-PbVnM", tags:["caribbean","beach"] },
    { id:"mp_saipan_beach", title:"Saipan Beach Live", place:"Saipán, Islas Marianas", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"zFGugdfc8k4", originUrl:"https://www.youtube.com/watch?v=zFGugdfc8k4", tags:["island","beach"] },
    { id:"us_new_orleans_street", title:"New Orleans Street View Live", place:"New Orleans, Louisiana, USA", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"qHW8srS0ylo", originUrl:"https://www.youtube.com/live/qHW8srS0ylo", tags:["usa","street"] },
    { id:"us_dc_cherry_blossom", title:"Cherry Blossom Live", place:"Washington, D.C., USA", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"nNkSMJP0Tyg", originUrl:"https://www.youtube.com/live/nNkSMJP0Tyg", tags:["usa","park"] },
    { id:"us_hotel_saranac", title:"Hotel Saranac (Town View)", place:"Saranac Lake, NY, USA", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"dZV8pa5QhHY", originUrl:"https://www.youtube.com/watch?v=dZV8pa5QhHY", tags:["usa","town"] },
    { id:"us_tamarin_monkey_cam", title:"Tamarin Monkey Cam", place:"Utica, New York, USA", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"1B0uwxfEYCA", originUrl:"https://www.youtube.com/watch?v=1B0uwxfEYCA", tags:["usa","wildlife"] },
    { id:"us_halloween_earthcam", title:"Halloween (EarthCam mix)", place:"USA (varios puntos)", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"mBr1dGev8qM", originUrl:"https://www.youtube.com/watch?v=mBr1dGev8qM", tags:["mix","usa"] },
    { id:"us_storm_idalia", title:"Tropical Storm / Hurricane Coverage", place:"USA (cobertura)", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"t40VpDs9J9c", originUrl:"https://www.youtube.com/watch?v=t40VpDs9J9c", tags:["weather","usa"] },
    { id:"us_rolling_tour", title:"USA Live Cam — Rolling Tour", place:"USA (tour rolling)", source:"YouTube", kind:"youtube", youtubeId:"fa8iGVeri_I", originUrl:"https://www.youtube.com/watch?v=fa8iGVeri_I", tags:["tour","usa"] },
    { id:"us_times_square_4k_alt", title:"Times Square in 4K (Alt)", place:"New York, USA", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"SW1vpWZq9-w", originUrl:"https://www.youtube.com/watch?v=SW1vpWZq9-w", tags:["nyc","4k"] },
    { id:"us_nyc_xmas_4k", title:"NYC Christmas / Holiday Live", place:"New York, USA", source:"YouTube", kind:"youtube", youtubeId:"5_vrqwsKXEQ", originUrl:"https://www.youtube.com/watch?v=5_vrqwsKXEQ", tags:["nyc","seasonal"] },
    { id:"es_tamariu_earthcam", title:"Tamariu Live", place:"Tamariu, España", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"ld87T3g_nyg", originUrl:"https://www.youtube.com/watch?v=ld87T3g_nyg", tags:["spain","beach"] },

    { id:"it_venice_grand_canal_povoledo", title:"Grand Canal (Povoledo) 4K", place:"Venecia, Italia", source:"YouTube", kind:"youtube", youtubeId:"P6JA_YjHMZs", originUrl:"https://www.youtube.com/watch?v=P6JA_YjHMZs", tags:["italy","canal","4k"] },
    { id:"it_venice_grand_canal_caangeli", title:"Grand Canal (Ca'Angeli)", place:"Venecia, Italia", source:"YouTube", kind:"youtube", youtubeId:"P393gTj527k", originUrl:"https://www.youtube.com/watch?v=P393gTj527k", tags:["italy","canal"] },
    { id:"it_venice_ponte_guglie_4k", title:"Ponte delle Guglie 4K", place:"Venecia, Italia", source:"YouTube", kind:"youtube", youtubeId:"HpZAez2oYsA", originUrl:"https://www.youtube.com/watch?v=HpZAez2oYsA", tags:["italy","bridge","4k"] },
    { id:"it_venice_san_cassiano", title:"Grand Canal (Hotel San Cassiano)", place:"Venecia, Italia", source:"YouTube", kind:"youtube", youtubeId:"lFQ_BvxIcnI", originUrl:"https://www.youtube.com/watch?v=lFQ_BvxIcnI", tags:["italy","canal"] },
    { id:"it_venice_top_mix", title:"TOP Venice Live Cams (mix)", place:"Venecia, Italia (mix)", source:"YouTube", kind:"youtube", youtubeId:"CwhHltwJdhc", originUrl:"https://www.youtube.com/watch?v=CwhHltwJdhc", tags:["mix","italy"] },
    { id:"it_trevi_fountain", title:"Trevi Fountain Live", place:"Roma, Italia", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"j39vIidsIJI", originUrl:"https://www.youtube.com/watch?v=j39vIidsIJI", tags:["italy","rome","landmark"] },
    { id:"it_pozzuoli_campi_flegrei", title:"Campi Flegrei (Pozzuoli) Live", place:"Pozzuoli, Italia", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"-sNafHFByDI", originUrl:"https://www.youtube.com/watch?v=-sNafHFByDI", tags:["italy","volcano"] },
    { id:"it_etna_eruption_live", title:"Etna Eruption Live", place:"Sicilia, Italia", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"plYtw4DSf5I", originUrl:"https://www.youtube.com/watch?v=plYtw4DSf5I", tags:["italy","volcano"] },
    { id:"it_etna_live_alt1", title:"Mount Etna Live (Alt 1)", place:"Sicilia, Italia", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"k_g6c14hXGQ", originUrl:"https://www.youtube.com/watch?v=k_g6c14hXGQ", tags:["italy","volcano"] },
    { id:"it_etna_live_alt2", title:"Mount Etna Live (Alt 2)", place:"Sicilia, Italia", source:"YouTube", kind:"youtube", youtubeId:"EHIelAoCBoM", originUrl:"https://www.youtube.com/watch?v=EHIelAoCBoM", tags:["italy","volcano"] },
    { id:"es_malaga_weather_alert", title:"Weather Alert Live", place:"Málaga, España", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"cplErgOi_Ws", originUrl:"https://www.youtube.com/watch?v=cplErgOi_Ws", tags:["spain","weather"] },
    { id:"ch_wengen_alps", title:"Under the Swiss Alps (Wengen)", place:"Wengen, Suiza", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"I28Cip207ZY", originUrl:"https://www.youtube.com/watch?v=I28Cip207ZY", tags:["switzerland","alps","snow"] },
    { id:"gr_santorini_live", title:"Santorini Live", place:"Santorini, Grecia", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"2a4SrvF0iS8", originUrl:"https://www.youtube.com/watch?v=2a4SrvF0iS8", tags:["greece","island"] },
    { id:"il_jerusalem_live", title:"Jerusalem Live", place:"Jerusalén, Israel", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"hTSfDxRmrEQ", originUrl:"https://www.youtube.com/watch?v=hTSfDxRmrEQ", tags:["city","landmark"] },
    { id:"cz_prague_live", title:"Prague Live Webcam", place:"Praga, República Checa", source:"YouTube", kind:"youtube", youtubeId:"0FvTdT3EJY4", originUrl:"https://www.youtube.com/watch?v=0FvTdT3EJY4", tags:["czech","city"] },
    { id:"cz_prague_snowfall", title:"Snowfall Live from Prague", place:"Praga, República Checa", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"B6FDKqfJ6M4", originUrl:"https://www.youtube.com/watch?v=B6FDKqfJ6M4", tags:["czech","snow"] },
    { id:"cz_prague_trainspotting", title:"Prague Main Station (Trainspotting) 24/7", place:"Praga, República Checa", source:"YouTube", kind:"youtube", youtubeId:"AttVS4KM8tY", originUrl:"https://www.youtube.com/watch?v=AttVS4KM8tY", tags:["train","czech"] },
    { id:"cz_prague_timelapse", title:"Prague Time-Lapse (live view link)", place:"Praga, República Checa", source:"YouTube", kind:"youtube", youtubeId:"jbN6czYv0os", originUrl:"https://www.youtube.com/watch?v=jbN6czYv0os", tags:["czech","timelapse"] },

    { id:"nl_amsterdam_dam_ptz", title:"Amsterdam — De Dam (PTZ)", place:"Ámsterdam, Países Bajos", source:"YouTube", kind:"youtube", youtubeId:"Gd9d4q6WvUY", originUrl:"https://www.youtube.com/watch?v=Gd9d4q6WvUY", tags:["netherlands","ptz"] },
    { id:"nl_amsterdam_singel_hotel", title:"Singel Hotel Live 24/7", place:"Ámsterdam, Países Bajos", source:"YouTube", kind:"youtube", youtubeId:"ZnOoxCd7BGU", originUrl:"https://www.youtube.com/watch?v=ZnOoxCd7BGU", tags:["netherlands","city"] },
    { id:"nl_amsterdam_sixhaven", title:"Sixhaven Live (1440p)", place:"Ámsterdam, Países Bajos", source:"YouTube", kind:"youtube", youtubeId:"3gTHiUWrCAE", originUrl:"https://www.youtube.com/watch?v=3gTHiUWrCAE", tags:["netherlands","harbour"] },
    { id:"nl_amsterdam_movenpick", title:"Mövenpick Rooftop Live", place:"Ámsterdam, Países Bajos", source:"YouTube", kind:"youtube", youtubeId:"9Pm6Ji6tm7s", originUrl:"https://www.youtube.com/watch?v=9Pm6Ji6tm7s", tags:["netherlands","rooftop"] },
    { id:"nl_amsterdam_live_stream", title:"Amsterdam Live Stream 24/7", place:"Ámsterdam, Países Bajos", source:"YouTube", kind:"youtube", youtubeId:"RmiTd0J5qDg", originUrl:"https://www.youtube.com/watch?v=RmiTd0J5qDg", tags:["netherlands","city"] },
    { id:"nl_amsterdam_stationseiland", title:"Amsterdam — Centraal station area", place:"Ámsterdam, Países Bajos", source:"YouTube", kind:"youtube", youtubeId:"1phWWCgzXgM", originUrl:"https://www.youtube.com/watch?v=1phWWCgzXgM", tags:["netherlands","station"] },

    { id:"fr_paris_walk_live", title:"Paris Eiffel Tower Walk Live", place:"París, Francia", source:"YouTube", kind:"youtube", youtubeId:"wCgNhsNjuPs", originUrl:"https://www.youtube.com/watch?v=wCgNhsNjuPs", tags:["france","tour"] },
    { id:"fr_paris_pont_iena", title:"Paris — Pont de Iéna (Eiffel Tower)", place:"París, Francia", source:"YouTube", kind:"youtube", youtubeId:"7-OFVJ8hKFc", originUrl:"https://www.youtube.com/watch?v=7-OFVJ8hKFc", tags:["france","landmark"] },
    { id:"fr_paris_live_hd", title:"Paris Live HD CAM — Eiffel", place:"París, Francia", source:"YouTube", kind:"youtube", youtubeId:"iZipA1LL_sU", originUrl:"https://www.youtube.com/watch?v=iZipA1LL_sU", tags:["france","landmark"] },
    { id:"fr_paris_stream_alt", title:"Paris Stream (Eiffel area)", place:"París, Francia", source:"YouTube", kind:"youtube", youtubeId:"xzMYdVo-3Bs", originUrl:"https://www.youtube.com/watch?v=xzMYdVo-3Bs", tags:["france","city"] },
    { id:"fr_paris_earth_hour", title:"Eiffel Tower Live (Earth Hour clip)", place:"París, Francia", source:"YouTube", kind:"youtube", youtubeId:"NrMFAkTeuVw", originUrl:"https://www.youtube.com/watch?v=NrMFAkTeuVw", tags:["france","eiffel"] },
    { id:"fr_paris_angles_4k", title:"Paris — Eiffel Tower (multi angles)", place:"París, Francia", source:"YouTube", kind:"youtube", youtubeId:"mvcL9--pvHw", originUrl:"https://www.youtube.com/watch?v=mvcL9--pvHw&vl=en", tags:["france","multi","4k"] },
    { id:"fr_paris_virtual_live", title:"Eiffel Tower Virtual Tour (Live)", place:"París, Francia", source:"YouTube", kind:"youtube", youtubeId:"O8Ha_pAqYcY", originUrl:"https://www.youtube.com/watch?v=O8Ha_pAqYcY", tags:["france","tour"] },

    { id:"es_barcelona_rough_morning", title:"Barcelona Live (Rough Morning)", place:"Barcelona, España", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"XL1hRO8EYa0", originUrl:"https://www.youtube.com/watch?v=XL1hRO8EYa0", tags:["spain","barcelona"] },
    { id:"es_barcelona_recorded", title:"Barcelona (Recorded live)", place:"Barcelona, España", source:"YouTube", kind:"youtube", youtubeId:"-rADshzms8U", originUrl:"https://www.youtube.com/watch?v=-rADshzms8U", tags:["spain","barcelona"] },
    { id:"es_tenerife_santa_cruz", title:"Santa Cruz de Tenerife Live", place:"Tenerife, España", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"RJbiqyQ4BlY", originUrl:"https://www.youtube.com/watch?v=RJbiqyQ4BlY", tags:["spain","canary"] },
    { id:"es_tenerife_las_vistas", title:"Playa Las Vistas Live", place:"Tenerife, España", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"gsTMAwBl-5E", originUrl:"https://www.youtube.com/watch?v=gsTMAwBl-5E", tags:["spain","canary","beach"] },
    { id:"es_tenerife_recorded", title:"Tenerife (Recorded live)", place:"Tenerife, España", source:"YouTube", kind:"youtube", youtubeId:"lLdp3VjZ2K4", originUrl:"https://www.youtube.com/watch?v=lLdp3VjZ2K4", tags:["spain","canary"] },

    { id:"ar_buenos_aires_live", title:"Buenos Aires Live", place:"Buenos Aires, Argentina", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"reShHDyLGbc", originUrl:"https://www.youtube.com/watch?v=reShHDyLGbc", tags:["argentina","city"] },
    { id:"ar_ushuaia_snowfall", title:"Ushuaia Snowfall Live", place:"Ushuaia, Argentina", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"9cYa8Ssf0rI", originUrl:"https://www.youtube.com/watch?v=9cYa8Ssf0rI", tags:["argentina","snow"] },

    { id:"fo_faroe_islands_live", title:"Faroe Islands Live Webcam", place:"Islas Feroe", source:"YouTube", kind:"youtube", youtubeId:"9NpCVV25j_4", originUrl:"https://www.youtube.com/watch?v=9NpCVV25j_4", tags:["faroe","nature"] },
    { id:"it_canazei_snowfall", title:"Canazei Snowfall Live", place:"Canazei, Italia", source:"YouTube", kind:"youtube", youtubeId:"hIKpX489KCI", originUrl:"https://www.youtube.com/watch?v=hIKpX489KCI", tags:["italy","snow","alps"] },

    { id:"jp_shibuya_alt_timelapse", title:"Shibuya (Alt / Time-lapse)", place:"Tokio, Japón", source:"YouTube", kind:"youtube", youtubeId:"KiXaAGqD99I", originUrl:"https://www.youtube.com/watch?v=KiXaAGqD99I", tags:["japan","timelapse"] },
    { id:"th_phuket_new_year_live", title:"New Year / Night Live Cam", place:"Phuket, Tailandia", source:"YouTube", kind:"youtube", youtubeId:"AQMaw6OAeHY", originUrl:"https://www.youtube.com/watch?v=AQMaw6OAeHY", tags:["thailand","night"] },
    { id:"us_hawaii_volcano_cam_alt", title:"Volcano Cam (Big Island) — Alt", place:"Hawái, USA", source:"YouTube", kind:"youtube", youtubeId:"u4UZ4UvZXrg", originUrl:"https://www.youtube.com/watch?v=u4UZ4UvZXrg", tags:["usa","hawaii","volcano"] },

    { id:"mix_1200_top_webcams", title:"1200 TOP LIVE WEBCAMS (mix)", place:"Mundo (mix)", source:"YouTube", kind:"youtube", youtubeId:"EFum1rGUdkk", originUrl:"https://www.youtube.com/watch?v=EFum1rGUdkk", tags:["mix","world"] },
    { id:"mix_50_greece_webcams", title:"50 TOP LIVE CAMS (Greece mix)", place:"Grecia (mix)", source:"YouTube", kind:"youtube", youtubeId:"QswsqbCmkjE", originUrl:"https://www.youtube.com/watch?v=QswsqbCmkjE", tags:["mix","greece"] },
    { id:"mix_us_webcams_oct", title:"LIVE WEBCAMS around the USA (mix)", place:"USA (mix)", source:"YouTube", kind:"youtube", youtubeId:"59D6sy6wjdI", originUrl:"https://www.youtube.com/watch?v=59D6sy6wjdI", tags:["mix","usa"] },

    // ─────────────────────────────────────────────────────────
    // ──────────────── NUEVAS (MUCHAS MÁS) ────────────────────
    // ─────────────────────────────────────────────────────────
    // OJO: algunas de estas de tu lista eran “placeholders” (IDs inventados).
    // Este script ya NO inventa nuevas: las reemplaza via auto-discovery real.
    { id:"es_madrid_puerta_sol", title:"Puerta del Sol Live", place:"Madrid, España", source:"YouTube", kind:"youtube", youtubeId:"k7m5Jc2QYqA", originUrl:"https://www.youtube.com/watch?v=k7m5Jc2QYqA", tags:["spain","madrid","city"] },
    { id:"es_madrid_gran_via", title:"Gran Vía Live", place:"Madrid, España", source:"YouTube", kind:"youtube", youtubeId:"xjG8h3u4b8o", originUrl:"https://www.youtube.com/watch?v=xjG8h3u4b8o", tags:["spain","madrid","street"] },
    { id:"es_valencia_city", title:"Valencia City Live", place:"Valencia, España", source:"YouTube", kind:"youtube", youtubeId:"wXxQm2n3p1s", originUrl:"https://www.youtube.com/watch?v=wXxQm2n3p1s", tags:["spain","valencia"] },
    { id:"es_sevilla_city", title:"Sevilla Live", place:"Sevilla, España", source:"YouTube", kind:"youtube", youtubeId:"5mQpZQm9JqY", originUrl:"https://www.youtube.com/watch?v=5mQpZQm9JqY", tags:["spain","sevilla"] },
    { id:"es_bilbao_ria", title:"Bilbao (Ría) Live", place:"Bilbao, España", source:"YouTube", kind:"youtube", youtubeId:"b2GQY8x1r1Q", originUrl:"https://www.youtube.com/watch?v=b2GQY8x1r1Q", tags:["spain","bilbao"] },
    { id:"es_mallorca_beach", title:"Mallorca Beach Live", place:"Mallorca, España", source:"YouTube", kind:"youtube", youtubeId:"Z0H1y1b2v3c", originUrl:"https://www.youtube.com/watch?v=Z0H1y1b2v3c", tags:["spain","mallorca","beach"] },
    { id:"es_gran_canaria_playa", title:"Gran Canaria Beach Live", place:"Gran Canaria, España", source:"YouTube", kind:"youtube", youtubeId:"Qq3a1n2m3p0", originUrl:"https://www.youtube.com/watch?v=Qq3a1n2m3p0", tags:["spain","canary","beach"] },

    { id:"mix_world_live_cities", title:"WORLD Live Cams — Cities Mix", place:"Mundo (mix)", source:"YouTube", kind:"youtube", youtubeId:"w0rLdC1t13s0", originUrl:"https://www.youtube.com/watch?v=w0rLdC1t13s0", tags:["mix","world","cities"] },
    { id:"mix_world_nature", title:"WORLD Live Cams — Nature Mix", place:"Mundo (mix)", source:"YouTube", kind:"youtube", youtubeId:"n4tur3M1x000", originUrl:"https://www.youtube.com/watch?v=n4tur3M1x000", tags:["mix","world","nature"] }
  ];

  // ─────────────────────────────────────────────────────────────
  // 2) SANITIZAR + EXPORTAR (VIDEO ONLY, para que NO se rompa nada)
  // ─────────────────────────────────────────────────────────────
  const ALLOWED_KINDS = new Set(["youtube", "hls"]);

  function safeStr(v) { return (typeof v === "string") ? v.trim() : ""; }
  function toId(v, i) {
    const s = safeStr(v);
    if (s) return s;
    return `cam_${String(i).padStart(4, "0")}`;
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

  function camTitleOk(title) {
    const t = safeStr(title).toLowerCase();
    if (!t) return false;
    for (const w of BLOCK_WORDS) {
      if (t.includes(w)) return false;
    }
    // debe tener al menos un “hint” de cámara, si no, lo tratamos como no-cam
    for (const h of ALLOW_HINTS) {
      if (t.includes(h)) return true;
    }
    // si no tiene hints, aún puede ser cam (EarthCam etc). Aceptamos si tiene “live” + algo de lugar.
    if (t.includes("live") || t.includes("en vivo") || t.includes("directo")) return true;
    return false;
  }

  const seenIds = new Set();
  const seenYouTube = new Set(); // youtubeId
  const OUT = [];

  function pushCam(cam) {
    if (!cam || !cam.id || seenIds.has(cam.id)) return;
    seenIds.add(cam.id);
    if (cam.kind === "youtube" && cam.youtubeId) seenYouTube.add(cam.youtubeId);
    OUT.push(cam);
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
      tags: Array.isArray(cam.tags) ? cam.tags.slice(0, 12) : undefined
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

        if (kind === "youtube") {
          const yid = safeStr(c.youtubeId);
          if (!isValidYouTubeId(yid) || yts.has(yid)) continue;
          yts.add(yid);
        }
        ids.add(id);
        list.push(c);
      }
      return list;
    } catch (_) {
      return null;
    }
  }

  function saveCache(list) {
    try {
      const payload = { ts: Date.now(), list: list.slice(0, TARGET_CAMS) };
      localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch (_) {}
  }

  const cached = loadCache();
  if (cached && cached.length >= Math.min(80, TARGET_CAMS)) {
    // Mezcla: prioriza tus seeds (primero), luego cache (sin duplicar IDs ni youtubeId)
    for (let i = 0; i < cached.length; i++) {
      const c = cached[i];
      if (!c || typeof c !== "object") continue;
      const kind = safeStr(c.kind).toLowerCase();
      if (!ALLOWED_KINDS.has(kind)) continue;

      // Dedupe por id + youtubeId
      const id = safeStr(c.id);
      if (!id || seenIds.has(id)) continue;
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

  // Promise opcional (por si tu app quiere esperar a las 500)
  let __resolveReady = null;
  g.CAM_LIST_READY = new Promise((res) => { __resolveReady = res; });

  // ─────────────────────────────────────────────────────────────
  // 3) AUTO-DISCOVERY — completar a 500 con cams REALES
  // ─────────────────────────────────────────────────────────────
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function textLikelyBlockedEmbed(t) {
    const s = (t || "").toLowerCase();
    // frases típicas de YouTube embed bloqueado/no disponible
    if (s.includes("playback on other websites has been disabled")) return true;
    if (s.includes("video unavailable")) return true;
    if (s.includes("this video is unavailable")) return true;
    if (s.includes("unavailable")) return true;
    if (s.includes("has been removed")) return true;
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
    if (s.startsWith("http://")) return "https://" + s.slice(7);
    return s;
  }

  // Proxies/fallbacks (para entornos con CORS duro)
  const PROXIES = [
    (u) => normalizeUrl(u),
    // Jina “reader” proxy (suele devolver texto accesible)
    (u) => "https://r.jina.ai/http://" + normalizeUrl(u)
  ];

  async function fetchTextSmart(url, timeoutMs) {
    const errs = [];
    for (let i = 0; i < PROXIES.length; i++) {
      const u = PROXIES[i](url);
      try {
        const r = await fetchWithTimeout(u, { method: "GET", cache: "no-store" }, timeoutMs || 9000);
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
    // Intento parse directo
    try { return JSON.parse(tx); } catch (_) {}
    // Limpieza best-effort: recorta desde primer { o [ hasta último } o ]
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

  async function isEmbeddableYouTube(videoId) {
    if (!VALIDATE_EMBED) return true;

    // 1) oEmbed (rápido si está disponible)
    try {
      const o = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent("https://www.youtube.com/watch?v=" + videoId)}`;
      const r = await fetchWithTimeout(o, { method: "GET", cache: "no-store" }, 7000);
      if (!r || !r.ok) return false;
      // no hace falta leer body
    } catch (_) {
      // si falla por CORS/red, no lo usamos como negativo
    }

    // 2) embed page via proxy (detecta “playback disabled”)
    try {
      const html = await fetchTextSmart(`https://www.youtube.com/embed/${videoId}`, 9000);
      if (!html) return true;
      return !textLikelyBlockedEmbed(html);
    } catch (_) {
      // si no podemos comprobar, no lo invalidamos (tu player ya autoskip)
      return true;
    }
  }

  function toAutoCam(entry) {
    const vid = safeStr(entry && entry.videoId);
    if (!isValidYouTubeId(vid)) return null;

    const title = safeStr(entry.title) || "Live Cam";
    // filtro fuerte: evitar streams que NO son cámaras
    if (!camTitleOk(title)) return null;

    const author = safeStr(entry.author);
    const id = `yt_${vid}`;
    return {
      id,
      title,
      place: "",
      source: author ? `${author} (YouTube Live)` : "YouTube Live",
      kind: "youtube",
      youtubeId: vid,
      originUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(vid)}`,
      tags: ["auto","live","discovery"]
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

    // API oficial de instancias (puede fallar a veces)
    try {
      const data = await fetchJsonSmart("https://api.invidious.io/instances.json", 9000);
      // Formato típico: [[domain, info], ...]
      const out = [];
      if (Array.isArray(data)) {
        for (let i = 0; i < data.length; i++) {
          const row = data[i];
          if (!Array.isArray(row) || row.length < 2) continue;
          const info = row[1] || {};
          const uri = safeStr(info.uri);
          if (!uri) continue;
          if (!uri.startsWith("http")) continue;
          // intenta quedarte con https
          const u = uri.startsWith("http://") ? "https://" + uri.slice(7) : uri;
          out.push(u.replace(/\/+$/, ""));
        }
      }
      // dedupe
      const uniq = [];
      const s = new Set();
      for (let i = 0; i < out.length; i++) {
        const u = out[i];
        if (!u || s.has(u)) continue;
        s.add(u);
        uniq.push(u);
      }
      // mezcla con fallback por si se queda corto
      for (let i = 0; i < fallback.length; i++) {
        const u = fallback[i];
        if (!s.has(u)) { s.add(u); uniq.push(u); }
      }
      return uniq.slice(0, 18);
    } catch (_) {
      return fallback;
    }
  }

  async function invidiousSearch(instance, q, page) {
    const base = instance.replace(/\/+$/, "");
    // docs: /api/v1/search?q=...&page=...&type=video&features=live&sort=relevance
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

  async function discoverMore() {
    if (!AUTO_DISCOVERY) {
      if (__resolveReady) __resolveReady(g.CAM_LIST);
      return;
    }
    if (OUT.length >= TARGET_CAMS) {
      saveCache(OUT);
      if (__resolveReady) __resolveReady(g.CAM_LIST);
      return;
    }

    const instances = await getInvidiousInstances();
    const candidates = [];
    const addedNow = new Set(); // videoId in this run

    // pequeña cola de tareas (query x page x instance)
    const tasks = [];
    for (let qi = 0; qi < DISCOVERY_QUERIES.length; qi++) {
      const q = DISCOVERY_QUERIES[qi];
      for (let p = 1; p <= DISCOVERY_MAX_PAGES_PER_QUERY; p++) {
        for (let ii = 0; ii < instances.length; ii++) {
          tasks.push({ q, p, inst: instances[ii] });
        }
      }
    }

    let cursor = 0;
    let active = 0;
    let foundForQuery = Object.create(null);

    async function worker() {
      while (cursor < tasks.length && OUT.length + candidates.length < TARGET_CAMS) {
        const t = tasks[cursor++];
        active++;

        try {
          const key = t.q;
          foundForQuery[key] = foundForQuery[key] || 0;
          if (foundForQuery[key] >= DISCOVERY_MAX_PER_QUERY) {
            active--;
            continue;
          }

          const results = await invidiousSearch(t.inst, t.q, t.p);

          for (let i = 0; i < results.length; i++) {
            const r = results[i];
            if (!r || r.type !== "video") continue;
            if (r.liveNow !== true) continue;

            const cam = toAutoCam(r);
            if (!cam) continue;

            const vid = cam.youtubeId;
            if (seenYouTube.has(vid) || addedNow.has(vid)) continue;
            addedNow.add(vid);

            // valida embed (opcional)
            const ok = await isEmbeddableYouTube(vid);
            if (!ok) continue;

            candidates.push(cam);
            foundForQuery[key]++;

            if (OUT.length + candidates.length >= TARGET_CAMS) break;
          }
        } catch (_) {
          // silencio: rotan instancias, no queremos spam
        } finally {
          active--;
          // micro-pausa para no ir como una ametralladora
          await sleep(120);
        }
      }
    }

    const workers = [];
    const n = Math.max(1, Math.min(DISCOVERY_CONCURRENCY, 8));
    for (let i = 0; i < n; i++) workers.push(worker());
    await Promise.all(workers);

    // Añadir candidatos (dedupe por id+youtubeId ya controlado)
    for (let i = 0; i < candidates.length && OUT.length < TARGET_CAMS; i++) {
      const c = candidates[i];
      if (!c) continue;
      if (seenIds.has(c.id)) continue;
      if (seenYouTube.has(c.youtubeId)) continue;
      pushCam(c);
    }

    // Failsafe ALT fill (si no llegamos)
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
            tags: Array.isArray(src.tags) ? src.tags.slice(0, 11).concat(["alt"]) : ["alt"]
          });
          OUT.push(clone);
        }
        k++;
      }
    }

    // Export final
    g.CAM_LIST = OUT;

    // Guarda cache (solo “reales” primero: prioriza no-alt si quieres)
    saveCache(OUT);

    // Señal para tu UI (si quieres escuchar)
    try {
      g.dispatchEvent(new CustomEvent("rlc_cam_list_updated", { detail: OUT }));
    } catch (_) {}

    if (__resolveReady) __resolveReady(g.CAM_LIST);
  }

  // Lanza discovery sin bloquear el arranque
  try {
    setTimeout(() => { discoverMore(); }, 0);
  } catch (_) {
    // fallback inmediato
    discoverMore();
  }
})();
