/* app.js — RLC Player v2.0.5 PRO (ADS NOTICE + TWITCH ALERTS + YT HEALTH)
   ✅ Detecta streams/imágenes caídas y salta a la siguiente automáticamente
   ✅ “CoolDown” de cams fallidas (evita repetir la misma rota)
   ✅ Mantiene: voto configurable (voteAt/voteLead/voteWindow), STAY, ytCookies, chat overlay

   v2.0.5:
   - ✅ Ads overlay: “Anuncio en…” + “Anuncio en curso…”
   - ✅ Comandos: AD_NOTICE, AD_CLEAR, ALERT
   - ✅ eventsWs opcional (bridge local) para eventos automáticos
   - ✅ IRC USERNOTICE: subs/resubs/gifts/raids → alertas en pantalla (sin backend)
   - ✅ FIX: si la votación termina con 0 votos → NEXT
   - ✅ YouTube: handshake postMessage (mejor detección de “video unavailable”)
*/
(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;
  const LOAD_GUARD = "__RLC_PLAYER_LOADED_V205_PRO";
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

      // Alerts (subs/gifts/raids via IRC + externos via eventsWs/cmd)
      alerts: (u.searchParams.get("alerts") ?? "1") !== "0",
      alertsMax: clamp(parseInt(u.searchParams.get("alertsMax") || "3", 10) || 3, 1, 6),
      alertsTtl: clamp(parseInt(u.searchParams.get("alertsTtl") || "8", 10) || 8, 3, 20),

      // Ads overlay
      ads: (u.searchParams.get("ads") ?? u.searchParams.get("ad") ?? "1") !== "0",
      adLead: clamp(parseInt(u.searchParams.get("adLead") || "30", 10) || 30, 0, 300),
      adShowDuring: (u.searchParams.get("adShowDuring") ?? "1") !== "0",
      adChatText: (u.searchParams.get("adChatText") || "⚠️ Anuncio en breve… ¡gracias por apoyar el canal! 💜"),
      botSayUrl: (u.searchParams.get("botSayUrl") || "").trim(), // POST {message,channel,key}
      botSayOnAd: (u.searchParams.get("botSayOnAd") ?? "1") !== "0",

      // Bridge opcional (WebSocket) para eventos automáticos (ads/follows/etc.)
      eventsWs: (u.searchParams.get("eventsWs") || "").trim(),
      eventsKey: (u.searchParams.get("eventsKey") || u.searchParams.get("key") || "").trim(),
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
      if (!startedOk) healthFail(tok, cam, `${kind}_start_timeout`);
    }, START_TIMEOUT_MS);
  }

  function healthFail(tok, cam, reason) {
    if (tok !== playToken) return;
    if (!autoskip) return;

    const id = cam?.id;
    if (id) markBad(id, reason);

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

  // ───────────────────────── Alerts UI ─────────────────────────
  let alertsEnabled = !!P.alerts;
  const alertsMax = P.alertsMax | 0;
  const alertsTtlSec = P.alertsTtl | 0;

  let alertsRoot = null;
  let alertsList = null;
  let alertItems = [];

  function injectAlertsStylesOnce() {
    if (document.getElementById("rlcAlertsStyles")) return;
    const st = document.createElement("style");
    st.id = "rlcAlertsStyles";
    st.textContent = `
      .rlcAlertsRoot{
        position: fixed;
        left: max(12px, env(safe-area-inset-left));
        top: max(12px, env(safe-area-inset-top));
        width: min(420px, calc(100vw - 24px));
        z-index: 10000;
        pointer-events: none;
        display: none;
      }
      .rlcAlertsRoot.alerts--on{ display:block !important; }
      .rlcAlertsList{
        display:flex; flex-direction:column; gap:10px;
      }
      .rlcAlert{
        display:flex; gap:10px; align-items:flex-start;
        padding:10px 12px;
        border-radius:16px;
        background: rgba(10,14,20,.56);
        border:1px solid rgba(255,255,255,.12);
        box-shadow: 0 14px 40px rgba(0,0,0,.35);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        transform: translateY(-6px);
        opacity:0;
        animation: rlcAlertIn .18s ease-out forwards;
      }
      @keyframes rlcAlertIn{ to{ transform: translateY(0); opacity:1; } }
      .rlcAlert.rlcAlertOut{ animation: rlcAlertOut .28s ease-in forwards; }
      @keyframes rlcAlertOut{ to{ transform: translateY(-6px); opacity:0; } }

      .rlcAlertIcon{
        flex:0 0 auto;
        width:34px; height:34px;
        border-radius:12px;
        display:grid; place-items:center;
        font-size:18px;
        background: rgba(255,255,255,.10);
        border:1px solid rgba(255,255,255,.10);
      }
      .rlcAlertBody{ min-width:0; }
      .rlcAlertTitle{
        font-weight:900;
        font-size:14px;
        color: rgba(255,255,255,.95);
        line-height:1.15;
      }
      .rlcAlertText{
        margin-top:2px;
        font-size:12.5px;
        color: rgba(255,255,255,.85);
        line-height:1.25;
        word-break: break-word;
        overflow-wrap:anywhere;
        white-space: pre-wrap;
      }

      .rlcAlert--follow .rlcAlertIcon{ background: rgba(79, 214, 255, .18); }
      .rlcAlert--sub   .rlcAlertIcon{ background: rgba(140, 255, 179, .18); }
      .rlcAlert--gift  .rlcAlertIcon{ background: rgba(255, 206, 87, .18); }
      .rlcAlert--raid  .rlcAlertIcon{ background: rgba(255, 133, 196, .18); }
      .rlcAlert--ad    .rlcAlertIcon{ background: rgba(255, 96, 96, .18); }

      @media (max-width: 520px){
        .rlcAlertsRoot{ width:min(360px, calc(100vw - 24px)); }
      }
    `;
    document.head.appendChild(st);
  }

  function ensureAlertsUI() {
    injectAlertsStylesOnce();
    alertsRoot = document.getElementById("rlcAlertsRoot");
    if (!alertsRoot) {
      alertsRoot = document.createElement("div");
      alertsRoot.id = "rlcAlertsRoot";
      alertsRoot.className = "rlcAlertsRoot";
      document.body.appendChild(alertsRoot);
    }
    alertsList = document.getElementById("rlcAlertsList");
    if (!alertsList) {
      alertsList = document.createElement("div");
      alertsList.id = "rlcAlertsList";
      alertsList.className = "rlcAlertsList";
      alertsRoot.appendChild(alertsList);
    }
    alertsRoot.classList.toggle("alerts--on", !!alertsEnabled);
    try { alertsRoot.style.display = alertsEnabled ? "" : "none"; } catch (_) {}
  }

  function alertsPush(type, title, text) {
    if (!alertsEnabled) return;
    ensureAlertsUI();
    if (!alertsRoot || !alertsList) return;

    const iconMap = {
      follow: "★",
      sub: "◆",
      gift: "🎁",
      raid: "⚡",
      ad: "⏳",
      info: "ℹ",
    };
    const t = String(type || "info").toLowerCase();
    const el = document.createElement("div");
    el.className = `rlcAlert rlcAlert--${t}`;

    const ic = document.createElement("div");
    ic.className = "rlcAlertIcon";
    ic.textContent = iconMap[t] || iconMap.info;

    const body = document.createElement("div");
    body.className = "rlcAlertBody";

    const h = document.createElement("div");
    h.className = "rlcAlertTitle";
    h.textContent = title || "Alerta";

    const p = document.createElement("div");
    p.className = "rlcAlertText";
    p.textContent = text || "";

    body.appendChild(h);
    body.appendChild(p);
    el.appendChild(ic);
    el.appendChild(body);

    alertsList.appendChild(el);
    const item = { el, ts: Date.now() };
    alertItems.push(item);

    while (alertItems.length > alertsMax) {
      const old = alertItems.shift();
      try { old?.el?.remove?.(); } catch (_) {}
    }

    setTimeout(() => {
      try { el.classList.add("rlcAlertOut"); } catch (_) {}
      setTimeout(() => { try { el.remove(); } catch (_) {} }, 320);
    }, Math.max(1500, alertsTtlSec * 1000));
  }

  // ───────────────────────── Ads overlay ─────────────────────────
  let adsEnabled = !!P.ads;
  const adLeadDefaultSec = P.adLead | 0;
  const adShowDuring = !!P.adShowDuring;
  const adChatText = String(P.adChatText || "").trim();
  const botSayUrl = String(P.botSayUrl || "").trim();
  const botSayOnAd = !!P.botSayOnAd;

  let adRoot = null;
  let adTitleEl = null;
  let adTimeEl = null;
  let adBarEl = null;

  let adActive = false;
  let adPhase = "idle"; // lead/live
  let adLeadEndsAt = 0;
  let adEndsAt = 0;
  let adTotalLead = 0;
  let adTotalLive = 0;
  let adChatSent = false;

  function injectAdsStylesOnce() {
    if (document.getElementById("rlcAdsStyles")) return;
    const st = document.createElement("style");
    st.id = "rlcAdsStyles";
    st.textContent = `
      .rlcAdRoot{
        position: fixed;
        left: 50%;
        top: max(14px, env(safe-area-inset-top));
        transform: translateX(-50%);
        width: min(640px, calc(100vw - 24px));
        z-index: 10001;
        pointer-events: none;
        display:none;
      }
      .rlcAdCard{
        display:flex;
        align-items:center;
        gap:12px;
        padding:12px 14px;
        border-radius:18px;
        background: rgba(10,14,20,.62);
        border: 1px solid rgba(255,255,255,.12);
        box-shadow: 0 16px 46px rgba(0,0,0,.40);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
      }
      .rlcAdPill{
        flex:0 0 auto;
        padding:6px 10px;
        border-radius:999px;
        font-weight:900;
        font-size:12px;
        letter-spacing:.2px;
        background: rgba(255,96,96,.18);
        border:1px solid rgba(255,96,96,.25);
        color: rgba(255,255,255,.95);
      }
      .rlcAdMsg{ min-width:0; flex:1 1 auto; }
      .rlcAdTitle{
        font-weight:900;
        font-size:14px;
        color: rgba(255,255,255,.95);
        line-height:1.15;
      }
      .rlcAdTime{
        margin-top:2px;
        font-size:12.5px;
        color: rgba(255,255,255,.85);
      }
      .rlcAdBar{
        margin-top:8px;
        height:6px;
        border-radius:999px;
        background: rgba(255,255,255,.10);
        overflow:hidden;
      }
      .rlcAdBar > i{
        display:block;
        height:100%;
        width:0%;
        background: linear-gradient(90deg, rgba(255,96,96,.85), rgba(255,206,87,.85));
      }
      .rlcAdRoot.on{ display:block !important; }
    `;
    document.head.appendChild(st);
  }

  function ensureAdsUI() {
    injectAdsStylesOnce();
    adRoot = document.getElementById("rlcAdRoot");
    if (!adRoot) {
      adRoot = document.createElement("div");
      adRoot.id = "rlcAdRoot";
      adRoot.className = "rlcAdRoot";
      adRoot.innerHTML = `
        <div class="rlcAdCard">
          <div class="rlcAdPill">ADS</div>
          <div class="rlcAdMsg">
            <div class="rlcAdTitle" id="rlcAdTitle">Anuncio</div>
            <div class="rlcAdTime" id="rlcAdTime">—</div>
            <div class="rlcAdBar"><i id="rlcAdBar"></i></div>
          </div>
        </div>
      `;
      document.body.appendChild(adRoot);
    }
    adTitleEl = document.getElementById("rlcAdTitle");
    adTimeEl = document.getElementById("rlcAdTime");
    adBarEl = document.getElementById("rlcAdBar");
  }

  function adHide() {
    adActive = false;
    adPhase = "idle";
    adLeadEndsAt = 0;
    adEndsAt = 0;
    adTotalLead = 0;
    adTotalLive = 0;
    adChatSent = false;
    if (adRoot) adRoot.classList.remove("on");
  }

  function adShow() {
    if (!adsEnabled) return;
    ensureAdsUI();
    if (adRoot) adRoot.classList.add("on");
  }

  function adStartLead(secondsLeft) {
    if (!adsEnabled) return;
    const left = clamp(secondsLeft | 0, 0, 3600);
    adActive = true;
    adPhase = "lead";
    adShow();

    if (!adTotalLead) adTotalLead = Math.max(1, left);
    adLeadEndsAt = Date.now() + left * 1000;

    if (adTitleEl) adTitleEl.textContent = "Anuncio en…";
    if (adTimeEl) adTimeEl.textContent = fmtMMSS(left);

    if (adBarEl) adBarEl.style.width = "0%";
    alertsPush("ad", "Anuncio en breve", `Empieza en ${fmtMMSS(left)}`);
  }

  function adStartLive(durationSec) {
    if (!adsEnabled) return;
    const d = clamp(durationSec | 0, 5, 3600);
    adActive = true;
    adPhase = "live";
    adShow();

    adTotalLive = d;
    adEndsAt = Date.now() + d * 1000;

    if (adTitleEl) adTitleEl.textContent = "Anuncio en curso…";
    if (adTimeEl) adTimeEl.textContent = `Quedan ${fmtMMSS(d)}`;
    if (adBarEl) adBarEl.style.width = "0%";

    if (adShowDuring) alertsPush("ad", "Anuncio", `En curso (${fmtMMSS(d)})`);
  }

  function adTick() {
    if (!adsEnabled || !adActive) return;
    const now = Date.now();

    if (adPhase === "lead") {
      const left = Math.max(0, Math.ceil((adLeadEndsAt - now) / 1000));
      if (adTimeEl) adTimeEl.textContent = fmtMMSS(left);

      const denom = Math.max(1, adTotalLead | 0);
      const pct = 100 * (1 - (left / denom));
      if (adBarEl) adBarEl.style.width = `${clamp(pct, 0, 100).toFixed(1)}%`;

      if (left <= 0) {
        // si no sabemos duración, dejamos el banner 6s y escondemos
        adPhase = "live";
        adTotalLive = Math.max(6, adTotalLive | 0);
        adEndsAt = now + (adTotalLive || 6) * 1000;
        if (adTitleEl) adTitleEl.textContent = "Anuncio en curso…";
      }

      // Mensaje al chat (vía botSayUrl) cuando entra en ventana lead
      if (!adChatSent && botSayOnAd && botSayUrl && adChatText) {
        adChatSent = true;
        botSay(adChatText);
      }
      return;
    }

    if (adPhase === "live") {
      const left = Math.max(0, Math.ceil((adEndsAt - now) / 1000));
      if (adTimeEl) adTimeEl.textContent = `Quedan ${fmtMMSS(left)}`;

      const denom = Math.max(1, adTotalLive | 0);
      const pct = 100 * (1 - (left / denom));
      if (adBarEl) adBarEl.style.width = `${clamp(pct, 0, 100).toFixed(1)}%`;

      if (left <= 0) adHide();
    }
  }

  function parseTimeMs(v) {
    const t = Date.parse(String(v || ""));
    return Number.isFinite(t) ? t : 0;
  }

  function adSchedule(nextAdAtIso, leadSec, durationSec) {
    if (!adsEnabled) return;
    const t = parseTimeMs(nextAdAtIso);
    if (!t) return;

    const lead = clamp((leadSec != null ? leadSec : adLeadDefaultSec) | 0, 0, 600);
    const dur = (durationSec != null) ? clamp(durationSec | 0, 0, 3600) : 0;

    const now = Date.now();
    const startLeadAt = t - lead * 1000;
    const untilLead = Math.ceil((startLeadAt - now) / 1000);

    // Guard: si ya está pasando o demasiado lejos, no spamear UI
    if (untilLead > 24 * 60 * 60) return;

    adTotalLead = lead || Math.max(1, Math.ceil((t - now) / 1000));
    adTotalLive = dur || 0;

    if (untilLead <= 0) {
      // ya estamos en ventana lead
      const left = Math.max(0, Math.ceil((t - now) / 1000));
      adStartLead(left);
      if (dur > 0) {
        // programamos live “virtual” cuando llegue el momento
        // (se convierte en live automáticamente cuando left llega a 0)
        adTotalLive = dur;
        adEndsAt = t + dur * 1000;
      } else {
        adTotalLive = 6;
      }
    } else {
      // programar inicio lead
      setTimeout(() => {
        // recalcular por si hubo cambios
        const n2 = Date.now();
        const left = Math.max(0, Math.ceil((t - n2) / 1000));
        if (left > 0) adStartLead(left);
      }, untilLead * 1000);
    }
  }

  async function botSay(message) {
    const msg = String(message || "").trim();
    if (!msg || !botSayUrl) return;
    try {
      await fetch(botSayUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: msg,
          channel: twitchChannel || "",
          key: P.eventsKey || P.key || ""
        })
      });
    } catch (_) {}
  }

  // ───────────────────────── YouTube handshake (mejor health) ─────────────────────────
  let ytMsgBound = false;
  let ytExpectTok = 0;
  let ytPlayerId = "";

  function bindYtMessagesOnce() {
    if (ytMsgBound) return;
    ytMsgBound = true;

    window.addEventListener("message", (ev) => {
      const origin = String(ev.origin || "");
      if (!origin.includes("youtube.com") && !origin.includes("youtube-nocookie.com")) return;

      let data = ev.data;
      try {
        if (typeof data === "string") data = JSON.parse(data);
      } catch (_) {}

      if (!data || typeof data !== "object") return;
      if (data.id && ytPlayerId && String(data.id) !== String(ytPlayerId)) return;

      // Cualquier señal del player la consideramos “progreso real”
      if (ytExpectTok) healthProgress(ytExpectTok);
    }, false);
  }

  function ytSend(cmdObj) {
    try {
      if (!frame || !frame.contentWindow) return;
      frame.contentWindow.postMessage(JSON.stringify(cmdObj), "*");
    } catch (_) {}
  }

  function ytHandshake(tok) {
    ytExpectTok = tok;
    bindYtMessagesOnce();
    if (!ytPlayerId) ytPlayerId = "rlcYt_" + String(Date.now());

    // Protocolo iframe API
    ytSend({ event: "listening", id: ytPlayerId });
    ytSend({ id: ytPlayerId, event: "command", func: "mute", args: [] });
    ytSend({ id: ytPlayerId, event: "command", func: "playVideo", args: [] });
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

      // watchdog: esperamos señal real (postMessage), no solo onload
      healthExpectStart(tok, cam, "youtube");

      const base = P.ytCookies ? "https://www.youtube.com" : "https://www.youtube-nocookie.com";
      const src =
        `${base}/embed/${encodeURIComponent(cam.youtubeId || "")}`
        + `?autoplay=1&mute=1&controls=0&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&fs=0&disablekb=1`
        + `&enablejsapi=1&origin=${encodeURIComponent(location.origin)}`
        + `&widgetid=1`;

      if (!cam.youtubeId) {
        healthFail(tok, cam, "youtube_missing_id");
        return;
      }

      ytPlayerId = "rlcYt_" + String(tok) + "_" + String(Date.now());

      if (frame) {
        frame.onload = () => {
          // hacemos handshake; si el vídeo está “unavailable”, normalmente no responde bien
          ytHandshake(tok);
        };
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

      healthExpectStart(tok, cam, "hls");

      video.onloadeddata = () => healthProgress(tok);
      video.oncanplay = () => { healthProgress(tok); safePlayVideo(); };
      video.onplaying = () => healthProgress(tok);
      video.ontimeupdate = () => healthProgress(tok);

      video.onwaiting = () => healthStall(tok, cam, "waiting");
      video.onstalled = () => healthStall(tok, cam, "stalled");
      video.onerror = () => healthFail(tok, cam, "video_error");

      if (video.canPlayType && video.canPlayType("application/vnd.apple.mpegurl")) {
        try { video.src = url; } catch (_) {}
        safePlayVideo();
        postState();
        return;
      }

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

    applyFilters();
    setFit("cover");
    setRoundMins(5);
    setHudHidden(false);
    setHudCollapsed(true);
    setPlaying(true);
    adHide();
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

  function parseTagsToObj(tagsStr) {
    const out = {};
    const tags = String(tagsStr || "");
    if (!tags) return out;
    const parts = tags.split(";");
    for (const p of parts) {
      const eq = p.indexOf("=");
      const k = (eq >= 0) ? p.slice(0, eq) : p;
      const v = (eq >= 0) ? p.slice(eq + 1) : "";
      out[k] = unescapeTagValue(v);
    }
    return out;
  }

  class TwitchAnonIRC {
    constructor(channel, onEvent) {
      this.channel = channel;
      this.onEvent = onEvent;
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

      let tagsStr = "";
      let rest = line;
      if (rest[0] === "@") {
        const sp = rest.indexOf(" ");
        tagsStr = rest.slice(1, sp);
        rest = rest.slice(sp + 1);
      }
      const tags = parseTagsToObj(tagsStr);

      // PRIVMSG
      const m = rest.match(/^:([^!]+)![^ ]+ PRIVMSG #[^ ]+ :(.+)$/);
      if (m) {
        const user = (m[1] || "").toLowerCase();
        const msg = (m[2] || "").trim();

        const userId = tags["user-id"] || user;
        const displayName = tags["display-name"] || "";

        try { this.onEvent?.({ kind: "privmsg", userId, user, displayName, msg, tags }); } catch (_) {}
        return;
      }

      // USERNOTICE (subs/gifts/raid/…)
      const n = rest.match(/^:([^ ]+) USERNOTICE #[^ ]+(?: :(.+))?$/);
      if (n) {
        const msgText = (n[2] || "").trim();
        const user = (tags.login || tags["display-name"] || "").toLowerCase();
        const userId = tags["user-id"] || user || "tmi";
        const displayName = tags["display-name"] || tags.login || "Twitch";
        const msgId = tags["msg-id"] || "";
        const sysMsg = tags["system-msg"] || "";

        try {
          this.onEvent?.({
            kind: "usernotice",
            msgId,
            sysMsg,
            userId,
            user,
            displayName,
            msg: msgText,
            tags
          });
        } catch (_) {}
        return;
      }
    }
  }

  let irc = null;
  function ensureIrc() {
    const need = (!!twitchChannel) && (voteEnabled || chatEnabled || alertsEnabled);
    if (!need) {
      try { irc?.close?.(); } catch (_) {}
      irc = null;
      return;
    }
    if (irc) return;
    irc = new TwitchAnonIRC(twitchChannel, handleTwitchEvent);
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

    // ✅ FIX: si no vota nadie, no te quedas -> NEXT
    if (y === 0 && n === 0) { nextCam("vote_no_votes"); return; }

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

  function handleTwitchEvent(ev) {
    if (!ev) return;

    // 1) Chat overlay (privmsg)
    if (ev.kind === "privmsg") {
      const text = String(ev.msg || "").trim();
      if (chatEnabled && twitchChannel) {
        const name = (ev.displayName || ev.user || "chat").trim();
        if (!isHiddenChatCommand(text)) chatAdd(name, text);
      }

      // VOTO (solo en fase vote)
      if (voteSessionActive && votePhase === "vote") {
        const low = text.toLowerCase();
        const who = ev.userId || ev.user || "anon";
        if (!voters.has(who)) {
          if (cmdYes.has(low)) { voters.add(who); votesYes++; renderVote(); }
          else if (cmdNo.has(low)) { voters.add(who); votesNo++; renderVote(); }
        }
      }
      return;
    }

    // 2) USERNOTICE (subs/gifts/raid)
    if (ev.kind === "usernotice") {
      const msgId = String(ev.msgId || "").toLowerCase();
      const dn = String(ev.displayName || "Twitch");
      const sys = String(ev.sysMsg || "").trim();
      const tags = ev.tags || {};

      // Si viene system-msg, úsalo como texto “bonito”
      const nice = sys || "";

      if (msgId === "sub" || msgId === "resub") {
        const plan = tags["msg-param-sub-plan"] || "";
        const months = tags["msg-param-cumulative-months"] || tags["msg-param-months"] || "";
        alertsPush("sub", "¡Nuevo sub!", `${dn}${months ? ` · ${months} meses` : ""}${plan ? ` · ${plan}` : ""}`);
        if (nice) chatAdd("TWITCH", nice);
        return;
      }

      if (msgId === "subgift" || msgId === "anonsubgift") {
        const recip = tags["msg-param-recipient-display-name"] || tags["msg-param-recipient-user-name"] || "alguien";
        alertsPush("gift", "Sub de regalo", `${dn} regaló una sub a ${recip}`);
        if (nice) chatAdd("TWITCH", nice);
        return;
      }

      if (msgId === "submysterygift") {
        const count = tags["msg-param-mass-gift-count"] || tags["msg-param-sender-count"] || "";
        alertsPush("gift", "Lluvia de subs 🎁", `${dn} regaló ${count || "varias"} subs`);
        if (nice) chatAdd("TWITCH", nice);
        return;
      }

      if (msgId === "raid") {
        const viewers = tags["msg-param-viewerCount"] || "";
        alertsPush("raid", "¡RAID!", `${dn} raideó con ${viewers || "gente"} 🎉`);
        if (nice) chatAdd("TWITCH", nice);
        return;
      }

      return;
    }
  }

  // ───────────────────────── eventsWs (bridge opcional) ─────────────────────────
  let eventsWs = null;
  let eventsWsTimer = null;
  let eventsWsBackoff = 800;

  function eventsKeyOk(obj) {
    const need = String(P.eventsKey || "").trim();
    if (!need) return true;
    return String(obj?.key || "").trim() === need;
  }

  function handleExternalEvent(obj) {
    if (!obj || typeof obj !== "object") return;
    if (!eventsKeyOk(obj)) return;

    const type = String(obj.type || obj.kind || "").toLowerCase();

    if (type === "ad_notice" || type === "ad_schedule") {
      // Soporta: next_ad_at (ISO), leadSec, durationSec
      const nextAt = obj.next_ad_at || obj.nextAdAt || obj.at || "";
      const lead = (obj.leadSec != null) ? (obj.leadSec | 0) : (obj.lead_sec != null ? (obj.lead_sec | 0) : adLeadDefaultSec);
      const dur  = (obj.durationSec != null) ? (obj.durationSec | 0) : (obj.duration_seconds != null ? (obj.duration_seconds | 0) : 0);
      if (nextAt) adSchedule(nextAt, lead, dur);
      else if (obj.leadSec != null) adStartLead(obj.leadSec | 0);
      return;
    }

    if (type === "ad_begin") {
      const d = (obj.durationSec != null) ? (obj.durationSec | 0) : (obj.duration_seconds != null ? (obj.duration_seconds | 0) : 30);
      adStartLive(d);
      return;
    }

    if (type === "ad_clear") {
      adHide();
      return;
    }

    if (type === "follow") {
      const user = obj.user || obj.displayName || obj.name || "Nuevo follow";
      alertsPush("follow", "¡Nuevo follow!", String(user));
      if (obj.chat && chatEnabled) chatAdd("TWITCH", `💜 ${user} ha seguido el canal`);
      return;
    }

    if (type === "alert") {
      const aType = obj.alertType || obj.subtype || obj.level || "info";
      alertsPush(aType, obj.title || "Alerta", obj.text || obj.message || "");
      return;
    }
  }

  function connectEventsWs() {
    const url = String(P.eventsWs || "").trim();
    if (!url) return;

    try { eventsWs?.close?.(); } catch (_) {}
    eventsWs = null;

    try {
      const ws = new WebSocket(url);
      eventsWs = ws;

      ws.onopen = () => {
        eventsWsBackoff = 800;
        if (P.debug) console.log("[eventsWs] connected:", url);
        try {
          ws.send(JSON.stringify({ type: "hello", key: P.eventsKey || "", channel: twitchChannel || "" }));
        } catch (_) {}
      };

      ws.onmessage = (ev) => {
        const raw = String(ev.data || "");
        try {
          const obj = JSON.parse(raw);
          handleExternalEvent(obj);
        } catch (_) {}
      };

      ws.onclose = () => {
        if (P.debug) console.log("[eventsWs] closed");
        scheduleEventsWsReconnect();
      };
      ws.onerror = () => {};
    } catch (_) {
      scheduleEventsWsReconnect();
    }
  }

  function scheduleEventsWsReconnect() {
    const url = String(P.eventsWs || "").trim();
    if (!url) return;
    try { if (eventsWsTimer) clearTimeout(eventsWsTimer); } catch (_) {}
    const wait = clamp(eventsWsBackoff, 800, 15000);
    eventsWsBackoff = Math.min(15000, (eventsWsBackoff * 1.6) | 0);
    eventsWsTimer = setTimeout(connectEventsWs, wait);
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

      ads: {
        enabled: adsEnabled,
        active: adActive,
        phase: adPhase,
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

        if (payload?.alerts != null) alertsEnabled = !!payload.alerts;

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

      // ADS
      case "AD_NOTICE": {
        // Soporta:
        // - payload.nextAdAt (ISO), payload.leadSec, payload.durationSec
        // - o payload.leadSec directo
        if (payload?.nextAdAt || payload?.next_ad_at) {
          adSchedule(payload.nextAdAt || payload.next_ad_at, payload.leadSec ?? payload.lead_sec, payload.durationSec ?? payload.duration_seconds);
        } else if (payload?.leadSec != null) {
          adStartLead(payload.leadSec | 0);
        }
        postState();
        break;
      }
      case "AD_BEGIN": {
        adStartLive((payload?.durationSec ?? payload?.duration_seconds ?? 30) | 0);
        postState();
        break;
      }
      case "AD_CLEAR": {
        adHide();
        postState();
        break;
      }

      // ALERT
      case "ALERT": {
        const t = payload?.type || payload?.alertType || "info";
        alertsPush(t, payload?.title || "Alerta", payload?.text || payload?.message || "");
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

        alertsEnabled: alertsEnabled ? 1 : 0,

        adsEnabled: adsEnabled ? 1 : 0,
        adLeadDefaultSec,
        adShowDuring: adShowDuring ? 1 : 0,
        botSayOnAd: botSayOnAd ? 1 : 0,
        botSayUrl,

        eventsWs: P.eventsWs || "",
        eventsKey: P.eventsKey || "",

        ts: Date.now(),
        v: 205
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
    } catch (_) {}
  }

  function tick() {
    setCountdownUI();
    adTick();

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

      // Alerts restore
      alertsEnabled = (st.alertsEnabled ?? 1) !== 0;

      // Ads restore
      adsEnabled = (st.adsEnabled ?? (P.ads ? 1 : 0)) !== 0;
      // botSayUrl/… ya vienen de params pero dejamos el storage como compat

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

      alertsEnabled = !!P.alerts;
      adsEnabled = !!P.ads;

      parseVoteCmds(P.voteCmd);
    }

    // chat UI + activar
    ensureChatUI();
    chatSetEnabled(chatEnabled);

    // alerts UI
    ensureAlertsUI();

    // ads UI
    ensureAdsUI();
    if (!adsEnabled) adHide();

    // BGM init
    try { if (bgmEl) bgmEl.volume = bgmVol; } catch (_) {}
    if (bgmList.length) bgmLoadTrack(bgmIdx);
    if (bgmEnabled && bgmPlaying) bgmPlay();
    if (bgmEnabled && !bgmPlaying) postState();

    // IRC init
    ensureIrc();

    // eventsWs (bridge)
    connectEventsWs();

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
