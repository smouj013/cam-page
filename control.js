/* control.js — RLC Control v2.3.8 (NEWSROOM/BROADCAST)
   ✅ FULL + HARDENED + NO DUPES + UPDATE-AWARE
   ✅ FIX v2.3.8 (CLAVE):
      - Auto-detecta KEY si falta en control.html (desde localStorage) + la refleja en URL (sin reload)
      - Envía comandos con ALIASES (compat con players que usan nombres distintos)
      - Refresca CAM_LIST aunque se rellene “in-place” (push/splice) usando firma+length
      - Doble click / Enter en lista = GOTO
      - Selecciona en lista la cam actual al recibir state (sin pisar si el user está interactuando)
   ✅ Compat extra (sin romper):
      - Modo Catálogo: incluye parámetros en URL/Preview/Copiar (aunque lo gestione catalogControl.js)
      - Sync HUD Details desde state + comando alias opcional
      - ADS payload incluye adDurSec (player puede ignorar si no lo usa)
      - Preview evita reasignar src si no cambió (menos “parpadeo” y CPU)
      - Expone API global segura (__RLC_CONTROL_API_V1__) para otros módulos
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const APP_VERSION = String((typeof window !== "undefined" && window.APP_VERSION) || "2.3.8");

  // ───────────────────────── Version helpers
  function _verParts(v) {
    const m = String(v || "").trim().match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!m) return [0, 0, 0];
    return [
      parseInt(m[1], 10) || 0,
      parseInt(m[2], 10) || 0,
      parseInt(m[3], 10) || 0
    ];
  }
  function compareVer(a, b) {
    const A = _verParts(a), B = _verParts(b);
    for (let i = 0; i < 3; i++) {
      if (A[i] > B[i]) return 1;
      if (A[i] < B[i]) return -1;
    }
    return 0;
  }

  // ───────────────────────── Singleton anti-dup (upgrade-safe) — BLINDADO
  const SINGLETON_KEY = "__RLC_CONTROL_JS_SINGLETON__"; // ✅ ÚNICO para ESTE archivo
  const SINGLETON_KIND = "RLC_CONTROL_JS";             // ✅ evita colisiones con otros scripts

  try {
    const existing = g[SINGLETON_KEY];
    if (existing && typeof existing === "object" && existing.kind === SINGLETON_KIND) {
      const prevVer = String(existing.version || "0.0.0");
      if (compareVer(prevVer, APP_VERSION) >= 0) return; // igual o más nuevo ya cargado
      try { existing.destroy?.(); } catch (_) {}
    }
  } catch (_) {}

  const instance = { kind: SINGLETON_KIND, version: APP_VERSION, _disposed: false, destroy: null };
  try { g[SINGLETON_KEY] = instance; } catch (_) {}

  // ───────────────────────── Utils
  const qs = (s, r = document) => { try { return r.querySelector(s); } catch (_) { return null; } };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (v, fallback) => {
    const n = parseFloat(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  };
  const safeStr = (v) => (typeof v === "string") ? v.trim() : "";
  const safeJson = (raw, fallback = null) => { try { return JSON.parse(raw); } catch (_) { return fallback; } };
  const sigOf = (s) => String(s || "").trim().slice(0, 220);

  function onReady(fn) {
    if (document.readyState === "complete" || document.readyState === "interactive") setTimeout(fn, 0);
    else document.addEventListener("DOMContentLoaded", fn, { once: true });
  }

  // Disposers (anti-dupe real)
  const disposers = [];
  function listen(target, ev, fn, opt) {
    try {
      if (!target?.addEventListener) return;
      target.addEventListener(ev, fn, opt);
      disposers.push(() => { try { target.removeEventListener(ev, fn, opt); } catch (_) {} });
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
      t = setTimeout(() => { try { fn(...args); } catch (e) { console.error(e); } }, ms);
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

  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }

  // ───────────────────────── Force CONTROL mode
  function ensureControlMode() {
    try {
      const p = String(location.pathname || "").toLowerCase();
      const looksControl =
        p.endsWith("/control.html") || p.endsWith("control.html") ||
        p.endsWith("/control") || p.endsWith("control");

      if (looksControl) document.body?.classList?.add("mode-control");
      if (document.body?.classList?.contains("mode-control")) {
        try { document.body.style.overflow = "auto"; } catch (_) {}
      }
    } catch (_) {}
  }

  // ───────────────────────── KEY auto-detect (FIX v2.3.8)
  const BUS_BASE = "rlc_bus_v1";
  const CMD_KEY_BASE = "rlc_cmd_v1";
  const STATE_KEY_BASE = "rlc_state_v1";
  const EVT_KEY_BASE = "rlc_evt_v1";
  const BOT_STORE_KEY_BASE = "rlc_bot_cfg_v1";
  const TICKER_CFG_KEY_BASE = "rlc_ticker_cfg_v1";
  const HELIX_CFG_KEY_BASE  = "rlc_helix_cfg_v1";
  const COUNTDOWN_CFG_KEY_BASE = "rlc_countdown_cfg_v1";

  function parseParams() {
    const u = new URL(location.href);
    return {
      key: safeStr(u.searchParams.get("key") || ""),
      autoReload: safeStr(u.searchParams.get("autoReload") || ""), // "1"
    };
  }

  function inferKeyFromStorage() {
    // 1) última key usada
    const last = safeStr(lsGet("rlc_last_key_v1") || "");
    if (last) return last;

    // 2) buscar el state más “reciente” entre rlc_state_v1:* (keyed)
    try {
      let bestKey = "";
      let bestTs = 0;

      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (!k.startsWith(`${STATE_KEY_BASE}:`)) continue;

        const maybeKey = k.slice(`${STATE_KEY_BASE}:`.length).trim();
        if (!maybeKey) continue;

        const raw = lsGet(k);
        const st = safeJson(raw, null);
        const ts = (st && typeof st === "object")
          ? (Number(st.ts || st.lastTs || 0) || 0)
          : 0;

        const score = ts || 1;
        if (score > bestTs) {
          bestTs = score;
          bestKey = maybeKey;
        }
      }
      if (bestKey) return bestKey;
    } catch (_) {}

    return "";
  }

  const P0 = parseParams();
  let KEY = String(P0.key || "").trim();

  if (!KEY) {
    const inferred = inferKeyFromStorage();
    if (inferred) KEY = inferred;
  }

  // reflejar KEY inferida en URL sin recargar (para que el usuario la vea)
  try {
    if (KEY && !P0.key) {
      const u = new URL(location.href);
      u.searchParams.set("key", KEY);
      history.replaceState(null, "", u.toString());
    }
  } catch (_) {}

  try { if (KEY) lsSet("rlc_last_key_v1", KEY); } catch (_) {}

  const AUTO_RELOAD = (String(P0.autoReload || "") === "1");

  // Namespaced keys
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

  // BroadcastChannels (se cierran en destroy)
  const bcMain = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS) : null;
  const bcLegacy = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_LEGACY) : null;

  function busPost(msg) {
    try { if (bcMain) bcMain.postMessage(msg); } catch (_) {}
    try { if (bcLegacy) bcLegacy.postMessage(msg); } catch (_) {}
  }

  // anti-dupe cmd stamp (solo para recepción/control)
  let lastSeenCmdSig = "";
  let lastSeenCmdAt = 0;

  function sendCmd(cmd, payload = {}) {
    const msg = {
      type: "cmd",
      ts: Date.now(),
      mid: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      cmd,
      payload: payload || {}
    };
    if (KEY) msg.key = KEY;

    const raw = JSON.stringify(msg);

    // compat (keyed + legacy)
    lsSet(CMD_KEY, raw);
    lsSet(CMD_KEY_LEGACY, raw);
    busPost(msg);
  }

  // ✅ ALIASES (compat con distintos players)
  function sendCmdAliases(cmd, payload = {}, aliases = []) {
    const sent = new Set();
    const push = (c, p) => {
      const cc = String(c || "").trim();
      if (!cc || sent.has(cc)) return;
      sent.add(cc);
      sendCmd(cc, p);
    };

    push(cmd, payload);

    // también manda payload alternativos típicos (id/camId)
    if (payload && typeof payload === "object") {
      const id = payload.id ?? payload.camId ?? payload.cameraId ?? payload.value ?? null;
      if (id != null) {
        if (payload.id == null) push(cmd, Object.assign({}, payload, { id }));
        if (payload.camId == null) push(cmd, Object.assign({}, payload, { camId: id }));
        if (payload.cameraId == null) push(cmd, Object.assign({}, payload, { cameraId: id }));
      }
    }

    for (const a of (aliases || [])) push(a, payload);
  }

  // API global segura (para catalogControl/pointsControl/otros)
  const API_KEY = "__RLC_CONTROL_API_V1__";
  try {
    g[API_KEY] = {
      kind: "RLC_CONTROL_API",
      version: APP_VERSION,
      key: KEY,
      bus: BUS,
      sendCmd,
      sendCmdAliases,
      busPost,
      getState: () => lastState,
      refreshLists: (force = false) => refreshGlobalLists(!!force),
      buildStreamUrlFromUI: () => buildStreamUrlFromUI(),
    };
  } catch (_) {}

  // ───────────────────────── DOM cache
  let
    ctlStatus, ctlNowTitle, ctlNowPlace, ctlNowTimer, ctlOrigin,
    ctlPrev, ctlPlay, ctlNext, ctlShuffle,
    ctlMins, ctlApplyMins, ctlApplySettings, ctlFit, ctlHud, ctlHudDetails, ctlAutoskip, ctlAdfree, ctlReset,
    ctlSearch, ctlSelect, ctlGo, ctlBan,
    ctlPreviewOn, ctlPreviewWrap, ctlPreview,
    ctlCopyStreamUrl,
    ctlBgmOn, ctlBgmVol, ctlBgmTrack, ctlBgmPrev, ctlBgmPlay, ctlBgmNext, ctlBgmShuffle, ctlBgmNow,

    // CATALOG (nuevo en HTML, no rompe si no existe)
    ctlCatalogOn, ctlCatalogStatus, ctlCatalogLayout, ctlCatalogGap, ctlCatalogLabels,
    ctlCatalogMode, ctlCatalogFollowSlot, ctlCatalogClickCycle, ctlCatalogYtCookies,
    ctlCatalogWxTiles, ctlCatalogWxRefreshSec, ctlCatalogMuted, ctlCatalogApply, ctlCatalogReset,

    ctlTwitchChannel, ctlVoteOn, ctlVoteOverlay, ctlVoteWindow, ctlVoteAt, ctlVoteLead, ctlVoteCmd, ctlVoteStart, ctlVoteApply, ctlStayMins, ctlYtCookies,
    ctlChatOn, ctlChatHideCmd, ctlAlertsOn,
    ctlAdsOn, ctlAdLead, ctlAdDur, ctlAdShowDuring, ctlAdChatText, ctlAdNoticeBtn, ctlAdBeginBtn, ctlAdClearBtn,
    ctlBotOn, ctlBotUser, ctlBotToken, ctlBotConnect, ctlBotStatus, ctlBotSayOnAd, ctlBotTestText, ctlBotTestSend,
    ctlTickerOn, ctlTickerLang, ctlTickerSpeed, ctlTickerRefresh, ctlTickerTop, ctlTickerHideOnVote, ctlTickerSpan, ctlTickerApply, ctlTickerReset, ctlTickerStatus, ctlTickerCopyUrl,
    ctlCountdownOn, ctlCountdownLabel, ctlCountdownTarget, ctlCountdownApply, ctlCountdownReset, ctlCountdownStatus,
    ctlTitleOn, ctlTitleStatus, ctlTitleClientId, ctlTitleBroadcasterId, ctlTitleToken, ctlTitleTemplate, ctlTitleCooldown, ctlTitleApply, ctlTitleTest, ctlTitleReset,
    ctlBusName;

  function cacheDom() {
    ctlStatus = qs("#ctlStatus");
    ctlNowTitle = qs("#ctlNowTitle");
    ctlNowPlace = qs("#ctlNowPlace");
    ctlNowTimer = qs("#ctlNowTimer");
    ctlOrigin = qs("#ctlOrigin");

    ctlPrev = qs("#ctlPrev");
    ctlPlay = qs("#ctlPlay");
    ctlNext = qs("#ctlNext");
    ctlShuffle = qs("#ctlShuffle");

    ctlMins = qs("#ctlMins");
    ctlApplyMins = qs("#ctlApplyMins");
    ctlApplySettings = qs("#ctlApplySettings");
    ctlFit = qs("#ctlFit");
    ctlHud = qs("#ctlHud");
    ctlHudDetails = qs("#ctlHudDetails");
    ctlAutoskip = qs("#ctlAutoskip");
    ctlAdfree = qs("#ctlAdfree");
    ctlReset = qs("#ctlReset");

    ctlSearch = qs("#ctlSearch");
    ctlSelect = qs("#ctlSelect");
    ctlGo = qs("#ctlGo");
    ctlBan = qs("#ctlBan");

    ctlPreviewOn = qs("#ctlPreviewOn");
    ctlPreviewWrap = qs("#ctlPreviewWrap");
    ctlPreview = qs("#ctlPreview");

    ctlCopyStreamUrl = qs("#ctlCopyStreamUrl");

    ctlBgmOn = qs("#ctlBgmOn");
    ctlBgmVol = qs("#ctlBgmVol");
    ctlBgmTrack = qs("#ctlBgmTrack");
    ctlBgmPrev = qs("#ctlBgmPrev");
    ctlBgmPlay = qs("#ctlBgmPlay");
    ctlBgmNext = qs("#ctlBgmNext");
    ctlBgmShuffle = qs("#ctlBgmShuffle");
    ctlBgmNow = qs("#ctlBgmNow");

    // Catalog (si existe)
    ctlCatalogOn = qs("#ctlCatalogOn");
    ctlCatalogStatus = qs("#ctlCatalogStatus");
    ctlCatalogLayout = qs("#ctlCatalogLayout");
    ctlCatalogGap = qs("#ctlCatalogGap");
    ctlCatalogLabels = qs("#ctlCatalogLabels");
    ctlCatalogMode = qs("#ctlCatalogMode");
    ctlCatalogFollowSlot = qs("#ctlCatalogFollowSlot");
    ctlCatalogClickCycle = qs("#ctlCatalogClickCycle");
    ctlCatalogYtCookies = qs("#ctlCatalogYtCookies");
    ctlCatalogWxTiles = qs("#ctlCatalogWxTiles");
    ctlCatalogWxRefreshSec = qs("#ctlCatalogWxRefreshSec");
    ctlCatalogMuted = qs("#ctlCatalogMuted");
    ctlCatalogApply = qs("#ctlCatalogApply");
    ctlCatalogReset = qs("#ctlCatalogReset");

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

    ctlChatOn = qs("#ctlChatOn");
    ctlChatHideCmd = qs("#ctlChatHideCmd");
    ctlAlertsOn = qs("#ctlAlertsOn");

    ctlAdsOn = qs("#ctlAdsOn");
    ctlAdLead = qs("#ctlAdLead");
    ctlAdDur = qs("#ctlAdDur");
    ctlAdShowDuring = qs("#ctlAdShowDuring");
    ctlAdChatText = qs("#ctlAdChatText");
    ctlAdNoticeBtn = qs("#ctlAdNoticeBtn");
    ctlAdBeginBtn = qs("#ctlAdBeginBtn");
    ctlAdClearBtn = qs("#ctlAdClearBtn");

    ctlBotOn = qs("#ctlBotOn");
    ctlBotUser = qs("#ctlBotUser");
    ctlBotToken = qs("#ctlBotToken");
    ctlBotConnect = qs("#ctlBotConnect");
    ctlBotStatus = qs("#ctlBotStatus");
    ctlBotSayOnAd = qs("#ctlBotSayOnAd");
    ctlBotTestText = qs("#ctlBotTestText");
    ctlBotTestSend = qs("#ctlBotTestSend");

    // (opcionales / si inyecta otro script)
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

    ctlCountdownOn = qs("#ctlCountdownOn");
    ctlCountdownLabel = qs("#ctlCountdownLabel");
    ctlCountdownTarget = qs("#ctlCountdownTarget");
    ctlCountdownApply = qs("#ctlCountdownApply");
    ctlCountdownReset = qs("#ctlCountdownReset");
    ctlCountdownStatus = qs("#ctlCountdownStatus");

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

    ctlBusName = qs("#ctlBusName");
  }

  // Data lists
  let allCams = [];
  let bgmList = [];
  let _lastCamRef = null;
  let _lastCamLen = 0;
  let _lastCamSig = "";
  let _lastBgmRef = null;
  let _lastBgmLen = 0;

  function camListSignature(list) {
    try {
      const L = list.length || 0;
      if (!L) return "";

      // sample distribuido (mejor que “solo first 12”)
      const take = Math.min(12, L);
      const ids = [];
      for (let i = 0; i < take; i++) {
        const idx = (take === 1) ? 0 : Math.round((i * (L - 1)) / (take - 1));
        ids.push(String(list[idx]?.id || ""));
      }
      return `${L}|${ids.join("|")}`;
    } catch (_) { return ""; }
  }

  function refreshGlobalLists(force = false) {
    try {
      const camRef = Array.isArray(g.CAM_LIST) ? g.CAM_LIST : null;
      const bgmRef = Array.isArray(g.BGM_LIST) ? g.BGM_LIST : null;

      let camChanged = false;
      if (force) camChanged = true;
      else if (camRef && camRef !== _lastCamRef) camChanged = true;
      else if (camRef && camRef.length !== _lastCamLen) camChanged = true;
      else if (camRef) {
        const sig = camListSignature(camRef);
        if (sig && sig !== _lastCamSig) camChanged = true;
      }

      let bgmChanged = false;
      if (force) bgmChanged = true;
      else if (bgmRef && bgmRef !== _lastBgmRef) bgmChanged = true;
      else if (bgmRef && bgmRef.length !== _lastBgmLen) bgmChanged = true;

      if (camChanged) {
        _lastCamRef = camRef;
        _lastCamLen = camRef ? camRef.length : 0;
        _lastCamSig = camRef ? camListSignature(camRef) : "";
        allCams = camRef ? camRef.slice() : [];
      }
      if (bgmChanged) {
        _lastBgmRef = bgmRef;
        _lastBgmLen = bgmRef ? bgmRef.length : 0;
        bgmList = bgmRef ? bgmRef.slice() : [];
      }

      if (camChanged) syncList(String(ctlSearch?.value || ""));
      if (bgmChanged) syncBgmTracks();
    } catch (_) {}
  }

  // State cache
  let lastState = null;
  let lastSeenAt = 0;
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
      opt.value = String(cam.id ?? "");
      opt.textContent = label(cam);
      frag.appendChild(opt);
    }
    try { ctlSelect.appendChild(frag); } catch (_) {}

    // si hay state y existe esa opción, seleccionarla sin pisar interacción
    try {
      const curId = String(lastState?.cam?.id || "");
      if (curId && !isEditing(ctlSelect)) ctlSelect.value = curId;
    } catch (_) {}
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

  // ───────────────────────── Ticker cfg (opcional)
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

  function setTickerStatusFromCfg(cfg) {
    if (!ctlTickerStatus) return;
    const on = !!cfg?.enabled;
    setPill(ctlTickerStatus, on ? "Ticker: ON" : "Ticker: OFF", on);
  }

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
      return new Date(y, 0, 1, 0, 0, 0, 0).getTime();
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
    sendCmdAliases("COUNTDOWN_SET", c, ["SET_COUNTDOWN", "COUNTDOWN"]);
    return c;
  }

  let countdownCfg = loadCountdownCfg();

  function setCountdownStatusFromCfg(cfg) {
    if (!ctlCountdownStatus) return;
    const on = !!cfg?.enabled;
    setPill(ctlCountdownStatus, on ? "Cuenta atrás: ON" : "Cuenta atrás: OFF", on);
  }

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

  // ───────────────────────── Helix Auto Title cfg (se mantiene igual)
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

  // ───────────────────────── Bot IRC (igual que tu versión)
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

    _status(text, ok) { try { this.onStatus?.(text, ok); } catch (_) {} }

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
    else if (!/\/index\.html$/i.test(p)) u.pathname = p.replace(/\/[^/]*$/i, "/index.html");

    u.search = "";
    u.hash = "";
    return u;
  }

  function readCatalogUIForUrl() {
    const enabled = ctlCatalogOn ? (ctlCatalogOn.value !== "off") : false;
    const layout = ctlCatalogLayout ? String(ctlCatalogLayout.value || "quad") : "quad";
    const gap = ctlCatalogGap ? clamp(parseInt(ctlCatalogGap.value || "8", 10) || 8, 0, 24) : 8;
    const labels = ctlCatalogLabels ? (ctlCatalogLabels.value !== "off") : true;

    const mode = ctlCatalogMode ? String(ctlCatalogMode.value || "follow") : "follow"; // follow|sync
    const followSlot = ctlCatalogFollowSlot ? clamp(parseInt(ctlCatalogFollowSlot.value || "0", 10) || 0, 0, 3) : 0;

    const clickCycle = ctlCatalogClickCycle ? (ctlCatalogClickCycle.value !== "off") : true;

    const ytCookies = ctlCatalogYtCookies ? (ctlCatalogYtCookies.value !== "off") : true;

    const wxTiles = ctlCatalogWxTiles ? (ctlCatalogWxTiles.value !== "off") : true;
    const wxRefreshSec = ctlCatalogWxRefreshSec ? clamp(parseInt(ctlCatalogWxRefreshSec.value || "30", 10) || 30, 10, 180) : 30;

    const muted = ctlCatalogMuted ? (ctlCatalogMuted.value !== "off") : true;

    return { enabled, layout, gap, labels, mode, followSlot, clickCycle, ytCookies, wxTiles, wxRefreshSec, muted };
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

    // catalog (solo URL/preview/copy; ejecución real la hace catalogControl.js si quieres)
    const cat = readCatalogUIForUrl();

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

    // Catalog params (no rompe si player no los usa)
    u.searchParams.set("catalog", boolParam(!!cat.enabled));
    u.searchParams.set("catalogLayout", String(cat.layout || "quad"));
    u.searchParams.set("catalogGap", String(cat.gap ?? 8));
    u.searchParams.set("catalogLabels", boolParam(!!cat.labels));
    u.searchParams.set("catalogMode", String(cat.mode || "follow"));
    u.searchParams.set("catalogFollowSlot", String(cat.followSlot ?? 0));
    u.searchParams.set("catalogClickCycle", boolParam(!!cat.clickCycle));
    u.searchParams.set("catalogYtCookies", boolParam(!!cat.ytCookies));
    u.searchParams.set("catalogWxTiles", boolParam(!!cat.wxTiles));
    u.searchParams.set("catalogWxRefreshSec", String(cat.wxRefreshSec ?? 30));
    u.searchParams.set("catalogMuted", boolParam(!!cat.muted));

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
    try { if (ctlNowTimer) ctlNowTimer.textContent = fmtMMSS((st.remaining ?? 0) | 0); } catch (_) {}

    if (ctlOrigin) {
      const url = String(cam.originUrl || "");
      ctlOrigin.href = url || "#";
      try { ctlOrigin.style.pointerEvents = url ? "auto" : "none"; } catch (_) {}
      try { ctlOrigin.style.opacity = url ? "1" : ".6"; } catch (_) {}
    }

    // Seleccionar cam actual en lista (sin pisar si estás tocando el select)
    try {
      const curId = String(cam.id || "");
      if (curId && ctlSelect && !isEditing(ctlSelect)) ctlSelect.value = curId;
    } catch (_) {}

    // Mismatch Control/Player
    const pv = String(st.version || "");
    if (pv && compareVer(pv, APP_VERSION) > 0) {
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

    // HUD Details (sync extra)
    try {
      let details = null;
      if (typeof st.hudDetails === "boolean") details = st.hudDetails;
      else if (typeof st.hudDetailsHidden === "boolean") details = !st.hudDetailsHidden;
      if (ctlHudDetails && details !== null && !isEditing(ctlHudDetails)) ctlHudDetails.value = details ? "on" : "off";
    } catch (_) {}

    if (ctlYtCookies && !isEditing(ctlYtCookies)) ctlYtCookies.value = st.ytCookies ? "on" : "off";

    // Vote subset
    if (st.vote && typeof st.vote === "object") {
      if (ctlTwitchChannel && !isEditing(ctlTwitchChannel) && st.vote.channel) ctlTwitchChannel.value = st.vote.channel;
      if (ctlVoteOn && !isEditing(ctlVoteOn)) ctlVoteOn.value = st.vote.enabled ? "on" : "off";
      if (ctlVoteOverlay && !isEditing(ctlVoteOverlay)) ctlVoteOverlay.value = st.vote.overlay ? "on" : "off";
    }

    // BGM subset (si viene en state)
    try {
      const b = st.bgm;
      if (b && typeof b === "object") {
        if (ctlBgmOn && !isEditing(ctlBgmOn) && typeof b.enabled === "boolean") ctlBgmOn.value = b.enabled ? "on" : "off";
        if (ctlBgmVol && !isEditing(ctlBgmVol) && typeof b.vol === "number") ctlBgmVol.value = String(clamp(b.vol, 0, 1));
        if (ctlBgmTrack && !isEditing(ctlBgmTrack) && (typeof b.idx === "number")) ctlBgmTrack.value = String(clamp(b.idx | 0, 0, Math.max(0, bgmList.length - 1)));
        if (ctlBgmNow) {
          const txt = (b.title || b.now || b.track) ? String(b.title || b.now || b.track) : "";
          if (txt) ctlBgmNow.textContent = txt;
        }
      }
    } catch (_) {}

    // Catalog status (si viene en state)
    try {
      let catEnabled = null;
      const cat = (st.catalog && typeof st.catalog === "object") ? st.catalog : null;
      if (cat && typeof cat.enabled === "boolean") catEnabled = cat.enabled;
      else if (typeof st.catalogEnabled === "boolean") catEnabled = st.catalogEnabled;
      else if (typeof st.catalogOn === "boolean") catEnabled = st.catalogOn;

      if (ctlCatalogOn && catEnabled !== null && !isEditing(ctlCatalogOn)) ctlCatalogOn.value = catEnabled ? "on" : "off";
      if (ctlCatalogStatus && catEnabled !== null) setPill(ctlCatalogStatus, catEnabled ? "Catálogo: ON" : "Catálogo: OFF", !!catEnabled);
    } catch (_) {}

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

    // dedupe básico (BC + storage)
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
  let _lastPreviewUrl = "";

  function syncPreviewUrl() {
    if (!ctlPreviewOn || !ctlPreviewWrap || !ctlPreview) return;
    const on = (ctlPreviewOn.value !== "off");
    try { ctlPreviewWrap.style.display = on ? "" : "none"; } catch (_) {}

    if (!on) {
      _lastPreviewUrl = "";
      return;
    }

    try {
      const url = buildStreamUrlFromUI();
      if (url && url !== _lastPreviewUrl) {
        _lastPreviewUrl = url;
        ctlPreview.src = url;
      }
    } catch (_) {}
  }

  function applyBasicSettings() {
    const mins = clamp(parseInt(ctlMins?.value || "5", 10) || 5, 1, 120);
    sendCmdAliases("SET_MINS", { mins }, ["MINS", "SET_DURATION"]);

    const fit = String(ctlFit?.value || "cover").toLowerCase();
    sendCmdAliases("SET_FIT", { fit }, ["FIT"]);

    if (ctlHud) sendCmdAliases("HUD", { hidden: (ctlHud.value === "off") }, ["SET_HUD"]);
    if (ctlHudDetails) sendCmdAliases("HUD_DETAILS", { enabled: (ctlHudDetails.value !== "off") }, ["SET_HUD_DETAILS", "HUDDETAILS"]);

    if (ctlAutoskip) sendCmdAliases("SET_AUTOSKIP", { enabled: (ctlAutoskip.value !== "off") }, ["AUTOSKIP"]);
    if (ctlAdfree) sendCmdAliases("SET_MODE", { mode: (ctlAdfree.value !== "off") ? "adfree" : "" }, ["MODE"]);
    if (ctlYtCookies) sendCmdAliases("YT_COOKIES", { enabled: (ctlYtCookies.value !== "off") }, ["SET_YT_COOKIES"]);

    syncPreviewUrl();
  }

  function applyVoteSettings() {
    const twitch = String(ctlTwitchChannel?.value || "").trim().replace(/^@/, "");
    if (twitch) sendCmdAliases("SET_TWITCH", { channel: twitch }, ["TWITCH", "SET_CHANNEL"]);

    const voteEnabled = ctlVoteOn ? (ctlVoteOn.value !== "off") : false;
    const overlay = ctlVoteOverlay ? (ctlVoteOverlay.value !== "off") : true;

    const timing = computeVoteTiming();
    const cmdStr = String(ctlVoteCmd?.value || "!next,!cam|!stay,!keep").trim();
    const stayMins = clamp(parseInt(ctlStayMins?.value || "5", 10) || 5, 1, 120);

    sendCmdAliases("SET_VOTE", {
      enabled: voteEnabled,
      overlay,
      windowSec: timing.windowSec,
      voteAtSec: timing.voteAtSec,
      leadSec: timing.leadSec,
      uiSec: timing.uiSec,
      stayMins,
      cmd: cmdStr
    }, ["VOTE_SET", "VOTE"]);

    syncPreviewUrl();
  }

  function applyChatAlertsSettings() {
    if (ctlChatOn) sendCmdAliases("SET_CHAT", { enabled: (ctlChatOn.value !== "off") }, ["CHAT"]);
    if (ctlChatHideCmd) sendCmdAliases("SET_CHAT", { hideCommands: (ctlChatHideCmd.value !== "off") }, ["CHAT_HIDE_CMDS"]);
    if (ctlAlertsOn) sendCmdAliases("SET_ALERTS", { enabled: (ctlAlertsOn.value !== "off") }, ["ALERTS"]);
  }

  function loadAdDurStore() {
    try {
      const raw = lsGet(KEY ? `rlc_ads_dur_v1:${KEY}` : "rlc_ads_dur_v1");
      const j = raw ? JSON.parse(raw) : null;
      const d = clamp(parseInt(String(j?.adDurSec || "0"), 10) || 0, 5, 3600);
      return d || 30;
    } catch (_) { return 30; }
  }

  function applyAdsSettings() {
    const enabled = ctlAdsOn ? (ctlAdsOn.value !== "off") : true;
    const adLead = clamp(parseInt(ctlAdLead?.value || "30", 10) || 30, 0, 300);
    const adDurSec = clamp(parseInt(ctlAdDur?.value || String(loadAdDurStore()), 10) || 30, 5, 3600);
    const showDuring = ctlAdShowDuring ? (ctlAdShowDuring.value !== "off") : true;
    const chatText = String(ctlAdChatText?.value || "").trim();

    // ✅ incluye adDurSec (no rompe si player lo ignora)
    sendCmdAliases("SET_ADS", { enabled, adLead, adDurSec, showDuring, chatText }, ["ADS_SET", "ADS"]);

    try { lsSet((KEY ? `rlc_ads_dur_v1:${KEY}` : "rlc_ads_dur_v1"), JSON.stringify({ adDurSec })); } catch (_) {}
    syncPreviewUrl();
  }

  function adNoticeNow() {
    const sec = clamp(parseInt(ctlAdLead?.value || "30", 10) || 30, 0, 3600);
    sendCmdAliases("AD_NOTICE", { leadSec: sec }, ["ADS_NOTICE"]);
  }

  function adBeginNow() {
    const d = clamp(parseInt(ctlAdDur?.value || String(loadAdDurStore()), 10) || 30, 5, 3600);
    sendCmdAliases("AD_BEGIN", { durationSec: d }, ["ADS_BEGIN"]);

    const txt = String(ctlAdChatText?.value || "").trim();
    if (txt) botSay(txt);
  }

  function adClearNow() {
    sendCmdAliases("AD_CLEAR", {}, ["ADS_CLEAR"]);
  }

  // ✅ Transporte con ALIASES (FIX v2.3.8)
  function doPrev() {
    sendCmdAliases("PREV", {}, ["CAM_PREV", "PREV_CAM", "NAV_PREV"]);
  }
  function doNext() {
    sendCmdAliases("NEXT", {}, ["CAM_NEXT", "NEXT_CAM", "NAV_NEXT"]);
  }
  function doTogglePlay() {
    sendCmdAliases("TOGGLE_PLAY", {}, ["PLAYPAUSE", "PLAY_PAUSE", "PAUSE_TOGGLE"]);
  }
  function doShuffle() {
    sendCmdAliases("RESHUFFLE", {}, ["SHUFFLE", "SHUFFLE_CAMS", "REROLL"]);
  }

  function doGoSelected() {
    const id = ctlSelect?.value;
    if (!id) return;

    sendCmdAliases("GOTO", { id }, ["CAM_GOTO", "SET_CAM", "GOTO_CAM", "NAV_GOTO"]);
    sendCmdAliases("GOTO", { camId: id }, []);
    syncPreviewUrl();
  }

  function doBanSelectedOrCurrent() {
    const id = ctlSelect?.value;
    if (id) sendCmdAliases("BAN", { id }, ["BAN_CAM", "EXCLUDE", "SKIP_ID"]);
    else sendCmdAliases("BAN_CURRENT", {}, ["BAN_CAM_CURRENT", "EXCLUDE_CURRENT", "SKIP_CURRENT"]);
  }

  function doReset() {
    sendCmdAliases("RESET", {}, ["RESET_STATE", "HARD_RESET"]);
  }

  function syncBotUIFromStore() {
    botCfg = loadBotCfg();
    if (ctlBotOn) ctlBotOn.value = botCfg.enabled ? "on" : "off";
    if (ctlBotUser) safeSetValue(ctlBotUser, botCfg.user || "");

    if (ctlBotToken && !isEditing(ctlBotToken)) ctlBotToken.value = botCfg.token ? "********" : "";
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

    if (chan) sendCmdAliases("SET_TWITCH", { channel: chan }, ["TWITCH", "SET_CHANNEL"]);
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
      if (k === "ArrowRight") { e.preventDefault(); doNext(); }
      else if (k === "ArrowLeft") { e.preventDefault(); doPrev(); }
      else if (k === " ") { e.preventDefault(); doTogglePlay(); }
      else if (k.toLowerCase() === "r") { e.preventDefault(); doShuffle(); }
      else if (k.toLowerCase() === "b") { e.preventDefault(); sendCmdAliases("BAN_CURRENT", {}, ["BAN_CAM_CURRENT"]); }
      else if (k === "Enter" && document.activeElement === ctlSelect) { e.preventDefault(); doGoSelected(); }
    }, { passive: false });
  }

  function bindUi() {
    refreshGlobalLists(true);

    safeOn(ctlSearch, "input", debounce(() => syncList(ctlSearch.value), 120));

    // Transporte
    safeOn(ctlPrev, "click", doPrev);
    safeOn(ctlPlay, "click", doTogglePlay);
    safeOn(ctlNext, "click", doNext);
    safeOn(ctlShuffle, "click", doShuffle);

    safeOn(ctlApplyMins, "click", () => {
      const mins = clamp(parseInt(ctlMins?.value || "5", 10) || 5, 1, 120);
      sendCmdAliases("SET_MINS", { mins }, ["MINS", "SET_DURATION"]);
      syncPreviewUrl();
    });

    safeOn(ctlApplySettings, "click", applyBasicSettings);

    // Lista cams
    safeOn(ctlGo, "click", doGoSelected);
    safeOn(ctlBan, "click", doBanSelectedOrCurrent);

    safeOn(ctlSelect, "dblclick", (e) => { e.preventDefault(); doGoSelected(); });
    safeOn(ctlSelect, "keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); doGoSelected(); }
    });

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
      sendCmdAliases("START_VOTE", { windowSec: timing.windowSec, leadSec: timing.leadSec }, ["VOTE_START", "STARTVOTE"]);
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

    // ticker (si existe UI)
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

    // BGM (cmds opcionales) + aliases
    safeOn(ctlBgmOn, "change", () => sendCmdAliases("SET_BGM", { enabled: (ctlBgmOn.value !== "off") }, ["BGM_SET"]));
    safeOn(ctlBgmVol, "input", debounce(() => sendCmdAliases("SET_BGM_VOL", { vol: parseFloat(ctlBgmVol.value || "0.22") || 0.22 }, ["BGM_VOL"]), 120));
    safeOn(ctlBgmPrev, "click", () => sendCmdAliases("BGM_PREV", {}, ["PREV_BGM"]));
    safeOn(ctlBgmPlay, "click", () => sendCmdAliases("BGM_PLAYPAUSE", {}, ["BGM_TOGGLE", "BGM_PLAY_PAUSE"]));
    safeOn(ctlBgmNext, "click", () => sendCmdAliases("BGM_NEXT", {}, ["NEXT_BGM"]));
    safeOn(ctlBgmShuffle, "click", () => sendCmdAliases("BGM_SHUFFLE", {}, ["SHUFFLE_BGM"]));
    safeOn(ctlBgmTrack, "change", () => {
      const idx = parseInt(ctlBgmTrack.value || "0", 10) || 0;
      sendCmdAliases("BGM_TRACK", { idx }, ["SET_BGM_TRACK"]);
    });

    // Auto preview sync cuando cambias selects/inputs
    const autoSync = debounce(syncPreviewUrl, 160);
    [
      ctlMins, ctlFit, ctlHud, ctlHudDetails, ctlAutoskip, ctlAdfree, ctlTwitchChannel,

      // catalog (solo para URL/preview/copy)
      ctlCatalogOn, ctlCatalogLayout, ctlCatalogGap, ctlCatalogLabels, ctlCatalogMode,
      ctlCatalogFollowSlot, ctlCatalogClickCycle, ctlCatalogYtCookies, ctlCatalogWxTiles,
      ctlCatalogWxRefreshSec, ctlCatalogMuted,

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
    try {
      if (bcMain) bcMain.onmessage = (ev) => {
        const msg = ev?.data;
        if (!keyOk(msg, true)) return;
        if (msg?.type === "state") applyState(msg);
        else if (msg?.type === "event") applyEvent(msg);
        else if (msg?.type === "cmd") applyIncomingCmd(msg);
      };
    } catch (_) {}

    try {
      if (bcLegacy) bcLegacy.onmessage = (ev) => {
        const msg = ev?.data;
        if (!keyOk(msg, false)) return;
        if (msg?.type === "state") applyState(msg);
        else if (msg?.type === "event") applyEvent(msg);
        else if (msg?.type === "cmd") applyIncomingCmd(msg);
      };
    } catch (_) {}

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

  // ───────────────────────── SW update awareness (igual)
  function installSwUpdateWatcher() {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) return;

      try { reg.update(); } catch (_) {}

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
      disposers.push(() => { try { reg.removeEventListener("updatefound", onUpdateFound); } catch (_) {} });

      const onControllerChange = () => markUpdateAvailable("Update activo (controller)");
      try { navigator.serviceWorker.addEventListener("controllerchange", onControllerChange); } catch (_) {}
      disposers.push(() => { try { navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange); } catch (_) {} });
    }).catch(() => {});
  }

  // ───────────────────────── Heartbeat
  let heartbeatId = 0;

  function heartbeat() {
    const now = Date.now();
    const age = now - (lastSeenAt || 0);

    if (!updateAvailable) {
      if (age > 3500) {
        const extra = KEY ? ` (key=${KEY.slice(0, 10)}…)` : " (sin key)";
        setStatus(`Sin señal… abre el player en el mismo navegador${extra}`, false);
      }
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

    // precargar adDur
    try {
      if (ctlAdDur && (!ctlAdDur.value || !String(ctlAdDur.value).trim())) {
        ctlAdDur.value = String(loadAdDurStore());
      }
    } catch (_) {}

    // pre-status catálogo
    try {
      if (ctlCatalogStatus && ctlCatalogOn) {
        const on = (ctlCatalogOn.value !== "off");
        setPill(ctlCatalogStatus, on ? "Catálogo: ON" : "Catálogo: OFF", on);
      }
    } catch (_) {}

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
    setStatus(`Control listo · v${APP_VERSION}${KEY ? ` · key OK` : " · (sin key)"}`, true);
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

    for (let i = disposers.length - 1; i >= 0; i--) {
      try { disposers[i]?.(); } catch (_) {}
    }
    disposers.length = 0;

    try { if (g[API_KEY]) g[API_KEY] = null; } catch (_) {}
    try { if (g[SINGLETON_KEY] === instance) g[SINGLETON_KEY] = null; } catch (_) {}
  };

  listen(window, "beforeunload", () => { try { instance.destroy?.(); } catch (_) {} });

  onReady(boot);
})();
