(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;
  const LOAD_GUARD = "__RLC_PLAYER_LOADED_V200_PRO";
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
      debug: (u.searchParams.get("debug") === "1"),

      // seguridad por key (si no hay, acepta todo)
      key: u.searchParams.get("key") || "",

      // BGM init
      bgm: (u.searchParams.get("bgm") ?? "0") === "1",
      bgmVol: clamp(parseFloat(u.searchParams.get("bgmVol") || "0.25") || 0.25, 0, 1),

      // Vote init
      vote: (u.searchParams.get("vote") ?? "0") === "1",
      twitch: (u.searchParams.get("twitch") || "").trim().replace(/^@/,""),
      voteWindow: clamp(parseInt(u.searchParams.get("voteWindow") || "60", 10) || 20, 5, 60),
      voteAt: clamp(parseInt(u.searchParams.get("voteAt") || "61", 10) || 25, 5, 120),
      voteCmd: (u.searchParams.get("voteCmd") || "!next,!cam|!stay,!keep").trim(),
      voteOverlay: (u.searchParams.get("voteOverlay") ?? "1") !== "0"
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

  let modeAdfree = (P.mode === "adfree");
  let autoskip = !!P.autoskip;

  let cams = [];
  function applyFilters() {
    let list = allCams.filter(c => c && !banned.has(c.id));
    if (modeAdfree) list = list.filter(c => c.kind !== "youtube");
    cams = list.length ? list : allCams.slice();
  }
  applyFilters();

  // Playback state
  let idx = 0;
  let playing = true;
  let roundSeconds = P.mins * 60;
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
    frame.style.objectFit = currentFit;
    video.style.objectFit = currentFit;
    img.style.objectFit = currentFit;
  }

  // HUD collapse/hide
  function setHudCollapsed(v) {
    const collapsed = !!v;
    hud.classList.toggle("hud--collapsed", collapsed);
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
    hud.classList.toggle("hidden", hidden);
    try { localStorage.setItem(HUD_HIDE_KEY, hidden ? "1" : "0"); } catch (_) {}
    postState();
  }

  // Timer helpers (con pausa REAL)
  function remainingSeconds() {
    if (!playing) return Math.max(0, pausedRemaining | 0);
    if (!roundEndsAt) return Math.max(0, roundSeconds | 0);
    const ms = roundEndsAt - Date.now();
    return Math.max(0, Math.ceil(ms / 1000));
  }

  function setCountdownUI() {
    const rem = remainingSeconds();
    if (hudCountdown) hudCountdown.textContent = fmtMMSS(rem);
    const denom = Math.max(1, (playing ? (roundSeconds | 0) : Math.max(1, pausedRemaining | 0)));
    const pct = 100 * (1 - (rem / denom));
    if (progressBar) progressBar.style.width = `${clamp(pct, 0, 100).toFixed(2)}%`;
  }

  function startRound(seconds) {
    const s = clamp(seconds | 0, 1, 120 * 60);
    if (playing) {
      roundEndsAt = Date.now() + s * 1000;
      pausedRemaining = 0;
    } else {
      roundEndsAt = 0;
      pausedRemaining = s;
    }
    setCountdownUI();
  }

  function setPlaying(v) {
    const want = !!v;
    if (want === playing) return;

    if (!want) {
      // pause: congelar
      pausedRemaining = remainingSeconds();
      playing = false;
      roundEndsAt = 0;
    } else {
      // resume: reanudar con lo congelado
      playing = true;
      const rem = Math.max(1, pausedRemaining | 0);
      pausedRemaining = 0;
      roundEndsAt = Date.now() + rem * 1000;
    }
    setCountdownUI();
    postState();
  }

  function togglePlay() { setPlaying(!playing); }

  // UI helpers
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
    hudTitle.textContent = cam?.title || "Live Cam";
    hudPlace.textContent = cam?.place || "—";
    hudSource.textContent = cam?.source || "—";
    hudOrigin.href = cam?.originUrl || "#";
    hudOrigin.style.pointerEvents = cam?.originUrl ? "auto" : "none";
    hudOrigin.style.opacity = cam?.originUrl ? "1" : ".6";
    if (hudIndex) hudIndex.textContent = `${idx + 1}/${cams.length}`;
  }

  function showFallback(cam, msg) {
    clearMedia();
    showOnly("fallback");
    const t = fallback.querySelector(".fallbackText");
    if (t) t.textContent = msg || "Saltando…";
    fallbackLink.href = cam?.originUrl || "#";
    fallbackLink.style.pointerEvents = cam?.originUrl ? "auto" : "none";
    fallbackLink.style.opacity = cam?.originUrl ? "1" : ".6";
  }

  async function safePlayVideo() {
    try {
      const p = video.play();
      if (p && typeof p.then === "function") await p;
    } catch (_) {}
  }

  function effectiveSeconds(cam) {
    // imágenes: 60s (o cam.maxSeconds)
    if (cam && typeof cam.maxSeconds === "number" && cam.maxSeconds > 0) return cam.maxSeconds | 0;
    if (cam && cam.kind === "image") return 60;
    return roundSeconds;
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

    // no reset brusco: mantiene remaining si es menor
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
    idx = idx % cams.length;
    playCam(cams[idx]);
  }

  function resetState() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    idx = 0;
    modeAdfree = false;
    autoskip = true;
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
    try { bgmEl.volume = bgmVol; } catch (_) {}
    postState();
  }

  function bgmLoadTrack(i) {
    if (!bgmList.length) return;
    bgmIdx = (i % bgmList.length + bgmList.length) % bgmList.length;
    const t = bgmList[bgmIdx];
    try { bgmEl.src = t.url; bgmEl.load(); } catch (_) {}
    postState();
  }

  async function bgmPlay() {
    if (!bgmEnabled || !bgmList.length) return;
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
    try { bgmEl.pause(); } catch (_) {}
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

  // ───────────────────────── VOTE (Twitch IRC anon) ─────────────────────────
  let voteEnabled = !!P.vote;
  let voteOverlay = !!P.voteOverlay;
  let twitchChannel = P.twitch || "";
  let voteWindowSec = P.voteWindow;
  let voteAtSec = P.voteAt;

  let cmdYes = new Set(["!next","!cam"]);
  let cmdNo = new Set(["!stay","!keep"]);

  let voteActive = false;
  let voteEndsAt = 0;
  let votesYes = 0, votesNo = 0;
  let voters = new Set();

  function parseVoteCmds(str) {
    const parts = String(str || "").split("|");
    const a = (parts[0] || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    const b = (parts[1] || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    cmdYes = new Set(a.length ? a : ["!next","!cam"]);
    cmdNo = new Set(b.length ? b : ["!stay","!keep"]);
    if (voteHintEl) voteHintEl.textContent = `${[...cmdYes][0] || "!next"} o ${[...cmdNo][0] || "!stay"}`;
  }
  parseVoteCmds(P.voteCmd);

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

      // tags opcionales
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
      if (tags) {
        const parts = tags.split(";");
        for (const p of parts) {
          const eq = p.indexOf("=");
          const k = (eq >= 0) ? p.slice(0, eq) : p;
          const v = (eq >= 0) ? p.slice(eq + 1) : "";
          if (k === "user-id" && v) userId = v;
        }
      }

      try { this.onPrivmsg?.({ userId, msg }); } catch (_) {}
    }
  }

  let irc = null;
  function ensureIrc() {
    if (!voteEnabled || !twitchChannel) {
      try { irc?.close?.(); } catch (_) {}
      irc = null;
      return;
    }
    if (irc) return;
    irc = new TwitchAnonIRC(twitchChannel, handleChatVote);
    try { irc.connect(); } catch (_) { irc = null; }
  }

  function voteReset() {
    voteActive = false;
    voteEndsAt = 0;
    votesYes = 0; votesNo = 0;
    voters = new Set();
    renderVote();
  }

  function voteStart(sec) {
    if (!voteEnabled || !twitchChannel) return;
    voteActive = true;
    voteEndsAt = Date.now() + (sec | 0) * 1000;
    votesYes = 0; votesNo = 0;
    voters = new Set();
    renderVote();
  }

  function voteFinish() {
    if (!voteActive) return;
    const y = votesYes, n = votesNo;
    voteActive = false;
    renderVote();
    if (y > n && y > 0) nextCam("vote");
  }

  function renderVote() {
    if (!voteBox) return;
    const show = voteOverlay && voteEnabled && !!twitchChannel && voteActive;
    voteBox.classList.toggle("hidden", !show);
    if (!show) return;

    const rem = Math.max(0, Math.ceil((voteEndsAt - Date.now()) / 1000));
    if (voteTimeEl) voteTimeEl.textContent = fmtMMSS(rem);

    if (voteYesN) voteYesN.textContent = String(votesYes);
    if (voteNoN) voteNoN.textContent = String(votesNo);

    const total = Math.max(1, votesYes + votesNo);
    if (voteYesFill) voteYesFill.style.width = `${((votesYes / total) * 100).toFixed(1)}%`;
    if (voteNoFill) voteNoFill.style.width = `${((votesNo / total) * 100).toFixed(1)}%`;
  }

  function handleChatVote({ userId, msg }) {
    if (!voteActive) return;
    const low = String(msg || "").trim().toLowerCase();
    const who = userId || "anon";
    if (voters.has(who)) return;

    if (cmdYes.has(low)) { voters.add(who); votesYes++; renderVote(); return; }
    if (cmdNo.has(low)) { voters.add(who); votesNo++; renderVote(); return; }
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

      bgm: {
        enabled: bgmEnabled,
        vol: bgmVol,
        playing: bgmPlaying,
        idx: bgmIdx,
        track: bgmList[bgmIdx]?.title || ""
      },

      vote: {
        enabled: voteEnabled,
        overlay: voteOverlay,
        channel: twitchChannel || "",
        windowSec: voteWindowSec,
        voteAtSec: voteAtSec,
        cmd: (P.voteCmd || "!next,!cam|!stay,!keep"),
        active: voteActive,
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
        idx = idx % cams.length;
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
      case "BGM_TRACK": bgmLoadTrack(parseInt(payload?.index || "0", 10) || 0); if (bgmEnabled) bgmPlay(); break;
      case "BGM_NEXT": bgmNext(); break;
      case "BGM_PREV": bgmPrev(); break;
      case "BGM_PLAYPAUSE": bgmPlayPause(); break;
      case "BGM_SHUFFLE": bgmShuffle(); break;

      // Vote / Twitch
      case "TWITCH_SET":
        twitchChannel = String(payload?.channel || "").trim().replace(/^@/,"");
        voteEnabled = !!payload?.enabled;
        voteOverlay = !!payload?.overlay;
        voteWindowSec = clamp(parseInt(payload?.windowSec || voteWindowSec, 10) || voteWindowSec, 5, 60);
        voteAtSec = clamp(parseInt(payload?.voteAtSec || voteAtSec, 10) || voteAtSec, 5, 120);
        parseVoteCmds(payload?.cmd || "!next,!cam|!stay,!keep");
        ensureIrc();
        voteReset();
        postState();
        break;

      case "VOTE_START":
        voteStart(clamp(parseInt(payload?.windowSec || voteWindowSec, 10) || voteWindowSec, 5, 60));
        postState();
        break;

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
        voteCmd: P.voteCmd,

        ts: Date.now(),
        v: 2
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
    } catch (_) {}
  }

  function tick() {
    setCountdownUI();

    // voto auto
    if (voteEnabled && twitchChannel) {
      ensureIrc();

      if (playing && !voteActive) {
        const rem = remainingSeconds();
        if (rem > 0 && rem <= voteAtSec) voteStart(voteWindowSec);
      }
      if (voteActive) {
        renderVote();
        if (Date.now() >= voteEndsAt) voteFinish();
      } else {
        renderVote();
      }
    } else {
      voteReset();
    }

    if (playing && remainingSeconds() <= 0) nextCam("timer");
    postState();
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

      // BGM restore
      bgmEnabled = (st.bgmEnabled ?? 0) !== 0 || bgmEnabled;
      bgmVol = clamp(+st.bgmVol || bgmVol, 0, 1);
      bgmIdx = (st.bgmIdx | 0) || 0;
      bgmPlaying = (st.bgmPlaying ?? 0) !== 0;

      // Vote restore
      voteEnabled = (st.voteEnabled ?? 0) !== 0 || voteEnabled;
      voteOverlay = (st.voteOverlay ?? 1) !== 0;
      twitchChannel = st.twitchChannel || twitchChannel;
      voteWindowSec = clamp((st.voteWindowSec | 0) || voteWindowSec, 5, 60);
      voteAtSec = clamp((st.voteAtSec | 0) || voteAtSec, 5, 120);
      if (st.voteCmd) parseVoteCmds(st.voteCmd);

      const rem = clamp((st.remaining | 0) || roundSeconds, 1, 120 * 60);
      if (playing) startRound(rem);
      else { pausedRemaining = rem; roundEndsAt = 0; setCountdownUI(); }
    } else {
      idx = 0;
      playing = true;
      setRoundMins(P.mins);
      startRound(roundSeconds);

      // init BGM/vote from query
      bgmEnabled = !!P.bgm;
      bgmVol = P.bgmVol;
      voteEnabled = !!P.vote;
      voteOverlay = !!P.voteOverlay;
      twitchChannel = P.twitch || "";
      voteWindowSec = P.voteWindow;
      voteAtSec = P.voteAt;
      parseVoteCmds(P.voteCmd);
    }

    // BGM init
    try { bgmEl.volume = bgmVol; } catch (_) {}
    if (bgmList.length) bgmLoadTrack(bgmIdx);
    if (bgmEnabled && bgmPlaying) bgmPlay();
    if (bgmEnabled && !bgmPlaying) postState();

    // Vote init
    ensureIrc();

    playCam(cams[idx]);

    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(tick, 250);

    setInterval(() => { savePlayerState(); postState(); }, 2000);
    document.addEventListener("visibilitychange", () => { if (document.hidden) { savePlayerState(); postState(); } });

    // Teclas
    window.addEventListener("keydown", (e) => {
      const k = (e.key || "").toLowerCase();
      if (k === " ") { e.preventDefault(); togglePlay(); }
      else if (k === "n") nextCam("key");
      else if (k === "p") prevCam();
      else if (k === "h") setHudHidden(!hud.classList.contains("hidden"));
      else if (k === "i") setHudCollapsed(!hud.classList.contains("hud--collapsed"));
    });

    postState({ ready: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
