/* cams.js — Lista de cámaras (edita/añade las que quieras)
   kind:
   - "youtube"  -> usa youtubeId
   - "image"    -> usa url (snapshot jpg/png) + refreshMs
   - "hls"      -> usa url (.m3u8) (opcional, requiere CORS OK)
*/
(() => {
  "use strict";

  window.CAM_LIST = [
    // ──────────────── AMÉRICA ────────────────
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
      originUrl: "https://www.nps.gov/grca/learn/photosmultimedia/webcams.htm"
    },

    // ──────────────── EUROPA ────────────────
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

    // ──────────────── ASIA ────────────────
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

    // ──────────────── OCEANÍA ────────────────
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

    // ──────────────── ÁFRICA ────────────────
    {
      id: "cape_town_table_mountain",
      title: "Table Mountain",
      place: "Cape Town, Sudáfrica",
      source: "YouTube",
      kind: "youtube",
      youtubeId: "i5R4ZlVLzLI",
      originUrl: "https://www.youtube.com/watch?v=i5R4ZlVLzLI"
    },

    // ──────────────── EXTRA (naturaleza) ────────────────
    {
      id: "iceland_volcano_watch",
      title: "Volcano Watch",
      place: "Islandia (zona volcánica)",
      source: "YouTube",
      kind: "youtube",
      youtubeId: "Obz3FdSiWxk",
      originUrl: "https://www.youtube.com/watch?v=Obz3FdSiWxk"
    }
  ];
})();
