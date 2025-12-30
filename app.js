/* app.js — RLC Player v2.2.4 PRO (VOTE UI TIMING FIX + AUTO VOTE BY REMAINING + SAFE HIDE)
   ✅ FIX CLAVE:
      - Auto voto usa "segundos que FALTAN" (remaining), NO "segundos transcurridos" (elapsed)
      - voteAt = “Auto (a falta)” (segundos restantes cuando EMPIEZA la votación REAL)
      - El pre-aviso (lead) se muestra ANTES: auto-trigger ocurre a (voteAt + lead)
      - La UI de voto se fuerza a display:none cuando no toca (aunque falte .hidden en CSS)
      - En auto, la ventana efectiva nunca excede voteAt (para que no “corte” al final)
*/
(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;
  const LOAD_GUARD = "__RLC_PLAYER_LOADED_V223_PRO";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  // ───────────────────────── Helpers ─────────────────────────
  const qs = (s) => document.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtMMSS = (sec) => {
    sec = Math.max(0, sec | 0);
    const m = (sec / 60) | 0;
    const s = sec - m * 60;
    return `${pad2(m)}:${pad2(s)}`;
  };
  const setShown = (el, show) => {
    if (!el) return;
    try { el.style.display = show ? "" : "none"; } catch (_) {}
    try { el.classList.toggle("hidden", !show); } catch (_) {}
  };

  // ───────────────────────── News Ticker bridge (SAFE) ─────────────────────────
  // ✅ Compatible con newsTicker.js sin acoplarse:
  // - Dispara CustomEvent("RLC_PLAYER_EVENT") con { kind, data }
  // - Si existe window.RLCNewsTicker / window.NewsTicker / window.newsTicker, llama hooks opcionales
  // - STATE va throttled (~1s) para no spamear el ticker
  const TICKER_EVT = "RLC_PLAYER_EVENT";
  let lastTickerStateAt = 0;

  function tickerNotify(kind, data) {
    // kind: "STATE" | "EVENT" | "CAM"
    try {
      const api = g.RLCNewsTicker || g.NewsTicker || g.newsTicker || null;

      // Hooks opcionales (no obligatorios)
      if (api) {
        if (typeof api.onPlayerEvent === "function") api.onPlayerEvent(kind, data);
        if (typeof api.emit === "function") api.emit(kind, data);
        if (kind === "STATE" && typeof api.onState === "function") api.onState(data);
        if (kind === "EVENT" && typeof api.onEvent === "function") api.onEvent(data);
      }
    } catch (_) {}

    // CustomEvent universal (el ticker puede escuchar esto)
    try {
      window.dispatchEvent(new CustomEvent(TICKER_EVT, { detail: { kind, data } }));
    } catch (_) {}
  }

  function tickerState(state, force) {
    const now = Date.now();
    if (!force && (now - lastTickerStateAt) < 950) return;
    lastTickerStateAt = now;
    tickerNotify("STATE", state);
  }

  function parseBoolParam(v, def = false) {
    if (v == null) return def;
    const s = String(v).trim().toLowerCase();
    if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
    if (s === "0" || s === "false" || s === "no" || s === "off") return false;
    return def;
  }

  function parseParams() {
    const u = new URL(location.href);

    const twitchRaw = (u.searchParams.get("twitch") || "").trim().replace(/^@/, "");
    const twitchExplicit = (u.searchParams.get("twitch") != null);

    const chatParam = u.searchParams.get("chat") ?? u.searchParams.get("chatOverlay");
    const chatExplicit = (chatParam != null);
    const chat = chatExplicit ? parseBoolParam(chatParam, true) : !!twitchRaw;

    const voteParam = u.searchParams.get("vote");
    const voteExplicit = (voteParam != null);

    const alertsParam = u.searchParams.get("alerts");
    const alertsExplicit = (alertsParam != null);

    const adsParam = (u.searchParams.get("ads") ?? u.searchParams.get("ad"));
    const adsExplicit = (adsParam != null);

    const key = (u.searchParams.get("key") || "").trim();

    // Legacy allow
    const legacyParam = u.searchParams.get("legacy");
    const allowLegacy = (legacyParam != null) ? parseBoolParam(legacyParam, true) : true;

    // Health override
    const startTimeoutMs = clamp(parseInt(u.searchParams.get("startTimeoutMs") || "20000", 10) || 20000, 3000, 90000);
    const stallTimeoutMs = clamp(parseInt(u.searchParams.get("stallTimeoutMs") || "25000", 10) || 25000, 4000, 120000);
    const maxStalls = clamp(parseInt(u.searchParams.get("maxStalls") || "3", 10) || 3, 1, 8);

    // YouTube cookies/session (ON por defecto)
    const ytCookiesParam = u.searchParams.get("ytCookies");
    const ytSessionParam = u.searchParams.get("ytSession");
    const ytCookiesExplicit = (ytCookiesParam != null) || (ytSessionParam != null);
    const ytCookies = ytCookiesExplicit ? parseBoolParam((ytCookiesParam ?? ytSessionParam), true) : true;

    return {
      mins: clamp(parseInt(u.searchParams.get("mins") || "5", 10) || 5, 1, 120),
      fit: (u.searchParams.get("fit") || "cover"),
      hud: (u.searchParams.get("hud") ?? "1") !== "0",
      seed: u.searchParams.get("seed") || "",
      autoskip: (u.searchParams.get("autoskip") ?? "1") !== "0",
      mode: (u.searchParams.get("mode") || "").toLowerCase(),
      debug: (u.searchParams.get("debug") === "1"),
      key,
      allowLegacy,

      ytCookies,
      ytCookiesExplicit,

      // BGM ON por defecto
      bgm: parseBoolParam(u.searchParams.get("bgm") ?? "1", true),
      bgmVol: clamp(parseFloat(u.searchParams.get("bgmVol") || "0.22") || 0.22, 0, 1),

      vote: voteExplicit ? (voteParam === "1") : ((u.searchParams.get("vote") ?? "0") === "1"),
      voteExplicit,
      twitch: twitchRaw,
      twitchExplicit,

      voteWindow: clamp(parseInt(u.searchParams.get("voteWindow") || "60", 10) || 60, 5, 180),

      // ⚠️ IMPORTANTE: voteAt = “a falta” (segundos restantes cuando empieza la votación REAL)
      voteAt: clamp(parseInt(u.searchParams.get("voteAt") || "60", 10) || 60, 5, 600),

      voteLead: clamp(parseInt(u.searchParams.get("voteLead") || "5", 10) || 5, 0, 30),
      voteUi: clamp(parseInt(u.searchParams.get("voteUi") || "0", 10) || 0, 0, 300),
      stayMins: clamp(parseInt(u.searchParams.get("stayMins") || "5", 10) || 5, 1, 120),

      voteCmd: (u.searchParams.get("voteCmd") || "!next,!cam|!stay,!keep").trim(),
      voteOverlay: (u.searchParams.get("voteOverlay") ?? "1") !== "0",

      chat,
      chatExplicit,
      chatHideCommands: parseBoolParam(u.searchParams.get("chatHideCommands"), true),
      chatHideExplicit: (u.searchParams.get("chatHideCommands") != null),
      chatMax: clamp(parseInt(u.searchParams.get("chatMax") || "7", 10) || 7, 3, 12),
      chatMaxExplicit: (u.searchParams.get("chatMax") != null),
      chatTtl: clamp(parseInt(u.searchParams.get("chatTtl") || "12", 10) || 12, 5, 30),
      chatTtlExplicit: (u.searchParams.get("chatTtl") != null),

      alerts: alertsExplicit ? ((alertsParam ?? "1") !== "0") : ((u.searchParams.get("alerts") ?? "1") !== "0"),
      alertsExplicit,
      alertsMax: clamp(parseInt(u.searchParams.get("alertsMax") || "3", 10) || 3, 1, 6),
      alertsTtl: clamp(parseInt(u.searchParams.get("alertsTtl") || "8", 10) || 8, 3, 20),

      ads: adsExplicit ? ((adsParam ?? "1") !== "0") : ((u.searchParams.get("ads") ?? u.searchParams.get("ad") ?? "1") !== "0"),
      adsExplicit,
      adLead: clamp(parseInt(u.searchParams.get("adLead") || "30", 10) || 30, 0, 300),
      adShowDuring: (u.searchParams.get("adShowDuring") ?? "1") !== "0",
      adChatText: (u.searchParams.get("adChatText") || "⚠️ Anuncio en breve… ¡gracias por apoyar el canal! 💜"),

      startTimeoutMs,
      stallTimeoutMs,
      maxStalls,
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

  const P = parseParams();
  const rnd = makeRng(P.seed);

  // ───────────────────────── Bus + namespacing (?key=...) ─────────────────────────
  const BUS_BASE = "rlc_bus_v1";
  const CMD_KEY_BASE = "rlc_cmd_v1";
  const STATE_KEY_BASE = "rlc_state_v1";
  const EVT_KEY_BASE = "rlc_evt_v1";

  const KEY = String(P.key || "").trim();
  const OWNER_MODE = !!KEY;
  const ALLOW_LEGACY = !!P.allowLegacy;

  const BUS = KEY ? `${BUS_BASE}:${KEY}` : BUS_BASE;
  const CMD_KEY = KEY ? `${CMD_KEY_BASE}:${KEY}` : CMD_KEY_BASE;
  const STATE_KEY = KEY ? `${STATE_KEY_BASE}:${KEY}` : STATE_KEY_BASE;
  const EVT_KEY = KEY ? `${EVT_KEY_BASE}:${KEY}` : EVT_KEY_BASE;

  const BUS_LEGACY = BUS_BASE;
  const CMD_KEY_LEGACY = CMD_KEY_BASE;
  const STATE_KEY_LEGACY = STATE_KEY_BASE;
  const EVT_KEY_LEGACY = EVT_KEY_BASE;

  const bcMain = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS) : null;
  const bcLegacy = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_LEGACY) : null;

  const BOT_STORE_KEY_BASE = "rlc_bot_cfg_v1";
  const BOT_STORE_KEY = KEY ? `${BOT_STORE_KEY_BASE}:${KEY}` : BOT_STORE_KEY_BASE;

  const STORAGE_KEY_BASE = "rlc_player_state_v2";
  const STORAGE_KEY = KEY ? `${STORAGE_KEY_BASE}:${KEY}` : STORAGE_KEY_BASE;
  const STORAGE_KEY_LEGACY = STORAGE_KEY_BASE;

  const HUD_COLLAPSE_KEY_BASE = "rlc_hud_collapsed_v2";
  const HUD_HIDE_KEY_BASE = "rlc_hud_hidden_v2";
  const HUD_COLLAPSE_KEY = KEY ? `${HUD_COLLAPSE_KEY_BASE}:${KEY}` : HUD_COLLAPSE_KEY_BASE;
  const HUD_HIDE_KEY = KEY ? `${HUD_HIDE_KEY_BASE}:${KEY}` : HUD_HIDE_KEY_BASE;

  const BAN_KEY_BASE = "rlc_ban_ids_v1";
  const BAN_KEY = KEY ? `${BAN_KEY_BASE}:${KEY}` : BAN_KEY_BASE;
  const BAN_KEY_LEGACY = BAN_KEY_BASE;

  // ───────────────────────── Health / fail cache ─────────────────────────
  const BAD_KEY_BASE = "rlc_bad_ids_v1";
  const BAD_KEY = KEY ? `${BAD_KEY_BASE}:${KEY}` : BAD_KEY_BASE;
  const BAD_KEY_LEGACY = BAD_KEY_BASE;

  const BAD_BASE_COOLDOWN_MS = 30 * 60 * 1000;
  const BAD_MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000;

  let startTimeoutMs = P.startTimeoutMs | 0;
  let stallTimeoutMs = P.stallTimeoutMs | 0;
  let maxStalls = P.maxStalls | 0;

  const OWNER_DEFAULT_TWITCH = "globaleyetv";
  let ytCookiesEnabled = !!P.ytCookies;

  // ───────────────────────── DOM ─────────────────────────
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

  const bgmEl = qs("#bgm");

  // ───────────────────────── Storage helpers ─────────────────────────
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (_) {} }

  function loadJsonFirst(keys, fallbackVal = null) {
    for (const k of keys) {
      try { const raw = lsGet(k); if (!raw) continue; return JSON.parse(raw); } catch (_) {}
    }
    return fallbackVal;
  }
  function loadSetMerged(keys) {
    const out = new Set();
    for (const k of keys) {
      try {
        const raw = lsGet(k);
        if (!raw) continue;
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) for (const x of arr) out.add(String(x));
      } catch (_) {}
    }
    return out;
  }
  function saveSetBoth(keys, set) {
    const arr = Array.from(set);
    const raw = JSON.stringify(arr);
    for (const k of keys) lsSet(k, raw);
  }

  // ───────────────────────── Emit EVENTS ─────────────────────────
  let lastEvtAt = 0;
  function emitEvent(name, payload = {}) {
    const now = Date.now();
    lastEvtAt = Math.max(lastEvtAt + 1, now);
    const evt = { type: "event", ts: lastEvtAt, name: String(name || ""), payload: payload || {} };
    if (KEY) evt.key = KEY;
    const raw = JSON.stringify(evt);
    lsSet(EVT_KEY, raw);
    lsSet(EVT_KEY_LEGACY, raw);
    try { if (bcMain) bcMain.postMessage(evt); } catch (_) {}
    try { if (bcLegacy) bcLegacy.postMessage(evt); } catch (_) {}

    // ✅ News ticker hook (no rompe nada si no existe)
    tickerNotify("EVENT", evt);
  }

  // ───────────────────────── Cams + filters ─────────────────────────
  let allCams = Array.isArray(g.CAM_LIST) ? g.CAM_LIST.slice() : [];
  let banned = loadSetMerged([BAN_KEY, BAN_KEY_LEGACY]);

  let badMap = {};
  function loadBad() { const obj = loadJsonFirst([BAD_KEY, BAD_KEY_LEGACY], {}); badMap = (obj && typeof obj === "object") ? obj : {}; }
  function saveBad() { lsSet(BAD_KEY, JSON.stringify(badMap || {})); lsSet(BAD_KEY_LEGACY, JSON.stringify(badMap || {})); }
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
    if (!list.length) {
      list = allCams.filter(c => c && !banned.has(c.id));
      if (modeAdfree) list = list.filter(c => c.kind !== "youtube");
    }
    cams = list.length ? list : allCams.slice();
  }

  loadBad();
  applyFilters();

  // ───────────────────────── Playback state ─────────────────────────
  let idx = 0;
  let playing = true;

  let roundSeconds = P.mins * 60;
  let segmentSeconds = roundSeconds;
  let roundEndsAt = 0;
  let pausedRemaining = 0;

  let tickTimer = null;
  let saveTimer = null;
  let imgTimer = null;
  let hls = null;
  let switching = false;

  let currentFit = "cover";
  function setFit(mode) {
    currentFit = (mode === "contain") ? "contain" : "cover";
    try { if (frame) frame.style.objectFit = currentFit; } catch (_) {}
    try { if (video) video.style.objectFit = currentFit; } catch (_) {}
    try { if (img) img.style.objectFit = currentFit; } catch (_) {}
  }

  function setHudCollapsed(v) {
    const collapsed = !!v;
    if (hud) hud.classList.toggle("hud--collapsed", collapsed);
    if (hudToggle) {
      hudToggle.textContent = collapsed ? "▸" : "▾";
      hudToggle.setAttribute("aria-expanded", String(!collapsed));
      hudToggle.setAttribute("aria-label", collapsed ? "Expandir HUD" : "Contraer HUD");
    }
    if (hudDetails) hudDetails.style.display = collapsed ? "none" : "";
    lsSet(HUD_COLLAPSE_KEY, collapsed ? "1" : "0");
    postState({ reason: "hud_collapsed" });
  }

  function setHudHidden(v) {
    const hidden = !!v;
    if (hud) hud.classList.toggle("hidden", hidden);
    lsSet(HUD_HIDE_KEY, hidden ? "1" : "0");
    postState({ reason: "hud_hidden" });
  }

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
    recalcVoteScheduleForSegment(s);
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
    recalcVoteScheduleForSegment(total);
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
    postState({ reason: "play_toggle" });
  }
  function togglePlay() { setPlaying(!playing); }

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

  // ───────────────────────── Comms ─────────────────────────
  function busSendCmd(cmd, payload = {}) {
    const msg = { type: "cmd", ts: Date.now(), cmd: String(cmd || ""), payload: payload || {} };
    if (KEY) msg.key = KEY;

    const raw = JSON.stringify(msg);
    lsSet(CMD_KEY, raw);
    lsSet(CMD_KEY_LEGACY, raw);

    try { if (bcMain) bcMain.postMessage(msg); } catch (_) {}
    try { if (bcLegacy) bcLegacy.postMessage(msg); } catch (_) {}
  }

  function readBotCfgChannel() {
    const cfg = loadJsonFirst([BOT_STORE_KEY, BOT_STORE_KEY_BASE], null);
    if (!cfg || typeof cfg !== "object") return "";
    const cand = (cfg.twitch || cfg.channel || cfg.twitchChannel || cfg.username || cfg.user || cfg.login || cfg.name || "");
    return String(cand || "").trim().replace(/^@/, "");
  }

  let lastBotCmdAt = 0;
  let twitchChannel = ""; // set in boot
  function botSay(text) {
    if (!OWNER_MODE) return false;
    if (!twitchChannel) return false;

    const msg = String(text || "").trim();
    if (!msg) return false;

    const now = Date.now();
    if ((now - lastBotCmdAt) < 1400) return false;
    lastBotCmdAt = now;

    busSendCmd("BOT_SAY", { text: msg.slice(0, 480), channel: twitchChannel });
    return true;
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
    if (!playing) return;

    stallCount++;
    if (stallCount >= (maxStalls | 0)) {
      healthFail(tok, cam, `stall_${reason}`);
      return;
    }

    try { if (stallTimer) clearTimeout(stallTimer); } catch (_) {}
    stallTimer = setTimeout(() => {
      if (tok !== playToken) return;
      const age = Date.now() - (lastProgressAt || 0);
      if (age >= (stallTimeoutMs | 0)) healthFail(tok, cam, `stall_timeout_${reason}`);
    }, clamp((stallTimeoutMs | 0), 2000, 120000));
  }

  function healthExpectStart(tok, cam, kind = "media") {
    healthReset();
    if (!autoskip) return;
    if (!playing) return;

    startTimer = setTimeout(() => {
      if (tok !== playToken) return;
      if (!startedOk) healthFail(tok, cam, `${kind}_start_timeout`);
    }, clamp((startTimeoutMs | 0), 2000, 120000));
  }

  function healthFail(tok, cam, reason) {
    if (tok !== playToken) return;
    if (!autoskip) return;
    if (!playing) return;
    if (switching) return;

    const id = cam?.id;
    if (id) markBad(id, reason);

    emitEvent("HEALTH_FAIL", { id: id || "", kind: cam?.kind || "", reason: String(reason || "") });

    applyFilters();
    idx = idx % Math.max(1, cams.length);

    showFallback(cam, "Stream/imagen no disponible. Saltando…");
    setTimeout(() => {
      if (tok !== playToken) return;
      nextCam(String(reason || "fail"));
    }, 900);
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

  // ───────────────────────── Alerts UI ─────────────────────────
  let alertsEnabled = !!P.alerts;
  let alertsMax = P.alertsMax | 0;
  let alertsTtlSec = P.alertsTtl | 0;

  let alertsRoot = null;
  let alertsList = null;
  let alertItems = [];

  function injectAlertsStylesOnce() {
    if (document.getElementById("rlcAlertsStyles")) return;
    const st = document.createElement("style");
    st.id = "rlcAlertsStyles";
    st.textContent =
      ".rlcAlertsRoot{position:fixed;left:max(12px,env(safe-area-inset-left));top:max(12px,env(safe-area-inset-top));width:min(420px,calc(100vw - 24px));z-index:10000;pointer-events:none;display:none}" +
      ".rlcAlertsRoot.alerts--on{display:block!important}.rlcAlertsList{display:flex;flex-direction:column;gap:10px}" +
      ".rlcAlert{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:16px;background:rgba(10,14,20,.56);border:1px solid rgba(255,255,255,.12);box-shadow:0 14px 40px rgba(0,0,0,.35);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);transform:translateY(-6px);opacity:0;animation:rlcAlertIn .18s ease-out forwards}" +
      "@keyframes rlcAlertIn{to{transform:translateY(0);opacity:1}}.rlcAlert.rlcAlertOut{animation:rlcAlertOut .28s ease-in forwards}" +
      "@keyframes rlcAlertOut{to{transform:translateY(-6px);opacity:0}}.rlcAlertIcon{flex:0 0 auto;width:34px;height:34px;border-radius:12px;display:grid;place-items:center;font-size:18px;background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.10)}" +
      ".rlcAlertBody{min-width:0}.rlcAlertTitle{font-weight:900;font-size:14px;color:rgba(255,255,255,.95);line-height:1.15}.rlcAlertText{margin-top:2px;font-size:12.5px;color:rgba(255,255,255,.85);line-height:1.25;word-break:break-word;overflow-wrap:anywhere;white-space:pre-wrap}" +
      ".rlcAlert--follow .rlcAlertIcon{background:rgba(79,214,255,.18)}.rlcAlert--sub .rlcAlertIcon{background:rgba(140,255,179,.18)}.rlcAlert--gift .rlcAlertIcon{background:rgba(255,206,87,.18)}.rlcAlert--raid .rlcAlertIcon{background:rgba(255,133,196,.18)}.rlcAlert--ad .rlcAlertIcon{background:rgba(255,96,96,.18)}" +
      "@media (max-width:520px){.rlcAlertsRoot{width:min(360px,calc(100vw - 24px))}}";
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

    const iconMap = { follow: "★", sub: "◆", gift: "🎁", raid: "⚡", ad: "⏳", info: "ℹ" };
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
    alertItems.push({ el, ts: Date.now() });

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
  let adLeadDefaultSec = P.adLead | 0;
  let adShowDuring = !!P.adShowDuring;
  let adChatText = String(P.adChatText || "").trim();

  let adRoot = null, adTitleEl = null, adTimeEl = null, adBarEl = null;
  let adActive = false, adPhase = "idle";
  let adLeadEndsAt = 0, adEndsAt = 0, adTotalLead = 0, adTotalLive = 0;

  function injectAdsStylesOnce() {
    if (document.getElementById("rlcAdsStyles")) return;
    const st = document.createElement("style");
    st.id = "rlcAdsStyles";
    st.textContent =
      ".rlcAdRoot{position:fixed;left:50%;top:max(14px,env(safe-area-inset-top));transform:translateX(-50%);width:min(640px,calc(100vw - 24px));z-index:10001;pointer-events:none;display:none}" +
      ".rlcAdCard{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:18px;background:rgba(10,14,20,.62);border:1px solid rgba(255,255,255,.12);box-shadow:0 16px 46px rgba(0,0,0,.40);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}" +
      ".rlcAdPill{flex:0 0 auto;padding:6px 10px;border-radius:999px;font-weight:900;font-size:12px;letter-spacing:.2px;background:rgba(255,96,96,.18);border:1px solid rgba(255,96,96,.25);color:rgba(255,255,255,.95)}" +
      ".rlcAdMsg{min-width:0;flex:1 1 auto}.rlcAdTitle{font-weight:900;font-size:14px;color:rgba(255,255,255,.95);line-height:1.15}.rlcAdTime{margin-top:2px;font-size:12.5px;color:rgba(255,255,255,.85)}" +
      ".rlcAdBar{margin-top:8px;height:6px;border-radius:999px;background:rgba(255,255,255,.10);overflow:hidden}.rlcAdBar>i{display:block;height:100%;width:0%;background:linear-gradient(90deg,rgba(255,96,96,.85),rgba(255,206,87,.85))}" +
      ".rlcAdRoot.on{display:block!important}";
    document.head.appendChild(st);
  }

  function ensureAdsUI() {
    injectAdsStylesOnce();
    adRoot = document.getElementById("rlcAdRoot");
    if (!adRoot) {
      adRoot = document.createElement("div");
      adRoot.id = "rlcAdRoot";
      adRoot.className = "rlcAdRoot";
      adRoot.innerHTML = '<div class="rlcAdCard"><div class="rlcAdPill">ADS</div><div class="rlcAdMsg"><div class="rlcAdTitle" id="rlcAdTitle">Anuncio</div><div class="rlcAdTime" id="rlcAdTime">—</div><div class="rlcAdBar"><i id="rlcAdBar"></i></div></div></div>';
      document.body.appendChild(adRoot);
    }
    adTitleEl = document.getElementById("rlcAdTitle");
    adTimeEl = document.getElementById("rlcAdTime");
    adBarEl = document.getElementById("rlcAdBar");
  }

  function adHide(noEvent = false) {
    const wasActive = adActive;
    adActive = false; adPhase = "idle";
    adLeadEndsAt = 0; adEndsAt = 0; adTotalLead = 0; adTotalLive = 0;
    if (adRoot) adRoot.classList.remove("on");
    if (wasActive && !noEvent) emitEvent("AD_AUTO_CLEAR", {});
  }

  function adShow() {
    if (!adsEnabled) return;
    ensureAdsUI();
    if (adRoot) adRoot.classList.add("on");
  }

  function adStartLead(secondsLeft) {
    if (!adsEnabled) return;
    const left = clamp(secondsLeft | 0, 0, 3600);
    adActive = true; adPhase = "lead"; adShow();
    if (!adTotalLead) adTotalLead = Math.max(1, left);
    adLeadEndsAt = Date.now() + left * 1000;
    if (adTitleEl) adTitleEl.textContent = "Anuncio en…";
    if (adTimeEl) adTimeEl.textContent = fmtMMSS(left);
    if (adBarEl) adBarEl.style.width = "0%";
    alertsPush("ad", "Anuncio en breve", `Empieza en ${fmtMMSS(left)}`);
    emitEvent("AD_AUTO_NOTICE", { leadSec: left });
  }

  function adStartLive(durationSec) {
    if (!adsEnabled) return;
    const d = clamp(durationSec | 0, 5, 3600);
    adActive = true; adPhase = "live"; adShow();
    adTotalLive = d;
    adEndsAt = Date.now() + d * 1000;
    if (adTitleEl) adTitleEl.textContent = "Anuncio en curso…";
    if (adTimeEl) adTimeEl.textContent = `Quedan ${fmtMMSS(d)}`;
    if (adBarEl) adBarEl.style.width = "0%";
    if (adShowDuring) alertsPush("ad", "Anuncio", `En curso (${fmtMMSS(d)})`);
    emitEvent("AD_AUTO_BEGIN", { durationSec: d });
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
        adPhase = "live";
        adTotalLive = Math.max(6, adTotalLive | 0);
        adEndsAt = now + (adTotalLive || 6) * 1000;
        if (adTitleEl) adTitleEl.textContent = "Anuncio en curso…";
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

  // ───────────────────────── YouTube handshake (FIX HARD) ─────────────────────────
  let ytMsgBound = false;
  let ytExpectTok = 0;
  let ytPlayerId = "";
  let ytLastState = -999, ytLastTime = 0, ytLastGoodAt = 0;

  function bindYtMessagesOnce() {
    if (ytMsgBound) return;
    ytMsgBound = true;

    window.addEventListener("message", (ev) => {
      const origin = String(ev.origin || "");
      if (!origin.includes("youtube.com") && !origin.includes("youtube-nocookie.com")) return;

      let data = ev.data;
      try { if (typeof data === "string") data = JSON.parse(data); } catch (_) {}
      if (!data || typeof data !== "object") return;

      if (data.id && ytPlayerId && String(data.id) !== String(ytPlayerId)) return;

      const tok = ytExpectTok | 0;
      if (!tok || tok !== playToken) return;

      const cam = cams[idx] || null;
      if (!cam || cam.kind !== "youtube") return;

      const evName = String(data.event || data.type || "").toLowerCase();

      if (evName === "onerror") {
        const code = (data.info != null) ? (data.info | 0) : -1;
        emitEvent("YT_ERROR", { code });
        healthFail(tok, cam, `yt_error_${code}`);
        return;
      }

      if (evName === "onstatechange") {
        const st = (data.info != null) ? (data.info | 0) : -999;
        ytLastState = st;
        if (st === 0) { emitEvent("YT_ENDED", {}); healthFail(tok, cam, "yt_ended"); return; }
        if (st === 1 || st === 3) { ytLastGoodAt = Date.now(); healthProgress(tok); return; }
        return;
      }

      if (evName === "infodelivery") {
        const info = data.info || {};
        const ct = (typeof info.currentTime === "number") ? info.currentTime : null;
        if (ct != null) {
          if (ct > (ytLastTime + 0.08)) {
            ytLastTime = ct;
            ytLastGoodAt = Date.now();
            healthProgress(tok);
          }
        }
        return;
      }
    }, false);
  }

  function ytSend(cmdObj) {
    try { if (!frame || !frame.contentWindow) return; frame.contentWindow.postMessage(JSON.stringify(cmdObj), "*"); } catch (_) {}
  }

  function ytHandshake(tok) {
    ytExpectTok = tok;
    bindYtMessagesOnce();
    if (!ytPlayerId) ytPlayerId = "rlcYt_" + String(Date.now());

    ytLastState = -999; ytLastTime = 0; ytLastGoodAt = 0;

    ytSend({ event: "listening", id: ytPlayerId });
    ytSend({ id: ytPlayerId, event: "command", func: "addEventListener", args: ["onStateChange"] });
    ytSend({ id: ytPlayerId, event: "command", func: "addEventListener", args: ["onError"] });
    ytSend({ id: ytPlayerId, event: "command", func: "addEventListener", args: ["infoDelivery"] });

    ytSend({ id: ytPlayerId, event: "command", func: "mute", args: [] });
    ytSend({ id: ytPlayerId, event: "command", func: "playVideo", args: [] });
  }

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
    st.textContent =
      ".rlcChatRoot{position:fixed;right:max(12px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));width:min(360px,calc(100vw - 24px));max-height:min(44vh,420px);z-index:9999;pointer-events:none;display:none}" +
      ".rlcChatRoot.chat--on{display:block!important}.rlcChatList{display:flex;flex-direction:column;justify-content:flex-end;gap:8px;max-height:min(44vh,420px);overflow:hidden;position:relative}" +
      ".rlcChatBubble{pointer-events:none;display:flex;gap:8px;align-items:flex-end;padding:8px 10px;border-radius:14px;background:rgba(10,14,20,.46);border:1px solid rgba(255,255,255,.10);box-shadow:0 10px 30px rgba(0,0,0,.28);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);transform:translateY(6px);opacity:0;animation:rlcChatIn .16s ease-out forwards}" +
      "@keyframes rlcChatIn{to{transform:translateY(0);opacity:1}}.rlcChatBubble.rlcChatFade{animation:rlcChatOut .25s ease-in forwards}" +
      "@keyframes rlcChatOut{to{transform:translateY(6px);opacity:0}}.rlcChatUser{font-weight:900;font-size:12px;color:rgba(77,215,255,.95);white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis}" +
      ".rlcChatText{font-size:12px;color:rgba(255,255,255,.90);line-height:1.25;word-break:break-word;overflow-wrap:anywhere;white-space:pre-wrap}" +
      "@media (max-width:520px){.rlcChatRoot{width:min(320px,calc(100vw - 24px));max-height:38vh}.rlcChatUser{max-width:95px}}";
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

  function chatClear() { try { chatItems.forEach(it => it.el?.remove?.()); } catch (_) {} chatItems = []; }

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
    postState({ reason: "chat_toggle" });
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

    chatItems.push({ el: bubble, ts: Date.now() });
    while (chatItems.length > chatMax) {
      const old = chatItems.shift();
      try { old?.el?.remove?.(); } catch (_) {}
    }

    setTimeout(() => {
      try { bubble.classList.add("rlcChatFade"); } catch (_) {}
      setTimeout(() => { try { bubble.remove(); } catch (_) {} }, 300);
    }, Math.max(3000, chatTtlSec * 1000));
  }

  // ───────────────────────── VOTE + IRC ─────────────────────────
  let voteEnabled = !!P.vote;
  let voteOverlay = !!P.voteOverlay;

  // Config
  let voteWindowCfgSec = P.voteWindow | 0;
  let voteAtCfgSec = P.voteAt | 0;      // seconds remaining when vote window should begin
  let voteLeadCfgSec = P.voteLead | 0;  // pre-warning
  let voteUiCfgSec = (P.voteUi > 0) ? (P.voteUi | 0) : (voteLeadCfgSec + voteWindowCfgSec);
  let stayMins = P.stayMins | 0;

  // Segment schedule
  let voteWindowSegSec = voteWindowCfgSec;
  let voteAtSegSec = voteAtCfgSec;         // (auto trigger) remaining seconds when LEAD begins = voteAtBase + lead
  let voteAtSegBaseSec = voteAtCfgSec;     // (auto) remaining seconds when VOTE window begins
  let voteLeadSegSec = voteLeadCfgSec;
  let voteUiSegSec = voteUiCfgSec;

  // Active session
  let voteWindowActiveSec = voteWindowCfgSec;
  let voteLeadActiveSec = voteLeadCfgSec;

  let voteCmdStr = String(P.voteCmd || "!next,!cam|!stay,!keep").trim();
  let cmdYes = new Set(["!next","!cam"]);
  let cmdNo = new Set(["!stay","!keep"]);

  let voteSessionActive = false;
  let votePhase = "idle";
  let leadEndsAt = 0;
  let voteEndsAt = 0;

  let votesYes = 0, votesNo = 0;
  let voters = new Set();

  // TagVote flag (declarado antes para ensureIrc)
  let tagVoteActive = false;

  function parseVoteCmds(str) {
    voteCmdStr = String(str || "!next,!cam|!stay,!keep").trim() || "!next,!cam|!stay,!keep";
    const parts = voteCmdStr.split("|");
    const a = (parts[0] || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    const b = (parts[1] || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    cmdYes = new Set(a.length ? a : ["!next","!cam"]);
    cmdNo = new Set(b.length ? b : ["!stay","!keep"]);
  }
  parseVoteCmds(voteCmdStr);

  function voteReset() {
    voteSessionActive = false;
    votePhase = "idle";
    leadEndsAt = 0;
    voteEndsAt = 0;
    votesYes = 0; votesNo = 0;
    voters = new Set();
    renderVote();
  }

  // ✅ NUEVO: Auto schedule por "remaining"
  // - voteAtCfgSec = remaining cuando EMPIEZA el VOTO (sin lead)
  // - auto trigger = remaining <= (voteAtSegBaseSec + voteLeadSegSec)  (cuando empieza el lead)
  function recalcVoteScheduleForSegment(segTotalSec) {
    const total = clamp(segTotalSec | 0, 1, 120 * 60);

    voteWindowSegSec = clamp(voteWindowCfgSec | 0, 5, 180);
    voteLeadSegSec = clamp(voteLeadCfgSec | 0, 0, 30);

    // base "voteAt" (cuando empieza el voto real) no puede ser mayor que total
    voteAtSegBaseSec = clamp(voteAtCfgSec | 0, 1, total);

    // trigger (lead empieza) = voteAt + lead, pero nunca mayor que total
    voteAtSegSec = clamp((voteAtSegBaseSec + voteLeadSegSec) | 0, 1, total);

    // UI hint (informativo)
    voteUiSegSec = (voteUiCfgSec > 0) ? clamp(voteUiCfgSec | 0, 0, 300) : (voteLeadSegSec + voteWindowSegSec);
  }

  function voteStartSequence(windowSec, leadSec) {
    if (!voteEnabled || !twitchChannel) return;

    const w = clamp(windowSec | 0, 5, 180);
    const lead = clamp(leadSec | 0, 0, 30);

    voteWindowActiveSec = w;
    voteLeadActiveSec = lead;

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
    postState({ reason: "stay" });
  }

  function voteFinish() {
    if (!voteSessionActive) return;

    const y = votesYes, n = votesNo;
    voteSessionActive = false;
    votePhase = "idle";
    renderVote();

    if (y === 0 && n === 0) { nextCam("vote_no_votes"); return; }
    if (y === n) { nextCam("vote_tie"); return; }
    if (y > n) nextCam("vote_yes");
    else restartStaySegment();
  }

  function renderVote() {
    if (!voteBox) return;
    const show = voteOverlay && voteEnabled && !!twitchChannel && voteSessionActive;

    // ✅ FIX: fuerza ocultar/mostrar incluso si falta .hidden en CSS
    setShown(voteBox, show);

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

  // ───────────────────────── Protected “request vote” ─────────────────────────
  const REQUEST_THRESHOLD = 5;
  const REQUEST_WINDOW_MS = 65 * 1000;
  const REQUEST_COOLDOWN_MS = 6 * 60 * 1000;

  let callVoteUsers = new Map();
  let callVoteCooldownUntil = 0;

  function purgeReqMap(map, now) {
    for (const [k, ts] of map.entries()) {
      if (!ts || (now - ts) > REQUEST_WINDOW_MS) map.delete(k);
    }
  }

  function tryCallVote(userId) {
    if (!OWNER_MODE || !twitchChannel) return;
    const now = Date.now();
    if (now < callVoteCooldownUntil) return;

    purgeReqMap(callVoteUsers, now);
    callVoteUsers.set(String(userId || ""), now);

    const n = callVoteUsers.size;
    if (n >= REQUEST_THRESHOLD) {
      callVoteUsers.clear();
      callVoteCooldownUntil = now + REQUEST_COOLDOWN_MS;

      voteTriggeredForSegment = true;
      voteStartSequence(voteWindowSegSec, 0);

      const yes0 = [...cmdYes][0] || "!next";
      const no0  = [...cmdNo][0]  || "!stay";
      botSay(`🗳️ Votación iniciada por el chat: ${yes0} (cambiar) / ${no0} (mantener) · ${voteWindowSegSec}s`);
    }
  }

  // ───────────────────────── TAG VOTE (3 tags) ─────────────────────────
  function normTag(t) {
    return String(t || "").trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_:-]/g, "").slice(0, 24);
  }

  function camTags(cam) {
    const out = new Set();
    if (!cam) return out;

    const raw = cam.tags ?? cam.tag ?? cam.categories ?? cam.category ?? null;
    if (Array.isArray(raw)) {
      for (const x of raw) { const nt = normTag(x); if (nt) out.add(nt); }
    } else if (typeof raw === "string") {
      const parts = raw.split(/[,\s|]+/g).map(s => normTag(s)).filter(Boolean);
      for (const p of parts) out.add(p);
    }

    if (!out.size) {
      const kind = normTag(cam.kind);
      if (kind) out.add(kind);
      const src = normTag(cam.source);
      if (src && src.length >= 3) out.add(src);
    }

    return out;
  }

  let tagIndex = new Map();
  function buildTagIndex() {
    tagIndex = new Map();
    for (const cam of allCams) {
      const tags = camTags(cam);
      for (const t of tags) {
        if (!t) continue;
        if (!tagIndex.has(t)) tagIndex.set(t, []);
        tagIndex.get(t).push(String(cam.id));
      }
    }
    for (const [t, arr] of Array.from(tagIndex.entries())) {
      if (!Array.isArray(arr) || arr.length < 3) tagIndex.delete(t);
    }
  }

  let tagVoteEndsAt = 0;
  let tagVoteTags = [];
  let tagVoteCounts = [0, 0, 0];
  let tagVoteVoters = new Set();

  let tagReqUsers = new Map();
  let tagReqCooldownUntil = 0;

  // UI
  let tagVoteBox = null, tagVoteTimeEl = null;
  let tagVoteT1 = null, tagVoteT2 = null, tagVoteT3 = null;
  let tagVoteB1 = null, tagVoteB2 = null, tagVoteB3 = null;
  let tagVoteN1 = null, tagVoteN2 = null, tagVoteN3 = null;

  function injectTagVoteStylesOnce() {
    if (document.getElementById("rlcTagVoteStyles")) return;
    const st = document.createElement("style");
    st.id = "rlcTagVoteStyles";
    st.textContent =
      ".rlcTagVoteBox{position:fixed;left:50%;bottom:max(14px,env(safe-area-inset-bottom));transform:translateX(-50%);width:min(520px,calc(100vw - 24px));z-index:10002;pointer-events:none}" +
      ".rlcTagVoteCard{background:rgba(10,14,20,.62);border:1px solid rgba(255,255,255,.12);border-radius:18px;box-shadow:0 16px 46px rgba(0,0,0,.40);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);padding:12px 14px}" +
      ".rlcTagVoteTop{display:flex;justify-content:space-between;align-items:center;gap:12px}.rlcTagVoteTitle{font-weight:900;font-size:13px;color:rgba(255,255,255,.95)}" +
      ".rlcTagVoteTime{font-weight:900;font-size:12px;color:rgba(255,255,255,.85)}.rlcTagVoteHint{margin-top:4px;font-size:12px;color:rgba(255,255,255,.78)}" +
      ".rlcTagRows{margin-top:10px;display:flex;flex-direction:column;gap:8px}.rlcTagRow{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.10)}" +
      ".rlcTagName{flex:1 1 auto;min-width:0;font-weight:900;font-size:12px;color:rgba(255,255,255,.92);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".rlcTagNum{flex:0 0 auto;font-weight:900;font-size:12px;color:rgba(255,255,255,.88);width:26px;text-align:right}" +
      ".rlcTagBar{flex:0 0 44%;height:7px;border-radius:999px;background:rgba(255,255,255,.10);overflow:hidden}.rlcTagBar>i{display:block;height:100%;width:0%;background:linear-gradient(90deg,rgba(77,215,255,.85),rgba(255,206,87,.85))}" +
      "@media (max-width:520px){.rlcTagBar{flex-basis:40%}}";
    document.head.appendChild(st);
  }

  function ensureTagVoteUI() {
    injectTagVoteStylesOnce();
    tagVoteBox = document.getElementById("rlcTagVoteBox");
    if (!tagVoteBox) {
      tagVoteBox = document.createElement("div");
      tagVoteBox.id = "rlcTagVoteBox";
      tagVoteBox.className = "rlcTagVoteBox";
      tagVoteBox.innerHTML =
        '<div class="rlcTagVoteCard"><div class="rlcTagVoteTop"><div class="rlcTagVoteTitle">🎲 Vota un tag para la próxima cámara</div><div class="rlcTagVoteTime" id="rlcTagVoteTime">00:30</div></div>' +
        '<div class="rlcTagVoteHint">Vota con: !1  !2  !3</div><div class="rlcTagRows">' +
        '<div class="rlcTagRow"><div class="rlcTagName" id="rlcTagT1">—</div><div class="rlcTagBar"><i id="rlcTagB1"></i></div><div class="rlcTagNum" id="rlcTagN1">0</div></div>' +
        '<div class="rlcTagRow"><div class="rlcTagName" id="rlcTagT2">—</div><div class="rlcTagBar"><i id="rlcTagB2"></i></div><div class="rlcTagNum" id="rlcTagN2">0</div></div>' +
        '<div class="rlcTagRow"><div class="rlcTagName" id="rlcTagT3">—</div><div class="rlcTagBar"><i id="rlcTagB3"></i></div><div class="rlcTagNum" id="rlcTagN3">0</div></div>' +
        "</div></div>";
      document.body.appendChild(tagVoteBox);
    }
    tagVoteTimeEl = document.getElementById("rlcTagVoteTime");
    tagVoteT1 = document.getElementById("rlcTagT1");
    tagVoteT2 = document.getElementById("rlcTagT2");
    tagVoteT3 = document.getElementById("rlcTagT3");
    tagVoteB1 = document.getElementById("rlcTagB1");
    tagVoteB2 = document.getElementById("rlcTagB2");
    tagVoteB3 = document.getElementById("rlcTagB3");
    tagVoteN1 = document.getElementById("rlcTagN1");
    tagVoteN2 = document.getElementById("rlcTagN2");
    tagVoteN3 = document.getElementById("rlcTagN3");
  }

  function tagVoteRender() {
    ensureTagVoteUI();
    if (!tagVoteBox) return;
    const show = tagVoteActive && tagVoteTags.length === 3;

    // ✅ FIX: fuerza ocultar/mostrar aunque falte .hidden
    setShown(tagVoteBox, show);

    if (!show) return;

    const now = Date.now();
    const rem = Math.max(0, Math.ceil((tagVoteEndsAt - now) / 1000));
    if (tagVoteTimeEl) tagVoteTimeEl.textContent = fmtMMSS(rem);

    if (tagVoteT1) tagVoteT1.textContent = `1) ${tagVoteTags[0] || "—"}`;
    if (tagVoteT2) tagVoteT2.textContent = `2) ${tagVoteTags[1] || "—"}`;
    if (tagVoteT3) tagVoteT3.textContent = `3) ${tagVoteTags[2] || "—"}`;

    const a = tagVoteCounts[0] | 0, b = tagVoteCounts[1] | 0, c = tagVoteCounts[2] | 0;
    if (tagVoteN1) tagVoteN1.textContent = String(a);
    if (tagVoteN2) tagVoteN2.textContent = String(b);
    if (tagVoteN3) tagVoteN3.textContent = String(c);

    const total = Math.max(1, a + b + c);
    if (tagVoteB1) tagVoteB1.style.width = `${(100 * a / total).toFixed(1)}%`;
    if (tagVoteB2) tagVoteB2.style.width = `${(100 * b / total).toFixed(1)}%`;
    if (tagVoteB3) tagVoteB3.style.width = `${(100 * c / total).toFixed(1)}%`;
  }

  function pick3Tags() {
    const keys = Array.from(tagIndex.keys());
    if (keys.length < 3) return [];
    shuffle(keys, rnd);
    return keys.slice(0, 3);
  }

  function pickCamByTag(tag) {
    const t = normTag(tag);
    if (!t) return null;
    const candidates = cams.filter(c => camTags(c).has(t));
    if (!candidates.length) return null;
    return candidates[(rnd() * candidates.length) | 0];
  }

  function tagVoteStart() {
    if (!OWNER_MODE || !twitchChannel) return;
    if (tagVoteActive) return;
    if (voteSessionActive) return;

    const tags = pick3Tags();
    if (tags.length !== 3) { botSay("⚠️ No hay suficientes tags configurados (necesito tags en CAM_LIST)."); return; }

    tagVoteActive = true;
    tagVoteTags = tags;
    tagVoteCounts = [0, 0, 0];
    tagVoteVoters = new Set();
    tagVoteEndsAt = Date.now() + 30 * 1000;

    alertsPush("info", "Tag Vote", `Vota con !1 !2 !3 · ${tags.join(" / ")}`);
    botSay(`🎲 TagVote iniciado: 1) ${tags[0]}  2) ${tags[1]}  3) ${tags[2]}  (vota con !1 !2 !3)`);
    tagVoteRender();
  }

  function tagVoteFinish() {
    if (!tagVoteActive) return;
    tagVoteActive = false;

    const a = tagVoteCounts[0] | 0, b = tagVoteCounts[1] | 0, c = tagVoteCounts[2] | 0;
    const max = Math.max(a, b, c);
    let winners = [];
    if (a === max) winners.push(0);
    if (b === max) winners.push(1);
    if (c === max) winners.push(2);
    const wi = winners[(rnd() * winners.length) | 0] ?? 0;

    const tag = tagVoteTags[wi];
    const chosen = pickCamByTag(tag);

    tagVoteTags = [];
    tagVoteCounts = [0, 0, 0];
    tagVoteVoters = new Set();
    tagVoteEndsAt = 0;
    tagVoteRender();

    if (chosen && chosen.id) {
      botSay(`✅ Tag ganador: ${tag}. Cambiando a una cámara de ese tag…`);
      goToId(String(chosen.id));
    } else {
      botSay(`✅ Tag ganador: ${tag}. Pero no encontré cams filtradas con ese tag (saltando random)…`);
      nextCam("tagvote_no_cam");
    }
  }

  function tryTagVoteRequest(userId) {
    if (!OWNER_MODE || !twitchChannel) return;
    const now = Date.now();
    if (now < tagReqCooldownUntil) return;

    purgeReqMap(tagReqUsers, now);
    tagReqUsers.set(String(userId || ""), now);

    const n = tagReqUsers.size;
    if (n >= REQUEST_THRESHOLD) {
      tagReqUsers.clear();
      tagReqCooldownUntil = now + REQUEST_COOLDOWN_MS;
      tagVoteStart();
    }
  }

  // ───────────────────────── Twitch IRC ─────────────────────────
  function unescapeTagValue(v) {
    const s = String(v || "");
    return s.replace(/\\s/g, " ").replace(/\\:/g, ";").replace(/\\r/g, "\r").replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
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

      const m = rest.match(/^:([^!]+)![^ ]+ PRIVMSG #[^ ]+ :(.+)$/);
      if (m) {
        const user = (m[1] || "").toLowerCase();
        const msg = (m[2] || "").trim();
        const userId = tags["user-id"] || user;
        const displayName = tags["display-name"] || "";
        try { this.onEvent?.({ kind: "privmsg", userId, user, displayName, msg, tags }); } catch (_) {}
        return;
      }

      const n = rest.match(/^:([^ ]+) USERNOTICE #[^ ]+(?: :(.+))?$/);
      if (n) {
        const msgText = (n[2] || "").trim();
        const user = (tags.login || tags["display-name"] || "").toLowerCase();
        const userId = tags["user-id"] || user || "tmi";
        const displayName = tags["display-name"] || tags.login || "Twitch";
        const msgId = tags["msg-id"] || "";
        const sysMsg = tags["system-msg"] || "";

        try {
          this.onEvent?.({ kind: "usernotice", msgId, sysMsg, userId, user, displayName, msg: msgText, tags });
        } catch (_) {}
        return;
      }
    }
  }

  let irc = null;
  function ensureIrc() {
    const need = (!!twitchChannel) && (voteEnabled || chatEnabled || alertsEnabled || tagVoteActive);
    if (!need) {
      try { irc?.close?.(); } catch (_) {}
      irc = null;
      return;
    }
    if (irc) return;
    irc = new TwitchAnonIRC(twitchChannel, handleTwitchEvent);
    try { irc.connect(); } catch (_) { irc = null; }
  }

  let lastHelpAt = 0;
  function sendHelp() {
    const now = Date.now();
    if ((now - lastHelpAt) < 18000) return;
    lastHelpAt = now;

    const yes0 = [...cmdYes][0] || "!next";
    const no0  = [...cmdNo][0]  || "!stay";
    botSay(`🛰️ Comandos: !now · !help · Vota: ${yes0} / ${no0} · Pedir voto: !callvote (5) · TagVote: !tagvote (5) y luego !1 !2 !3`);
  }

  function sendNow() {
    const cam = cams[idx] || {};
    const t = String(cam.title || "Live Cam");
    const p = String(cam.place || "");
    const src = String(cam.source || "");
    botSay(`🌍 Ahora: ${t}${p ? ` — ${p}` : ""}${src ? ` · ${src}` : ""}`);
  }

  function handleTwitchEvent(ev) {
    if (!ev) return;

    if (ev.kind === "privmsg") {
      const text = String(ev.msg || "").trim();
      const low = text.toLowerCase();
      const who = String(ev.userId || ev.user || "anon");
      const name = (ev.displayName || ev.user || "chat").trim();

      if (chatEnabled && twitchChannel) {
        if (!isHiddenChatCommand(text)) chatAdd(name, text);
      }

      if (OWNER_MODE && twitchChannel && low && low[0] === "!") {
        if (low === "!help" || low === "!commands") { sendHelp(); return; }
        if (low === "!now" || low === "!where" || low === "!camera") { sendNow(); return; }
        if (low === "!callvote" || low === "!startvote") { tryCallVote(who); return; }
        if (low === "!tagvote" || low === "!tagsvote") { tryTagVoteRequest(who); return; }
      }

      if (tagVoteActive) {
        if (!tagVoteVoters.has(who)) {
          if (low === "!1" || low === "!one") { tagVoteVoters.add(who); tagVoteCounts[0]++; tagVoteRender(); return; }
          if (low === "!2" || low === "!two") { tagVoteVoters.add(who); tagVoteCounts[1]++; tagVoteRender(); return; }
          if (low === "!3" || low === "!three") { tagVoteVoters.add(who); tagVoteCounts[2]++; tagVoteRender(); return; }
        }
      }

      if (voteSessionActive && votePhase === "vote") {
        if (!voters.has(who)) {
          if (cmdYes.has(low)) { voters.add(who); votesYes++; renderVote(); }
          else if (cmdNo.has(low)) { voters.add(who); votesNo++; renderVote(); }
        }
      }
      return;
    }

    if (ev.kind === "usernotice") {
      const msgId = String(ev.msgId || "").toLowerCase();
      const dn = String(ev.displayName || "Twitch");
      const sys = String(ev.sysMsg || "").trim();
      const tags = ev.tags || {};
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
    }
  }

  // ───────────────────────── BGM ─────────────────────────
  const bgmList = Array.isArray(g.BGM_LIST) ? g.BGM_LIST.slice() : [];
  let bgmEnabled = !!P.bgm;
  let bgmVol = P.bgmVol;
  let bgmIdx = 0;
  let bgmPlaying = false;

  function fadeAudioTo(el, targetVol, ms) {
    if (!el) return;
    const start = el.volume;
    const end = clamp(+targetVol || 0, 0, 1);
    const dur = clamp(ms | 0, 0, 2000);
    if (dur <= 0) { try { el.volume = end; } catch(_) {} return; }
    const t0 = Date.now();
    const timer = setInterval(() => {
      const k = clamp((Date.now() - t0) / dur, 0, 1);
      const v = start + (end - start) * k;
      try { el.volume = clamp(v, 0, 1); } catch(_) {}
      if (k >= 1) { try { clearInterval(timer); } catch(_) {} }
    }, 40);
  }

  function bgmSetVol(v) {
    bgmVol = clamp(+v || 0, 0, 1);
    try { if (bgmEl) bgmEl.volume = bgmVol; } catch (_) {}
    postState({ reason: "bgm_vol" });
  }

  function bgmLoadTrack(i) {
    if (!bgmList.length || !bgmEl) return;
    bgmIdx = (i % bgmList.length + bgmList.length) % bgmList.length;
    const t = bgmList[bgmIdx];
    try { bgmEl.src = t.url; bgmEl.load(); } catch (_) {}
    postState({ reason: "bgm_track" });
  }

  async function bgmPlay() {
    if (!bgmEnabled || !bgmList.length || !bgmEl) return;
    try {
      if (!bgmEl.src) bgmLoadTrack(bgmIdx);
      try { bgmEl.volume = 0; } catch(_) {}
      const p = bgmEl.play();
      if (p && typeof p.then === "function") await p;
      fadeAudioTo(bgmEl, bgmVol, 320);
      bgmPlaying = true;
    } catch (_) { bgmPlaying = false; }
    postState({ reason: "bgm_play" });
  }

  function bgmPause() {
    try {
      if (bgmEl) {
        fadeAudioTo(bgmEl, 0, 220);
        setTimeout(() => { try { bgmEl.pause(); } catch(_) {} }, 240);
      }
    } catch (_) {}
    bgmPlaying = false;
    postState({ reason: "bgm_pause" });
  }

  function bgmPlayPause() { bgmPlaying ? bgmPause() : bgmPlay(); }
  function bgmNext() { bgmLoadTrack(bgmIdx + 1); if (bgmEnabled) bgmPlay(); }
  function bgmPrev() { bgmLoadTrack(bgmIdx - 1); if (bgmEnabled) bgmPlay(); }
  function bgmShuffle() { if (bgmList.length < 2) return; shuffle(bgmList, rnd); bgmIdx = 0; bgmLoadTrack(0); if (bgmEnabled) bgmPlay(); }
  bgmEl?.addEventListener?.("ended", () => { if (bgmEnabled) bgmNext(); });

  // ───────────────────────── Vote helpers ─────────────────────────
  function resetVoteForNewCam() {
    voteTriggeredForSegment = false;
    voteReset();
  }

  // ───────────────────────── Play cam ─────────────────────────
  function playCam(cam) {
    if (!cam) {
      showFallback({ originUrl: "#" }, "Cam inválida. Saltando…");
      setTimeout(() => nextCam("invalid_cam"), 500);
      return;
    }

    clearMedia();
    setHud(cam);

    // ✅ News ticker: evento “CAM” (no rompe si no existe)
    try {
      tickerNotify("CAM", {
        ts: Date.now(),
        key: KEY || "",
        idx: idx,
        total: Math.max(1, cams.length),
        cam: {
          id: cam.id || "",
          kind: cam.kind || "",
          title: cam.title || "",
          place: cam.place || "",
          source: cam.source || "",
          originUrl: cam.originUrl || ""
        }
      });
    } catch (_) {}

    startRound(effectiveSeconds(cam));
    resetVoteForNewCam();

    playToken++;
    const tok = playToken;

    if (cam.kind === "youtube") {
      showOnly("youtube");
      healthExpectStart(tok, cam, "youtube");

      const base = ytCookiesEnabled ? "https://www.youtube.com" : "https://www.youtube-nocookie.com";
      const ytId = cam.youtubeId || "";
      if (!ytId) { healthFail(tok, cam, "youtube_missing_id"); return; }

      const src =
        `${base}/embed/${encodeURIComponent(ytId)}` +
        `?autoplay=1&mute=1&controls=0&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&fs=0&disablekb=1` +
        `&enablejsapi=1&origin=${encodeURIComponent(location.origin)}` +
        `&widgetid=1`;

      ytPlayerId = "rlcYt_" + String(tok) + "_" + String(Date.now());

      if (frame) {
        frame.onload = () => { ytHandshake(tok); };
        frame.src = src;
      } else {
        healthFail(tok, cam, "youtube_no_iframe");
        return;
      }

      postState({ reason: "play_youtube" });
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
        img.onerror = () => { if (!autoskip) return; img.onerror = null; healthFail(tok, cam, "image_error"); };
      }

      setSnap();
      imgTimer = setInterval(setSnap, refreshMs);
      postState({ reason: "play_image" });
      return;
    }

    if (cam.kind === "hls") {
      showOnly("hls");

      const url = cam.url || "";
      const Hls = g.Hls;

      if (!url || !video) { healthFail(tok, cam, "hls_no_url_or_video"); return; }
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
        postState({ reason: "play_hls_native" });
        return;
      }

      if (Hls && Hls.isSupported && Hls.isSupported()) {
        try {
          hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30 });
          hls.loadSource(url);
          hls.attachMedia(video);

          hls.on(Hls.Events.ERROR, (_ev, data) => {
            if (!autoskip) return;
            if (data && data.fatal) healthFail(tok, cam, `hls_fatal_${data.type || "err"}`);
          });

          hls.on(Hls.Events.MANIFEST_PARSED, () => healthProgress(tok));
        } catch (_) { healthFail(tok, cam, "hls_exception"); return; }

        postState({ reason: "play_hls_hlsjs" });
        return;
      }

      showFallback(cam, "HLS no soportado aquí.");
      if (autoskip) setTimeout(() => healthFail(tok, cam, "hls_unsupported"), 700);
      postState({ reason: "play_hls_unsupported" });
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
    postState({ reason: "set_mins" });
  }

  function goToId(id) {
    const n = cams.findIndex(c => c && c.id === id);
    if (n >= 0) { idx = n; playCam(cams[idx]); }
  }

  function banId(id) {
    if (!id) return;
    banned.add(id);
    saveSetBoth([BAN_KEY, BAN_KEY_LEGACY], banned);
    applyFilters();
    idx = idx % Math.max(1, cams.length);
    playCam(cams[idx]);
  }

  function resetState() {
    lsDel(STORAGE_KEY);
    lsDel(STORAGE_KEY_LEGACY);

    idx = 0;
    modeAdfree = false;
    autoskip = true;

    bgmEnabled = true;
    ytCookiesEnabled = true;

    applyFilters();
    setFit("cover");
    setRoundMins(5);
    setHudHidden(false);
    setHudCollapsed(true);
    setPlaying(true);
    adHide(true);
    playCam(cams[idx]);
    postState({ reason: "reset" });
  }

  // ───────────────────────── State publish ─────────────────────────
  let lastPostAt = 0;
  function postState(extra = {}, force = true) {
    const now = Date.now();
    if (!force) { if ((now - lastPostAt) < 500) return; }
    lastPostAt = now;

    const cam = cams[idx] || {};
    const state = {
      type: "state",
      ts: now,
      key: KEY || undefined,
      version: "2.2.4",
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

      ytCookies: !!ytCookiesEnabled,

      health: { startTimeoutMs: startTimeoutMs | 0, stallTimeoutMs: stallTimeoutMs | 0, maxStalls: maxStalls | 0 },

      cam: { id: cam.id, title: cam.title, place: cam.place, source: cam.source, originUrl: cam.originUrl, kind: cam.kind },
      remaining: remainingSeconds(),

      bgm: { enabled: bgmEnabled, vol: bgmVol, playing: bgmPlaying, idx: bgmIdx, track: bgmList[bgmIdx]?.title || "" },

      chat: { enabled: chatEnabled, hideCommands: chatHideCommands, max: chatMax, ttl: chatTtlSec },

      vote: {
        enabled: voteEnabled,
        overlay: voteOverlay,
        channel: twitchChannel || "",
        windowSec: voteWindowCfgSec,
        // voteAt = “a falta” cuando empieza el voto (sin lead)
        voteAtSec: voteAtCfgSec,
        leadSec: voteLeadCfgSec,
        uiSec: voteUiCfgSec,
        stayMins,
        cmd: voteCmdStr,
        // segment-adjusted
        segWindowSec: voteWindowSegSec,
        // segVoteAtSec = “a falta” cuando empieza el LEAD (voteAt + lead) ya clamped al segmento
        segVoteAtSec: voteAtSegSec,
        // segVoteAtBaseSec = “a falta” cuando empieza el voto real
        segVoteAtBaseSec: voteAtSegBaseSec,
        segLeadSec: voteLeadSegSec,
        sessionActive: voteSessionActive,
        phase: votePhase,
        yes: votesYes,
        no: votesNo
      },

      ads: { enabled: adsEnabled, active: adActive, phase: adPhase, adLead: adLeadDefaultSec, adShowDuring, adChatText },

      alertsEnabled,
      owner: OWNER_MODE ? 1 : 0,

      tagVote: { active: tagVoteActive ? 1 : 0 },

      ...extra
    };

    const raw = JSON.stringify(state);

    lsSet(STATE_KEY, raw);
    lsSet(STATE_KEY_LEGACY, raw);

    try { if (bcMain) bcMain.postMessage(state); } catch (_) {}
    try { if (bcLegacy) bcLegacy.postMessage(state); } catch (_) {}

    // ✅ Exponer último state para el ticker (lectura inmediata si quiere)
    try { g.__RLC_LAST_STATE = state; } catch (_) {}

    // ✅ News ticker hook (STATE throttled)
    tickerState(state, !!force);
  }

  // ───────────────────────── Commands ─────────────────────────
  let lastCmdTs = 0;

  function cmdKeyOk(msg, isMainChannel) {
    if (!KEY) return true;
    if (msg && msg.key === KEY) return true;
    if (ALLOW_LEGACY && !isMainChannel && msg && !msg.key) return true;
    if (ALLOW_LEGACY && isMainChannel && msg && !msg.key) return true;
    return false;
  }

  function applyCommand(cmd, payload) {
    switch (cmd) {
      case "NEXT": nextCam("cmd"); break;
      case "PREV": prevCam(); break;
      case "TOGGLE_PLAY": togglePlay(); break;
      case "PLAY": setPlaying(true); break;
      case "PAUSE": setPlaying(false); break;

      case "SET_MINS":
      case "MINS":
        setRoundMins(payload?.mins ?? payload?.value ?? payload);
        break;

      case "SET_FIT":
      case "FIT":
        setFit(String(payload?.fit ?? payload?.value ?? payload ?? "cover"));
        postState({ reason: "set_fit" });
        break;

      case "RESHUFFLE":
      case "SHUFFLE":
        reshuffle();
        postState({ reason: "reshuffle" });
        break;

      case "GOTO":
      case "GOTO_ID":
        if (payload?.id != null) goToId(String(payload.id));
        else if (payload != null) goToId(String(payload));
        postState({ reason: "goto" });
        break;

      case "BAN_CURRENT":
      case "BAN": {
        const cam = cams[idx] || {};
        const id = String(payload?.id ?? cam.id ?? "");
        if (id) banId(id);
        postState({ reason: "ban" });
      } break;

      case "SET_AUTOSKIP":
      case "AUTOSKIP":
        autoskip = !!(payload?.enabled ?? payload?.value ?? payload);
        postState({ reason: "autoskip" });
        break;

      case "SET_MODE":
      case "MODE":
      case "SET_ADFREE":
      case "ADFREE": {
        const prev = !!modeAdfree;
        const m = String(payload?.mode ?? payload?.value ?? payload ?? "").toLowerCase().trim();
        const want = (m === "adfree") || (payload?.adfree === 1) || (payload?.adfree === true) || (payload === "adfree");
        modeAdfree = !!want;

        if (modeAdfree !== prev) {
          const curId = String((cams[idx] || {}).id || "");
          applyFilters();
          const n = curId ? cams.findIndex(c => c && String(c.id) === curId) : -1;
          idx = (n >= 0) ? n : (idx % Math.max(1, cams.length));
          playCam(cams[idx]);
        }
        postState({ reason: "mode" });
      } break;

      case "SET_TWITCH":
      case "TWITCH": {
        const ch = String(payload?.channel ?? payload?.twitch ?? payload?.value ?? payload ?? "").trim().replace(/^@/, "");
        twitchChannel = ch;
        ensureIrc();
        postState({ reason: "twitch" });
      } break;

      case "SET_VOTE":
      case "VOTE": {
        if (payload && typeof payload === "object") {
          if (payload.enabled != null) voteEnabled = !!payload.enabled;
          if (payload.overlay != null) voteOverlay = !!payload.overlay;
          if (payload.windowSec != null) voteWindowCfgSec = clamp(payload.windowSec | 0, 5, 180);

          // ✅ voteAt sigue siendo "a falta" cuando empieza el voto real (sin lead)
          if (payload.voteAtSec != null) voteAtCfgSec = clamp(payload.voteAtSec | 0, 5, 600);

          if (payload.leadSec != null) voteLeadCfgSec = clamp(payload.leadSec | 0, 0, 30);
          if (payload.uiSec != null) voteUiCfgSec = clamp(payload.uiSec | 0, 0, 300) || (voteLeadCfgSec + voteWindowCfgSec);
          if (payload.stayMins != null) stayMins = clamp(payload.stayMins | 0, 1, 120);
          if (payload.cmd != null) parseVoteCmds(String(payload.cmd || ""));
        } else {
          voteEnabled = !!payload;
        }
        recalcVoteScheduleForSegment(segmentSeconds | 0);
        ensureIrc();
        voteReset();
        postState({ reason: "vote" });
      } break;

      case "START_VOTE":
      case "VOTE_START": {
        voteTriggeredForSegment = true;
        const w = clamp((payload?.windowSec ?? voteWindowSegSec) | 0, 5, 180);
        const lead = clamp((payload?.leadSec ?? voteLeadSegSec) | 0, 0, 30);
        voteStartSequence(w, lead);
        postState({ reason: "vote_start" });
      } break;

      case "STOP_VOTE":
      case "VOTE_STOP":
        voteReset();
        postState({ reason: "vote_stop" });
        break;

      case "SET_CHAT":
      case "CHAT": {
        if (payload && typeof payload === "object") {
          if (payload.enabled != null) chatSetEnabled(!!payload.enabled);
          if (payload.hideCommands != null) chatHideCommands = !!payload.hideCommands;
          if (payload.max != null) chatMax = clamp(payload.max | 0, 3, 12);
          if (payload.ttl != null) chatTtlSec = clamp(payload.ttl | 0, 5, 30);
          if (chatEnabled) { ensureChatUI(); chatRoot?.classList?.add?.("chat--on"); }
        } else {
          chatSetEnabled(!!payload);
        }
        ensureIrc();
        postState({ reason: "chat" });
      } break;

      case "SET_ALERTS":
      case "ALERTS": {
        if (payload && typeof payload === "object") {
          if (payload.enabled != null) alertsEnabled = !!payload.enabled;
          if (payload.max != null) alertsMax = clamp(payload.max | 0, 1, 6);
          if (payload.ttl != null) alertsTtlSec = clamp(payload.ttl | 0, 3, 20);
        } else {
          alertsEnabled = !!payload;
        }
        ensureAlertsUI();
        ensureIrc();
        postState({ reason: "alerts" });
      } break;

      case "SET_ADS":
      case "ADS": {
        if (payload && typeof payload === "object") {
          if (payload.enabled != null) adsEnabled = !!payload.enabled;
          if (payload.adLead != null) adLeadDefaultSec = clamp(payload.adLead | 0, 0, 300);
          if (payload.showDuring != null) adShowDuring = !!payload.showDuring;
          if (payload.chatText != null) adChatText = String(payload.chatText || "").trim();
        } else {
          adsEnabled = !!payload;
        }
        if (!adsEnabled) adHide(true);
        postState({ reason: "ads" });
      } break;

      case "AD_NOTICE":
        adStartLead(payload?.leadSec ?? payload?.secondsLeft ?? adLeadDefaultSec);
        break;

      case "AD_BEGIN":
        adStartLive(payload?.durationSec ?? payload?.duration ?? 30);
        if (adChatText) botSay(adChatText);
        break;

      case "AD_CLEAR":
      case "AD_END":
        adHide(false);
        break;

      case "TAGVOTE_START":
        tagVoteStart();
        postState({ reason: "tagvote_start" });
        break;

      case "TAGVOTE_STOP":
        tagVoteActive = false;
        tagVoteTags = [];
        tagVoteCounts = [0, 0, 0];
        tagVoteVoters = new Set();
        tagVoteEndsAt = 0;
        tagVoteRender();
        postState({ reason: "tagvote_stop" });
        break;

      case "SET_BGM":
      case "BGM":
        bgmEnabled = !!(payload?.enabled ?? payload?.value ?? payload);
        if (!bgmEnabled) bgmPause();
        else bgmPlay();
        postState({ reason: "bgm" });
        break;

      case "SET_BGM_VOL":
      case "BGM_VOL":
        bgmSetVol(payload?.vol ?? payload?.value ?? payload);
        break;

      case "BGM_PLAYPAUSE":
        bgmPlayPause();
        break;

      case "BGM_NEXT":
        bgmNext();
        break;

      case "BGM_PREV":
        bgmPrev();
        break;

      case "BGM_SHUFFLE":
        bgmShuffle();
        break;

      case "SET_HEALTH":
      case "HEALTH":
        if (payload && typeof payload === "object") {
          if (payload.startTimeoutMs != null) startTimeoutMs = clamp(payload.startTimeoutMs | 0, 3000, 120000);
          if (payload.stallTimeoutMs != null) stallTimeoutMs = clamp(payload.stallTimeoutMs | 0, 4000, 120000);
          if (payload.maxStalls != null) maxStalls = clamp(payload.maxStalls | 0, 1, 8);
        }
        postState({ reason: "health" });
        break;

      case "SET_YT_COOKIES":
      case "YT_COOKIES":
      case "SET_YT_SESSION":
      case "YT_SESSION": {
        const v = !!(payload?.enabled ?? payload?.value ?? payload ?? true);
        ytCookiesEnabled = v;
        const cam = cams[idx] || {};
        if (cam.kind === "youtube") playCam(cam);
        postState({ reason: "yt_cookies" });
      } break;

      case "RESET":
        resetState();
        break;

      case "PING":
        postState({ reason: "ping" }, true);
        break;

      default:
        if (P.debug) console.log("[player] unknown cmd:", cmd, payload);
        break;
    }
  }

  function handleCmdMsg(msg, isMainChannel) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type !== "cmd") return;
    if (!cmdKeyOk(msg, !!isMainChannel)) return;

    const ts = (msg.ts | 0) || 0;
    if (ts && ts <= lastCmdTs) return;
    if (ts) lastCmdTs = ts;

    const cmd = String(msg.cmd || "");
    const payload = msg.payload || {};
    applyCommand(cmd, payload);
  }

  function readCmdFromStorage(keyName, isMainChannel) {
    try {
      const raw = lsGet(keyName);
      if (!raw) return;
      const msg = JSON.parse(raw);
      handleCmdMsg(msg, isMainChannel);
    } catch (_) {}
  }

  try { if (bcMain) bcMain.onmessage = (ev) => handleCmdMsg(ev?.data, true); } catch (_) {}
  try { if (bcLegacy) bcLegacy.onmessage = (ev) => handleCmdMsg(ev?.data, false); } catch (_) {}

  window.addEventListener("storage", (e) => {
    const k = String(e.key || "");
    if (!k) return;

    if (k === CMD_KEY) readCmdFromStorage(CMD_KEY, true);
    else if (k === CMD_KEY_LEGACY) readCmdFromStorage(CMD_KEY_LEGACY, false);

    if (!P.twitchExplicit && (k === BOT_STORE_KEY || k === BOT_STORE_KEY_BASE)) {
      const ch = readBotCfgChannel();
      if (ch && ch !== twitchChannel) {
        twitchChannel = ch;
        ensureIrc();
        postState({ reason: "bot_cfg_channel" });
      }
    }
  });

  // ───────────────────────── Persist player state ─────────────────────────
  function savePlayerState() {
    try {
      const cam = cams[idx] || {};
      const data = {
        v: 3,
        ts: Date.now(),
        key: KEY || "",
        curId: cam.id || "",
        playing: !!playing,
        mins: Math.max(1, (roundSeconds / 60) | 0),
        segmentSec: segmentSeconds | 0,
        remaining: remainingSeconds(),

        fit: currentFit,
        hudHidden: !!hud?.classList?.contains?.("hidden"),
        hudCollapsed: !!hud?.classList?.contains?.("hud--collapsed"),

        autoskip: !!autoskip,
        adfree: !!modeAdfree,

        twitch: twitchChannel || "",

        ytCookies: !!ytCookiesEnabled,

        health: { startTimeoutMs: startTimeoutMs | 0, stallTimeoutMs: stallTimeoutMs | 0, maxStalls: maxStalls | 0 },

        vote: {
          enabled: !!voteEnabled,
          overlay: !!voteOverlay,
          windowSec: voteWindowCfgSec | 0,
          voteAtSec: voteAtCfgSec | 0,
          leadSec: voteLeadCfgSec | 0,
          uiSec: voteUiCfgSec | 0,
          stayMins: stayMins | 0,
          cmd: voteCmdStr
        },

        chat: { enabled: !!chatEnabled, hideCommands: !!chatHideCommands, max: chatMax | 0, ttl: chatTtlSec | 0 },

        ads: { enabled: !!adsEnabled, adLead: adLeadDefaultSec | 0, showDuring: !!adShowDuring, chatText: adChatText || "" },

        bgm: { enabled: !!bgmEnabled, vol: +bgmVol || 0, idx: bgmIdx | 0, playing: !!bgmPlaying }
      };

      const raw = JSON.stringify(data);
      lsSet(STORAGE_KEY, raw);
      lsSet(STORAGE_KEY_LEGACY, raw);
    } catch (_) {}
  }

  function loadPlayerState() {
    const data = loadJsonFirst([STORAGE_KEY, STORAGE_KEY_LEGACY], null);
    if (!data || typeof data !== "object") return null;
    return data;
  }

  function boolFromLS(keys, def = false) {
    for (const k of keys) {
      const v = lsGet(k);
      if (v == null) continue;
      if (v === "1") return true;
      if (v === "0") return false;
    }
    return def;
  }

  // ───────────────────────── UI hooks ─────────────────────────
  try {
    if (hudToggle) {
      hudToggle.addEventListener("click", () => {
        const collapsed = !!hud?.classList?.contains?.("hud--collapsed");
        setHudCollapsed(!collapsed);
      });
    }
  } catch (_) {}

  try {
    if (hud) {
      hud.addEventListener("dblclick", () => {
        const hidden = !!hud?.classList?.contains?.("hidden");
        setHudHidden(!hidden);
      });
    }
  } catch (_) {}

  window.addEventListener("keydown", (e) => {
    const t = (e.target && e.target.tagName) ? String(e.target.tagName).toLowerCase() : "";
    if (t === "input" || t === "textarea" || (e.target && e.target.isContentEditable)) return;

    if (e.key === "ArrowRight") { e.preventDefault(); nextCam("key"); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); prevCam(); }
    else if (e.key === " " || e.code === "Space") { e.preventDefault(); togglePlay(); }
    else if (e.key.toLowerCase() === "h") { setHudHidden(!hud?.classList?.contains?.("hidden")); }
  });

  // ───────────────────────── Main tick loop ─────────────────────────
  function tick() {
    setCountdownUI();

    // Vote tick
    if (voteSessionActive) {
      const now = Date.now();
      if (votePhase === "lead" && leadEndsAt && now >= leadEndsAt) { votePhase = "vote"; renderVote(); }
      if (voteEndsAt && now >= voteEndsAt) voteFinish();
    }

    // TagVote tick
    if (tagVoteActive && tagVoteEndsAt && Date.now() >= tagVoteEndsAt) tagVoteFinish();

    // Ads tick
    adTick();

    // YouTube stall guard
    try {
      const cam = cams[idx] || null;
      if (playing && autoskip && cam && cam.kind === "youtube" && startedOk) {
        const age = Date.now() - (lastProgressAt || 0);
        if (age > (stallTimeoutMs | 0)) healthStall(playToken, cam, "yt_no_progress");
      }
    } catch (_) {}

    // ✅ FIX: Auto-trigger vote por "remaining" (a falta)
    // - trigger cuando rem <= voteAtSegSec (lead start = voteAt + lead)
    // - en auto, ventana efectiva no excede voteAtSegBaseSec (para que no “corte” al final)
    if (playing && !voteSessionActive && !tagVoteActive && voteEnabled && twitchChannel) {
      const rem = remainingSeconds();

      if (!voteTriggeredForSegment && rem > 0 && rem <= (voteAtSegSec | 0)) {
        voteTriggeredForSegment = true;

        const wAuto = clamp(Math.min(voteWindowSegSec | 0, voteAtSegBaseSec | 0), 5, 180);
        const leadAuto = clamp(voteLeadSegSec | 0, 0, 30);

        voteStartSequence(wAuto, leadAuto);
      }
    }

    // Fin del segmento => no saltar si hay votación/TagVote
    if (playing && remainingSeconds() <= 0) {
      if (voteSessionActive) voteFinish();
      else if (tagVoteActive) tagVoteFinish();
      else nextCam("timer");
    }

    postState({}, false);
  }

  // ───────────────────────── Boot ─────────────────────────
  function boot() {
    try { buildTagIndex(); } catch (_) {}

    setFit(P.fit);

    const hudCollapsed = boolFromLS([HUD_COLLAPSE_KEY, HUD_COLLAPSE_KEY_BASE], true);
    const hudHidden = boolFromLS([HUD_HIDE_KEY, HUD_HIDE_KEY_BASE], false);
    setHudCollapsed(hudCollapsed);
    setHudHidden(hudHidden);

    const saved = loadPlayerState();

    // Twitch channel: URL explícita > saved > bot cfg > default(owner)
    if (P.twitchExplicit) twitchChannel = P.twitch || "";
    else if (saved?.twitch) twitchChannel = String(saved.twitch || "").trim().replace(/^@/, "");
    else if (OWNER_MODE) twitchChannel = readBotCfgChannel() || OWNER_DEFAULT_TWITCH;
    else twitchChannel = P.twitch || "";

    // Aplica saved
    if (saved && typeof saved === "object") {
      if (saved.playing != null) playing = !!saved.playing;
      if (saved.mins != null) roundSeconds = clamp((saved.mins | 0), 1, 120) * 60;

      if (saved.autoskip != null) autoskip = !!saved.autoskip;
      if (saved.adfree != null) modeAdfree = !!saved.adfree;

      if (!P.ytCookiesExplicit) {
        if ((saved.v | 0) >= 3 && typeof saved.ytCookies === "boolean") ytCookiesEnabled = !!saved.ytCookies;
      }

      if (saved.health && typeof saved.health === "object") {
        if (saved.health.startTimeoutMs != null) startTimeoutMs = clamp(saved.health.startTimeoutMs | 0, 3000, 120000);
        if (saved.health.stallTimeoutMs != null) stallTimeoutMs = clamp(saved.health.stallTimeoutMs | 0, 4000, 120000);
        if (saved.health.maxStalls != null) maxStalls = clamp(saved.health.maxStalls | 0, 1, 8);
      }

      // vote
      if (!P.voteExplicit && saved.vote && typeof saved.vote === "object") voteEnabled = !!saved.vote.enabled;
      if (saved.vote && typeof saved.vote === "object") {
        if (saved.vote.overlay != null) voteOverlay = !!saved.vote.overlay;
        if (saved.vote.windowSec != null) voteWindowCfgSec = clamp(saved.vote.windowSec | 0, 5, 180);
        if (saved.vote.voteAtSec != null) voteAtCfgSec = clamp(saved.vote.voteAtSec | 0, 5, 600);
        if (saved.vote.leadSec != null) voteLeadCfgSec = clamp(saved.vote.leadSec | 0, 0, 30);
        if (saved.vote.uiSec != null) voteUiCfgSec = clamp(saved.vote.uiSec | 0, 0, 300) || (voteLeadCfgSec + voteWindowCfgSec);
        if (saved.vote.stayMins != null) stayMins = clamp(saved.vote.stayMins | 0, 1, 120);
        if (saved.vote.cmd != null) parseVoteCmds(String(saved.vote.cmd || ""));
      }

      // chat
      if (!P.chatExplicit && saved.chat && typeof saved.chat === "object") chatEnabled = !!saved.chat.enabled;
      if (saved.chat && typeof saved.chat === "object") {
        if (!P.chatHideExplicit && saved.chat.hideCommands != null) chatHideCommands = !!saved.chat.hideCommands;
        if (!P.chatMaxExplicit && saved.chat.max != null) chatMax = clamp(saved.chat.max | 0, 3, 12);
        if (!P.chatTtlExplicit && saved.chat.ttl != null) chatTtlSec = clamp(saved.chat.ttl | 0, 5, 30);
      }

      // ads
      if (!P.adsExplicit && saved.ads && typeof saved.ads === "object") adsEnabled = !!saved.ads.enabled;
      if (saved.ads && typeof saved.ads === "object") {
        if (saved.ads.adLead != null) adLeadDefaultSec = clamp(saved.ads.adLead | 0, 0, 300);
        if (saved.ads.showDuring != null) adShowDuring = !!saved.ads.showDuring;
        if (saved.ads.chatText != null) adChatText = String(saved.ads.chatText || "").trim();
      }

      // bgm
      if (saved.bgm && typeof saved.bgm === "object") {
        if (saved.bgm.enabled != null) bgmEnabled = !!saved.bgm.enabled;
        if (saved.bgm.vol != null) bgmSetVol(saved.bgm.vol);
        if (saved.bgm.idx != null) bgmIdx = (saved.bgm.idx | 0) || 0;
      }
    }

    if (!P.ytCookiesExplicit && (!saved || (saved.v | 0) < 3)) ytCookiesEnabled = true;
    if (!saved || !saved.bgm) bgmEnabled = true;

    applyFilters();

    if (saved?.curId) {
      const n = cams.findIndex(c => c && String(c.id) === String(saved.curId));
      if (n >= 0) idx = n;
    }

    // ✅ recalcula schedule (con semantics por remaining)
    recalcVoteScheduleForSegment(segmentSeconds | 0);

    if (chatEnabled) { ensureChatUI(); chatRoot?.classList?.add?.("chat--on"); }
    ensureAlertsUI();
    ensureIrc();

    // ✅ asegurar que voteBox esté oculto en boot, aunque CSS falle
    voteReset();
    tagVoteActive = false;
    tagVoteTags = [];
    tagVoteRender();

    if (bgmEnabled && bgmList.length) {
      const tryStart = () => {
        window.removeEventListener("pointerdown", tryStart);
        window.removeEventListener("keydown", tryStart);
        bgmPlay();
      };
      window.addEventListener("pointerdown", tryStart, { once: true });
      window.addEventListener("keydown", tryStart, { once: true });
      setTimeout(() => { bgmPlay(); }, 300);
    }

    playCam(cams[idx]);

    try {
      if (saved && typeof saved === "object" && saved.segmentSec != null && saved.remaining != null) {
        playing = !!saved.playing;
        startRoundWithRemaining(saved.segmentSec | 0, saved.remaining | 0);
      }
    } catch (_) {}

    try { if (tickTimer) clearInterval(tickTimer); } catch (_) {}
    tickTimer = setInterval(tick, 250);

    try { if (saveTimer) clearInterval(saveTimer); } catch (_) {}
    saveTimer = setInterval(savePlayerState, 3500);

    postState({ reason: "boot" }, true);

    readCmdFromStorage(CMD_KEY, true);
    readCmdFromStorage(CMD_KEY_LEGACY, false);
  }

  window.addEventListener("beforeunload", () => {
    try { savePlayerState(); } catch (_) {}
  });

  boot();
})();
