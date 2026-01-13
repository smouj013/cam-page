/* control.js — RLC Control v2.3.9 (NEWSROOM/BROADCAST) — COMPAT “app.js v2.3.8+”
   ✅ FULL + HARDENED + NO DUPES + UPDATE-AWARE
   ✅ Objetivo: que TODOS los botones del panel de control ejecuten acciones en el PLAYER de forma robusta.
   ✅ Compat extra (clave):
      - Envía cmd por BroadcastChannel + localStorage (keyed + legacy)
      - Mensaje cmd incluye campos extra (name/data/action) para players antiguos
      - Payload normalizado (enabled/on, hidden/hide, id/camId/cameraId/value)
      - Auto-detect KEY (si falta) desde storage y la refleja en URL sin recargar
   ✅ FIXES IMPORTANTES (2026-01+):
      - FIX: sendCmdAliases() NO duplica el cmd base
      - postMessage al iframe preview SIEMPRE (además de BC + LS)
      - Polling LS (state/evt/cmd) para casos donde storage/BC no disparan (iframes/misma pestaña)
      - Delegación opcional por data-cmd/data-action para botones nuevos sin tocar IDs (solo en modo control)
   ✅ PATCH (BGM + CATALOG SYNC):
      - BGM UI completa (tracks + volumen + prev/next/play/shuffle) + store + envío al player
      - Catalog mode acepta "sync" (y "fixed" como alias legacy)
   ✅ EXTRA FIX (TU CASO REAL):
      - Soporta URL “doble ?” (ej: ?index.html?key=XXX&mins=5) -> parsea key/params y base URL bien
   ✅ PATCH 2.3.9 (TU PEDIDO):
      - Autorrellena la KEY en la sección UI si existe (ctlKey*)
      - Autorrellena canal/bot user (ctlTwitchChannel/ctlBotUser) desde state del player
      - Auto-connect bot si está ON y hay creds guardadas
      - HUD scale SOLO para el player (ctlHudScale) + cmd + URL param
   ✅ PATCH 2.3.9 (NUEVO — TU PEDIDO):
      - Helix: rotación de Categoría (Just Chatting / IRL / Always On) cada 1h
      - Auto-resuelve IDs via helix/search/categories y cachea en localStorage (keyed)
   ✅ CAM LIST REMOVED (TU PEDIDO):
      - Se elimina COMPLETAMENTE la lista/búsqueda/selector de cams del control.js
      - El control de lista/selección se gestiona en obs-cam-panel.html (sin interferencias)

   🔧 HOTFIX (sin subir versión):
      - Anti-dup “upgrade-safe” ahora permite reemplazar instancia aunque la versión sea 2.3.9 (usa BUILD_ID interno)
      - Toggles robustos: soporta <select on/off> y <input type="checkbox">
      - sendCmd() blindado si JSON.stringify falla
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  // ⚠️ NO subir versión: se mantiene 2.3.9
  const APP_VERSION = String((typeof window !== "undefined" && window.APP_VERSION) || "2.3.9");

  // BUILD interno para permitir hot-replace aunque APP_VERSION no cambie
  const BUILD_ID = String((typeof window !== "undefined" && window.RLC_CONTROL_BUILD) || "2026-01-13a");

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

  // ───────────────────────── Singleton anti-dup (upgrade-safe) — BLINDADO (soporta mismo APP_VERSION con BUILD_ID)
  const SINGLETON_KEY = "__RLC_CONTROL_JS_SINGLETON__";
  const SINGLETON_KIND = "RLC_CONTROL_JS";

  try {
    const existing = g[SINGLETON_KEY];
    if (existing && typeof existing === "object" && existing.kind === SINGLETON_KIND) {
      const prevVer = String(existing.version || "0.0.0");
      const prevBuild = String(existing.build || "");
      const cv = compareVer(prevVer, APP_VERSION);

      // si el anterior es más nuevo, no hacemos nada
      if (cv > 0) return;

      // si misma versión pero build distinto, reemplaza (hotfix sin subir versión)
      if (cv === 0 && prevBuild && prevBuild === BUILD_ID) return;

      try { existing.destroy?.(); } catch (_) {}
    }
  } catch (_) {}

  const instance = {
    kind: SINGLETON_KIND,
    version: APP_VERSION,
    build: BUILD_ID,
    _disposed: false,
    destroy: null
  };
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
  function safeSetText(el, t) {
    if (!el) return;
    try { el.textContent = String(t ?? ""); } catch (_) {}
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
  function lsDel(k) { try { localStorage.removeItem(k); } catch (_) {} }

  // ───────────────────────── Toggle helpers (select on/off + checkbox)
  function _elIsCheckbox(el) {
    try { return String(el?.type || "").toLowerCase() === "checkbox"; } catch (_) { return false; }
  }
  function uiIsOn(el, defaultOn = true) {
    if (!el) return defaultOn;
    if (_elIsCheckbox(el)) return !!el.checked;
    const v = String(el.value ?? "").trim().toLowerCase();
    if (v === "off" || v === "0" || v === "false" || v === "no") return false;
    if (v === "on" || v === "1" || v === "true" || v === "yes") return true;
    if (v === "") return defaultOn;
    return defaultOn;
  }
  function _hasOptionValue(sel, value) {
    try {
      const vv = String(value);
      const opts = sel?.options ? Array.from(sel.options) : [];
      return opts.some(o => String(o?.value ?? "") === vv);
    } catch (_) { return false; }
  }
  function uiSetOn(el, on) {
    if (!el) return;
    if (isEditing(el)) return;

    if (_elIsCheckbox(el)) {
      try { el.checked = !!on; } catch (_) {}
      return;
    }

    try {
      const valOn = _hasOptionValue(el, "on") ? "on" : (_hasOptionValue(el, "1") ? "1" : "on");
      const valOff = _hasOptionValue(el, "off") ? "off" : (_hasOptionValue(el, "0") ? "0" : "off");
      el.value = on ? valOn : valOff;
    } catch (_) {}
  }

  // ───────────────────────── Force CONTROL mode (y evitar interferir fuera)
  let IS_CONTROL_MODE = false;
  function ensureControlMode() {
    try {
      const p = String(location.pathname || "").toLowerCase();
      const looksControl =
        p.endsWith("/control.html") || p.endsWith("control.html") ||
        p.endsWith("/control") || p.endsWith("control");

      if (looksControl) document.body?.classList?.add("mode-control");
      IS_CONTROL_MODE = !!document.body?.classList?.contains("mode-control");

      if (IS_CONTROL_MODE) {
        try { document.body.style.overflow = "auto"; } catch (_) {}
      }
    } catch (_) {
      IS_CONTROL_MODE = false;
    }
  }

  // Evita submits invisibles SOLO en modo control (para no fastidiar otras páginas)
  function installSubmitGuard() {
    if (!IS_CONTROL_MODE) return;
    listen(document, "submit", (e) => {
      try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
    }, true);
  }

  // ───────────────────────── KEY auto-detect + URL “doble ?” support
  const BUS_BASE = "rlc_bus_v1";
  const CMD_KEY_BASE = "rlc_cmd_v1";
  const STATE_KEY_BASE = "rlc_state_v1";
  const EVT_KEY_BASE = "rlc_evt_v1";

  const BOT_STORE_KEY_BASE = "rlc_bot_cfg_v1";
  const TICKER_CFG_KEY_BASE = "rlc_ticker_cfg_v1";
  const HELIX_CFG_KEY_BASE  = "rlc_helix_cfg_v1";
  const COUNTDOWN_CFG_KEY_BASE = "rlc_countdown_cfg_v1";
  const BGM_CFG_KEY_BASE = "rlc_bgm_cfg_v1";
  const HUD_CFG_KEY_BASE = "rlc_hud_cfg_v1"; // HUD scale solo player

  function _extractParamsFromWeirdSearch() {
    // Soporta: ?index.html?key=XXX&mins=5  (doble ?)
    try {
      const s = String(location.search || "");
      if (!s.startsWith("?")) return new URLSearchParams("");
      const parts = s.slice(1).split("?");
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

  // Legacy keys (sin key)
  const BUS_LEGACY = BUS_BASE;
  const CMD_KEY_LEGACY = CMD_KEY_BASE;
  const STATE_KEY_LEGACY = STATE_KEY_BASE;
  const EVT_KEY_LEGACY = EVT_KEY_BASE;

  const BOT_STORE_KEY = KEY ? `${BOT_STORE_KEY_BASE}:${KEY}` : BOT_STORE_KEY_BASE;
  const TICKER_CFG_KEY = KEY ? `${TICKER_CFG_KEY_BASE}:${KEY}` : TICKER_CFG_KEY_BASE;
  const HELIX_CFG_KEY  = KEY ? `${HELIX_CFG_KEY_BASE}:${KEY}` : HELIX_CFG_KEY_BASE;
  const COUNTDOWN_CFG_KEY = KEY ? `${COUNTDOWN_CFG_KEY_BASE}:${KEY}` : COUNTDOWN_CFG_KEY_BASE;
  const BGM_CFG_KEY = KEY ? `${BGM_CFG_KEY_BASE}:${KEY}` : BGM_CFG_KEY_BASE;
  const HUD_CFG_KEY = KEY ? `${HUD_CFG_KEY_BASE}:${KEY}` : HUD_CFG_KEY_BASE;

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

      // preferimos origen actual si es same-origin; si falla, "*" fallback
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

    if (payload.on == null && payload.enabled != null) {
      const b = _asBool(payload.enabled);
      if (b != null) payload.on = b;
    }
    if (payload.enabled == null && payload.on != null) {
      const b = _asBool(payload.on);
      if (b != null) payload.enabled = b;
    }

    if (payload.hide == null && payload.hidden != null) {
      const b = _asBool(payload.hidden);
      if (b != null) payload.hide = b;
    }
    if (payload.hidden == null && payload.hide != null) {
      const b = _asBool(payload.hide);
      if (b != null) payload.hidden = b;
    }

    const id = payload.id ?? payload.camId ?? payload.cameraId ?? payload.value ?? null;
    if (id != null) {
      if (payload.id == null) payload.id = id;
      if (payload.camId == null) payload.camId = id;
      if (payload.cameraId == null) payload.cameraId = id;
      if (payload.value == null) payload.value = id;
    }
    return payload;
  }

  function _safeStringify(obj) {
    try { return JSON.stringify(obj); } catch (_) {
      // último recurso: mensaje minimal para no romper cmd
      try {
        const minimal = { type: obj?.type || "cmd", ts: obj?.ts || Date.now(), cmd: obj?.cmd || obj?.name || "CMD", payload: null };
        return JSON.stringify(minimal);
      } catch (_) {
        return "";
      }
    }
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

      // compat campos extra
      name: c,
      action: c,
      data: pl,

      from: "control",
      ver: APP_VERSION,
      build: BUILD_ID
    };
    if (KEY) msg.key = KEY;

    const raw = _safeStringify(msg);
    if (!raw) return;

    // localStorage (keyed + legacy)
    lsSet(CMD_KEY, raw);
    lsSet(CMD_KEY_LEGACY, raw);

    // BroadcastChannel (keyed + legacy)
    busPost(msg);

    // postMessage al preview (SIEMPRE)
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
    // ✅ KEY UI (opcionales)
    ctlKey, ctlKeyApply,

    ctlStatus, ctlNowTitle, ctlNowPlace, ctlNowTimer, ctlOrigin,
    ctlPrev, ctlPlay, ctlNext, ctlShuffle,
    ctlMins, ctlApplyMins, ctlApplySettings, ctlFit, ctlHud, ctlHudDetails, ctlAutoskip, ctlAdfree, ctlReset,

    // ✅ HUD scale (solo player, opcional)
    ctlHudScale, ctlHudScaleApply,

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
    // ✅ KEY UI
    ctlKey = qs("#ctlKey") || qs("#ctlKeyInput") || qs("#ctlKeyField");
    ctlKeyApply = qs("#ctlKeyApply") || qs("#ctlApplyKey") || qs("#ctlKeyBtn");

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

    // ✅ HUD scale
    ctlHudScale = qs("#ctlHudScale") || qs("#ctlHudScaleRange") || qs("#ctlHudScaleInput");
    ctlHudScaleApply = qs("#ctlHudScaleApply") || qs("#ctlApplyHudScale");

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
    safeSetText(el, text);
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

  // ✅ KEY UI sync
  function syncKeyUI() {
    if (!ctlKey) return;
    if (KEY && !isEditing(ctlKey)) {
      safeSetValue(ctlKey, KEY);
    }
  }
  function applyKeyFromUI() {
    if (!ctlKey) return;
    const nk = String(ctlKey.value || "").trim();
    if (!nk || nk === KEY) return;
    try { lsSet("rlc_last_key_v1", nk); } catch (_) {}
    try {
      const u = new URL(location.href);
      u.searchParams.set("key", nk);
      location.href = u.toString();
    } catch (_) {
      try { location.search = `?key=${encodeURIComponent(nk)}`; } catch (_) {}
    }
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

  // ───────────────────────── HUD CFG (solo player)
  const HUD_DEFAULTS = { scale: 1 };
  function normalizeHudCfg(inCfg) {
    const c = Object.assign({}, HUD_DEFAULTS, (inCfg || {}));
    c.scale = clamp(num(c.scale, 1), 0.5, 2.5);
    return c;
  }
  function loadHudCfg() {
    try { const raw = lsGet(HUD_CFG_KEY); if (raw) return normalizeHudCfg(JSON.parse(raw)); } catch (_) {}
    try { const raw = lsGet(HUD_CFG_KEY_BASE); if (raw) return normalizeHudCfg(JSON.parse(raw)); } catch (_) {}
    return normalizeHudCfg(HUD_DEFAULTS);
  }
  function saveHudCfg(cfg) {
    const c = normalizeHudCfg(cfg);
    const raw = JSON.stringify(c);
    lsSet(HUD_CFG_KEY, raw);
    lsSet(HUD_CFG_KEY_BASE, raw);
    return c;
  }
  let hudCfg = loadHudCfg();

  function syncHudUIFromStore() {
    hudCfg = loadHudCfg();
    if (ctlHudScale && !isEditing(ctlHudScale)) safeSetValue(ctlHudScale, String(hudCfg.scale ?? 1));
  }
  function readHudUI() {
    const base = hudCfg || loadHudCfg();
    const scale = ctlHudScale ? clamp(num(ctlHudScale.value, base.scale ?? 1), 0.5, 2.5) : (base.scale ?? 1);
    return normalizeHudCfg({ scale });
  }
  function sendHudCfg(cfg, persist = true) {
    const c = persist ? saveHudCfg(cfg) : normalizeHudCfg(cfg);
    sendCmdAliases("HUD_SCALE", { scale: c.scale }, ["SET_HUD_SCALE", "HUDSCALE", "HUD_UI_SCALE", "SET_OVERLAY_SCALE", "OVERLAY_SCALE"]);
    sendCmdAliases("SET_PARAMS", { hudScale: c.scale }, ["APPLY_SETTINGS", "UI_SET"]);
    return c;
  }
  const applyHudNow = debounce(() => {
    hudCfg = sendHudCfg(readHudUI(), true);
  }, 80);

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
    c.speedPxPerSec = clamp(num(c.speedPxPerSec, TICKER_DEFAULTS.speedPxPerSec), 5, 140);
    c.refreshMins = clamp(num(c.refreshMins, TICKER_DEFAULTS.refreshMins), 3, 60);
    c.topPx = clamp(num(c.topPx, TICKER_DEFAULTS.topPx), 0, 120);
    c.hideOnVote = (c.hideOnVote !== false);

    c.timespan = String(c.timespan || TICKER_DEFAULTS.timespan).trim().toLowerCase();
    if (!/^\d+(min|h|d|w|m)$/.test(c.timespan)) c.timespan = TICKER_DEFAULTS.timespan;

    return c;
  }

  function loadTickerCfg() {
    try { const rawKeyed = lsGet(TICKER_CFG_KEY); if (rawKeyed) return normalizeTickerCfg(JSON.parse(rawKeyed)); } catch (_) {}
    try { const rawBase = lsGet(TICKER_CFG_KEY_BASE); if (rawBase) return normalizeTickerCfg(JSON.parse(rawBase)); } catch (_) {}
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
    uiSetOn(ctlTickerOn, !!tickerCfg.enabled);
    if (ctlTickerLang && !isEditing(ctlTickerLang)) safeSetValue(ctlTickerLang, tickerCfg.lang || "auto");
    if (ctlTickerSpeed && !isEditing(ctlTickerSpeed)) safeSetValue(ctlTickerSpeed, String(tickerCfg.speedPxPerSec ?? 55));
    if (ctlTickerRefresh && !isEditing(ctlTickerRefresh)) safeSetValue(ctlTickerRefresh, String(tickerCfg.refreshMins ?? 12));
    if (ctlTickerTop && !isEditing(ctlTickerTop)) safeSetValue(ctlTickerTop, String(tickerCfg.topPx ?? 10));
    uiSetOn(ctlTickerHideOnVote, !!tickerCfg.hideOnVote);
    if (ctlTickerSpan && !isEditing(ctlTickerSpan)) safeSetValue(ctlTickerSpan, String(tickerCfg.timespan || "1d"));
    setTickerStatusFromCfg(tickerCfg);
  }

  function readTickerUI() {
    const base = tickerCfg || loadTickerCfg();
    const enabled = (ctlTickerOn ? uiIsOn(ctlTickerOn, base.enabled) : base.enabled);
    const lang = ctlTickerLang ? (ctlTickerLang.value || base.lang || "auto") : (base.lang || "auto");
    const speedPxPerSec = ctlTickerSpeed ? clamp(num(ctlTickerSpeed.value, base.speedPxPerSec || 55), 5, 140) : (base.speedPxPerSec || 55);
    const refreshMins = ctlTickerRefresh ? clamp(num(ctlTickerRefresh.value, base.refreshMins || 12), 3, 60) : (base.refreshMins || 12);
    const topPx = ctlTickerTop ? clamp(num(ctlTickerTop.value, base.topPx || 10), 0, 120) : (base.topPx || 10);
    const hideOnVote = ctlTickerHideOnVote ? uiIsOn(ctlTickerHideOnVote, base.hideOnVote) : base.hideOnVote;
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
    try { const rawKeyed = lsGet(COUNTDOWN_CFG_KEY); if (rawKeyed) return normalizeCountdownCfg(JSON.parse(rawKeyed)); } catch (_) {}
    try { const rawBase = lsGet(COUNTDOWN_CFG_KEY_BASE); if (rawBase) return normalizeCountdownCfg(JSON.parse(rawBase)); } catch (_) {}
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
    uiSetOn(ctlCountdownOn, !!countdownCfg.enabled);
    if (ctlCountdownLabel && !isEditing(ctlCountdownLabel)) safeSetValue(ctlCountdownLabel, String(countdownCfg.label || "Fin de año"));
    if (ctlCountdownTarget) {
      const ms = countdownCfg.targetMs || nextNewYearTargetMs();
      const d = new Date(ms);
      const pad = (n) => String(n).padStart(2, "0");
      const v = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      if (!ctlCountdownTarget.value || !isEditing(ctlCountdownTarget)) safeSetValue(ctlCountdownTarget, v);
    }
    setCountdownStatusFromCfg(countdownCfg);
  }
  function readCountdownUI() {
    const base = countdownCfg || loadCountdownCfg();
    const enabled = ctlCountdownOn ? uiIsOn(ctlCountdownOn, base.enabled) : base.enabled;
    const label = ctlCountdownLabel ? String(ctlCountdownLabel.value || base.label || "Fin de año").trim() : (base.label || "Fin de año");
    let targetMs = base.targetMs || nextNewYearTargetMs();
    if (ctlCountdownTarget && ctlCountdownTarget.value) {
      const d = new Date(ctlCountdownTarget.value);
      const ms = d.getTime();
      if (Number.isFinite(ms) && ms > 0) targetMs = ms;
    }
    return normalizeCountdownCfg({ enabled, label, targetMs });
  }

  // ───────────────────────── BGM
  const BGM_DEFAULTS = { enabled: false, vol: 0.25, trackId: "" };

  function normalizeBgmCfg(inCfg) {
    const c = Object.assign({}, BGM_DEFAULTS, (inCfg || {}));
    c.enabled = (c.enabled === true) || (c.enabled === 1) || (c.enabled === "on");
    c.vol = clamp(num(c.vol, BGM_DEFAULTS.vol), 0, 1);
    c.trackId = String(c.trackId || c.track || c.id || "").trim();
    return c;
  }

  function loadBgmCfg() {
    try { const rawKeyed = lsGet(BGM_CFG_KEY); if (rawKeyed) return normalizeBgmCfg(JSON.parse(rawKeyed)); } catch (_) {}
    try { const rawBase = lsGet(BGM_CFG_KEY_BASE); if (rawBase) return normalizeBgmCfg(JSON.parse(rawBase)); } catch (_) {}
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
    safeSetText(ctlBgmNow, text);
  }

  function readBgmUI() {
    const base = bgmCfg || loadBgmCfg();
    const enabled = ctlBgmOn ? uiIsOn(ctlBgmOn, base.enabled) : base.enabled;
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

    uiSetOn(ctlBgmOn, !!bgmCfg.enabled);
    if (ctlBgmVol && !isEditing(ctlBgmVol)) safeSetValue(ctlBgmVol, String(bgmCfg.vol ?? 0.25));
    if (ctlBgmTrack && !isEditing(ctlBgmTrack)) safeSetValue(ctlBgmTrack, String(bgmCfg.trackId || ""));

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
    template: "📍: {title}{placeSep}{place} | {channel} | GlobalEye TV",
    cooldownSec: 20,

    // Rotación de categoría
    categoryRotate: true,
    categoryEveryMins: 60,
    categories: ["Just Chatting", "IRL", "Always On"]
  };

  function _normalizeHelixCategoryName(n) {
    const s = String(n || "").trim();
    if (!s) return "";
    if (s.toLowerCase() === "alwayson") return "Always On";
    return s;
  }

  function normalizeHelixCfg(inCfg) {
    const c = Object.assign({}, HELIX_DEFAULTS, (inCfg || {}));
    c.enabled = (c.enabled === true);
    c.clientId = String(c.clientId || "").trim();
    c.token = String(c.token || "").trim();
    c.broadcasterId = String(c.broadcasterId || "").trim();
    c.template = String(c.template || HELIX_DEFAULTS.template).trim().slice(0, 220) || HELIX_DEFAULTS.template;
    c.cooldownSec = clamp(parseInt(String(c.cooldownSec || HELIX_DEFAULTS.cooldownSec), 10) || HELIX_DEFAULTS.cooldownSec, 10, 180);

    const cr = (inCfg && (inCfg.categoryRotate === false || inCfg.categoryRotate === 0 || inCfg.categoryRotate === "off"))
      ? false : true;
    c.categoryRotate = cr;

    c.categoryEveryMins = clamp(parseInt(String(c.categoryEveryMins || HELIX_DEFAULTS.categoryEveryMins), 10) || HELIX_DEFAULTS.categoryEveryMins, 10, 360);

    let cats = Array.isArray(c.categories) ? c.categories : HELIX_DEFAULTS.categories;
    cats = cats.map(_normalizeHelixCategoryName).map(x => String(x || "").trim()).filter(Boolean).slice(0, 12);
    if (!cats.length) cats = HELIX_DEFAULTS.categories.slice();
    c.categories = cats;

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

  // Categorías (keyed)
  const HELIX_CAT_STATE_KEY_BASE = "rlc_helix_cat_state_v1";
  const HELIX_CAT_CACHE_KEY_BASE = "rlc_helix_cat_cache_v1";
  const HELIX_CAT_STATE_KEY = KEY ? `${HELIX_CAT_STATE_KEY_BASE}:${KEY}` : HELIX_CAT_STATE_KEY_BASE;
  const HELIX_CAT_CACHE_KEY = KEY ? `${HELIX_CAT_CACHE_KEY_BASE}:${KEY}` : HELIX_CAT_CACHE_KEY_BASE;

  function _loadHelixCatState() {
    const raw = lsGet(HELIX_CAT_STATE_KEY) || lsGet(HELIX_CAT_STATE_KEY_BASE) || "";
    const j = safeJson(raw, null);
    const st = (j && typeof j === "object") ? j : {};
    return {
      index: Number.isFinite(st.index) ? (st.index | 0) : -1,
      lastChangeAt: Number(st.lastChangeAt || 0) || 0,
      lastCategoryName: String(st.lastCategoryName || "").trim(),
      lastCategoryId: String(st.lastCategoryId || "").trim()
    };
  }
  function _saveHelixCatState(st) {
    const o = Object.assign({ index: -1, lastChangeAt: 0, lastCategoryName: "", lastCategoryId: "" }, (st || {}));
    const raw = JSON.stringify(o);
    lsSet(HELIX_CAT_STATE_KEY, raw);
    lsSet(HELIX_CAT_STATE_KEY_BASE, raw);
    return o;
  }

  function _loadHelixCatCache() {
    const raw = lsGet(HELIX_CAT_CACHE_KEY) || lsGet(HELIX_CAT_CACHE_KEY_BASE) || "";
    const j = safeJson(raw, null);
    return (j && typeof j === "object") ? j : {};
  }
  function _saveHelixCatCache(cache) {
    const raw = JSON.stringify(cache || {});
    lsSet(HELIX_CAT_CACHE_KEY, raw);
    lsSet(HELIX_CAT_CACHE_KEY_BASE, raw);
  }

  let helixCatLastUpdateAt = 0;
  let helixCatLastSig = "";
  let helixCatLastAttemptAt = 0;
  let helixCatLastAttemptSig = "";

  function syncHelixUIFromStore() {
    helixCfg = loadHelixCfg();
    uiSetOn(ctlTitleOn, !!helixCfg.enabled);
    if (ctlTitleClientId && !isEditing(ctlTitleClientId)) safeSetValue(ctlTitleClientId, helixCfg.clientId || "");
    if (ctlTitleToken && !isEditing(ctlTitleToken)) safeSetValue(ctlTitleToken, helixCfg.token || "");
    if (ctlTitleTemplate && !isEditing(ctlTitleTemplate)) safeSetValue(ctlTitleTemplate, helixCfg.template || HELIX_DEFAULTS.template);
    if (ctlTitleCooldown && !isEditing(ctlTitleCooldown)) safeSetValue(ctlTitleCooldown, String(helixCfg.cooldownSec || 20));
    if (ctlTitleBroadcasterId && !isEditing(ctlTitleBroadcasterId)) safeSetValue(ctlTitleBroadcasterId, helixCfg.broadcasterId || "");
    setTitleStatus(helixCfg.enabled ? "Auto título: ON" : "Auto título: OFF", !!helixCfg.enabled);
  }
  function readHelixUI() {
    const base = helixCfg || loadHelixCfg();
    const enabled = ctlTitleOn ? uiIsOn(ctlTitleOn, base.enabled) : base.enabled;
    const clientId = ctlTitleClientId ? String(ctlTitleClientId.value || base.clientId || "").trim() : String(base.clientId || "").trim();
    const token = ctlTitleToken ? String(ctlTitleToken.value || base.token || "").trim() : String(base.token || "").trim();
    const template = ctlTitleTemplate ? String(ctlTitleTemplate.value || base.template || HELIX_DEFAULTS.template).trim() : String(base.template || HELIX_DEFAULTS.template).trim();
    const broadcasterId = ctlTitleBroadcasterId
      ? String(ctlTitleBroadcasterId.value || base.broadcasterId || "").trim()
      : String(base.broadcasterId || "").trim();
    const cooldownSec = ctlTitleCooldown
      ? clamp(parseInt(String(ctlTitleCooldown.value || base.cooldownSec || 20), 10) || 20, 10, 180)
      : (base.cooldownSec || 20);

    return normalizeHelixCfg({
      enabled, clientId, token, broadcasterId, template, cooldownSec,
      categoryRotate: base.categoryRotate,
      categoryEveryMins: base.categoryEveryMins,
      categories: base.categories
    });
  }

  function buildTitleFromState(st, template) {
    const cam = st?.cam || st?.currentCam || {};
    const t = String(cam?.title || "Live Cam").trim();
    const p = String(cam?.place || "").trim();
    const s = String(cam?.source || "").trim();
    const ch = String(ctlTwitchChannel?.value || st?.vote?.channel || st?.twitch || "").trim().replace(/^@/, "");
    const botUser = String((loadBotCfg()?.user) || "").trim();
    const placeSep = p ? " — " : "";
    const repl = (k) => {
      const kk = String(k || "").toLowerCase();
      if (kk === "title") return t;
      if (kk === "place") return p;
      if (kk === "source") return s;
      if (kk === "label") return p ? `${t} — ${p}` : t;
      if (kk === "placesep") return placeSep;
      if (kk === "channel") return ch;
      if (kk === "bot") return botUser;
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

  async function helixSetCategory(broadcasterId, categoryId, clientId, token) {
    const bid = String(broadcasterId || "").trim();
    const cid = String(categoryId || "").trim();
    if (!bid || !cid) return { ok: false, error: "missing_bid_or_category" };
    await helixFetch(`channels?broadcaster_id=${encodeURIComponent(bid)}`, {
      method: "PATCH",
      clientId,
      token,
      body: { game_id: cid },
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
    const login = String(ctlTwitchChannel?.value || lastState?.vote?.channel || lastState?.twitch || "").trim();
    return !!login;
  }

  async function helixResolveCategoryIdByName(categoryName, cfg) {
    const c = cfg || helixCfg || loadHelixCfg();
    const name = _normalizeHelixCategoryName(categoryName);
    const key = String(name || "").trim().toLowerCase();
    if (!key) return "";

    const now = Date.now();
    const cache = _loadHelixCatCache();
    const hit = cache[key];
    const ttlMs = 45 * 24 * 60 * 60 * 1000;
    if (hit && hit.id && (now - (Number(hit.ts || 0) || 0)) < ttlMs) {
      return String(hit.id || "").trim();
    }

    const res = await helixFetch(`search/categories?query=${encodeURIComponent(name)}`, {
      method: "GET",
      clientId: c.clientId,
      token: c.token,
      timeoutMs: 20000
    });

    const arr = Array.isArray(res?.data?.data) ? res.data.data : [];
    if (!arr.length) return "";

    const best =
      arr.find(x => String(x?.name || "").trim().toLowerCase() === key) ||
      arr[0];

    const id = String(best?.id || "").trim();
    const realName = String(best?.name || name).trim();

    if (id) {
      cache[key] = { id, name: realName, ts: now };
      _saveHelixCatCache(cache);
      return id;
    }
    return "";
  }

  async function helixCategoryTick(force = false) {
    const cfg = helixCfg || loadHelixCfg();
    if (!helixCanRun(cfg)) return;
    if (!cfg.categoryRotate) return;

    const now = Date.now();
    if (!force && now < helixRetryAfterAt) return;

    const intervalMs = clamp((cfg.categoryEveryMins || 60) * 60 * 1000, 10 * 60 * 1000, 24 * 60 * 60 * 1000);
    const st0 = _loadHelixCatState();

    if (!force && st0.lastChangeAt && (now - st0.lastChangeAt) < intervalMs) return;

    if (!lastState && !ctlTwitchChannel?.value) return;

    const login = String(ctlTwitchChannel?.value || lastState?.vote?.channel || lastState?.twitch || "").trim().replace(/^@/, "");
    if (!login) return;

    const catsRaw = Array.isArray(cfg.categories) ? cfg.categories : HELIX_DEFAULTS.categories;
    const cats = catsRaw.map(_normalizeHelixCategoryName).map(s => String(s || "").trim()).filter(Boolean);
    if (!cats.length) return;

    const lastName = String(st0.lastCategoryName || "").trim();
    let idx = -1;
    if (lastName) idx = cats.findIndex(x => x.toLowerCase() === lastName.toLowerCase());
    if (idx < 0) idx = Number.isFinite(st0.index) ? (st0.index | 0) : -1;

    const nextIdx = (idx + 1 + cats.length) % cats.length;
    const nextName = cats[nextIdx];

    const sig = sigOf(`${login}|CAT|${nextName}`);
    if (!force) {
      if (sig === helixCatLastSig && (now - helixCatLastUpdateAt) < intervalMs) return;
      if (sig === helixCatLastAttemptSig && (now - helixCatLastAttemptAt) < 6000) return;
    }
    helixCatLastAttemptAt = now;
    helixCatLastAttemptSig = sig;

    try {
      const bid = cfg.broadcasterId || await helixEnsureBroadcasterId(login, cfg);
      if (!bid) { setTitleStatus("Helix: falta broadcaster_id", false); return; }

      const catId = await helixResolveCategoryIdByName(nextName, cfg);
      if (!catId) { setTitleStatus(`Helix: no encuentra categoría "${nextName}"`, false); return; }

      await helixSetCategory(bid, catId, cfg.clientId, cfg.token);

      helixCatLastUpdateAt = Date.now();
      helixCatLastSig = sig;

      _saveHelixCatState({
        index: nextIdx,
        lastChangeAt: Date.now(),
        lastCategoryName: nextName,
        lastCategoryId: catId
      });

      setTitleStatus(`Auto título: OK · Categoría → ${nextName}`, true);
    } catch (e) {
      setHelixBackoff(e);
    }
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

    const login = String(ctlTwitchChannel?.value || lastState?.vote?.channel || lastState?.twitch || "").trim().replace(/^@/, "");
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
    helixCategoryTick(false).catch(() => {});
  }
  function helixResetUI() {
    helixCfg = saveHelixCfg(HELIX_DEFAULTS);
    helixResolvedBroadcasterId = "";
    helixResolvedForLogin = "";
    helixRetryAfterAt = 0;

    lsDel(HELIX_CAT_STATE_KEY);
    lsDel(HELIX_CAT_STATE_KEY_BASE);

    syncHelixUIFromStore();
  }
  function helixTestOnce() {
    helixCfg = saveHelixCfg(readHelixUI());
    syncHelixUIFromStore();
    helixTick(true).catch(() => {});
    helixCategoryTick(true).catch(() => {});
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

  // Auto-fill canal/bot user desde state/player
  function extractTwitchChannelFromState(st) {
    try {
      const ch =
        st?.twitch ||
        st?.vote?.channel ||
        st?.chat?.twitch ||
        st?.cfg?.twitch ||
        st?.settings?.twitch ||
        "";
      return String(ch || "").trim().replace(/^@/, "");
    } catch (_) { return ""; }
  }

  function maybeAutoFillChannelEverywhere(channel) {
    const ch = String(channel || "").trim().replace(/^@/, "");
    if (!ch) return;

    if (ctlTwitchChannel && !isEditing(ctlTwitchChannel) && !String(ctlTwitchChannel.value || "").trim()) {
      safeSetValue(ctlTwitchChannel, ch);
    }

    if (ctlBotUser && !isEditing(ctlBotUser) && !String(ctlBotUser.value || "").trim()) {
      safeSetValue(ctlBotUser, ch);
    }

    try {
      const cur = loadBotCfg();
      let changed = false;
      if (!cur.user) { cur.user = ch; changed = true; }
      if (!cur.channel) { cur.channel = ch; changed = true; }
      if (changed) {
        saveBotCfg(cur);
        syncBotUIFromStore();
        botApplyCfgAndMaybeConnect();
      }
    } catch (_) {}
  }

  // ───────────────────────── URL builder (player)
  function boolParam(v) { return v ? "1" : "0"; }

  function _detectVirtualPage() {
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
    const vp = _detectVirtualPage();

    if (vp && !/\/[^/]+\.(html)$/i.test(p)) {
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
    const enabled = ctlCatalogOn ? uiIsOn(ctlCatalogOn, false) : false;
    const layout = ctlCatalogLayout ? String(ctlCatalogLayout.value || "quad") : "quad";
    const gap = ctlCatalogGap ? clamp(parseInt(ctlCatalogGap.value || "8", 10) || 8, 0, 24) : 8;
    const labels = ctlCatalogLabels ? uiIsOn(ctlCatalogLabels, true) : true;

    const mode = ctlCatalogMode ? String(ctlCatalogMode.value || "follow") : "follow";
    const followSlot = ctlCatalogFollowSlot ? clamp(parseInt(ctlCatalogFollowSlot.value || "0", 10) || 0, 0, 3) : 0;

    const clickCycle = ctlCatalogClickCycle ? uiIsOn(ctlCatalogClickCycle, true) : true;
    const ytCookies = ctlCatalogYtCookies ? uiIsOn(ctlCatalogYtCookies, true) : true;

    const wxTiles = ctlCatalogWxTiles ? uiIsOn(ctlCatalogWxTiles, true) : true;
    const wxRefreshSec = ctlCatalogWxRefreshSec ? clamp(parseInt(ctlCatalogWxRefreshSec.value || "30", 10) || 30, 10, 180) : 30;

    const muted = ctlCatalogMuted ? uiIsOn(ctlCatalogMuted, true) : true;

    return { enabled, layout, gap, labels, mode, followSlot, clickCycle, ytCookies, wxTiles, wxRefreshSec, muted };
  }

  function readBgmUIForUrl() {
    const base = bgmCfg || loadBgmCfg();
    const enabled = ctlBgmOn ? uiIsOn(ctlBgmOn, base.enabled) : base.enabled;
    const vol = ctlBgmVol ? clamp(num(ctlBgmVol.value, base.vol ?? 0.25), 0, 1) : (base.vol ?? 0.25);
    const trackId = ctlBgmTrack ? String(ctlBgmTrack.value || base.trackId || "").trim() : String(base.trackId || "").trim();
    return normalizeBgmCfg({ enabled, vol, trackId });
  }

  function buildStreamUrlFromUI() {
    const u = getBasePlayerUrl();

    const mins = clamp(parseInt(ctlMins?.value || "5", 10) || 5, 1, 120);
    const fit = String(ctlFit?.value || "cover").toLowerCase() === "contain" ? "contain" : "cover";
    const hud = (ctlHud ? uiIsOn(ctlHud, true) : true);
    const hudDetails = (ctlHudDetails ? uiIsOn(ctlHudDetails, true) : true);
    const autoskip = (ctlAutoskip ? uiIsOn(ctlAutoskip, true) : true);
    const adfree = (ctlAdfree ? uiIsOn(ctlAdfree, false) : false);

    const twitch = String(ctlTwitchChannel?.value || "").trim().replace(/^@/, "");
    const voteOn = (ctlVoteOn ? uiIsOn(ctlVoteOn, false) : false);
    const voteOverlay = (ctlVoteOverlay ? uiIsOn(ctlVoteOverlay, true) : true);
    const voteWindow = clamp(parseInt(ctlVoteWindow?.value || "60", 10) || 60, 5, 180);
    const voteAt = clamp(parseInt(ctlVoteAt?.value || "60", 10) || 60, 5, 600);
    const voteLead = clamp(parseInt(ctlVoteLead?.value || "0", 10) || 0, 0, 30);
    const voteCmd = String(ctlVoteCmd?.value || "!next,!cam|!stay,!keep").trim();

    const stayMins = clamp(parseInt(ctlStayMins?.value || "5", 10) || 5, 1, 120);
    const ytCookies = (ctlYtCookies ? uiIsOn(ctlYtCookies, true) : true);

    const chatOn = (ctlChatOn ? uiIsOn(ctlChatOn, true) : true);
    const chatHide = (ctlChatHideCmd ? uiIsOn(ctlChatHideCmd, true) : true);
    const alertsOn = (ctlAlertsOn ? uiIsOn(ctlAlertsOn, true) : true);

    const adsOn = (ctlAdsOn ? uiIsOn(ctlAdsOn, true) : true);
    const adLead = clamp(parseInt(ctlAdLead?.value || "30", 10) || 30, 0, 300);
    const adDur = clamp(parseInt(ctlAdDur?.value || "30", 10) || 30, 5, 3600);
    const adShowDuring = (ctlAdShowDuring ? uiIsOn(ctlAdShowDuring, true) : true);
    const adChatText = String(ctlAdChatText?.value || "").trim();

    const tcfg = readTickerUI();
    const ccfg = readCountdownUI();
    const cat = readCatalogUIForUrl();
    const bgm = readBgmUIForUrl();
    const hudc = readHudUI();

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

    // HUD scale param (solo player)
    u.searchParams.set("hudScale", String(hudc.scale ?? 1));

    return u.toString();
  }

  // Exponer API (sin lista de cams; refreshLists = no-op)
  try {
    g[API_KEY] = {
      kind: "RLC_CONTROL_API",
      version: APP_VERSION,
      build: BUILD_ID,
      key: KEY,
      bus: BUS,
      sendCmd,
      sendCmdAliases,
      busPost,
      postToPreview,
      getState: () => lastState,
      refreshLists: () => {}, // (compat) ya no gestionamos listas aquí
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

  function _hudScaleFromState(st) {
    try {
      const v =
        st?.hudScale ??
        st?.ui?.hudScale ??
        st?.hud?.scale ??
        st?.uiScaleHud ??
        null;
      if (v == null) return null;
      const scale = clamp(num(v, 1), 0.5, 2.5);
      return scale;
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
      const hs = _hudScaleFromState(st);
      const hudSig = (hs != null) ? String(Math.round(hs * 100)) : "na";
      return sigOf(`${getStateTs(st)}|${ver}|${id}|${rem}|${mins}|${st?.autoskip ? 1 : 0}|${st?.adfree ? 1 : 0}|${bgmSig}|${hudSig}`);
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
    const on = uiIsOn(ctlPreviewOn, true);
    try { ctlPreviewWrap.style.display = on ? "" : "none"; } catch (_) {}

    if (!on) return;

    try {
      const url = buildStreamUrlFromUI();
      if (!url) return;
      const cur = String(ctlPreview.getAttribute("src") || ctlPreview.src || "");
      if (cur !== url) ctlPreview.src = url;
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

    // canal/twitch auto fill
    try {
      const ch = extractTwitchChannelFromState(st);
      if (ch) maybeAutoFillChannelEverywhere(ch);
    } catch (_) {}

    // key UI
    syncKeyUI();

    const cam = st.cam || st.currentCam || {};
    safeSetText(ctlNowTitle, String(cam.title || "—"));
    safeSetText(ctlNowPlace, String(cam.place || "—"));
    try {
      const rem = (st.remaining ?? st.remain ?? st.left ?? st.timeLeft ?? 0);
      if (ctlNowTimer) ctlNowTimer.textContent = fmtMMSS((rem | 0));
    } catch (_) {}

    if (ctlOrigin) {
      let url = String(cam.originUrl || cam.url || "");
      try {
        if (url && !/^https?:\/\//i.test(url)) url = "";
      } catch (_) {}
      try { ctlOrigin.href = url || "#"; } catch (_) { try { ctlOrigin.href = "#"; } catch (_) {} }
      try { ctlOrigin.style.pointerEvents = url ? "auto" : "none"; } catch (_) {}
      try { ctlOrigin.style.opacity = url ? "1" : ".6"; } catch (_) {}
    }

    // hudScale: si viene del player, refresca UI y store
    try {
      const hs = _hudScaleFromState(st);
      if (hs != null) {
        hudCfg = saveHudCfg({ scale: hs });
        syncHudUIFromStore();
      }
    } catch (_) {}

    // bgm: reflejar si viene del player
    try {
      const b = _bgmFromState(st);
      if (b) {
        ensureBgmTrackOptions();
        uiSetOn(ctlBgmOn, !!b.enabled);
        if (ctlBgmVol && !isEditing(ctlBgmVol)) safeSetValue(ctlBgmVol, String(b.vol ?? 0.25));
        if (ctlBgmTrack && b.trackId && !isEditing(ctlBgmTrack)) safeSetValue(ctlBgmTrack, b.trackId);

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
  }

  // dedupe cmd receive (BOT_SAY etc.)
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

    const sig = sigOf(`${msg.mid || ""}|${msg.ts || ""}|${cmd}|${_safeStringify(payload || {})}`);
    const now = Date.now();
    if (sig && sig === lastSeenCmdSig && (now - lastSeenCmdAt) < 1200) return;
    lastSeenCmdSig = sig;
    lastSeenCmdAt = now;

    if (cmd === "BOT_SAY") {
      const text = String(payload.text || payload.msg || "").trim();
      if (text) botSay(text);
    }

    if (cmd === "BGM_CFG" || cmd === "BGM_SET" || cmd === "MUSIC_SET") {
      try {
        const c = normalizeBgmCfg(payload);
        bgmCfg = saveBgmCfg(c);
        syncBgmUIFromStore();
      } catch (_) {}
    }

    if (cmd === "HUD_SCALE" || cmd === "SET_HUD_SCALE" || cmd === "HUDSCALE") {
      try {
        const s = clamp(num(payload.scale ?? payload.value, 1), 0.5, 2.5);
        hudCfg = saveHudCfg({ scale: s });
        syncHudUIFromStore();
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

  // Polling LS (fallback cuando storage/BC no disparan) — sin camlist
  let _pollLastStateRaw = "";
  let _pollLastEvtRaw = "";
  let _pollLastCmdRaw = "";

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
  }

  // ───────────────────────── UI actions
  function applyBasicSettings() {
    const mins = clamp(parseInt(ctlMins?.value || "5", 10) || 5, 1, 120);
    sendCmdAliases("SET_MINS", { mins }, ["MINS", "SET_DURATION"]);

    const fit = String(ctlFit?.value || "cover").toLowerCase();
    sendCmdAliases("SET_FIT", { fit }, ["FIT"]);

    if (ctlHud) sendCmdAliases("HUD", { hidden: !uiIsOn(ctlHud, true) }, ["SET_HUD", "HUD_SET"]);
    if (ctlHudDetails) sendCmdAliases("HUD_DETAILS", { enabled: uiIsOn(ctlHudDetails, true) }, ["SET_HUD_DETAILS", "HUDDETAILS"]);

    if (ctlAutoskip) sendCmdAliases("SET_AUTOSKIP", { enabled: uiIsOn(ctlAutoskip, true) }, ["AUTOSKIP"]);
    if (ctlAdfree) sendCmdAliases("SET_MODE", { mode: uiIsOn(ctlAdfree, false) ? "adfree" : "" }, ["MODE"]);
    if (ctlYtCookies) sendCmdAliases("YT_COOKIES", { enabled: uiIsOn(ctlYtCookies, true) }, ["SET_YT_COOKIES"]);

    // HUD SCALE (solo player)
    if (ctlHudScale) {
      hudCfg = saveHudCfg(readHudUI());
      sendHudCfg(hudCfg, true);
    }

    sendCmdAliases("SET_PARAMS", {
      mins,
      fit,
      hud: (ctlHud ? uiIsOn(ctlHud, true) : true),
      hudDetails: (ctlHudDetails ? uiIsOn(ctlHudDetails, true) : true),
      autoskip: (ctlAutoskip ? uiIsOn(ctlAutoskip, true) : true),
      mode: (ctlAdfree ? (uiIsOn(ctlAdfree, false) ? "adfree" : "") : ""),
      ytCookies: (ctlYtCookies ? uiIsOn(ctlYtCookies, true) : true),
      hudScale: (ctlHudScale ? (readHudUI().scale) : (loadHudCfg().scale))
    }, ["APPLY_SETTINGS"]);

    syncPreviewUrl();
  }

  function applyVoteSettings() {
    const twitch = String(ctlTwitchChannel?.value || "").trim().replace(/^@/, "");
    if (twitch) sendCmdAliases("SET_TWITCH", { channel: twitch }, ["TWITCH", "SET_CHANNEL"]);

    const voteEnabled = ctlVoteOn ? uiIsOn(ctlVoteOn, false) : false;
    const overlay = ctlVoteOverlay ? uiIsOn(ctlVoteOverlay, true) : true;

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
    const chatEnabled = ctlChatOn ? uiIsOn(ctlChatOn, true) : true;
    const hideCommands = ctlChatHideCmd ? uiIsOn(ctlChatHideCmd, true) : true;
    const alertsEnabled = ctlAlertsOn ? uiIsOn(ctlAlertsOn, true) : true;

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
    const enabled = ctlAdsOn ? uiIsOn(ctlAdsOn, true) : true;
    const adLead = clamp(parseInt(ctlAdLead?.value || "30", 10) || 30, 0, 300);
    const adDurSec = clamp(parseInt(ctlAdDur?.value || String(loadAdDurStore()), 10) || 30, 5, 3600);
    const showDuring = ctlAdShowDuring ? uiIsOn(ctlAdShowDuring, true) : true;
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

  function doReset() {
    sendCmdAliases("RESET", {}, ["RESET_STATE", "HARD_RESET"]);
  }

  // ───────────────────────── Catalog control (sync)
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
      uiSetOn(ctlCatalogOn, !!CATALOG_DEFAULTS.enabled);
      if (ctlCatalogLayout) safeSetValue(ctlCatalogLayout, CATALOG_DEFAULTS.layout);
      if (ctlCatalogGap) safeSetValue(ctlCatalogGap, String(CATALOG_DEFAULTS.gap));
      uiSetOn(ctlCatalogLabels, !!CATALOG_DEFAULTS.labels);
      if (ctlCatalogMode) safeSetValue(ctlCatalogMode, CATALOG_DEFAULTS.mode);
      if (ctlCatalogFollowSlot) safeSetValue(ctlCatalogFollowSlot, String(CATALOG_DEFAULTS.followSlot));
      uiSetOn(ctlCatalogClickCycle, !!CATALOG_DEFAULTS.clickCycle);
      uiSetOn(ctlCatalogYtCookies, !!CATALOG_DEFAULTS.ytCookies);
      uiSetOn(ctlCatalogWxTiles, !!CATALOG_DEFAULTS.wxTiles);
      if (ctlCatalogWxRefreshSec) safeSetValue(ctlCatalogWxRefreshSec, String(CATALOG_DEFAULTS.wxRefreshSec));
      uiSetOn(ctlCatalogMuted, !!CATALOG_DEFAULTS.muted);
    } catch (_) {}
    applyCatalogNow();
  }

  // ───────────────────────── Bot UI glue
  function syncBotUIFromStore() {
    botCfg = loadBotCfg();
    uiSetOn(ctlBotOn, !!botCfg.enabled);
    if (ctlBotUser) safeSetValue(ctlBotUser, botCfg.user || "");
    if (ctlBotToken && !isEditing(ctlBotToken)) safeSetValue(ctlBotToken, botCfg.token ? "********" : "");
    uiSetOn(ctlBotSayOnAd, (botCfg.sayOnAd !== false));
    setBotStatus(botCfg.enabled ? "Bot: listo" : "Bot: OFF", !!botCfg.enabled);
  }

  function readBotUIAndSave() {
    const enabled = ctlBotOn ? uiIsOn(ctlBotOn, false) : false;
    const user = String(ctlBotUser?.value || "").trim().replace(/^@/, "");
    const chan = String(ctlTwitchChannel?.value || "").trim().replace(/^@/, "");

    let token = String(botCfg.token || "");
    const tokenUI = String(ctlBotToken?.value || "").trim();
    if (tokenUI && tokenUI !== "********") token = tokenUI.replace(/^oauth:/i, "");
    const sayOnAd = ctlBotSayOnAd ? uiIsOn(ctlBotSayOnAd, true) : true;

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
      if (!IS_CONTROL_MODE) return;
      if (isTextInputActive()) return;

      const k = String(e.key || "");
      if (k === "ArrowRight") { e.preventDefault(); doNext(); }
      else if (k === "ArrowLeft") { e.preventDefault(); doPrev(); }
      else if (k === " ") { e.preventDefault(); doTogglePlay(); }
      else if (k.toLowerCase() === "r") { e.preventDefault(); doShuffle(); }
      else if (k.toLowerCase() === "b") { e.preventDefault(); sendCmdAliases("BAN_CURRENT", {}, ["BAN_CAM_CURRENT", "EXCLUDE_CURRENT", "SKIP_CURRENT"]); }
    }, { passive: false });
  }

  // ───────────────────────── Delegación extra (data-cmd / data-action) — solo en control mode
  function bindDelegatedActions() {
    if (!IS_CONTROL_MODE) return;

    listen(document, "click", (e) => {
      const t = e.target;
      if (!t) return;

      const el = t.closest?.("[data-cmd],[data-action]");
      if (!el) return;

      // si hay un contenedor declarado, respétalo para no pillar botones ajenos
      const root = qs("[data-rlc-control-root]") || qs("#rlcControlRoot");
      if (root && !root.contains(el)) return;

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

      sendCmdAliases(cmd, payload, []);
      setStatus(`Enviado: ${cmd}`, true);
    }, true);
  }

  function bindUi() {
    // Key UI
    safeOn(ctlKeyApply, "click", applyKeyFromUI);
    safeOn(ctlKey, "keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); applyKeyFromUI(); }
    });

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

    // HUD scale
    safeOn(ctlHudScale, "input", applyHudNow);
    safeOn(ctlHudScale, "change", applyHudNow);
    safeOn(ctlHudScaleApply, "click", () => { applyHudNow(); });

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
    safeOn(ctlBgmVol, "change", applyBgmNow);
    safeOn(ctlBgmPrev, "click", bgmPrev);
    safeOn(ctlBgmPlay, "click", bgmToggle);
    safeOn(ctlBgmNext, "click", bgmNext);
    safeOn(ctlBgmShuffle, "click", bgmShuffle);

    // Auto preview sync
    const autoSync = debounce(syncPreviewUrl, 160);
    [
      ctlMins, ctlFit, ctlHud, ctlHudDetails, ctlAutoskip, ctlAdfree, ctlTwitchChannel,
      ctlHudScale,
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

    // también input para ranges (mejor UX)
    [ctlBgmVol, ctlHudScale].forEach(el => safeOn(el, "input", autoSync));

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
        else if (msg?.type === "BGM_CFG") {
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
        else if (msg?.type === "BGM_CFG") {
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

      if (k === TICKER_CFG_KEY || k === TICKER_CFG_KEY_BASE) syncTickerUIFromStore();
      if (k === COUNTDOWN_CFG_KEY || k === COUNTDOWN_CFG_KEY_BASE) syncCountdownUIFromStore();
      if (k === HELIX_CFG_KEY || k === HELIX_CFG_KEY_BASE) syncHelixUIFromStore();
      if (k === BOT_STORE_KEY || k === BOT_STORE_KEY_BASE) { syncBotUIFromStore(); botApplyCfgAndMaybeConnect(); }
      if (k === BGM_CFG_KEY || k === BGM_CFG_KEY_BASE) syncBgmUIFromStore();
      if (k === HUD_CFG_KEY || k === HUD_CFG_KEY_BASE) syncHudUIFromStore();
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

  function heartbeat() {
    const now = Date.now();
    const age = now - (lastSeenAt || 0);

    pollLS();
    ensureBgmTrackOptions();
    syncKeyUI();

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

    helixTick(false).catch(() => {});
    helixCategoryTick(false).catch(() => {});
  }

  // ───────────────────────── Boot / Destroy
  function boot() {
    try {
      cacheDom();
      ensureControlMode();
      installSubmitGuard();

      // key en UI
      syncKeyUI();

      if (ctlBusName) safeSetText(ctlBusName, KEY ? `${BUS} (keyed)` : BUS);

      try {
        if (ctlAdDur && (!ctlAdDur.value || !String(ctlAdDur.value).trim())) {
          safeSetValue(ctlAdDur, String(loadAdDurStore()));
        }
      } catch (_) {}

      // HUD cfg
      syncHudUIFromStore();

      syncBgmUIFromStore();
      ensureBgmTrackOptions();

      syncTickerUIFromStore();
      syncCountdownUIFromStore();
      syncHelixUIFromStore();
      syncBotUIFromStore();

      // si ya hay canal en UI, úsalo para auto-fill bot si vacío
      try {
        const chUi = String(ctlTwitchChannel?.value || "").trim().replace(/^@/, "");
        if (chUi) maybeAutoFillChannelEverywhere(chUi);
      } catch (_) {}

      // auto connect bot si está ON y hay creds guardadas
      botApplyCfgAndMaybeConnect();

      bindDelegatedActions();
      bindUi();
      bindHotkeys();
      bindBus();

      readStateFromLS();
      readEventFromLS();
      readCmdFromLS();
      pollLS();

      lastReqStateAt = Date.now();
      sendCmdAliases("REQ_STATE", {}, ["STATE_REQ", "GET_STATE", "PING_STATE"]);

      installSwUpdateWatcher();

      heartbeatId = setInterval(heartbeat, 900);
      setStatus(`Control listo · v${APP_VERSION}${KEY ? ` · key OK` : " · (sin key)"}`, true);
      log("boot OK", { APP_VERSION, BUILD_ID, KEY, BUS, CMD_KEY, STATE_KEY, EVT_KEY, BGM_CFG_KEY, HUD_CFG_KEY });
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
