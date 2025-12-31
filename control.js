/* control.js — RLC Control v2.2.1
   ✅ Controla el Player por BroadcastChannel/localStorage
   ✅ Copia URL del stream con params correctos (voteUi, ads, alerts, chat, ticker, countdown...)
   ✅ Bot IRC (OAuth) configurable desde el panel (manda mensajes al chat)
   ✅ Bot NO se incluye en URL (seguridad)
   ✅ Events bridge Player -> Control (ads auto detectados => bot escribe)
   ✅ KEY namespace (BUS/CMD/STATE/EVT/BOT_STORE) + compat legacy
   ✅ BOT_SAY desde Player (cmd) => Control lo envía al chat (con anti-spam)
   ✅ Anuncio automático al chat cuando cambia la cámara (anti-spam)
   ✅ News Ticker cfg (storage + BC)
   ✅ NEW v2.2.1:
      - Auto Twitch Title (Helix) según cámara (título/lugar/fuente)
      - Countdown cfg (Fin de año) + BC/LS + URL params
*/
(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  // Guard anti doble carga
  const LOAD_GUARD = "__RLC_CONTROL_LOADED_V221";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  const BUS_BASE = "rlc_bus_v1";
  const CMD_KEY_BASE = "rlc_cmd_v1";
  const STATE_KEY_BASE = "rlc_state_v1";
  const EVT_KEY_BASE = "rlc_evt_v1";

  const BOT_STORE_KEY_BASE = "rlc_bot_cfg_v1";          // solo control.html
  const TICKER_CFG_KEY_BASE = "rlc_ticker_cfg_v1";      // player + control
  const HELIX_CFG_KEY_BASE  = "rlc_helix_cfg_v1";       // solo control.html
  const COUNTDOWN_CFG_KEY_BASE = "rlc_countdown_cfg_v1";// player + control

  const qs = (s) => document.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (v, fallback) => {
    const n = parseFloat(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  };

  function parseParams() {
    const u = new URL(location.href);
    return { key: (u.searchParams.get("key") || "").trim() };
  }
  const P = parseParams();
  const KEY = String(P.key || "").trim();

  // Namespaced (si hay key) + legacy (compat)
  const BUS = KEY ? `${BUS_BASE}:${KEY}` : BUS_BASE;
  const CMD_KEY = KEY ? `${CMD_KEY_BASE}:${KEY}` : CMD_KEY_BASE;
  const STATE_KEY = KEY ? `${STATE_KEY_BASE}:${KEY}` : STATE_KEY_BASE;
  const EVT_KEY = KEY ? `${EVT_KEY_BASE}:${KEY}` : EVT_KEY_BASE;

  const BUS_LEGACY = BUS_BASE;
  const CMD_KEY_LEGACY = CMD_KEY_BASE;
  const STATE_KEY_LEGACY = STATE_KEY_BASE;
  const EVT_KEY_LEGACY = EVT_KEY_BASE;

  const BOT_STORE_KEY = KEY ? `${BOT_STORE_KEY_BASE}:${KEY}` : BOT_STORE_KEY_BASE;
  const TICKER_CFG_KEY = KEY ? `${TICKER_CFG_KEY_BASE}:${KEY}` : TICKER_CFG_KEY_BASE;
  const TICKER_CFG_KEY_LEGACY = TICKER_CFG_KEY_BASE;

  const HELIX_CFG_KEY = KEY ? `${HELIX_CFG_KEY_BASE}:${KEY}` : HELIX_CFG_KEY_BASE;
  const HELIX_CFG_KEY_LEGACY = HELIX_CFG_KEY_BASE;

  const COUNTDOWN_CFG_KEY = KEY ? `${COUNTDOWN_CFG_KEY_BASE}:${KEY}` : COUNTDOWN_CFG_KEY_BASE;
  const COUNTDOWN_CFG_KEY_LEGACY = COUNTDOWN_CFG_KEY_BASE;

  const bcMain = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS) : null;
  const bcLegacy = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_LEGACY) : null;

  // ───────────────────────── UI ─────────────────────────
  const ctlStatus = qs("#ctlStatus");
  const ctlNowTitle = qs("#ctlNowTitle");
  const ctlNowPlace = qs("#ctlNowPlace");
  const ctlNowTimer = qs("#ctlNowTimer");
  const ctlOrigin = qs("#ctlOrigin");

  const ctlPrev = qs("#ctlPrev");
  const ctlPlay = qs("#ctlPlay");
  const ctlNext = qs("#ctlNext");
  const ctlShuffle = qs("#ctlShuffle");

  const ctlMins = qs("#ctlMins");
  const ctlApplyMins = qs("#ctlApplyMins");
  const ctlFit = qs("#ctlFit");
  const ctlHud = qs("#ctlHud");
  const ctlHudDetails = qs("#ctlHudDetails");
  const ctlAutoskip = qs("#ctlAutoskip");
  const ctlAdfree = qs("#ctlAdfree");
  const ctlReset = qs("#ctlReset");

  const ctlSearch = qs("#ctlSearch");
  const ctlSelect = qs("#ctlSelect");
  const ctlGo = qs("#ctlGo");
  const ctlBan = qs("#ctlBan");

  const ctlPreviewOn = qs("#ctlPreviewOn");
  const ctlPreviewWrap = qs("#ctlPreviewWrap");
  const ctlPreview = qs("#ctlPreview");

  const ctlCopyStreamUrl = qs("#ctlCopyStreamUrl");

  // BGM
  const ctlBgmOn = qs("#ctlBgmOn");
  const ctlBgmVol = qs("#ctlBgmVol");
  const ctlBgmTrack = qs("#ctlBgmTrack");
  const ctlBgmPrev = qs("#ctlBgmPrev");
  const ctlBgmPlay = qs("#ctlBgmPlay");
  const ctlBgmNext = qs("#ctlBgmNext");
  const ctlBgmShuffle = qs("#ctlBgmShuffle");
  const ctlBgmNow = qs("#ctlBgmNow");

  // Twitch vote
  const ctlTwitchChannel = qs("#ctlTwitchChannel");
  const ctlVoteOn = qs("#ctlVoteOn");
  const ctlVoteOverlay = qs("#ctlVoteOverlay");
  const ctlVoteWindow = qs("#ctlVoteWindow");
  const ctlVoteAt = qs("#ctlVoteAt");
  const ctlVoteLead = qs("#ctlVoteLead");
  const ctlVoteCmd = qs("#ctlVoteCmd");
  const ctlVoteStart = qs("#ctlVoteStart");
  const ctlVoteApply = qs("#ctlVoteApply");

  const ctlStayMins = qs("#ctlStayMins");
  const ctlYtCookies = qs("#ctlYtCookies");

  // Chat/Alerts
  const ctlChatOn = qs("#ctlChatOn");
  const ctlChatHideCmd = qs("#ctlChatHideCmd");
  const ctlAlertsOn = qs("#ctlAlertsOn");

  // ADS (player overlay)
  const ctlAdsOn = qs("#ctlAdsOn");
  const ctlAdLead = qs("#ctlAdLead");
  const ctlAdDur = qs("#ctlAdDur");
  const ctlAdShowDuring = qs("#ctlAdShowDuring");
  const ctlAdChatText = qs("#ctlAdChatText");

  const ctlAdNoticeBtn = qs("#ctlAdNoticeBtn");
  const ctlAdBeginBtn = qs("#ctlAdBeginBtn");
  const ctlAdClearBtn = qs("#ctlAdClearBtn");

  // BOT (control->twitch chat)
  const ctlBotOn = qs("#ctlBotOn");
  const ctlBotUser = qs("#ctlBotUser");
  const ctlBotToken = qs("#ctlBotToken");
  const ctlBotConnect = qs("#ctlBotConnect");
  const ctlBotStatus = qs("#ctlBotStatus");
  const ctlBotSayOnAd = qs("#ctlBotSayOnAd");
  const ctlBotTestText = qs("#ctlBotTestText");
  const ctlBotTestSend = qs("#ctlBotTestSend");

  // NEWS Ticker
  const ctlTickerOn = qs("#ctlTickerOn");
  const ctlTickerLang = qs("#ctlTickerLang");
  const ctlTickerSpeed = qs("#ctlTickerSpeed");
  const ctlTickerRefresh = qs("#ctlTickerRefresh");
  const ctlTickerTop = qs("#ctlTickerTop");
  const ctlTickerHideOnVote = qs("#ctlTickerHideOnVote");
  const ctlTickerSpan = qs("#ctlTickerSpan"); // opcional
  const ctlTickerApply = qs("#ctlTickerApply");
  const ctlTickerReset = qs("#ctlTickerReset");
  const ctlTickerStatus = qs("#ctlTickerStatus");
  const ctlTickerCopyUrl = qs("#ctlTickerCopyUrl");

  // HELIX Auto Title (NEW)
  const ctlHelixOn = qs("#ctlHelixOn");
  const ctlHelixClientId = qs("#ctlHelixClientId");
  const ctlHelixToken = qs("#ctlHelixToken");
  const ctlHelixTpl = qs("#ctlHelixTpl");
  const ctlHelixCooldown = qs("#ctlHelixCooldown");
  const ctlHelixApply = qs("#ctlHelixApply");
  const ctlHelixTest = qs("#ctlHelixTest");
  const ctlHelixStatus = qs("#ctlHelixStatus");

  // COUNTDOWN (NEW)
  const ctlCountdownOn = qs("#ctlCountdownOn");
  const ctlCountdownLabel = qs("#ctlCountdownLabel");
  const ctlCountdownTarget = qs("#ctlCountdownTarget");
  const ctlCountdownApply = qs("#ctlCountdownApply");
  const ctlCountdownReset = qs("#ctlCountdownReset");
  const ctlCountdownStatus = qs("#ctlCountdownStatus");

  // footer
  const ctlBusName = qs("#ctlBusName");

  // Data
  const allCams = Array.isArray(g.CAM_LIST) ? g.CAM_LIST.slice() : [];
  const bgmList = Array.isArray(g.BGM_LIST) ? g.BGM_LIST.slice() : [];
  let lastState = null;
  let lastSeenAt = 0;

  // eventos / spam guards
  let lastEventTs = 0;

  // Bot say guards
  let lastBotSayAt = 0;
  let lastBotSaySig = "";
  function sigOf(s) { return String(s || "").trim().slice(0, 180); }

  // Auto announce cam
  let lastAnnouncedCamId = "";
  let lastAnnounceAt = 0;

  function fmtMMSS(sec) {
    sec = Math.max(0, sec | 0);
    const m = (sec / 60) | 0;
    const s = sec - m * 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function keyOk(msg, isMainChannel) {
    if (!KEY) return true;
    // En canal main (namespaced) aceptamos aunque no venga key en msg
    if (isMainChannel) return true;
    // En legacy exige key para evitar cross-talk
    return (msg && msg.key === KEY);
  }

  function busPost(msg) {
    try { if (bcMain) bcMain.postMessage(msg); } catch (_) {}
    try { if (bcLegacy) bcLegacy.postMessage(msg); } catch (_) {}
  }

  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (_) {} }

  function sendCmd(cmd, payload = {}) {
    const msg = { type: "cmd", ts: Date.now(), cmd, payload: payload || {} };
    if (KEY) msg.key = KEY;

    const raw = JSON.stringify(msg);

    // Escribe en ambos (namespaced + legacy) para compat
    lsSet(CMD_KEY, raw);
    lsSet(CMD_KEY_LEGACY, raw);

    busPost(msg);
  }

  function setStatus(text, ok = true) {
    if (!ctlStatus) return;
    ctlStatus.textContent = text;
    ctlStatus.classList.toggle("pill--ok", !!ok);
    ctlStatus.classList.toggle("pill--bad", !ok);
  }

  function setBotStatus(text, ok = true) {
    if (!ctlBotStatus) return;
    ctlBotStatus.textContent = text;
    ctlBotStatus.classList.toggle("pill--ok", !!ok);
    ctlBotStatus.classList.toggle("pill--bad", !ok);
  }

  function setHelixStatus(text, ok = true) {
    if (!ctlHelixStatus) return;
    ctlHelixStatus.textContent = text;
    ctlHelixStatus.classList.toggle("pill--ok", !!ok);
    ctlHelixStatus.classList.toggle("pill--bad", !ok);
  }

  function setTickerStatusFromCfg(cfg) {
    if (!ctlTickerStatus) return;
    const on = !!cfg?.enabled;
    ctlTickerStatus.textContent = on ? "Ticker: ON" : "Ticker: OFF";
    ctlTickerStatus.classList.toggle("pill--ok", on);
    ctlTickerStatus.classList.toggle("pill--bad", !on);
  }

  function setCountdownStatusFromCfg(cfg) {
    if (!ctlCountdownStatus) return;
    const on = !!cfg?.enabled;
    ctlCountdownStatus.textContent = on ? "Cuenta atrás: ON" : "Cuenta atrás: OFF";
    ctlCountdownStatus.classList.toggle("pill--ok", on);
    ctlCountdownStatus.classList.toggle("pill--bad", !on);
  }

  function label(cam) {
    const t = cam?.title || "Live Cam";
    const p = cam?.place || "";
    return p ? `${t} — ${p}` : t;
  }

  function syncList(filter = "") {
    if (!ctlSelect) return;
    const f = String(filter || "").trim().toLowerCase();

    ctlSelect.innerHTML = "";
    for (const cam of allCams) {
      const hay = `${cam?.title || ""} ${cam?.place || ""} ${cam?.source || ""}`.toLowerCase();
      if (f && !hay.includes(f)) continue;
      const opt = document.createElement("option");
      opt.value = cam.id;
      opt.textContent = label(cam);
      ctlSelect.appendChild(opt);
    }
  }

  function syncBgmTracks() {
    if (!ctlBgmTrack) return;
    ctlBgmTrack.innerHTML = "";
    if (!bgmList.length) {
      const opt = document.createElement("option");
      opt.value = "0";
      opt.textContent = "— (sin playlist)";
      ctlBgmTrack.appendChild(opt);
      return;
    }
    for (let i = 0; i < bgmList.length; i++) {
      const t = bgmList[i];
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = t?.title ? t.title : `Track ${i + 1}`;
      ctlBgmTrack.appendChild(opt);
    }
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        return true;
      } catch (_) { return false; }
    }
  }

  // ✅ evita que applyState te “pise” mientras editas
  function isEditing(el) {
    if (!el) return false;
    try { return document.activeElement === el || el.matches(":focus"); }
    catch (_) { return document.activeElement === el; }
  }
  function safeSetValue(el, v) {
    if (!el) return;
    if (isEditing(el)) return;
    el.value = String(v);
  }

  // ───────────────────────── Vote timing FIX (NO early UI) ─────────────────────────
  function getTotalCamSecFallback() {
    // Preferimos el mins real del estado si existe
    const minsFromState = (lastState && typeof lastState.mins === "number") ? lastState.mins : null;
    const minsFromUi = parseInt(ctlMins?.value || "", 10);
    const mins = Number.isFinite(minsFromState) ? minsFromState
      : Number.isFinite(minsFromUi) ? minsFromUi
      : 5;
    return clamp((mins | 0) * 60, 60, 120 * 60);
  }

  function computeVoteTiming() {
    const totalSec = getTotalCamSecFallback();
    const voteAtSec = clamp(parseInt(ctlVoteAt?.value || "60", 10) || 60, 5, totalSec);

    // window/lead no pueden “sobrepasar” voteAtSec
    const windowWanted = clamp(parseInt(ctlVoteWindow?.value || "60", 10) || 60, 5, 180);
    const leadWanted = clamp(parseInt(ctlVoteLead?.value || "0", 10) || 0, 0, 30);

    const leadSec = clamp(leadWanted, 0, Math.max(0, voteAtSec - 1));
    const windowSec = clamp(windowWanted, 1, voteAtSec);

    // UI nunca puede durar más que “hasta votar”
    const uiSec = clamp(Math.min(windowSec + leadSec, voteAtSec), 1, 999999);

    return { totalSec, voteAtSec, windowSec, leadSec, uiSec };
  }

  // ───────────────────────── NEWS TICKER (CFG + BC + URL PARAMS) ─────────────────────────
  const TICKER_DEFAULTS = {
    enabled: true,
    lang: "auto",         // auto|es|en
    speedPxPerSec: 55,    // 20..140
    refreshMins: 12,      // 3..60
    topPx: 10,            // 0..120
    hideOnVote: true,
    timespan: "1d"        // opcional
  };

  function normalizeTickerCfg(inCfg) {
    const c = Object.assign({}, TICKER_DEFAULTS, (inCfg || {}));
    c.enabled = (c.enabled !== false);
    c.lang = (c.lang === "es" || c.lang === "en" || c.lang === "auto") ? c.lang : "auto";
    c.speedPxPerSec = clamp(num(c.speedPxPerSec, TICKER_DEFAULTS.speedPxPerSec), 20, 140);
    c.refreshMins = clamp(num(c.refreshMins, TICKER_DEFAULTS.refreshMins), 3, 60);
    c.topPx = clamp(num(c.topPx, TICKER_DEFAULTS.topPx), 0, 120);
    c.hideOnVote = (c.hideOnVote !== false);

    c.timespan = String(c.timespan || TICKER_DEFAULTS.timespan).trim().toLowerCase();
    if (!/^\d+(min|h|d|w|m)$/.test(c.timespan)) c.timespan = TICKER_DEFAULTS.timespan;

    return c;
  }

  function loadTickerCfg() {
    // prioridad: keyed -> base
    try {
      const rawKeyed = lsGet(TICKER_CFG_KEY);
      if (rawKeyed) return normalizeTickerCfg(JSON.parse(rawKeyed));
    } catch (_) {}
    try {
      const rawBase = lsGet(TICKER_CFG_KEY_BASE);
      if (rawBase) return normalizeTickerCfg(JSON.parse(rawBase));
    } catch (_) {}
    return normalizeTickerCfg(TICKER_DEFAULTS);
  }

  function saveTickerCfg(cfg) {
    const c = normalizeTickerCfg(cfg);
    const raw = JSON.stringify(c);

    // guardamos en keyed + base
    lsSet(TICKER_CFG_KEY, raw);
    lsSet(TICKER_CFG_KEY_BASE, raw);
    lsSet(TICKER_CFG_KEY_LEGACY, raw);

    return c;
  }

  function sendTickerCfg(cfg, persist = true) {
    const c = persist ? saveTickerCfg(cfg) : normalizeTickerCfg(cfg);
    const msg = { type: "TICKER_CFG", ts: Date.now(), cfg: c };
    if (KEY) msg.key = KEY;
    busPost(msg);
    return c;
  }

  let tickerCfg = loadTickerCfg();

  function syncTickerUIFromStore() {
    tickerCfg = loadTickerCfg();

    if (ctlTickerOn) ctlTickerOn.value = tickerCfg.enabled ? "on" : "off";
    if (ctlTickerLang) ctlTickerLang.value = tickerCfg.lang || "auto";
    if (ctlTickerSpeed) ctlTickerSpeed.value = String(tickerCfg.speedPxPerSec ?? 55);
    if (ctlTickerRefresh) ctlTickerRefresh.value = String(tickerCfg.refreshMins ?? 12);
    if (ctlTickerTop) ctlTickerTop.value = String(tickerCfg.topPx ?? 10);
    if (ctlTickerHideOnVote) ctlTickerHideOnVote.value = tickerCfg.hideOnVote ? "on" : "off";
    if (ctlTickerSpan) ctlTickerSpan.value = String(tickerCfg.timespan || "1d");

    setTickerStatusFromCfg(tickerCfg);
  }

  function readTickerUI() {
    const base = tickerCfg || loadTickerCfg();

    const enabled = ctlTickerOn ? (ctlTickerOn.value !== "off") : base.enabled;
    const lang = ctlTickerLang ? (ctlTickerLang.value || base.lang || "auto") : (base.lang || "auto");

    const speedPxPerSec = ctlTickerSpeed
      ? clamp(parseInt(ctlTickerSpeed.value || String(base.speedPxPerSec || 55), 10) || 55, 20, 140)
      : (base.speedPxPerSec || 55);

    const refreshMins = ctlTickerRefresh
      ? clamp(parseInt(ctlTickerRefresh.value || String(base.refreshMins || 12), 10) || 12, 3, 60)
      : (base.refreshMins || 12);

    const topPx = ctlTickerTop
      ? clamp(parseInt(ctlTickerTop.value || String(base.topPx || 10), 10) || 10, 0, 120)
      : (base.topPx || 10);

    const hideOnVote = ctlTickerHideOnVote ? (ctlTickerHideOnVote.value !== "off") : base.hideOnVote;
    const timespan = ctlTickerSpan ? (ctlTickerSpan.value || base.timespan || "1d") : (base.timespan || "1d");

    return normalizeTickerCfg({ enabled, lang, speedPxPerSec, refreshMins, topPx, hideOnVote, timespan });
  }

  // ───────────────────────── COUNTDOWN (CFG + BC + URL PARAMS) ─────────────────────────
  const COUNTDOWN_DEFAULTS = {
    enabled: false,
    label: "Fin de año",
    targetMs: 0
  };

  function nextNewYearTargetMs() {
    try {
      const now = new Date();
      const y = now.getFullYear() + 1;
      const d = new Date(y, 0, 1, 0, 0, 0, 0); // local tz
      return d.getTime();
    } catch (_) { return 0; }
  }

  function normalizeCountdownCfg(inCfg) {
    const c = Object.assign({}, COUNTDOWN_DEFAULTS, (inCfg || {}));
    c.enabled = (c.enabled === true);

    c.label = String(c.label || COUNTDOWN_DEFAULTS.label).trim().slice(0, 60) || COUNTDOWN_DEFAULTS.label;

    const t = (typeof c.targetMs === "number") ? c.targetMs : parseInt(String(c.targetMs || "0"), 10);
    c.targetMs = Number.isFinite(t) ? Math.max(0, t) : 0;

    // Si no viene target, sugerimos el próximo 1 de enero
    if (!c.targetMs) c.targetMs = nextNewYearTargetMs();

    return c;
  }

  function loadCountdownCfg() {
    try {
      const rawKeyed = lsGet(COUNTDOWN_CFG_KEY);
      if (rawKeyed) return normalizeCountdownCfg(JSON.parse(rawKeyed));
    } catch (_) {}
    try {
      const rawBase = lsGet(COUNTDOWN_CFG_KEY_BASE);
      if (rawBase) return normalizeCountdownCfg(JSON.parse(rawBase));
    } catch (_) {}
    return normalizeCountdownCfg(COUNTDOWN_DEFAULTS);
  }

  function saveCountdownCfg(cfg) {
    const c = normalizeCountdownCfg(cfg);
    const raw = JSON.stringify(c);

    lsSet(COUNTDOWN_CFG_KEY, raw);
    lsSet(COUNTDOWN_CFG_KEY_BASE, raw);
    lsSet(COUNTDOWN_CFG_KEY_LEGACY, raw);

    return c;
  }

  function sendCountdownCfg(cfg, persist = true) {
    const c = persist ? saveCountdownCfg(cfg) : normalizeCountdownCfg(cfg);

    // Mensaje “suave” para módulos (player)
    const msg = { type: "COUNTDOWN_CFG", ts: Date.now(), cfg: c };
    if (KEY) msg.key = KEY;
    busPost(msg);

    // También como cmd (si el player lo implementa)
    sendCmd("COUNTDOWN_SET", c);

    return c;
  }

  let countdownCfg = loadCountdownCfg();

  function syncCountdownUIFromStore() {
    countdownCfg = loadCountdownCfg();

    if (ctlCountdownOn) ctlCountdownOn.value = countdownCfg.enabled ? "on" : "off";
    if (ctlCountdownLabel) ctlCountdownLabel.value = String(countdownCfg.label || "Fin de año");

    // datetime-local espera "YYYY-MM-DDTHH:MM"
    if (ctlCountdownTarget) {
      const ms = countdownCfg.targetMs || nextNewYearTargetMs();
      const d = new Date(ms);
      const pad = (n) => String(n).padStart(2, "0");
      const v = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      if (!ctlCountdownTarget.value || !isEditing(ctlCountdownTarget)) ctlCountdownTarget.value = v;
    }

    setCountdownStatusFromCfg(countdownCfg);
  }

  function readCountdownUI() {
    const base = countdownCfg || loadCountdownCfg();

    const enabled = ctlCountdownOn ? (ctlCountdownOn.value !== "off") : base.enabled;
    const label = ctlCountdownLabel ? String(ctlCountdownLabel.value || base.label || "Fin de año").trim() : (base.label || "Fin de año");

    let targetMs = base.targetMs || nextNewYearTargetMs();
    if (ctlCountdownTarget && ctlCountdownTarget.value) {
      const d = new Date(ctlCountdownTarget.value);
      const ms = d.getTime();
      if (Number.isFinite(ms) && ms > 0) targetMs = ms;
    }

    return normalizeCountdownCfg({ enabled, label, targetMs });
  }

  // ───────────────────────── HELIX AUTO TITLE (CFG + API) ─────────────────────────
  const HELIX_DEFAULTS = {
    enabled: false,
    clientId: "",
    token: "",
    template: "🌍 {place} — {title}",
    cooldownSec: 20
  };

  function normalizeHelixCfg(inCfg) {
    const c = Object.assign({}, HELIX_DEFAULTS, (inCfg || {}));
    c.enabled = (c.enabled === true);
    c.clientId = String(c.clientId || "").trim();
    c.token = String(c.token || "").trim();
    c.template = String(c.template || HELIX_DEFAULTS.template).trim().slice(0, 200) || HELIX_DEFAULTS.template;
    c.cooldownSec = clamp(parseInt(String(c.cooldownSec || HELIX_DEFAULTS.cooldownSec), 10) || HELIX_DEFAULTS.cooldownSec, 10, 180);
    return c;
  }

  function loadHelixCfg() {
    try {
      const rawKeyed = lsGet(HELIX_CFG_KEY);
      if (rawKeyed) return normalizeHelixCfg(JSON.parse(rawKeyed));
    } catch (_) {}
    try {
      const rawBase = lsGet(HELIX_CFG_KEY_BASE);
      if (rawBase) return normalizeHelixCfg(JSON.parse(rawBase));
    } catch (_) {}
    return normalizeHelixCfg(HELIX_DEFAULTS);
  }

  function saveHelixCfg(cfg) {
    const c = normalizeHelixCfg(cfg);
    const raw = JSON.stringify(c);

    lsSet(HELIX_CFG_KEY, raw);
    lsSet(HELIX_CFG_KEY_BASE, raw);
    lsSet(HELIX_CFG_KEY_LEGACY, raw);

    return c;
  }

  let helixCfg = loadHelixCfg();

  function syncHelixUIFromStore() {
    helixCfg = loadHelixCfg();

    if (ctlHelixOn) ctlHelixOn.value = helixCfg.enabled ? "on" : "off";
    if (ctlHelixClientId) ctlHelixClientId.value = helixCfg.clientId || "";
    if (ctlHelixToken) ctlHelixToken.value = helixCfg.token || "";
    if (ctlHelixTpl) ctlHelixTpl.value = helixCfg.template || HELIX_DEFAULTS.template;
    if (ctlHelixCooldown) ctlHelixCooldown.value = String(helixCfg.cooldownSec || 20);

    setHelixStatus(helixCfg.enabled ? "Auto título: ON" : "Auto título: OFF", !!helixCfg.enabled);
  }

  function readHelixUI() {
    const base = helixCfg || loadHelixCfg();

    const enabled = ctlHelixOn ? (ctlHelixOn.value !== "off") : base.enabled;
    const clientId = ctlHelixClientId ? String(ctlHelixClientId.value || base.clientId || "").trim() : String(base.clientId || "").trim();
    const token = ctlHelixToken ? String(ctlHelixToken.value || base.token || "").trim() : String(base.token || "").trim();
    const template = ctlHelixTpl ? String(ctlHelixTpl.value || base.template || HELIX_DEFAULTS.template).trim() : String(base.template || HELIX_DEFAULTS.template).trim();

    const cooldownSec = ctlHelixCooldown
      ? clamp(parseInt(String(ctlHelixCooldown.value || base.cooldownSec || 20), 10) || 20, 10, 180)
      : (base.cooldownSec || 20);

    return normalizeHelixCfg({ enabled, clientId, token, template, cooldownSec });
  }

  function buildTitleFromState(st, template) {
    const cam = st?.cam || {};
    const t = String(cam?.title || "Live Cam").trim();
    const p = String(cam?.place || "").trim();
    const s = String(cam?.source || "").trim();

    const repl = (k) => {
      const kk = String(k || "").toLowerCase();
      if (kk === "title") return t;
      if (kk === "place") return p;
      if (kk === "source") return s;
      if (kk === "label") return p ? `${t} — ${p}` : t;
      return "";
    };

    let out = String(template || HELIX_DEFAULTS.template);

    // {place} {title} {source} {label}
    out = out.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, k) => repl(k));

    // Limpieza final
    out = out.replace(/\s+/g, " ").trim();
    out = out.replace(/[^\S\r\n]+/g, " ").replace(/[\r\n]+/g, " ").trim();

    // Si queda vacío, fallback
    if (!out) out = p ? `${t} — ${p}` : t;

    // Twitch title: no vacío; clamp seguro
    if (out.length > 140) out = out.slice(0, 140).trim();

    return out;
  }

  async function helixFetch(path, { method = "GET", clientId, token, body = null, timeoutMs = 12000 } = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(`https://api.twitch.tv/helix/${path}`, {
        method,
        signal: ctrl.signal,
        headers: {
          "Client-Id": clientId,
          "Authorization": `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {})
        },
        body: body ? JSON.stringify(body) : null
      });

      if (!r.ok) {
        let extra = "";
        try { extra = await r.text(); } catch (_) {}
        throw new Error(`Helix HTTP ${r.status}${extra ? ` — ${extra.slice(0, 180)}` : ""}`);
      }

      // PATCH /channels suele devolver 204 no content
      if (r.status === 204) return { ok: true, data: null };
      const data = await r.json().catch(() => null);
      return { ok: true, data };
    } finally {
      clearTimeout(t);
    }
  }

  async function helixGetBroadcasterId(login, clientId, token) {
    const ch = String(login || "").trim().replace(/^@/, "").toLowerCase();
    if (!ch) return "";

    const res = await helixFetch(`users?login=${encodeURIComponent(ch)}`, { method: "GET", clientId, token });
    const user = Array.isArray(res?.data?.data) ? res.data.data[0] : null;
    const id = String(user?.id || "").trim();
    return id;
  }

  async function helixSetTitle(broadcasterId, title, clientId, token) {
    const bid = String(broadcasterId || "").trim();
    const ttl = String(title || "").trim();
    if (!bid || !ttl) throw new Error("broadcasterId/title vacío");

    await helixFetch(`channels?broadcaster_id=${encodeURIComponent(bid)}`, {
      method: "PATCH",
      clientId,
      token,
      body: { title: ttl }
    });
    return true;
  }

  let helixBroadcasterId = "";
  let helixLastUpdateAt = 0;
  let helixLastSig = "";

  async function maybeAutoUpdateTwitchTitleFromState(st, force = false) {
    const cfg = helixCfg || loadHelixCfg();
    const enabled = !!cfg.enabled && (ctlHelixOn ? (ctlHelixOn.value === "on") : true);
    if (!enabled) return;

    const channel = String(ctlTwitchChannel?.value || "").trim().replace(/^@/, "");
    if (!channel) { setHelixStatus("Auto título: falta canal", false); return; }

    const clientId = String(cfg.clientId || "").trim();
    const token = String(cfg.token || "").trim();
    if (!clientId || !token) { setHelixStatus("Auto título: falta ClientId/Token", false); return; }

    const title = buildTitleFromState(st, cfg.template);
    if (!title) return;

    const sig = `${channel}|${title}`;
    const now = Date.now();
    const cool = (cfg.cooldownSec | 0) * 1000;

    if (!force) {
      if (sig === helixLastSig) return;
      if ((now - helixLastUpdateAt) < cool) return;
    }

    try {
      setHelixStatus("Actualizando título…", true);

      if (!helixBroadcasterId) {
        helixBroadcasterId = await helixGetBroadcasterId(channel, clientId, token);
        if (!helixBroadcasterId) {
          setHelixStatus("Helix: no puedo resolver broadcaster_id", false);
          return;
        }
      }

      await helixSetTitle(helixBroadcasterId, title, clientId, token);

      helixLastUpdateAt = now;
      helixLastSig = sig;

      setHelixStatus(`Título OK: “${title.slice(0, 46)}${title.length > 46 ? "…" : ""}”`, true);
    } catch (e) {
      const msg = String(e?.message || e || "Error").slice(0, 120);
      setHelixStatus(`Helix error: ${msg}`, false);

      // Si falla por credenciales, “reseteamos” id por si cambió canal/token
      helixBroadcasterId = "";
    }
  }

  // ───────────────────────── BOT IRC (AUTH) ─────────────────────────
  class TwitchAuthIRC {
    constructor(getCfg, onStatus) {
      this.getCfg = getCfg;
      this.onStatus = onStatus || (() => {});
      this.ws = null;
      this.closed = true;
      this.connected = false;
      this.joinedChan = "";
      this.backoff = 900;
      this.timer = null;
      this.queue = [];
    }

    _set(ok, msg) {
      this.connected = !!ok;
      try { this.onStatus(msg, !!ok); } catch (_) {}
    }

    _normalizeToken(tok) {
      const t = String(tok || "").trim();
      if (!t) return "";
      return t.startsWith("oauth:") ? t : ("oauth:" + t);
    }

    connect() {
      const cfg = this.getCfg();
      if (!cfg || !cfg.on) { this.close(); this._set(false, "Bot OFF"); return; }

      const user = String(cfg.user || "").trim();
      const token = this._normalizeToken(cfg.token);
      const chan = String(cfg.channel || "").trim().replace(/^#/, "").replace(/^@/, "").toLowerCase();

      if (!user || !token || !chan) {
        this._set(false, "Falta user/token/canal");
        return;
      }

      this.closed = false;
      this._set(false, "Conectando…");

      try { this.ws?.close?.(); } catch (_) {}
      this.ws = null;

      let ws;
      try { ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443"); }
      catch (_) { this._set(false, "WebSocket no disponible"); return; }

      this.ws = ws;

      ws.onopen = () => {
        this.backoff = 900;
        this.joinedChan = "";
        this._set(true, "Conectado (auth)");

        ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands\r\n");
        ws.send(`PASS ${token}\r\n`);
        ws.send(`NICK ${user}\r\n`);
        ws.send(`JOIN #${chan}\r\n`);
      };

      ws.onmessage = (ev) => {
        const text = String(ev.data || "");
        const lines = text.split("\r\n").filter(Boolean);
        for (const line of lines) this._handleLine(line);
      };

      ws.onclose = () => {
        this.connected = false;
        if (this.closed) { this._set(false, "Desconectado"); return; }
        this._set(false, "Reconectando…");
        this._scheduleReconnect();
      };

      ws.onerror = () => {};
    }

    _scheduleReconnect() {
      try { if (this.timer) clearTimeout(this.timer); } catch (_) {}
      const wait = clamp(this.backoff | 0, 900, 12000);
      this.backoff = Math.min(12000, (this.backoff * 1.5) | 0);
      this.timer = setTimeout(() => {
        if (this.closed) return;
        this.connect();
      }, wait);
    }

    _handleLine(line) {
      if (!line) return;
      if (line.startsWith("PING")) {
        try { this.ws?.send?.("PONG :tmi.twitch.tv\r\n"); } catch (_) {}
        return;
      }

      const mJoin = line.match(/ JOIN #([a-z0-9_]+)/i);
      if (mJoin) {
        this.joinedChan = (mJoin[1] || "").toLowerCase();
        this._flush();
        return;
      }

      if (line.includes("Login authentication failed")) {
        this._set(false, "Auth fallida (token?)");
        this.close();
      }
    }

    close() {
      this.closed = true;
      this.connected = false;
      try { if (this.timer) clearTimeout(this.timer); } catch (_) {}
      this.timer = null;
      try { this.ws?.close?.(); } catch (_) {}
      this.ws = null;
      this.queue = [];
      this.joinedChan = "";
    }

    _flush() {
      if (!this.ws || this.ws.readyState !== 1) return;
      if (!this.joinedChan) return;
      const max = 10;
      let n = 0;
      while (this.queue.length && n < max) {
        const it = this.queue.shift();
        try { this.ws.send(it); } catch (_) {}
        n++;
      }
    }

    say(message, channel) {
      const cfg = this.getCfg();
      const chan = String(channel || cfg.channel || "").trim().replace(/^#/, "").replace(/^@/, "").toLowerCase();
      const msg = String(message || "").trim();
      if (!cfg || !cfg.on) return false;
      if (!chan || !msg) return false;

      const line = `PRIVMSG #${chan} :${msg}\r\n`;

      if (this.ws && this.ws.readyState === 1 && this.joinedChan) {
        try { this.ws.send(line); return true; } catch (_) { return false; }
      }

      this.queue.push(line);
      if (!this.ws || this.ws.readyState > 1) this.connect();
      return true;
    }
  }

  function loadJsonFirst(keys, fallbackVal = null) {
    for (const k of keys) {
      try {
        const raw = lsGet(k);
        if (!raw) continue;
        return JSON.parse(raw);
      } catch (_) {}
    }
    return fallbackVal;
  }

  function loadBotCfg() {
    try {
      const o = loadJsonFirst([BOT_STORE_KEY, BOT_STORE_KEY_BASE], null);
      if (!o || typeof o !== "object") return { on: false, user: "", token: "", sayOnAd: true };
      const cfg = {
        on: !!o.on,
        user: String(o.user || ""),
        token: String(o.token || ""),
        sayOnAd: (typeof o.sayOnAd === "boolean") ? o.sayOnAd : true
      };
      // migra si venía de legacy y estamos en keyed
      try {
        if (KEY && !lsGet(BOT_STORE_KEY) && lsGet(BOT_STORE_KEY_BASE)) {
          lsSet(BOT_STORE_KEY, JSON.stringify(cfg));
        }
      } catch (_) {}
      return cfg;
    } catch (_) {
      return { on: false, user: "", token: "", sayOnAd: true };
    }
  }

  function saveBotCfg(cfg) {
    try {
      const raw = JSON.stringify(cfg || {});
      lsSet(BOT_STORE_KEY, raw);
      lsSet(BOT_STORE_KEY_BASE, raw); // compat
    } catch (_) {}
  }

  let botCfg = loadBotCfg();

  const bot = new TwitchAuthIRC(
    () => ({
      on: !!(ctlBotOn?.value === "on"),
      user: (ctlBotUser?.value || botCfg.user || "").trim(),
      token: (ctlBotToken?.value || botCfg.token || "").trim(),
      channel: (ctlTwitchChannel?.value || "").trim().replace(/^@/, "")
    }),
    (msg, ok) => setBotStatus(msg, ok)
  );

  function syncBotUIFromStore() {
    if (ctlBotOn) ctlBotOn.value = botCfg.on ? "on" : "off";
    if (ctlBotUser) ctlBotUser.value = botCfg.user || "";
    if (ctlBotToken) ctlBotToken.value = botCfg.token || "";
    if (ctlBotSayOnAd) ctlBotSayOnAd.value = (botCfg.sayOnAd !== false) ? "on" : "off";
    setBotStatus(botCfg.on ? "Bot listo" : "Bot OFF", !!botCfg.on);
  }

  function persistBotUIToStore() {
    botCfg = {
      on: !!(ctlBotOn?.value === "on"),
      user: String(ctlBotUser?.value || "").trim(),
      token: String(ctlBotToken?.value || "").trim(),
      sayOnAd: !!(ctlBotSayOnAd?.value !== "off")
    };
    saveBotCfg(botCfg);
  }

  function botSayIfEnabled(text) {
    const botOn = (ctlBotOn?.value === "on");
    const sayOnAd = (ctlBotSayOnAd?.value !== "off");
    if (!botOn || !sayOnAd) return false;

    const ch = (ctlTwitchChannel?.value || "").trim().replace(/^@/, "");
    if (!ch) return false;

    const msg = String(text || "").trim();
    if (!msg) return false;

    const now = Date.now();
    const s = sigOf(msg);
    // anti spam: 1.2s + no repetir la misma línea
    if ((now - lastBotSayAt) < 1200) return false;
    if (s && s === lastBotSaySig && (now - lastBotSayAt) < 12000) return false;

    lastBotSayAt = now;
    lastBotSaySig = s;

    return bot.say(msg, ch);
  }

  // ✅ URL del stream (index.html) desde el panel
  function streamUrlFromHere() {
    const u = new URL(location.href);
    u.pathname = u.pathname.replace(/control\.html$/i, "index.html");

    const minsVal = clamp(parseInt(ctlMins?.value || "5", 10) || 5, 1, 120);
    u.searchParams.set("mins", String(minsVal));
    u.searchParams.set("fit", ctlFit?.value || "cover");
    u.searchParams.set("hud", (ctlHud?.value === "off") ? "0" : "1");

    if (ctlAdfree?.value === "on") u.searchParams.set("mode", "adfree");
    else u.searchParams.delete("mode");

    if (ctlAutoskip?.value === "off") u.searchParams.set("autoskip", "0");
    else u.searchParams.delete("autoskip");

    // voto
    if (ctlVoteOn?.value === "on") u.searchParams.set("vote", "1");
    else u.searchParams.delete("vote");

    const ch = (ctlTwitchChannel?.value || "").trim().replace(/^@/, "");
    if (ch) u.searchParams.set("twitch", ch);
    else u.searchParams.delete("twitch");

    const { voteAtSec, windowSec, leadSec, uiSec } = computeVoteTiming();

    u.searchParams.set("voteOverlay", (ctlVoteOverlay?.value === "off") ? "0" : "1");
    u.searchParams.set("voteWindow", String(windowSec));
    u.searchParams.set("voteLead", String(leadSec));
    u.searchParams.set("voteAt", String(voteAtSec));
    u.searchParams.set("voteUi", String(uiSec));

    if (ctlVoteCmd?.value) u.searchParams.set("voteCmd", ctlVoteCmd.value.trim());

    // stayMins
    if (ctlStayMins) {
      const sm = clamp(parseInt(ctlStayMins.value || "5", 10) || 5, 1, 120);
      u.searchParams.set("stayMins", String(sm));
    }

    // ytCookies
    if (ctlYtCookies) {
      const v = String(ctlYtCookies.value || "off").toLowerCase();
      u.searchParams.set("ytCookies", (v === "on") ? "1" : "0");
    }

    // bgm
    if (ctlBgmOn?.value === "on") u.searchParams.set("bgm", "1");
    else u.searchParams.delete("bgm");
    if (ctlBgmVol?.value != null) u.searchParams.set("bgmVol", String(ctlBgmVol.value));

    // chat/alerts
    if (ctlChatOn?.value === "on") u.searchParams.set("chat", "1");
    else u.searchParams.delete("chat");

    if (ctlChatHideCmd?.value === "off") u.searchParams.set("chatHideCommands", "0");
    else u.searchParams.delete("chatHideCommands");

    if (ctlAlertsOn?.value === "on") u.searchParams.set("alerts", "1");
    else u.searchParams.delete("alerts");

    // ads overlay
    if (ctlAdsOn?.value === "on") u.searchParams.set("ads", "1");
    else u.searchParams.set("ads", "0");

    if (ctlAdLead?.value != null) u.searchParams.set("adLead", String(clamp(parseInt(ctlAdLead.value || "30", 10) || 30, 0, 300)));
    if (ctlAdShowDuring?.value === "off") u.searchParams.set("adShowDuring", "0");
    else u.searchParams.set("adShowDuring", "1");

    if (ctlAdChatText?.value) u.searchParams.set("adChatText", ctlAdChatText.value.trim());

    // ───────────── NEWS TICKER params
    const tc = readTickerUI();

    if (!tc.enabled) u.searchParams.set("ticker", "0");
    else u.searchParams.delete("ticker");

    u.searchParams.set("tickerLang", tc.lang);
    u.searchParams.set("tickerSpeed", String(tc.speedPxPerSec));
    u.searchParams.set("tickerRefresh", String(tc.refreshMins));
    u.searchParams.set("tickerTop", String(tc.topPx));
    if (!tc.hideOnVote) u.searchParams.set("tickerHideOnVote", "0");
    else u.searchParams.delete("tickerHideOnVote");

    if (tc.timespan) u.searchParams.set("tickerSpan", String(tc.timespan));

    // ───────────── COUNTDOWN params (NEW)
    const cc = readCountdownUI();
    if (cc.enabled) u.searchParams.set("countdown", "1");
    else u.searchParams.set("countdown", "0");

    if (cc.targetMs) u.searchParams.set("countdownTo", String(cc.targetMs | 0));
    if (cc.label) u.searchParams.set("countdownLabel", cc.label);

    // key
    if (KEY) u.searchParams.set("key", KEY);
    else u.searchParams.delete("key");

    return u.toString();
  }

  function applyState(st) {
    lastState = st;
    lastSeenAt = Date.now();

    setStatus("Conectado", true);

    if (ctlNowTitle) ctlNowTitle.textContent = st?.cam?.title || "—";
    if (ctlNowPlace) ctlNowPlace.textContent = st?.cam?.place || "—";
    if (ctlNowTimer) ctlNowTimer.textContent = fmtMMSS(st?.remaining ?? 0);

    if (ctlOrigin) {
      ctlOrigin.href = st?.cam?.originUrl || "#";
      ctlOrigin.style.pointerEvents = st?.cam?.originUrl ? "auto" : "none";
      ctlOrigin.style.opacity = st?.cam?.originUrl ? "1" : ".65";
    }

    if (ctlPlay) ctlPlay.textContent = st?.playing ? "⏸" : "▶";

    // ⚠️ NO pisar inputs si el usuario los está editando
    if (ctlMins && typeof st?.mins === "number") safeSetValue(ctlMins, st.mins);
    if (ctlFit && st?.fit && !isEditing(ctlFit)) ctlFit.value = st.fit;

    if (ctlHud && !isEditing(ctlHud)) ctlHud.value = st?.hudHidden ? "off" : "on";
    if (ctlHudDetails && !isEditing(ctlHudDetails)) ctlHudDetails.value = st?.hudCollapsed ? "collapsed" : "expanded";
    if (ctlAutoskip && !isEditing(ctlAutoskip)) ctlAutoskip.value = st?.autoskip ? "on" : "off";
    if (ctlAdfree && !isEditing(ctlAdfree)) ctlAdfree.value = st?.adfree ? "on" : "off";

    // BGM
    if (ctlBgmOn && !isEditing(ctlBgmOn)) ctlBgmOn.value = st?.bgm?.enabled ? "on" : "off";
    if (ctlBgmVol && typeof st?.bgm?.vol === "number") safeSetValue(ctlBgmVol, st.bgm.vol);
    if (ctlBgmTrack && st?.bgm?.idx != null && !isEditing(ctlBgmTrack)) ctlBgmTrack.value = String(st.bgm.idx | 0);
    if (ctlBgmNow) {
      const name = st?.bgm?.track || "";
      ctlBgmNow.textContent = name ? `Now: ${name} · ${st?.bgm?.playing ? "playing" : "paused"}` : "—";
    }

    // Vote state
    const vote = st?.vote || {};
    if (ctlTwitchChannel && typeof vote?.channel === "string") {
      if (!ctlTwitchChannel.value || !isEditing(ctlTwitchChannel)) safeSetValue(ctlTwitchChannel, vote.channel);
    }
    if (ctlVoteOn && !isEditing(ctlVoteOn)) ctlVoteOn.value = vote?.enabled ? "on" : "off";
    if (ctlVoteOverlay && !isEditing(ctlVoteOverlay)) ctlVoteOverlay.value = vote?.overlay ? "on" : "off";
    if (ctlVoteWindow && vote?.windowSec != null) safeSetValue(ctlVoteWindow, (vote.windowSec | 0));
    if (ctlVoteAt && vote?.voteAtSec != null) safeSetValue(ctlVoteAt, (vote.voteAtSec | 0));
    if (ctlVoteLead && vote?.leadSec != null) safeSetValue(ctlVoteLead, clamp((vote.leadSec | 0), 0, 30));
    if (ctlVoteCmd && typeof vote?.cmd === "string") {
      if (!isEditing(ctlVoteCmd)) ctlVoteCmd.value = vote.cmd || ctlVoteCmd.value;
    }
    if (ctlStayMins) {
      const sm =
        (vote?.stayMins != null) ? (vote.stayMins | 0)
        : (vote?.staySec != null) ? Math.max(1, Math.round((vote.staySec | 0) / 60))
        : null;
      if (sm != null) safeSetValue(ctlStayMins, clamp(sm, 1, 120));
    }

    if (ctlYtCookies && st?.ytCookies != null && !isEditing(ctlYtCookies)) {
      ctlYtCookies.value = st.ytCookies ? "on" : "off";
    }

    // Chat/Alerts/Ads (si vienen en state)
    if (ctlChatOn && st?.chat?.enabled != null && !isEditing(ctlChatOn)) ctlChatOn.value = st.chat.enabled ? "on" : "off";
    if (ctlChatHideCmd && st?.chat?.hideCommands != null && !isEditing(ctlChatHideCmd)) ctlChatHideCmd.value = st.chat.hideCommands ? "on" : "off";
    if (ctlAlertsOn && st?.alertsEnabled != null && !isEditing(ctlAlertsOn)) ctlAlertsOn.value = st.alertsEnabled ? "on" : "off";

    if (ctlAdsOn && st?.ads?.enabled != null && !isEditing(ctlAdsOn)) ctlAdsOn.value = st.ads.enabled ? "on" : "off";

    // ✅ Auto-announce cam al chat (solo cuando cambia)
    try {
      const camId = String(st?.cam?.id || "");
      const chan = String(vote?.channel || ctlTwitchChannel?.value || "").trim().replace(/^@/, "");
      const botOn = (ctlBotOn?.value === "on");
      if (camId && camId !== lastAnnouncedCamId && chan && botOn) {
        const now = Date.now();
        if ((now - lastAnnounceAt) > 4500) {
          lastAnnounceAt = now;
          lastAnnouncedCamId = camId;

          const t = String(st?.cam?.title || "Live Cam").trim();
          const p = String(st?.cam?.place || "").trim();
          const src = String(st?.cam?.source || "").trim();
          const line = `🌍 Ahora: ${t}${p ? ` — ${p}` : ""}${src ? ` · ${src}` : ""}  |  🆘 !help  🎲 !tagvote  🗳️ !callvote`;
          botSayIfEnabled(line);
        }
      }
    } catch (_) {}

    // ✅ NEW: Auto update Twitch title (Helix) cuando cambia cam
    try {
      const camId = String(st?.cam?.id || "");
      if (camId) {
        helixCfg = readHelixUI();
        saveHelixCfg(helixCfg);
        maybeAutoUpdateTwitchTitleFromState(st, false);
      }
    } catch (_) {}
  }

  // ✅ NUEVO: manejar eventos Player -> Control
  function handleEvent(evt, isMainChannel) {
    if (!evt || evt.type !== "event") return;
    if (!keyOk(evt, isMainChannel)) return;

    const ts = evt.ts | 0;
    if (ts && ts <= (lastEventTs | 0)) return;
    lastEventTs = ts || Date.now();

    const name = String(evt.name || "").toUpperCase();
    const payload = evt.payload || {};

    if (name === "AD_AUTO_NOTICE") {
      const leadSec = (payload.leadSec | 0) || 0;
      const msg = (ctlAdChatText?.value || "").trim() || `⚠️ Anuncio en ${leadSec || 30}s… ¡gracias por apoyar el canal! 💜`;
      botSayIfEnabled(msg);
      return;
    }

    if (name === "AD_AUTO_BEGIN") {
      const dur = (payload.durationSec | 0) || (parseInt(ctlAdDur?.value || "30", 10) || 30);
      const msg = `⏳ Anuncio en curso (${dur}s)… 💜`;
      botSayIfEnabled(msg);
      return;
    }
  }

  // ✅ NUEVO: recibir comandos desde Player (BOT_SAY)
  function handleCmdFromPlayer(msg, isMainChannel) {
    if (!msg || msg.type !== "cmd") return;
    if (!keyOk(msg, isMainChannel)) return;

    const cmd = String(msg.cmd || "");
    const payload = msg.payload || {};

    if (cmd === "BOT_SAY") {
      const text = String(payload.text || payload.message || "").trim();
      if (!text) return;
      botSayIfEnabled(text);
      return;
    }
  }

  function onBusMessage(msg, isMainChannel) {
    if (!msg) return;
    if (msg.type === "state") { if (keyOk(msg, isMainChannel)) applyState(msg); return; }
    if (msg.type === "event") { handleEvent(msg, isMainChannel); return; }
    if (msg.type === "cmd") { handleCmdFromPlayer(msg, isMainChannel); return; }
  }

  // Receive (BroadcastChannel)
  if (bcMain) bcMain.onmessage = (ev) => onBusMessage(ev?.data, true);
  if (bcLegacy) bcLegacy.onmessage = (ev) => onBusMessage(ev?.data, false);

  // Fallback: state from localStorage
  setInterval(() => {
    try {
      const rawMain = lsGet(STATE_KEY);
      const rawLegacy = rawMain ? null : lsGet(STATE_KEY_LEGACY);
      const raw = rawMain || rawLegacy;
      if (!raw) return;

      const st = JSON.parse(raw);
      if (!st || st.type !== "state") return;

      const isMain = !!rawMain;
      if (!keyOk(st, isMain)) return;

      applyState(st);
    } catch (_) {}
  }, 500);

  // Fallback: events from localStorage
  setInterval(() => {
    try {
      const rawMain = lsGet(EVT_KEY);
      const rawLegacy = rawMain ? null : lsGet(EVT_KEY_LEGACY);
      const raw = rawMain || rawLegacy;
      if (!raw) return;

      const evt = JSON.parse(raw);
      if (!evt || evt.type !== "event") return;

      const isMain = !!rawMain;
      handleEvent(evt, isMain);
    } catch (_) {}
  }, 650);

  // Storage events (por si BC falla)
  window.addEventListener("storage", (e) => {
    if (!e || !e.key || !e.newValue) return;

    if (e.key === EVT_KEY || e.key === EVT_KEY_LEGACY) {
      try { handleEvent(JSON.parse(e.newValue), e.key === EVT_KEY); } catch (_) {}
      return;
    }

    if (e.key === STATE_KEY || e.key === STATE_KEY_LEGACY) {
      try {
        const st = JSON.parse(e.newValue);
        if (st && st.type === "state" && keyOk(st, e.key === STATE_KEY)) applyState(st);
      } catch (_) {}
      return;
    }

    // Ticker cfg cambiada en otra pestaña
    if (e.key === TICKER_CFG_KEY || e.key === TICKER_CFG_KEY_BASE || e.key === TICKER_CFG_KEY_LEGACY) {
      try { syncTickerUIFromStore(); } catch (_) {}
      return;
    }

    // Countdown cfg cambiada en otra pestaña
    if (e.key === COUNTDOWN_CFG_KEY || e.key === COUNTDOWN_CFG_KEY_BASE || e.key === COUNTDOWN_CFG_KEY_LEGACY) {
      try { syncCountdownUIFromStore(); } catch (_) {}
      return;
    }

    // Helix cfg cambiada en otra pestaña
    if (e.key === HELIX_CFG_KEY || e.key === HELIX_CFG_KEY_BASE || e.key === HELIX_CFG_KEY_LEGACY) {
      try { syncHelixUIFromStore(); } catch (_) {}
      return;
    }
  });

  // Watchdog
  setInterval(() => {
    const now = Date.now();
    if (!lastSeenAt) { setStatus("Esperando player…", false); return; }
    const age = now - lastSeenAt;
    if (age > 2500) setStatus("Sin señal (¿stream abierto?)", false);
  }, 700);

  // ───────────────────────── UI events ─────────────────────────
  function wire() {
    syncList("");
    syncBgmTracks();
    syncBotUIFromStore();

    // footer bus name
    if (ctlBusName) ctlBusName.textContent = `Canal: ${BUS}`;

    // Ticker: cargar UI desde storage y mandar cfg (por si el player ya está abierto)
    syncTickerUIFromStore();
    try { tickerCfg = sendTickerCfg(loadTickerCfg(), false); } catch (_) {}

    // Countdown: cargar UI y mandar cfg
    syncCountdownUIFromStore();
    try { countdownCfg = sendCountdownCfg(loadCountdownCfg(), false); } catch (_) {}

    // Helix: cargar UI
    syncHelixUIFromStore();

    // defaults seguros
    if (ctlVoteAt && !ctlVoteAt.value) ctlVoteAt.value = "60";
    if (ctlVoteWindow && !ctlVoteWindow.value) ctlVoteWindow.value = "60";
    if (ctlVoteLead && !ctlVoteLead.value) ctlVoteLead.value = "0";
    if (ctlStayMins && !ctlStayMins.value) ctlStayMins.value = "5";
    if (ctlYtCookies && !ctlYtCookies.value) ctlYtCookies.value = "on";

    if (ctlChatOn && !ctlChatOn.value) ctlChatOn.value = "on";
    if (ctlChatHideCmd && !ctlChatHideCmd.value) ctlChatHideCmd.value = "on";
    if (ctlAlertsOn && !ctlAlertsOn.value) ctlAlertsOn.value = "on";

    if (ctlAdsOn && !ctlAdsOn.value) ctlAdsOn.value = "on";
    if (ctlAdLead && !ctlAdLead.value) ctlAdLead.value = "30";
    if (ctlAdDur && !ctlAdDur.value) ctlAdDur.value = "30";
    if (ctlAdShowDuring && !ctlAdShowDuring.value) ctlAdShowDuring.value = "on";
    if (ctlAdChatText && !ctlAdChatText.value) ctlAdChatText.value = "⚠️ Anuncio en breve… ¡gracias por apoyar el canal! 💜";

    if (ctlSearch) ctlSearch.addEventListener("input", () => syncList(ctlSearch.value));

    if (ctlPrev) ctlPrev.addEventListener("click", () => sendCmd("PREV"));
    if (ctlNext) ctlNext.addEventListener("click", () => sendCmd("NEXT"));
    if (ctlPlay) ctlPlay.addEventListener("click", () => sendCmd("TOGGLE_PLAY"));
    if (ctlShuffle) ctlShuffle.addEventListener("click", () => sendCmd("SHUFFLE"));

    if (ctlApplyMins) ctlApplyMins.addEventListener("click", () => sendCmd("SET_MINS", { mins: ctlMins.value }));
    if (ctlFit) ctlFit.addEventListener("change", () => sendCmd("SET_FIT", { fit: ctlFit.value }));
    if (ctlHud) ctlHud.addEventListener("change", () => sendCmd("SET_HUD", { on: ctlHud.value !== "off" }));
    if (ctlHudDetails) ctlHudDetails.addEventListener("change", () => sendCmd("SET_HUD_DETAILS", { collapsed: ctlHudDetails.value === "collapsed" }));
    if (ctlAutoskip) ctlAutoskip.addEventListener("change", () => sendCmd("SET_AUTOSKIP", { on: ctlAutoskip.value === "on" }));
    if (ctlAdfree) ctlAdfree.addEventListener("change", () => sendCmd("SET_ADFREE", { on: ctlAdfree.value === "on" }));
    if (ctlReset) ctlReset.addEventListener("click", () => sendCmd("RESET"));

    if (ctlGo) ctlGo.addEventListener("click", () => {
      const id = ctlSelect?.value;
      if (id) sendCmd("GOTO_ID", { id });
    });
    if (ctlSelect) {
      ctlSelect.addEventListener("dblclick", () => {
        const id = ctlSelect.value;
        if (id) sendCmd("GOTO_ID", { id });
      });
    }
    if (ctlBan) ctlBan.addEventListener("click", () => {
      const id = ctlSelect?.value || lastState?.cam?.id;
      if (id) sendCmd("BAN_ID", { id });
    });

    // Preview
    if (ctlPreviewOn) {
      ctlPreviewOn.addEventListener("change", () => {
        const on = ctlPreviewOn.value === "on";
        if (ctlPreviewWrap) ctlPreviewWrap.classList.toggle("hidden", !on);
        if (on && ctlPreview) ctlPreview.src = streamUrlFromHere();
        else if (ctlPreview) ctlPreview.src = "about:blank";
      });
    }

    // Copy URL
    if (ctlCopyStreamUrl) {
      ctlCopyStreamUrl.addEventListener("click", async () => {
        const url = streamUrlFromHere();
        const ok = await copyToClipboard(url);
        ctlCopyStreamUrl.textContent = ok ? "✅ Copiado" : "❌";
        setTimeout(() => (ctlCopyStreamUrl.textContent = "Copiar URL stream"), 900);
      });
    }

    // NEWS Ticker buttons
    if (ctlTickerApply) {
      ctlTickerApply.addEventListener("click", () => {
        const cfg = readTickerUI();
        tickerCfg = sendTickerCfg(cfg, true);
        setTickerStatusFromCfg(tickerCfg);

        // refresca preview si está ON
        try {
          if (ctlPreviewOn?.value === "on" && ctlPreview) ctlPreview.src = streamUrlFromHere();
        } catch (_) {}

        try {
          const old = ctlTickerApply.textContent || "Aplicar";
          ctlTickerApply.textContent = "✅ Aplicado";
          setTimeout(() => { ctlTickerApply.textContent = old; }, 850);
        } catch (_) {}
      });
    }

    if (ctlTickerReset) {
      ctlTickerReset.addEventListener("click", () => {
        try {
          lsDel(TICKER_CFG_KEY);
          lsDel(TICKER_CFG_KEY_BASE);
          lsDel(TICKER_CFG_KEY_LEGACY);
        } catch (_) {}
        tickerCfg = sendTickerCfg(TICKER_DEFAULTS, true);
        syncTickerUIFromStore();

        try {
          if (ctlPreviewOn?.value === "on" && ctlPreview) ctlPreview.src = streamUrlFromHere();
        } catch (_) {}
      });
    }

    if (ctlTickerCopyUrl) {
      ctlTickerCopyUrl.addEventListener("click", async () => {
        const url = streamUrlFromHere();
        const ok = await copyToClipboard(url);
        ctlTickerCopyUrl.textContent = ok ? "✅ Copiado" : "❌";
        setTimeout(() => (ctlTickerCopyUrl.textContent = "Copiar URL Stream (con ticker)"), 900);
      });
    }

    // COUNTDOWN buttons (NEW)
    if (ctlCountdownApply) {
      ctlCountdownApply.addEventListener("click", () => {
        const cfg = readCountdownUI();
        countdownCfg = sendCountdownCfg(cfg, true);
        setCountdownStatusFromCfg(countdownCfg);

        try {
          if (ctlPreviewOn?.value === "on" && ctlPreview) ctlPreview.src = streamUrlFromHere();
        } catch (_) {}
      });
    }

    if (ctlCountdownReset) {
      ctlCountdownReset.addEventListener("click", () => {
        try {
          lsDel(COUNTDOWN_CFG_KEY);
          lsDel(COUNTDOWN_CFG_KEY_BASE);
          lsDel(COUNTDOWN_CFG_KEY_LEGACY);
        } catch (_) {}
        countdownCfg = sendCountdownCfg(COUNTDOWN_DEFAULTS, true);
        syncCountdownUIFromStore();

        try {
          if (ctlPreviewOn?.value === "on" && ctlPreview) ctlPreview.src = streamUrlFromHere();
        } catch (_) {}
      });
    }

    // HELIX buttons (NEW)
    function helixApplyAndPersist() {
      helixCfg = readHelixUI();
      saveHelixCfg(helixCfg);
      setHelixStatus(helixCfg.enabled ? "Auto título: ON" : "Auto título: OFF", !!helixCfg.enabled);

      // reset cache al cambiar credenciales/canal
      helixBroadcasterId = "";
      helixLastSig = "";
      helixLastUpdateAt = 0;
    }

    if (ctlHelixApply) {
      ctlHelixApply.addEventListener("click", () => {
        helixApplyAndPersist();
        if (lastState) maybeAutoUpdateTwitchTitleFromState(lastState, true);
      });
    }

    if (ctlHelixTest) {
      ctlHelixTest.addEventListener("click", () => {
        helixApplyAndPersist();
        if (lastState) maybeAutoUpdateTwitchTitleFromState(lastState, true);
        else setHelixStatus("Abre el player para tener state", false);
      });
    }

    // Auto persist Helix en cambios
    const helixLive = [ctlHelixOn, ctlHelixClientId, ctlHelixToken, ctlHelixTpl, ctlHelixCooldown].filter(Boolean);
    for (const el of helixLive) {
      el.addEventListener("change", () => {
        helixApplyAndPersist();
      });
    }

    // BGM
    if (ctlBgmOn) ctlBgmOn.addEventListener("change", () => sendCmd("BGM_ENABLE", { on: ctlBgmOn.value === "on" }));
    if (ctlBgmVol) ctlBgmVol.addEventListener("input", () => sendCmd("BGM_VOL", { vol: num(ctlBgmVol.value, 0) }));
    if (ctlBgmTrack) ctlBgmTrack.addEventListener("change", () => sendCmd("BGM_TRACK", { index: parseInt(ctlBgmTrack.value || "0", 10) || 0 }));
    if (ctlBgmPrev) ctlBgmPrev.addEventListener("click", () => sendCmd("BGM_PREV"));
    if (ctlBgmPlay) ctlBgmPlay.addEventListener("click", () => sendCmd("BGM_PLAYPAUSE"));
    if (ctlBgmNext) ctlBgmNext.addEventListener("click", () => sendCmd("BGM_NEXT"));
    if (ctlBgmShuffle) ctlBgmShuffle.addEventListener("click", () => sendCmd("BGM_SHUFFLE"));

    // Vote controls
    function voteApply() {
      const { voteAtSec, windowSec, leadSec, uiSec } = computeVoteTiming();
      const stayMins = ctlStayMins ? clamp(parseInt(ctlStayMins.value || "5", 10) || 5, 1, 120) : undefined;

      sendCmd("TWITCH_SET", {
        channel: (ctlTwitchChannel?.value || "").trim().replace(/^@/, ""),
        enabled: (ctlVoteOn?.value === "on"),
        overlay: (ctlVoteOverlay?.value !== "off"),
        windowSec,
        voteAtSec,
        leadSec,
        uiSec,
        cmd: (ctlVoteCmd?.value || "!next,!cam|!stay,!keep").trim(),
        stayMins,
        chat: (ctlChatOn?.value === "on"),
        chatHideCommands: (ctlChatHideCmd?.value !== "off"),
        alerts: (ctlAlertsOn?.value === "on"),
      });

      // ads set (runtime)
      sendCmd("ADS_SET", {
        enabled: (ctlAdsOn?.value === "on"),
        adLead: clamp(parseInt(ctlAdLead?.value || "30", 10) || 30, 0, 300),
        adShowDuring: (ctlAdShowDuring?.value !== "off"),
        adChatText: (ctlAdChatText?.value || "").trim(),
      });

      // Countdown cfg también la mandamos (por si el player la consume al vuelo)
      countdownCfg = sendCountdownCfg(readCountdownUI(), true);
      setCountdownStatusFromCfg(countdownCfg);

      // Helix persist por si han tocado algo
      helixApplyAndPersist();
    }

    if (ctlVoteApply) ctlVoteApply.addEventListener("click", voteApply);

    if (ctlVoteStart) ctlVoteStart.addEventListener("click", () => {
      const { windowSec, leadSec, uiSec } = computeVoteTiming();
      sendCmd("VOTE_START", { windowSec, leadSec, uiSec });
    });

    // ADS buttons + bot say opcional
    if (ctlAdNoticeBtn) ctlAdNoticeBtn.addEventListener("click", () => {
      const lead = clamp(parseInt(ctlAdLead?.value || "30", 10) || 30, 0, 300);
      sendCmd("AD_NOTICE", { leadSec: lead });
      const msg = (ctlAdChatText?.value || "").trim();
      if (lead > 0) botSayIfEnabled(msg || `⚠️ Anuncio en ${lead}s…`);
      else botSayIfEnabled(msg || "⚠️ Anuncio en breve…");
    });

    if (ctlAdBeginBtn) ctlAdBeginBtn.addEventListener("click", () => {
      const dur = clamp(parseInt(ctlAdDur?.value || "30", 10) || 30, 5, 600);
      sendCmd("AD_BEGIN", { durationSec: dur });
      botSayIfEnabled(`⏳ Anuncio en curso (${dur}s)…`);
    });

    if (ctlAdClearBtn) ctlAdClearBtn.addEventListener("click", () => {
      sendCmd("AD_CLEAR", {});
    });

    // BOT UI
    function onBotCfgChange() {
      persistBotUIToStore();
      if (ctlBotOn?.value === "on") bot.connect();
      else bot.close();
    }

    if (ctlBotOn) ctlBotOn.addEventListener("change", onBotCfgChange);
    if (ctlBotUser) ctlBotUser.addEventListener("input", () => { persistBotUIToStore(); });
    if (ctlBotToken) ctlBotToken.addEventListener("input", () => { persistBotUIToStore(); });
    if (ctlBotSayOnAd) ctlBotSayOnAd.addEventListener("change", () => { persistBotUIToStore(); });

    if (ctlBotConnect) ctlBotConnect.addEventListener("click", () => {
      persistBotUIToStore();
      if (ctlBotOn?.value !== "on") { ctlBotOn.value = "on"; persistBotUIToStore(); }
      bot.connect();
    });

    if (ctlBotTestSend) ctlBotTestSend.addEventListener("click", () => {
      persistBotUIToStore();
      const ch = (ctlTwitchChannel?.value || "").trim().replace(/^@/, "");
      const msg = (ctlBotTestText?.value || "✅ Bot OK").trim();
      if (!ch) { setBotStatus("Pon canal primero", false); return; }
      const ok = bot.say(msg, ch);
      setBotStatus(ok ? "Enviado" : "No enviado", ok);
      setTimeout(() => setBotStatus(bot.connected ? "Conectado (auth)" : "Bot listo", !!bot.connected), 900);
    });

    // Teclas pro
    window.addEventListener("keydown", (e) => {
      const k = (e.key || "").toLowerCase();
      if (k === " ") { e.preventDefault(); sendCmd("TOGGLE_PLAY"); }
      else if (k === "n") sendCmd("NEXT");
      else if (k === "p") sendCmd("PREV");
    });

    setStatus("Esperando player…", false);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
