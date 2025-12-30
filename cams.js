/* cams.js — Lista de cámaras (edita/añade las que quieras)
   kind:
   - "youtube"  -> usa youtubeId
   - "image"    -> usa url (snapshot jpg/png) + refreshMs
   - "hls"      -> usa url (.m3u8) (opcional, requiere CORS OK)

   Extra opcional:
   - maxSeconds -> si tu player lo soporta, limita cuánto tiempo se muestra esta cam.
                  (para "image" pongo 60s, como pediste)
*/
(() => {
  "use strict";

  window.CAM_LIST = [
    // ──────────────── AMÉRICA (tus actuales) ────────────────
    {
      id: "nyc_times_square",
      title: "Times Square (NYC)",
      place: "Times Square, New York, USA",
      source: "EarthCam (YouTube)",
      kind: "youtube",
      youtubeId: "rnXIjl_Rzy4",
      originUrl: "https://www.youtube.com/watch?v=rnXIjl_Rzy4"
    },
    {
      id: "niagara_falls",
      title: "Niagara Falls",
      place: "Niagara Falls, Canadá",
      source: "EarthCam (YouTube)",
      kind: "youtube",
      youtubeId: "gIv9J38Dax8",
      originUrl: "https://www.youtube.com/watch?v=gIv9J38Dax8"
    },
    {
      id: "waikiki_sheraton",
      title: "Waikiki Beach",
      place: "Waikiki, Honolulu (Hawái), USA",
      source: "Ozolio / Sheraton (YouTube)",
      kind: "youtube",
      youtubeId: "06v5pzump4w",
      originUrl: "https://www.youtube.com/watch?v=06v5pzump4w"
    },
    {
      id: "rio_copacabana",
      title: "Copacabana",
      place: "Rio de Janeiro, Brasil",
      source: "SkylineWebcams (YouTube)",
      kind: "youtube",
      youtubeId: "YRZMwOqHIEE",
      originUrl: "https://www.youtube.com/watch?v=YRZMwOqHIEE"
    },
    {
      id: "grand_canyon_entrance_img",
      title: "Grand Canyon (Entrada) — Snapshot",
      place: "Grand Canyon (South Entrance), Arizona, USA",
      source: "NPS (.gov) — imagen",
      kind: "image",
      url: "https://www.nps.gov/webcams-grca/camera.jpg",
      refreshMs: 60_000,
      maxSeconds: 60,
      originUrl: "https://www.nps.gov/grca/learn/photosmultimedia/webcams.htm"
    },
    {
      id: "grand_canyon_pixelcaster_img",
      title: "Grand Canyon — Snapshot",
      place: "Grand Canyon, Arizona, USA",
      source: "Pixelcaster — imagen",
      kind: "image",
      url: "https://cdn.pixelcaster.com/public.pixelcaster.com/snapshots/grandcanyon-2/latest.jpg",
      refreshMs: 60_000,
      maxSeconds: 60,
      originUrl: "https://www.nps.gov/grca/learn/photosmultimedia/webcams.htm"
    },

    // ──────────────── EUROPA (tus actuales) ────────────────
    {
      id: "london_abbey_road",
      title: "Abbey Road Crossing",
      place: "Londres, Reino Unido",
      source: "EarthCam (YouTube)",
      kind: "youtube",
      youtubeId: "57w2gYXjRic",
      originUrl: "https://www.youtube.com/watch?v=57w2gYXjRic"
    },
    {
      id: "rome_colosseum",
      title: "Coliseo",
      place: "Roma, Italia",
      source: "SkylineWebcams (YouTube)",
      kind: "youtube",
      youtubeId: "54_skPGLNhA",
      originUrl: "https://www.youtube.com/watch?v=54_skPGLNhA"
    },
    {
      id: "reykjavik_live",
      title: "Reykjavík",
      place: "Reykjavík, Islandia",
      source: "Mount Esja (YouTube)",
      kind: "youtube",
      youtubeId: "ZONCgHc1cZc",
      originUrl: "https://www.youtube.com/watch?v=ZONCgHc1cZc"
    },
    {
      id: "lofotens_henningsvaer",
      title: "Lofoten Islands",
      place: "Henningsvær, Noruega",
      source: "SkylineWebcams (YouTube)",
      kind: "youtube",
      youtubeId: "Q6j50GaGM9g",
      originUrl: "https://www.youtube.com/watch?v=Q6j50GaGM9g"
    },
    {
      id: "venice_rolling",
      title: "Venecia (Rolling Cam)",
      place: "Venecia, Italia",
      source: "YouTube",
      kind: "youtube",
      youtubeId: "ph1vpnYIxJk",
      originUrl: "https://www.youtube.com/watch?v=ph1vpnYIxJk"
    },
    {
      id: "zurich_webcam",
      title: "Zürich",
      place: "Zúrich, Suiza",
      source: "YouTube",
      kind: "youtube",
      youtubeId: "BFyUMaRclJI",
      originUrl: "https://www.youtube.com/watch?v=BFyUMaRclJI"
    },

    // ──────────────── ASIA (tus actuales) ────────────────
    {
      id: "tokyo_shibuya",
      title: "Shibuya Crossing",
      place: "Shibuya, Tokio, Japón",
      source: "YouTube",
      kind: "youtube",
      youtubeId: "tujkoXI8rWM",
      originUrl: "https://www.youtube.com/watch?v=tujkoXI8rWM"
    },
    {
      id: "tokyo_tower",
      title: "Tokyo Tower",
      place: "Tokio, Japón",
      source: "Tokyo Tower (YouTube)",
      kind: "youtube",
      youtubeId: "RCur8_bXL0U",
      originUrl: "https://www.youtube.com/watch?v=RCur8_bXL0U"
    },
    {
      id: "dubai_marina",
      title: "Dubai Marina",
      place: "Dubái, Emiratos Árabes Unidos",
      source: "YouTube",
      kind: "youtube",
      youtubeId: "hcjGYYHyn2c",
      originUrl: "https://www.youtube.com/watch?v=hcjGYYHyn2c"
    },
    {
      id: "cappadocia_turkey",
      title: "Cappadocia",
      place: "Cappadocia, Turquía",
      source: "SkylineWebcams (YouTube)",
      kind: "youtube",
      youtubeId: "SnlUWObWsgM",
      originUrl: "https://www.youtube.com/watch?v=SnlUWObWsgM"
    },

    // ──────────────── OCEANÍA (tus actuales) ────────────────
    {
      id: "sydney_harbour_static",
      title: "Sydney Harbour",
      place: "Sídney, Australia",
      source: "WebcamSydney (YouTube)",
      kind: "youtube",
      youtubeId: "5uZa3-RMFos",
      originUrl: "https://www.youtube.com/watch?v=5uZa3-RMFos"
    },
    {
      id: "sydney_harbour_panning",
      title: "Sydney Harbour (Pan)",
      place: "Sídney, Australia",
      source: "WebcamSydney (YouTube)",
      kind: "youtube",
      youtubeId: "jshwkG1ZpP8",
      originUrl: "https://www.youtube.com/watch?v=jshwkG1ZpP8"
    },

    // ──────────────── ÁFRICA (tus actuales) ────────────────
    {
      id: "cape_town_table_mountain",
      title: "Table Mountain",
      place: "Cape Town, Sudáfrica",
      source: "YouTube",
      kind: "youtube",
      youtubeId: "i5R4ZlVLzLI",
      originUrl: "https://www.youtube.com/watch?v=i5R4ZlVLzLI"
    },

    // ──────────────── EXTRA (tus actuales) ────────────────
    {
      id: "iceland_volcano_watch",
      title: "Volcano Watch",
      place: "Islandia (zona volcánica)",
      source: "YouTube",
      kind: "youtube",
      youtubeId: "Obz3FdSiWxk",
      originUrl: "https://www.youtube.com/watch?v=Obz3FdSiWxk"
    },

    // ─────────────────────────────────────────────────────────
    // ──────────────── NUEVAS (vídeo, global) ────────────────
    // ─────────────────────────────────────────────────────────

    // AMÉRICA / CARIBE (EarthCam + tours)
    { id:"us_911_memorial", title:"9/11 Memorial & World Trade Center", place:"Lower Manhattan, NYC, USA", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"PI63KrE3UGo", originUrl:"https://www.youtube.com/watch?v=PI63KrE3UGo" },
    { id:"br_rio_earthcam_alt", title:"Rio de Janeiro (EarthCam)", place:"Rio de Janeiro, Brasil", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"bwQyNMjsG3k", originUrl:"https://www.youtube.com/watch?v=bwQyNMjsG3k" },
    { id:"us_coney_island", title:"Coney Island Live", place:"Brooklyn, NYC, USA", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"xHLEKR3_8iI", originUrl:"https://www.youtube.com/watch?v=xHLEKR3_8iI" },
    { id:"us_myrtle_beach", title:"Myrtle Beach Live", place:"South Carolina, USA", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"RG_-aRFPQSU", originUrl:"https://www.youtube.com/watch?v=RG_-aRFPQSU" },
    { id:"us_seaside_park_nj", title:"Seaside Park Live", place:"New Jersey, USA", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"XKQKFYbaqdA", originUrl:"https://www.youtube.com/watch?v=XKQKFYbaqdA" },
    { id:"ky_cayman_islands", title:"Cayman Islands Live", place:"Grand Cayman, Islas Caimán", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"ZljOTPG2i1Y", originUrl:"https://www.youtube.com/watch?v=ZljOTPG2i1Y" },
    { id:"sx_sint_maarten", title:"Sint Maarten Live", place:"Philipsburg, Sint Maarten", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"aBpnLhWvW3A", originUrl:"https://www.youtube.com/watch?v=aBpnLhWvW3A" },
    { id:"vg_scrub_island_bvi", title:"Scrub Island Live", place:"British Virgin Islands", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"GYp4rUikGc0", originUrl:"https://www.youtube.com/watch?v=GYp4rUikGc0" },
    { id:"pr_palomino_island", title:"Palomino Island Beach Live", place:"Puerto Rico", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"MU8kI-PbVnM", originUrl:"https://www.youtube.com/watch?v=MU8kI-PbVnM" },
    { id:"mp_saipan_beach", title:"Saipan Beach Live", place:"Saipán, Islas Marianas", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"zFGugdfc8k4", originUrl:"https://www.youtube.com/watch?v=zFGugdfc8k4" },
    { id:"us_new_orleans_street", title:"New Orleans Street View Live", place:"New Orleans, Louisiana, USA", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"qHW8srS0ylo", originUrl:"https://www.youtube.com/live/qHW8srS0ylo" },
    { id:"us_dc_cherry_blossom", title:"Cherry Blossom Live", place:"Washington, D.C., USA", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"nNkSMJP0Tyg", originUrl:"https://www.youtube.com/live/nNkSMJP0Tyg" },
    { id:"us_hotel_saranac", title:"Hotel Saranac (Town View)", place:"Saranac Lake, NY, USA", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"dZV8pa5QhHY", originUrl:"https://www.youtube.com/watch?v=dZV8pa5QhHY" },
    { id:"us_tamarin_monkey_cam", title:"Tamarin Monkey Cam", place:"Utica, New York, USA", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"1B0uwxfEYCA", originUrl:"https://www.youtube.com/watch?v=1B0uwxfEYCA" },
    { id:"us_halloween_earthcam", title:"Halloween (EarthCam mix)", place:"USA (varios puntos)", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"mBr1dGev8qM", originUrl:"https://www.youtube.com/watch?v=mBr1dGev8qM" },
    { id:"us_storm_idalia", title:"Tropical Storm / Hurricane Coverage", place:"USA (cobertura)", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"t40VpDs9J9c", originUrl:"https://www.youtube.com/watch?v=t40VpDs9J9c" },
    { id:"us_rolling_tour", title:"USA Live Cam — Rolling Tour", place:"USA (tour rolling)", source:"YouTube", kind:"youtube", youtubeId:"fa8iGVeri_I", originUrl:"https://www.youtube.com/watch?v=fa8iGVeri_I" },
    { id:"us_times_square_4k_alt", title:"Times Square in 4K (Alt)", place:"New York, USA", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"SW1vpWZq9-w", originUrl:"https://www.youtube.com/watch?v=SW1vpWZq9-w" },
    { id:"us_nyc_xmas_4k", title:"NYC Christmas / Holiday Live", place:"New York, USA", source:"YouTube", kind:"youtube", youtubeId:"5_vrqwsKXEQ", originUrl:"https://www.youtube.com/watch?v=5_vrqwsKXEQ" },
    { id:"es_tamariu_earthcam", title:"Tamariu Live", place:"Tamariu, España", source:"EarthCam (YouTube)", kind:"youtube", youtubeId:"ld87T3g_nyg", originUrl:"https://www.youtube.com/watch?v=ld87T3g_nyg" },

    // EUROPA (SkylineWebcams + cams locales)
    { id:"it_venice_grand_canal_povoledo", title:"Grand Canal (Povoledo) 4K", place:"Venecia, Italia", source:"YouTube", kind:"youtube", youtubeId:"P6JA_YjHMZs", originUrl:"https://www.youtube.com/watch?v=P6JA_YjHMZs" },
    { id:"it_venice_grand_canal_caangeli", title:"Grand Canal (Ca'Angeli)", place:"Venecia, Italia", source:"YouTube", kind:"youtube", youtubeId:"P393gTj527k", originUrl:"https://www.youtube.com/watch?v=P393gTj527k" },
    { id:"it_venice_ponte_guglie_4k", title:"Ponte delle Guglie 4K", place:"Venecia, Italia", source:"YouTube", kind:"youtube", youtubeId:"HpZAez2oYsA", originUrl:"https://www.youtube.com/watch?v=HpZAez2oYsA" },
    { id:"it_venice_san_cassiano", title:"Grand Canal (Hotel San Cassiano)", place:"Venecia, Italia", source:"YouTube", kind:"youtube", youtubeId:"lFQ_BvxIcnI", originUrl:"https://www.youtube.com/watch?v=lFQ_BvxIcnI" },
    { id:"it_venice_top_mix", title:"TOP Venice Live Cams (mix)", place:"Venecia, Italia (mix)", source:"YouTube", kind:"youtube", youtubeId:"CwhHltwJdhc", originUrl:"https://www.youtube.com/watch?v=CwhHltwJdhc" },
    { id:"it_trevi_fountain", title:"Trevi Fountain Live", place:"Roma, Italia", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"j39vIidsIJI", originUrl:"https://www.youtube.com/watch?v=j39vIidsIJI" },
    { id:"it_pozzuoli_campi_flegrei", title:"Campi Flegrei (Pozzuoli) Live", place:"Pozzuoli, Italia", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"-sNafHFByDI", originUrl:"https://www.youtube.com/watch?v=-sNafHFByDI" },
    { id:"it_etna_eruption_live", title:"Etna Eruption Live", place:"Sicilia, Italia", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"plYtw4DSf5I", originUrl:"https://www.youtube.com/watch?v=plYtw4DSf5I" },
    { id:"it_etna_live_alt1", title:"Mount Etna Live (Alt 1)", place:"Sicilia, Italia", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"k_g6c14hXGQ", originUrl:"https://www.youtube.com/watch?v=k_g6c14hXGQ" },
    { id:"it_etna_live_alt2", title:"Mount Etna Live (Alt 2)", place:"Sicilia, Italia", source:"YouTube", kind:"youtube", youtubeId:"EHIelAoCBoM", originUrl:"https://www.youtube.com/watch?v=EHIelAoCBoM" },
    { id:"es_malaga_weather_alert", title:"Weather Alert Live", place:"Málaga, España", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"cplErgOi_Ws", originUrl:"https://www.youtube.com/watch?v=cplErgOi_Ws" },
    { id:"ch_wengen_alps", title:"Under the Swiss Alps (Wengen)", place:"Wengen, Suiza", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"I28Cip207ZY", originUrl:"https://www.youtube.com/watch?v=I28Cip207ZY" },
    { id:"gr_santorini_live", title:"Santorini Live", place:"Santorini, Grecia", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"2a4SrvF0iS8", originUrl:"https://www.youtube.com/watch?v=2a4SrvF0iS8" },
    { id:"il_jerusalem_live", title:"Jerusalem Live", place:"Jerusalén, Israel", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"hTSfDxRmrEQ", originUrl:"https://www.youtube.com/watch?v=hTSfDxRmrEQ" },
    { id:"cz_prague_live", title:"Prague Live Webcam", place:"Praga, República Checa", source:"YouTube", kind:"youtube", youtubeId:"0FvTdT3EJY4", originUrl:"https://www.youtube.com/watch?v=0FvTdT3EJY4" },
    { id:"cz_prague_snowfall", title:"Snowfall Live from Prague", place:"Praga, República Checa", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"B6FDKqfJ6M4", originUrl:"https://www.youtube.com/watch?v=B6FDKqfJ6M4" },
    { id:"cz_prague_trainspotting", title:"Prague Main Station (Trainspotting) 24/7", place:"Praga, República Checa", source:"YouTube", kind:"youtube", youtubeId:"AttVS4KM8tY", originUrl:"https://www.youtube.com/watch?v=AttVS4KM8tY" },
    { id:"cz_prague_timelapse", title:"Prague Time-Lapse (live view link)", place:"Praga, República Checa", source:"YouTube", kind:"youtube", youtubeId:"jbN6czYv0os", originUrl:"https://www.youtube.com/watch?v=jbN6czYv0os" },

    // PAÍSES BAJOS / FRANCIA
    { id:"nl_amsterdam_dam_ptz", title:"Amsterdam — De Dam (PTZ)", place:"Ámsterdam, Países Bajos", source:"YouTube", kind:"youtube", youtubeId:"Gd9d4q6WvUY", originUrl:"https://www.youtube.com/watch?v=Gd9d4q6WvUY" },
    { id:"nl_amsterdam_singel_hotel", title:"Singel Hotel Live 24/7", place:"Ámsterdam, Países Bajos", source:"YouTube", kind:"youtube", youtubeId:"ZnOoxCd7BGU", originUrl:"https://www.youtube.com/watch?v=ZnOoxCd7BGU" },
    { id:"nl_amsterdam_sixhaven", title:"Sixhaven Live (1440p)", place:"Ámsterdam, Países Bajos", source:"YouTube", kind:"youtube", youtubeId:"3gTHiUWrCAE", originUrl:"https://www.youtube.com/watch?v=3gTHiUWrCAE" },
    { id:"nl_amsterdam_movenpick", title:"Mövenpick Rooftop Live", place:"Ámsterdam, Países Bajos", source:"YouTube", kind:"youtube", youtubeId:"9Pm6Ji6tm7s", originUrl:"https://www.youtube.com/watch?v=9Pm6Ji6tm7s" },
    { id:"nl_amsterdam_live_stream", title:"Amsterdam Live Stream 24/7", place:"Ámsterdam, Países Bajos", source:"YouTube", kind:"youtube", youtubeId:"RmiTd0J5qDg", originUrl:"https://www.youtube.com/watch?v=RmiTd0J5qDg" },
    { id:"nl_amsterdam_stationseiland", title:"Amsterdam — Centraal station area", place:"Ámsterdam, Países Bajos", source:"YouTube", kind:"youtube", youtubeId:"1phWWCgzXgM", originUrl:"https://www.youtube.com/watch?v=1phWWCgzXgM" },

    { id:"fr_paris_walk_live", title:"Paris Eiffel Tower Walk Live", place:"París, Francia", source:"YouTube", kind:"youtube", youtubeId:"wCgNhsNjuPs", originUrl:"https://www.youtube.com/watch?v=wCgNhsNjuPs" },
    { id:"fr_paris_pont_iena", title:"Paris — Pont de Iéna (Eiffel Tower)", place:"París, Francia", source:"YouTube", kind:"youtube", youtubeId:"7-OFVJ8hKFc", originUrl:"https://www.youtube.com/watch?v=7-OFVJ8hKFc" },
    { id:"fr_paris_live_hd", title:"Paris Live HD CAM — Eiffel", place:"París, Francia", source:"YouTube", kind:"youtube", youtubeId:"iZipA1LL_sU", originUrl:"https://www.youtube.com/watch?v=iZipA1LL_sU" },
    { id:"fr_paris_stream_alt", title:"Paris Stream (Eiffel area)", place:"París, Francia", source:"YouTube", kind:"youtube", youtubeId:"xzMYdVo-3Bs", originUrl:"https://www.youtube.com/watch?v=xzMYdVo-3Bs" },
    { id:"fr_paris_earth_hour", title:"Eiffel Tower Live (Earth Hour clip)", place:"París, Francia", source:"YouTube", kind:"youtube", youtubeId:"NrMFAkTeuVw", originUrl:"https://www.youtube.com/watch?v=NrMFAkTeuVw" },
    { id:"fr_paris_angles_4k", title:"Paris — Eiffel Tower (multi angles)", place:"París, Francia", source:"YouTube", kind:"youtube", youtubeId:"mvcL9--pvHw", originUrl:"https://www.youtube.com/watch?v=mvcL9--pvHw&vl=en" },
    { id:"fr_paris_virtual_live", title:"Eiffel Tower Virtual Tour (Live)", place:"París, Francia", source:"YouTube", kind:"youtube", youtubeId:"O8Ha_pAqYcY", originUrl:"https://www.youtube.com/watch?v=O8Ha_pAqYcY" },

    // ESPAÑA / ATLÁNTICO
    { id:"es_barcelona_rough_morning", title:"Barcelona Live (Rough Morning)", place:"Barcelona, España", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"XL1hRO8EYa0", originUrl:"https://www.youtube.com/watch?v=XL1hRO8EYa0" },
    { id:"es_barcelona_recorded", title:"Barcelona (Recorded live)", place:"Barcelona, España", source:"YouTube", kind:"youtube", youtubeId:"-rADshzms8U", originUrl:"https://www.youtube.com/watch?v=-rADshzms8U" },
    { id:"es_tenerife_santa_cruz", title:"Santa Cruz de Tenerife Live", place:"Tenerife, España", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"RJbiqyQ4BlY", originUrl:"https://www.youtube.com/watch?v=RJbiqyQ4BlY" },
    { id:"es_tenerife_las_vistas", title:"Playa Las Vistas Live", place:"Tenerife, España", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"gsTMAwBl-5E", originUrl:"https://www.youtube.com/watch?v=gsTMAwBl-5E" },
    { id:"es_tenerife_recorded", title:"Tenerife (Recorded live)", place:"Tenerife, España", source:"YouTube", kind:"youtube", youtubeId:"lLdp3VjZ2K4", originUrl:"https://www.youtube.com/watch?v=lLdp3VjZ2K4" },

    // AMÉRICA DEL SUR
    { id:"ar_buenos_aires_live", title:"Buenos Aires Live", place:"Buenos Aires, Argentina", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"reShHDyLGbc", originUrl:"https://www.youtube.com/watch?v=reShHDyLGbc" },
    { id:"ar_ushuaia_snowfall", title:"Ushuaia Snowfall Live", place:"Ushuaia, Argentina", source:"SkylineWebcams (YouTube)", kind:"youtube", youtubeId:"9cYa8Ssf0rI", originUrl:"https://www.youtube.com/watch?v=9cYa8Ssf0rI" },

    // ISLAS / NÓRDICO
    { id:"fo_faroe_islands_live", title:"Faroe Islands Live Webcam", place:"Islas Feroe", source:"YouTube", kind:"youtube", youtubeId:"9NpCVV25j_4", originUrl:"https://www.youtube.com/watch?v=9NpCVV25j_4" },

    // ITALIA (montaña / nieve)
    { id:"it_canazei_snowfall", title:"Canazei Snowfall Live", place:"Canazei, Italia", source:"YouTube", kind:"youtube", youtubeId:"hIKpX489KCI", originUrl:"https://www.youtube.com/watch?v=hIKpX489KCI" },

    // ASIA / OCÉANO (mezcla)
    { id:"jp_shibuya_alt_timelapse", title:"Shibuya (Alt / Time-lapse)", place:"Tokio, Japón", source:"YouTube", kind:"youtube", youtubeId:"KiXaAGqD99I", originUrl:"https://www.youtube.com/watch?v=KiXaAGqD99I" },
    { id:"th_phuket_new_year_live", title:"New Year / Night Live Cam", place:"Phuket, Tailandia", source:"YouTube", kind:"youtube", youtubeId:"AQMaw6OAeHY", originUrl:"https://www.youtube.com/watch?v=AQMaw6OAeHY" },

    // VOLCANES / NATURALEZA (extra)
    { id:"us_hawaii_volcano_cam_alt", title:"Volcano Cam (Big Island) — Alt", place:"Hawái, USA", source:"YouTube", kind:"youtube", youtubeId:"u4UZ4UvZXrg", originUrl:"https://www.youtube.com/watch?v=u4UZ4UvZXrg" },

    // COMPILACIONES (sirven como “multi-cam” cuando quieras variedad rápida)
    { id:"mix_1200_top_webcams", title:"1200 TOP LIVE WEBCAMS (mix)", place:"Mundo (mix)", source:"YouTube", kind:"youtube", youtubeId:"EFum1rGUdkk", originUrl:"https://www.youtube.com/watch?v=EFum1rGUdkk" },
    { id:"mix_50_greece_webcams", title:"50 TOP LIVE CAMS (Greece mix)", place:"Grecia (mix)", source:"YouTube", kind:"youtube", youtubeId:"QswsqbCmkjE", originUrl:"https://www.youtube.com/watch?v=QswsqbCmkjE" },
    { id:"mix_us_webcams_oct", title:"LIVE WEBCAMS around the USA (mix)", place:"USA (mix)", source:"YouTube", kind:"youtube", youtubeId:"59D6sy6wjdI", originUrl:"https://www.youtube.com/watch?v=59D6sy6wjdI" },

    // ──────────────── IMÁGENES (1 minuto) ────────────────
    // Si añades más imágenes, ponles maxSeconds: 60.
    // (Aquí dejo solo las 2 que ya tenías para no meter URLs no verificadas)
  ];
})();
