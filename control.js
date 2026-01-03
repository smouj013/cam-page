/* control.js — RLC Control v2.3.4 (VERSION SYNC + TICKER DEDUPE SAFE + ADS DUR CFG + HOTKEYS SAFE + HELIX TIMEOUT FIX + HELIX 429 BACKOFF NO-SPAM)
   ✅ Controla el Player por BroadcastChannel/localStorage
   ✅ Copia URL del stream con params correctos (voteUi, ads, alerts, chat, ticker, countdown...)
   ✅ Bot IRC (OAuth) configurable desde el panel (manda mensajes al chat)
   ✅ Bot NO se incluye en URL (seguridad)
   ✅ Events bridge Player -> Control (ads auto detectados => bot escribe)
   ✅ KEY namespace (BUS/CMD/STATE/EVT/BOT_STORE) + compat legacy (incluye fallback keyless)
   ✅ BOT_SAY desde Player (cmd) => Control lo envía al chat (anti-spam)
   ✅ Anuncio automático al chat cuando cambia la cámara (anti-spam)
   ✅ News Ticker cfg (storage + BC) (integrado aquí)
   ✅ Countdown cfg + BC/LS + URL params
   ✅ Auto Twitch Title (Helix) — COMPAT con IDs ctlTitle* del HTML
   ✅ Botón “Aplicar ajustes” (si existe #ctlApplySettings)
   ✅ FIX: Helix Abort/Timeout muestra mensaje claro (no “signal aborted”)
   ✅ NEW: ADS_SET incluye duración (adDurSec) + URL incluye adDur
   ✅ NEW: Hotkeys no disparan escribiendo en inputs/selects/textarea
   ✅ NEW: Version unificada con APP_VERSION (2.3.4)
   ✅ NEW: Robustez extra (null-safe / guards)
   ✅ PATCH: Helix 429 -> backoff real + anti-spam (no reintenta cada tick)
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const APP_VERSION = String((typeof window !== "undefined" && window.APP_VERSION) || "2.3.4");
  const LOAD_GUARD = "__RLC_CONTROL_LOADED_V234";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  // ───────────────────────── Base keys / params
  const BUS_BASE = "rlc_bus_v1";
  const CMD_KEY_BASE = "rlc_cmd_v1";
  const STATE_KEY_BASE = "rlc_state_v1";
  const EVT_KEY_BASE = "rlc_evt_v1";

  const BOT_STORE_KEY_BASE = "rlc_bot_cfg_v1";            // solo control.html
  const TICKER_CFG_KEY_BASE = "rlc_ticker_cfg_v1";        // player + control
  const HELIX_CFG_KEY_BASE  = "rlc_helix_cfg_v1";         // solo control.html (auto title)
  const COUNTDOWN_CFG_KEY_BASE = "rlc_countdown_cfg_v1";  // player + control

  const qs = (s, r = document) => r.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (v, fallback) => {
    const n = parseFloat(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  };
  const safeStr = (v) => (typeof v === "string") ? v.trim() : "";

  function parseParams() {
    const u = new URL(location.href);
    return { key: safeStr(u.searchParams.get("key") || "") };
  }
  const KEY = String(parseParams().key || "").trim();

  const BUS = KEY ? `${BUS_BASE}:${KEY}` : BUS_BASE;
  const CMD_KEY = KEY ? `${CMD_KEY_BASE}:${KEY}` : CMD_KEY_BASE;
  const STATE_KEY = KEY ? `${STATE_KEY_BASE}:${KEY}` : STATE_KEY_BASE;
  const EVT_KEY = KEY ? `${EVT_KEY_BASE}:${KEY}` : EVT_KEY_BASE;

  // Legacy compat
  const BUS_LEGACY = BUS_BASE;
  const CMD_KEY_LEGACY = CMD_KEY_BASE;
  const STATE_KEY_LEGACY = STATE_KEY_BASE;
  const EVT_KEY_LEGACY = EVT_KEY_BASE;

  // Stores (keyed + legacy)
  const BOT_STORE_KEY = KEY ? `${BOT_STORE_KEY_BASE}:${KEY}` : BOT_STORE_KEY_BASE;
  const TICKER_CFG_KEY = KEY ? `${TICKER_CFG_KEY_BASE}:${KEY}` : TICKER_CFG_KEY_BASE;
  const HELIX_CFG_KEY  = KEY ? `${HELIX_CFG_KEY_BASE}:${KEY}` : HELIX_CFG_KEY_BASE;
  const COUNTDOWN_CFG_KEY = KEY ? `${COUNTDOWN_CFG_KEY_BASE}:${KEY}` : COUNTDOWN_CFG_KEY_BASE;

  const bcMain = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS) : null;
  const bcLegacy = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_LEGACY) : null;

  // ───────────────────────── DOM (IDs del HTML)
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
  const ctlApplySettings = qs("#ctlApplySettings"); // ✅
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

  // ADS
  const ctlAdsOn = qs("#ctlAdsOn");
  const ctlAdLead = qs("#ctlAdLead");
  const ctlAdDur = qs("#ctlAdDur"); // ✅ duración default (para AD_BEGIN)
  const ctlAdShowDuring = qs("#ctlAdShowDuring");
  const ctlAdChatText = qs("#ctlAdChatText");
  const ctlAdNoticeBtn = qs("#ctlAdNoticeBtn");
  const ctlAdBeginBtn = qs("#ctlAdBeginBtn");
  const ctlAdClearBtn = qs("#ctlAdClearBtn");

  // BOT
  const ctlBotOn = qs("#ctlBotOn");
  const ctlBotUser = qs("#ctlBotUser");
  const ctlBotToken = qs("#ctlBotToken");
  const ctlBotConnect = qs("#ctlBotConnect");
  const ctlBotStatus = qs("#ctlBotStatus");
  const ctlBotSayOnAd = qs("#ctlBotSayOnAd");
  const ctlBotTestText = qs("#ctlBotTestText");
  const ctlBotTestSend = qs("#ctlBotTestSend");

  // Ticker
  const ctlTickerOn = qs("#ctlTickerOn");
  const ctlTickerLang = qs("#ctlTickerLang");
  const ctlTickerSpeed = qs("#ctlTickerSpeed");
  const ctlTickerRefresh = qs("#ctlTickerRefresh");
  const ctlTickerTop = qs("#ctlTickerTop");
  const ctlTickerHideOnVote = qs("#ctlTickerHideOnVote");
  const ctlTickerSpan = qs("#ctlTickerSpan");
  const ctlTickerApply = qs("#ctlTickerApply");
  const ctlTickerReset = qs("#ctlTickerReset");
  const ctlTickerStatus = qs("#ctlTickerStatus");
  const ctlTickerCopyUrl = qs("#ctlTickerCopyUrl");

  // Countdown
  const ctlCountdownOn = qs("#ctlCountdownOn");
  const ctlCountdownLabel = qs("#ctlCountdownLabel");
  const ctlCountdownTarget = qs("#ctlCountdownTarget");
  const ctlCountdownApply = qs("#ctlCountdownApply");
  const ctlCountdownReset = qs("#ctlCountdownReset");
  const ctlCountdownStatus = qs("#ctlCountdownStatus");

  // Auto title — HTML actual: ctlTitle*
  const ctlTitleOn = qs("#ctlTitleOn") || qs("#ctlHelixOn");
  const ctlTitleStatus = qs("#ctlTitleStatus") || qs("#ctlHelixStatus");
  const ctlTitleClientId = qs("#ctlTitleClientId") || qs("#ctlHelixClientId");
  const ctlTitleBroadcasterId = qs("#ctlTitleBroadcasterId");
  const ctlTitleToken = qs("#ctlTitleToken") || qs("#ctlHelixToken");
  const ctlTitleTemplate = qs("#ctlTitleTemplate") || qs("#ctlHelixTpl");
  const ctlTitleCooldown = qs("#ctlTitleCooldown") || qs("#ctlHelixCooldown");
  const ctlTitleApply = qs("#ctlTitleApply") || qs("#ctlHelixApply");
  const ctlTitleTest = qs("#ctlTitleTest") || qs("#ctlHelixTest");
  const ctlTitleReset = qs("#ctlTitleReset");

  // footer
  const ctlBusName = qs("#ctlBusName");

  // Data
  const allCams = Array.isArray(g.CAM_LIST) ? g.CAM_LIST.slice() : [];
  const bgmList = Array.isArray(g.BGM_LIST) ? g.BGM_LIST.slice() : [];

  let lastState = null;
  let lastSeenAt = 0;

  // events / spam guards
  let lastEventTs = 0;

  // Bot say guards
  let lastBotSayAt = 0;
  let lastBotSaySig = "";
  const sigOf = (s) => String(s || "").trim().slice(0, 180);

  // Auto announce cam
  let lastAnnouncedCamId = "";
  let lastAnnounceAt = 0;

  // Message activity / compat
  let lastAnyMsgAt = 0;
  let lastMainMsgAt = 0;

  // Compat: keyless legacy unos segundos
  let allowLegacyNoKey = true;
  const allowLegacyNoKeyUntil = Date.now() + 6500;

  // ───────────────────────── helpers
  function fmtMMSS(sec) {
    sec = Math.max(0, sec | 0);
    const m = (sec / 60) | 0;
    const s = sec - m * 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function keyOk(msg, isMainChannel) {
    if (!KEY) return true;

    if (isMainChannel) {
      allowLegacyNoKey = false;
      return true;
    }

    const mk = msg && typeof msg.key === "string" ? String(msg.key).trim() : "";
    if (mk) return mk === KEY;

    if (!allowLegacyNoKey) return false;
    if (Date.now() > allowLegacyNoKeyUntil) return false;
    return true;
  }

  function busPost(msg) {
    try { if (bcMain) bcMain.postMessage(msg); } catch (_) {}
    try { if (bcLegacy) bcLegacy.postMessage(msg); } catch (_) {}
  }

  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (_) {} }

  function safeJson(raw, fallback = null) { try { return JSON.parse(raw); } catch (_) { return fallback; } }

  function sendCmd(cmd, payload = {}) {
    const msg = { type: "cmd", ts: Date.now(), cmd, payload: payload || {} };
    if (KEY) msg.key = KEY;

    const raw = JSON.stringify(msg);
    lsSet(CMD_KEY, raw);
    lsSet(CMD_KEY_LEGACY, raw);
    busPost(msg);
  }

  function setPill(el, text, ok = true) {
    if (!el) return;
    try { el.textContent = text; } catch (_) {}
    try {
      el.classList.toggle("pill--ok", !!ok);
      el.classList.toggle("pill--bad", !ok);
      el.classList.toggle("ok", !!ok);
      el.classList.toggle("bad", !ok);
    } catch (_) {}
  }

  function setStatus(text, ok = true) { setPill(ctlStatus, text, ok); }
  function setBotStatus(text, ok = true) { setPill(ctlBotStatus, text, ok); }

  function setTickerStatusFromCfg(cfg) {
    if (!ctlTickerStatus) return;
    const on = !!cfg?.enabled;
    setPill(ctlTickerStatus, on ? "Ticker: ON" : "Ticker: OFF", on);
  }

  function setCountdownStatusFromCfg(cfg) {
    if (!ctlCountdownStatus) return;
    const on = !!cfg?.enabled;
    setPill(ctlCountdownStatus, on ? "Cuenta atrás: ON" : "Cuenta atrás: OFF", on);
  }

  function setTitleStatus(text, ok = true) { setPill(ctlTitleStatus, text, ok); }

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
    const t = String(text ?? "");
    try {
      await navigator.clipboard.writeText(t);
      return true;
    } catch (_) {
      try {
        const ta = document.createElement("textarea");
        ta.value = t;
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

  function isEditing(el) {
    if (!el) return false;
    try { return document.activeElement === el || el.matches(":focus"); }
    catch (_) { return document.activeElement === el; }
  }

  function isTextInputActive() {
    const a = document.activeElement;
    if (!a) return false;
    const tag = String(a.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    try { if (a.isContentEditable) return true; } catch (_) {}
    return false;
  }

  function safeSetValue(el, v) {
    if (!el) return;
    if (isEditing(el)) return;
    el.value = String(v);
  }

  function debounce(fn, ms = 160) {
    let t = null;
    return (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => { t = null; fn(...args); }, ms);
    };
  }

  // ───────────────────────── Vote timing (voteAt = “a falta”)
  function getTotalCamSecFallback() {
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

    const windowWanted = clamp(parseInt(ctlVoteWindow?.value || "60", 10) || 60, 5, 180);
    const leadWanted = clamp(parseInt(ctlVoteLead?.value || "0", 10) || 0, 0, 30);

    const leadSec = clamp(leadWanted, 0, Math.max(0, voteAtSec - 1));
    const windowSec = clamp(windowWanted, 1, voteAtSec);
    const uiSec = clamp(Math.min(windowSec + leadSec, voteAtSec), 1, 999999);

    return { totalSec, voteAtSec, windowSec, leadSec, uiSec };
  }

  // ───────────────────────── Ticker cfg
  const TICKER_DEFAULTS = {
    enabled: true,
    lang: "auto",
    speedPxPerSec: 55,
    refreshMins: 12,
    topPx: 10,
    hideOnVote: true,
    timespan: "1d"
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
    lsSet(TICKER_CFG_KEY, raw);
    lsSet(TICKER_CFG_KEY_BASE, raw);
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
    const speedPxPerSec = ctlTickerSpeed ? clamp(parseInt(ctlTickerSpeed.value || "55", 10) || 55, 20, 140) : (base.speedPxPerSec || 55);
    const refreshMins = ctlTickerRefresh ? clamp(parseInt(ctlTickerRefresh.value || "12", 10) || 12, 3, 60) : (base.refreshMins || 12);
    const topPx = ctlTickerTop ? clamp(parseInt(ctlTickerTop.value || "10", 10) || 10, 0, 120) : (base.topPx || 10);
    const hideOnVote = ctlTickerHideOnVote ? (ctlTickerHideOnVote.value !== "off") : base.hideOnVote;
    const timespan = ctlTickerSpan ? (ctlTickerSpan.value || base.timespan || "1d") : (base.timespan || "1d");
    return normalizeTickerCfg({ enabled, lang, speedPxPerSec, refreshMins, topPx, hideOnVote, timespan });
  }

  // ───────────────────────── Countdown cfg
  const COUNTDOWN_DEFAULTS = { enabled: false, label: "Fin de año", targetMs: 0 };

  function nextNewYearTargetMs() {
    try {
      const now = new Date();
      const y = now.getFullYear() + 1;
      const d = new Date(y, 0, 1, 0, 0, 0, 0);
      return d.getTime();
    } catch (_) { return 0; }
  }

  function normalizeCountdownCfg(inCfg) {
    const c = Object.assign({}, COUNTDOWN_DEFAULTS, (inCfg || {}));
    c.enabled = (c.enabled === true);
    c.label = String(c.label || COUNTDOWN_DEFAULTS.label).trim().slice(0, 60) || COUNTDOWN_DEFAULTS.label;

    const t = (typeof c.targetMs === "number") ? c.targetMs : parseInt(String(c.targetMs || "0"), 10);
    c.targetMs = Number.isFinite(t) ? Math.max(0, t) : 0;
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
    return c;
  }

  function sendCountdownCfg(cfg, persist = true) {
    const c = persist ? saveCountdownCfg(cfg) : normalizeCountdownCfg(cfg);
    const msg = { type: "COUNTDOWN_CFG", ts: Date.now(), cfg: c };
    if (KEY) msg.key = KEY;
    busPost(msg);

    // compat: también como cmd
    sendCmd("COUNTDOWN_SET", c);
    return c;
  }

  let countdownCfg = loadCountdownCfg();

  function syncCountdownUIFromStore() {
    countdownCfg = loadCountdownCfg();
    if (ctlCountdownOn) ctlCountdownOn.value = countdownCfg.enabled ? "on" : "off";
    if (ctlCountdownLabel) ctlCountdownLabel.value = String(countdownCfg.label || "Fin de año");

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

  // ───────────────────────── Helix Auto Title cfg
  const HELIX_DEFAULTS = {
    enabled: false,
    clientId: "",
    token: "",
    broadcasterId: "",
    template: "🌍 Ahora: {title}{placeSep}{place} | GlobalEye.TV",
    cooldownSec: 20
  };

  function normalizeHelixCfg(inCfg) {
    const c = Object.assign({}, HELIX_DEFAULTS, (inCfg || {}));
    c.enabled = (c.enabled === true);
    c.clientId = String(c.clientId || "").trim();
    c.token = String(c.token || "").trim();
    c.broadcasterId = String(c.broadcasterId || "").trim();
    c.template = String(c.template || HELIX_DEFAULTS.template).trim().slice(0, 220) || HELIX_DEFAULTS.template;
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
    return c;
  }

  let helixCfg = loadHelixCfg();
  let helixLastUpdateAt = 0;
  let helixLastSig = "";
  let helixResolvedBroadcasterId = "";

  // ✅ anti-spam 429 / retries
  let helixLastAttemptAt = 0;
  let helixLastAttemptSig = "";
  let helixRetryAfterAt = 0;
  let helixResolvedForLogin = "";

  function syncHelixUIFromStore() {
    helixCfg = loadHelixCfg();
    if (ctlTitleOn) ctlTitleOn.value = helixCfg.enabled ? "on" : "off";
    if (ctlTitleClientId) ctlTitleClientId.value = helixCfg.clientId || "";
    if (ctlTitleToken) ctlTitleToken.value = helixCfg.token || "";
    if (ctlTitleTemplate) ctlTitleTemplate.value = helixCfg.template || HELIX_DEFAULTS.template;
    if (ctlTitleCooldown) ctlTitleCooldown.value = String(helixCfg.cooldownSec || 20);
    if (ctlTitleBroadcasterId) ctlTitleBroadcasterId.value = helixCfg.broadcasterId || "";
    setTitleStatus(helixCfg.enabled ? "Auto título: ON" : "Auto título: OFF", !!helixCfg.enabled);
  }

  function readHelixUI() {
    const base = helixCfg || loadHelixCfg();

    const enabled = ctlTitleOn ? (ctlTitleOn.value !== "off") : base.enabled;
    const clientId = ctlTitleClientId ? String(ctlTitleClientId.value || base.clientId || "").trim() : String(base.clientId || "").trim();
    const token = ctlTitleToken ? String(ctlTitleToken.value || base.token || "").trim() : String(base.token || "").trim();
    const template = ctlTitleTemplate ? String(ctlTitleTemplate.value || base.template || HELIX_DEFAULTS.template).trim() : String(base.template || HELIX_DEFAULTS.template).trim();

    const broadcasterId = ctlTitleBroadcasterId
      ? String(ctlTitleBroadcasterId.value || base.broadcasterId || "").trim()
      : String(base.broadcasterId || "").trim();

    const cooldownSec = ctlTitleCooldown
      ? clamp(parseInt(String(ctlTitleCooldown.value || base.cooldownSec || 20), 10) || 20, 10, 180)
      : (base.cooldownSec || 20);

    return normalizeHelixCfg({ enabled, clientId, token, broadcasterId, template, cooldownSec });
  }

  function buildTitleFromState(st, template) {
    const cam = st?.cam || st?.currentCam || {};
    const t = String(cam?.title || "Live Cam").trim();
    const p = String(cam?.place || "").trim();
    const s = String(cam?.source || "").trim();
    const placeSep = p ? " — " : "";

    const repl = (k) => {
      const kk = String(k || "").toLowerCase();
      if (kk === "title") return t;
      if (kk === "place") return p;
      if (kk === "source") return s;
      if (kk === "label") return p ? `${t} — ${p}` : t;
      if (kk === "placesep") return placeSep;
      return "";
    };

    let out = String(template || HELIX_DEFAULTS.template);
    out = out.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, k) => repl(k));
    out = out.replace(/\s+/g, " ").trim();
    out = out.replace(/[^\S\r\n]+/g, " ").replace(/[\r\n]+/g, " ").trim();

    if (!out) out = p ? `${t} — ${p}` : t;
    if (out.length > 140) out = out.slice(0, 140).trim();
    return out;
  }

  function _parseHelixRetryMs(headers) {
    try {
      const ra = parseInt(headers?.get?.("Retry-After") || "", 10);
      if (Number.isFinite(ra) && ra > 0) return clamp(ra * 1000, 1000, 180000);

      const resetSec = parseInt(headers?.get?.("Ratelimit-Reset") || "", 10);
      if (Number.isFinite(resetSec) && resetSec > 0) {
        const ms = (resetSec * 1000) - Date.now();
        return clamp(ms, 1000, 180000);
      }
    } catch (_) {}
    return 15000;
  }

  async function helixFetch(path, { method = "GET", clientId, token, body = null, timeoutMs = 20000 } = {}) {
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

      if (r.status === 429) {
        let extra = "";
        try { extra = await r.text(); } catch (_) {}
        const e = new Error(`Helix HTTP 429${extra ? ` — ${extra.slice(0, 180)}` : ""}`);
        e.status = 429;
        e.retryMs = _parseHelixRetryMs(r.headers);
        throw e;
      }

      if (!r.ok) {
        let extra = "";
        try { extra = await r.text(); } catch (_) {}
        const e = new Error(`Helix HTTP ${r.status}${extra ? ` — ${extra.slice(0, 180)}` : ""}`);
        e.status = r.status;
        throw e;
      }

      if (r.status === 204) return { ok: true, data: null };
      const data = await r.json().catch(() => null);
      return { ok: true, data };
    } catch (e) {
      const msg = String(e?.message || "");
      if (e?.name === "AbortError" || /aborted/i.test(msg)) {
        const err = new Error(`Helix timeout (${timeoutMs}ms)`);
        err.status = 0;
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(t);
    }
  }

  async function helixGetBroadcasterId(login, clientId, token) {
    const ch = String(login || "").trim().replace(/^@/, "").toLowerCase();
    if (!ch) return "";
    const res = await helixFetch(`users?login=${encodeURIComponent(ch)}`, { method: "GET", clientId, token });
    const user = Array.isArray(res?.data?.data) ? res.data.data[0] : null;
    return String(user?.id || "").trim();
  }

  async function helixSetTitle(broadcasterId, title, clientId, token) {
    const bid = String(broadcasterId || "").trim();
    const t = String(title || "").trim();
    if (!bid || !t) return { ok: false, error: "missing_bid_or_title" };

    await helixFetch(`channels?broadcaster_id=${encodeURIComponent(bid)}`, {
      method: "PATCH",
      clientId,
      token,
      body: { title: t },
      timeoutMs: 20000
    });

    return { ok: true };
  }

  function setHelixBackoff(err) {
    const now = Date.now();
    if (err && (err.status === 429) && err.retryMs) {
      helixRetryAfterAt = now + clamp(err.retryMs | 0, 1000, 180000);
      setTitleStatus(`Helix 429 · backoff ${Math.ceil((helixRetryAfterAt - now) / 1000)}s`, false);
    } else if (err && err.status === 0) {
      setTitleStatus(String(err.message || "Helix timeout"), false);
    } else {
      setTitleStatus(String(err?.message || "Helix error"), false);
    }
  }

  async function helixEnsureBroadcasterId(login, cfg) {
    const c = cfg || helixCfg || loadHelixCfg();
    if (c.broadcasterId) return c.broadcasterId;

    const ch = String(login || "").trim().replace(/^@/, "").toLowerCase();
    if (!ch) return "";

    if (helixResolvedBroadcasterId && helixResolvedForLogin === ch) return helixResolvedBroadcasterId;

    const bid = await helixGetBroadcasterId(ch, c.clientId, c.token);
    helixResolvedBroadcasterId = bid || "";
    helixResolvedForLogin = ch;

    // espejo en input (sin pisar si estás editando)
    if (ctlTitleBroadcasterId && bid) safeSetValue(ctlTitleBroadcasterId, bid);

    return bid || "";
  }

  // ───────────────────────── Bot IRC (OAuth)
  const BOT_DEFAULTS = {
    enabled: false,
    user: "",
    token: "",
    channel: ""
  };

  function normalizeBotCfg(inCfg) {
    const c = Object.assign({}, BOT_DEFAULTS, (inCfg || {}));
    c.enabled = (c.enabled === true) || (c.enabled === 1) || (c.enabled === "on");
    c.user = String(c.user || c.username || "").trim().replace(/^@/, "");
    c.token = String(c.token || "").trim();
    c.channel = String(c.channel || c.twitch || c.twitchChannel || "").trim().replace(/^@/, "");
    c.sayOnAd = (inCfg && (inCfg.sayOnAd === false)) ? false : true;
    return c;
  }

  function loadBotCfg() {
    try {
      const raw = lsGet(BOT_STORE_KEY);
      if (raw) return normalizeBotCfg(JSON.parse(raw));
    } catch (_) {}
    try {
      const raw = lsGet(BOT_STORE_KEY_BASE);
      if (raw) return normalizeBotCfg(JSON.parse(raw));
    } catch (_) {}
    return normalizeBotCfg(BOT_DEFAULTS);
  }

  function saveBotCfg(cfg) {
    const c = normalizeBotCfg(cfg);
    const raw = JSON.stringify(c);
    lsSet(BOT_STORE_KEY, raw);
    lsSet(BOT_STORE_KEY_BASE, raw);
    return c;
  }

  let botCfg = loadBotCfg();

  class TwitchOAuthBot {
    constructor(cfg) {
      this.cfg = cfg;
      this.ws = null;
      this.closed = false;
      this.queue = [];
      this.sending = false;
      this.reconnectTimer = null;
      this.lastSendAt = 0;
      this.onStatus = null;
    }

    connect() {
      const c = this.cfg;
      const user = String(c.user || "").trim();
      const tok = String(c.token || "").trim();
      const ch = String(c.channel || "").trim();
      if (!user || !tok || !ch) {
        this._status("Bot: faltan credenciales", false);
        return;
      }

      this.closed = false;

      try { this.ws?.close?.(); } catch (_) {}
      this.ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");

      this.ws.onopen = () => {
        this._status("Bot: conectando…", true);
        try {
          this.ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands\r\n");
          this.ws.send(`PASS oauth:${tok.replace(/^oauth:/i, "")}\r\n`);
          this.ws.send(`NICK ${user}\r\n`);
          this.ws.send(`JOIN #${ch.toLowerCase()}\r\n`);
        } catch (_) {}
        this._flushSoon();
      };

      this.ws.onmessage = (ev) => {
        const text = String(ev.data || "");
        const lines = text.split("\r\n").filter(Boolean);
        for (const line of lines) {
          if (line.startsWith("PING")) {
            try { this.ws?.send?.("PONG :tmi.twitch.tv\r\n"); } catch (_) {}
          }
          // si quieres, aquí puedes parsear NOTICEs
        }
      };

      this.ws.onerror = () => {};

      this.ws.onclose = () => {
        if (this.closed) return;
        this._status("Bot: desconectado (reintento)", false);
        this._scheduleReconnect();
      };
    }

    close() {
      this.closed = true;
      try { if (this.reconnectTimer) clearTimeout(this.reconnectTimer); } catch (_) {}
      this.reconnectTimer = null;
      this.queue = [];
      this.sending = false;
      try { this.ws?.close?.(); } catch (_) {}
      this.ws = null;
      this._status("Bot: OFF", false);
    }

    _scheduleReconnect() {
      try { if (this.reconnectTimer) clearTimeout(this.reconnectTimer); } catch (_) {}
      this.reconnectTimer = setTimeout(() => {
        if (this.closed) return;
        this.connect();
      }, 2500);
    }

    _status(text, ok) {
      try { this.onStatus?.(text, ok); } catch (_) {}
    }

    enqueueSay(text) {
      const msg = String(text || "").trim();
      if (!msg) return false;
      this.queue.push(msg.slice(0, 480));
      this._flushSoon();
      return true;
    }

    _flushSoon() {
      if (this.sending) return;
      this.sending = true;
      setTimeout(() => this._flushLoop(), 20);
    }

    _flushLoop() {
      if (this.closed) { this.sending = false; return; }
      const ws = this.ws;
      if (!ws || ws.readyState !== 1) { this.sending = false; return; }

      const now = Date.now();
      const minGap = 1400; // anti-rate
      const wait = Math.max(0, minGap - (now - this.lastSendAt));
      if (wait > 0) {
        setTimeout(() => this._flushLoop(), wait + 5);
        return;
      }

      const msg = this.queue.shift();
      if (!msg) { this.sending = false; return; }

      try {
        ws.send(`PRIVMSG #${String(this.cfg.channel).toLowerCase()} :${msg}\r\n`);
        this.lastSendAt = Date.now();
        this._status("Bot: OK", true);
      } catch (_) {}

      setTimeout(() => this._flushLoop(), 10);
    }
  }

  let bot = null;

  function botApplyCfgAndMaybeConnect() {
    botCfg = loadBotCfg();
    if (!botCfg.enabled) {
      try { bot?.close?.(); } catch (_) {}
      bot = null;
      setBotStatus("Bot: OFF", false);
      return;
    }

    if (!bot) {
      bot = new TwitchOAuthBot(botCfg);
      bot.onStatus = (t, ok) => setBotStatus(t, ok);
      bot.connect();
      return;
    }

    // si existe, actualiza cfg y reconecta
    bot.cfg = botCfg;
    bot.connect();
  }

  function botSay(text) {
    if (!botCfg?.enabled) return false;
    if (!bot || !bot.ws || bot.ws.readyState !== 1) return false;

    const msg = String(text || "").trim();
    if (!msg) return false;

    const now = Date.now();
    const sig = sigOf(msg);

    // anti spam básico
    if ((now - lastBotSayAt) < 1200) return false;
    if (sig && sig === lastBotSaySig && (now - lastBotSayAt) < 15000) return false;

    lastBotSayAt = now;
    lastBotSaySig = sig;

    bot.enqueueSay(msg);
    return true;
  }

  // ───────────────────────── URL builder (player)
  function boolParam(v) { return v ? "1" : "0"; }

  function getBasePlayerUrl() {
    // asume que player está en index.html del mismo repo.
    // si tú usas otro nombre, cámbialo aquí.
    const u = new URL(location.href);
    u.pathname = u.pathname.replace(/\/control\.html?$/i, "/index.html");
    u.search = "";
    u.hash = "";
    return u;
  }

  function buildStreamUrlFromUI() {
    const u = getBasePlayerUrl();

    // base
    const mins = clamp(parseInt(ctlMins?.value || "5", 10) || 5, 1, 120);
    const fit = String(ctlFit?.value || "cover").toLowerCase() === "contain" ? "contain" : "cover";
    const hud = (ctlHud ? (ctlHud.value !== "off") : true);
    const hudDetails = (ctlHudDetails ? (ctlHudDetails.value !== "off") : true);
    const autoskip = (ctlAutoskip ? (ctlAutoskip.value !== "off") : true);
    const adfree = (ctlAdfree ? (ctlAdfree.value !== "off") : false);

    // twitch/vote
    const twitch = String(ctlTwitchChannel?.value || "").trim().replace(/^@/, "");
    const voteOn = (ctlVoteOn ? (ctlVoteOn.value !== "off") : false);
    const voteOverlay = (ctlVoteOverlay ? (ctlVoteOverlay.value !== "off") : true);
    const voteWindow = clamp(parseInt(ctlVoteWindow?.value || "60", 10) || 60, 5, 180);
    const voteAt = clamp(parseInt(ctlVoteAt?.value || "60", 10) || 60, 5, 600);
    const voteLead = clamp(parseInt(ctlVoteLead?.value || "0", 10) || 0, 0, 30);
    const voteCmd = String(ctlVoteCmd?.value || "!next,!cam|!stay,!keep").trim();

    const stayMins = clamp(parseInt(ctlStayMins?.value || "5", 10) || 5, 1, 120);
    const ytCookies = (ctlYtCookies ? (ctlYtCookies.value !== "off") : true);

    // chat/alerts
    const chatOn = (ctlChatOn ? (ctlChatOn.value !== "off") : true);
    const chatHide = (ctlChatHideCmd ? (ctlChatHideCmd.value !== "off") : true);
    const alertsOn = (ctlAlertsOn ? (ctlAlertsOn.value !== "off") : true);

    // ads
    const adsOn = (ctlAdsOn ? (ctlAdsOn.value !== "off") : true);
    const adLead = clamp(parseInt(ctlAdLead?.value || "30", 10) || 30, 0, 300);
    const adDur = clamp(parseInt(ctlAdDur?.value || "30", 10) || 30, 5, 3600);
    const adShowDuring = (ctlAdShowDuring ? (ctlAdShowDuring.value !== "off") : true);
    const adChatText = String(ctlAdChatText?.value || "").trim();

    // ticker cfg (en URL para overlays)
    const tcfg = readTickerUI();
    const ccfg = readCountdownUI();

    // params
    u.searchParams.set("mins", String(mins));
    u.searchParams.set("fit", fit);
    u.searchParams.set("hud", boolParam(hud));
    // (hudDetails no existe en player, pero no molesta si lo quieres usar en CSS/HTML)
    u.searchParams.set("hudDetails", boolParam(hudDetails));

    u.searchParams.set("autoskip", boolParam(autoskip));
    if (adfree) u.searchParams.set("mode", "adfree");

    if (KEY) u.searchParams.set("key", KEY);

    if (twitch) u.searchParams.set("twitch", twitch);

    u.searchParams.set("vote", boolParam(!!voteOn));
    u.searchParams.set("voteOverlay", boolParam(!!voteOverlay));
    u.searchParams.set("voteWindow", String(voteWindow));
    u.searchParams.set("voteAt", String(voteAt));
    u.searchParams.set("voteLead", String(voteLead));
    if (voteCmd) u.searchParams.set("voteCmd", voteCmd);
    u.searchParams.set("stayMins", String(stayMins));

    u.searchParams.set("ytCookies", boolParam(!!ytCookies));

    u.searchParams.set("chat", boolParam(!!chatOn));
    u.searchParams.set("chatHideCommands", boolParam(!!chatHide));
    u.searchParams.set("alerts", boolParam(!!alertsOn));

    u.searchParams.set("ads", boolParam(!!adsOn));
    u.searchParams.set("adLead", String(adLead));
    u.searchParams.set("adDur", String(adDur)); // ✅ (aunque player no lo use, queda en URL)
    u.searchParams.set("adShowDuring", boolParam(!!adShowDuring));
    if (adChatText) u.searchParams.set("adChatText", adChatText);

    // ticker / countdown (si tu player los usa via otro script, ya queda listo)
    u.searchParams.set("ticker", boolParam(!!tcfg.enabled));
    u.searchParams.set("tickerLang", String(tcfg.lang || "auto"));
    u.searchParams.set("tickerSpeed", String(tcfg.speedPxPerSec || 55));
    u.searchParams.set("tickerRefresh", String(tcfg.refreshMins || 12));
    u.searchParams.set("tickerTop", String(tcfg.topPx || 10));
    u.searchParams.set("tickerHideOnVote", boolParam(!!tcfg.hideOnVote));
    u.searchParams.set("tickerSpan", String(tcfg.timespan || "1d"));

    u.searchParams.set("countdown", boolParam(!!ccfg.enabled));
    u.searchParams.set("countdownLabel", String(ccfg.label || "Fin de año"));
    u.searchParams.set("countdownTarget", String(ccfg.targetMs || 0));

    return u.toString();
  }

  // ───────────────────────── Incoming state/events/cmd (BOT_SAY)
  function applyState(st) {
    if (!st || typeof st !== "object") return;
    lastState = st;
    lastSeenAt = Date.now();

    const cam = st.cam || {};
    if (ctlNowTitle) ctlNowTitle.textContent = String(cam.title || "—");
    if (ctlNowPlace) ctlNowPlace.textContent = String(cam.place || "—");
    if (ctlNowTimer) ctlNowTimer.textContent = fmtMMSS(st.remaining || 0);

    if (ctlOrigin) {
      const url = String(cam.originUrl || "");
      ctlOrigin.href = url || "#";
      ctlOrigin.style.pointerEvents = url ? "auto" : "none";
      ctlOrigin.style.opacity = url ? "1" : ".6";
    }

    // status pill
    setStatus(`Conectado · v${String(st.version || "?")} · ${String(st.owner ? "OWNER" : "VIEW")}`, true);

    // auto announce cam (si bot ON)
    tryAutoAnnounceCam(st);

    // refleja UI sin pisar si editas (básico)
    safeSetValue(ctlMins, st.mins ?? "");
    if (ctlFit && !isEditing(ctlFit)) ctlFit.value = (st.fit === "contain") ? "contain" : "cover";
    if (ctlAutoskip && !isEditing(ctlAutoskip)) ctlAutoskip.value = st.autoskip ? "on" : "off";
    if (ctlAdfree && !isEditing(ctlAdfree)) ctlAdfree.value = st.adfree ? "on" : "off";
    if (ctlHud && !isEditing(ctlHud)) ctlHud.value = st.hudHidden ? "off" : "on";

    if (ctlYtCookies && !isEditing(ctlYtCookies)) ctlYtCookies.value = st.ytCookies ? "on" : "off";

    // chat/alerts/vote/ads reflect
    if (st.vote && typeof st.vote === "object") {
      if (ctlTwitchChannel && !isEditing(ctlTwitchChannel) && st.vote.channel) ctlTwitchChannel.value = st.vote.channel;
      if (ctlVoteOn && !isEditing(ctlVoteOn)) ctlVoteOn.value = st.vote.enabled ? "on" : "off";
      if (ctlVoteOverlay && !isEditing(ctlVoteOverlay)) ctlVoteOverlay.value = st.vote.overlay ? "on" : "off";
    }

    // preview
    syncPreviewUrl();
  }

  function applyEvent(ev) {
    if (!ev || typeof ev !== "object") return;
    const ts = (ev.ts | 0) || 0;
    if (ts && ts <= lastEventTs) return;
    if (ts) lastEventTs = ts;

    // bridge ads -> bot (si está activado)
    if (String(ev.name || "") === "AD_AUTO_NOTICE") {
      if (botCfg?.enabled && botCfg?.sayOnAd) {
        botSay("⚠️ Anuncio en breve… ¡gracias por apoyar el canal! 💜");
      }
    }
    if (String(ev.name || "") === "AD_AUTO_BEGIN") {
      if (botCfg?.enabled && botCfg?.sayOnAd) {
        // si en UI hay texto custom, úsalo
        const txt = String(ctlAdChatText?.value || "").trim();
        if (txt) botSay(txt);
      }
    }
  }

  function applyIncomingCmd(msg) {
    // solo nos interesa BOT_SAY desde el player
    if (!msg || typeof msg !== "object") return;
    if (msg.type !== "cmd") return;

    const cmd = String(msg.cmd || "");
    if (cmd !== "BOT_SAY") return;

    const p = msg.payload || {};
    const text = String(p.text || "").trim();
    if (!text) return;

    botSay(text);
  }

  function readStateFromLS() {
    const raw = lsGet(STATE_KEY) || lsGet(STATE_KEY_LEGACY);
    const st = safeJson(raw, null);
    if (st && typeof st === "object") applyState(st);
  }

  function readEventFromLS() {
    const raw = lsGet(EVT_KEY) || lsGet(EVT_KEY_LEGACY);
    const ev = safeJson(raw, null);
    if (ev && typeof ev === "object") applyEvent(ev);
  }

  function readCmdFromLS() {
    const raw = lsGet(CMD_KEY) || lsGet(CMD_KEY_LEGACY);
    const msg = safeJson(raw, null);
    if (msg && typeof msg === "object") applyIncomingCmd(msg);
  }

  // ───────────────────────── Auto announce cam (anti-spam)
  function tryAutoAnnounceCam(st) {
    if (!botCfg?.enabled) return;

    const cam = st?.cam || {};
    const id = String(cam.id || "");
    if (!id) return;

    const now = Date.now();
    if (id === lastAnnouncedCamId && (now - lastAnnounceAt) < 60000) return;
    if ((now - lastAnnounceAt) < 9000) return;

    // solo cuando realmente cambia la cam
    if (lastAnnouncedCamId && id === lastAnnouncedCamId) return;

    const title = String(cam.title || "Live Cam").trim();
    const place = String(cam.place || "").trim();
    const src = String(cam.source || "").trim();

    lastAnnouncedCamId = id;
    lastAnnounceAt = now;

    const msg = `🌍 Ahora: ${title}${place ? ` — ${place}` : ""}${src ? ` · ${src}` : ""}`;
    botSay(msg);
  }

  // ───────────────────────── UI actions
  function syncPreviewUrl() {
    if (!ctlPreviewOn || !ctlPreviewWrap || !ctlPreview) return;
    const on = (ctlPreviewOn.value !== "off");
    ctlPreviewWrap.style.display = on ? "" : "none";
    if (!on) return;

    const url = buildStreamUrlFromUI();
    try { ctlPreview.src = url; } catch (_) {}
  }

  function applyBasicSettings() {
    // mins
    const mins = clamp(parseInt(ctlMins?.value || "5", 10) || 5, 1, 120);
    sendCmd("SET_MINS", { mins });

    // fit
    const fit = String(ctlFit?.value || "cover").toLowerCase();
    sendCmd("SET_FIT", { fit });

    // hud (en player: doble click oculta, aquí: on/off -> hidden)
    if (ctlHud) sendCmd("HUD", { hidden: (ctlHud.value === "off") });

    // autoskip / adfree
    if (ctlAutoskip) sendCmd("SET_AUTOSKIP", { enabled: (ctlAutoskip.value !== "off") });
    if (ctlAdfree) sendCmd("SET_MODE", { mode: (ctlAdfree.value !== "off") ? "adfree" : "" });

    // yt cookies
    if (ctlYtCookies) sendCmd("YT_COOKIES", { enabled: (ctlYtCookies.value !== "off") });

    syncPreviewUrl();
  }

  function applyVoteSettings() {
    const twitch = String(ctlTwitchChannel?.value || "").trim().replace(/^@/, "");
    if (twitch) sendCmd("SET_TWITCH", { channel: twitch });

    const voteEnabled = ctlVoteOn ? (ctlVoteOn.value !== "off") : false;
    const overlay = ctlVoteOverlay ? (ctlVoteOverlay.value !== "off") : true;

    const timing = computeVoteTiming();

    const cmdStr = String(ctlVoteCmd?.value || "!next,!cam|!stay,!keep").trim();
    const stayMins = clamp(parseInt(ctlStayMins?.value || "5", 10) || 5, 1, 120);

    sendCmd("SET_VOTE", {
      enabled: voteEnabled,
      overlay,
      windowSec: timing.windowSec,
      voteAtSec: timing.voteAtSec,
      leadSec: timing.leadSec,
      uiSec: timing.uiSec,
      stayMins,
      cmd: cmdStr
    });

    syncPreviewUrl();
  }

  function applyChatAlertsSettings() {
    if (ctlChatOn) sendCmd("SET_CHAT", { enabled: (ctlChatOn.value !== "off") });
    if (ctlChatHideCmd) sendCmd("SET_CHAT", { hideCommands: (ctlChatHideCmd.value !== "off") });
    if (ctlAlertsOn) sendCmd("SET_ALERTS", { enabled: (ctlAlertsOn.value !== "off") });
  }

  function applyAdsSettings() {
    const enabled = ctlAdsOn ? (ctlAdsOn.value !== "off") : true;
    const adLead = clamp(parseInt(ctlAdLead?.value || "30", 10) || 30, 0, 300);
    const adDurSec = clamp(parseInt(ctlAdDur?.value || "30", 10) || 30, 5, 3600);
    const showDuring = ctlAdShowDuring ? (ctlAdShowDuring.value !== "off") : true;
    const chatText = String(ctlAdChatText?.value || "").trim();

    // player no usa adDurSec dentro de SET_ADS, pero lo guardamos para botones y URL
    sendCmd("SET_ADS", { enabled, adLead, showDuring, chatText });

    // guardamos “duración” en un store simple (no rompe nada)
    try { lsSet((KEY ? `rlc_ads_dur_v1:${KEY}` : "rlc_ads_dur_v1"), JSON.stringify({ adDurSec })); } catch (_) {}

    syncPreviewUrl();
  }

  function loadAdDurStore() {
    try {
      const raw = lsGet(KEY ? `rlc_ads_dur_v1:${KEY}` : "rlc_ads_dur_v1");
      const j = raw ? JSON.parse(raw) : null;
      const d = clamp(parseInt(String(j?.adDurSec || "0"), 10) || 0, 5, 3600);
      return d || 30;
    } catch (_) { return 30; }
  }

  function adNoticeNow() {
    const sec = clamp(parseInt(ctlAdLead?.value || "30", 10) || 30, 0, 3600);
    sendCmd("AD_NOTICE", { leadSec: sec });
  }

  function adBeginNow() {
    const d = clamp(parseInt(ctlAdDur?.value || String(loadAdDurStore()), 10) || 30, 5, 3600);
    sendCmd("AD_BEGIN", { durationSec: d });
    // si tienes texto, lo manda el player con BOT_SAY, pero por si acaso:
    const txt = String(ctlAdChatText?.value || "").trim();
    if (txt) botSay(txt);
  }

  function adClearNow() {
    sendCmd("AD_CLEAR", {});
  }

  function doGoSelected() {
    const id = ctlSelect?.value;
    if (!id) return;
    sendCmd("GOTO", { id });
  }

  function doBanSelectedOrCurrent() {
    const id = ctlSelect?.value;
    if (id) sendCmd("BAN", { id });
    else sendCmd("BAN_CURRENT", {});
  }

  function doReset() {
    sendCmd("RESET", {});
  }

  function syncBotUIFromStore() {
    botCfg = loadBotCfg();
    if (ctlBotOn) ctlBotOn.value = botCfg.enabled ? "on" : "off";
    if (ctlBotUser) ctlBotUser.value = botCfg.user || "";
    if (ctlBotToken) ctlBotToken.value = botCfg.token ? "********" : ""; // no re-muestres token real
    if (ctlBotSayOnAd) ctlBotSayOnAd.value = (botCfg.sayOnAd !== false) ? "on" : "off";
    setBotStatus(botCfg.enabled ? "Bot: listo" : "Bot: OFF", !!botCfg.enabled);
  }

  function readBotUIAndSave() {
    const enabled = ctlBotOn ? (ctlBotOn.value !== "off") : false;
    const user = String(ctlBotUser?.value || "").trim().replace(/^@/, "");
    const chan = String(ctlTwitchChannel?.value || "").trim().replace(/^@/, "");

    // token: si hay "********" no lo tocamos
    let token = String(botCfg.token || "");
    const tokenUI = String(ctlBotToken?.value || "").trim();
    if (tokenUI && tokenUI !== "********") token = tokenUI.replace(/^oauth:/i, "");
    const sayOnAd = ctlBotSayOnAd ? (ctlBotSayOnAd.value !== "off") : true;

    botCfg = saveBotCfg({ enabled, user, token, channel: chan, sayOnAd });
    syncBotUIFromStore();
    botApplyCfgAndMaybeConnect();

    // importante: que el player pueda leer canal desde BOT_STORE (OWNER_MODE)
    try { lsSet(BOT_STORE_KEY, JSON.stringify(botCfg)); lsSet(BOT_STORE_KEY_BASE, JSON.stringify(botCfg)); } catch (_) {}

    // también empuja twitch al player
    if (chan) sendCmd("SET_TWITCH", { channel: chan });
    syncPreviewUrl();
  }

  function readTickerReset() {
    tickerCfg = saveTickerCfg(TICKER_DEFAULTS);
    syncTickerUIFromStore();
    sendTickerCfg(tickerCfg, true);
    syncPreviewUrl();
  }

  function applyTickerNow() {
    const cfg = readTickerUI();
    tickerCfg = saveTickerCfg(cfg);
    setTickerStatusFromCfg(tickerCfg);
    sendTickerCfg(tickerCfg, true);
    syncPreviewUrl();
  }

  function readCountdownReset() {
    countdownCfg = saveCountdownCfg(COUNTDOWN_DEFAULTS);
    syncCountdownUIFromStore();
    sendCountdownCfg(countdownCfg, true);
    syncPreviewUrl();
  }

  function applyCountdownNow() {
    const cfg = readCountdownUI();
    countdownCfg = saveCountdownCfg(cfg);
    setCountdownStatusFromCfg(countdownCfg);
    sendCountdownCfg(countdownCfg, true);
    syncPreviewUrl();
  }

  // ───────────────────────── Helix auto title runner
  function helixCanRun(c) {
    const cfg = c || helixCfg;
    if (!cfg?.enabled) return false;
    if (!cfg.clientId || !cfg.token) return false;
    // broadcasterId puede resolverse por login si no está
    const login = String(ctlTwitchChannel?.value || lastState?.vote?.channel || "").trim();
    return !!login;
  }

  async function helixTick(force = false) {
    const cfg = helixCfg || loadHelixCfg();
    if (!helixCanRun(cfg)) return;

    const now = Date.now();
    if (!force) {
      if (now < helixRetryAfterAt) return;
      if ((now - helixLastUpdateAt) < (cfg.cooldownSec * 1000)) return;
    }

    if (!lastState) return;
    const login = String(ctlTwitchChannel?.value || lastState?.vote?.channel || "").trim().replace(/^@/, "");
    if (!login) return;

    const title = buildTitleFromState(lastState, cfg.template);
    const sig = sigOf(`${login}|${title}`);

    // anti-spam: no intentar cada tick lo mismo
    if (!force) {
      if (sig === helixLastSig && (now - helixLastUpdateAt) < (cfg.cooldownSec * 1000)) return;
      if (sig === helixLastAttemptSig && (now - helixLastAttemptAt) < 6000) return;
    }

    helixLastAttemptAt = now;
    helixLastAttemptSig = sig;

    try {
      const bid = cfg.broadcasterId || await helixEnsureBroadcasterId(login, cfg);
      if (!bid) { setTitleStatus("Helix: falta broadcaster_id", false); return; }

      await helixSetTitle(bid, title, cfg.clientId, cfg.token);

      helixLastUpdateAt = Date.now();
      helixLastSig = sig;
      setTitleStatus("Auto título: OK", true);
    } catch (e) {
      setHelixBackoff(e);
    }
  }

  function helixApplyFromUI() {
    helixCfg = saveHelixCfg(readHelixUI());
    syncHelixUIFromStore();
    // reset backoff si lo activas
    helixRetryAfterAt = 0;
    helixTick(true);
  }

  function helixResetUI() {
    helixCfg = saveHelixCfg(HELIX_DEFAULTS);
    helixResolvedBroadcasterId = "";
    helixResolvedForLogin = "";
    helixRetryAfterAt = 0;
    syncHelixUIFromStore();
  }

  function helixTestOnce() {
    helixCfg = saveHelixCfg(readHelixUI());
    syncHelixUIFromStore();
    helixTick(true);
  }

  // ───────────────────────── Hotkeys (safe)
  function bindHotkeys() {
    window.addEventListener("keydown", (e) => {
      if (isTextInputActive()) return;

      const k = String(e.key || "");
      if (k === "ArrowRight") { e.preventDefault(); sendCmd("NEXT", {}); }
      else if (k === "ArrowLeft") { e.preventDefault(); sendCmd("PREV", {}); }
      else if (k === " ") { e.preventDefault(); sendCmd("TOGGLE_PLAY", {}); }
      else if (k.toLowerCase() === "r") { e.preventDefault(); sendCmd("RESHUFFLE", {}); }
      else if (k.toLowerCase() === "b") { e.preventDefault(); sendCmd("BAN_CURRENT", {}); }
    }, { passive: false });
  }

  // ───────────────────────── Boot + listeners
  function bindUi() {
    // list
    syncList("");
    syncBgmTracks();

    // search
    if (ctlSearch) ctlSearch.addEventListener("input", debounce(() => syncList(ctlSearch.value), 120));

    // nav
    if (ctlPrev) ctlPrev.addEventListener("click", () => sendCmd("PREV", {}));
    if (ctlPlay) ctlPlay.addEventListener("click", () => sendCmd("TOGGLE_PLAY", {}));
    if (ctlNext) ctlNext.addEventListener("click", () => sendCmd("NEXT", {}));
    if (ctlShuffle) ctlShuffle.addEventListener("click", () => sendCmd("RESHUFFLE", {}));

    if (ctlApplyMins) ctlApplyMins.addEventListener("click", () => {
      const mins = clamp(parseInt(ctlMins?.value || "5", 10) || 5, 1, 120);
      sendCmd("SET_MINS", { mins });
      syncPreviewUrl();
    });

    if (ctlApplySettings) ctlApplySettings.addEventListener("click", applyBasicSettings);

    // go/ban/reset
    if (ctlGo) ctlGo.addEventListener("click", doGoSelected);
    if (ctlBan) ctlBan.addEventListener("click", doBanSelectedOrCurrent);
    if (ctlReset) ctlReset.addEventListener("click", doReset);

    // preview
    if (ctlPreviewOn) ctlPreviewOn.addEventListener("change", syncPreviewUrl);

    // url copy
    if (ctlCopyStreamUrl) ctlCopyStreamUrl.addEventListener("click", async () => {
      const url = buildStreamUrlFromUI();
      const ok = await copyToClipboard(url);
      setStatus(ok ? "URL copiada ✅" : "No se pudo copiar ❌", ok);
    });

    // vote
    if (ctlVoteApply) ctlVoteApply.addEventListener("click", applyVoteSettings);
    if (ctlVoteStart) ctlVoteStart.addEventListener("click", () => {
      const timing = computeVoteTiming();
      sendCmd("START_VOTE", { windowSec: timing.windowSec, leadSec: timing.leadSec });
    });

    // chat/alerts
    if (ctlChatOn) ctlChatOn.addEventListener("change", applyChatAlertsSettings);
    if (ctlChatHideCmd) ctlChatHideCmd.addEventListener("change", applyChatAlertsSettings);
    if (ctlAlertsOn) ctlAlertsOn.addEventListener("change", applyChatAlertsSettings);

    // ads
    if (ctlAdsOn) ctlAdsOn.addEventListener("change", applyAdsSettings);
    if (ctlAdLead) ctlAdLead.addEventListener("change", applyAdsSettings);
    if (ctlAdDur) ctlAdDur.addEventListener("change", applyAdsSettings);
    if (ctlAdShowDuring) ctlAdShowDuring.addEventListener("change", applyAdsSettings);
    if (ctlAdChatText) ctlAdChatText.addEventListener("change", debounce(applyAdsSettings, 250));

    if (ctlAdNoticeBtn) ctlAdNoticeBtn.addEventListener("click", adNoticeNow);
    if (ctlAdBeginBtn) ctlAdBeginBtn.addEventListener("click", adBeginNow);
    if (ctlAdClearBtn) ctlAdClearBtn.addEventListener("click", adClearNow);

    // ticker
    if (ctlTickerApply) ctlTickerApply.addEventListener("click", applyTickerNow);
    if (ctlTickerReset) ctlTickerReset.addEventListener("click", readTickerReset);
    if (ctlTickerCopyUrl) ctlTickerCopyUrl.addEventListener("click", async () => {
      const url = buildStreamUrlFromUI();
      const ok = await copyToClipboard(url);
      setPill(ctlTickerStatus, ok ? "Ticker URL copiada ✅" : "No se pudo copiar ❌", ok);
    });

    // countdown
    if (ctlCountdownApply) ctlCountdownApply.addEventListener("click", applyCountdownNow);
    if (ctlCountdownReset) ctlCountdownReset.addEventListener("click", readCountdownReset);

    // helix
    if (ctlTitleApply) ctlTitleApply.addEventListener("click", helixApplyFromUI);
    if (ctlTitleTest) ctlTitleTest.addEventListener("click", helixTestOnce);
    if (ctlTitleReset) ctlTitleReset.addEventListener("click", helixResetUI);

    // bot
    if (ctlBotConnect) ctlBotConnect.addEventListener("click", readBotUIAndSave);
    if (ctlBotOn) ctlBotOn.addEventListener("change", readBotUIAndSave);
    if (ctlBotSayOnAd) ctlBotSayOnAd.addEventListener("change", readBotUIAndSave);

    if (ctlBotTestSend) ctlBotTestSend.addEventListener("click", () => {
      const txt = String(ctlBotTestText?.value || "✅ Bot test").trim();
      botSay(txt);
    });

    // BGM controls (si tu player los implementa como cmd)
    if (ctlBgmOn) ctlBgmOn.addEventListener("change", () => sendCmd("SET_BGM", { enabled: (ctlBgmOn.value !== "off") }));
    if (ctlBgmVol) ctlBgmVol.addEventListener("input", debounce(() => sendCmd("SET_BGM_VOL", { vol: parseFloat(ctlBgmVol.value || "0.22") || 0.22 }), 120));
    if (ctlBgmPrev) ctlBgmPrev.addEventListener("click", () => sendCmd("BGM_PREV", {}));
    if (ctlBgmPlay) ctlBgmPlay.addEventListener("click", () => sendCmd("BGM_PLAYPAUSE", {}));
    if (ctlBgmNext) ctlBgmNext.addEventListener("click", () => sendCmd("BGM_NEXT", {}));
    if (ctlBgmShuffle) ctlBgmShuffle.addEventListener("click", () => sendCmd("BGM_SHUFFLE", {}));
    if (ctlBgmTrack) ctlBgmTrack.addEventListener("change", () => {
      const idx = parseInt(ctlBgmTrack.value || "0", 10) || 0;
      // tu player usa índice interno (BGM_TRACK si lo tienes), si no, ignora:
      sendCmd("BGM_TRACK", { idx });
    });

    // live preview auto refresh on any UI change (ligero)
    const autoSync = debounce(syncPreviewUrl, 160);
    [
      ctlMins, ctlFit, ctlHud, ctlAutoskip, ctlAdfree, ctlTwitchChannel,
      ctlVoteOn, ctlVoteOverlay, ctlVoteWindow, ctlVoteAt, ctlVoteLead, ctlVoteCmd, ctlStayMins,
      ctlChatOn, ctlChatHideCmd, ctlAlertsOn,
      ctlAdsOn, ctlAdLead, ctlAdDur, ctlAdShowDuring, ctlAdChatText,
      ctlTickerOn, ctlTickerLang, ctlTickerSpeed, ctlTickerRefresh, ctlTickerTop, ctlTickerHideOnVote, ctlTickerSpan,
      ctlCountdownOn, ctlCountdownLabel, ctlCountdownTarget
    ].forEach(el => { try { el?.addEventListener?.("change", autoSync); } catch (_) {} });

    syncPreviewUrl();
  }

  function bindBus() {
    // BC
    try {
      if (bcMain) bcMain.onmessage = (ev) => {
        const msg = ev?.data;
        lastAnyMsgAt = Date.now();
        lastMainMsgAt = Date.now();
        if (!keyOk(msg, true)) return;

        if (msg?.type === "state") applyState(msg);
        else if (msg?.type === "event") applyEvent(msg);
        else if (msg?.type === "cmd") applyIncomingCmd(msg);
        else if (msg?.type === "TICKER_CFG") { /* opcional: podrías reflejar */ }
        else if (msg?.type === "COUNTDOWN_CFG") { /* opcional */ }
      };
    } catch (_) {}

    try {
      if (bcLegacy) bcLegacy.onmessage = (ev) => {
        const msg = ev?.data;
        lastAnyMsgAt = Date.now();
        if (!keyOk(msg, false)) return;

        if (msg?.type === "state") applyState(msg);
        else if (msg?.type === "event") applyEvent(msg);
        else if (msg?.type === "cmd") applyIncomingCmd(msg);
      };
    } catch (_) {}

    // storage fallback
    window.addEventListener("storage", (e) => {
      const k = String(e.key || "");
      if (!k) return;

      if (k === STATE_KEY || k === STATE_KEY_LEGACY) readStateFromLS();
      if (k === EVT_KEY || k === EVT_KEY_LEGACY) readEventFromLS();
      if (k === CMD_KEY || k === CMD_KEY_LEGACY) readCmdFromLS();

      if (k === TICKER_CFG_KEY || k === TICKER_CFG_KEY_BASE) syncTickerUIFromStore();
      if (k === COUNTDOWN_CFG_KEY || k === COUNTDOWN_CFG_KEY_BASE) syncCountdownUIFromStore();
      if (k === HELIX_CFG_KEY || k === HELIX_CFG_KEY_BASE) syncHelixUIFromStore();
      if (k === BOT_STORE_KEY || k === BOT_STORE_KEY_BASE) { syncBotUIFromStore(); botApplyCfgAndMaybeConnect(); }
    });
  }

  function heartbeat() {
    // si no vemos estado reciente, marca desconectado suave
    const now = Date.now();
    const age = now - (lastSeenAt || 0);

    if (age > 3500) setStatus("Sin señal… (abre el player)", false);

    // tick helix
    helixTick(false);
  }

  function boot() {
    // header info
    if (ctlBusName) ctlBusName.textContent = KEY ? `${BUS} (keyed)` : BUS;

    // stores -> UI
    syncTickerUIFromStore();
    syncCountdownUIFromStore();
    syncHelixUIFromStore();
    syncBotUIFromStore();

    // bot connect si procede
    botApplyCfgAndMaybeConnect();

    bindUi();
    bindHotkeys();
    bindBus();

    // leer estado inicial
    readStateFromLS();
    readEventFromLS();
    readCmdFromLS();

    // arranca heartbeat
    setInterval(heartbeat, 900);

    setStatus(`Control listo · v${APP_VERSION}`, true);
  }

  boot();
})();
