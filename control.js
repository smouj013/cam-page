/* control.js — RLC Control v2.3.6 (NEWSROOM/BROADCAST)
   ✅ FULL + HARDENED + NO DUPES + UPDATE-AWARE:
   - DOM-ready REAL (si carga en <head> sin defer, recachea IDs en boot) ✅
   - Anti-duplicidad entre versiones: singleton con destroy() (la nueva versión sustituye a la vieja) ✅
   - Fuerza modo control (body.mode-control) ✅
   - Null-safe extremo (IDs opcionales no rompen) ✅
   - BC + localStorage fallback + compat legacy ✅
   - Bot IRC (OAuth) + anti-spam ✅
   - ADS (lead + dur store) + bridge events -> bot ✅
   - Ticker cfg + Countdown cfg ✅
   - Helix Auto Title: timeout claro + 429 backoff real + anti-spam intentos ✅
   - Update awareness: SW update + mismatch player/control + click-to-reload ✅
   - NO toca ni borra datos existentes del bot ✅
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const APP_VERSION = String((typeof window !== "undefined" && window.APP_VERSION) || "2.3.6");

  // ───────────────────────── Version helpers
  function _verParts(v) {
    const m = String(v || "").trim().match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!m) return [0, 0, 0];
    return [parseInt(m[1], 10) || 0, parseInt(m[2], 10) || 0, parseInt(m[3], 10) || 0];
    }
  function compareVer(a, b) {
    const A = _verParts(a), B = _verParts(b);
    for (let i = 0; i < 3; i++) {
      if (A[i] > B[i]) return 1;
      if (A[i] < B[i]) return -1;
    }
    return 0;
  }

  // ───────────────────────── Singleton anti-dup (upgrade-safe)
  const SINGLETON_KEY = "__RLC_CONTROL_SINGLETON__";
  try {
    const existing = g[SINGLETON_KEY];
    if (existing && typeof existing === "object") {
      const prevVer = String(existing.version || "0.0.0");
      if (compareVer(prevVer, APP_VERSION) >= 0) {
        // Ya hay igual o más nuevo cargado => salimos
        return;
      }
      // Hay una versión anterior => desmontamos
      try { existing.destroy?.(); } catch (_) {}
    }
  } catch (_) {}

  const instance = {
    version: APP_VERSION,
    _disposed: false,
    destroy: null
  };
  try { g[SINGLETON_KEY] = instance; } catch (_) {}

  // ───────────────────────── Utils
  const qs = (s, r = document) => {
    try { return r.querySelector(s); } catch (_) { return null; }
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (v, fallback) => {
    const n = parseFloat(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  };
  const safeStr = (v) => (typeof v === "string") ? v.trim() : "";
  const safeJson = (raw, fallback = null) => { try { return JSON.parse(raw); } catch (_) { return fallback; } };
  const sigOf = (s) => String(s || "").trim().slice(0, 180);

  function onReady(fn) {
    if (document.readyState === "complete" || document.readyState === "interactive") {
      setTimeout(fn, 0);
    } else {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    }
  }

  // Disposers (anti-dupe real)
  const disposers = [];
  function listen(target, ev, fn, opt) {
    try {
      if (!target?.addEventListener) return;
      target.addEventListener(ev, fn, opt);
      disposers.push(() => {
        try { target.removeEventListener(ev, fn, opt); } catch (_) {}
      });
    } catch (_) {}
  }
  function safeOn(el, ev, fn, opt) { listen(el, ev, fn, opt); }

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
    try { el.value = String(v); } catch (_) {}
  }

  function debounce(fn, ms = 160) {
    let t = 0;
    return (...args) => {
      try { clearTimeout(t); } catch (_) {}
      t = setTimeout(() => {
        try { fn(...args); } catch (e) { console.error(e); }
      }, ms);
      // note: no disposer needed; timer dies with page
    };
  }

  function fmtMMSS(sec) {
    sec = Math.max(0, sec | 0);
    const m = (sec / 60) | 0;
    const s = sec - m * 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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

  // ───────────────────────── Force CONTROL mode (✅ cards visibles)
  function ensureControlMode() {
    try {
      const p = String(location.pathname || "").toLowerCase();
      const looksControl = p.endsWith("/control.html") || p.endsWith("control.html") || p.endsWith("/control");
      if (looksControl) document.body?.classList?.add("mode-control");

      if (document.body?.classList?.contains("mode-control")) {
        try { document.body.style.overflow = "auto"; } catch (_) {}
      }
    } catch (_) {}
  }

  // ───────────────────────── Base keys / params
  function parseParams() {
    const u = new URL(location.href);
    return {
      key: safeStr(u.searchParams.get("key") || ""),
      autoReload: safeStr(u.searchParams.get("autoReload") || ""), // "1" => auto reload when update detected
    };
  }
  const P = parseParams();
  const KEY = String(P.key || "").trim();
  const AUTO_RELOAD = (String(P.autoReload || "") === "1");

  const BUS_BASE = "rlc_bus_v1";
  const CMD_KEY_BASE = "rlc_cmd_v1";
  const STATE_KEY_BASE = "rlc_state_v1";
  const EVT_KEY_BASE = "rlc_evt_v1";

  const BOT_STORE_KEY_BASE = "rlc_bot_cfg_v1";
  const TICKER_CFG_KEY_BASE = "rlc_ticker_cfg_v1";
  const HELIX_CFG_KEY_BASE  = "rlc_helix_cfg_v1";
  const COUNTDOWN_CFG_KEY_BASE = "rlc_countdown_cfg_v1";

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
  const HELIX_CFG_KEY  = KEY ? `${HELIX_CFG_KEY_BASE}:${KEY}` : HELIX_CFG_KEY_BASE;
  const COUNTDOWN_CFG_KEY = KEY ? `${COUNTDOWN_CFG_KEY_BASE}:${KEY}` : COUNTDOWN_CFG_KEY_BASE;

  // BC (se cierran en destroy)
  const bcMain = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS) : null;
  const bcLegacy = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_LEGACY) : null;

  function busPost(msg) {
    try { if (bcMain) bcMain.postMessage(msg); } catch (_) {}
    try { if (bcLegacy) bcLegacy.postMessage(msg); } catch (_) {}
  }

  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }

  // anti-dupe cmd stamp (solo para recepción/control)
  let lastSeenCmdSig = "";
  let lastSeenCmdAt = 0;

  function sendCmd(cmd, payload = {}) {
    const msg = {
      type: "cmd",
      ts: Date.now(),
      mid: `${Date.now()}_${Math.random().toString(16).slice(2)}`, // ayuda dedupe
      cmd,
      payload: payload || {}
    };
    if (KEY) msg.key = KEY;

    const raw = JSON.stringify(msg);

    // Mantengo compat (keyed + legacy) pero el player debería dedupear por mid/ts.
    lsSet(CMD_KEY, raw);
    lsSet(CMD_KEY_LEGACY, raw);
    busPost(msg);
  }

  // ───────────────────────── DOM cache (✅ REAL DOM-ready safe)
  // Todos son "let" y se asignan en cacheDom() dentro de boot().
  let
    ctlStatus, ctlNowTitle, ctlNowPlace, ctlNowTimer, ctlOrigin,
    ctlPrev, ctlPlay, ctlNext, ctlShuffle,
    ctlMins, ctlApplyMins, ctlApplySettings, ctlFit, ctlHud, ctlHudDetails, ctlAutoskip, ctlAdfree, ctlReset,
    ctlSearch, ctlSelect, ctlGo, ctlBan,
    ctlPreviewOn, ctlPreviewWrap, ctlPreview,
    ctlCopyStreamUrl,
    ctlBgmOn, ctlBgmVol, ctlBgmTrack, ctlBgmPrev, ctlBgmPlay, ctlBgmNext, ctlBgmShuffle, ctlBgmNow,
    ctlTwitchChannel, ctlVoteOn, ctlVoteOverlay, ctlVoteWindow, ctlVoteAt, ctlVoteLead, ctlVoteCmd, ctlVoteStart, ctlVoteApply, ctlStayMins, ctlYtCookies,
    ctlChatOn, ctlChatHideCmd, ctlAlertsOn,
    ctlAdsOn, ctlAdLead, ctlAdDur, ctlAdShowDuring, ctlAdChatText, ctlAdNoticeBtn, ctlAdBeginBtn, ctlAdClearBtn,
    ctlBotOn, ctlBotUser, ctlBotToken, ctlBotConnect, ctlBotStatus, ctlBotSayOnAd, ctlBotTestText, ctlBotTestSend,
    ctlTickerOn, ctlTickerLang, ctlTickerSpeed, ctlTickerRefresh, ctlTickerTop, ctlTickerHideOnVote, ctlTickerSpan, ctlTickerApply, ctlTickerReset, ctlTickerStatus, ctlTickerCopyUrl,
    ctlCountdownOn, ctlCountdownLabel, ctlCountdownTarget, ctlCountdownApply, ctlCountdownReset, ctlCountdownStatus,
    ctlTitleOn, ctlTitleStatus, ctlTitleClientId, ctlTitleBroadcasterId, ctlTitleToken, ctlTitleTemplate, ctlTitleCooldown, ctlTitleApply, ctlTitleTest, ctlTitleReset,
    ctlBusName;

  function cacheDom() {
    // Status / now
    ctlStatus = qs("#ctlStatus");
    ctlNowTitle = qs("#ctlNowTitle");
    ctlNowPlace = qs("#ctlNowPlace");
    ctlNowTimer = qs("#ctlNowTimer");
    ctlOrigin = qs("#ctlOrigin");

    // nav
    ctlPrev = qs("#ctlPrev");
    ctlPlay = qs("#ctlPlay");
    ctlNext = qs("#ctlNext");
    ctlShuffle = qs("#ctlShuffle");

    // basic settings
    ctlMins = qs("#ctlMins");
    ctlApplyMins = qs("#ctlApplyMins");
    ctlApplySettings = qs("#ctlApplySettings");
    ctlFit = qs("#ctlFit");
    ctlHud = qs("#ctlHud");
    ctlHudDetails = qs("#ctlHudDetails");
    ctlAutoskip = qs("#ctlAutoskip");
    ctlAdfree = qs("#ctlAdfree");
    ctlReset = qs("#ctlReset");

    // search/select
    ctlSearch = qs("#ctlSearch");
    ctlSelect = qs("#ctlSelect");
    ctlGo = qs("#ctlGo");
    ctlBan = qs("#ctlBan");

    // preview
    ctlPreviewOn = qs("#ctlPreviewOn");
    ctlPreviewWrap = qs("#ctlPreviewWrap");
    ctlPreview = qs("#ctlPreview");

    ctlCopyStreamUrl = qs("#ctlCopyStreamUrl");

    // BGM
    ctlBgmOn = qs("#ctlBgmOn");
    ctlBgmVol = qs("#ctlBgmVol");
    ctlBgmTrack = qs("#ctlBgmTrack");
    ctlBgmPrev = qs("#ctlBgmPrev");
    ctlBgmPlay = qs("#ctlBgmPlay");
    ctlBgmNext = qs("#ctlBgmNext");
    ctlBgmShuffle = qs("#ctlBgmShuffle");
    ctlBgmNow = qs("#ctlBgmNow");

    // Twitch vote
    ctlTwitchChannel = qs("#ctlTwitchChannel");
    ctlVoteOn = qs("#ctlVoteOn");
    ctlVoteOverlay = qs("#ctlVoteOverlay");
    ctlVoteWindow = qs("#ctlVoteWindow");
    ctlVoteAt = qs("#ctlVoteAt");
    ctlVoteLead = qs("#ctlVoteLead");
    ctlVoteCmd = qs("#ctlVoteCmd");
    ctlVoteStart = qs("#ctlVoteStart");
    ctlVoteApply = qs("#ctlVoteApply");
    ctlStayMins = qs("#ctlStayMins");
    ctlYtCookies = qs("#ctlYtCookies");

    // Chat/Alerts
    ctlChatOn = qs("#ctlChatOn");
    ctlChatHideCmd = qs("#ctlChatHideCmd");
    ctlAlertsOn = qs("#ctlAlertsOn");

    // ADS
    ctlAdsOn = qs("#ctlAdsOn");
    ctlAdLead = qs("#ctlAdLead");
    ctlAdDur = qs("#ctlAdDur");
    ctlAdShowDuring = qs("#ctlAdShowDuring");
    ctlAdChatText = qs("#ctlAdChatText");
    ctlAdNoticeBtn = qs("#ctlAdNoticeBtn");
    ctlAdBeginBtn = qs("#ctlAdBeginBtn");
    ctlAdClearBtn = qs("#ctlAdClearBtn");

    // BOT
    ctlBotOn = qs("#ctlBotOn");
    ctlBotUser = qs("#ctlBotUser");
    ctlBotToken = qs("#ctlBotToken");
    ctlBotConnect = qs("#ctlBotConnect");
    ctlBotStatus = qs("#ctlBotStatus");
    ctlBotSayOnAd = qs("#ctlBotSayOnAd");
    ctlBotTestText = qs("#ctlBotTestText");
    ctlBotTestSend = qs("#ctlBotTestSend");

    // Ticker
    ctlTickerOn = qs("#ctlTickerOn");
    ctlTickerLang = qs("#ctlTickerLang");
    ctlTickerSpeed = qs("#ctlTickerSpeed");
    ctlTickerRefresh = qs("#ctlTickerRefresh");
    ctlTickerTop = qs("#ctlTickerTop");
    ctlTickerHideOnVote = qs("#ctlTickerHideOnVote");
    ctlTickerSpan = qs("#ctlTickerSpan");
    ctlTickerApply = qs("#ctlTickerApply");
    ctlTickerReset = qs("#ctlTickerReset");
    ctlTickerStatus = qs("#ctlTickerStatus");
    ctlTickerCopyUrl = qs("#ctlTickerCopyUrl");

    // Countdown
    ctlCountdownOn = qs("#ctlCountdownOn");
    ctlCountdownLabel = qs("#ctlCountdownLabel");
    ctlCountdownTarget = qs("#ctlCountdownTarget");
    ctlCountdownApply = qs("#ctlCountdownApply");
    ctlCountdownReset = qs("#ctlCountdownReset");
    ctlCountdownStatus = qs("#ctlCountdownStatus");

    // Helix auto title
    ctlTitleOn = qs("#ctlTitleOn") || qs("#ctlHelixOn");
    ctlTitleStatus = qs("#ctlTitleStatus") || qs("#ctlHelixStatus");
    ctlTitleClientId = qs("#ctlTitleClientId") || qs("#ctlHelixClientId");
    ctlTitleBroadcasterId = qs("#ctlTitleBroadcasterId");
    ctlTitleToken = qs("#ctlTitleToken") || qs("#ctlHelixToken");
    ctlTitleTemplate = qs("#ctlTitleTemplate") || qs("#ctlHelixTpl");
    ctlTitleCooldown = qs("#ctlTitleCooldown") || qs("#ctlHelixCooldown");
    ctlTitleApply = qs("#ctlTitleApply") || qs("#ctlHelixApply");
    ctlTitleTest = qs("#ctlTitleTest") || qs("#ctlHelixTest");
    ctlTitleReset = qs("#ctlTitleReset");

    // footer
    ctlBusName = qs("#ctlBusName");
  }

  // Data lists (se refrescan en boot/heartbeat)
  let allCams = [];
  let bgmList = [];
  let _lastCamRef = null;
  let _lastBgmRef = null;

  function refreshGlobalLists(force = false) {
    try {
      const camRef = Array.isArray(g.CAM_LIST) ? g.CAM_LIST : null;
      const bgmRef = Array.isArray(g.BGM_LIST) ? g.BGM_LIST : null;

      const camChanged = force || (camRef && camRef !== _lastCamRef);
      const bgmChanged = force || (bgmRef && bgmRef !== _lastBgmRef);

      if (camChanged) {
        _lastCamRef = camRef;
        allCams = camRef ? camRef.slice() : [];
      }
      if (bgmChanged) {
        _lastBgmRef = bgmRef;
        bgmList = bgmRef ? bgmRef.slice() : [];
      }

      if (camChanged) syncList(String(ctlSearch?.value || ""));
      if (bgmChanged) syncBgmTracks();
    } catch (_) {}
  }

  // State cache
  let lastState = null;
  let lastSeenAt = 0;

  // Event ordering
  let lastEventTs = 0;

  // Bot say guards
  let lastBotSayAt = 0;
  let lastBotSaySig = "";

  // Auto announce cam
  let lastAnnouncedCamId = "";
  let lastAnnounceAt = 0;

  // Legacy compat window
  let allowLegacyNoKey = true;
  const allowLegacyNoKeyUntil = Date.now() + 6500;

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

  // ───────────────────────── UI status helpers
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
  const setStatus = (t, ok = true) => setPill(ctlStatus, t, ok);
  const setBotStatus = (t, ok = true) => setPill(ctlBotStatus, t, ok);
  const setTitleStatus = (t, ok = true) => setPill(ctlTitleStatus, t, ok);

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

  function label(cam) {
    const t = cam?.title || "Live Cam";
    const p = cam?.place || "";
    return p ? `${t} — ${p}` : t;
  }

  function syncList(filter = "") {
    if (!ctlSelect) return;
    const f = String(filter || "").trim().toLowerCase();

    try { ctlSelect.innerHTML = ""; } catch (_) {}

    const frag = document.createDocumentFragment();
    for (const cam of allCams) {
      const hay = `${cam?.title || ""} ${cam?.place || ""} ${cam?.source || ""}`.toLowerCase();
      if (f && !hay.includes(f)) continue;
      const opt = document.createElement("option");
      opt.value = cam.id;
      opt.textContent = label(cam);
      frag.appendChild(opt);
    }
    try { ctlSelect.appendChild(frag); } catch (_) {}
  }

  function syncBgmTracks() {
    if (!ctlBgmTrack) return;
    try { ctlBgmTrack.innerHTML = ""; } catch (_) {}
    const frag = document.createDocumentFragment();

    if (!bgmList.length) {
      const opt = document.createElement("option");
      opt.value = "0";
      opt.textContent = "— (sin playlist)";
      frag.appendChild(opt);
      try { ctlBgmTrack.appendChild(frag); } catch (_) {}
      return;
    }

    for (let i = 0; i < bgmList.length; i++) {
      const t = bgmList[i];
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = t?.title ? t.title : `Track ${i + 1}`;
      frag.appendChild(opt);
    }
    try { ctlBgmTrack.appendChild(frag); } catch (_) {}
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
  let helixResolvedForLogin = "";

  // anti-spam/backoff
  let helixLastAttemptAt = 0;
  let helixLastAttemptSig = "";
  let helixRetryAfterAt = 0;

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

    if (ctlTitleBroadcasterId && bid) safeSetValue(ctlTitleBroadcasterId, bid);

    return bid || "";
  }

  function helixCanRun(c) {
    const cfg = c || helixCfg;
    if (!cfg?.enabled) return false;
    if (!cfg.clientId || !cfg.token) return false;
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
    helixRetryAfterAt = 0;
    helixTick(true).catch(() => {});
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
    helixTick(true).catch(() => {});
  }

  // ───────────────────────── Bot IRC (OAuth)
  const BOT_DEFAULTS = { enabled: false, user: "", token: "", channel: "" };

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
      const minGap = 1400;
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
    const u = new URL(location.href);
    const p = String(u.pathname || "");

    if (/\/control\.html$/i.test(p)) u.pathname = p.replace(/\/control\.html$/i, "/index.html");
    else if (/\/control$/i.test(p)) u.pathname = p.replace(/\/control$/i, "/index.html");
    else if (!/\/index\.html$/i.test(p)) {
      u.pathname = p.replace(/\/[^/]*$/i, "/index.html");
    }

    u.search = "";
    u.hash = "";
    return u;
  }

  function buildStreamUrlFromUI() {
    const u = getBasePlayerUrl();

    const mins = clamp(parseInt(ctlMins?.value || "5", 10) || 5, 1, 120);
    const fit = String(ctlFit?.value || "cover").toLowerCase() === "contain" ? "contain" : "cover";
    const hud = (ctlHud ? (ctlHud.value !== "off") : true);
    const hudDetails = (ctlHudDetails ? (ctlHudDetails.value !== "off") : true);
    const autoskip = (ctlAutoskip ? (ctlAutoskip.value !== "off") : true);
    const adfree = (ctlAdfree ? (ctlAdfree.value !== "off") : false);

    const twitch = String(ctlTwitchChannel?.value || "").trim().replace(/^@/, "");
    const voteOn = (ctlVoteOn ? (ctlVoteOn.value !== "off") : false);
    const voteOverlay = (ctlVoteOverlay ? (ctlVoteOverlay.value !== "off") : true);
    const voteWindow = clamp(parseInt(ctlVoteWindow?.value || "60", 10) || 60, 5, 180);
    const voteAt = clamp(parseInt(ctlVoteAt?.value || "60", 10) || 60, 5, 600);
    const voteLead = clamp(parseInt(ctlVoteLead?.value || "0", 10) || 0, 0, 30);
    const voteCmd = String(ctlVoteCmd?.value || "!next,!cam|!stay,!keep").trim();

    const stayMins = clamp(parseInt(ctlStayMins?.value || "5", 10) || 5, 1, 120);
    const ytCookies = (ctlYtCookies ? (ctlYtCookies.value !== "off") : true);

    const chatOn = (ctlChatOn ? (ctlChatOn.value !== "off") : true);
    const chatHide = (ctlChatHideCmd ? (ctlChatHideCmd.value !== "off") : true);
    const alertsOn = (ctlAlertsOn ? (ctlAlertsOn.value !== "off") : true);

    const adsOn = (ctlAdsOn ? (ctlAdsOn.value !== "off") : true);
    const adLead = clamp(parseInt(ctlAdLead?.value || "30", 10) || 30, 0, 300);
    const adDur = clamp(parseInt(ctlAdDur?.value || "30", 10) || 30, 5, 3600);
    const adShowDuring = (ctlAdShowDuring ? (ctlAdShowDuring.value !== "off") : true);
    const adChatText = String(ctlAdChatText?.value || "").trim();

    const tcfg = readTickerUI();
    const ccfg = readCountdownUI();

    u.searchParams.set("mins", String(mins));
    u.searchParams.set("fit", fit);
    u.searchParams.set("hud", boolParam(hud));
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
    u.searchParams.set("adDur", String(adDur));
    u.searchParams.set("adShowDuring", boolParam(!!adShowDuring));
    if (adChatText) u.searchParams.set("adChatText", adChatText);

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
  function tryAutoAnnounceCam(st) {
    if (!botCfg?.enabled) return;

    const cam = st?.cam || {};
    const id = String(cam.id || "");
    if (!id) return;

    const now = Date.now();
    if (id === lastAnnouncedCamId && (now - lastAnnounceAt) < 60000) return;
    if ((now - lastAnnounceAt) < 9000) return;
    if (lastAnnouncedCamId && id === lastAnnouncedCamId) return;

    const title = String(cam.title || "Live Cam").trim();
    const place = String(cam.place || "").trim();
    const src = String(cam.source || "").trim();

    lastAnnouncedCamId = id;
    lastAnnounceAt = now;

    const msg = `🌍 Ahora: ${title}${place ? ` — ${place}` : ""}${src ? ` · ${src}` : ""}`;
    botSay(msg);
  }

  // Update UX
  let updateAvailable = false;
  let lastReloadAt = 0;

  function markUpdateAvailable(reason = "Update disponible") {
    updateAvailable = true;
    if (ctlStatus) {
      try { ctlStatus.style.cursor = "pointer"; } catch (_) {}
      setStatus(`${reason} · click para recargar`, false);
    }
    if (AUTO_RELOAD) {
      const now = Date.now();
      if ((now - lastReloadAt) > 120000) {
        lastReloadAt = now;
        try { location.reload(); } catch (_) {}
      }
    }
  }

  function applyState(st) {
    if (!st || typeof st !== "object") return;
    lastState = st;
    lastSeenAt = Date.now();

    const cam = st.cam || {};
    try { if (ctlNowTitle) ctlNowTitle.textContent = String(cam.title || "—"); } catch (_) {}
    try { if (ctlNowPlace) ctlNowPlace.textContent = String(cam.place || "—"); } catch (_) {}
    try { if (ctlNowTimer) ctlNowTimer.textContent = fmtMMSS(st.remaining || 0); } catch (_) {}

    if (ctlOrigin) {
      const url = String(cam.originUrl || "");
      ctlOrigin.href = url || "#";
      try { ctlOrigin.style.pointerEvents = url ? "auto" : "none"; } catch (_) {}
      try { ctlOrigin.style.opacity = url ? "1" : ".6"; } catch (_) {}
    }

    // Mismatch Control/Player
    const pv = String(st.version || "");
    if (pv && compareVer(pv, APP_VERSION) > 0) {
      // Player más nuevo => sugiere update
      markUpdateAvailable(`Player v${pv} > Control v${APP_VERSION}`);
    } else if (!updateAvailable) {
      setStatus(`Conectado · Control v${APP_VERSION} · Player v${pv || "?"} · ${String(st.owner ? "OWNER" : "VIEW")}`, true);
    }

    tryAutoAnnounceCam(st);

    safeSetValue(ctlMins, st.mins ?? "");
    if (ctlFit && !isEditing(ctlFit)) ctlFit.value = (st.fit === "contain") ? "contain" : "cover";
    if (ctlAutoskip && !isEditing(ctlAutoskip)) ctlAutoskip.value = st.autoskip ? "on" : "off";
    if (ctlAdfree && !isEditing(ctlAdfree)) ctlAdfree.value = st.adfree ? "on" : "off";
    if (ctlHud && !isEditing(ctlHud)) ctlHud.value = st.hudHidden ? "off" : "on";
    if (ctlYtCookies && !isEditing(ctlYtCookies)) ctlYtCookies.value = st.ytCookies ? "on" : "off";

    if (st.vote && typeof st.vote === "object") {
      if (ctlTwitchChannel && !isEditing(ctlTwitchChannel) && st.vote.channel) ctlTwitchChannel.value = st.vote.channel;
      if (ctlVoteOn && !isEditing(ctlVoteOn)) ctlVoteOn.value = st.vote.enabled ? "on" : "off";
      if (ctlVoteOverlay && !isEditing(ctlVoteOverlay)) ctlVoteOverlay.value = st.vote.overlay ? "on" : "off";
    }

    syncPreviewUrl();
  }

  function applyEvent(ev) {
    if (!ev || typeof ev !== "object") return;
    const ts = (ev.ts | 0) || 0;
    if (ts && ts <= lastEventTs) return;
    if (ts) lastEventTs = ts;

    if (String(ev.name || "") === "AD_AUTO_NOTICE") {
      if (botCfg?.enabled && botCfg?.sayOnAd) {
        botSay("⚠️ Anuncio en breve… ¡gracias por apoyar el canal! 💜");
      }
    }
    if (String(ev.name || "") === "AD_AUTO_BEGIN") {
      if (botCfg?.enabled && botCfg?.sayOnAd) {
        const txt = String(ctlAdChatText?.value || "").trim();
        if (txt) botSay(txt);
      }
    }
  }

  function applyIncomingCmd(msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type !== "cmd") return;

    // dedupe básico (si llega por BC + storage, etc.)
    const sig = sigOf(`${msg.mid || ""}|${msg.ts || ""}|${msg.cmd || ""}|${JSON.stringify(msg.payload || {})}`);
    const now = Date.now();
    if (sig && sig === lastSeenCmdSig && (now - lastSeenCmdAt) < 1200) return;
    lastSeenCmdSig = sig;
    lastSeenCmdAt = now;

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

  // ───────────────────────── UI actions
  function syncPreviewUrl() {
    if (!ctlPreviewOn || !ctlPreviewWrap || !ctlPreview) return;
    const on = (ctlPreviewOn.value !== "off");
    try { ctlPreviewWrap.style.display = on ? "" : "none"; } catch (_) {}
    if (!on) return;

    try {
      const url = buildStreamUrlFromUI();
      ctlPreview.src = url;
    } catch (_) {}
  }

  function applyBasicSettings() {
    const mins = clamp(parseInt(ctlMins?.value || "5", 10) || 5, 1, 120);
    sendCmd("SET_MINS", { mins });

    const fit = String(ctlFit?.value || "cover").toLowerCase();
    sendCmd("SET_FIT", { fit });

    if (ctlHud) sendCmd("HUD", { hidden: (ctlHud.value === "off") });
    if (ctlAutoskip) sendCmd("SET_AUTOSKIP", { enabled: (ctlAutoskip.value !== "off") });
    if (ctlAdfree) sendCmd("SET_MODE", { mode: (ctlAdfree.value !== "off") ? "adfree" : "" });
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

    sendCmd("SET_ADS", { enabled, adLead, showDuring, chatText });

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
    if (ctlBotUser) safeSetValue(ctlBotUser, botCfg.user || "");

    // token protegido: si hay token guardado, mostramos ******** pero NO pisamos si el user está editando
    if (ctlBotToken) {
      if (!isEditing(ctlBotToken)) {
        ctlBotToken.value = botCfg.token ? "********" : "";
      }
    }

    if (ctlBotSayOnAd) ctlBotSayOnAd.value = (botCfg.sayOnAd !== false) ? "on" : "off";
    setBotStatus(botCfg.enabled ? "Bot: listo" : "Bot: OFF", !!botCfg.enabled);
  }

  function readBotUIAndSave() {
    const enabled = ctlBotOn ? (ctlBotOn.value !== "off") : false;
    const user = String(ctlBotUser?.value || "").trim().replace(/^@/, "");
    const chan = String(ctlTwitchChannel?.value || "").trim().replace(/^@/, "");

    let token = String(botCfg.token || "");
    const tokenUI = String(ctlBotToken?.value || "").trim();
    if (tokenUI && tokenUI !== "********") token = tokenUI.replace(/^oauth:/i, "");
    const sayOnAd = ctlBotSayOnAd ? (ctlBotSayOnAd.value !== "off") : true;

    botCfg = saveBotCfg({ enabled, user, token, channel: chan, sayOnAd });
    syncBotUIFromStore();
    botApplyCfgAndMaybeConnect();

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

  // ───────────────────────── Hotkeys (safe)
  function bindHotkeys() {
    listen(window, "keydown", (e) => {
      if (isTextInputActive()) return;

      const k = String(e.key || "");
      if (k === "ArrowRight") { e.preventDefault(); sendCmd("NEXT", {}); }
      else if (k === "ArrowLeft") { e.preventDefault(); sendCmd("PREV", {}); }
      else if (k === " ") { e.preventDefault(); sendCmd("TOGGLE_PLAY", {}); }
      else if (k.toLowerCase() === "r") { e.preventDefault(); sendCmd("RESHUFFLE", {}); }
      else if (k.toLowerCase() === "b") { e.preventDefault(); sendCmd("BAN_CURRENT", {}); }
    }, { passive: false });
  }

  function bindUi() {
    refreshGlobalLists(true);

    safeOn(ctlSearch, "input", debounce(() => syncList(ctlSearch.value), 120));

    safeOn(ctlPrev, "click", () => sendCmd("PREV", {}));
    safeOn(ctlPlay, "click", () => sendCmd("TOGGLE_PLAY", {}));
    safeOn(ctlNext, "click", () => sendCmd("NEXT", {}));
    safeOn(ctlShuffle, "click", () => sendCmd("RESHUFFLE", {}));

    safeOn(ctlApplyMins, "click", () => {
      const mins = clamp(parseInt(ctlMins?.value || "5", 10) || 5, 1, 120);
      sendCmd("SET_MINS", { mins });
      syncPreviewUrl();
    });

    safeOn(ctlApplySettings, "click", applyBasicSettings);

    safeOn(ctlGo, "click", doGoSelected);
    safeOn(ctlBan, "click", doBanSelectedOrCurrent);
    safeOn(ctlReset, "click", doReset);

    safeOn(ctlPreviewOn, "change", syncPreviewUrl);

    safeOn(ctlCopyStreamUrl, "click", async () => {
      const url = buildStreamUrlFromUI();
      const ok = await copyToClipboard(url);
      setStatus(ok ? "URL copiada ✅" : "No se pudo copiar ❌", ok);
    });

    // vote
    safeOn(ctlVoteApply, "click", applyVoteSettings);
    safeOn(ctlVoteStart, "click", () => {
      const timing = computeVoteTiming();
      sendCmd("START_VOTE", { windowSec: timing.windowSec, leadSec: timing.leadSec });
    });

    // chat/alerts
    safeOn(ctlChatOn, "change", applyChatAlertsSettings);
    safeOn(ctlChatHideCmd, "change", applyChatAlertsSettings);
    safeOn(ctlAlertsOn, "change", applyChatAlertsSettings);

    // ads
    safeOn(ctlAdsOn, "change", applyAdsSettings);
    safeOn(ctlAdLead, "change", applyAdsSettings);
    safeOn(ctlAdDur, "change", applyAdsSettings);
    safeOn(ctlAdShowDuring, "change", applyAdsSettings);
    safeOn(ctlAdChatText, "change", debounce(applyAdsSettings, 250));

    safeOn(ctlAdNoticeBtn, "click", adNoticeNow);
    safeOn(ctlAdBeginBtn, "click", adBeginNow);
    safeOn(ctlAdClearBtn, "click", adClearNow);

    // ticker
    safeOn(ctlTickerApply, "click", applyTickerNow);
    safeOn(ctlTickerReset, "click", readTickerReset);
    safeOn(ctlTickerCopyUrl, "click", async () => {
      const url = buildStreamUrlFromUI();
      const ok = await copyToClipboard(url);
      setPill(ctlTickerStatus, ok ? "Ticker URL copiada ✅" : "No se pudo copiar ❌", ok);
    });

    // countdown
    safeOn(ctlCountdownApply, "click", applyCountdownNow);
    safeOn(ctlCountdownReset, "click", readCountdownReset);

    // helix
    safeOn(ctlTitleApply, "click", helixApplyFromUI);
    safeOn(ctlTitleTest, "click", helixTestOnce);
    safeOn(ctlTitleReset, "click", helixResetUI);

    // bot
    safeOn(ctlBotConnect, "click", readBotUIAndSave);
    safeOn(ctlBotOn, "change", readBotUIAndSave);
    safeOn(ctlBotSayOnAd, "change", readBotUIAndSave);
    safeOn(ctlBotTestSend, "click", () => {
      const txt = String(ctlBotTestText?.value || "✅ Bot test").trim();
      botSay(txt);
    });

    // BGM (cmds opcionales)
    safeOn(ctlBgmOn, "change", () => sendCmd("SET_BGM", { enabled: (ctlBgmOn.value !== "off") }));
    safeOn(ctlBgmVol, "input", debounce(() => sendCmd("SET_BGM_VOL", { vol: parseFloat(ctlBgmVol.value || "0.22") || 0.22 }), 120));
    safeOn(ctlBgmPrev, "click", () => sendCmd("BGM_PREV", {}));
    safeOn(ctlBgmPlay, "click", () => sendCmd("BGM_PLAYPAUSE", {}));
    safeOn(ctlBgmNext, "click", () => sendCmd("BGM_NEXT", {}));
    safeOn(ctlBgmShuffle, "click", () => sendCmd("BGM_SHUFFLE", {}));
    safeOn(ctlBgmTrack, "change", () => {
      const idx = parseInt(ctlBgmTrack.value || "0", 10) || 0;
      sendCmd("BGM_TRACK", { idx });
    });

    const autoSync = debounce(syncPreviewUrl, 160);
    [
      ctlMins, ctlFit, ctlHud, ctlAutoskip, ctlAdfree, ctlTwitchChannel,
      ctlVoteOn, ctlVoteOverlay, ctlVoteWindow, ctlVoteAt, ctlVoteLead, ctlVoteCmd, ctlStayMins,
      ctlChatOn, ctlChatHideCmd, ctlAlertsOn,
      ctlAdsOn, ctlAdLead, ctlAdDur, ctlAdShowDuring, ctlAdChatText,
      ctlTickerOn, ctlTickerLang, ctlTickerSpeed, ctlTickerRefresh, ctlTickerTop, ctlTickerHideOnVote, ctlTickerSpan,
      ctlCountdownOn, ctlCountdownLabel, ctlCountdownTarget
    ].forEach(el => safeOn(el, "change", autoSync));

    // Click pill para recargar si hay update detectado
    safeOn(ctlStatus, "click", () => {
      if (!updateAvailable) return;
      try { location.reload(); } catch (_) {}
    });

    syncPreviewUrl();
  }

  function bindBus() {
    // BC main
    try {
      if (bcMain) bcMain.onmessage = (ev) => {
        const msg = ev?.data;
        if (!keyOk(msg, true)) return;

        if (msg?.type === "state") applyState(msg);
        else if (msg?.type === "event") applyEvent(msg);
        else if (msg?.type === "cmd") applyIncomingCmd(msg);
      };
    } catch (_) {}

    // BC legacy
    try {
      if (bcLegacy) bcLegacy.onmessage = (ev) => {
        const msg = ev?.data;
        if (!keyOk(msg, false)) return;

        if (msg?.type === "state") applyState(msg);
        else if (msg?.type === "event") applyEvent(msg);
        else if (msg?.type === "cmd") applyIncomingCmd(msg);
      };
    } catch (_) {}

    // storage fallback
    listen(window, "storage", (e) => {
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

  // ───────────────────────── SW update awareness
  function installSwUpdateWatcher() {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) return;

      try { reg.update(); } catch (_) {}

      // Si ya hay waiting => update listo
      if (reg.waiting && navigator.serviceWorker.controller) {
        markUpdateAvailable("Update disponible (SW)");
      }

      const onUpdateFound = () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            markUpdateAvailable("Update disponible (SW)");
          }
        });
      };

      try { reg.addEventListener("updatefound", onUpdateFound); } catch (_) {}

      // disposer
      disposers.push(() => {
        try { reg.removeEventListener("updatefound", onUpdateFound); } catch (_) {}
      });
    }).catch(() => {});
  }

  // ───────────────────────── Heartbeat
  let heartbeatId = 0;

  function heartbeat() {
    const now = Date.now();
    const age = now - (lastSeenAt || 0);

    if (!updateAvailable) {
      if (age > 3500) setStatus("Sin señal… (abre el player)", false);
    }

    helixTick(false).catch(() => {});
    refreshGlobalLists(false);
  }

  // ───────────────────────── Boot / Destroy
  function boot() {
    cacheDom();
    ensureControlMode();

    if (ctlBusName) {
      try { ctlBusName.textContent = KEY ? `${BUS} (keyed)` : BUS; } catch (_) {}
    }

    syncTickerUIFromStore();
    syncCountdownUIFromStore();
    syncHelixUIFromStore();
    syncBotUIFromStore();

    botApplyCfgAndMaybeConnect();

    bindUi();
    bindHotkeys();
    bindBus();

    readStateFromLS();
    readEventFromLS();
    readCmdFromLS();

    installSwUpdateWatcher();

    heartbeatId = setInterval(heartbeat, 900);
    setStatus(`Control listo · v${APP_VERSION}`, true);
  }

  instance.destroy = () => {
    if (instance._disposed) return;
    instance._disposed = true;

    try { if (heartbeatId) clearInterval(heartbeatId); } catch (_) {}
    heartbeatId = 0;

    try { bcMain && (bcMain.onmessage = null); } catch (_) {}
    try { bcLegacy && (bcLegacy.onmessage = null); } catch (_) {}
    try { bcMain && bcMain.close?.(); } catch (_) {}
    try { bcLegacy && bcLegacy.close?.(); } catch (_) {}

    try { bot?.close?.(); } catch (_) {}
    bot = null;

    // quitar listeners
    for (let i = disposers.length - 1; i >= 0; i--) {
      try { disposers[i]?.(); } catch (_) {}
    }
    disposers.length = 0;

    // limpiar singleton (opcional)
    try {
      if (g[SINGLETON_KEY] === instance) g[SINGLETON_KEY] = null;
    } catch (_) {}
  };

  onReady(boot);
})();
