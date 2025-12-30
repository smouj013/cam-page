/* player.js — RLC Player v2.2.0 (VIDEO ONLY + KEY NAMESPACE + HARD AUTOSKIP + COOLDOWN)
   ✅ Compatible con tu BUS/CMD/STATE actuales
   ✅ Soporta ?key=... (namespacing) SIN romper legacy (escucha y escribe en ambos)
   ✅ VIDEO ONLY: ignora cams "image" aunque existan en la lista
   ✅ Autoskip endurecido (HLS fatal/error/timeout + fallback)
   ✅ Cooldown de cams fallidas (evita bucles) + persistencia
   ✅ Pause real (congela contador)
   ✅ Soporta ?ytCookies=1 (usa youtube.com) o por defecto nocookie
*/
(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  // Guard anti doble carga
  const LOAD_GUARD = "__RLC_PLAYER_LOADED_V220_VIDEOONLY";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  // Helpers
  const qs = (s) => document.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtMMSS = (sec) => {
    sec = Math.max(0, sec | 0);
    const m = (sec / 60) | 0;
    const s = sec - m * 60;
    return `${pad2(m)}:${pad2(s)}`;
  };
  const safeStr = (v) => (typeof v === "string") ? v.trim() : "";

  function parseParams() {
    const u = new URL(location.href);
    const mins = clamp(parseInt(u.searchParams.get("mins") || "5", 10) || 5, 1, 120);
    const fit = (u.searchParams.get("fit") || "cover").toLowerCase();
    const hud = (u.searchParams.get("hud") ?? "1") !== "0";
    const seed = u.searchParams.get("seed") || "";
    const autoskip = (u.searchParams.get("autoskip") ?? "1") !== "0";
    const mode = (u.searchParams.get("mode") || "").toLowerCase(); // adfree
    const debug = (u.searchParams.get("debug") === "1");

    // ✅ compat: key para namespacing (si no existe, legacy)
    const key = u.searchParams.get("key") || "";

    // ✅ ytCookies=1 -> usa youtube.com (cookies); default -> youtube-nocookie
    const ytCookies = (u.searchParams.get("ytCookies") ?? "0") === "1";

    // ✅ cooldown para streams fallidos
    const cooldownMins = clamp(parseInt(u.searchParams.get("cooldownMins") || "10", 10) || 10, 1, 120);

    // ✅ timeout de arranque HLS (segundos) para autoskip
    const hlsTimeout = clamp(parseInt(u.searchParams.get("hlsTimeout") || "12", 10) || 12, 5, 60);

    // ✅ timeout suave de carga iframe (segundos) (por si queda colgado)
    const ytTimeout = clamp(parseInt(u.searchParams.get("ytTimeout") || "15", 10) || 15, 8, 60);

    return { mins, fit, hud, seed, autoskip, mode, debug, key, ytCookies, cooldownMins, hlsTimeout, ytTimeout };
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

  // Params
  const P = parseParams();
  const rnd = makeRng(P.seed);

  // ─────────────────────────────────────────────────────────────
  // BUS + Keys (namespaced by ?key=..., pero compatible con legacy)
  // ─────────────────────────────────────────────────────────────
  const BUS_BASE = "rlc_bus_v1";
  const CMD_KEY_BASE = "rlc_cmd_v1";
  const STATE_KEY_BASE = "rlc_state_v1";

  const KEY = safeStr(P.key);
  const BUS = KEY ? `${BUS_BASE}:${KEY}` : BUS_BASE;
  const CMD_KEY = KEY ? `${CMD_KEY_BASE}:${KEY}` : CMD_KEY_BASE;
  const STATE_KEY = KEY ? `${STATE_KEY_BASE}:${KEY}` : STATE_KEY_BASE;

  const BUS_LEGACY = BUS_BASE;
  const CMD_KEY_LEGACY = CMD_KEY_BASE;
  const STATE_KEY_LEGACY = STATE_KEY_BASE;

  // State storage
  const STORAGE_KEY = KEY ? `rlc_player_state_v2:${KEY}` : "rlc_player_state_v2";
  const STORAGE_KEY_LEGACY = "rlc_player_state_v2";

  const HUD_COLLAPSE_KEY = KEY ? `rlc_hud_collapsed_v2:${KEY}` : "rlc_hud_collapsed_v2";
  const HUD_HIDE_KEY = KEY ? `rlc_hud_hidden_v2:${KEY}` : "rlc_hud_hidden_v2";

  const BAN_KEY = KEY ? `rlc_ban_ids_v1:${KEY}` : "rlc_ban_ids_v1";
  const BAN_KEY_LEGACY = "rlc_ban_ids_v1";

  const FAIL_KEY = KEY ? `rlc_fail_ids_v1:${KEY}` : "rlc_fail_ids_v1";
  const FAIL_KEY_LEGACY = "rlc_fail_ids_v1";

  // BroadcastChannels (si hay KEY, abrimos ambos para no romper control antiguo)
  const bcMain = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS) : null;
  const bcLegacy = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_LEGACY) : null;

  // DOM
  const frame = qs("#frame");
  const video = qs("#video");
  const img = qs("#img"); // existe en tu HTML, pero VIDEO ONLY: no se usa
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

  // ─────────────────────────────────────────────────────────────
  // Cams + filtros (VIDEO ONLY)
  // ─────────────────────────────────────────────────────────────
  let allCams = Array.isArray(g.CAM_LIST) ? g.CAM_LIST.slice() : [];

  // Merge sets desde localStorage (keyed + legacy)
  function loadSet(keys) {
    const out = new Set();
    for (const k of keys) {
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) for (const x of arr) out.add(String(x));
      } catch (_) {}
    }
    return out;
  }

  let banned = loadSet([BAN_KEY, BAN_KEY_LEGACY]);

  function saveSet(keys, set) {
    const arr = Array.from(set);
    for (const k of keys) {
      try { localStorage.setItem(k, JSON.stringify(arr)); } catch (_) {}
    }
  }

  function loadFailMap(keys) {
    const m = Object.create(null);
    for (const k of keys) {
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== "object") continue;
        for (const id of Object.keys(obj)) {
          const until = obj[id] | 0;
          if (until > (m[id] | 0)) m[id] = until;
        }
      } catch (_) {}
    }
    return m;
  }

  let failUntil = loadFailMap([FAIL_KEY, FAIL_KEY_LEGACY]);

  function saveFailMap(keys, map) {
    for (const k of keys) {
      try { localStorage.setItem(k, JSON.stringify(map)); } catch (_) {}
    }
  }

  function nowMs() { return Date.now(); }

  function isCoolingDown(id) {
    const until = failUntil[id] | 0;
    return until > nowMs();
  }

  function markFail(cam, reason) {
    const id = cam && cam.id ? String(cam.id) : "";
    if (!id) return;
    const until = nowMs() + (P.cooldownMins * 60 * 1000);
    failUntil[id] = until;
    saveFailMap([FAIL_KEY, FAIL_KEY_LEGACY], failUntil);
    if (P.debug) console.log("[player] cooldown:", id, reason, "until", new Date(until).toISOString());
    postState({ fail: { id, reason, cooldownMins: P.cooldownMins } });
  }

  function normalizeCam(cam) {
    if (!cam || typeof cam !== "object") return null;
    if (cam.disabled === true) return null;

    const kind = safeStr(cam.kind).toLowerCase();
    if (kind === "image") return null; // VIDEO ONLY

    if (kind === "youtube") {
      const youtubeId = safeStr(cam.youtubeId);
      if (!youtubeId) return null;
      return {
        id: safeStr(cam.id) || "",
        title: safeStr(cam.title) || "Live Cam",
        place: safeStr(cam.place) || "",
        source: safeStr(cam.source) || "",
        kind: "youtube",
        youtubeId,
        originUrl: safeStr(cam.originUrl) || `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}`,
        maxSeconds: (typeof cam.maxSeconds === "number" && cam.maxSeconds > 0) ? (cam.maxSeconds | 0) : 0,
        tags: Array.isArray(cam.tags) ? cam.tags.slice(0, 12) : undefined
      };
    }

    if (kind === "hls") {
      const url = safeStr(cam.url);
      if (!url) return null;
      return {
        id: safeStr(cam.id) || "",
        title: safeStr(cam.title) || "Live Cam",
        place: safeStr(cam.place) || "",
        source: safeStr(cam.source) || "",
        kind: "hls",
        url,
        originUrl: safeStr(cam.originUrl) || url,
        maxSeconds: (typeof cam.maxSeconds === "number" && cam.maxSeconds > 0) ? (cam.maxSeconds | 0) : 0,
        tags: Array.isArray(cam.tags) ? cam.tags.slice(0, 12) : undefined
      };
    }

    // Desconocido -> fuera
    return null;
  }

  function getBaseValidList() {
    const out = [];
    for (const c of allCams) {
      const n = normalizeCam(c);
      if (n && n.id) out.push(n);
    }
    return out;
  }

  let baseValid = getBaseValidList();

  let modeAdfree = (P.mode === "adfree"); // en tu sistema: adfree => preferir HLS
  let autoskip = !!P.autoskip;

  let cams = [];
  function applyFilters() {
    // 1) aplica banned
    let list = baseValid.filter(c => c && c.id && !banned.has(c.id));

    // 2) adfree => intenta HLS-only; si no hay, no te deja sin nada (fallback)
    if (modeAdfree) {
      const hlsOnly = list.filter(c => c.kind === "hls");
      if (hlsOnly.length) list = hlsOnly;
    }

    cams = list;

    // fallback final si te quedas sin nada
    if (!cams.length) cams = baseValid.slice();
  }

  applyFilters();

  // ─────────────────────────────────────────────────────────────
  // Player state
  // ─────────────────────────────────────────────────────────────
  let idx = 0;
  let playing = true;

  let roundSeconds = P.mins * 60;
  let roundEndsAt = 0;     // solo cuando playing = true
  let pausedRemaining = 0; // para pause real

  let tickTimer = null;
  let hls = null;
  let switching = false;

  // watchdog timers
  let hlsStartWatchdog = null;
  let ytWatchdog = null;

  // UI helpers
  function showOnly(kind) {
    if (frame) frame.classList.add("hidden");
    if (video) video.classList.add("hidden");
    if (img) img.classList.add("hidden");
    if (fallback) fallback.classList.add("hidden");

    if (kind === "youtube" && frame) frame.classList.remove("hidden");
    else if (kind === "hls" && video) video.classList.remove("hidden");
    else if (kind === "fallback" && fallback) fallback.classList.remove("hidden");
    else if (fallback) fallback.classList.remove("hidden");
  }

  let currentFit = "cover";
  function setFit(mode) {
    currentFit = (mode === "contain") ? "contain" : "cover";
    // (iframe no usa object-fit, pero no rompe; video sí)
    try { if (frame) frame.style.objectFit = currentFit; } catch (_) {}
    try { if (video) video.style.objectFit = currentFit; } catch (_) {}
    try { if (img) img.style.objectFit = currentFit; } catch (_) {}
  }

  function clearWatchdogs() {
    if (hlsStartWatchdog) { clearTimeout(hlsStartWatchdog); hlsStartWatchdog = null; }
    if (ytWatchdog) { clearTimeout(ytWatchdog); ytWatchdog = null; }
  }

  function clearMedia() {
    clearWatchdogs();

    try { if (hls) { hls.destroy(); hls = null; } } catch (_) {}

    try { if (frame) frame.src = "about:blank"; } catch (_) {}
    try {
      if (video) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
    } catch (_) {}

    try { if (img) img.removeAttribute("src"); } catch (_) {}

    try { if (video) video.onerror = null; } catch (_) {}
  }

  function setHud(cam) {
    if (hudTitle) hudTitle.textContent = cam.title || "Live Cam";
    if (hudPlace) hudPlace.textContent = cam.place || "—";
    if (hudSource) hudSource.textContent = cam.source || "—";
    if (hudOrigin) {
      hudOrigin.href = cam.originUrl || "#";
      hudOrigin.style.pointerEvents = cam.originUrl ? "auto" : "none";
      hudOrigin.style.opacity = cam.originUrl ? "1" : ".6";
    }
    if (hudIndex) hudIndex.textContent = `${idx + 1}/${cams.length}`;
  }

  function remainingSeconds() {
    if (!playing) return Math.max(1, pausedRemaining | 0) || roundSeconds;

    if (!roundEndsAt) return roundSeconds;
    const ms = roundEndsAt - nowMs();
    return Math.max(0, Math.ceil(ms / 1000));
  }

  function setCountdownUI() {
    const rem = remainingSeconds();
    if (hudCountdown) hudCountdown.textContent = fmtMMSS(rem);
    if (progressBar) {
      const pct = 100 * (1 - (rem / Math.max(1, roundSeconds)));
      progressBar.style.width = `${clamp(pct, 0, 100).toFixed(2)}%`;
    }
  }

  function startRound(seconds) {
    const s = clamp(seconds | 0, 1, 120 * 60);
    pausedRemaining = 0;
    roundEndsAt = nowMs() + s * 1000;
    setCountdownUI();
  }

  function freezeRound() {
    pausedRemaining = remainingSeconds();
    roundEndsAt = 0;
    setCountdownUI();
  }

  function effectiveSeconds(cam) {
    if (cam && typeof cam.maxSeconds === "number" && cam.maxSeconds > 0) return cam.maxSeconds | 0;
    return roundSeconds;
  }

  function showFallback(cam, msg) {
    clearMedia();
    showOnly("fallback");
    const t = fallback ? fallback.querySelector(".fallbackText") : null;
    if (t) t.textContent = msg || "Saltando…";
    if (fallbackLink) {
      fallbackLink.href = (cam && cam.originUrl) ? cam.originUrl : "#";
      fallbackLink.style.pointerEvents = (cam && cam.originUrl) ? "auto" : "none";
      fallbackLink.style.opacity = (cam && cam.originUrl) ? "1" : ".6";
    }
  }

  async function safePlayVideo() {
    try {
      if (!video) return;
      const p = video.play();
      if (p && typeof p.then === "function") await p;
    } catch (_) {}
  }

  // ─────────────────────────────────────────────────────────────
  // Comms + STATE
  // ─────────────────────────────────────────────────────────────
  let lastCmdTs = 0;

  function writeStorage(key, val) { try { localStorage.setItem(key, val); } catch (_) {} }

  function postState(extra = {}) {
    const cam = cams[idx] || {};
    const state = {
      type: "state",
      ts: nowMs(),
      key: KEY || undefined,
      version: "2.2.0",
      videoOnly: true,
      playing,
      idx,
      total: cams.length,
      mins: Math.max(1, (roundSeconds / 60) | 0),
      fit: currentFit,
      hudHidden: !!(hud && hud.classList.contains("hidden")),
      hudCollapsed: !!(hud && hud.classList.contains("hud--collapsed")),
      autoskip,
      adfree: modeAdfree,
      cam: {
        id: cam.id, title: cam.title, place: cam.place, source: cam.source,
        originUrl: cam.originUrl, kind: cam.kind
      },
      remaining: remainingSeconds(),
      ...extra
    };

    const raw = JSON.stringify(state);

    // ✅ escribe namespaced + legacy (compat)
    writeStorage(STATE_KEY, raw);
    writeStorage(STATE_KEY_LEGACY, raw);

    try { if (bcMain) bcMain.postMessage(state); } catch (_) {}
    try { if (bcLegacy) bcLegacy.postMessage(state); } catch (_) {}
  }

  // ─────────────────────────────────────────────────────────────
  // Playback
  // ─────────────────────────────────────────────────────────────
  function playCam(cam) {
    if (!cam) {
      showFallback({ originUrl: "#" }, "Cam inválida. Saltando…");
      if (autoskip) setTimeout(() => nextCam("invalid_cam"), 700);
      return;
    }

    clearMedia();
    setHud(cam);
    startRound(effectiveSeconds(cam));

    if (cam.kind === "youtube") {
      showOnly("youtube");

      const base = P.ytCookies ? "https://www.youtube.com/embed/" : "https://www.youtube-nocookie.com/embed/";
      const src =
        base + encodeURIComponent(cam.youtubeId) +
        `?autoplay=1&mute=1&controls=0&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&fs=0&disablekb=1`;

      // watchdog suave: si el iframe no llega a cargar, saltamos y metemos cooldown
      let loaded = false;
      if (frame) {
        frame.onload = () => { loaded = true; };
        try { frame.src = src; } catch (_) {}
      }

      if (autoskip) {
        ytWatchdog = setTimeout(() => {
          if (!loaded) {
            showFallback(cam, "YouTube no carga. Saltando…");
            markFail(cam, "yt_timeout");
            setTimeout(() => nextCam("yt_timeout"), 700);
          }
        }, P.ytTimeout * 1000);
      }

      postState();
      return;
    }

    if (cam.kind === "hls") {
      showOnly("hls");
      const url = cam.url;
      const Hls = g.Hls;

      let started = false;

      const clearStartWatch = () => {
        started = true;
        if (hlsStartWatchdog) { clearTimeout(hlsStartWatchdog); hlsStartWatchdog = null; }
      };

      // watchdog: si no arranca en X segundos -> cooldown + skip
      if (autoskip) {
        hlsStartWatchdog = setTimeout(() => {
          if (!started) {
            showFallback(cam, "HLS no arranca (timeout). Saltando…");
            markFail(cam, "hls_start_timeout");
            setTimeout(() => nextCam("hls_start_timeout"), 800);
          }
        }, P.hlsTimeout * 1000);
      }

      if (video && video.canPlayType("application/vnd.apple.mpegurl")) {
        // Safari / iOS
        try { video.src = url; } catch (_) {}
        video.addEventListener("canplay", () => { clearStartWatch(); safePlayVideo(); }, { once: true });
        video.addEventListener("playing", () => { clearStartWatch(); }, { once: true });
        safePlayVideo();
      } else if (video && Hls && Hls.isSupported()) {
        hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30 });
        try {
          hls.loadSource(url);
          hls.attachMedia(video);
        } catch (_) {}

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          clearStartWatch();
          safePlayVideo();
        });

        hls.on(Hls.Events.ERROR, (_ev, data) => {
          if (!autoskip) return;
          if (data && data.fatal) {
            showFallback(cam, "Stream HLS no disponible. Saltando…");
            markFail(cam, "hls_fatal");
            setTimeout(() => nextCam("hls_fatal"), 900);
          }
        });

        video.addEventListener("canplay", () => { clearStartWatch(); safePlayVideo(); }, { once: true });
        video.addEventListener("playing", () => { clearStartWatch(); }, { once: true });
      } else {
        showFallback(cam, "HLS no soportado aquí.");
        if (autoskip) {
          markFail(cam, "hls_unsupported");
          setTimeout(() => nextCam("hls_unsupported"), 900);
        }
      }

      if (autoskip && video) {
        video.onerror = () => {
          video.onerror = null;
          showFallback(cam, "Stream no disponible (error). Saltando…");
          markFail(cam, "vid_error");
          setTimeout(() => nextCam("vid_error"), 900);
        };
      }

      postState();
      return;
    }

    // VIDEO ONLY: cualquier otro tipo -> skip
    showFallback(cam, "Tipo no soportado (video-only).");
    postState({ error: "unsupported_kind" });
    if (autoskip) setTimeout(() => nextCam("unsupported_kind"), 900);
  }

  function pickNextIndex(dir, reason) {
    if (!cams.length) return -1;

    const start = idx;
    // 1) intenta saltar cams en cooldown (solo si autoskip o si viene de error)
    const useCooldownSkip = !!autoskip || (reason && String(reason).includes("error")) || (reason && String(reason).includes("fatal")) || (reason && String(reason).includes("timeout"));

    if (useCooldownSkip) {
      for (let step = 1; step <= cams.length; step++) {
        const n = (start + dir * step + cams.length) % cams.length;
        const c = cams[n];
        if (!c || !c.id) continue;
        if (isCoolingDown(c.id)) continue;
        return n;
      }
    }

    // 2) si todas están en cooldown o no aplicamos skip -> normal
    return (start + dir + cams.length) % cams.length;
  }

  function nextCam(reason) {
    if (!cams.length || switching) return;
    switching = true;

    const n = pickNextIndex(+1, reason);
    if (n < 0) { switching = false; return; }

    idx = n;
    if (P.debug) console.log("[player] next:", reason, idx, cams[idx]);
    playCam(cams[idx]);

    setTimeout(() => { switching = false; }, 250);
  }

  function prevCam() {
    if (!cams.length || switching) return;
    switching = true;

    const n = pickNextIndex(-1, "prev");
    if (n < 0) { switching = false; return; }

    idx = n;
    playCam(cams[idx]);

    setTimeout(() => { switching = false; }, 250);
  }

  function setPlaying(v) {
    const want = !!v;
    if (want === playing) return;

    playing = want;

    if (playing) {
      // reanuda desde pausedRemaining (pause real)
      const rem = Math.max(1, pausedRemaining | 0) || roundSeconds;
      startRound(rem);
    } else {
      freezeRound();
    }
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
    if (hud) hud.classList.toggle("hud--collapsed", collapsed);
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
    if (hud) hud.classList.toggle("hidden", hidden);
    try { localStorage.setItem(HUD_HIDE_KEY, hidden ? "1" : "0"); } catch (_) {}
    postState();
  }

  function setRoundMins(mins) {
    const m = clamp(parseInt(mins, 10) || 5, 1, 120);
    roundSeconds = m * 60;

    // mantiene remaining si es menor
    const rem = remainingSeconds();
    if (playing) startRound(Math.min(rem, roundSeconds));
    else pausedRemaining = clamp(Math.min(rem, roundSeconds), 1, 120 * 60);

    postState();
  }

  function goToId(id) {
    const s = safeStr(id);
    if (!s) return;
    const n = cams.findIndex(c => c && c.id === s);
    if (n >= 0) {
      idx = n;
      playCam(cams[idx]);
    }
  }

  function banId(id) {
    const s = safeStr(id);
    if (!s) return;
    banned.add(s);
    saveSet([BAN_KEY, BAN_KEY_LEGACY], banned);

    applyFilters();
    if (!cams.length) return;
    idx = idx % cams.length;
    playCam(cams[idx]);
  }

  function resetState() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    try { localStorage.removeItem(STORAGE_KEY_LEGACY); } catch (_) {}

    idx = 0;
    playing = true;
    pausedRemaining = 0;
    modeAdfree = false;
    autoskip = true;

    applyFilters();

    setFit("cover");
    setRoundMins(5);
    setHudHidden(false);
    setHudCollapsed(true);

    playCam(cams[idx]);
    postState({ reset: true });
  }

  // ─────────────────────────────────────────────────────────────
  // Commands
  // ─────────────────────────────────────────────────────────────
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

      // compat: SET_HUD {on:true/false} => mostrar/ocultar
      case "SET_HUD":
        if (payload && typeof payload.on === "boolean") setHudHidden(!payload.on);
        else setHudHidden(false);
        break;

      // compat: SET_HUD_DETAILS {collapsed:true/false}
      case "SET_HUD_DETAILS":
        if (payload && typeof payload.collapsed === "boolean") setHudCollapsed(payload.collapsed);
        else setHudCollapsed(true);
        break;

      case "SET_AUTOSKIP": autoskip = !!payload?.on; postState(); break;

      case "SET_ADFREE":
        modeAdfree = !!payload?.on;
        applyFilters();
        if (!cams.length) return;
        idx = idx % cams.length;
        playCam(cams[idx]);
        postState();
        break;

      case "GOTO_ID": goToId(payload?.id); break;
      case "BAN_ID": banId(payload?.id); break;
      case "RESET": resetState(); break;
      default: break;
    }
  }

  function onCmdMessage(msg) {
    if (!msg || msg.type !== "cmd") return;
    if ((msg.ts | 0) <= (lastCmdTs | 0)) return;
    lastCmdTs = msg.ts | 0;
    applyCommand(msg.cmd, msg.payload || {});
  }

  if (bcMain) bcMain.onmessage = (ev) => onCmdMessage(ev?.data);
  if (bcLegacy) bcLegacy.onmessage = (ev) => onCmdMessage(ev?.data);

  // Storage events (escucha CMD_KEY y CMD_KEY_LEGACY)
  window.addEventListener("storage", (e) => {
    if (!e || !e.key || !e.newValue) return;
    if (e.key !== CMD_KEY && e.key !== CMD_KEY_LEGACY) return;
    try { onCmdMessage(JSON.parse(e.newValue)); } catch (_) {}
  });

  // Persist player state (idx, remaining, playing)
  function loadPlayerState() {
    const keys = [STORAGE_KEY, STORAGE_KEY_LEGACY];
    for (const k of keys) {
      try {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const st = JSON.parse(raw);
        if (st && typeof st === "object") return st;
      } catch (_) {}
    }
    return null;
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
        ts: nowMs(),
        v: 2
      };
      const raw = JSON.stringify(st);
      writeStorage(STORAGE_KEY, raw);
      writeStorage(STORAGE_KEY_LEGACY, raw);
    } catch (_) {}
  }

  function tick() {
    if (!playing) return;
    setCountdownUI();
    if (remainingSeconds() <= 0) nextCam("timer");
  }

  // ─────────────────────────────────────────────────────────────
  // Boot
  // ─────────────────────────────────────────────────────────────
  function boot() {
    // Recalcula baseValid por si CAM_LIST se inyecta tarde
    allCams = Array.isArray(g.CAM_LIST) ? g.CAM_LIST.slice() : allCams;
    baseValid = getBaseValidList();
    applyFilters();

    if (!baseValid.length) {
      showFallback({ originUrl: "#" }, "No hay cámaras de video definidas (revisa cams.js / CAM_LIST).");
      postState({ ready: false, error: "no_cams" });
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
        const isCollapsed = !!(hud && hud.classList.contains("hud--collapsed"));
        setHudCollapsed(!isCollapsed);
      });
    }

    shuffle(cams, rnd);

    const st = loadPlayerState();
    if (st && typeof st.idx === "number") {
      autoskip = (st.autoskip ?? 1) !== 0;
      modeAdfree = !!st.adfree;

      applyFilters();

      const safeIdx = clamp(st.idx | 0, 0, Math.max(0, cams.length - 1));
      idx = safeIdx;

      setFit(st.fit || P.fit);
      setRoundMins(st.mins || P.mins);

      playing = !!st.playing;
      const rem = clamp((st.remaining | 0) || roundSeconds, 1, 120 * 60);

      if (playing) startRound(rem);
      else { playing = false; pausedRemaining = rem; roundEndsAt = 0; setCountdownUI(); }
    } else {
      idx = 0;
      playing = true;
      setRoundMins(P.mins);
      startRound(roundSeconds);
    }

    // Evita empezar en cam enfriada (si es posible)
    if (cams.length && isCoolingDown(cams[idx]?.id || "")) {
      idx = pickNextIndex(+1, "boot_cooldown");
    }

    playCam(cams[idx]);

    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(tick, 250);

    setInterval(() => { savePlayerState(); postState(); }, 2000);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { savePlayerState(); postState({ hidden: true }); }
    });

    postState({ ready: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
