/* pointsControl.js — RLC Points v1.2.0 (KEYED BUS + OVERLAY + CONTROL + SAFE STORAGE + DEDUPE FIX + AUTO CARD IN CONTROL)
   ✅ Funciona sin backend (localStorage + BroadcastChannel)
   ✅ Namespace por ?key=... (compat RLC)
   ✅ Un mismo archivo sirve para:
      - Control (panel admin) si detecta/inyecta IDs ctlPts*
      - Overlay (browser source) si detecta / crea root de puntos o ?pts=1
   ✅ Null-safe (si faltan elementos, no rompe)
   ✅ DEDUPE FIX: dedupe por tipo (evita perder CFG/STATE si comparten ts)
   ✅ Live apply suave en control
   ✅ NEW: Auto-inyecta una card "POINTS" dentro de .controlGrid si no existe
   ✅ Overlay-only para OBS con ?pts=1 (&ptsOnly=1 por defecto en copy-url)
*/
(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;
  const LOAD_GUARD = "__RLC_POINTS_LOADED_V120";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  const VERSION = "1.2.0";

  // ───────────────────────── helpers
  const qs = (s, r = document) => r.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const safeStr = (v) => (typeof v === "string") ? v.trim() : "";
  const num = (v, fallback) => {
    const n = parseFloat(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  };
  const safeJson = (raw, fallback = null) => { try { return JSON.parse(raw); } catch (_) { return fallback; } };
  const parseBool = (v, def = false) => {
    if (v == null) return def;
    const s = String(v).trim().toLowerCase();
    if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
    if (s === "0" || s === "false" || s === "no" || s === "off") return false;
    return def;
  };
  const fmtK = (n) => {
    const x = +n || 0;
    const ax = Math.abs(x);
    if (ax >= 1e9) return (x / 1e9).toFixed(2).replace(/\.00$/, "") + "B";
    if (ax >= 1e6) return (x / 1e6).toFixed(2).replace(/\.00$/, "") + "M";
    if (ax >= 1e3) return (x / 1e3).toFixed(2).replace(/\.00$/, "") + "K";
    return String((x | 0));
  };

  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (_) {} }

  function parseParams() {
    const u = new URL(location.href);
    const overlay = parseBool(u.searchParams.get("pts") ?? u.searchParams.get("points") ?? u.searchParams.get("pointsOverlay"), false);
    return {
      key: safeStr(u.searchParams.get("key") || ""),
      overlay,
      overlayOnly: overlay ? parseBool(u.searchParams.get("ptsOnly"), true) : false,

      // defaults opcionales
      name: safeStr(u.searchParams.get("ptsName") || u.searchParams.get("pointsName") || ""),
      icon: safeStr(u.searchParams.get("ptsIcon") || u.searchParams.get("pointsIcon") || ""),
      goal: num(u.searchParams.get("ptsGoal") ?? u.searchParams.get("pointsGoal"), NaN),
      value: num(u.searchParams.get("ptsValue") ?? u.searchParams.get("pointsValue"), NaN),
      showGoal: parseBool(u.searchParams.get("ptsShowGoal"), true),
      showDelta: parseBool(u.searchParams.get("ptsShowDelta"), true),
      pos: safeStr(u.searchParams.get("ptsPos") || ""), // tl,tr,bl,br
      scale: clamp(num(u.searchParams.get("ptsScale"), 1), 0.6, 1.8),
    };
  }
  const P = parseParams();
  const KEY = String(P.key || "").trim();

  // ───────────────────────── BUS + keys (compat RLC)
  const BUS_BASE = "rlc_bus_v1";

  const PTS_STATE_KEY_BASE = "rlc_points_state_v1";
  const PTS_CFG_KEY_BASE   = "rlc_points_cfg_v1";

  const BUS = KEY ? `${BUS_BASE}:${KEY}` : BUS_BASE;
  const BUS_LEGACY = BUS_BASE;

  const PTS_STATE_KEY = KEY ? `${PTS_STATE_KEY_BASE}:${KEY}` : PTS_STATE_KEY_BASE;
  const PTS_CFG_KEY   = KEY ? `${PTS_CFG_KEY_BASE}:${KEY}` : PTS_CFG_KEY_BASE;

  const bcMain = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS) : null;
  const bcLegacy = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_LEGACY) : null;

  // compat keyless unos segundos (como tu control.js)
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

  function busPost(msg) {
    try { if (bcMain) bcMain.postMessage(msg); } catch (_) {}
    try { if (bcLegacy) bcLegacy.postMessage(msg); } catch (_) {}
  }

  // ───────────────────────── defaults + normalize
  const CFG_DEFAULTS = {
    enabled: true,
    showGoal: true,
    showDelta: true,
    pos: "tl", // tl,tr,bl,br
    scale: 1,
    name: "Crystal",
    icon: "💎",
    theme: "neo",
  };

  const STATE_DEFAULTS = {
    value: 0,
    goal: 0,
    updatedAt: 0,
  };

  function normalizeCfg(inCfg) {
    const c = Object.assign({}, CFG_DEFAULTS, (inCfg || {}));
    c.enabled = (c.enabled !== false);
    c.showGoal = (c.showGoal !== false);
    c.showDelta = (c.showDelta !== false);

    c.pos = String(c.pos || "tl").toLowerCase().trim();
    if (!["tl","tr","bl","br"].includes(c.pos)) c.pos = "tl";

    c.scale = clamp(num(c.scale, 1), 0.6, 1.8);

    c.name = String(c.name || CFG_DEFAULTS.name).trim().slice(0, 24) || CFG_DEFAULTS.name;
    c.icon = String(c.icon || CFG_DEFAULTS.icon).trim().slice(0, 6) || CFG_DEFAULTS.icon;

    c.theme = String(c.theme || "neo").trim().toLowerCase();
    if (!c.theme) c.theme = "neo";

    return c;
  }

  function normalizeState(inSt) {
    const s = Object.assign({}, STATE_DEFAULTS, (inSt || {}));
    s.value = Math.max(0, (num(s.value, 0) | 0));
    s.goal  = Math.max(0, (num(s.goal, 0) | 0));
    s.updatedAt = Math.max(0, (num(s.updatedAt, 0) | 0));
    return s;
  }

  function loadCfg() {
    const a = safeJson(lsGet(PTS_CFG_KEY), null);
    if (a && typeof a === "object") return normalizeCfg(a);

    const b = safeJson(lsGet(PTS_CFG_KEY_BASE), null);
    if (b && typeof b === "object") return normalizeCfg(b);

    // query overrides
    const c = normalizeCfg(CFG_DEFAULTS);
    if (P.name) c.name = P.name;
    if (P.icon) c.icon = P.icon;
    if (P.pos) c.pos = P.pos.toLowerCase();
    if (Number.isFinite(P.scale)) c.scale = P.scale;
    c.showGoal = !!P.showGoal;
    c.showDelta = !!P.showDelta;

    return normalizeCfg(c);
  }

  function saveCfg(cfg) {
    const c = normalizeCfg(cfg);
    const raw = JSON.stringify(c);
    lsSet(PTS_CFG_KEY, raw);
    lsSet(PTS_CFG_KEY_BASE, raw);
    return c;
  }

  function loadState() {
    const a = safeJson(lsGet(PTS_STATE_KEY), null);
    if (a && typeof a === "object") return normalizeState(a);

    const b = safeJson(lsGet(PTS_STATE_KEY_BASE), null);
    if (b && typeof b === "object") return normalizeState(b);

    const s = normalizeState(STATE_DEFAULTS);
    if (Number.isFinite(P.goal)) s.goal = Math.max(0, P.goal | 0);
    if (Number.isFinite(P.value)) s.value = Math.max(0, P.value | 0);
    return s;
  }

  function saveState(st) {
    const s = normalizeState(st);
    const raw = JSON.stringify(s);
    lsSet(PTS_STATE_KEY, raw);
    lsSet(PTS_STATE_KEY_BASE, raw);
    return s;
  }

  function publishCfg(cfg) {
    const c = saveCfg(cfg);
    const msg = { type: "PTS_CFG", ts: Date.now(), cfg: c };
    if (KEY) msg.key = KEY;
    busPost(msg);
    return c;
  }

  function publishState(st) {
    const s = saveState(st);
    const msg = { type: "PTS_STATE", ts: Date.now(), state: s };
    if (KEY) msg.key = KEY;
    busPost(msg);
    return s;
  }

  // ───────────────────────── Control panel auto-inject (en control.html)
  function isLikelyControlPage() {
    if (document.body?.classList?.contains("mode-control")) return true;
    if (qs(".controlWrap") || qs(".controlGrid") || qs("main.controlWrap")) return true;
    // fallback: si existe el header típico
    if (qs("#ctlStatus") || qs(".controlHeader")) return true;
    return false;
  }

  function injectControlCardStylesOnce() {
    if (qs("#rlcPtsControlStyles")) return;
    const st = document.createElement("style");
    st.id = "rlcPtsControlStyles";
    st.textContent = `
#ctlPtsCard .rlcPtsHead{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}
#ctlPtsCard .rlcPtsTitle{display:flex;flex-direction:column;gap:2px}
#ctlPtsCard .rlcPtsKicker{font:900 10px/1 ui-sans-serif,system-ui;letter-spacing:.22em;opacity:.7}
#ctlPtsCard .rlcPtsNameBig{font:950 16px/1 ui-sans-serif,system-ui}
#ctlPtsCard .rlcPtsGrid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@media (max-width: 880px){#ctlPtsCard .rlcPtsGrid{grid-template-columns:1fr}}
#ctlPtsCard .rlcFld{display:flex;flex-direction:column;gap:6px}
#ctlPtsCard .rlcFld span{font:800 11px/1 ui-sans-serif,system-ui;opacity:.75;letter-spacing:.08em;text-transform:uppercase}
#ctlPtsCard input,#ctlPtsCard select{width:100%}
#ctlPtsCard .rlcPtsBtns{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}
#ctlPtsCard .rlcPtsBtns button{min-height:38px}
#ctlPtsCard .rlcPtsRow{display:flex;gap:10px;align-items:end}
#ctlPtsCard .rlcPtsRow .rlcFld{flex:1 1 auto}
#ctlPtsCard .rlcPtsMini{opacity:.75;font-size:12px;line-height:1.35;margin-top:8px}
`.trim();
    document.head.appendChild(st);
  }

  function ensureControlCard() {
    if (!isLikelyControlPage()) return false;

    // Si ya existen inputs, no inyectes nada
    if (qs("#ctlPtsApply") || qs("#ctlPointsApply") || qs("#ctlPtsValue") || qs("#ctlPtsName")) return true;

    const grid = qs(".controlGrid") || qs("section.controlGrid") || qs("#controlGrid") || null;
    if (!grid) return false;

    if (qs("#ctlPtsCard")) return true;

    injectControlCardStylesOnce();

    const card = document.createElement("div");
    card.className = "card";
    card.id = "ctlPtsCard";

    // markup: compatible con tu script (IDs ctlPts*)
    card.innerHTML = `
      <div class="rlcPtsHead">
        <div class="rlcPtsTitle">
          <div class="rlcPtsKicker">OVERLAY</div>
          <div class="rlcPtsNameBig">POINTS</div>
        </div>
        <div class="pill mono" id="ctlPtsStatus">—</div>
      </div>

      <div class="rlcPtsGrid">
        <label class="rlcFld">
          <span>Enabled</span>
          <select id="ctlPtsOn">
            <option value="on">ON</option>
            <option value="off">OFF</option>
          </select>
        </label>

        <label class="rlcFld">
          <span>Position</span>
          <select id="ctlPtsPos">
            <option value="tl">Top-Left</option>
            <option value="tr">Top-Right</option>
            <option value="bl">Bottom-Left</option>
            <option value="br">Bottom-Right</option>
          </select>
        </label>

        <label class="rlcFld">
          <span>Name</span>
          <input id="ctlPtsName" type="text" placeholder="Crystal" maxlength="24" />
        </label>

        <label class="rlcFld">
          <span>Icon (emoji o 1 char)</span>
          <input id="ctlPtsIcon" type="text" placeholder="💎" maxlength="6" />
        </label>

        <label class="rlcFld">
          <span>Value</span>
          <input id="ctlPtsValue" type="number" min="0" step="1" />
        </label>

        <label class="rlcFld">
          <span>Goal</span>
          <input id="ctlPtsGoal" type="number" min="0" step="1" />
        </label>

        <label class="rlcFld">
          <span>Show goal bar</span>
          <select id="ctlPtsShowGoal">
            <option value="on">ON</option>
            <option value="off">OFF</option>
          </select>
        </label>

        <label class="rlcFld">
          <span>Show delta pop</span>
          <select id="ctlPtsShowDelta">
            <option value="on">ON</option>
            <option value="off">OFF</option>
          </select>
        </label>

        <label class="rlcFld">
          <span>Scale (0.6 - 1.8)</span>
          <input id="ctlPtsScale" type="number" min="0.6" max="1.8" step="0.05" />
        </label>

        <label class="rlcFld">
          <span>Delta step</span>
          <input id="ctlPtsDelta" type="number" min="1" step="1" value="10" />
        </label>
      </div>

      <div class="rlcPtsBtns">
        <button id="ctlPtsSub" type="button">− Restar</button>
        <button id="ctlPtsAdd" type="button">+ Sumar</button>
        <button id="ctlPtsApply" type="button">Aplicar</button>
        <button id="ctlPtsReset" type="button">Reset</button>
        <button id="ctlPtsCopyUrl" type="button">Copiar URL overlay</button>
      </div>

      <div class="rlcPtsMini">
        OBS: añade la URL copiada como <b>Browser Source</b> (transparente).<br/>
        Tip: SHIFT+click en la URL dentro de OBS para revisarla rápido.
      </div>
    `.trim();

    grid.appendChild(card);
    return true;
  }

  // Asegura card antes de detectar control/overlay
  ensureControlCard();

  // ───────────────────────── Overlay UI (auto-inject)
  const OVERLAY_ROOT_ID = "rlcPtsRoot";

  let cfg = loadCfg();
  let state = loadState();

  function detectIsControl() {
    return (
      !!qs("#ctlPtsApply") ||
      !!qs("#ctlPointsApply") ||
      !!qs("#ctlPtsValue") ||
      !!qs("#ctlPtsName")
    );
  }

  const isControl = detectIsControl();

  // overlayWanted:
  // - si ?pts=1
  // - o ya existe root
  // - o NO es página de control (página dedicada overlay)
  const overlayWanted = !!P.overlay || !!document.getElementById(OVERLAY_ROOT_ID) || (!isLikelyControlPage());

  function injectOverlayStylesOnce() {
    if (document.getElementById("rlcPtsStyles")) return;
    const st = document.createElement("style");
    st.id = "rlcPtsStyles";
    st.textContent =
      ":root{--rlcPtsScale:1;--rlcPtsX:12px;--rlcPtsY:12px}" +
      ".rlcPtsRoot{position:fixed;z-index:10005;pointer-events:none;transform:translateZ(0) scale(var(--rlcPtsScale));transform-origin:top left}" +
      ".rlcPtsRoot.pos-tl{left:max(var(--rlcPtsX),env(safe-area-inset-left));top:max(var(--rlcPtsY),env(safe-area-inset-top));transform-origin:top left}" +
      ".rlcPtsRoot.pos-tr{right:max(var(--rlcPtsX),env(safe-area-inset-right));top:max(var(--rlcPtsY),env(safe-area-inset-top));transform-origin:top right}" +
      ".rlcPtsRoot.pos-bl{left:max(var(--rlcPtsX),env(safe-area-inset-left));bottom:max(var(--rlcPtsY),env(safe-area-inset-bottom));transform-origin:bottom left}" +
      ".rlcPtsRoot.pos-br{right:max(var(--rlcPtsX),env(safe-area-inset-right));bottom:max(var(--rlcPtsY),env(safe-area-inset-bottom));transform-origin:bottom right}" +
      ".rlcPtsCard{min-width:230px;max-width:min(420px,calc(100vw - 24px));padding:12px 14px;border-radius:18px;background:rgba(10,14,20,.62);border:1px solid rgba(255,255,255,.12);box-shadow:0 16px 46px rgba(0,0,0,.40);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}" +
      ".rlcPtsTop{display:flex;align-items:center;gap:10px}" +
      ".rlcPtsIcon{width:34px;height:34px;border-radius:12px;display:grid;place-items:center;font-size:18px;background:rgba(77,215,255,.16);border:1px solid rgba(255,255,255,.12)}" +
      ".rlcPtsMeta{min-width:0;flex:1 1 auto}" +
      ".rlcPtsName{font-weight:900;font-size:12px;letter-spacing:.3px;color:rgba(255,255,255,.82);text-transform:uppercase}" +
      ".rlcPtsVal{margin-top:2px;font-weight:950;font-size:20px;line-height:1.05;color:rgba(255,255,255,.96);display:flex;align-items:baseline;gap:8px}" +
      ".rlcPtsDelta{font-weight:900;font-size:12px;padding:4px 8px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.08);color:rgba(255,255,255,.9);opacity:0;transform:translateY(4px);transition:opacity .18s ease, transform .18s ease}" +
      ".rlcPtsDelta.on{opacity:1;transform:translateY(0)}" +
      ".rlcPtsDelta.plus{background:rgba(25,226,138,.14);border-color:rgba(25,226,138,.22)}" +
      ".rlcPtsDelta.minus{background:rgba(255,90,90,.14);border-color:rgba(255,90,90,.22)}" +
      ".rlcPtsBar{margin-top:10px;height:7px;border-radius:999px;background:rgba(255,255,255,.10);overflow:hidden}" +
      ".rlcPtsBar>i{display:block;height:100%;width:0%;background:linear-gradient(90deg,rgba(77,215,255,.88),rgba(255,206,87,.88))}" +
      ".rlcPtsGoalRow{margin-top:6px;display:flex;justify-content:space-between;gap:10px;font-size:11.5px;color:rgba(255,255,255,.78)}" +
      ".rlcPtsRoot.off{display:none!important}" +
      "body.rlcPtsOnly{background:transparent!important}html.rlcPtsOnly,body.rlcPtsOnly{background:transparent!important}" +
      "body.rlcPtsOnly .controlWrap{display:none!important}";
    document.head.appendChild(st);
  }

  let elRoot = null, elIcon = null, elName = null, elVal = null, elDelta = null, elBar = null, elGoalL = null, elGoalR = null;
  let lastRenderValue = null;
  let deltaTimer = null;

  function ensureOverlayUI() {
    if (!overlayWanted) return false;
    injectOverlayStylesOnce();

    elRoot = document.getElementById(OVERLAY_ROOT_ID);
    if (!elRoot) {
      elRoot = document.createElement("div");
      elRoot.id = OVERLAY_ROOT_ID;
      elRoot.className = "rlcPtsRoot pos-tl";
      elRoot.innerHTML =
        '<div class="rlcPtsCard">' +
          '<div class="rlcPtsTop">' +
            '<div class="rlcPtsIcon" id="rlcPtsIcon">💎</div>' +
            '<div class="rlcPtsMeta">' +
              '<div class="rlcPtsName" id="rlcPtsName">CRYSTAL</div>' +
              '<div class="rlcPtsVal"><span id="rlcPtsVal">0</span><span class="rlcPtsDelta" id="rlcPtsDelta">+1</span></div>' +
            "</div>" +
          "</div>" +
          '<div class="rlcPtsBar" id="rlcPtsBarWrap"><i id="rlcPtsBarFill"></i></div>' +
          '<div class="rlcPtsGoalRow" id="rlcPtsGoalRow"><span id="rlcPtsGoalL">0</span><span id="rlcPtsGoalR">0</span></div>' +
        "</div>";
      document.body.appendChild(elRoot);
    }

    elIcon = qs("#rlcPtsIcon");
    elName = qs("#rlcPtsName");
    elVal = qs("#rlcPtsVal");
    elDelta = qs("#rlcPtsDelta");
    elBar = qs("#rlcPtsBarFill");
    elGoalL = qs("#rlcPtsGoalL");
    elGoalR = qs("#rlcPtsGoalR");

    return true;
  }

  function setOverlayPos(pos) {
    if (!elRoot) return;
    const p = String(pos || "tl").toLowerCase();
    elRoot.classList.remove("pos-tl","pos-tr","pos-bl","pos-br");
    elRoot.classList.add(`pos-${["tl","tr","bl","br"].includes(p) ? p : "tl"}`);
  }

  function setOverlayScale(scale) {
    try { document.documentElement.style.setProperty("--rlcPtsScale", String(clamp(+scale || 1, 0.6, 1.8))); }
    catch (_) {}
  }

  function showDelta(d) {
    if (!elDelta) return;
    const x = d | 0;
    if (!x) return;

    try {
      elDelta.textContent = (x > 0 ? `+${fmtK(x)}` : `${fmtK(x)}`);
      elDelta.classList.remove("plus","minus","on");
      elDelta.classList.add(x > 0 ? "plus" : "minus");
      void elDelta.offsetWidth;
      elDelta.classList.add("on");
    } catch (_) {}

    try { if (deltaTimer) clearTimeout(deltaTimer); } catch (_) {}
    deltaTimer = setTimeout(() => {
      try { elDelta.classList.remove("on","plus","minus"); } catch (_) {}
    }, 1600);
  }

  function renderOverlay() {
    if (!overlayWanted) return;
    if (!ensureOverlayUI()) return;

    const on = !!cfg.enabled;
    elRoot.classList.toggle("off", !on);
    if (!on) return;

    setOverlayPos(cfg.pos);
    setOverlayScale(cfg.scale);

    if (elIcon) elIcon.textContent = cfg.icon || "💎";
    if (elName) elName.textContent = String(cfg.name || "Crystal").toUpperCase();

    const v = state.value | 0;
    const goal = state.goal | 0;

    if (elVal) elVal.textContent = fmtK(v);

    const showGoal = cfg.showGoal && goal > 0;
    const barWrap = qs("#rlcPtsBarWrap");
    const goalRow = qs("#rlcPtsGoalRow");
    if (barWrap) barWrap.style.display = showGoal ? "" : "none";
    if (goalRow) goalRow.style.display = showGoal ? "" : "none";

    if (showGoal) {
      const pct = clamp(goal > 0 ? (100 * v / goal) : 0, 0, 100);
      if (elBar) elBar.style.width = `${pct.toFixed(1)}%`;
      if (elGoalL) elGoalL.textContent = fmtK(v);
      if (elGoalR) elGoalR.textContent = `Goal ${fmtK(goal)}`;
    }

    if (cfg.showDelta) {
      if (lastRenderValue == null) lastRenderValue = v;
      const d = (v - (lastRenderValue | 0)) | 0;
      if (d !== 0) showDelta(d);
    }
    lastRenderValue = v;
  }

  // ───────────────────────── Control UI (IDs)
  const ctlPtsOn       = qs("#ctlPtsOn") || qs("#ctlPointsOn");
  const ctlPtsName     = qs("#ctlPtsName") || qs("#ctlPointsName");
  const ctlPtsIcon     = qs("#ctlPtsIcon") || qs("#ctlPointsIcon");
  const ctlPtsValue    = qs("#ctlPtsValue") || qs("#ctlPointsValue");
  const ctlPtsGoal     = qs("#ctlPtsGoal") || qs("#ctlPointsGoal");
  const ctlPtsDelta    = qs("#ctlPtsDelta") || qs("#ctlPointsDelta");

  const ctlPtsShowGoal  = qs("#ctlPtsShowGoal");
  const ctlPtsShowDelta = qs("#ctlPtsShowDelta");
  const ctlPtsPos       = qs("#ctlPtsPos");
  const ctlPtsScale     = qs("#ctlPtsScale");

  const ctlPtsAdd     = qs("#ctlPtsAdd");
  const ctlPtsSub     = qs("#ctlPtsSub");
  const ctlPtsApply   = qs("#ctlPtsApply") || qs("#ctlPointsApply");
  const ctlPtsReset   = qs("#ctlPtsReset") || qs("#ctlPointsReset");
  const ctlPtsCopyUrl = qs("#ctlPtsCopyUrl") || qs("#ctlPointsCopyUrl");
  const ctlPtsStatus  = qs("#ctlPtsStatus");
  const ctlPtsUrl     = qs("#ctlPtsUrl"); // opcional

  function setCtlStatus(text, ok = true) {
    if (!ctlPtsStatus) return;
    ctlPtsStatus.textContent = text;
    // usa clases tipo tu UI si existen
    try {
      ctlPtsStatus.classList.toggle("pill--ok", !!ok);
      ctlPtsStatus.classList.toggle("pill--bad", !ok);
    } catch (_) {}
  }

  function isEditing(el) {
    if (!el) return false;
    try { return document.activeElement === el || el.matches(":focus"); }
    catch (_) { return document.activeElement === el; }
  }

  function buildOverlayUrl() {
    const u = new URL(location.href);
    u.searchParams.set("pts", "1");
    if (KEY) u.searchParams.set("key", KEY);
    u.searchParams.set("ptsOnly", "1");
    return u.toString();
  }

  function syncControlUI() {
    if (!isControl) return;

    if (ctlPtsOn && !isEditing(ctlPtsOn)) ctlPtsOn.value = cfg.enabled ? "on" : "off";
    if (ctlPtsName && !isEditing(ctlPtsName)) ctlPtsName.value = cfg.name || "";
    if (ctlPtsIcon && !isEditing(ctlPtsIcon)) ctlPtsIcon.value = cfg.icon || "";
    if (ctlPtsShowGoal && !isEditing(ctlPtsShowGoal)) ctlPtsShowGoal.value = cfg.showGoal ? "on" : "off";
    if (ctlPtsShowDelta && !isEditing(ctlPtsShowDelta)) ctlPtsShowDelta.value = cfg.showDelta ? "on" : "off";
    if (ctlPtsPos && !isEditing(ctlPtsPos)) ctlPtsPos.value = cfg.pos || "tl";
    if (ctlPtsScale && !isEditing(ctlPtsScale)) ctlPtsScale.value = String(cfg.scale ?? 1);

    if (ctlPtsValue && !isEditing(ctlPtsValue)) ctlPtsValue.value = String(state.value | 0);
    if (ctlPtsGoal && !isEditing(ctlPtsGoal)) ctlPtsGoal.value = String(state.goal | 0);
    if (ctlPtsDelta && !isEditing(ctlPtsDelta) && !ctlPtsDelta.value) ctlPtsDelta.value = "10";

    if (ctlPtsUrl && !isEditing(ctlPtsUrl)) ctlPtsUrl.value = buildOverlayUrl();

    setCtlStatus(cfg.enabled ? `ON · ${fmtK(state.value | 0)}` : "OFF", !!cfg.enabled);
  }

  function readControlCfg() {
    const out = Object.assign({}, cfg);
    if (ctlPtsOn) out.enabled = (ctlPtsOn.value !== "off");
    if (ctlPtsName) out.name = String(ctlPtsName.value || out.name || CFG_DEFAULTS.name).trim();
    if (ctlPtsIcon) out.icon = String(ctlPtsIcon.value || out.icon || CFG_DEFAULTS.icon).trim();

    if (ctlPtsShowGoal) out.showGoal = (ctlPtsShowGoal.value !== "off");
    if (ctlPtsShowDelta) out.showDelta = (ctlPtsShowDelta.value !== "off");
    if (ctlPtsPos) out.pos = String(ctlPtsPos.value || out.pos || "tl").trim().toLowerCase();
    if (ctlPtsScale) out.scale = clamp(num(ctlPtsScale.value, out.scale ?? 1), 0.6, 1.8);

    return normalizeCfg(out);
  }

  function readControlState() {
    const out = Object.assign({}, state);
    if (ctlPtsValue) out.value = Math.max(0, (parseInt(ctlPtsValue.value || "0", 10) || 0));
    if (ctlPtsGoal) out.goal = Math.max(0, (parseInt(ctlPtsGoal.value || "0", 10) || 0));
    out.updatedAt = Date.now();
    return normalizeState(out);
  }

  function applyControlAll() {
    cfg = publishCfg(readControlCfg());
    state = publishState(readControlState());
    renderOverlay();
    syncControlUI();
  }

  function applyDelta(sign) {
    const d = clamp(parseInt(ctlPtsDelta?.value || "10", 10) || 10, 1, 999999);
    const cur = state.value | 0;
    const next = Math.max(0, cur + (sign > 0 ? d : -d));
    state = publishState({ ...state, value: next, updatedAt: Date.now() });
    if (ctlPtsValue && !isEditing(ctlPtsValue)) ctlPtsValue.value = String(next);
    renderOverlay();
    syncControlUI();
  }

  function resetAll() {
    cfg = publishCfg(CFG_DEFAULTS);
    state = publishState({ value: 0, goal: 0, updatedAt: Date.now() });
    // para que no salte delta raro tras reset
    lastRenderValue = null;
    syncControlUI();
    renderOverlay();
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

  function isTextInputActive() {
    const a = document.activeElement;
    if (!a) return false;
    const tag = String(a.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    try { if (a.isContentEditable) return true; } catch (_) {}
    return false;
  }

  function debounce(fn, waitMs = 160) {
    let t = null;
    return (...args) => {
      try { if (t) clearTimeout(t); } catch (_) {}
      t = setTimeout(() => { t = null; fn(...args); }, waitMs);
    };
  }

  function bindControl() {
    if (!isControl) return;

    const doApply = () => applyControlAll();
    const doApplyDeb = debounce(doApply, 170);

    try { ctlPtsApply?.addEventListener?.("click", doApply); } catch (_) {}
    try { ctlPtsAdd?.addEventListener?.("click", () => applyDelta(+1)); } catch (_) {}
    try { ctlPtsSub?.addEventListener?.("click", () => applyDelta(-1)); } catch (_) {}
    try { ctlPtsReset?.addEventListener?.("click", resetAll); } catch (_) {}

    // live apply suave en inputs/selects
    const live = [ctlPtsOn, ctlPtsName, ctlPtsIcon, ctlPtsShowGoal, ctlPtsShowDelta, ctlPtsPos, ctlPtsScale, ctlPtsValue, ctlPtsGoal];
    for (const el of live) {
      if (!el) continue;
      try { el.addEventListener("change", doApply); } catch (_) {}
      try { el.addEventListener("input", doApplyDeb); } catch (_) {}
    }

    try {
      ctlPtsCopyUrl?.addEventListener?.("click", async () => {
        const url = buildOverlayUrl();
        const ok = await copyToClipboard(url);
        try { ctlPtsCopyUrl.textContent = ok ? "Copiado ✅" : "Error ❌"; } catch (_) {}
        setTimeout(() => { try { ctlPtsCopyUrl.textContent = "Copiar URL overlay"; } catch (_) {} }, 1200);
      });
    } catch (_) {}

    try {
      document.addEventListener("keydown", (e) => {
        if (isTextInputActive()) return;
        if (e.key === "+") { e.preventDefault(); applyDelta(+1); }
        else if (e.key === "-") { e.preventDefault(); applyDelta(-1); }
        else if (e.key.toLowerCase() === "p") { e.preventDefault(); doApply(); }
      });
    } catch (_) {}

    syncControlUI();
  }

  // ───────────────────────── Receive bus messages (DEDUP FIX)
  const lastSeenByType = { PTS_CFG: 0, PTS_STATE: 0 };

  function shouldAcceptMsg(msg) {
    const type = String(msg?.type || "");
    const ts = (msg?.ts | 0) || 0;
    if (!type) return false;
    if (!ts) return true;
    const last = lastSeenByType[type] || 0;
    if (ts <= last) return false;
    lastSeenByType[type] = ts;
    return true;
  }

  function handleMsg(msg, isMainChannel) {
    if (!msg || typeof msg !== "object") return;
    if (!keyOk(msg, !!isMainChannel)) return;
    if (!shouldAcceptMsg(msg)) return;

    if (msg.type === "PTS_CFG" && msg.cfg) {
      cfg = normalizeCfg(msg.cfg);
      saveCfg(cfg);
      syncControlUI();
      renderOverlay();
      return;
    }

    if (msg.type === "PTS_STATE" && msg.state) {
      state = normalizeState(msg.state);
      saveState(state);
      syncControlUI();
      renderOverlay();
      return;
    }
  }

  try { if (bcMain) bcMain.onmessage = (ev) => handleMsg(ev?.data, true); } catch (_) {}
  try { if (bcLegacy) bcLegacy.onmessage = (ev) => handleMsg(ev?.data, false); } catch (_) {}

  window.addEventListener("storage", (e) => {
    const k = String(e.key || "");
    if (!k) return;

    if (k === PTS_CFG_KEY || k === PTS_CFG_KEY_BASE) {
      const c = safeJson(lsGet(k), null);
      if (c) { cfg = normalizeCfg(c); renderOverlay(); syncControlUI(); }
      return;
    }

    if (k === PTS_STATE_KEY || k === PTS_STATE_KEY_BASE) {
      const s = safeJson(lsGet(k), null);
      if (s) { state = normalizeState(s); renderOverlay(); syncControlUI(); }
      return;
    }
  });

  // ───────────────────────── Public API
  g.RLCPoints = {
    version: VERSION,
    getCfg: () => normalizeCfg(cfg),
    getState: () => normalizeState(state),

    setCfg: (partial) => { cfg = publishCfg(Object.assign({}, cfg, partial || {})); renderOverlay(); syncControlUI(); return cfg; },
    setState: (partial) => { state = publishState(Object.assign({}, state, partial || {}, { updatedAt: Date.now() })); renderOverlay(); syncControlUI(); return state; },

    setValue: (v) => {
      const next = Math.max(0, (parseInt(String(v ?? "0"), 10) || 0));
      state = publishState({ ...state, value: next, updatedAt: Date.now() });
      renderOverlay(); syncControlUI();
      return state;
    },
    add: (delta) => {
      const d = (parseInt(String(delta ?? "0"), 10) || 0);
      const next = Math.max(0, (state.value | 0) + d);
      state = publishState({ ...state, value: next, updatedAt: Date.now() });
      renderOverlay(); syncControlUI();
      return state;
    },
    reset: () => resetAll(),
    clearStorage: () => { lsDel(PTS_CFG_KEY); lsDel(PTS_CFG_KEY_BASE); lsDel(PTS_STATE_KEY); lsDel(PTS_STATE_KEY_BASE); }
  };

  // ───────────────────────── Boot
  (function boot() {
    // overlay-only para OBS
    if (P.overlay && P.overlayOnly) {
      try {
        document.documentElement.classList.add("rlcPtsOnly");
        document.body.classList.add("rlcPtsOnly");
        document.documentElement.style.background = "transparent";
        document.body.style.background = "transparent";
      } catch (_) {}
    }

    cfg = loadCfg();
    state = loadState();

    const hadCfg = !!lsGet(PTS_CFG_KEY) || !!lsGet(PTS_CFG_KEY_BASE);
    const hadSt  = !!lsGet(PTS_STATE_KEY) || !!lsGet(PTS_STATE_KEY_BASE);

    // si es primera vez, publica para sincronizar todas las pestañas
    if (!hadCfg) cfg = publishCfg(cfg);
    if (!hadSt) {
      state.updatedAt = Date.now();
      state = publishState(state);
    }

    bindControl();
    renderOverlay();
    syncControlUI();
  })();
})();
