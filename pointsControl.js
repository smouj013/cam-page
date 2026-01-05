/* pointsControl.js — RLC Points v2.3.9 (HARDENED + TICKET THEME)
   ✅ 2.3.9 COMPAT (sin romper 2.3.8):
      - KEY auto: window.RLC_KEY / ?key= / localStorage rlc_last_key_v1
      - BUS auto: window.RLC_BUS / window.RLC_BUS_BASE / rlc_bus_v1:{key}
      - Legacy bridge breve al arrancar (keyless grace)
      - postMessage same-origin (cfg/state) por si BC/storage fallan
   ✅ Control card auto-inject: RE-QUERY refs tras inyectar (fix null refs)
   ✅ Drag: guarda offsets sin “doble sumar” --ui-top-offset / extras (evita drift)
   ✅ Anti-solape: incluye IDs reales (#voteBox, #rlcChatRoot, #rlcAlerts…)
   ✅ Copy URL: genera overlay en index.html (no en control.html)
   ✅ ptsOnly: funciona también en index.html (overlay transparente para OBS)
   ✅ UI “Billetes/Pases de embarque” (🎫✈️) para tu sistema de cams:
      - “Billetes” = puntos del canal
      - Úsalos para votar / saltar de cámara / perks de subs (texto hint)
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const VERSION = "2.3.9";
  const INST_KEY = "__RLC_POINTS_INSTANCE__";
  const LOAD_GUARD = "__RLC_POINTS_LOADED_V239";

  // Singleton/destroy (evita dobles timers si actualizas scripts)
  try {
    const prev = g[INST_KEY];
    if (prev && prev.__ver === VERSION) return;
    if (prev && typeof prev.destroy === "function") prev.destroy();
  } catch (_) {}

  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  // ───────────────────────── helpers
  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));
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

  function onReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else fn();
  }

  function parseParams() {
    const u = new URL(location.href);

    const overlay = parseBool(
      u.searchParams.get("pts") ??
      u.searchParams.get("points") ??
      u.searchParams.get("pointsOverlay"),
      false
    );

    const edit = parseBool(u.searchParams.get("ptsEdit") ?? u.searchParams.get("ptsDrag"), false);
    const avoid = parseBool(u.searchParams.get("ptsAvoid"), true);

    return {
      key: safeStr(u.searchParams.get("key") || ""),

      overlay,
      overlayOnly: overlay ? parseBool(u.searchParams.get("ptsOnly"), true) : false,

      // defaults opcionales
      name: safeStr(u.searchParams.get("ptsName") || u.searchParams.get("pointsName") || ""),
      icon: safeStr(u.searchParams.get("ptsIcon") || u.searchParams.get("pointsIcon") || ""),
      hint: safeStr(u.searchParams.get("ptsHint") || u.searchParams.get("pointsHint") || ""),

      goal: num(u.searchParams.get("ptsGoal") ?? u.searchParams.get("pointsGoal"), NaN),
      value: num(u.searchParams.get("ptsValue") ?? u.searchParams.get("pointsValue"), NaN),

      showGoal: parseBool(u.searchParams.get("ptsShowGoal"), true),
      showDelta: parseBool(u.searchParams.get("ptsShowDelta"), true),

      pos: safeStr(u.searchParams.get("ptsPos") || ""), // tl,tr,bl,br
      scale: clamp(num(u.searchParams.get("ptsScale"), 1), 0.6, 1.8),

      // pos libre
      x: clamp(num(u.searchParams.get("ptsX"), 12), 0, 360),
      y: clamp(num(u.searchParams.get("ptsY"), 12), 0, 360),

      avoid,
      edit,
    };
  }

  const P = parseParams();

  // KEY auto (2.3.8/2.3.9)
  const KEY = (() => {
    const k1 = safeStr(g.RLC_KEY || "");
    if (k1) return k1;

    const k2 = safeStr(P.key || "");
    if (k2) return k2;

    const k3 = safeStr(lsGet("rlc_last_key_v1") || "");
    return k3 || "";
  })();

  // ───────────────────────── BUS + keys (compat RLC 2.3.9)
  const BUS_BASE_FALLBACK = "rlc_bus_v1";
  const BUS_BASE = safeStr(g.RLC_BUS_BASE || "") || BUS_BASE_FALLBACK;

  const BUS = (() => {
    const b = safeStr(g.RLC_BUS || "");
    if (b) return b;
    return KEY ? `${BUS_BASE}:${KEY}` : BUS_BASE;
  })();

  const BUS_LEGACY = BUS_BASE;

  const PTS_STATE_KEY_BASE = "rlc_points_state_v1";
  const PTS_CFG_KEY_BASE = "rlc_points_cfg_v1";

  const PTS_STATE_KEY = KEY ? `${PTS_STATE_KEY_BASE}:${KEY}` : PTS_STATE_KEY_BASE;
  const PTS_CFG_KEY = KEY ? `${PTS_CFG_KEY_BASE}:${KEY}` : PTS_CFG_KEY_BASE;

  const bcMain = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS) : null;
  const bcLegacy = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_LEGACY) : null;

  // compat keyless unos segundos
  let allowLegacyNoKey = true;
  const allowLegacyNoKeyUntil = Date.now() + 6500;

  function keyOk(msg, transportTag) {
    if (!KEY) return true;

    // key explícita siempre manda
    const mk = msg && typeof msg.key === "string" ? String(msg.key).trim() : "";
    if (mk) return mk === KEY;

    // si viene por bcMain y el canal es keyed, aceptamos y cerramos grace
    if (transportTag === "bcMain" && String(BUS).includes(`:${KEY}`)) {
      allowLegacyNoKey = false;
      return true;
    }

    // grace window
    if (!allowLegacyNoKey) return false;
    if (Date.now() > allowLegacyNoKeyUntil) return false;
    return true;
  }

  function busPost(msg) {
    try { if (bcMain) bcMain.postMessage(msg); } catch (_) {}
    try { if (bcLegacy) bcLegacy.postMessage(msg); } catch (_) {}
    // postMessage same-origin (fallback extra)
    try { window.postMessage(msg, location.origin); } catch (_) {}
  }

  // ───────────────────────── defaults + normalize
  const CFG_DEFAULTS = {
    enabled: true,
    showGoal: true,
    showDelta: true,

    pos: "tl",
    scale: 1,

    // ✅ Tema “ticket / boarding pass”
    name: "Billetes",
    icon: "🎫✈️",
    hint: "VOTA · CAMBIO CAM · PERKS SUB",

    theme: "ticket",

    // pos libre
    x: 12,
    y: 12,

    avoid: true,
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
    if (!["tl", "tr", "bl", "br"].includes(c.pos)) c.pos = "tl";

    c.scale = clamp(num(c.scale, 1), 0.6, 1.8);

    c.name = String(c.name || CFG_DEFAULTS.name).trim().slice(0, 24) || CFG_DEFAULTS.name;
    c.icon = String(c.icon || CFG_DEFAULTS.icon).trim().slice(0, 8) || CFG_DEFAULTS.icon;
    c.hint = String(c.hint || CFG_DEFAULTS.hint).trim().slice(0, 48) || CFG_DEFAULTS.hint;

    c.theme = String(c.theme || "ticket").trim().toLowerCase() || "ticket";

    c.x = clamp(num(c.x, CFG_DEFAULTS.x), 0, 360);
    c.y = clamp(num(c.y, CFG_DEFAULTS.y), 0, 360);
    c.avoid = (c.avoid !== false);

    return c;
  }

  function normalizeState(inSt) {
    const s = Object.assign({}, STATE_DEFAULTS, (inSt || {}));
    s.value = Math.max(0, (num(s.value, 0) | 0));
    s.goal = Math.max(0, (num(s.goal, 0) | 0));
    s.updatedAt = Math.max(0, (num(s.updatedAt, 0) | 0));
    return s;
  }

  function loadCfg() {
    const a = safeJson(lsGet(PTS_CFG_KEY), null);
    if (a && typeof a === "object") return normalizeCfg(a);

    const b = safeJson(lsGet(PTS_CFG_KEY_BASE), null);
    if (b && typeof b === "object") return normalizeCfg(b);

    // fallback: defaults + URL overrides
    const c = normalizeCfg(CFG_DEFAULTS);
    if (P.name) c.name = P.name;
    if (P.icon) c.icon = P.icon;
    if (P.hint) c.hint = P.hint;

    if (P.pos) c.pos = P.pos.toLowerCase();
    if (Number.isFinite(P.scale)) c.scale = P.scale;

    c.showGoal = !!P.showGoal;
    c.showDelta = !!P.showDelta;

    if (Number.isFinite(P.x)) c.x = P.x;
    if (Number.isFinite(P.y)) c.y = P.y;
    c.avoid = !!P.avoid;

    return normalizeCfg(c);
  }

  function saveCfg(cfg) {
    const c = normalizeCfg(cfg);
    const raw = JSON.stringify(c);
    lsSet(PTS_CFG_KEY, raw);
    lsSet(PTS_CFG_KEY_BASE, raw); // legacy mirror
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
    lsSet(PTS_STATE_KEY_BASE, raw); // legacy mirror
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

  // ───────────────────────── Page detect
  function isLikelyControlPage() {
    if (document.body?.classList?.contains("mode-control")) return true;
    if (qs(".controlWrap") || qs(".controlGrid") || qs("main.controlWrap")) return true;
    if (qs("#ctlStatus") || qs(".controlHeader")) return true;
    return false;
  }

  function isLikelyPlayerPage() {
    if (document.body?.classList?.contains("mode-player")) return true;
    if (qs("#stage") || qs("#hud") || qs("#frame") || qs("#video")) return true;
    return false;
  }

  const IS_CONTROL_PAGE = isLikelyControlPage();
  const IS_PLAYER_PAGE = isLikelyPlayerPage();

  // ───────────────────────── Control panel auto-inject
  function injectControlCardStylesOnce() {
    if (qs("#rlcPtsControlStyles")) return;
    const st = document.createElement("style");
    st.id = "rlcPtsControlStyles";
    st.textContent = `
/* scoped ONLY to the POINTS card */
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
#ctlPtsCard .rlcPtsMini{opacity:.75;font-size:12px;line-height:1.35;margin-top:8px}
#ctlPtsCard .rlcPtsMini .mono{opacity:.92}
`.trim();
    document.head.appendChild(st);
  }

  function ensureControlCard() {
    if (!IS_CONTROL_PAGE) return false;

    // si ya existe UI de puntos de otra versión, no duplicar
    if (qs("#ctlPtsApply") || qs("#ctlPointsApply") || qs("#ctlPtsValue") || qs("#ctlPtsName")) return true;

    const grid = qs(".controlGrid") || qs("section.controlGrid") || qs("#controlGrid") || null;
    if (!grid) return false;
    if (qs("#ctlPtsCard")) return true;

    injectControlCardStylesOnce();

    const card = document.createElement("div");
    card.className = "card";
    card.id = "ctlPtsCard";

    card.innerHTML = `
      <div class="rlcPtsHead">
        <div class="rlcPtsTitle">
          <div class="rlcPtsKicker">🎫✈️ OVERLAY</div>
          <div class="rlcPtsNameBig">BILLETES / PASES</div>
        </div>
        <div class="pill mono" id="ctlPtsStatus">—</div>
      </div>

      <div class="rlcPtsGrid">
        <label class="rlcFld">
          <span>Enabled</span>
          <select id="ctlPtsOn" class="select">
            <option value="on">ON</option>
            <option value="off">OFF</option>
          </select>
        </label>

        <label class="rlcFld">
          <span>Position</span>
          <select id="ctlPtsPos" class="select">
            <option value="tl">Top-Left</option>
            <option value="tr">Top-Right</option>
            <option value="bl">Bottom-Left</option>
            <option value="br">Bottom-Right</option>
          </select>
        </label>

        <label class="rlcFld">
          <span>Name</span>
          <input id="ctlPtsName" class="input" type="text" placeholder="Billetes" maxlength="24" />
        </label>

        <label class="rlcFld">
          <span>Icon</span>
          <input id="ctlPtsIcon" class="input" type="text" placeholder="🎫✈️" maxlength="8" />
        </label>

        <label class="rlcFld" style="grid-column:1/-1">
          <span>Hint (uso)</span>
          <input id="ctlPtsHint" class="input" type="text" placeholder="VOTA · CAMBIO CAM · PERKS SUB" maxlength="48" />
        </label>

        <label class="rlcFld">
          <span>Value</span>
          <input id="ctlPtsValue" class="input" type="number" min="0" step="1" />
        </label>

        <label class="rlcFld">
          <span>Goal</span>
          <input id="ctlPtsGoal" class="input" type="number" min="0" step="1" />
        </label>

        <label class="rlcFld">
          <span>Show goal bar</span>
          <select id="ctlPtsShowGoal" class="select">
            <option value="on">ON</option>
            <option value="off">OFF</option>
          </select>
        </label>

        <label class="rlcFld">
          <span>Show delta pop</span>
          <select id="ctlPtsShowDelta" class="select">
            <option value="on">ON</option>
            <option value="off">OFF</option>
          </select>
        </label>

        <label class="rlcFld">
          <span>Scale</span>
          <input id="ctlPtsScale" class="input" type="number" min="0.6" max="1.8" step="0.05" />
        </label>

        <label class="rlcFld">
          <span>Delta step</span>
          <input id="ctlPtsDelta" class="input" type="number" min="1" step="1" value="10" />
        </label>
      </div>

      <div class="rlcPtsBtns">
        <button id="ctlPtsSub" class="btn ghost" type="button">− Restar</button>
        <button id="ctlPtsAdd" class="btn ghost" type="button">+ Sumar</button>
        <button id="ctlPtsApply" class="btn" type="button">Aplicar</button>
        <button id="ctlPtsReset" class="btn ghost" type="button">Reset</button>
        <button id="ctlPtsCopyUrl" class="btn ghost" type="button">Copiar URL overlay (OBS)</button>
      </div>

      <div class="rlcPtsMini">
        🖱️ Para recolocar en player: <b>ALT</b> + arrastra el panel.<br/>
        (o añade <span class="mono">?ptsEdit=1</span> para modo edición permanente).
      </div>
    `.trim();

    grid.appendChild(card);
    return true;
  }

  // ───────────────────────── Overlay mode
  const overlayWanted =
    IS_PLAYER_PAGE ||
    !!P.overlay ||
    !!document.getElementById("rlcPtsRoot");

  // ✅ ptsOnly también puede aplicarse en player (para OBS)
  const overlayOnlyMode = !!(P.overlay && P.overlayOnly);

  // ───────────────────────── Overlay UI
  const OVERLAY_ROOT_ID = "rlcPtsRoot";

  let cfg = loadCfg();
  let state = loadState();

  function injectOverlayStylesOnce() {
    if (document.getElementById("rlcPtsStyles")) return;
    const st = document.createElement("style");
    st.id = "rlcPtsStyles";
    st.textContent = `
:root{
  --rlcPtsScale:1;
  --rlcPtsX:12px;
  --rlcPtsY:12px;
  --rlcPtsTopExtra:0px;
  --rlcPtsBottomExtra:0px;

  /* hereda Neo-Atlas si existe */
  --rlcPts_panel: var(--panel, rgba(10,14,20,.62));
  --rlcPts_panel2: var(--panel2, rgba(10,14,20,.76));
  --rlcPts_stroke: var(--stroke, rgba(255,255,255,.12));
  --rlcPts_text: var(--text, rgba(255,255,255,.92));
  --rlcPts_muted: var(--muted, rgba(255,255,255,.70));
  --rlcPts_acc: var(--acc, #37d6ff);
  --rlcPts_ok: var(--ok, #19e28a);
  --rlcPts_bad: var(--bad, #ff5a5a);
  --rlcPts_gold: #ffce57;
}

.rlcPtsRoot{
  position:fixed;
  z-index:10060;
  pointer-events:none;
  transform:translateZ(0) scale(var(--rlcPtsScale));
  contain:layout paint style;
}
.rlcPtsRoot.edit{ pointer-events:auto; }
.rlcPtsRoot.edit .rlcPtsCard{
  outline:2px solid rgba(55,214,255,.22);
  box-shadow: 0 18px 55px rgba(0,0,0,.48), 0 0 0 2px rgba(55,214,255,.10) inset;
  cursor:grab;
  touch-action:none;
}
.rlcPtsRoot.edit .rlcPtsCard:active{cursor:grabbing}

.rlcPtsRoot.pos-tl{
  left:max(var(--rlcPtsX),env(safe-area-inset-left));
  top:calc(max(var(--rlcPtsY),env(safe-area-inset-top)) + var(--ui-top-offset,0px) + var(--rlcPtsTopExtra,0px));
  transform-origin:top left
}
.rlcPtsRoot.pos-tr{
  right:max(var(--rlcPtsX),env(safe-area-inset-right));
  top:calc(max(var(--rlcPtsY),env(safe-area-inset-top)) + var(--ui-top-offset,0px) + var(--rlcPtsTopExtra,0px));
  transform-origin:top right
}
.rlcPtsRoot.pos-bl{
  left:max(var(--rlcPtsX),env(safe-area-inset-left));
  bottom:calc(max(var(--rlcPtsY),env(safe-area-inset-bottom)) + var(--rlcPtsBottomExtra,0px));
  transform-origin:bottom left
}
.rlcPtsRoot.pos-br{
  right:max(var(--rlcPtsX),env(safe-area-inset-right));
  bottom:calc(max(var(--rlcPtsY),env(safe-area-inset-bottom)) + var(--rlcPtsBottomExtra,0px));
  transform-origin:bottom right
}

/* ───── Ticket card */
.rlcPtsCard{
  min-width:260px;
  max-width:min(480px,calc(100vw - 24px));
  padding:12px 14px;
  border-radius:18px;
  background:
    linear-gradient(180deg, var(--rlcPts_panel), var(--rlcPts_panel2));
  border:1px solid var(--rlcPts_stroke);
  box-shadow: 0 18px 55px rgba(0,0,0,.48), 0 1px 0 rgba(255,255,255,.06) inset;
  backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px);
  overflow:hidden;
  position:relative;
}

/* brillo “boarding pass” */
.rlcPtsCard::before{
  content:"";
  position:absolute; inset:-2px;
  background:
    radial-gradient(520px 160px at 12% 0%, rgba(55,214,255,.18), transparent 62%),
    radial-gradient(560px 160px at 100% 0%, rgba(255,206,87,.12), transparent 62%),
    radial-gradient(420px 140px at 35% 120%, rgba(25,226,138,.08), transparent 60%);
  pointer-events:none;
}

/* perforación (look ticket) */
.rlcPtsPunch{
  position:absolute;
  top:50%;
  width:14px;height:14px;
  border-radius:999px;
  background:rgba(0,0,0,.35);
  border:1px solid rgba(255,255,255,.10);
  transform:translateY(-50%);
  filter:blur(.1px);
  pointer-events:none;
}
.rlcPtsPunch.left{ left:-7px; }
.rlcPtsPunch.right{ right:-7px; }

.rlcPtsDash{
  position:absolute;
  left:46px; right:14px;
  top:54px;
  height:0;
  border-top:1px dashed rgba(255,255,255,.18);
  opacity:.8;
  pointer-events:none;
}

.rlcPtsTop{ position:relative; display:flex; align-items:center; gap:10px; }
.rlcPtsIcon{
  width:38px;height:38px;border-radius:14px;
  display:grid;place-items:center;
  font-size:18px;
  background:rgba(55,214,255,.14);
  border:1px solid rgba(255,255,255,.12);
  box-shadow:0 10px 26px rgba(0,0,0,.22), 0 0 0 1px rgba(55,214,255,.10) inset;
}
.rlcPtsMeta{min-width:0;flex:1 1 auto}
.rlcPtsNameRow{
  display:flex;align-items:center;justify-content:space-between;gap:10px;
}
.rlcPtsName{
  font-weight:950;
  font-size:11px;
  letter-spacing:.18em;
  color:var(--rlcPts_muted);
  text-transform:uppercase;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.rlcPtsStamp{
  font: 950 10px/1 ui-sans-serif,system-ui;
  letter-spacing:.22em;
  opacity:.85;
  color: rgba(255,255,255,.75);
  border:1px solid rgba(255,255,255,.12);
  padding:4px 8px;
  border-radius:999px;
  background:rgba(255,255,255,.06);
  white-space:nowrap;
}

.rlcPtsVal{
  margin-top:4px;
  font-weight:980;
  font-size:24px;
  line-height:1.05;
  color:var(--rlcPts_text);
  display:flex;align-items:baseline;gap:8px
}

.rlcPtsDelta{
  font-weight:950;
  font-size:12px;
  padding:4px 9px;
  border-radius:999px;
  border:1px solid rgba(255,255,255,.12);
  background:rgba(255,255,255,.08);
  color:rgba(255,255,255,.92);
  opacity:0;
  transform:translateY(6px);
  transition:opacity .18s ease, transform .18s ease;
}
.rlcPtsDelta.on{opacity:1;transform:translateY(0)}
.rlcPtsDelta.plus{background:rgba(25,226,138,.14);border-color:rgba(25,226,138,.22)}
.rlcPtsDelta.minus{background:rgba(255,90,90,.14);border-color:rgba(255,90,90,.22)}

.rlcPtsHint{
  margin-top:8px;
  font: 900 10px/1 ui-sans-serif,system-ui;
  letter-spacing:.20em;
  color: rgba(255,255,255,.65);
  text-transform:uppercase;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

.rlcPtsBar{
  position:relative;
  margin-top:10px;
  height:8px;
  border-radius:999px;
  background:rgba(255,255,255,.10);
  overflow:hidden;
}
.rlcPtsBar::after{
  content:"";
  position:absolute; inset:0;
  background:linear-gradient(90deg, rgba(255,255,255,.06), transparent 40%, rgba(255,255,255,.06));
  opacity:.65;
  pointer-events:none;
}
.rlcPtsBar>i{
  display:block;
  height:100%;
  width:0%;
  border-radius:999px;
  background:linear-gradient(90deg, rgba(55,214,255,.92), rgba(255,206,87,.92));
  box-shadow:0 0 18px rgba(55,214,255,.22);
  transition:width .22s ease;
}

.rlcPtsGoalRow{
  margin-top:6px;
  display:flex;
  justify-content:space-between;
  gap:10px;
  font-size:11.5px;
  color:var(--rlcPts_muted);
}
.rlcPtsGoalRow b{color:var(--rlcPts_text);font-weight:950}

.rlcPtsRoot.off{display:none!important}

/* overlay-only transparente (OBS) */
body.rlcPtsOnly, html.rlcPtsOnly{ background:transparent!important; }
body.rlcPtsOnly #stage,
body.rlcPtsOnly .stage,
body.rlcPtsOnly .layer,
body.rlcPtsOnly #rlcNewsTicker,
body.rlcPtsOnly #rlcEconTicker,
body.rlcPtsOnly #fallback,
body.rlcPtsOnly #rlcDiag,
body.rlcPtsOnly .controlWrap{ display:none!important; }

@media (prefers-reduced-motion: reduce){
  .rlcPtsDelta, .rlcPtsBar>i{transition:none!important}
}
`.trim();
    document.head.appendChild(st);
  }

  let elRoot = null, elIcon = null, elName = null, elStamp = null, elHint = null;
  let elVal = null, elDelta = null, elBar = null, elGoalL = null, elGoalR = null;
  let lastRenderValue = null;
  let deltaTimer = null;

  let editHeld = false;
  const editPersistent = !!P.edit;

  function setEditMode(on) {
    if (!elRoot) return;
    elRoot.classList.toggle("edit", !!on);
  }

  function applyPosVars(x, y) {
    try {
      document.documentElement.style.setProperty("--rlcPtsX", `${clamp(+x || 0, 0, 800)}px`);
      document.documentElement.style.setProperty("--rlcPtsY", `${clamp(+y || 0, 0, 800)}px`);
    } catch (_) {}
  }
  function applyExtraVars(topExtra, bottomExtra) {
    try {
      document.documentElement.style.setProperty("--rlcPtsTopExtra", `${Math.max(0, +topExtra || 0)}px`);
      document.documentElement.style.setProperty("--rlcPtsBottomExtra", `${Math.max(0, +bottomExtra || 0)}px`);
    } catch (_) {}
  }
  function readCssPx(varName) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
      const n = parseFloat(v.replace("px", "").trim());
      return Number.isFinite(n) ? n : 0;
    } catch (_) { return 0; }
  }

  function ensureOverlayUI() {
    if (!overlayWanted) return false;
    injectOverlayStylesOnce();

    elRoot = document.getElementById(OVERLAY_ROOT_ID);
    if (!elRoot) {
      elRoot = document.createElement("div");
      elRoot.id = OVERLAY_ROOT_ID;
      elRoot.className = "rlcPtsRoot pos-tl";
      elRoot.setAttribute("aria-hidden", "true");
      elRoot.innerHTML =
        '<div class="rlcPtsCard" id="rlcPtsCard">' +
          '<i class="rlcPtsPunch left"></i><i class="rlcPtsPunch right"></i>' +
          '<i class="rlcPtsDash"></i>' +
          '<div class="rlcPtsTop">' +
            '<div class="rlcPtsIcon" id="rlcPtsIcon">🎫✈️</div>' +
            '<div class="rlcPtsMeta">' +
              '<div class="rlcPtsNameRow">' +
                '<div class="rlcPtsName" id="rlcPtsName">BILLETES</div>' +
                '<div class="rlcPtsStamp" id="rlcPtsStamp">GLOBAL</div>' +
              '</div>' +
              '<div class="rlcPtsVal"><span id="rlcPtsVal">0</span><span class="rlcPtsDelta" id="rlcPtsDelta">+1</span></div>' +
              '<div class="rlcPtsHint" id="rlcPtsHint">VOTA · CAMBIO CAM · PERKS SUB</div>' +
            '</div>' +
          '</div>' +
          '<div class="rlcPtsBar" id="rlcPtsBarWrap"><i id="rlcPtsBarFill"></i></div>' +
          '<div class="rlcPtsGoalRow" id="rlcPtsGoalRow"><span id="rlcPtsGoalL">0</span><span id="rlcPtsGoalR">Meta 0</span></div>' +
        '</div>';

      document.body.appendChild(elRoot);
    }

    elIcon = qs("#rlcPtsIcon");
    elName = qs("#rlcPtsName");
    elStamp = qs("#rlcPtsStamp");
    elHint = qs("#rlcPtsHint");

    elVal = qs("#rlcPtsVal");
    elDelta = qs("#rlcPtsDelta");
    elBar = qs("#rlcPtsBarFill");
    elGoalL = qs("#rlcPtsGoalL");
    elGoalR = qs("#rlcPtsGoalR");

    setEditMode(editPersistent || editHeld);
    return true;
  }

  function setOverlayPos(pos) {
    if (!elRoot) return;
    const p = String(pos || "tl").toLowerCase();
    elRoot.classList.remove("pos-tl", "pos-tr", "pos-bl", "pos-br");
    elRoot.classList.add(`pos-${["tl", "tr", "bl", "br"].includes(p) ? p : "tl"}`);
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
      elDelta.classList.remove("plus", "minus", "on");
      elDelta.classList.add(x > 0 ? "plus" : "minus");
      void elDelta.offsetWidth;
      elDelta.classList.add("on");
    } catch (_) {}

    try { if (deltaTimer) clearTimeout(deltaTimer); } catch (_) {}
    deltaTimer = setTimeout(() => {
      try { elDelta.classList.remove("on", "plus", "minus"); } catch (_) {}
    }, 1500);
  }

  // ───────────────────────── Anti-solape (IDs reales + best effort)
  const AVOID_SELECTORS = [
    "#rlcAlerts", "#alerts", "#alertsOverlay", "#rlcAlertStack", ".rlcAlerts", ".alertsOverlay", ".alerts",
    "#rlcToastWrap", ".rlcToastWrap", ".rlcToast", ".toast",

    "#voteOverlay", "#rlcVoteOverlay", "#rlcVote", ".voteOverlay", "#voteBox",

    "#chatOverlay", "#rlcChatOverlay", "#rlcChat", ".chatOverlay",
    "#rlcChatRoot", "#rlcChatList", "#chatRoot", "#chatList",

    "#hud", ".hud", "#rlcHud",
  ];
  const EXCLUDE_SELECTORS = ["#rlcNewsTicker", "#rlcEconTicker", "#rlcPtsRoot"];

  function isVisibleEl(el) {
    try {
      if (!el) return false;
      const st = getComputedStyle(el);
      if (!st || st.display === "none" || st.visibility === "hidden" || +st.opacity === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 4 && r.height > 4;
    } catch (_) { return false; }
  }

  function rectsOverlap(a, b, pad = 6) {
    const ax1 = a.left - pad, ay1 = a.top - pad, ax2 = a.right + pad, ay2 = a.bottom + pad;
    const bx1 = b.left, by1 = b.top, bx2 = b.right, by2 = b.bottom;
    return (ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1);
  }

  let avoidRAF = null;
  let dragging = false;

  function scheduleAvoidUpdate() {
    if (!cfg?.avoid) return;
    if (!IS_PLAYER_PAGE) return;
    if (!elRoot) return;
    if (dragging) return;
    if (avoidRAF) return;

    avoidRAF = requestAnimationFrame(() => {
      avoidRAF = null;
      try { applyAvoidanceNow(); } catch (_) {}
    });
  }

  function applyAvoidanceNow() {
    if (!cfg?.avoid || !elRoot) return;
    if (elRoot.classList.contains("off")) return;

    applyExtraVars(0, 0);

    const ptsRect = elRoot.getBoundingClientRect();
    const pos = String(cfg.pos || "tl");
    const isTop = (pos === "tl" || pos === "tr");
    const isLeft = (pos === "tl" || pos === "bl");

    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    const midX = vw / 2;
    const midY = vh / 2;

    const set = new Set();
    for (const sel of AVOID_SELECTORS) for (const el of qsa(sel)) set.add(el);
    for (const sel of EXCLUDE_SELECTORS) for (const el of qsa(sel)) set.delete(el);
    set.delete(elRoot);

    let topExtra = 0;
    let bottomExtra = 0;

    for (const el of set) {
      if (!isVisibleEl(el)) continue;

      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;

      const candLeft = cx < midX;
      const candTop = cy < midY;

      if (isLeft !== candLeft) continue;
      if (isTop !== candTop) continue;

      if (!rectsOverlap(ptsRect, r, 8)) continue;

      if (isTop) {
        const overlap = (r.bottom - ptsRect.top) + 10;
        topExtra = Math.max(topExtra, overlap);
      } else {
        const overlap = (ptsRect.bottom - r.top) + 10;
        bottomExtra = Math.max(bottomExtra, overlap);
      }
    }

    applyExtraVars(topExtra, bottomExtra);
  }

  let avoidTimer = null;
  function startAvoidLoop() {
    if (!IS_PLAYER_PAGE) return;
    if (avoidTimer) return;
    avoidTimer = setInterval(() => { try { scheduleAvoidUpdate(); } catch (_) {} }, 450);
  }

  // ───────────────────────── Drag & Drop (ALT o ptsEdit=1) (FIX drift)
  function pickCornerFromRect(r) {
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const left = cx < vw / 2;
    const top = cy < vh / 2;
    return (top ? (left ? "tl" : "tr") : (left ? "bl" : "br"));
  }

  function computeOffsetsForCorner(corner, r) {
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;

    const uiTop = readCssPx("--ui-top-offset");
    const topExtra = readCssPx("--rlcPtsTopExtra");
    const bottomExtra = readCssPx("--rlcPtsBottomExtra");

    const x = (corner === "tl" || corner === "bl") ? r.left : (vw - r.right);

    // ✅ TOP: quita uiTop + topExtra para no “doble sumar” al persistir
    const y = (corner === "tl" || corner === "tr")
      ? Math.max(0, r.top - uiTop - topExtra)
      : Math.max(0, (vh - r.bottom) - bottomExtra);

    return { x: clamp(x, 0, 800), y: clamp(y, 0, 800) };
  }

  function bindDrag() {
    if (!IS_PLAYER_PAGE) return;
    const card = qs("#rlcPtsCard");
    if (!card || !elRoot) return;

    let pid = null;
    let startX = 0, startY = 0;
    let baseX = cfg.x || 12, baseY = cfg.y || 12;

    const canDragNow = () => editPersistent || editHeld;

    const onDown = (e) => {
      if (!canDragNow()) return;
      if (!e) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;

      try { e.preventDefault(); e.stopPropagation(); } catch (_) {}

      dragging = true;

      // evita jitter durante drag
      applyExtraVars(0, 0);
      void elRoot.offsetWidth;

      pid = e.pointerId;
      try { card.setPointerCapture(pid); } catch (_) {}

      const r1 = elRoot.getBoundingClientRect();
      const corner = pickCornerFromRect(r1);

      if (corner !== cfg.pos) {
        cfg = normalizeCfg({ ...cfg, pos: corner });
        setOverlayPos(cfg.pos);
        void elRoot.offsetWidth;
      }

      const r2 = elRoot.getBoundingClientRect();
      const off = computeOffsetsForCorner(cfg.pos, r2);
      baseX = off.x;
      baseY = off.y;

      startX = e.clientX;
      startY = e.clientY;
    };

    const onMove = (e) => {
      if (!dragging) return;
      if (pid != null && e.pointerId !== pid) return;

      try { e.preventDefault(); e.stopPropagation(); } catch (_) {}

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      let nextX = baseX + ((cfg.pos === "tl" || cfg.pos === "bl") ? dx : -dx);
      let nextY = baseY + ((cfg.pos === "tl" || cfg.pos === "tr") ? dy : -dy);

      nextX = clamp(nextX, 0, 800);
      nextY = clamp(nextY, 0, 800);

      applyPosVars(nextX, nextY);
      cfg = normalizeCfg({ ...cfg, x: nextX, y: nextY });
    };

    const onUp = (e) => {
      if (!dragging) return;
      if (pid != null && e.pointerId !== pid) return;

      dragging = false;
      pid = null;

      cfg = publishCfg(cfg);
      scheduleAvoidUpdate();
    };

    try { card.addEventListener("pointerdown", onDown, { passive: false }); } catch (_) {}
    try { window.addEventListener("pointermove", onMove, { passive: false }); } catch (_) {}
    try { window.addEventListener("pointerup", onUp, { passive: true }); } catch (_) {}
    try { window.addEventListener("pointercancel", onUp, { passive: true }); } catch (_) {}
  }

  function renderOverlay() {
    if (!overlayWanted) return;
    if (!ensureOverlayUI()) return;

    const on = !!cfg.enabled;
    elRoot.classList.toggle("off", !on);
    if (!on) return;

    setOverlayPos(cfg.pos);
    setOverlayScale(cfg.scale);

    applyPosVars(cfg.x ?? 12, cfg.y ?? 12);

    if (elIcon) elIcon.textContent = cfg.icon || "🎫✈️";
    if (elName) elName.textContent = String(cfg.name || "Billetes").toUpperCase();

    // stamp: si hay key, marca “KEYED”; si no, “GLOBAL”
    if (elStamp) elStamp.textContent = KEY ? "KEYED" : "GLOBAL";

    if (elHint) elHint.textContent = String(cfg.hint || CFG_DEFAULTS.hint).toUpperCase();

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
      if (elGoalL) elGoalL.innerHTML = `<b>${fmtK(v)}</b>`;
      if (elGoalR) elGoalR.textContent = `Meta ${fmtK(goal)}`;
    }

    if (cfg.showDelta) {
      if (lastRenderValue == null) {
        lastRenderValue = v;
      } else {
        const d = (v - (lastRenderValue | 0)) | 0;
        if (d !== 0) showDelta(d);
        lastRenderValue = v;
      }
    } else {
      lastRenderValue = v;
    }

    scheduleAvoidUpdate();
  }

  // ───────────────────────── CONTROL UI (FIX: refs dinámicas)
  const ctl = {
    on: null, name: null, icon: null, hint: null,
    value: null, goal: null, delta: null,
    showGoal: null, showDelta: null, pos: null, scale: null,
    add: null, sub: null, apply: null, reset: null, copyUrl: null,
    status: null, url: null
  };

  function refreshCtlRefs() {
    ctl.on = qs("#ctlPtsOn") || qs("#ctlPointsOn");
    ctl.name = qs("#ctlPtsName") || qs("#ctlPointsName");
    ctl.icon = qs("#ctlPtsIcon") || qs("#ctlPointsIcon");
    ctl.hint = qs("#ctlPtsHint");

    ctl.value = qs("#ctlPtsValue") || qs("#ctlPointsValue");
    ctl.goal = qs("#ctlPtsGoal") || qs("#ctlPointsGoal");
    ctl.delta = qs("#ctlPtsDelta") || qs("#ctlPointsDelta");

    ctl.showGoal = qs("#ctlPtsShowGoal");
    ctl.showDelta = qs("#ctlPtsShowDelta");
    ctl.pos = qs("#ctlPtsPos");
    ctl.scale = qs("#ctlPtsScale");

    ctl.add = qs("#ctlPtsAdd");
    ctl.sub = qs("#ctlPtsSub");
    ctl.apply = qs("#ctlPtsApply") || qs("#ctlPointsApply");
    ctl.reset = qs("#ctlPtsReset") || qs("#ctlPointsReset");
    ctl.copyUrl = qs("#ctlPtsCopyUrl") || qs("#ctlPointsCopyUrl");

    ctl.status = qs("#ctlPtsStatus");
    ctl.url = qs("#ctlPtsUrl"); // opcional si tu HTML lo trae
  }

  function setCtlStatus(text, ok = true) {
    if (!ctl.status) return;
    ctl.status.textContent = text;
    try {
      ctl.status.classList.toggle("pill--ok", !!ok);
      ctl.status.classList.toggle("pill--bad", !ok);
    } catch (_) {}
  }

  function isEditing(el) {
    if (!el) return false;
    try { return document.activeElement === el || el.matches(":focus"); }
    catch (_) { return document.activeElement === el; }
  }

  function buildOverlayUrl() {
    const base = new URL(location.href);

    // si estás en control.html → index.html
    const p = base.pathname || "";
    if (/control\.html?$/i.test(p)) {
      base.pathname = p.replace(/control\.html?$/i, "index.html");
    } else if (/\/control$/i.test(p)) {
      base.pathname = p.replace(/\/control$/i, "/index.html");
    } else if (!/\.html$/i.test(p)) {
      // si es una ruta tipo /cam-page/ o /cam-page
      base.pathname = p.replace(/\/?$/, "/index.html");
    }

    base.search = "";

    const appV = String(g.APP_VERSION || "").trim();
    if (appV) base.searchParams.set("v", appV);

    base.searchParams.set("pts", "1");
    base.searchParams.set("ptsOnly", "1");
    if (KEY) base.searchParams.set("key", KEY);

    return base.toString();
  }

  function syncControlUI() {
    const isControl = !!(ctl.apply || ctl.value || ctl.name);
    if (!isControl) return;

    if (ctl.on && !isEditing(ctl.on)) ctl.on.value = cfg.enabled ? "on" : "off";
    if (ctl.name && !isEditing(ctl.name)) ctl.name.value = cfg.name || "";
    if (ctl.icon && !isEditing(ctl.icon)) ctl.icon.value = cfg.icon || "";
    if (ctl.hint && !isEditing(ctl.hint)) ctl.hint.value = cfg.hint || "";

    if (ctl.showGoal && !isEditing(ctl.showGoal)) ctl.showGoal.value = cfg.showGoal ? "on" : "off";
    if (ctl.showDelta && !isEditing(ctl.showDelta)) ctl.showDelta.value = cfg.showDelta ? "on" : "off";
    if (ctl.pos && !isEditing(ctl.pos)) ctl.pos.value = cfg.pos || "tl";
    if (ctl.scale && !isEditing(ctl.scale)) ctl.scale.value = String(cfg.scale ?? 1);

    if (ctl.value && !isEditing(ctl.value)) ctl.value.value = String(state.value | 0);
    if (ctl.goal && !isEditing(ctl.goal)) ctl.goal.value = String(state.goal | 0);
    if (ctl.delta && !isEditing(ctl.delta) && !ctl.delta.value) ctl.delta.value = "10";

    if (ctl.url && !isEditing(ctl.url)) ctl.url.value = buildOverlayUrl();

    setCtlStatus(cfg.enabled ? `ON · ${fmtK(state.value | 0)} · Drag: ALT` : "OFF", !!cfg.enabled);
  }

  function readControlCfg() {
    const out = Object.assign({}, cfg);
    if (ctl.on) out.enabled = (ctl.on.value !== "off");
    if (ctl.name) out.name = String(ctl.name.value || out.name || CFG_DEFAULTS.name).trim();
    if (ctl.icon) out.icon = String(ctl.icon.value || out.icon || CFG_DEFAULTS.icon).trim();
    if (ctl.hint) out.hint = String(ctl.hint.value || out.hint || CFG_DEFAULTS.hint).trim();

    if (ctl.showGoal) out.showGoal = (ctl.showGoal.value !== "off");
    if (ctl.showDelta) out.showDelta = (ctl.showDelta.value !== "off");
    if (ctl.pos) out.pos = String(ctl.pos.value || out.pos || "tl").trim().toLowerCase();
    if (ctl.scale) out.scale = clamp(num(ctl.scale.value, out.scale ?? 1), 0.6, 1.8);

    return normalizeCfg(out);
  }

  function readControlState() {
    const out = Object.assign({}, state);
    if (ctl.value) out.value = Math.max(0, (parseInt(ctl.value.value || "0", 10) || 0));
    if (ctl.goal) out.goal = Math.max(0, (parseInt(ctl.goal.value || "0", 10) || 0));
    out.updatedAt = Date.now();
    return normalizeState(out);
  }

  function applyControlAll() {
    cfg = publishCfg(readControlCfg());
    state = publishState(readControlState());
    lastRenderValue = (state.value | 0);
    renderOverlay();
    syncControlUI();
  }

  function applyDelta(sign) {
    const d = clamp(parseInt(ctl.delta?.value || "10", 10) || 10, 1, 999999);
    const cur = state.value | 0;
    const next = Math.max(0, cur + (sign > 0 ? d : -d));
    state = publishState({ ...state, value: next, updatedAt: Date.now() });
    if (ctl.value && !isEditing(ctl.value)) ctl.value.value = String(next);
    renderOverlay();
    syncControlUI();
  }

  function resetAll() {
    cfg = publishCfg(CFG_DEFAULTS);
    state = publishState({ value: 0, goal: 0, updatedAt: Date.now() });
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

  function hotkeysScopeOk(e) {
    const card = qs("#ctlPtsCard");
    if (!card) return false;
    const a = document.activeElement;
    if (a && card.contains(a)) return true;
    try { const t = e?.target; if (t && card.contains(t)) return true; } catch (_) {}
    return false;
  }

  function bindControl() {
    const isControl = !!(ctl.apply || ctl.value || ctl.name);
    if (!isControl) return;

    const doApply = () => applyControlAll();
    const doApplyDeb = debounce(doApply, 170);

    try { ctl.apply?.addEventListener?.("click", doApply); } catch (_) {}
    try { ctl.add?.addEventListener?.("click", () => applyDelta(+1)); } catch (_) {}
    try { ctl.sub?.addEventListener?.("click", () => applyDelta(-1)); } catch (_) {}
    try { ctl.reset?.addEventListener?.("click", resetAll); } catch (_) {}

    const live = [ctl.on, ctl.name, ctl.icon, ctl.hint, ctl.showGoal, ctl.showDelta, ctl.pos, ctl.scale, ctl.value, ctl.goal];
    for (const el of live) {
      if (!el) continue;
      try { el.addEventListener("change", doApply); } catch (_) {}
      try { el.addEventListener("input", doApplyDeb); } catch (_) {}
    }

    try {
      ctl.copyUrl?.addEventListener?.("click", async () => {
        const url = buildOverlayUrl();
        const ok = await copyToClipboard(url);
        try { ctl.copyUrl.textContent = ok ? "Copiado ✅" : "Error ❌"; } catch (_) {}
        setTimeout(() => { try { ctl.copyUrl.textContent = "Copiar URL overlay (OBS)"; } catch (_) {} }, 1200);
      });
    } catch (_) {}

    try {
      document.addEventListener("keydown", (e) => {
        if (isTextInputActive()) return;
        if (!hotkeysScopeOk(e)) return;

        if (e.key === "+") { e.preventDefault(); applyDelta(+1); }
        else if (e.key === "-") { e.preventDefault(); applyDelta(-1); }
        else if (String(e.key || "").toLowerCase() === "p") { e.preventDefault(); doApply(); }
      });
    } catch (_) {}

    syncControlUI();
  }

  // ───────────────────────── Receive messages (DEDUP robust: ts + firma)
  const lastSeen = {
    PTS_CFG: { ts: 0, sig: "" },
    PTS_STATE: { ts: 0, sig: "" }
  };

  function stableSig(obj) {
    try {
      // firma corta: JSON ordenado “suficiente”
      const t = obj?.type || "";
      const ts = obj?.ts || 0;
      const payload = obj?.cfg || obj?.state || obj || {};
      return `${t}|${ts}|${JSON.stringify(payload)}`;
    } catch (_) {
      return `${obj?.type || ""}|${obj?.ts || 0}|x`;
    }
  }

  function shouldAcceptMsg(msg) {
    const type = String(msg?.type || "");
    if (!type || !lastSeen[type]) return false;

    const ts = (msg?.ts | 0) || 0;
    const sig = stableSig(msg);

    const prev = lastSeen[type];
    if (!ts) return true;

    // acepta ts mayor, o ts igual con payload diferente
    if (ts > prev.ts) {
      prev.ts = ts; prev.sig = sig;
      return true;
    }
    if (ts === prev.ts && sig && sig !== prev.sig) {
      prev.sig = sig;
      return true;
    }
    return false;
  }

  function handleMsg(msg, transportTag) {
    if (!msg || typeof msg !== "object") return;
    if (!keyOk(msg, transportTag)) return;
    if (!shouldAcceptMsg(msg)) return;

    if (msg.type === "PTS_CFG" && msg.cfg) {
      cfg = normalizeCfg(msg.cfg);
      saveCfg(cfg);
      renderOverlay();
      syncControlUI();
      return;
    }

    if (msg.type === "PTS_STATE" && msg.state) {
      state = normalizeState(msg.state);
      saveState(state);
      renderOverlay();
      syncControlUI();
      return;
    }
  }

  try { if (bcMain) bcMain.onmessage = (ev) => handleMsg(ev?.data, "bcMain"); } catch (_) {}
  try { if (bcLegacy) bcLegacy.onmessage = (ev) => handleMsg(ev?.data, "bcLegacy"); } catch (_) {}

  // postMessage same-origin (fallback)
  try {
    window.addEventListener("message", (ev) => {
      try { if (ev.origin && ev.origin !== location.origin) return; } catch (_) {}
      const msg = ev?.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.type !== "PTS_CFG" && msg.type !== "PTS_STATE") return;
      handleMsg(msg, "postMessage");
    }, { passive: true });
  } catch (_) {}

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

    setCfg: (partial) => {
      cfg = publishCfg(Object.assign({}, cfg, partial || {}));
      renderOverlay(); syncControlUI();
      return cfg;
    },

    setState: (partial) => {
      state = publishState(Object.assign({}, state, partial || {}, { updatedAt: Date.now() }));
      renderOverlay(); syncControlUI();
      return state;
    },

    setValue: (v) => {
      const next = Math.max(0, (parseInt(String(v ?? "0"), 10) || 0));
      state = publishState({ ...state, value: next, updatedAt: Date.now() });
      lastRenderValue = next;
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

    clearStorage: () => {
      lsDel(PTS_CFG_KEY); lsDel(PTS_CFG_KEY_BASE);
      lsDel(PTS_STATE_KEY); lsDel(PTS_STATE_KEY_BASE);
    }
  };

  // ───────────────────────── Boot
  const inst = {
    __ver: VERSION,
    destroy() {
      try { if (bcMain?.close) bcMain.close(); } catch (_) {}
      try { if (bcLegacy?.close) bcLegacy.close(); } catch (_) {}
      try { if (avoidTimer) clearInterval(avoidTimer); } catch (_) {}
      try { if (deltaTimer) clearTimeout(deltaTimer); } catch (_) {}
      try { if (avoidRAF) cancelAnimationFrame(avoidRAF); } catch (_) {}
    }
  };
  try { g[INST_KEY] = inst; } catch (_) {}

  onReady(() => {
    ensureControlCard();

    // ✅ MUY IMPORTANTE: re-query refs después de inyectar
    refreshCtlRefs();

    if (overlayOnlyMode) {
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
    const hadSt = !!lsGet(PTS_STATE_KEY) || !!lsGet(PTS_STATE_KEY_BASE);

    // seed inicial (sin machacar si ya existe)
    if (!hadCfg) cfg = publishCfg(cfg);
    if (!hadSt) {
      state.updatedAt = Date.now();
      state = publishState(state);
    }

    // re-sync UI
    refreshCtlRefs();
    bindControl();

    renderOverlay();
    syncControlUI();

    if (IS_PLAYER_PAGE) {
      try {
        document.addEventListener("keydown", (e) => {
          const on = !!(e && e.altKey);
          if (on && !editHeld) { editHeld = true; setEditMode(true); }
        });
        document.addEventListener("keyup", (e) => {
          const on = !!(e && e.altKey);
          if (!on && editHeld && !editPersistent) { editHeld = false; setEditMode(false); }
        });
      } catch (_) {}

      ensureOverlayUI();
      bindDrag();
      startAvoidLoop();

      try { window.addEventListener("resize", () => scheduleAvoidUpdate(), { passive: true }); } catch (_) {}
    }
  });
})();
