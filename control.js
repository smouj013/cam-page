/* control.js — RLC Control v2.3.9 (NEWSROOM/BROADCAST) — COMPAT “app.js v2.3.8+”
   ✅ FULL + HARDENED + NO DUPES + UPDATE-AWARE
   ✅ Objetivo: que TODOS los botones del panel de control ejecuten acciones en el PLAYER de forma robusta.
   ✅ Compat extra (clave):
      - Envía cmd por BroadcastChannel + localStorage (keyed + legacy)
      - Mensaje cmd incluye campos extra (name/data/action) para players antiguos
      - Payload normalizado (enabled/on, hidden/hide, id/camId/cameraId/value)
      - Refresca listas aunque CAM_LIST se mutile “in-place” (firma + length)
      - Si no existe CAM_LIST local, intenta usar camList/cams del STATE del player
      - Doble click / Enter en select/input = GOTO
      - Selecciona cam actual al recibir state (sin pisar interacción)
      - Auto-detect KEY (si falta) desde storage y la refleja en URL sin recargar
   ✅ FIXES IMPORTANTES (2026-01+):
      - FIX: sendCmdAliases() NO duplica el cmd base
      - postMessage al iframe preview SIEMPRE (además de BC + LS)
      - Polling LS (state/evt/cmd/camlist) para casos donde storage/BC no disparan (iframes/misma pestaña)
      - Delegación opcional por data-cmd/data-action para botones nuevos sin tocar IDs
   ✅ PATCH (BGM + CATALOG SYNC):
      - BGM UI completa (tracks + volumen + prev/next/play/shuffle) + store + envío al player
      - Catalog mode acepta "sync" (y "fixed" como alias legacy)
   ✅ EXTRA FIX (TU CASO REAL):
      - Soporta URL “doble ?” (ej: ?index.html?key=XXX&mins=5) -> parsea key/params y base URL bien
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;
  const APP_VERSION = String((typeof window !== "undefined" && window.APP_VERSION) || "2.3.9");

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

  // ───────────────────────── Singleton anti-dup (upgrade-safe) — BLINDADO
  const SINGLETON_KEY = "__RLC_CONTROL_JS_SINGLETON__";
  const SINGLETON_KIND = "RLC_CONTROL_JS";

  try {
    const existing = g[SINGLETON_KEY];
    if (existing && typeof existing === "object" && existing.kind === SINGLETON_KIND) {
      const prevVer = String(existing.version || "0.0.0");
      if (compareVer(prevVer, APP_VERSION) >= 0) return;
      try { existing.destroy?.(); } catch (_) {}
    }
  } catch (_) {}

  const instance = { kind: SINGLETON_KIND, version: APP_VERSION, _disposed: false, destroy: null };
  try { g[SINGLETON_KEY] = instance; } catch (_) {}

  // ───────────────────────── Utils
  const qs = (s, r = document) => { try { return r.querySelector(s); } catch (_) { return null; } };
  const qsa = (s, r = document) => { try { return Array.from(r.querySelectorAll(s)); } catch (_) { return []; } };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (v, fallback) => {
    const n = parseFloat(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  };
  const safeStr = (v) => (typeof v === "string") ? v.trim() : "";
  const safeJson = (raw, fallback = null) => { try { return JSON.parse(raw); } catch (_) { return fallback; } };
  const sigOf = (s) => String(s || "").trim().slice(0, 260);

  function onReady(fn) {
    if (document.readyState === "complete" || document.readyState === "interactive") setTimeout(fn, 0);
    else document.addEventListener("DOMContentLoaded", fn, { once: true });
  }

  // Debug
  function getFlag(k) {
    try {
      const u = new URL(location.href);
      const v = u.searchParams.get(k);
      if (v == null) return false;
      if (v === "" || v === "1" || v === "true" || v === "yes") return true;
      return false;
    } catch (_) { return false; }
  }
  const DEBUG = getFlag("debug") || (localStorage.getItem("rlc_debug_control") === "1");
  const log = (...a) => { if (DEBUG) console.log("[RLC control]", ...a); };

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

  // Evita submits invisibles (muchas UIs meten botones dentro de <form>)
  listen(document, "submit", (e) => {
    try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
  }, true);

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

  // ───────────────────────── KEY auto-detect + URL “doble ?” support
  const BUS_BASE = "rlc_bus_v1";
  const CMD_KEY_BASE = "rlc_cmd_v1";
  const STATE_KEY_BASE = "rlc_state_v1";
  const EVT_KEY_BASE = "rlc_evt_v1";
  const CAMLIST_KEY_BASE = "rlc_cam_list_v1";

  const BOT_STORE_KEY_BASE = "rlc_bot_cfg_v1";
  const TICKER_CFG_KEY_BASE = "rlc_ticker_cfg_v1";
  const HELIX_CFG_KEY_BASE  = "rlc_helix_cfg_v1";
  const COUNTDOWN_CFG_KEY_BASE = "rlc_countdown_cfg_v1";
  const BGM_CFG_KEY_BASE = "rlc_bgm_cfg_v1";

  function _extractParamsFromWeirdSearch() {
    // Soporta: ?index.html?key=XXX&mins=5  (doble ?)
    try {
      const s = String(location.search || "");
      if (!s.startsWith("?")) return new URLSearchParams("");
      const parts = s.slice(1).split("?");
      // si hay doble ?, lo “real” suele ir en el último bloque
      const tail = parts.length >= 2 ? parts[parts.length - 1] : parts[0];
      return new URLSearchParams(tail || "");
    } catch (_) {
      return new URLSearchParams("");
    }
  }

  function parseParams() {
    let key = "";
    let autoReload = "";

    try {
      const u = new URL(location.href);
      key = safeStr(u.searchParams.get("key") || "");
      autoReload = safeStr(u.searchParams.get("autoReload") || "");
    } catch (_) {}

    if (!key || !autoReload) {
      const sp2 = _extractParamsFromWeirdSearch();
      if (!key) key = safeStr(sp2.get("key") || "");
      if (!autoReload) autoReload = safeStr(sp2.get("autoReload") || "");
    }

    // regex fallback “por si acaso”
    if (!key) {
      try {
        const m = String(location.href || "").match(/(?:\?|&)key=([^&#]+)/i);
        if (m) key = safeStr(decodeURIComponent(m[1] || ""));
      } catch (_) {}
    }

    return { key, autoReload };
  }

  function inferKeyFromStorage() {
    const last = safeStr(lsGet("rlc_last_key_v1") || "");
    if (last) return last;

    // Busca cualquier rlc_state_vX:{key} y se queda con el más reciente por ts
    try {
      let bestKey = "";
      let bestTs = 0;

      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;

        const m = k.match(/^rlc_state_v\d+:(.+)$/);
        if (!m) continue;

        const maybeKey = String(m[1] || "").trim();
        if (!maybeKey) continue;

        const raw = lsGet(k);
        const stAny = safeJson(raw, null);

        const st = (stAny && typeof stAny === "object" && stAny.type === "state" && stAny.state)
          ? stAny.state
          : stAny;

        const ts = (st && typeof st === "object")
          ? (Number(st.ts || st.lastTs || st.lastSeen || st.lastUpdate || 0) || 0)
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

  // reflejar KEY inferida en URL sin recargar
  try {
    if (KEY && !P0.key) {
      const u = new URL(location.href);
      // si estamos en modo “doble ?” no queremos romperlo: añadimos key normal igualmente
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
  const CAMLIST_KEY = KEY ? `${CAMLIST_KEY_BASE}:${KEY}` : CAMLIST_KEY_BASE;

  // Legacy keys (sin key)
  const BUS_LEGACY = BUS_BASE;
  const CMD_KEY_LEGACY = CMD_KEY_BASE;
  const STATE_KEY_LEGACY = STATE_KEY_BASE;
  const EVT_KEY_LEGACY = EVT_KEY_BASE;
  const CAMLIST_KEY_LEGACY = CAMLIST_KEY_BASE;

  const BOT_STORE_KEY = KEY ? `${BOT_STORE_KEY_BASE}:${KEY}` : BOT_STORE_KEY_BASE;
  const TICKER_CFG_KEY = KEY ? `${TICKER_CFG_KEY_BASE}:${KEY}` : TICKER_CFG_KEY_BASE;
  const HELIX_CFG_KEY  = KEY ? `${HELIX_CFG_KEY_BASE}:${KEY}` : HELIX_CFG_KEY_BASE;
  const COUNTDOWN_CFG_KEY = KEY ? `${COUNTDOWN_CFG_KEY_BASE}:${KEY}` : COUNTDOWN_CFG_KEY_BASE;
  const BGM_CFG_KEY = KEY ? `${BGM_CFG_KEY_BASE}:${KEY}` : BGM_CFG_KEY_BASE;

  // BroadcastChannels
  let bcMain = null;
  let bcLegacy = null;
  try { bcMain = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS) : null; } catch (_) { bcMain = null; }
  try { bcLegacy = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_LEGACY) : null; } catch (_) { bcLegacy = null; }

  function busPost(msg) {
    try { if (bcMain) bcMain.postMessage(msg); } catch (_) {}
    try { if (bcLegacy) bcLegacy.postMessage(msg); } catch (_) {}
  }

  // Preview postMessage (fiabilidad máxima)
  function postToPreview(msg) {
    try {
      const ifr = qs("#ctlPreview");
      const cw = ifr?.contentWindow;
      if (!cw || typeof cw.postMessage !== "function") return;

      // targetOrigin seguro (misma origin) -> fallback "*"
      let origin = "*";
      try { origin = String(location.origin || "*"); } catch (_) {}
      try { cw.postMessage(msg, origin || "*"); }
      catch (_) { try { cw.postMessage(msg, "*"); } catch (_) {} }
    } catch (_) {}
  }

  // ───────────────────────── Cmd compat payload normalizer
  function _asBool(v) {
    if (typeof v === "boolean") return v;
    const s = String(v ?? "").trim().toLowerCase();
    if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
    if (s === "0" || s === "false" || s === "no" || s === "off") return false;
    return null;
  }

  function normalizeCmdPayload(p) {
    const payload = (p && typeof p === "object") ? Object.assign({}, p) : {};

    // enabled => on (y viceversa) + tolerancia strings
    if (payload.on == null && payload.enabled != null) {
      const b = _asBool(payload.enabled);
      if (b != null) payload.on = b;
    }
    if (payload.enabled == null && payload.on != null) {
      const b = _asBool(payload.on);
      if (b != null) payload.enabled = b;
    }

    // hidden => hide + tolerancia strings
    if (payload.hide == null && payload.hidden != null) {
      const b = _asBool(payload.hidden);
      if (b != null) payload.hide = b;
    }
    if (payload.hidden == null && payload.hide != null) {
      const b = _asBool(payload.hide);
      if (b != null) payload.hidden = b;
    }

    // id/camId/cameraId/value coherentes
    const id = payload.id ?? payload.camId ?? payload.cameraId ?? payload.value ?? null;
    if (id != null) {
      if (payload.id == null) payload.id = id;
      if (payload.camId == null) payload.camId = id;
      if (payload.cameraId == null) payload.cameraId = id;
      if (payload.value == null) payload.value = id;
    }
    return payload;
  }

  function sendCmd(cmd, payload = {}) {
    const c = String(cmd || "").trim();
    if (!c) return;

    const pl = normalizeCmdPayload(payload);

    const now = Date.now();
    const msg = {
      type: "cmd",
      ts: now,
      mid: `${now}_${Math.random().toString(16).slice(2)}`,
      cmd: c,
      payload: pl,

      // compat campos extra (por si el player usa otros nombres)
      name: c,
      action: c,
      data: pl,

      from: "control",
      ver: APP_VERSION
    };
    if (KEY) msg.key = KEY;

    const raw = JSON.stringify(msg);

    // localStorage (keyed + legacy)
    lsSet(CMD_KEY, raw);
    lsSet(CMD_KEY_LEGACY, raw);

    // BroadcastChannel (keyed + legacy)
    busPost(msg);

    // postMessage al preview (SIEMPRE; app.js v2.3.8 dedupe cross-canal)
    postToPreview(msg);

    log("sendCmd", c, pl);
  }

  // ✅ ALIASES (compat con distintos players) — NO duplica el cmd base
  function sendCmdAliases(cmd, payload = {}, aliases = []) {
    const sent = new Set();
    const pl = normalizeCmdPayload(payload);

    const push = (c) => {
      const cc = String(c || "").trim();
      if (!cc || sent.has(cc)) return;
      sent.add(cc);
      sendCmd(cc, pl);
    };

    push(cmd);
    for (const a of (aliases || [])) push(a);
  }

  // API global segura
  const API_KEY = "__RLC_CONTROL_API_V1__";
  let lastState = null;

  // ───────────────────────── DOM cache
  let
    ctlStatus, ctlNowTitle, ctlNowPlace, ctlNowTimer, ctlOrigin,
    ctlPrev, ctlPlay, ctlNext, ctlShuffle,
    ctlMins, ctlApplyMins, ctlApplySettings, ctlFit, ctlHud, ctlHudDetails, ctlAutoskip, ctlAdfree, ctlReset,
    ctlSearch, ctlSelect, ctlGo, ctlBan,
    ctlPreviewOn, ctlPreviewWrap, ctlPreview,
    ctlCopyStreamUrl,
    ctlBgmOn, ctlBgmVol, ctlBgmTrack, ctlBgmPrev, ctlBgmPlay, ctlBgmNext, ctlBgmShuffle, ctlBgmNow,

    // CATALOG (si existe)
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

    // ticker (opcionales)
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

    // countdown
    ctlCountdownOn = qs("#ctlCountdownOn");
    ctlCountdownLabel = qs("#ctlCountdownLabel");
    ctlCountdownTarget = qs("#ctlCountdownTarget");
    ctlCountdownApply = qs("#ctlCountdownApply");
    ctlCountdownReset = qs("#ctlCountdownReset");
    ctlCountdownStatus = qs("#ctlCountdownStatus");

    // helix
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

  // ───────────────────────── Camera list system (MUY robusto)
  let allCams = [];
  let _lastCamRef = null;
  let _lastCamLen = 0;
  let _lastCamSig = "";
  let _lastListUpdateAt = 0;

  function normalizeCamItem(c, i = 0) {
    if (!c || typeof c !== "object") {
      return { id: String(i), title: "Live Cam", place: "", source: "", originUrl: "" };
    }
    const id = (c.id ?? c.camId ?? c.cameraId ?? c.value ?? c.key ?? i);
    return {
      id: String(id),
      title: String(c.title ?? c.name ?? c.label ?? "Live Cam"),
      place: String(c.place ?? c.location ?? ""),
      source: String(c.source ?? ""),
      originUrl: String(c.originUrl ?? c.url ?? c.href ?? "")
    };
  }

  function camListSignature(list) {
    try {
      const L = list.length || 0;
      if (!L) return "";
      const take = Math.min(12, L);
      const ids = [];
      for (let i = 0; i < take; i++) {
        const idx = (take === 1) ? 0 : Math.round((i * (L - 1)) / (take - 1));
        ids.push(String(list[idx]?.id || ""));
      }
      return `${L}|${ids.join("|")}`;
    } catch (_) { return ""; }
  }

  function setCamList(list, why = "") {
    const norm = Array.isArray(list) ? list.map(normalizeCamItem) : [];
    const sig = camListSignature(norm);
    if (!norm.length) return false;

    // evita refresco si no cambia
    if (sig && sig === _lastCamSig && norm.length === _lastCamLen) return false;

    allCams = norm;
    _lastCamLen = norm.length;
    _lastCamSig = sig;
    _lastCamRef = list;
    _lastListUpdateAt = Date.now();

    // Persistimos para futuras aperturas del control
    try {
      const raw = JSON.stringify({ ts: Date.now(), cams: allCams });
      lsSet(CAMLIST_KEY, raw);
      lsSet(CAMLIST_KEY_LEGACY, raw);
    } catch (_) {}

    syncList(String(ctlSearch?.value || ""));
    log("setCamList", why, { len: allCams.length, sig: _lastCamSig });
    return true;
  }

  function stateCamListFallback(st) {
    try {
      const cand =
        (Array.isArray(st?.camList) && st.camList) ||
        (Array.isArray(st?.cams) && st.cams) ||
        (Array.isArray(st?.list) && st.list) ||
        (Array.isArray(st?.cameras) && st.cameras) ||
        null;

      if (!cand) return null;
      return cand.map(normalizeCamItem);
    } catch (_) { return null; }
  }

  function readCamListFromLS() {
    // Claves directas primero
    const direct =
      safeJson(lsGet(CAMLIST_KEY) || "", null) ||
      safeJson(lsGet(CAMLIST_KEY_LEGACY) || "", null);

    const arr1 = Array.isArray(direct) ? direct
      : Array.isArray(direct?.cams) ? direct.cams
      : null;

    if (arr1 && arr1.length) return arr1.map(normalizeCamItem);

    // Fallback: escaneo tolerante
    try {
      let best = null;
      let bestTs = 0;

      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (!/cam(_)?list|cams(_)?list|cameras/i.test(k)) continue;

        const raw = lsGet(k);
        const obj = safeJson(raw, null);
        if (!obj) continue;

        const arr = Array.isArray(obj) ? obj
          : Array.isArray(obj?.cams) ? obj.cams
          : Array.isArray(obj?.camList) ? obj.camList
          : Array.isArray(obj?.list) ? obj.list
          : null;

        if (!arr || !arr.length) continue;

        const ts = Number(obj?.ts || obj?.lastTs || obj?.updatedAt || 0) || 0;
        const score = ts || arr.length;

        if (score > bestTs) {
          bestTs = score;
          best = arr;
        }
      }
      if (best) return best.map(normalizeCamItem);
    } catch (_) {}

    return null;
  }

  function syncList(filter = "") {
    if (!ctlSelect) return;

    const f = String(filter || "").trim().toLowerCase();
    const tag = String(ctlSelect.tagName || "").toLowerCase();
    const prevVal = String(ctlSelect.value || "");

    if (tag === "select") {
      try { ctlSelect.innerHTML = ""; } catch (_) {}

      const frag = document.createDocumentFragment();
      for (const cam of allCams) {
        const hay = `${cam?.title || ""} ${cam?.place || ""} ${cam?.source || ""} ${cam?.id || ""}`.toLowerCase();
        if (f && !hay.includes(f)) continue;
        const opt = document.createElement("option");
        opt.value = String(cam.id ?? "");
        opt.textContent = label(cam);
        frag.appendChild(opt);
      }
      try { ctlSelect.appendChild(frag); } catch (_) {}

      try {
        const curId = String(lastState?.cam?.id || lastState?.currentCam?.id || "");
        if (curId && !isEditing(ctlSelect)) ctlSelect.value = curId;
        else if (prevVal && !isEditing(ctlSelect)) ctlSelect.value = prevVal;
      } catch (_) {}

      try {
        if (!ctlSelect.value && ctlSelect.options?.length) ctlSelect.selectedIndex = 0;
      } catch (_) {}

      return;
    }

    if (tag === "input") {
      let dl = qs("#ctlSelectDatalist");
      if (!dl) {
        dl = document.createElement("datalist");
        dl.id = "ctlSelectDatalist";
        document.body.appendChild(dl);
      }
      try { ctlSelect.setAttribute("list", dl.id); } catch (_) {}

      try { dl.innerHTML = ""; } catch (_) {}
      const frag = document.createDocumentFragment();
      for (const cam of allCams) {
        const hay = `${cam?.title || ""} ${cam?.place || ""} ${cam?.source || ""} ${cam?.id || ""}`.toLowerCase();
        if (f && !hay.includes(f)) continue;
        const opt = document.createElement("option");
        opt.value = String(cam.id ?? "");
        opt.label = label(cam);
        frag.appendChild(opt);
      }
      try { dl.appendChild(frag); } catch (_) {}

      if (!isEditing(ctlSelect) && prevVal) safeSetValue(ctlSelect, prevVal);
    }
  }

  function refreshGlobalLists(force = false) {
    try {
      const camRef = Array.isArray(g.CAM_LIST) ? g.CAM_LIST : null;
      const camFromState = (!camRef && lastState) ? stateCamListFallback(lastState) : null;
      const camFromLS = (!camRef && !camFromState) ? readCamListFromLS() : null;

      const effective = camRef ? camRef.map(normalizeCamItem)
        : camFromState ? camFromState
        : camFromLS ? camFromLS
        : null;

      if (!effective || !effective.length) return;

      let camChanged = false;
      if (force) camChanged = true;
      else if (effective !== _lastCamRef) camChanged = true;
      else if (effective.length !== _lastCamLen) camChanged = true;
      else {
        const sig = camListSignature(effective);
        if (sig && sig !== _lastCamSig) camChanged = true;
      }

      if (camChanged) setCamList(effective, force ? "force" : "refresh");
    } catch (_) {}
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
    postToPreview(msg);

    sendCmdAliases("TICKER_SET", c, ["SET_TICKER", "TICKER"]);
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
    postToPreview(msg);
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

  // ───────────────────────── BGM (PATCH: funcional completo)
  const BGM_DEFAULTS = { enabled: false, vol: 0.25, trackId: "" };

  function normalizeBgmCfg(inCfg) {
    const c = Object.assign({}, BGM_DEFAULTS, (inCfg || {}));
    c.enabled = (c.enabled === true) || (c.enabled === 1) || (c.enabled === "on");
    c.vol = clamp(num(c.vol, BGM_DEFAULTS.vol), 0, 1);
    c.trackId = String(c.trackId || c.track || c.id || "").trim();
    return c;
  }

  function loadBgmCfg() {
    try {
      const rawKeyed = lsGet(BGM_CFG_KEY);
      if (rawKeyed) return normalizeBgmCfg(JSON.parse(rawKeyed));
    } catch (_) {}
    try {
      const rawBase = lsGet(BGM_CFG_KEY_BASE);
      if (rawBase) return normalizeBgmCfg(JSON.parse(rawBase));
    } catch (_) {}
    return normalizeBgmCfg(BGM_DEFAULTS);
  }

  function saveBgmCfg(cfg) {
    const c = normalizeBgmCfg(cfg);
    const raw = JSON.stringify(c);
    lsSet(BGM_CFG_KEY, raw);
    lsSet(BGM_CFG_KEY_BASE, raw);
    return c;
  }

  let bgmCfg = loadBgmCfg();
  let bgmTracks = [];
  let bgmTracksSig = "";

  function _normTrack(t, i) {
    if (typeof t === "string") {
      const id = t.trim();
      const base = id.split("/").pop() || id;
      const title = base.replace(/\.[a-z0-9]+$/i, "");
      return { id: id || String(i), title: title || `Track ${i + 1}` };
    }
    if (t && typeof t === "object") {
      const id = String(t.id ?? t.key ?? t.trackId ?? t.file ?? t.src ?? t.url ?? i).trim();
      const title = String(t.title ?? t.name ?? t.label ?? id).trim();
      return { id: id || String(i), title: title || `Track ${i + 1}` };
    }
    return { id: String(i), title: `Track ${i + 1}` };
  }

  function detectBgmTracks() {
    try {
      const cand =
        g.RLC_BGM_TRACKS ||
        g.RLC_MUSIC_TRACKS ||
        g.BGM_TRACKS ||
        g.MUSIC_TRACKS ||
        g.TRACKS ||
        g.MUSIC_LIST ||
        g.RLCMusic?.tracks ||
        g.rlcMusic?.tracks ||
        null;

      if (!Array.isArray(cand) || !cand.length) return [];
      return cand.map((t, i) => _normTrack(t, i)).filter(x => x && x.id);
    } catch (_) { return []; }
  }

  function ensureBgmTrackOptions() {
    if (!ctlBgmTrack) return;

    const list = detectBgmTracks();
    const sig = list.length ? `${list.length}|${list.map(x => x.id).slice(0, 16).join("|")}` : "";

    if (!list.length) return;
    if (sig && sig === bgmTracksSig && (ctlBgmTrack.options?.length || 0) >= list.length) return;

    bgmTracks = list;
    bgmTracksSig = sig;

    const prev = String(ctlBgmTrack.value || "");
    try { ctlBgmTrack.innerHTML = ""; } catch (_) {}

    try {
      const o0 = document.createElement("option");
      o0.value = "";
      o0.textContent = "Auto";
      ctlBgmTrack.appendChild(o0);
    } catch (_) {}

    const frag = document.createDocumentFragment();
    for (const tr of bgmTracks) {
      const opt = document.createElement("option");
      opt.value = tr.id;
      opt.textContent = tr.title;
      frag.appendChild(opt);
    }
    try { ctlBgmTrack.appendChild(frag); } catch (_) {}

    const desired = bgmCfg?.trackId || prev;
    if (desired && !isEditing(ctlBgmTrack)) {
      try { ctlBgmTrack.value = desired; } catch (_) {}
    }
  }

  function getBgmIndexById(id) {
    const tid = String(id || "").trim();
    if (!tid || !bgmTracks?.length) return -1;
    return bgmTracks.findIndex(t => String(t.id) === tid);
  }

  function setBgmNowLine(text) {
    if (!ctlBgmNow) return;
    try { ctlBgmNow.textContent = text; } catch (_) {}
  }

  function readBgmUI() {
    const base = bgmCfg || loadBgmCfg();
    const enabled = ctlBgmOn ? (ctlBgmOn.value !== "off") : base.enabled;
    const vol = ctlBgmVol ? clamp(num(ctlBgmVol.value, base.vol ?? 0.25), 0, 1) : (base.vol ?? 0.25);
    const trackId = ctlBgmTrack ? String(ctlBgmTrack.value || base.trackId || "").trim() : String(base.trackId || "").trim();
    return normalizeBgmCfg({ enabled, vol, trackId });
  }

  function sendBgmCfg(cfg, persist = true) {
    const c = persist ? saveBgmCfg(cfg) : normalizeBgmCfg(cfg);

    const idx = getBgmIndexById(c.trackId);
    const payload = Object.assign({}, c, {
      trackId: c.trackId,
      trackIndex: idx,
      index: idx,
      track: (c.trackId || idx),
      volume: c.vol,
      vol: c.vol
    });

    const msg = { type: "BGM_CFG", ts: Date.now(), cfg: payload };
    if (KEY) msg.key = KEY;
    busPost(msg);
    postToPreview(msg);

    sendCmdAliases("BGM_SET", payload, ["SET_BGM", "BGM_CFG", "MUSIC_SET", "SET_MUSIC"]);

    const tname = (c.trackId && bgmTracks?.length)
      ? (bgmTracks.find(t => t.id === c.trackId)?.title || c.trackId)
      : "Auto";
    setBgmNowLine(`${c.enabled ? "BGM: ON" : "BGM: OFF"} · ${tname} · ${Math.round(c.vol * 100)}%`);

    return c;
  }

  function syncBgmUIFromStore() {
    bgmCfg = loadBgmCfg();
    ensureBgmTrackOptions();

    if (ctlBgmOn) ctlBgmOn.value = bgmCfg.enabled ? "on" : "off";
    if (ctlBgmVol && !isEditing(ctlBgmVol)) ctlBgmVol.value = String(bgmCfg.vol ?? 0.25);
    if (ctlBgmTrack && !isEditing(ctlBgmTrack)) ctlBgmTrack.value = String(bgmCfg.trackId || "");

    const tname = (bgmCfg.trackId && bgmTracks?.length)
      ? (bgmTracks.find(t => t.id === bgmCfg.trackId)?.title || bgmCfg.trackId)
      : "Auto";
    setBgmNowLine(`${bgmCfg.enabled ? "BGM: ON" : "BGM: OFF"} · ${tname} · ${Math.round((bgmCfg.vol ?? 0.25) * 100)}%`);
  }

  const applyBgmNow = debounce(() => {
    bgmCfg = sendBgmCfg(readBgmUI(), true);
  }, 80);

  function bgmPrev() { sendCmdAliases("BGM_PREV", {}, ["MUSIC_PREV", "BGM_BACK", "TRACK_PREV"]); }
  function bgmNext() { sendCmdAliases("BGM_NEXT", {}, ["MUSIC_NEXT", "TRACK_NEXT"]); }
  function bgmToggle() { sendCmdAliases("BGM_TOGGLE", {}, ["MUSIC_TOGGLE", "BGM_PLAYPAUSE", "MUSIC_PLAYPAUSE"]); }
  function bgmShuffle() { sendCmdAliases("BGM_SHUFFLE", {}, ["MUSIC_SHUFFLE", "TRACK_SHUFFLE", "BGM_RANDOM"]); }

  // ───────────────────────── Helix y Bot (base)
  const HELIX_DEFAULTS = {
    enabled: false,
    clientId: "",
    token: "",
    broadcasterId: "",
    template: "📍: {title}{placeSep}{place} | GlobalEye TV",
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
    try { const rawKeyed = lsGet(HELIX_CFG_KEY); if (rawKeyed) return normalizeHelixCfg(JSON.parse(rawKeyed)); } catch (_) {}
    try { const rawBase = lsGet(HELIX_CFG_KEY_BASE); if (rawBase) return normalizeHelixCfg(JSON.parse(rawBase)); } catch (_) {}
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

  // ───────────────────────── Bot IRC
  const BOT_DEFAULTS = { enabled: false, user: "", token: "", channel: "", sayOnAd: true };
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
    try { const raw = lsGet(BOT_STORE_KEY); if (raw) return normalizeBotCfg(JSON.parse(raw)); } catch (_) {}
    try { const raw = lsGet(BOT_STORE_KEY_BASE); if (raw) return normalizeBotCfg(JSON.parse(raw)); } catch (_) {}
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
  let lastBotSayAt = 0;
  let lastBotSaySig = "";

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

  function _detectVirtualPage() {
    // Si estás en /cam-page/ y la query es ?index.html?key=... -> virtualPage = index.html
    try {
      const s = String(location.search || "");
      if (!s.startsWith("?")) return "";
      const first = s.slice(1).split("?")[0] || "";
      return (/\.html$/i.test(first)) ? first : "";
    } catch (_) { return ""; }
  }

  function getBasePlayerUrl() {
    const u = new URL(location.href);
    const p = String(u.pathname || "");
    const vp = _detectVirtualPage(); // "index.html" / "control.html" etc.

    // Si hay virtualPage, tratamos pathname como si estuviera en esa página
    // y luego apuntamos a index.html
    if (vp && !/\/[^/]+\.(html)$/i.test(p)) {
      // pathname acaba en "/" normalmente
      if (p.endsWith("/")) u.pathname = p + vp;
      else u.pathname = p + "/" + vp;
    }

    const path = String(u.pathname || "");

    if (/\/control\.html$/i.test(path)) u.pathname = path.replace(/\/control\.html$/i, "/index.html");
    else if (/\/control$/i.test(path)) u.pathname = path.replace(/\/control$/i, "/index.html");
    else if (!/\/index\.html$/i.test(path)) u.pathname = path.replace(/\/[^/]*$/i, "/index.html");

    u.search = "";
    u.hash = "";
    return u;
  }

  function readCatalogUIForUrl() {
    const enabled = ctlCatalogOn ? (ctlCatalogOn.value !== "off") : false;
    const layout = ctlCatalogLayout ? String(ctlCatalogLayout.value || "quad") : "quad";
    const gap = ctlCatalogGap ? clamp(parseInt(ctlCatalogGap.value || "8", 10) || 8, 0, 24) : 8;
    const labels = ctlCatalogLabels ? (ctlCatalogLabels.value !== "off") : true;

    const mode = ctlCatalogMode ? String(ctlCatalogMode.value || "follow") : "follow";
    const followSlot = ctlCatalogFollowSlot ? clamp(parseInt(ctlCatalogFollowSlot.value || "0", 10) || 0, 0, 3) : 0;

    const clickCycle = ctlCatalogClickCycle ? (ctlCatalogClickCycle.value !== "off") : true;
    const ytCookies = ctlCatalogYtCookies ? (ctlCatalogYtCookies.value !== "off") : true;

    const wxTiles = ctlCatalogWxTiles ? (ctlCatalogWxTiles.value !== "off") : true;
    const wxRefreshSec = ctlCatalogWxRefreshSec ? clamp(parseInt(ctlCatalogWxRefreshSec.value || "30", 10) || 30, 10, 180) : 30;

    const muted = ctlCatalogMuted ? (ctlCatalogMuted.value !== "off") : true;

    return { enabled, layout, gap, labels, mode, followSlot, clickCycle, ytCookies, wxTiles, wxRefreshSec, muted };
  }

  function readBgmUIForUrl() {
    const base = bgmCfg || loadBgmCfg();
    const enabled = ctlBgmOn ? (ctlBgmOn.value !== "off") : base.enabled;
    const vol = ctlBgmVol ? clamp(num(ctlBgmVol.value, base.vol ?? 0.25), 0, 1) : (base.vol ?? 0.25);
    const trackId = ctlBgmTrack ? String(ctlBgmTrack.value || base.trackId || "").trim() : String(base.trackId || "").trim();
    return normalizeBgmCfg({ enabled, vol, trackId });
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
    const cat = readCatalogUIForUrl();
    const bgm = readBgmUIForUrl();

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

    // Catalog params
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

    // BGM params
    u.searchParams.set("bgm", boolParam(!!bgm.enabled));
    u.searchParams.set("bgmVol", String(bgm.vol ?? 0.25));
    if (bgm.trackId) u.searchParams.set("bgmTrack", String(bgm.trackId));

    return u.toString();
  }

  // Exponer API
  try {
    g[API_KEY] = {
      kind: "RLC_CONTROL_API",
      version: APP_VERSION,
      key: KEY,
      bus: BUS,
      sendCmd,
      sendCmdAliases,
      busPost,
      postToPreview,
      getState: () => lastState,
      refreshLists: (force = false) => refreshGlobalLists(!!force),
      buildStreamUrlFromUI: () => buildStreamUrlFromUI(),
    };
  } catch (_) {}

  // ───────────────────────── Incoming state/events/cmd
  let lastSeenAt = 0;

  function getStateTs(st) {
    return Number(st?.ts ?? st?.lastTs ?? st?.lastSeen ?? st?.lastUpdate ?? 0) || 0;
  }

  function _bgmFromState(st) {
    try {
      const b = st?.bgm || st?.music || st?.audio?.bgm || null;
      if (!b || typeof b !== "object") return null;
      const enabled = (b.enabled === true) || (b.on === true);
      const vol = clamp(num(b.vol ?? b.volume, 0.25), 0, 1);
      const trackId = String(b.trackId ?? b.track ?? b.id ?? "").trim();
      const trackTitle = String(b.title ?? b.trackTitle ?? "").trim();
      const playing = (b.playing === true) || (b.isPlaying === true);
      return { enabled, vol, trackId, trackTitle, playing };
    } catch (_) { return null; }
  }

  function stateSignature(st) {
    try {
      const cam = st?.cam || st?.currentCam || {};
      const rem = Number(st?.remaining ?? st?.remain ?? st?.left ?? st?.timeLeft ?? 0) || 0;
      const mins = Number(st?.mins ?? 0) || 0;
      const ver = String(st?.version || "");
      const id = String(cam?.id || "");
      const bgm = _bgmFromState(st);
      const bgmSig = bgm ? `${bgm.enabled ? 1 : 0}|${Math.round((bgm.vol ?? 0) * 100)}|${bgm.trackId || ""}|${bgm.playing ? 1 : 0}` : "0";
      return sigOf(`${getStateTs(st)}|${ver}|${id}|${rem}|${mins}|${st?.autoskip ? 1 : 0}|${st?.adfree ? 1 : 0}|${bgmSig}`);
    } catch (_) { return ""; }
  }

  let lastStateTs = 0;
  let lastStateSig = "";

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

  function syncPreviewUrl() {
    if (!ctlPreviewOn || !ctlPreviewWrap || !ctlPreview) return;
    const on = (ctlPreviewOn.value !== "off");
    try { ctlPreviewWrap.style.display = on ? "" : "none"; } catch (_) {}

    if (!on) return;

    try {
      const url = buildStreamUrlFromUI();
      if (url && ctlPreview.src !== url) ctlPreview.src = url;
    } catch (_) {}
  }

  function applyState(stAny) {
    if (!stAny || typeof stAny !== "object") return;

    const st = (stAny.type === "state" && stAny.state && typeof stAny.state === "object") ? stAny.state : stAny;

    const ts = getStateTs(st);
    const sig = stateSignature(st);
    if (ts && ts < lastStateTs) return;
    if (ts && ts === lastStateTs && sig && sig === lastStateSig) return;
    if (ts) lastStateTs = ts;
    if (sig) lastStateSig = sig;

    lastState = st;
    lastSeenAt = Date.now();

    try {
      const fromState = stateCamListFallback(st);
      if (fromState && fromState.length) setCamList(fromState, "state");
    } catch (_) {}

    const cam = st.cam || st.currentCam || {};
    try { if (ctlNowTitle) ctlNowTitle.textContent = String(cam.title || "—"); } catch (_) {}
    try { if (ctlNowPlace) ctlNowPlace.textContent = String(cam.place || "—"); } catch (_) {}
    try {
      const rem = (st.remaining ?? st.remain ?? st.left ?? st.timeLeft ?? 0);
      ctlNowTimer && (ctlNowTimer.textContent = fmtMMSS((rem | 0)));
    } catch (_) {}

    if (ctlOrigin) {
      const url = String(cam.originUrl || cam.url || "");
      ctlOrigin.href = url || "#";
      try { ctlOrigin.style.pointerEvents = url ? "auto" : "none"; } catch (_) {}
      try { ctlOrigin.style.opacity = url ? "1" : ".6"; } catch (_) {}
    }

    try {
      const curId = String(cam.id || "");
      const tag = ctlSelect ? String(ctlSelect.tagName || "").toLowerCase() : "";
      if (curId && ctlSelect && tag === "select" && !isEditing(ctlSelect)) ctlSelect.value = curId;
    } catch (_) {}

    try {
      const b = _bgmFromState(st);
      if (b) {
        ensureBgmTrackOptions();
        if (ctlBgmOn && !isEditing(ctlBgmOn)) ctlBgmOn.value = b.enabled ? "on" : "off";
        if (ctlBgmVol && !isEditing(ctlBgmVol)) ctlBgmVol.value = String(b.vol ?? 0.25);
        if (ctlBgmTrack && b.trackId && !isEditing(ctlBgmTrack)) ctlBgmTrack.value = b.trackId;

        const title = b.trackTitle
          || (b.trackId && bgmTracks?.length ? (bgmTracks.find(t => t.id === b.trackId)?.title || b.trackId) : "")
          || (b.trackId || "Auto");
        setBgmNowLine(`${b.enabled ? "BGM: ON" : "BGM: OFF"}${b.playing ? " ▶" : ""} · ${title} · ${Math.round((b.vol ?? 0.25) * 100)}%`);
      }
    } catch (_) {}

    const pv = String(st.version || "");
    if (pv && compareVer(pv, APP_VERSION) > 0) {
      markUpdateAvailable(`Player v${pv} > Control v${APP_VERSION}`);
    } else if (!updateAvailable) {
      setStatus(`Conectado · Control v${APP_VERSION} · Player v${pv || "?"}`, true);
    }

    refreshGlobalLists(false);
    syncPreviewUrl();
  }

  function applyEvent(evAny) {
    const ev = (evAny && typeof evAny === "object")
      ? ((evAny.type === "event" && evAny.event) ? evAny.event : evAny)
      : null;
    if (!ev) return;

    const name = String(ev.name || ev.type || "");
    if (name === "AD_AUTO_NOTICE") {
      if (botCfg?.enabled && botCfg?.sayOnAd) botSay("⚠️ Anuncio en breve… ¡gracias por apoyar el canal! 💜");
    }
    if (name === "AD_AUTO_BEGIN") {
      if (botCfg?.enabled && botCfg?.sayOnAd) {
        const txt = String(ctlAdChatText?.value || "").trim();
        if (txt) botSay(txt);
      }
    }

    if (name === "CAM_LIST" || name === "CAMS_LIST") {
      const list = ev.cams || ev.camList || ev.list || null;
      if (Array.isArray(list) && list.length) setCamList(list, "event");
    }
  }

  // dedupe cmd receive (BOT_SAY)
  let lastSeenCmdSig = "";
  let lastSeenCmdAt = 0;

  function applyIncomingCmd(msgAny) {
    if (!msgAny || typeof msgAny !== "object") return;

    const msg = (msgAny.kind === "rlc_cmd" && msgAny.data && typeof msgAny.data === "object")
      ? msgAny.data
      : msgAny;

    const type = String(msg.type || msg.kind || "").toLowerCase();
    if (type !== "cmd") return;

    const cmd = String(msg.cmd || msg.name || msg.action || "");
    const payload = msg.payload || msg.data || {};

    const sig = sigOf(`${msg.mid || ""}|${msg.ts || ""}|${cmd}|${JSON.stringify(payload || {})}`);
    const now = Date.now();
    if (sig && sig === lastSeenCmdSig && (now - lastSeenCmdAt) < 1200) return;
    lastSeenCmdSig = sig;
    lastSeenCmdAt = now;

    if (cmd === "BOT_SAY") {
      const text = String(payload.text || payload.msg || "").trim();
      if (text) botSay(text);
    }

    if (cmd === "CAM_LIST" || cmd === "CAMS_LIST") {
      const list = payload.cams || payload.camList || payload.list || null;
      if (Array.isArray(list) && list.length) setCamList(list, "cmd");
    }

    if (cmd === "BGM_CFG" || cmd === "BGM_SET" || cmd === "MUSIC_SET") {
      try {
        const c = normalizeBgmCfg(payload);
        bgmCfg = saveBgmCfg(c);
        syncBgmUIFromStore();
      } catch (_) {}
    }
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

  function readCamListLSAndApply() {
    const list = readCamListFromLS();
    if (list && list.length) setCamList(list, "ls");
  }

  // Polling LS (fallback cuando storage/BC no disparan)
  let _pollLastStateRaw = "";
  let _pollLastEvtRaw = "";
  let _pollLastCmdRaw = "";
  let _pollLastCamListRaw = "";

  function pollLS() {
    try {
      const sraw = lsGet(STATE_KEY) || lsGet(STATE_KEY_LEGACY) || "";
      if (sraw && sraw !== _pollLastStateRaw) { _pollLastStateRaw = sraw; readStateFromLS(); }
    } catch (_) {}
    try {
      const eraw = lsGet(EVT_KEY) || lsGet(EVT_KEY_LEGACY) || "";
      if (eraw && eraw !== _pollLastEvtRaw) { _pollLastEvtRaw = eraw; readEventFromLS(); }
    } catch (_) {}
    try {
      const craw = lsGet(CMD_KEY) || lsGet(CMD_KEY_LEGACY) || "";
      if (craw && craw !== _pollLastCmdRaw) { _pollLastCmdRaw = craw; readCmdFromLS(); }
    } catch (_) {}
    try {
      const lraw = lsGet(CAMLIST_KEY) || lsGet(CAMLIST_KEY_LEGACY) || "";
      if (lraw && lraw !== _pollLastCamListRaw) { _pollLastCamListRaw = lraw; readCamListLSAndApply(); }
    } catch (_) {}
  }

  // ───────────────────────── UI actions
  function applyBasicSettings() {
    const mins = clamp(parseInt(ctlMins?.value || "5", 10) || 5, 1, 120);
    sendCmdAliases("SET_MINS", { mins }, ["MINS", "SET_DURATION"]);

    const fit = String(ctlFit?.value || "cover").toLowerCase();
    sendCmdAliases("SET_FIT", { fit }, ["FIT"]);

    if (ctlHud) sendCmdAliases("HUD", { hidden: (ctlHud.value === "off") }, ["SET_HUD", "HUD_SET"]);
    if (ctlHudDetails) sendCmdAliases("HUD_DETAILS", { enabled: (ctlHudDetails.value !== "off") }, ["SET_HUD_DETAILS", "HUDDETAILS"]);

    if (ctlAutoskip) sendCmdAliases("SET_AUTOSKIP", { enabled: (ctlAutoskip.value !== "off") }, ["AUTOSKIP"]);
    if (ctlAdfree) sendCmdAliases("SET_MODE", { mode: (ctlAdfree.value !== "off") ? "adfree" : "" }, ["MODE"]);
    if (ctlYtCookies) sendCmdAliases("YT_COOKIES", { enabled: (ctlYtCookies.value !== "off") }, ["SET_YT_COOKIES"]);

    sendCmdAliases("SET_PARAMS", {
      mins,
      fit,
      hud: (ctlHud ? (ctlHud.value !== "off") : true),
      hudDetails: (ctlHudDetails ? (ctlHudDetails.value !== "off") : true),
      autoskip: (ctlAutoskip ? (ctlAutoskip.value !== "off") : true),
      mode: (ctlAdfree ? ((ctlAdfree.value !== "off") ? "adfree" : "") : ""),
      ytCookies: (ctlYtCookies ? (ctlYtCookies.value !== "off") : true)
    }, ["APPLY_SETTINGS"]);

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
    const chatEnabled = ctlChatOn ? (ctlChatOn.value !== "off") : true;
    const hideCommands = ctlChatHideCmd ? (ctlChatHideCmd.value !== "off") : true;
    const alertsEnabled = ctlAlertsOn ? (ctlAlertsOn.value !== "off") : true;

    sendCmdAliases("SET_CHAT", { enabled: chatEnabled, hideCommands }, ["CHAT", "CHAT_SET", "CHATCFG"]);
    sendCmdAliases("SET_ALERTS", { enabled: alertsEnabled }, ["ALERTS", "ALERTS_SET"]);

    sendCmdAliases("SET_UI", {
      chat: chatEnabled,
      chatHideCommands: hideCommands,
      alerts: alertsEnabled
    }, ["UI_SET", "SET_PARAMS"]);
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

  // Transporte con ALIASES
  function doPrev() { sendCmdAliases("PREV", {}, ["CAM_PREV", "PREV_CAM", "NAV_PREV"]); }
  function doNext() { sendCmdAliases("NEXT", {}, ["CAM_NEXT", "NEXT_CAM", "NAV_NEXT"]); }
  function doTogglePlay() { sendCmdAliases("TOGGLE_PLAY", {}, ["PLAYPAUSE", "PLAY_PAUSE", "PAUSE_TOGGLE"]); }
  function doShuffle() { sendCmdAliases("RESHUFFLE", {}, ["SHUFFLE", "SHUFFLE_CAMS", "REROLL"]); }

  function resolveCamIdFromUI() {
    if (!ctlSelect) return "";
    const v = String(ctlSelect.value || "").trim();
    if (!v) return "";

    if (allCams.some(c => String(c.id) === v)) return v;

    const n = parseInt(v, 10);
    if (Number.isFinite(n) && n >= 1 && n <= allCams.length) return String(allCams[n - 1].id);

    const vv = v.toLowerCase();
    const found = allCams.find(c => label(c).toLowerCase() === vv) ||
                  allCams.find(c => label(c).toLowerCase().includes(vv));
    return found ? String(found.id) : v;
  }

  function doGoSelected() {
    const id = resolveCamIdFromUI();
    if (!id) return;
    sendCmdAliases("GOTO", { id }, ["CAM_GOTO", "SET_CAM", "GOTO_CAM", "NAV_GOTO"]);
    syncPreviewUrl();
  }

  function doBanSelectedOrCurrent() {
    const id = resolveCamIdFromUI();
    if (id) sendCmdAliases("BAN", { id }, ["BAN_CAM", "EXCLUDE", "SKIP_ID"]);
    else sendCmdAliases("BAN_CURRENT", {}, ["BAN_CAM_CURRENT", "EXCLUDE_CURRENT", "SKIP_CURRENT"]);
  }

  function doReset() {
    sendCmdAliases("RESET", {}, ["RESET_STATE", "HARD_RESET"]);
  }

  // ───────────────────────── Catalog control (PATCH: sync)
  const CATALOG_DEFAULTS = {
    enabled: false,
    layout: "quad",
    gap: 8,
    labels: true,
    mode: "follow",
    followSlot: 0,
    clickCycle: true,
    ytCookies: true,
    wxTiles: true,
    wxRefreshSec: 30,
    muted: true
  };
  function normalizeCatalogCfg(inCfg) {
    const c = Object.assign({}, CATALOG_DEFAULTS, (inCfg || {}));
    c.enabled = (c.enabled === true);

    c.layout = String(c.layout || "quad").trim();
    if (!/^(solo|duo|quad|grid|list)$/i.test(c.layout)) c.layout = "quad";

    c.gap = clamp(parseInt(String(c.gap ?? 8), 10) || 8, 0, 24);
    c.labels = (c.labels !== false);

    c.mode = String(c.mode || "follow").trim().toLowerCase();
    if (c.mode === "fixed") c.mode = "sync";
    if (!/^(follow|sync)$/i.test(c.mode)) c.mode = "follow";

    c.followSlot = clamp(parseInt(String(c.followSlot ?? 0), 10) || 0, 0, 3);
    c.clickCycle = (c.clickCycle !== false);
    c.ytCookies = (c.ytCookies !== false);
    c.wxTiles = (c.wxTiles !== false);
    c.wxRefreshSec = clamp(parseInt(String(c.wxRefreshSec ?? 30), 10) || 30, 10, 180);
    c.muted = (c.muted !== false);
    return c;
  }
  function readCatalogUI() {
    if (!ctlCatalogOn && !ctlCatalogLayout) return normalizeCatalogCfg(CATALOG_DEFAULTS);
    const u = readCatalogUIForUrl();
    return normalizeCatalogCfg(u);
  }
  function setCatalogStatusFromCfg(cfg) {
    if (!ctlCatalogStatus) return;
    const on = !!cfg?.enabled;
    setPill(ctlCatalogStatus, on ? "Catálogo: ON" : "Catálogo: OFF", on);
  }
  function applyCatalogNow() {
    const cfg = readCatalogUI();
    setCatalogStatusFromCfg(cfg);
    sendCmdAliases("SET_CATALOG", cfg, ["CATALOG_SET", "CATALOG", "SET_CATALOG_CFG"]);
    sendCmdAliases("SET_PARAMS", { catalog: cfg }, ["APPLY_SETTINGS"]);
    syncPreviewUrl();
  }
  function resetCatalogNow() {
    try {
      if (ctlCatalogOn) ctlCatalogOn.value = CATALOG_DEFAULTS.enabled ? "on" : "off";
      if (ctlCatalogLayout) ctlCatalogLayout.value = CATALOG_DEFAULTS.layout;
      if (ctlCatalogGap) ctlCatalogGap.value = String(CATALOG_DEFAULTS.gap);
      if (ctlCatalogLabels) ctlCatalogLabels.value = CATALOG_DEFAULTS.labels ? "on" : "off";
      if (ctlCatalogMode) ctlCatalogMode.value = CATALOG_DEFAULTS.mode;
      if (ctlCatalogFollowSlot) ctlCatalogFollowSlot.value = String(CATALOG_DEFAULTS.followSlot);
      if (ctlCatalogClickCycle) ctlCatalogClickCycle.value = CATALOG_DEFAULTS.clickCycle ? "on" : "off";
      if (ctlCatalogYtCookies) ctlCatalogYtCookies.value = CATALOG_DEFAULTS.ytCookies ? "on" : "off";
      if (ctlCatalogWxTiles) ctlCatalogWxTiles.value = CATALOG_DEFAULTS.wxTiles ? "on" : "off";
      if (ctlCatalogWxRefreshSec) ctlCatalogWxRefreshSec.value = String(CATALOG_DEFAULTS.wxRefreshSec);
      if (ctlCatalogMuted) ctlCatalogMuted.value = CATALOG_DEFAULTS.muted ? "on" : "off";
    } catch (_) {}
    applyCatalogNow();
  }

  // ───────────────────────── Bot UI glue
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

  // ───────────────────────── Delegación extra (data-cmd / data-action)
  function bindDelegatedActions() {
    listen(document, "click", (e) => {
      const t = e.target;
      if (!t) return;

      const el = t.closest?.("[data-cmd],[data-action]");
      if (!el) return;

      const cmd = String(el.getAttribute("data-cmd") || el.getAttribute("data-action") || "").trim();
      if (!cmd) return;

      let payload = {};
      const raw = el.getAttribute("data-payload");
      if (raw) {
        const j = safeJson(raw, null);
        if (j && typeof j === "object") payload = j;
      }

      e.preventDefault();
      e.stopPropagation();

      if (cmd === "GOTO_SELECTED") { doGoSelected(); return; }

      sendCmdAliases(cmd, payload, []);
      setStatus(`Enviado: ${cmd}`, true);
    }, true);
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

    // catalog
    safeOn(ctlCatalogApply, "click", applyCatalogNow);
    safeOn(ctlCatalogReset, "click", resetCatalogNow);

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

    // BGM
    safeOn(ctlBgmOn, "change", applyBgmNow);
    safeOn(ctlBgmTrack, "change", applyBgmNow);
    safeOn(ctlBgmVol, "input", applyBgmNow);
    safeOn(ctlBgmPrev, "click", bgmPrev);
    safeOn(ctlBgmPlay, "click", bgmToggle);
    safeOn(ctlBgmNext, "click", bgmNext);
    safeOn(ctlBgmShuffle, "click", bgmShuffle);

    // Auto preview sync
    const autoSync = debounce(syncPreviewUrl, 160);
    [
      ctlMins, ctlFit, ctlHud, ctlHudDetails, ctlAutoskip, ctlAdfree, ctlTwitchChannel,
      ctlCatalogOn, ctlCatalogLayout, ctlCatalogGap, ctlCatalogLabels, ctlCatalogMode,
      ctlCatalogFollowSlot, ctlCatalogClickCycle, ctlCatalogYtCookies, ctlCatalogWxTiles,
      ctlCatalogWxRefreshSec, ctlCatalogMuted,
      ctlVoteOn, ctlVoteOverlay, ctlVoteWindow, ctlVoteAt, ctlVoteLead, ctlVoteCmd, ctlStayMins,
      ctlChatOn, ctlChatHideCmd, ctlAlertsOn,
      ctlAdsOn, ctlAdLead, ctlAdDur, ctlAdShowDuring, ctlAdChatText,
      ctlTickerOn, ctlTickerLang, ctlTickerSpeed, ctlTickerRefresh, ctlTickerTop, ctlTickerHideOnVote, ctlTickerSpan,
      ctlCountdownOn, ctlCountdownLabel, ctlCountdownTarget,
      ctlBgmOn, ctlBgmVol, ctlBgmTrack
    ].forEach(el => safeOn(el, "change", autoSync));

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
        if (!msg || typeof msg !== "object") return;

        if (msg?.type === "state") applyState(msg.state || msg);
        else if (msg?.type === "event") applyEvent(msg.event || msg);
        else if (String(msg?.type || "").toLowerCase() === "cmd") applyIncomingCmd(msg);
        else if (msg?.type === "CAM_LIST" || msg?.type === "CAMS_LIST") {
          const list = msg.cams || msg.camList || msg.list || null;
          if (Array.isArray(list) && list.length) setCamList(list, "bcMain");
        } else if (msg?.type === "BGM_CFG") {
          try { bgmCfg = saveBgmCfg(normalizeBgmCfg(msg.cfg || msg)); syncBgmUIFromStore(); } catch (_) {}
        } else {
          if (msg.cam || msg.currentCam || msg.mins != null) applyState(msg);
        }
      };
    } catch (_) {}

    try {
      if (bcLegacy) bcLegacy.onmessage = (ev) => {
        const msg = ev?.data;
        if (!msg || typeof msg !== "object") return;

        if (msg?.type === "state") applyState(msg.state || msg);
        else if (msg?.type === "event") applyEvent(msg.event || msg);
        else if (String(msg?.type || "").toLowerCase() === "cmd") applyIncomingCmd(msg);
        else if (msg?.type === "CAM_LIST" || msg?.type === "CAMS_LIST") {
          const list = msg.cams || msg.camList || msg.list || null;
          if (Array.isArray(list) && list.length) setCamList(list, "bcLegacy");
        } else if (msg?.type === "BGM_CFG") {
          try { bgmCfg = saveBgmCfg(normalizeBgmCfg(msg.cfg || msg)); syncBgmUIFromStore(); } catch (_) {}
        } else {
          if (msg.cam || msg.currentCam || msg.mins != null) applyState(msg);
        }
      };
    } catch (_) {}

    listen(window, "storage", (e) => {
      const k = String(e.key || "");
      if (!k) return;

      if (k === STATE_KEY || k === STATE_KEY_LEGACY) readStateFromLS();
      if (k === EVT_KEY || k === EVT_KEY_LEGACY) readEventFromLS();
      if (k === CMD_KEY || k === CMD_KEY_LEGACY) readCmdFromLS();
      if (k === CAMLIST_KEY || k === CAMLIST_KEY_LEGACY) readCamListLSAndApply();

      if (k === TICKER_CFG_KEY || k === TICKER_CFG_KEY_BASE) syncTickerUIFromStore();
      if (k === COUNTDOWN_CFG_KEY || k === COUNTDOWN_CFG_KEY_BASE) syncCountdownUIFromStore();
      if (k === HELIX_CFG_KEY || k === HELIX_CFG_KEY_BASE) syncHelixUIFromStore();
      if (k === BOT_STORE_KEY || k === BOT_STORE_KEY_BASE) { syncBotUIFromStore(); botApplyCfgAndMaybeConnect(); }
      if (k === BGM_CFG_KEY || k === BGM_CFG_KEY_BASE) syncBgmUIFromStore();
    });
  }

  // ───────────────────────── SW update awareness
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
  let lastReqStateAt = 0;
  let lastReqListAt = 0;

  function heartbeat() {
    const now = Date.now();
    const age = now - (lastSeenAt || 0);

    pollLS();

    if (!allCams.length) refreshGlobalLists(false);
    ensureBgmTrackOptions();

    if (!updateAvailable) {
      if (age > 3500) {
        const extra = KEY ? ` (key=${KEY.slice(0, 10)}…)` : " (sin key)";
        setStatus(`Sin señal… abre el player en el mismo navegador${extra}`, false);

        if ((now - lastReqStateAt) > 3500) {
          lastReqStateAt = now;
          sendCmdAliases("REQ_STATE", {}, ["STATE_REQ", "GET_STATE", "PING_STATE"]);
        }
      }
    }

    if (((now - lastReqListAt) > 6000) && (!allCams.length || (now - _lastListUpdateAt) > 45000)) {
      lastReqListAt = now;
      sendCmdAliases("REQ_CAM_LIST", {}, ["REQ_LIST", "CAM_LIST_REQ", "GET_CAM_LIST", "GET_LIST"]);
    }

    helixTick(false).catch(() => {});
  }

  // ───────────────────────── Boot / Destroy
  function boot() {
    try {
      cacheDom();
      ensureControlMode();

      if (ctlBusName) {
        try { ctlBusName.textContent = KEY ? `${BUS} (keyed)` : BUS; } catch (_) {}
      }

      try {
        if (ctlAdDur && (!ctlAdDur.value || !String(ctlAdDur.value).trim())) {
          ctlAdDur.value = String(loadAdDurStore());
        }
      } catch (_) {}

      syncBgmUIFromStore();
      ensureBgmTrackOptions();

      syncTickerUIFromStore();
      syncCountdownUIFromStore();
      syncHelixUIFromStore();
      syncBotUIFromStore();
      botApplyCfgAndMaybeConnect();

      bindDelegatedActions();
      bindUi();
      bindHotkeys();
      bindBus();

      readCamListLSAndApply();
      readStateFromLS();
      readEventFromLS();
      readCmdFromLS();
      pollLS();

      lastReqStateAt = Date.now();
      sendCmdAliases("REQ_STATE", {}, ["STATE_REQ", "GET_STATE", "PING_STATE"]);

      lastReqListAt = Date.now();
      sendCmdAliases("REQ_CAM_LIST", {}, ["REQ_LIST", "CAM_LIST_REQ", "GET_CAM_LIST", "GET_LIST"]);

      installSwUpdateWatcher();

      heartbeatId = setInterval(heartbeat, 900);
      setStatus(`Control listo · v${APP_VERSION}${KEY ? ` · key OK` : " · (sin key)"}`, true);
      log("boot OK", { KEY, BUS, CMD_KEY, STATE_KEY, EVT_KEY, CAMLIST_KEY, BGM_CFG_KEY });
    } catch (e) {
      console.error(e);
      setStatus(`ERROR init: ${String(e?.message || e)}`, false);
    }
  }

  instance.destroy = () => {
    if (instance._disposed) return;
    instance._disposed = true;

    try { if (heartbeatId) clearInterval(heartbeatId); } catch (_) {}
    heartbeatId = 0;

    try { if (bcMain) bcMain.onmessage = null; } catch (_) {}
    try { if (bcLegacy) bcLegacy.onmessage = null; } catch (_) {}
    try { bcMain && bcMain.close?.(); } catch (_) {}
    try { bcLegacy && bcLegacy.close?.(); } catch (_) {}
    bcMain = null;
    bcLegacy = null;

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
