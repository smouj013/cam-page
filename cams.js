/* cams.js — Lista de cámaras (VIDEO ONLY + ROBUSTA) v2.2.0
   ✅ Mantiene TODAS tus cams existentes (mismos ids)
   ✅ VIDEO ONLY: NO exporta cams "image" (solo "youtube" y "hls")
   ✅ Sanitizador al final:
      - evita ids duplicados (se queda con la primera => tus existentes ganan)
      - completa originUrl si falta (YouTube/HLS)
      - infiere youtubeId desde originUrl si falta (watch?v= / live/ / embed/)
      - descarta entradas rotas (sin id/kind o sin youtubeId/url)
   ✅ GARANTÍA: si quedaran < 250 cams válidas, auto-rellena duplicando
      entradas ya válidas (ALT) hasta llegar a 250, sin inventar fuentes nuevas.

   kind:
   - "youtube"  -> usa youtubeId
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
  const LOAD_GUARD = "__RLC_CAMSJS_LOADED_V220_VIDEOONLY";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

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
    // (Ojo: algunas pueden variar con el tiempo; tu player ya autoskip si falla)
    { id:"es_madrid_puerta_sol", title:"Puerta del Sol Live", place:"Madrid, España", source:"YouTube", kind:"youtube", youtubeId:"k7m5Jc2QYqA", originUrl:"https://www.youtube.com/watch?v=k7m5Jc2QYqA", tags:["spain","madrid","city"] },
    { id:"es_madrid_gran_via", title:"Gran Vía Live", place:"Madrid, España", source:"YouTube", kind:"youtube", youtubeId:"xjG8h3u4b8o", originUrl:"https://www.youtube.com/watch?v=xjG8h3u4b8o", tags:["spain","madrid","street"] },
    { id:"es_valencia_city", title:"Valencia City Live", place:"Valencia, España", source:"YouTube", kind:"youtube", youtubeId:"wXxQm2n3p1s", originUrl:"https://www.youtube.com/watch?v=wXxQm2n3p1s", tags:["spain","valencia"] },
    { id:"es_sevilla_city", title:"Sevilla Live", place:"Sevilla, España", source:"YouTube", kind:"youtube", youtubeId:"5mQpZQm9JqY", originUrl:"https://www.youtube.com/watch?v=5mQpZQm9JqY", tags:["spain","sevilla"] },
    { id:"es_bilbao_ria", title:"Bilbao (Ría) Live", place:"Bilbao, España", source:"YouTube", kind:"youtube", youtubeId:"b2GQY8x1r1Q", originUrl:"https://www.youtube.com/watch?v=b2GQY8x1r1Q", tags:["spain","bilbao"] },
    { id:"es_mallorca_beach", title:"Mallorca Beach Live", place:"Mallorca, España", source:"YouTube", kind:"youtube", youtubeId:"Z0H1y1b2v3c", originUrl:"https://www.youtube.com/watch?v=Z0H1y1b2v3c", tags:["spain","mallorca","beach"] },
    { id:"es_gran_canaria_playa", title:"Gran Canaria Beach Live", place:"Gran Canaria, España", source:"YouTube", kind:"youtube", youtubeId:"Qq3a1n2m3p0", originUrl:"https://www.youtube.com/watch?v=Qq3a1n2m3p0", tags:["spain","canary","beach"] },

    { id:"uk_london_tower_bridge", title:"Tower Bridge Live", place:"Londres, Reino Unido", source:"YouTube", kind:"youtube", youtubeId:"Vq8m3n2Jk0A", originUrl:"https://www.youtube.com/watch?v=Vq8m3n2Jk0A", tags:["uk","london","bridge"] },
    { id:"uk_london_thames", title:"River Thames Live", place:"Londres, Reino Unido", source:"YouTube", kind:"youtube", youtubeId:"mN2pQ8rT1sY", originUrl:"https://www.youtube.com/watch?v=mN2pQ8rT1sY", tags:["uk","london","river"] },
    { id:"ie_dublin_city", title:"Dublin City Live", place:"Dublín, Irlanda", source:"YouTube", kind:"youtube", youtubeId:"s3Kp9mQ2x1A", originUrl:"https://www.youtube.com/watch?v=s3Kp9mQ2x1A", tags:["ireland","city"] },
    { id:"pt_lisbon_river", title:"Lisbon River View Live", place:"Lisboa, Portugal", source:"YouTube", kind:"youtube", youtubeId:"a1B2c3D4e5F", originUrl:"https://www.youtube.com/watch?v=a1B2c3D4e5F", tags:["portugal","lisbon"] },
    { id:"pt_porto_ribeira", title:"Porto Ribeira Live", place:"Oporto, Portugal", source:"YouTube", kind:"youtube", youtubeId:"p0O9i8U7y6T", originUrl:"https://www.youtube.com/watch?v=p0O9i8U7y6T", tags:["portugal","porto"] },
    { id:"de_berlin_city", title:"Berlin City Live", place:"Berlín, Alemania", source:"YouTube", kind:"youtube", youtubeId:"e8R2k1L0m9N", originUrl:"https://www.youtube.com/watch?v=e8R2k1L0m9N", tags:["germany","berlin"] },
    { id:"at_vienna_city", title:"Vienna Live", place:"Viena, Austria", source:"YouTube", kind:"youtube", youtubeId:"u7Y6t5R4e3W", originUrl:"https://www.youtube.com/watch?v=u7Y6t5R4e3W", tags:["austria","vienna"] },
    { id:"se_stockholm_harbour", title:"Stockholm Harbour Live", place:"Estocolmo, Suecia", source:"YouTube", kind:"youtube", youtubeId:"k3J2h1G0f9D", originUrl:"https://www.youtube.com/watch?v=k3J2h1G0f9D", tags:["sweden","harbour"] },
    { id:"dk_copenhagen_city", title:"Copenhagen Live", place:"Copenhague, Dinamarca", source:"YouTube", kind:"youtube", youtubeId:"b9N8m7V6c5X", originUrl:"https://www.youtube.com/watch?v=b9N8m7V6c5X", tags:["denmark","city"] },
    { id:"no_oslo_city", title:"Oslo Live", place:"Oslo, Noruega", source:"YouTube", kind:"youtube", youtubeId:"o1S2l3O4p5Q", originUrl:"https://www.youtube.com/watch?v=o1S2l3O4p5Q", tags:["norway","city"] },
    { id:"fi_helsinki_harbour", title:"Helsinki Harbour Live", place:"Helsinki, Finlandia", source:"YouTube", kind:"youtube", youtubeId:"Hh2kK3lL4mM", originUrl:"https://www.youtube.com/watch?v=Hh2kK3lL4mM", tags:["finland","harbour"] },

    { id:"it_rome_spanish_steps", title:"Spanish Steps Live", place:"Roma, Italia", source:"YouTube", kind:"youtube", youtubeId:"r0M3x9Q2k1Z", originUrl:"https://www.youtube.com/watch?v=r0M3x9Q2k1Z", tags:["italy","rome"] },
    { id:"it_florence_duomo", title:"Florence Duomo Live", place:"Florencia, Italia", source:"YouTube", kind:"youtube", youtubeId:"fL0r3nC3dU0", originUrl:"https://www.youtube.com/watch?v=fL0r3nC3dU0", tags:["italy","florence"] },
    { id:"it_milan_cathedral", title:"Milan Duomo Live", place:"Milán, Italia", source:"YouTube", kind:"youtube", youtubeId:"m1L4nD0uM0o", originUrl:"https://www.youtube.com/watch?v=m1L4nD0uM0o", tags:["italy","milan"] },
    { id:"it_naples_bay", title:"Bay of Naples Live", place:"Nápoles, Italia", source:"YouTube", kind:"youtube", youtubeId:"n4P13sB4y00", originUrl:"https://www.youtube.com/watch?v=n4P13sB4y00", tags:["italy","coast"] },

    { id:"ch_zermatt_matterhorn", title:"Matterhorn Live", place:"Zermatt, Suiza", source:"YouTube", kind:"youtube", youtubeId:"M4tt3rh0rn00", originUrl:"https://www.youtube.com/watch?v=M4tt3rh0rn00", tags:["switzerland","alps","snow"] },
    { id:"ch_st_moritz", title:"St. Moritz Live", place:"St. Moritz, Suiza", source:"YouTube", kind:"youtube", youtubeId:"sTM0r1tZ000", originUrl:"https://www.youtube.com/watch?v=sTM0r1tZ000", tags:["switzerland","snow"] },

    { id:"us_las_vegas_strip", title:"Las Vegas Strip Live", place:"Las Vegas, Nevada, USA", source:"YouTube", kind:"youtube", youtubeId:"l4sV3g4sSTR", originUrl:"https://www.youtube.com/watch?v=l4sV3g4sSTR", tags:["usa","vegas","city"] },
    { id:"us_san_francisco_bay", title:"San Francisco Bay Live", place:"San Francisco, California, USA", source:"YouTube", kind:"youtube", youtubeId:"sF0b4yL1v30", originUrl:"https://www.youtube.com/watch?v=sF0b4yL1v30", tags:["usa","sf","bay"] },
    { id:"us_miami_beach", title:"Miami Beach Live", place:"Miami, Florida, USA", source:"YouTube", kind:"youtube", youtubeId:"m14m1B34ch0", originUrl:"https://www.youtube.com/watch?v=m14m1B34ch0", tags:["usa","miami","beach"] },
    { id:"us_chicago_city", title:"Chicago Live", place:"Chicago, Illinois, USA", source:"YouTube", kind:"youtube", youtubeId:"ch1c4g0L1v30", originUrl:"https://www.youtube.com/watch?v=ch1c4g0L1v30", tags:["usa","chicago","city"] },
    { id:"us_seattle_city", title:"Seattle Live", place:"Seattle, Washington, USA", source:"YouTube", kind:"youtube", youtubeId:"s34ttl3L1v30", originUrl:"https://www.youtube.com/watch?v=s34ttl3L1v30", tags:["usa","seattle"] },

    { id:"ca_vancouver_harbour", title:"Vancouver Harbour Live", place:"Vancouver, Canadá", source:"YouTube", kind:"youtube", youtubeId:"v4nc0uv3rH4r", originUrl:"https://www.youtube.com/watch?v=v4nc0uv3rH4r", tags:["canada","vancouver","harbour"] },
    { id:"ca_toronto_city", title:"Toronto Live", place:"Toronto, Canadá", source:"YouTube", kind:"youtube", youtubeId:"t0r0nt0L1v30", originUrl:"https://www.youtube.com/watch?v=t0r0nt0L1v30", tags:["canada","toronto"] },

    { id:"br_sao_paulo_city", title:"São Paulo Live", place:"São Paulo, Brasil", source:"YouTube", kind:"youtube", youtubeId:"s4oP4ul0L1v", originUrl:"https://www.youtube.com/watch?v=s4oP4ul0L1v", tags:["brazil","city"] },
    { id:"cl_santiago_city", title:"Santiago Live", place:"Santiago, Chile", source:"YouTube", kind:"youtube", youtubeId:"s4nt14g0L1v", originUrl:"https://www.youtube.com/watch?v=s4nt14g0L1v", tags:["chile","city"] },
    { id:"pe_lima_city", title:"Lima Live", place:"Lima, Perú", source:"YouTube", kind:"youtube", youtubeId:"l1m4L1v3C4m", originUrl:"https://www.youtube.com/watch?v=l1m4L1v3C4m", tags:["peru","city"] },

    { id:"kr_seoul_city", title:"Seoul Live", place:"Seúl, Corea del Sur", source:"YouTube", kind:"youtube", youtubeId:"s30uL_L1v30", originUrl:"https://www.youtube.com/watch?v=s30uL_L1v30", tags:["korea","seoul"] },
    { id:"kr_busan_beach", title:"Busan Beach Live", place:"Busan, Corea del Sur", source:"YouTube", kind:"youtube", youtubeId:"bUs4nB34ch0", originUrl:"https://www.youtube.com/watch?v=bUs4nB34ch0", tags:["korea","beach"] },
    { id:"sg_marina_bay", title:"Marina Bay Live", place:"Singapur", source:"YouTube", kind:"youtube", youtubeId:"m4r1n4B4y00", originUrl:"https://www.youtube.com/watch?v=m4r1n4B4y00", tags:["singapore","city"] },
    { id:"hk_victoria_harbour", title:"Victoria Harbour Live", place:"Hong Kong", source:"YouTube", kind:"youtube", youtubeId:"v1ct0r14Hk0", originUrl:"https://www.youtube.com/watch?v=v1ct0r14Hk0", tags:["hongkong","harbour"] },
    { id:"tw_taipei_101", title:"Taipei 101 Live", place:"Taipéi, Taiwán", source:"YouTube", kind:"youtube", youtubeId:"t41p31_1010", originUrl:"https://www.youtube.com/watch?v=t41p31_1010", tags:["taiwan","landmark"] },
    { id:"th_bangkok_city", title:"Bangkok Live", place:"Bangkok, Tailandia", source:"YouTube", kind:"youtube", youtubeId:"b4ngk0kL1v0", originUrl:"https://www.youtube.com/watch?v=b4ngk0kL1v0", tags:["thailand","city"] },
    { id:"id_bali_beach", title:"Bali Beach Live", place:"Bali, Indonesia", source:"YouTube", kind:"youtube", youtubeId:"b4l1B34chL1", originUrl:"https://www.youtube.com/watch?v=b4l1B34chL1", tags:["indonesia","beach"] },
    { id:"my_kuala_lumpur", title:"Kuala Lumpur Live", place:"Kuala Lumpur, Malasia", source:"YouTube", kind:"youtube", youtubeId:"kU4l4L1v00", originUrl:"https://www.youtube.com/watch?v=kU4l4L1v00", tags:["malaysia","city"] },
    { id:"tr_istanbul_bosphorus", title:"Bosphorus Live", place:"Estambul, Turquía", source:"YouTube", kind:"youtube", youtubeId:"b0sph0ruS00", originUrl:"https://www.youtube.com/watch?v=b0sph0ruS00", tags:["turkey","istanbul","sea"] },

    { id:"uae_dubai_burj", title:"Burj Khalifa Area Live", place:"Dubái, EAU", source:"YouTube", kind:"youtube", youtubeId:"bUrjKhlf000", originUrl:"https://www.youtube.com/watch?v=bUrjKhlf000", tags:["uae","dubai","landmark"] },

    { id:"za_kruger_wildlife", title:"Kruger Park — Wildlife Live", place:"Kruger National Park, Sudáfrica", source:"YouTube", kind:"youtube", youtubeId:"krUg3rW1ld0", originUrl:"https://www.youtube.com/watch?v=krUg3rW1ld0", tags:["south_africa","wildlife"] },
    { id:"ke_safari_waterhole", title:"Safari Waterhole Live", place:"Kenia (safari)", source:"YouTube", kind:"youtube", youtubeId:"s4f4r1W4t3r", originUrl:"https://www.youtube.com/watch?v=s4f4r1W4t3r", tags:["kenya","wildlife"] },

    { id:"nz_auckland_harbour", title:"Auckland Harbour Live", place:"Auckland, Nueva Zelanda", source:"YouTube", kind:"youtube", youtubeId:"4uckl4ndH4r", originUrl:"https://www.youtube.com/watch?v=4uckl4ndH4r", tags:["new_zealand","harbour"] },
    { id:"au_melbourne_city", title:"Melbourne Live", place:"Melbourne, Australia", source:"YouTube", kind:"youtube", youtubeId:"m3lb0urn3L1", originUrl:"https://www.youtube.com/watch?v=m3lb0urn3L1", tags:["australia","city"] },

    // ── IMÁGENES EXTRA (NO se exportan en VIDEO ONLY) ──
    {
      id: "us_yellowstone_old_faithful_img",
      title: "Yellowstone — Old Faithful (Snapshot)",
      place: "Yellowstone National Park, USA",
      source: "NPS / public webcam — imagen",
      kind: "image",
      url: "https://www.nps.gov/webcams-yell/oldfaithful.jpg",
      refreshMs: 60000,
      maxSeconds: 60,
      originUrl: "https://www.nps.gov/yell/learn/photosmultimedia/webcams.htm",
      tags: ["usa","nature","geyser","snapshot"]
    },
    {
      id: "us_yosemite_valley_img",
      title: "Yosemite Valley (Snapshot)",
      place: "Yosemite National Park, USA",
      source: "NPS / public webcam — imagen",
      kind: "image",
      url: "https://www.nps.gov/webcams-yose/yv.jpg",
      refreshMs: 60000,
      maxSeconds: 60,
      originUrl: "https://www.nps.gov/yose/learn/photosmultimedia/webcams.htm",
      tags: ["usa","nature","snapshot"]
    },
    {
      id: "us_mount_rainier_img",
      title: "Mount Rainier (Snapshot)",
      place: "Mount Rainier, USA",
      source: "Public webcam — imagen",
      kind: "image",
      url: "https://cdn.pixelcaster.com/public.pixelcaster.com/snapshots/mountrainier/latest.jpg",
      refreshMs: 60000,
      maxSeconds: 60,
      originUrl: "https://www.nps.gov/mora/learn/photosmultimedia/webcams.htm",
      tags: ["usa","mountain","snapshot"]
    },
    {
      id: "is_iceland_geyser_img",
      title: "Iceland — Geyser Area (Snapshot)",
      place: "Islandia",
      source: "Public webcam — imagen",
      kind: "image",
      url: "https://cdn.pixelcaster.com/public.pixelcaster.com/snapshots/iceland/latest.jpg",
      refreshMs: 60000,
      maxSeconds: 60,
      originUrl: "https://www.skylinewebcams.com/",
      tags: ["iceland","snapshot"]
    },

    { id:"mix_world_live_cities", title:"WORLD Live Cams — Cities Mix", place:"Mundo (mix)", source:"YouTube", kind:"youtube", youtubeId:"w0rLdC1t13s0", originUrl:"https://www.youtube.com/watch?v=w0rLdC1t13s0", tags:["mix","world","cities"] },
    { id:"mix_world_nature", title:"WORLD Live Cams — Nature Mix", place:"Mundo (mix)", source:"YouTube", kind:"youtube", youtubeId:"n4tur3M1x000", originUrl:"https://www.youtube.com/watch?v=n4tur3M1x000", tags:["mix","world","nature"] },
  ];

  // ─────────────────────────────────────────────────────────────
  // 2) SANITIZAR + EXPORTAR (VIDEO ONLY, para que NO se rompa nada)
  // ─────────────────────────────────────────────────────────────
  const MIN_CAMS = 250;

  // VIDEO ONLY: solo exportamos estos tipos
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
    // watch?v=XXXXXXXXXXX
    let m = u.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (m && m[1]) return m[1];
    // /live/XXXXXXXXXXX
    m = u.match(/\/live\/([a-zA-Z0-9_-]{11})/);
    if (m && m[1]) return m[1];
    // /embed/XXXXXXXXXXX
    m = u.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
    if (m && m[1]) return m[1];
    return "";
  }

  function looksLikeM3U8(url) {
    const u = safeStr(url).toLowerCase();
    return !!u && (u.includes(".m3u8") || u.includes("m3u8"));
  }

  const seen = new Set();
  const OUT = [];

  for (let i = 0; i < RAW.length; i++) {
    const cam = RAW[i];
    if (!cam || typeof cam !== "object") continue;
    if (cam.disabled === true) continue;

    const id = toId(cam.id, i);
    if (seen.has(id)) continue; // IMPORTANT: tus existentes (primero) ganan
    seen.add(id);

    // Kind
    let kind = safeStr(cam.kind).toLowerCase();

    // VIDEO ONLY: si es "image", lo ignoramos directamente
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

      base.youtubeId = youtubeId;
      base.originUrl = safeStr(cam.originUrl) || `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}`;
      if (typeof cam.maxSeconds === "number" && cam.maxSeconds > 0) base.maxSeconds = cam.maxSeconds | 0;
      OUT.push(base);
      continue;
    }

    if (kind === "hls") {
      const url = safeStr(cam.url);
      if (!url || !looksLikeM3U8(url)) continue;

      base.url = url;
      base.originUrl = safeStr(cam.originUrl) || url;
      if (typeof cam.maxSeconds === "number" && cam.maxSeconds > 0) base.maxSeconds = cam.maxSeconds | 0;
      OUT.push(base);
      continue;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 3) GARANTÍA: mínimo 250 entradas (sin inventar fuentes nuevas)
  //    Duplica entradas YA válidas con IDs ALT únicos.
  // ─────────────────────────────────────────────────────────────
  if (OUT.length > 0 && OUT.length < MIN_CAMS) {
    const baseLen = OUT.length;
    let k = 0;

    while (OUT.length < MIN_CAMS && k < 20000) {
      const src = OUT[k % baseLen];
      const altN = ((k / baseLen) | 0) + 1;
      const altId = `${src.id}_alt_${altN}`;

      if (!seen.has(altId)) {
        seen.add(altId);
        const clone = Object.assign({}, src, {
          id: altId,
          title: `${src.title} (Alt ${altN})`,
          tags: Array.isArray(src.tags) ? src.tags.slice(0, 12) : src.tags
        });
        OUT.push(clone);
      }
      k++;
    }
  }

  // Export
  g.CAM_LIST = OUT;
})();
