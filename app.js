/* app.js — RLC Player v2.0.4 PRO (HEALTH + AUTOSKIP HARD)
   ✅ Detecta streams/imágenes caídas y salta a la siguiente automáticamente
   ✅ “CoolDown” de cams fallidas (evita repetir la misma rota)
   ✅ Mantiene: voto configurable (voteAt/voteLead/voteWindow), STAY, ytCookies, chat overlay
*/
(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;
  const LOAD_GUARD = "__RLC_PLAYER_LOADED_V204_PRO";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  // ───────────────────────── Bus ─────────────────────────
  const BUS = "rlc_bus_v1";
  const CMD_KEY = "rlc_cmd_v1";
  const STATE_KEY = "rlc_state_v1";

  // ───────────────────────── Health / fail cache ─────────────────────────
  const BAD_KEY = "rlc_bad_ids_v1"; // cooldown temporal por fallos
  const BAD_BASE_COOLDOWN_MS = 30 * 60 * 1000; // 30 min base
  const BAD_MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h max
  const START_TIMEOUT_MS = 12000;   // si no arranca en 12s -> fail
  const STALL_TIMEOUT_MS = 15000;   // si se queda colgado 15s -> fail
  const MAX_STALLS = 2;             // 2 stalls largos -> fail

  const qs = (s) => document.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtMMSS = (sec) => {
    sec = Math.max(0, sec | 0);
    const m = (sec / 60) | 0;
    const s = sec - m * 60;
    return `${pad2(m)}:${pad2(s)}`;
  };

  function parseBoolParam(v, def = false) {
    if (v == null) return def;
    const s = String(v).trim().toLowerCase();
    if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
    if (s === "0" || s === "false" || s === "no" || s === "off") return false;
    return def;
  }

  function parseParams() {
    const u = new URL(location.href);

    const twitch = (u.searchParams.get("twitch") || "").trim().replace(/^@/, "");

    const chatParam = u.searchParams.get("chat") ?? u.searchParams.get("chatOverlay");
    const chatExplicit = (chatParam != null);
    const chat = chatExplicit ? parseBoolParam(chatParam, true) : !!twitch;

    return {
      mins: clamp(parseInt(u.searchParams.get("mins") || "5", 10) || 5, 1, 120),
      fit: (u.searchParams.get("fit") || "cover"),
      hud: (u.searchParams.get("hud") ?? "1") !== "0",
      seed: u.searchParams.get("seed") || "",
      autoskip: (u.searchParams.get("autoskip") ?? "1") !== "0",
      mode: (u.searchParams.get("mode") || "").toLowerCase(), // adfree
      debug: (u.searchParams.get("debug") === "1"),

      key: u.searchParams.get("key") || "",

      // YouTube embed mode
      ytCookies: (u.searchParams.get("ytCookies") ?? "0") === "1",

      // BGM init
      bgm: (u.searchParams.get("bgm") ?? "0") === "1",
      bgmVol: clamp(parseFloat(u.searchParams.get("bgmVol") || "0.25") || 0.25, 0, 1),

      // Vote init
      vote: (u.searchParams.get("vote") ?? "0") === "1",
      twitch,

      voteWindow: clamp(parseInt(u.searchParams.get("voteWindow") || "60", 10) || 60, 5, 180),
      voteAt: clamp(parseInt(u.searchParams.get("voteAt") || "60", 10) || 60, 5, 600),
      voteLead: clamp(parseInt(u.searchParams.get("voteLead") || "5", 10) || 5, 0, 30),

      voteUi: clamp(parseInt(u.searchParams.get("voteUi") || "0", 10) || 0, 0, 300),
      stayMins: clamp(parseInt(u.searchParams.get("stayMins") || "5", 10) || 5, 1, 120),

      voteCmd: (u.searchParams.get("voteCmd") || "!next,!cam|!stay,!keep").trim(),
      voteOverlay: (u.searchParams.get("voteOverlay") ?? "1") !== "0",

      // Chat overlay
      chat,
      chatExplicit,
      chatHideCommands: parseBoolParam(u.searchParams.get("chatHideCommands"), true),
      chatHideExplicit: (u.searchParams.get("chatHideCommands") != null),
      chatMax: clamp(parseInt(u.searchParams.get("chatMax") || "7", 10) || 7, 3, 12),
      chatMaxExplicit: (u.searchParams.get("chatMax") != null),
      chatTtl: clamp(parseInt(u.searchParams.get("chatTtl") || "12", 10) || 12, 5, 30),
      chatTtlExplicit: (u.searchParams.get("chatTtl") != null),
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

  // Vote overlay
  const voteBox = qs("#voteBox");
  const voteTimeEl = qs("#voteTime");
  const voteHintEl = qs("#voteHint");
  const voteYesFill = qs("#voteYes");
  const voteNoFill = qs("#voteNo");
  const voteYesN = qs("#voteYesN");
  const voteNoN = qs("#voteNoN");

  // Audio
  const bgmEl = qs("#bgm");

  const P = parseParams();
  const rnd = makeRng(P.seed);

  // State keys
  const STORAGE_KEY = "rlc_player_state_v2";
  const HUD_COLLAPSE_KEY = "rlc_hud_collapsed_v2";
  const HUD_HIDE_KEY = "rlc_hud_hidden_v2";
  const BAN_KEY = "rlc_ban_ids_v1";

  // Cams
  let allCams = Array.isArray(g.CAM_LIST) ? g.CAM_LIST.slice() : [];
  let banned = new Set();
  try {
    const raw = localStorage.getItem(BAN_KEY);
    if (raw) banned = new Set(JSON.parse(raw));
  } catch (_) {}

  // BAD cache
  let badMap = {};
  function loadBad() {
    try {
      const raw = localStorage.getItem(BAD_KEY);
      badMap = raw ? JSON.parse(raw) : {};
      if (!badMap || typeof badMap !== "object") badMap = {};
    } catch (_) { badMap = {}; }
  }
  function saveBad() {
    try { localStorage.setItem(BAD_KEY, JSON.stringify(badMap || {})); } catch (_) {}
  }
  function purgeBad() {
    const now = Date.now();
    let dirty = false;
    for (const k of Object.keys(badMap || {})) {
      const it = badMap[k];
      if (!it || (it.until && now >= it.until)) { delete badMap[k]; dirty = true; }
    }
    if (dirty) saveBad();
  }
  function isBad(id) {
    if (!id) return false;
    const it = badMap[id];
    if (!it) return false;
    const until = it.until | 0;
    if (!until) return false;
    if (Date.now() >= until) return false;
    return true;
  }
  function markBad(id, reason) {
    if (!id) return;
    const now = Date.now();
    const prev = badMap[id] || {};
    const fails = clamp(((prev.fails | 0) || 0) + 1, 1, 999);
    const mult = clamp(fails, 1, 12);
    const cooldown = clamp(BAD_BASE_COOLDOWN_MS * mult, BAD_BASE_COOLDOWN_MS, BAD_MAX_COOLDOWN_MS);
    badMap[id] = { fails, until: now + cooldown, last: now, reason: String(reason || "fail") };
    saveBad();
  }

  let modeAdfree = (P.mode === "adfree");
  let autoskip = !!P.autoskip;

  let cams = [];
  function applyFilters() {
    purgeBad();
    let list = allCams.filter(c => c && !banned.has(c.id) && !isBad(c.id));
    if (modeAdfree) list = list.filter(c => c.kind !== "youtube");

    // Si te quedas sin lista por “bad cooldown”, aflojamos (no bloqueamos el player)
    if (!list.length) {
      list = allCams.filter(c => c && !banned.has(c.id));
      if (modeAdfree) list = list.filter(c => c.kind !== "youtube");
    }

    cams = list.length ? list : allCams.slice();
  }

  loadBad();
  applyFilters();

  // Playback state
  let idx = 0;
  let playing = true;

  // base “mins”
  let roundSeconds = P.mins * 60;

  // segmento actual
  let segmentSeconds = roundSeconds;

  let roundEndsAt = 0;
  let pausedRemaining = 0;

  let tickTimer = null;
  let imgTimer = null;
  let hls = null;
  let switching = false;

  // Comms
  const bc = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS) : null;
  let lastCmdTs = 0;

  // Fit
  let currentFit = "cover";
  function setFit(mode) {
    currentFit = (mode === "contain") ? "contain" : "cover";
    try { if (frame) frame.style.objectFit = currentFit; } catch (_) {}
    try { if (video) video.style.objectFit = currentFit; } catch (_) {}
    try { if (img) img.style.objectFit = currentFit; } catch (_) {}
  }

  // HUD collapse/hide
  function setHudCollapsed(v) {
    const collapsed = !!v;
    if (hud) hud.classList.toggle("hud--collapsed", collapsed);
    if (hudToggle) {
      hudToggle.textContent = collapsed ? "▸" : "▾";
      hudToggle.setAttribute("aria-expanded", String(!collapsed));
      hudToggle.setAttribute("aria-label", collapsed ? "Expandir HUD" : "Contraer HUD");
    }
    if (hudDetails) hudDetails.style.display = collapsed ? "none" : "";
    try { localStorage.setItem(HUD_COLLAPSE_KEY, collapsed ? "1" : "0"); } catch (_) {}
    postState();
  }

  function setHudHidden(v) {
    const hidden = !!v;
    if (hud) hud.classList.toggle("hidden", hidden);
    try { localStorage.setItem(HUD_HIDE_KEY, hidden ? "1" : "0"); } catch (_) {}
    postState();
  }

  // Timer helpers (con pausa REAL)
  function remainingSeconds() {
    if (!playing) return Math.max(0, pausedRemaining | 0);
    if (!roundEndsAt) return Math.max(0, segmentSeconds | 0);
    const ms = roundEndsAt - Date.now();
    return Math.max(0, Math.ceil(ms / 1000));
  }

  function setCountdownUI() {
    const rem = remainingSeconds();
    if (hudCountdown) hudCountdown.textContent = fmtMMSS(rem);
    const denom = Math.max(1, (segmentSeconds | 0) || 1);
    const pct = 100 * (1 - (rem / denom));
    if (progressBar) progressBar.style.width = `${clamp(pct, 0, 100).toFixed(2)}%`;
  }

  // VOTE scheduling flags
  let voteTriggeredForSegment = false;

  function startRound(seconds) {
    const s = clamp(seconds | 0, 1, 120 * 60);
    segmentSeconds = s;
    voteTriggeredForSegment = false;

    if (playing) {
      roundEndsAt = Date.now() + s * 1000;
      pausedRemaining = 0;
    } else {
      roundEndsAt = 0;
      pausedRemaining = s;
    }
    setCountdownUI();
  }

  function startRoundWithRemaining(totalSec, remainingSec) {
    const total = clamp(totalSec | 0, 1, 120 * 60);
    const rem = clamp(remainingSec | 0, 0, total);
    segmentSeconds = total;
    voteTriggeredForSegment = false;

    if (playing) {
      roundEndsAt = Date.now() + rem * 1000;
      pausedRemaining = 0;
    } else {
      roundEndsAt = 0;
      pausedRemaining = rem;
    }
    setCountdownUI();
  }

  function setPlaying(v) {
    const want = !!v;
    if (want === playing) return;

    if (!want) {
      pausedRemaining = remainingSeconds();
      playing = false;
      roundEndsAt = 0;
    } else {
      playing = true;
      const rem = clamp(pausedRemaining | 0, 0, Math.max(1, segmentSeconds | 0));
      pausedRemaining = 0;
      roundEndsAt = Date.now() + Math.max(1, rem) * 1000;
    }
    setCountdownUI();
    postState();
  }

  function togglePlay() { setPlaying(!playing); }

  // UI helpers
  function showOnly(kind) {
    if (frame) frame.classList.add("hidden");
    if (video) video.classList.add("hidden");
    if (img) img.classList.add("hidden");
    if (fallback) fallback.classList.add("hidden");

    if (kind === "youtube") { if (frame) frame.classList.remove("hidden"); }
    else if (kind === "hls") { if (video) video.classList.remove("hidden"); }
    else if (kind === "image") { if (img) img.classList.remove("hidden"); }
    else { if (fallback) fallback.classList.remove("hidden"); }
  }

  // ───────────────────────── Health watchdog ─────────────────────────
  let playToken = 0;
  let startTimer = null;
  let stallTimer = null;
  let lastProgressAt = 0;
  let stallCount = 0;
  let startedOk = false;

  function healthReset() {
    try { if (startTimer) clearTimeout(startTimer); } catch (_) {}
    try { if (stallTimer) clearTimeout(stallTimer); } catch (_) {}
    startTimer = null;
    stallTimer = null;
    lastProgressAt = Date.now();
    stallCount = 0;
    startedOk = false;
  }

  function healthProgress(tok) {
    if (tok !== playToken) return;
    lastProgressAt = Date.now();
    startedOk = true;
    stallCount = 0;
    try { if (startTimer) clearTimeout(startTimer); } catch (_) {}
    startTimer = null;
  }

  function healthStall(tok, cam, reason = "stall") {
    if (tok !== playToken) return;
    if (!autoskip) return;

    stallCount++;
    // si hay demasiados stalls => fuera
    if (stallCount >= MAX_STALLS) {
      healthFail(tok, cam, `stall_${reason}`);
      return;
    }

    try { if (stallTimer) clearTimeout(stallTimer); } catch (_) {}
    stallTimer = setTimeout(() => {
      if (tok !== playToken) return;
      const age = Date.now() - (lastProgressAt || 0);
      if (age >= STALL_TIMEOUT_MS) healthFail(tok, cam, `stall_timeout_${reason}`);
    }, STALL_TIMEOUT_MS);
  }

  function healthExpectStart(tok, cam, kind = "media") {
    healthReset();
    if (!autoskip) return;
    startTimer = setTimeout(() => {
      if (tok !== playToken) return;
      // si nunca hubo progreso real -> fail
      if (!startedOk) healthFail(tok, cam, `${kind}_start_timeout`);
    }, START_TIMEOUT_MS);
  }

  function healthFail(tok, cam, reason) {
    if (tok !== playToken) return;
    if (!autoskip) return;

    const id = cam?.id;
    if (id) markBad(id, reason);

    // Refiltramos para no volver a caer en la misma rota enseguida
    applyFilters();
    idx = idx % Math.max(1, cams.length);

    showFallback(cam, "Stream/imagen no disponible. Saltando…");
    setTimeout(() => nextCam(String(reason || "fail")), 900);
  }

  function clearMedia() {
    healthReset();

    if (imgTimer) { clearInterval(imgTimer); imgTimer = null; }
    try { if (hls) { hls.destroy(); hls = null; } } catch (_) {}

    try { if (frame) { frame.onload = null; frame.src = "about:blank"; } } catch (_) {}

    try {
      if (video) {
        video.onplaying = null;
        video.oncanplay = null;
        video.onloadeddata = null;
        video.ontimeupdate = null;
        video.onstalled = null;
        video.onwaiting = null;
        video.onerror = null;

        video.pause();
        video.removeAttribute("src");
        video.load();
      }
    } catch (_) {}

    try {
      if (img) {
        img.onload = null;
        img.onerror = null;
        img.removeAttribute("src");
      }
    } catch (_) {}
  }

  function setHud(cam) {
    if (hudTitle) hudTitle.textContent = cam?.title || "Live Cam";
    if (hudPlace) hudPlace.textContent = cam?.place || "—";
    if (hudSource) hudSource.textContent = cam?.source || "—";
    if (hudOrigin) {
      hudOrigin.href = cam?.originUrl || "#";
      hudOrigin.style.pointerEvents = cam?.originUrl ? "auto" : "none";
      hudOrigin.style.opacity = cam?.originUrl ? "1" : ".6";
    }
    if (hudIndex) hudIndex.textContent = `${idx + 1}/${Math.max(1, cams.length)}`;
  }

  function showFallback(cam, msg) {
    clearMedia();
    showOnly("fallback");
    const t = fallback ? fallback.querySelector(".fallbackText") : null;
    if (t) t.textContent = msg || "Saltando…";
    if (fallbackLink) {
      fallbackLink.href = cam?.originUrl || "#";
      fallbackLink.style.pointerEvents = cam?.originUrl ? "auto" : "none";
      fallbackLink.style.opacity = cam?.originUrl ? "1" : ".6";
    }
  }

  async function safePlayVideo() {
    try {
      const p = video && video.play ? video.play() : null;
      if (p && typeof p.then === "function") await p;
    } catch (_) {}
  }

  function effectiveSeconds(cam) {
    if (cam && typeof cam.maxSeconds === "number" && cam.maxSeconds > 0) return cam.maxSeconds | 0;
    if (cam && cam.kind === "image") return 60;
    return roundSeconds;
  }

  function resetVoteForNewCam() {
    voteTriggeredForSegment = false;
    voteReset();
  }

  function playCam(cam) {
    if (!cam) {
      showFallback({ originUrl: "#" }, "Cam inválida. Saltando…");
      setTimeout(() => nextCam("invalid_cam"), 500);
      return;
    }

    clearMedia();
    setHud(cam);

    startRound(effectiveSeconds(cam));
    resetVoteForNewCam();

    // nuevo token de reproducción (para invalidar callbacks viejos)
    playToken++;
    const tok = playToken;

    if (cam.kind === "youtube") {
      showOnly("youtube");

      // watchdog: esperamos al menos al onload del iframe
      healthExpectStart(tok, cam, "youtube");

      const base = P.ytCookies ? "https://www.youtube.com" : "https://www.youtube-nocookie.com";
      const src =
        `${base}/embed/${encodeURIComponent(cam.youtubeId || "")}`
        + `?autoplay=1&mute=1&controls=0&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&fs=0&disablekb=1`
        + `&enablejsapi=1`; // (no garantiza error detect, pero ayuda compat)

      if (!cam.youtubeId) {
        healthFail(tok, cam, "youtube_missing_id");
        return;
      }

      if (frame) {
        frame.onload = () => healthProgress(tok);
        frame.src = src;
      } else {
        healthFail(tok, cam, "youtube_no_iframe");
        return;
      }

      postState();
      return;
    }

    if (cam.kind === "image") {
      showOnly("image");

      // watchdog: esperamos al onload de la imagen
      healthExpectStart(tok, cam, "image");

      const refreshMs = Math.max(5000, (cam.refreshMs | 0) || 60000);

      const setSnap = () => {
        const u = cam.url || "";
        if (!u) { healthFail(tok, cam, "image_no_url"); return; }
        const sep = (u.indexOf("?") >= 0) ? "&" : "?";
        if (img) img.src = `${u}${sep}t=${Date.now()}`;
      };

      if (img) {
        img.onload = () => healthProgress(tok);

        img.onerror = () => {
          if (!autoskip) return;
          img.onerror = null;
          healthFail(tok, cam, "image_error");
        };
      }

      setSnap();
      imgTimer = setInterval(setSnap, refreshMs);

      postState();
      return;
    }

    if (cam.kind === "hls") {
      showOnly("hls");

      const url = cam.url || "";
      const Hls = g.Hls;

      if (!url || !video) {
        healthFail(tok, cam, "hls_no_url_or_video");
        return;
      }

      // watchdog de arranque
      healthExpectStart(tok, cam, "hls");

      // video health signals
      video.onloadeddata = () => healthProgress(tok);
      video.oncanplay = () => { healthProgress(tok); safePlayVideo(); };
      video.onplaying = () => healthProgress(tok);
      video.ontimeupdate = () => healthProgress(tok);

      video.onwaiting = () => healthStall(tok, cam, "waiting");
      video.onstalled = () => healthStall(tok, cam, "stalled");
      video.onerror = () => healthFail(tok, cam, "video_error");

      if (video.canPlayType && video.canPlayType("application/vnd.apple.mpegurl")) {
        // Safari / iOS / algunos navegadores
        try { video.src = url; } catch (_) {}
        safePlayVideo();
        postState();
        return;
      }

      // Hls.js
      if (Hls && Hls.isSupported && Hls.isSupported()) {
        try {
          hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30 });
          hls.loadSource(url);
          hls.attachMedia(video);

          hls.on(Hls.Events.ERROR, (_ev, data) => {
            if (!autoskip) return;
            if (data && data.fatal) {
              healthFail(tok, cam, `hls_fatal_${data.type || "err"}`);
            }
          });

          // si parsea manifest, es buena señal (no siempre significa reproducción)
          hls.on(Hls.Events.MANIFEST_PARSED, () => healthProgress(tok));
        } catch (_) {
          healthFail(tok, cam, "hls_exception");
          return;
        }

        postState();
        return;
      }

      showFallback(cam, "HLS no soportado aquí.");
      if (autoskip) setTimeout(() => healthFail(tok, cam, "hls_unsupported"), 700);
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

  function reshuffle() {
    const curId = cams[idx] && cams[idx].id;
    shuffle(cams, rnd);
    const n = cams.findIndex(c => c.id === curId);
    idx = (n >= 0) ? n : 0;
    playCam(cams[idx]);
  }

  function setRoundMins(mins) {
    const m = clamp(parseInt(mins, 10) || 5, 1, 120);
    roundSeconds = m * 60;

    const rem = remainingSeconds();
    const next = Math.min(rem || roundSeconds, roundSeconds);
    startRound(next);
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
    idx = idx % Math.max(1, cams.length);
    playCam(cams[idx]);
  }

  function resetState() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    idx = 0;
    modeAdfree = false;
    autoskip = true;

    // NO borramos BAD (cooldown) aquí a propósito: evita “loop” en cams rotas
    // Si quieres borrarlo manual:
    // localStorage.removeItem(BAD_KEY);

    applyFilters();
    setFit("cover");
    setRoundMins(5);
    setHudHidden(false);
    setHudCollapsed(true);
    setPlaying(true);
    playCam(cams[idx]);
  }

  // ───────────────────────── BGM ─────────────────────────
  const bgmList = Array.isArray(g.BGM_LIST) ? g.BGM_LIST.slice() : [];
  let bgmEnabled = !!P.bgm;
  let bgmVol = P.bgmVol;
  let bgmIdx = 0;
  let bgmPlaying = false;

  function bgmSetVol(v) {
    bgmVol = clamp(+v || 0, 0, 1);
    try { if (bgmEl) bgmEl.volume = bgmVol; } catch (_) {}
    postState();
  }

  function bgmLoadTrack(i) {
    if (!bgmList.length || !bgmEl) return;
    bgmIdx = (i % bgmList.length + bgmList.length) % bgmList.length;
    const t = bgmList[bgmIdx];
    try { bgmEl.src = t.url; bgmEl.load(); } catch (_) {}
    postState();
  }

  async function bgmPlay() {
    if (!bgmEnabled || !bgmList.length || !bgmEl) return;
    try {
      if (!bgmEl.src) bgmLoadTrack(bgmIdx);
      const p = bgmEl.play();
      if (p && typeof p.then === "function") await p;
      bgmPlaying = true;
    } catch (_) {
      bgmPlaying = false;
    }
    postState();
  }

  function bgmPause() {
    try { if (bgmEl) bgmEl.pause(); } catch (_) {}
    bgmPlaying = false;
    postState();
  }

  function bgmPlayPause() { bgmPlaying ? bgmPause() : bgmPlay(); }
  function bgmNext() { bgmLoadTrack(bgmIdx + 1); if (bgmEnabled) bgmPlay(); }
  function bgmPrev() { bgmLoadTrack(bgmIdx - 1); if (bgmEnabled) bgmPlay(); }
  function bgmShuffle() {
    if (bgmList.length < 2) return;
    shuffle(bgmList, rnd);
    bgmIdx = 0;
    bgmLoadTrack(0);
    if (bgmEnabled) bgmPlay();
  }

  bgmEl?.addEventListener?.("ended", () => {
    if (bgmEnabled) bgmNext();
  });

  // ───────────────────────── Chat Overlay ─────────────────────────
  let chatEnabled = !!P.chat;
  let chatHideCommands = !!P.chatHideCommands;
  let chatMax = P.chatMax | 0;
  let chatTtlSec = P.chatTtl | 0;

  let chatRoot = null;
  let chatList = null;
  let chatItems = [];

  function injectChatStylesOnce() {
    if (document.getElementById("rlcChatStyles")) return;
    const st = document.createElement("style");
    st.id = "rlcChatStyles";
    st.textContent = `
      .rlcChatRoot{
        position: fixed;
        right: max(12px, env(safe-area-inset-right));
        bottom: max(12px, env(safe-area-inset-bottom));
        width: min(360px, calc(100vw - 24px));
        max-height: min(44vh, 420px);
        z-index: 9999;
        pointer-events: none;
        display: none;
      }
      .rlcChatRoot.chat--on{ display: block !important; }
      .rlcChatList{
        display:flex;
        flex-direction:column;
        justify-content:flex-end;
        gap:8px;
        max-height: min(44vh, 420px);
        overflow:hidden;
        position:relative;
      }
      .rlcChatBubble{
        pointer-events:none;
        display:flex;
        gap:8px;
        align-items:flex-end;
        padding:8px 10px;
        border-radius:14px;
        background: rgba(10,14,20,.46);
        border:1px solid rgba(255,255,255,.10);
        box-shadow: 0 10px 30px rgba(0,0,0,.28);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        transform: translateY(6px);
        opacity:0;
        animation: rlcChatIn .16s ease-out forwards;
      }
      @keyframes rlcChatIn{ to { transform: translateY(0); opacity:1; } }
      .rlcChatBubble.rlcChatFade{ animation: rlcChatOut .25s ease-in forwards; }
      @keyframes rlcChatOut{ to { transform: translateY(6px); opacity:0; } }
      .rlcChatUser{
        font-weight:900;
        font-size:12px;
        color: rgba(77,215,255,.95);
        white-space:nowrap;
        max-width:120px;
        overflow:hidden;
        text-overflow:ellipsis;
      }
      .rlcChatText{
        font-size:12px;
        color: rgba(255,255,255,.90);
        line-height:1.25;
        word-break: break-word;
        overflow-wrap:anywhere;
        white-space: pre-wrap;
      }
      @media (max-width: 520px){
        .rlcChatRoot{ width: min(320px, calc(100vw - 24px)); max-height: 38vh; }
        .rlcChatUser{ max-width: 95px; }
      }
    `;
    document.head.appendChild(st);
  }

  function ensureChatUI() {
    injectChatStylesOnce();

    chatRoot = document.getElementById("rlcChatRoot");
    if (!chatRoot) {
      chatRoot = document.createElement("div");
      chatRoot.id = "rlcChatRoot";
      chatRoot.className = "rlcChatRoot";
      document.body.appendChild(chatRoot);
    }

    chatList = document.getElementById("rlcChatList");
    if (!chatList) {
      chatList = document.createElement("div");
      chatList.id = "rlcChatList";
      chatList.className = "rlcChatList";
      chatRoot.appendChild(chatList);
    }
  }

  function chatClear() {
    try { chatItems.forEach(it => it.el?.remove?.()); } catch (_) {}
    chatItems = [];
  }

  function chatSetEnabled(v) {
    chatEnabled = !!v;
    ensureChatUI();

    if (!chatEnabled) {
      chatClear();
      chatRoot?.classList?.remove?.("chat--on");
      try { if (chatRoot) chatRoot.style.display = "none"; } catch (_) {}
    } else {
      try { if (chatRoot) chatRoot.style.display = ""; } catch (_) {}
      chatRoot?.classList?.add?.("chat--on");
    }

    ensureIrc();
    postState();
  }

  function isHiddenChatCommand(msg) {
    const s = String(msg || "").trim();
    if (!s) return true;
    if (!chatHideCommands) return false;
    return s[0] === "!";
  }

  function chatAdd(user, text) {
    if (!chatEnabled) return;
    ensureChatUI();
    if (!chatRoot || !chatList) return;

    if (isHiddenChatCommand(text)) return;

    chatRoot.classList.add("chat--on");
    try { chatRoot.style.display = ""; } catch (_) {}

    const bubble = document.createElement("div");
    bubble.className = "rlcChatBubble";

    const u = document.createElement("div");
    u.className = "rlcChatUser";
    u.textContent = user || "chat";

    const t = document.createElement("div");
    t.className = "rlcChatText";
    t.textContent = String(text || "");

    bubble.appendChild(u);
    bubble.appendChild(t);

    chatList.appendChild(bubble);

    const item = { el: bubble, ts: Date.now() };
    chatItems.push(item);

    while (chatItems.length > chatMax) {
      const old = chatItems.shift();
      try { old?.el?.remove?.(); } catch (_) {}
    }

    setTimeout(() => {
      try { bubble.classList.add("rlcChatFade"); } catch (_) {}
      setTimeout(() => {
        try { bubble.remove(); } catch (_) {}
      }, 300);
    }, Math.max(3000, chatTtlSec * 1000));
  }

  // ───────────────────────── VOTE + IRC ─────────────────────────
  let voteEnabled = !!P.vote;
  let voteOverlay = !!P.voteOverlay;
  let twitchChannel = P.twitch || "";

  let voteWindowSec = P.voteWindow;
  let voteAtSec = P.voteAt;
  let voteLeadSec = P.voteLead;
  let voteUiSec = (P.voteUi > 0) ? P.voteUi : (voteLeadSec + voteWindowSec);
  let stayMins = P.stayMins;

  let cmdYes = new Set(["!next","!cam"]);
  let cmdNo = new Set(["!stay","!keep"]);

  let voteSessionActive = false;
  let votePhase = "idle";
  let leadEndsAt = 0;
  let voteEndsAt = 0;

  let votesYes = 0, votesNo = 0;
  let voters = new Set();

  function parseVoteCmds(str) {
    const parts = String(str || "").split("|");
    const a = (parts[0] || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    const b = (parts[1] || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    cmdYes = new Set(a.length ? a : ["!next","!cam"]);
    cmdNo = new Set(b.length ? b : ["!stay","!keep"]);
  }
  parseVoteCmds(P.voteCmd);

  function unescapeTagValue(v) {
    const s = String(v || "");
    return s
      .replace(/\\s/g, " ")
      .replace(/\\:/g, ";")
      .replace(/\\r/g, "\r")
      .replace(/\\n/g, "\n")
      .replace(/\\\\/g, "\\");
  }

  class TwitchAnonIRC {
    constructor(channel, onPrivmsg) {
      this.channel = channel;
      this.onPrivmsg = onPrivmsg;
      this.ws = null;
      this.closed = false;
      this.nick = "justinfan" + String(((Math.random() * 9e7) | 0) + 1e7);
      this.reconnectTimer = null;
    }
    connect() {
      if (!this.channel) return;
      this.closed = false;
      const ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
      this.ws = ws;

      ws.onopen = () => {
        ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands\r\n");
        ws.send("PASS SCHMOOPIIE\r\n");
        ws.send(`NICK ${this.nick}\r\n`);
        ws.send(`JOIN #${this.channel.toLowerCase()}\r\n`);
      };

      ws.onmessage = (ev) => {
        const text = String(ev.data || "");
        const lines = text.split("\r\n").filter(Boolean);
        for (const line of lines) this._handleLine(line);
      };

      ws.onclose = () => {
        if (this.closed) return;
        this._scheduleReconnect();
      };

      ws.onerror = () => {};
    }
    close() {
      this.closed = true;
      try { if (this.reconnectTimer) clearTimeout(this.reconnectTimer); } catch (_) {}
      try { this.ws?.close?.(); } catch (_) {}
      this.ws = null;
    }
    _scheduleReconnect() {
      try { if (this.reconnectTimer) clearTimeout(this.reconnectTimer); } catch (_) {}
      this.reconnectTimer = setTimeout(() => {
        if (this.closed) return;
        this.connect();
      }, 2000);
    }
    _handleLine(line) {
      if (!line) return;
      if (line.startsWith("PING")) {
        try { this.ws?.send?.("PONG :tmi.twitch.tv\r\n"); } catch (_) {}
        return;
      }

      let tags = "";
      let rest = line;
      if (rest[0] === "@") {
        const sp = rest.indexOf(" ");
        tags = rest.slice(1, sp);
        rest = rest.slice(sp + 1);
      }

      const m = rest.match(/^:([^!]+)![^ ]+ PRIVMSG #[^ ]+ :(.+)$/);
      if (!m) return;

      const user = (m[1] || "").toLowerCase();
      const msg = (m[2] || "").trim();

      let userId = user;
      let displayName = "";
      if (tags) {
        const parts = tags.split(";");
        for (const p of parts) {
          const eq = p.indexOf("=");
          const k = (eq >= 0) ? p.slice(0, eq) : p;
          const v = (eq >= 0) ? p.slice(eq + 1) : "";
          if (k === "user-id" && v) userId = v;
          if (k === "display-name" && v) displayName = unescapeTagValue(v);
        }
      }

      try { this.onPrivmsg?.({ userId, user, displayName, msg }); } catch (_) {}
    }
  }

  let irc = null;
  function ensureIrc() {
    const need = (!!twitchChannel) && (voteEnabled || chatEnabled);
    if (!need) {
      try { irc?.close?.(); } catch (_) {}
      irc = null;
      return;
    }
    if (irc) return;
    irc = new TwitchAnonIRC(twitchChannel, handleChatEvent);
    try { irc.connect(); } catch (_) { irc = null; }
  }

  function voteReset() {
    voteSessionActive = false;
    votePhase = "idle";
    leadEndsAt = 0;
    voteEndsAt = 0;
    votesYes = 0; votesNo = 0;
    voters = new Set();
    renderVote();
  }

  function voteStartSequence(windowSec, leadSec) {
    if (!voteEnabled || !twitchChannel) return;

    const w = clamp(windowSec | 0, 5, 180);
    const lead = clamp(leadSec | 0, 0, 30);

    voteWindowSec = w;
    voteLeadSec = lead;
    voteUiSec = w + lead;

    votesYes = 0; votesNo = 0;
    voters = new Set();

    voteSessionActive = true;

    if (lead > 0) {
      votePhase = "lead";
      leadEndsAt = Date.now() + lead * 1000;
      voteEndsAt = leadEndsAt + w * 1000;
    } else {
      votePhase = "vote";
      leadEndsAt = 0;
      voteEndsAt = Date.now() + w * 1000;
    }

    renderVote();
  }

  function restartStaySegment() {
    const sec = clamp((stayMins | 0) * 60, 60, 120 * 60);
    startRound(sec);
    voteTriggeredForSegment = false;
    postState();
  }

  function voteFinish() {
    if (!voteSessionActive) return;

    const y = votesYes, n = votesNo;
    voteSessionActive = false;
    votePhase = "idle";
    renderVote();

    if (y > n && y > 0) nextCam("vote_yes");
    else restartStaySegment();
  }

  function renderVote() {
    if (!voteBox) return;
    const show = voteOverlay && voteEnabled && !!twitchChannel && voteSessionActive;
    voteBox.classList.toggle("hidden", !show);
    if (!show) return;

    const now = Date.now();
    const yes0 = [...cmdYes][0] || "!next";
    const no0  = [...cmdNo][0]  || "!stay";

    if (votePhase === "lead") {
      const remLead = Math.max(0, Math.ceil((leadEndsAt - now) / 1000));
      if (voteTimeEl) voteTimeEl.textContent = fmtMMSS(remLead);
      if (voteHintEl) voteHintEl.textContent = `Votación en… (${yes0} / ${no0})`;

      if (voteYesN) voteYesN.textContent = "0";
      if (voteNoN) voteNoN.textContent = "0";
      if (voteYesFill) voteYesFill.style.width = "0%";
      if (voteNoFill) voteNoFill.style.width = "0%";
      return;
    }

    const remVote = Math.max(0, Math.ceil((voteEndsAt - now) / 1000));
    if (voteTimeEl) voteTimeEl.textContent = fmtMMSS(remVote);
    if (voteHintEl) voteHintEl.textContent = `Vota: ${yes0} o ${no0}`;

    if (voteYesN) voteYesN.textContent = String(votesYes);
    if (voteNoN) voteNoN.textContent = String(votesNo);

    const total = Math.max(1, votesYes + votesNo);
    if (voteYesFill) voteYesFill.style.width = `${((votesYes / total) * 100).toFixed(1)}%`;
    if (voteNoFill) voteNoFill.style.width = `${((votesNo / total) * 100).toFixed(1)}%`;
  }

  function handleChatEvent({ userId, user, displayName, msg }) {
    const text = String(msg || "").trim();
    if (!text) return;

    // CHAT overlay
    if (chatEnabled && twitchChannel) {
      const name = (displayName || user || "chat").trim();
      if (!isHiddenChatCommand(text)) chatAdd(name, text);
    }

    // VOTO: SOLO en fase "vote"
    if (!voteSessionActive || votePhase !== "vote") return;

    const low = text.toLowerCase();
    const who = userId || user || "anon";
    if (voters.has(who)) return;

    if (cmdYes.has(low)) { voters.add(who); votesYes++; renderVote(); return; }
    if (cmdNo.has(low))  { voters.add(who); votesNo++;  renderVote(); return; }
  }

  // ───────────────────────── State publish ─────────────────────────
  function postState(extra = {}) {
    const cam = cams[idx] || {};
    const state = {
      type: "state",
      ts: Date.now(),
      playing,
      idx,
      total: cams.length,
      mins: Math.max(1, (roundSeconds / 60) | 0),
      segmentSec: segmentSeconds | 0,
      fit: currentFit,
      hudHidden: !!hud?.classList?.contains?.("hidden"),
      hudCollapsed: !!hud?.classList?.contains?.("hud--collapsed"),
      autoskip,
      adfree: modeAdfree,
      ytCookies: !!P.ytCookies,
      cam: {
        id: cam.id, title: cam.title, place: cam.place, source: cam.source,
        originUrl: cam.originUrl, kind: cam.kind
      },
      remaining: remainingSeconds(),

      bgm: {
        enabled: bgmEnabled,
        vol: bgmVol,
        playing: bgmPlaying,
        idx: bgmIdx,
        track: bgmList[bgmIdx]?.title || ""
      },

      chat: {
        enabled: chatEnabled,
        hideCommands: chatHideCommands,
        max: chatMax,
        ttl: chatTtlSec
      },

      vote: {
        enabled: voteEnabled,
        overlay: voteOverlay,
        channel: twitchChannel || "",
        windowSec: voteWindowSec,
        voteAtSec: voteAtSec,
        leadSec: voteLeadSec,
        uiSec: voteUiSec,
        stayMins: stayMins,
        cmd: (P.voteCmd || "!next,!cam|!stay,!keep"),
        sessionActive: voteSessionActive,
        phase: votePhase,
        yes: votesYes,
        no: votesNo
      },

      ...extra
    };

    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (_) {}
    try { if (bc) bc.postMessage(state); } catch (_) {}
  }

  // ───────────────────────── Commands ─────────────────────────
  function cmdKeyOk(msg) {
    if (!P.key) return true;
    return (msg && msg.key === P.key);
  }

  function applyCommand(cmd, payload) {
    switch (cmd) {
      case "NEXT": nextCam("cmd"); break;
      case "PREV": prevCam(); break;
      case "TOGGLE_PLAY": togglePlay(); break;
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
        idx = idx % Math.max(1, cams.length);
        playCam(cams[idx]);
        break;

      case "GOTO_ID": goToId(payload?.id); break;
      case "BAN_ID": banId(payload?.id); break;
      case "RESET": resetState(); break;

      // BGM
      case "BGM_ENABLE":
        bgmEnabled = !!payload?.on;
        if (bgmEnabled) bgmPlay(); else bgmPause();
        break;
      case "BGM_VOL": bgmSetVol(payload?.vol); break;
      case "BGM_TRACK":
        bgmLoadTrack(parseInt(payload?.index || "0", 10) || 0);
        if (bgmEnabled) bgmPlay();
        break;
      case "BGM_NEXT": bgmNext(); break;
      case "BGM_PREV": bgmPrev(); break;
      case "BGM_PLAYPAUSE": bgmPlayPause(); break;
      case "BGM_SHUFFLE": bgmShuffle(); break;

      // Vote / Twitch
      case "TWITCH_SET": {
        twitchChannel = String(payload?.channel || "").trim().replace(/^@/, "");
        voteEnabled = !!payload?.enabled;
        voteOverlay = !!payload?.overlay;

        voteWindowSec = clamp(parseInt(payload?.windowSec ?? voteWindowSec, 10) || voteWindowSec, 5, 180);

        const pVoteAt =
          payload?.voteAtSec ?? payload?.triggerBeforeEndSec ?? payload?.voteAt ?? payload?.voteTriggerBeforeEndSec;
        if (pVoteAt != null) voteAtSec = clamp(parseInt(pVoteAt, 10) || voteAtSec, 5, 600);

        const pLead = payload?.leadSec ?? payload?.voteLeadSec ?? payload?.voteLead;
        if (pLead != null) voteLeadSec = clamp(parseInt(pLead, 10) || voteLeadSec, 0, 30);

        voteUiSec = voteLeadSec + voteWindowSec;

        if (payload?.stayMins != null) stayMins = clamp(parseInt(payload?.stayMins, 10) || stayMins, 1, 120);
        parseVoteCmds(payload?.cmd || "!next,!cam|!stay,!keep");

        if (payload?.chat != null || payload?.chatOverlay != null) chatSetEnabled(!!(payload?.chat ?? payload?.chatOverlay));
        if (payload?.chatHideCommands != null) chatHideCommands = !!payload.chatHideCommands;

        ensureIrc();
        voteReset();
        postState();
        break;
      }

      case "VOTE_START": {
        voteTriggeredForSegment = true;
        const w = clamp(parseInt(payload?.windowSec ?? voteWindowSec, 10) || voteWindowSec, 5, 180);
        const lead = clamp(parseInt(payload?.leadSec ?? voteLeadSec, 10) || voteLeadSec, 0, 30);
        voteStartSequence(w, lead);
        postState();
        break;
      }

      default: break;
    }
  }

  if (bc) {
    bc.onmessage = (ev) => {
      const msg = ev?.data;
      if (!msg || msg.type !== "cmd") return;
      if ((msg.ts | 0) <= (lastCmdTs | 0)) return;
      if (!cmdKeyOk(msg)) return;
      lastCmdTs = msg.ts | 0;
      applyCommand(msg.cmd, msg.payload || {});
    };
  }

  window.addEventListener("storage", (e) => {
    if (!e || e.key !== CMD_KEY || !e.newValue) return;
    try {
      const msg = JSON.parse(e.newValue);
      if (!msg || msg.type !== "cmd") return;
      if ((msg.ts | 0) <= (lastCmdTs | 0)) return;
      if (!cmdKeyOk(msg)) return;
      lastCmdTs = msg.ts | 0;
      applyCommand(msg.cmd, msg.payload || {});
    } catch (_) {}
  });

  // Persist player state
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
        segmentSec: segmentSeconds | 0,
        fit: currentFit,
        autoskip: autoskip ? 1 : 0,
        adfree: modeAdfree ? 1 : 0,

        bgmEnabled: bgmEnabled ? 1 : 0,
        bgmVol,
        bgmIdx,
        bgmPlaying: bgmPlaying ? 1 : 0,

        voteEnabled: voteEnabled ? 1 : 0,
        voteOverlay: voteOverlay ? 1 : 0,
        twitchChannel,
        voteWindowSec,
        voteAtSec,
        voteLeadSec,
        voteUiSec,
        stayMins,
        voteCmd: P.voteCmd,

        chatEnabled: chatEnabled ? 1 : 0,
        chatHideCommands: chatHideCommands ? 1 : 0,
        chatMax,
        chatTtlSec,

        ytCookies: P.ytCookies ? 1 : 0,

        ts: Date.now(),
        v: 2
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
    } catch (_) {}
  }

  function tick() {
    setCountdownUI();

    const rem = remainingSeconds();

    // fin de segmento
    if (playing && rem <= 0) {
      if (voteSessionActive && votePhase === "vote") {
        voteFinish();
        postState();
        return;
      }
      voteReset();
      nextCam("timer");
      postState();
      return;
    }

    // VOTO AUTO
    if (voteEnabled && twitchChannel) {
      ensureIrc();

      if (playing && !voteSessionActive && !voteTriggeredForSegment) {
        const startAt = clamp(voteAtSec | 0, 5, 600);
        const leadMax = clamp(voteLeadSec | 0, 0, 30);

        if (rem > 0 && rem <= startAt) {
          voteTriggeredForSegment = true;
          voteStartSequence(voteWindowSec, 0);
        } else {
          const triggerLead = Math.min((startAt + leadMax) | 0, segmentSeconds | 0);
          if (rem > 0 && rem <= triggerLead) {
            voteTriggeredForSegment = true;
            const dynLead = clamp((rem - startAt) | 0, 0, leadMax);
            voteStartSequence(voteWindowSec, dynLead);
          }
        }
      }

      if (voteSessionActive) {
        const now = Date.now();
        if (votePhase === "lead") {
          renderVote();
          if (now >= leadEndsAt) {
            votePhase = "vote";
            renderVote();
          }
        } else if (votePhase === "vote") {
          renderVote();
          if (now >= voteEndsAt) voteFinish();
        } else {
          voteReset();
        }
      } else {
        renderVote();
      }
    } else {
      voteReset();
    }

    postState();
  }

  function boot() {
    if (!allCams.length) {
      showFallback({ originUrl: "#" }, "No hay cámaras definidas (revisa cams.js).");
      return;
    }

    setFit(P.fit);

    // HUD prefs
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

      // BGM restore
      bgmEnabled = (st.bgmEnabled ?? 0) !== 0 || bgmEnabled;
      bgmVol = clamp(+st.bgmVol || bgmVol, 0, 1);
      bgmIdx = (st.bgmIdx | 0) || 0;
      bgmPlaying = (st.bgmPlaying ?? 0) !== 0;

      // Vote restore
      voteEnabled = (st.voteEnabled ?? 0) !== 0 || voteEnabled;
      voteOverlay = (st.voteOverlay ?? 1) !== 0;
      twitchChannel = st.twitchChannel || twitchChannel;
      voteWindowSec = clamp((st.voteWindowSec | 0) || voteWindowSec, 5, 180);
      voteAtSec = clamp((st.voteAtSec | 0) || voteAtSec, 5, 600);
      voteLeadSec = clamp((st.voteLeadSec | 0) || voteLeadSec, 0, 30);
      voteUiSec = clamp((st.voteUiSec | 0) || (voteLeadSec + voteWindowSec), 0, 300);
      stayMins = clamp((st.stayMins | 0) || stayMins, 1, 120);
      if (st.voteCmd) parseVoteCmds(st.voteCmd);

      // Chat restore (P.chat explícito manda)
      if (P.chatExplicit) chatEnabled = !!P.chat;
      else chatEnabled = (st.chatEnabled != null) ? ((st.chatEnabled | 0) !== 0) : chatEnabled;

      if (P.chatHideExplicit) chatHideCommands = !!P.chatHideCommands;
      else chatHideCommands = (st.chatHideCommands != null) ? ((st.chatHideCommands | 0) !== 0) : chatHideCommands;

      if (P.chatMaxExplicit) chatMax = P.chatMax | 0;
      else chatMax = clamp((st.chatMax | 0) || chatMax, 3, 12);

      if (P.chatTtlExplicit) chatTtlSec = P.chatTtl | 0;
      else chatTtlSec = clamp((st.chatTtlSec | 0) || chatTtlSec, 5, 30);

      // ytCookies restore
      if (typeof st.ytCookies !== "undefined") {
        try { P.ytCookies = (st.ytCookies | 0) !== 0; } catch (_) {}
      }

      // restore segment + remaining
      const totalSeg = clamp((st.segmentSec | 0) || roundSeconds, 1, 120 * 60);
      const rem = clamp((st.remaining | 0) || totalSeg, 0, totalSeg);

      startRoundWithRemaining(totalSeg, rem);
      if (!playing) { pausedRemaining = rem; roundEndsAt = 0; setCountdownUI(); }
    } else {
      idx = 0;
      playing = true;
      setRoundMins(P.mins);
      startRound(roundSeconds);

      // init
      bgmEnabled = !!P.bgm;
      bgmVol = P.bgmVol;

      voteEnabled = !!P.vote;
      voteOverlay = !!P.voteOverlay;
      twitchChannel = P.twitch || "";
      voteWindowSec = P.voteWindow;
      voteAtSec = P.voteAt;
      voteLeadSec = P.voteLead;
      voteUiSec = (P.voteUi > 0) ? P.voteUi : (voteLeadSec + voteWindowSec);
      stayMins = P.stayMins;

      chatEnabled = !!P.chat;
      chatHideCommands = !!P.chatHideCommands;
      chatMax = P.chatMax | 0;
      chatTtlSec = P.chatTtl | 0;

      parseVoteCmds(P.voteCmd);
    }

    // chat UI + activar (si enabled)
    ensureChatUI();
    chatSetEnabled(chatEnabled);

    // BGM init
    try { if (bgmEl) bgmEl.volume = bgmVol; } catch (_) {}
    if (bgmList.length) bgmLoadTrack(bgmIdx);
    if (bgmEnabled && bgmPlaying) bgmPlay();
    if (bgmEnabled && !bgmPlaying) postState();

    // IRC init
    ensureIrc();

    playCam(cams[idx]);

    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(tick, 250);

    setInterval(() => { savePlayerState(); postState(); }, 2000);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { savePlayerState(); postState(); }
    });

    // Teclas
    window.addEventListener("keydown", (e) => {
      const k = (e.key || "").toLowerCase();
      if (k === " ") { e.preventDefault(); togglePlay(); }
      else if (k === "n") nextCam("key");
      else if (k === "p") prevCam();
      else if (k === "h") setHudHidden(!hud.classList.contains("hidden"));
      else if (k === "i") setHudCollapsed(!hud.classList.contains("hud--collapsed"));
      else if (k === "c") chatSetEnabled(!chatEnabled);
    });

    postState({ ready: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
