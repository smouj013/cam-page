(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;
  const LOAD_GUARD = "__RLC_PLAYER_LOADED_V200";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  // Bus
  const BUS = "rlc_bus_v1";
  const CMD_KEY = "rlc_cmd_v1";
  const STATE_KEY = "rlc_state_v1";

  const qs = (s) => document.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtMMSS = (sec) => {
    sec = Math.max(0, sec | 0);
    const m = (sec / 60) | 0;
    const s = sec - m * 60;
    return `${pad2(m)}:${pad2(s)}`;
  };

  function parseParams() {
    const u = new URL(location.href);
    return {
      mins: clamp(parseInt(u.searchParams.get("mins") || "5", 10) || 5, 1, 120),
      fit: (u.searchParams.get("fit") || "cover"),
      hud: (u.searchParams.get("hud") ?? "1") !== "0",
      seed: u.searchParams.get("seed") || "",
      autoskip: (u.searchParams.get("autoskip") ?? "1") !== "0",
      mode: (u.searchParams.get("mode") || "").toLowerCase(), // adfree
      debug: (u.searchParams.get("debug") === "1")
    };
  }

  // RNG
  function makeRng(seedStr) {
    function xmur3(str) {
      let h = 1779033703 ^ str.length;
      for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
      }
      return function () {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        h ^= h >>> 16;
        return h >>> 0;
      };
    }
    function sfc32(a, b, c, d) {
      return function () {
        a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
        let t = (a + b) | 0;
        a = b ^ (b >>> 9);
        b = (c + (c << 3)) | 0;
        c = (c << 21) | (c >>> 11);
        d = (d + 1) | 0;
        t = (t + d) | 0;
        c = (c + t) | 0;
        return (t >>> 0) / 4294967296;
      };
    }
    const seed = seedStr ? seedStr : String(Date.now());
    const h = xmur3(seed);
    return sfc32(h(), h(), h(), h());
  }

  function shuffle(arr, rnd) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // DOM
  const frame = qs("#frame");
  const video = qs("#video");
  const img = qs("#img");
  const fallback = qs("#fallback");
  const fallbackLink = qs("#fallbackLink");

  const hud = qs("#hud");
  const hudTitle = qs("#hudTitle");
  const hudPlace = qs("#hudPlace");
  const hudSource = qs("#hudSource");
  const hudOrigin = qs("#hudOrigin");
  const hudCountdown = qs("#hudCountdown");
  const hudIndex = qs("#hudIndex");
  const progressBar = qs("#progressBar");
  const hudToggle = qs("#hudToggle");
  const hudDetails = qs("#hudDetails");

  const P = parseParams();
  const rnd = makeRng(P.seed);

  // State
  const STORAGE_KEY = "rlc_player_state_v2";
  const HUD_COLLAPSE_KEY = "rlc_hud_collapsed_v2";
  const HUD_HIDE_KEY = "rlc_hud_hidden_v2";
  const BAN_KEY = "rlc_ban_ids_v1";

  let allCams = Array.isArray(g.CAM_LIST) ? g.CAM_LIST.slice() : [];
  let banned = new Set();
  try {
    const raw = localStorage.getItem(BAN_KEY);
    if (raw) banned = new Set(JSON.parse(raw));
  } catch (_) {}

  function applyFilters() {
    let list = allCams.filter(c => c && !banned.has(c.id));
    if (modeAdfree) list = list.filter(c => c.kind !== "youtube");
    cams = list;
    if (!cams.length) cams = allCams.slice(); // fallback si te quedas sin nada
  }

  let modeAdfree = (P.mode === "adfree");
  let autoskip = !!P.autoskip;

  let cams = [];
  applyFilters();

  let idx = 0;
  let playing = true;

  let roundSeconds = P.mins * 60;
  let roundEndsAt = 0;

  let tickTimer = null;
  let imgTimer = null;
  let hls = null;
  let switching = false;

  // Comms
  const bc = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS) : null;
  let lastCmdTs = 0;

  function postState(extra = {}) {
    const cam = cams[idx] || {};
    const state = {
      type: "state",
      ts: Date.now(),
      playing,
      idx,
      total: cams.length,
      mins: Math.max(1, (roundSeconds / 60) | 0),
      fit: currentFit,
      hudHidden: hud.classList.contains("hidden"),
      hudCollapsed: hud.classList.contains("hud--collapsed"),
      autoskip,
      adfree: modeAdfree,
      cam: {
        id: cam.id, title: cam.title, place: cam.place, source: cam.source,
        originUrl: cam.originUrl, kind: cam.kind
      },
      remaining: remainingSeconds(),
      ...extra
    };
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (_) {}
    try { if (bc) bc.postMessage(state); } catch (_) {}
  }

  function showOnly(kind) {
    frame.classList.add("hidden");
    video.classList.add("hidden");
    img.classList.add("hidden");
    fallback.classList.add("hidden");

    if (kind === "youtube") frame.classList.remove("hidden");
    else if (kind === "hls") video.classList.remove("hidden");
    else if (kind === "image") img.classList.remove("hidden");
    else fallback.classList.remove("hidden");
  }

  let currentFit = "cover";
  function setFit(mode) {
    currentFit = (mode === "contain") ? "contain" : "cover";
    frame.style.objectFit = currentFit;
    video.style.objectFit = currentFit;
    img.style.objectFit = currentFit;
  }

  function clearMedia() {
    if (imgTimer) { clearInterval(imgTimer); imgTimer = null; }
    try { if (hls) { hls.destroy(); hls = null; } } catch (_) {}

    try { frame.src = "about:blank"; } catch (_) {}
    try {
      video.pause();
      video.removeAttribute("src");
      video.load();
    } catch (_) {}
    try { img.removeAttribute("src"); } catch (_) {}

    try { img.onerror = null; } catch (_) {}
    try { video.onerror = null; } catch (_) {}
  }

  function setHud(cam) {
    hudTitle.textContent = cam.title || "Live Cam";
    hudPlace.textContent = cam.place || "—";
    hudSource.textContent = cam.source || "—";
    hudOrigin.href = cam.originUrl || "#";
    hudOrigin.style.pointerEvents = cam.originUrl ? "auto" : "none";
    hudOrigin.style.opacity = cam.originUrl ? "1" : ".6";
    hudIndex.textContent = `${idx + 1}/${cams.length}`;
  }

  function remainingSeconds() {
    if (!roundEndsAt) return roundSeconds;
    const ms = roundEndsAt - Date.now();
    return Math.max(0, Math.ceil(ms / 1000));
  }

  function setCountdownUI() {
    const rem = remainingSeconds();
    hudCountdown.textContent = fmtMMSS(rem);
    const pct = 100 * (1 - (rem / Math.max(1, roundSeconds)));
    progressBar.style.width = `${clamp(pct, 0, 100).toFixed(2)}%`;
  }

  function startRound(seconds) {
    const s = clamp(seconds | 0, 1, 120 * 60);
    roundEndsAt = Date.now() + s * 1000;
    setCountdownUI();
  }

  function effectiveSeconds(cam) {
    // ✅ imágenes siempre 1 minuto (o cam.maxSeconds si lo defines)
    if (cam && typeof cam.maxSeconds === "number" && cam.maxSeconds > 0) return cam.maxSeconds | 0;
    if (cam && cam.kind === "image") return 60;
    return roundSeconds;
  }

  function showFallback(cam, msg) {
    clearMedia();
    showOnly("fallback");
    const t = fallback.querySelector(".fallbackText");
    if (t) t.textContent = msg || "Saltando…";
    fallbackLink.href = (cam && cam.originUrl) ? cam.originUrl : "#";
    fallbackLink.style.pointerEvents = (cam && cam.originUrl) ? "auto" : "none";
    fallbackLink.style.opacity = (cam && cam.originUrl) ? "1" : ".6";
  }

  async function safePlayVideo() {
    try {
      const p = video.play();
      if (p && typeof p.then === "function") await p;
    } catch (_) {}
  }

  function playCam(cam) {
    clearMedia();
    setHud(cam);

    startRound(effectiveSeconds(cam));

    if (cam.kind === "youtube") {
      showOnly("youtube");
      const src =
        `https://www.youtube-nocookie.com/embed/${encodeURIComponent(cam.youtubeId)}`
        + `?autoplay=1&mute=1&controls=0&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&fs=0&disablekb=1`;
      frame.src = src;
      postState();
      return;
    }

    if (cam.kind === "image") {
      showOnly("image");
      const refreshMs = Math.max(5000, (cam.refreshMs | 0) || 60000);

      const setSnap = () => {
        const u = cam.url;
        const sep = (u.indexOf("?") >= 0) ? "&" : "?";
        img.src = `${u}${sep}t=${Date.now()}`;
      };

      setSnap();
      imgTimer = setInterval(setSnap, refreshMs);

      if (autoskip) {
        img.onerror = () => {
          img.onerror = null;
          showFallback(cam, "Imagen no disponible (error). Saltando…");
          setTimeout(() => nextCam("img_error"), 900);
        };
      }
      postState();
      return;
    }

    if (cam.kind === "hls") {
      showOnly("hls");
      const url = cam.url;
      const Hls = g.Hls;

      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        safePlayVideo();
      } else if (Hls && Hls.isSupported()) {
        hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30 });
        hls.loadSource(url);
        hls.attachMedia(video);

        hls.on(Hls.Events.ERROR, (_ev, data) => {
          if (!autoskip) return;
          if (data && data.fatal) {
            showFallback(cam, "Stream HLS no disponible. Saltando…");
            setTimeout(() => nextCam("hls_fatal"), 900);
          }
        });

        video.addEventListener("canplay", () => safePlayVideo(), { once: true });
      } else {
        showFallback(cam, "HLS no soportado aquí.");
        if (autoskip) setTimeout(() => nextCam("hls_unsupported"), 900);
      }

      if (autoskip) {
        video.onerror = () => {
          video.onerror = null;
          showFallback(cam, "Stream no disponible (error). Saltando…");
          setTimeout(() => nextCam("vid_error"), 900);
        };
      }
      postState();
      return;
    }

    showFallback(cam, "Tipo no soportado.");
    postState({ error: "unsupported" });
    if (autoskip) setTimeout(() => nextCam("unsupported"), 900);
  }

  function nextCam(reason) {
    if (!cams.length || switching) return;
    switching = true;
    idx = (idx + 1) % cams.length;
    if (P.debug) console.log("[player] next:", reason, idx, cams[idx]);
    playCam(cams[idx]);
    setTimeout(() => { switching = false; }, 250);
  }

  function prevCam() {
    if (!cams.length || switching) return;
    switching = true;
    idx = (idx - 1 + cams.length) % cams.length;
    playCam(cams[idx]);
    setTimeout(() => { switching = false; }, 250);
  }

  function setPlaying(v) {
    playing = !!v;
    if (playing) startRound(Math.max(1, remainingSeconds()));
    postState();
  }

  function reshuffle() {
    const curId = cams[idx] && cams[idx].id;
    shuffle(cams, rnd);
    const n = cams.findIndex(c => c.id === curId);
    idx = (n >= 0) ? n : 0;
    playCam(cams[idx]);
  }

  function setHudCollapsed(v) {
    const collapsed = !!v;
    hud.classList.toggle("hud--collapsed", collapsed);
    if (hudToggle) {
      hudToggle.textContent = collapsed ? "▸" : "▾";
      hudToggle.setAttribute("aria-expanded", String(!collapsed));
    }
    if (hudDetails) hudDetails.style.display = collapsed ? "none" : "";
    try { localStorage.setItem(HUD_COLLAPSE_KEY, collapsed ? "1" : "0"); } catch (_) {}
    postState();
  }

  function setHudHidden(v) {
    const hidden = !!v;
    hud.classList.toggle("hidden", hidden);
    try { localStorage.setItem(HUD_HIDE_KEY, hidden ? "1" : "0"); } catch (_) {}
    postState();
  }

  function setRoundMins(mins) {
    const m = clamp(parseInt(mins, 10) || 5, 1, 120);
    roundSeconds = m * 60;
    // no resetea brusco: mantiene remaining si es menor
    startRound(Math.min(remainingSeconds(), roundSeconds));
    postState();
  }

  function goToId(id) {
    const n = cams.findIndex(c => c && c.id === id);
    if (n >= 0) {
      idx = n;
      playCam(cams[idx]);
    }
  }

  function banId(id) {
    if (!id) return;
    banned.add(id);
    try { localStorage.setItem(BAN_KEY, JSON.stringify(Array.from(banned))); } catch (_) {}
    applyFilters();
    idx = idx % cams.length;
    playCam(cams[idx]);
  }

  function resetState() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    idx = 0;
    setPlaying(true);
    modeAdfree = false;
    autoskip = true;
    applyFilters();
    setFit("cover");
    setRoundMins(5);
    setHudHidden(false);
    setHudCollapsed(true);
    playCam(cams[idx]);
  }

  // Commands
  function applyCommand(cmd, payload) {
    switch (cmd) {
      case "NEXT": nextCam("cmd"); break;
      case "PREV": prevCam(); break;
      case "TOGGLE_PLAY": setPlaying(!playing); break;
      case "PLAY": setPlaying(true); break;
      case "PAUSE": setPlaying(false); break;
      case "SHUFFLE": reshuffle(); break;
      case "SET_MINS": setRoundMins(payload?.mins); break;
      case "SET_FIT": setFit(payload?.fit); postState(); break;
      case "SET_HUD": setHudHidden(payload?.on === false); break;
      case "SET_HUD_DETAILS": setHudCollapsed(payload?.collapsed !== false); break;
      case "SET_AUTOSKIP": autoskip = !!payload?.on; postState(); break;
      case "SET_ADFREE":
        modeAdfree = !!payload?.on;
        applyFilters();
        idx = idx % cams.length;
        playCam(cams[idx]);
        break;
      case "GOTO_ID": goToId(payload?.id); break;
      case "BAN_ID": banId(payload?.id); break;
      case "RESET": resetState(); break;
      default: break;
    }
  }

  // Receive commands from BroadcastChannel
  if (bc) {
    bc.onmessage = (ev) => {
      const msg = ev?.data;
      if (!msg || msg.type !== "cmd") return;
      if ((msg.ts | 0) <= (lastCmdTs | 0)) return;
      lastCmdTs = msg.ts | 0;
      applyCommand(msg.cmd, msg.payload || {});
    };
  }

  // Fallback: storage events
  window.addEventListener("storage", (e) => {
    if (!e || e.key !== CMD_KEY || !e.newValue) return;
    try {
      const msg = JSON.parse(e.newValue);
      if (!msg || msg.type !== "cmd") return;
      if ((msg.ts | 0) <= (lastCmdTs | 0)) return;
      lastCmdTs = msg.ts | 0;
      applyCommand(msg.cmd, msg.payload || {});
    } catch (_) {}
  });

  // Persist player state (idx, remaining, playing)
  function loadPlayerState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) { return null; }
  }
  function savePlayerState() {
    try {
      const st = {
        idx,
        remaining: remainingSeconds(),
        playing,
        mins: Math.max(1, (roundSeconds / 60) | 0),
        fit: currentFit,
        autoskip: autoskip ? 1 : 0,
        adfree: modeAdfree ? 1 : 0,
        ts: Date.now(),
        v: 2
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
    } catch (_) {}
  }

  function tick() {
    if (!playing) return;
    setCountdownUI();
    if (remainingSeconds() <= 0) nextCam("timer");
  }

  function boot() {
    if (!allCams.length) {
      showFallback({ originUrl: "#" }, "No hay cámaras definidas (revisa cams.js).");
      return;
    }

    setFit(P.fit);

    // HUD user prefs
    let collapsed = true;
    let hidden = !P.hud;
    try { collapsed = (localStorage.getItem(HUD_COLLAPSE_KEY) ?? "1") === "1"; } catch (_) {}
    try { hidden = (localStorage.getItem(HUD_HIDE_KEY) ?? (P.hud ? "0" : "1")) === "1"; } catch (_) {}
    setHudCollapsed(collapsed);
    setHudHidden(hidden);

    if (hudToggle) {
      hudToggle.addEventListener("click", (e) => {
        e.preventDefault();
        setHudCollapsed(!hud.classList.contains("hud--collapsed"));
      });
    }

    shuffle(cams, rnd);

    const st = loadPlayerState();
    if (st && typeof st.idx === "number" && st.idx >= 0 && st.idx < cams.length) {
      idx = st.idx | 0;
      playing = !!st.playing;
      autoskip = (st.autoskip ?? 1) !== 0;
      modeAdfree = !!st.adfree;
      applyFilters();
      setFit(st.fit || P.fit);
      setRoundMins(st.mins || P.mins);

      const rem = clamp((st.remaining | 0) || roundSeconds, 1, 120 * 60);
      startRound(rem);
    } else {
      idx = 0;
      playing = true;
      setRoundMins(P.mins);
      startRound(roundSeconds);
    }

    playCam(cams[idx]);

    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(tick, 250);

    setInterval(() => { savePlayerState(); postState(); }, 2000);
    document.addEventListener("visibilitychange", () => { if (document.hidden) { savePlayerState(); postState(); } });

    // Primera señal
    postState({ ready: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
