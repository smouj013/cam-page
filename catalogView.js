/* catalogView.js — RLC Catalog View v1.2.10 (RLC 2.3.9 COMPAT / MULTI-TILES / SINGLETON HARDEN)
   ✅ FIX CLAVE (tu caso):
      - Cuando hay KEY, si el player manda STATE por bus legacy o sin msg.key,
        antes se rechazaba tras ~6.5s => catálogo “no cambia”.
      - Ahora: fallback seguro -> si NO llegan mensajes por bcMain (keyed) en Xs,
        acepta STATE por legacy para que el “Ir” del control actualice el followSlot.
   ✅ Extra:
      - Soporta (opcional) {type:"CATALOG_SLOT_SET", slot, camId/id} y cmd "CATALOG_SLOT_SET"
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const VER = "1.2.10";
  const INST_KEY = "__RLC_CATALOG_VIEW_INSTANCE__";

  try {
    const prev = g[INST_KEY];
    if (prev && prev.__ver === VER) return;
    if (prev && typeof prev.destroy === "function") prev.destroy();
  } catch (_) {}

  // ───────────────────────── helpers
  const qs = (s, r = document) => r.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const safeStr = (v) => (typeof v === "string") ? v.trim() : "";
  const now = () => Date.now();

  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }

  function readJson(key) {
    try {
      const raw = lsGet(key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return (obj && typeof obj === "object") ? obj : null;
    } catch (_) { return null; }
  }
  function writeJson(key, obj) {
    try { lsSet(key, JSON.stringify(obj)); } catch (_) {}
  }

  function parseParams() {
    try {
      const u = new URL(location.href);
      return { key: safeStr(u.searchParams.get("key") || "") };
    } catch (_) {
      return { key: "" };
    }
  }

  // ───────────────────────── KEY auto (RLC 2.3.8/2.3.9)
  const KEY = (() => {
    const k1 = safeStr(g.RLC_KEY || "");
    if (k1) return k1;

    const k2 = safeStr(parseParams().key || "");
    if (k2) return k2;

    const k3 = safeStr(lsGet("rlc_last_key_v1") || "");
    return k3 || "";
  })();

  // ───────────────────────── Bus
  const BUS_BASE_FALLBACK = "rlc_bus_v1";
  const BUS_BASE = (() => {
    const b = safeStr(g.RLC_BUS_BASE || "");
    return b || BUS_BASE_FALLBACK;
  })();

  const BUS_MAIN = (() => {
    const b = safeStr(g.RLC_BUS || "");
    if (b) return b;
    return KEY ? `${BUS_BASE}:${KEY}` : BUS_BASE;
  })();
  const BUS_LEGACY = BUS_BASE;

  const BUS_MAIN_LOOKS_KEYED = (() => {
    if (!KEY) return false;
    const s = String(BUS_MAIN || "");
    return s.includes(`:${KEY}`);
  })();

  const bcMain = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS_MAIN) : null;
  const bcLegacy = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_LEGACY) : null;

  // ───────────────────────── State/CFG/SLOTS keys
  const CFG_BASE = "rlc_catalog_cfg_v1";
  const SLOTS_BASE = "rlc_catalog_slots_v1";

  const CFG_KEY = KEY ? `${CFG_BASE}:${KEY}` : CFG_BASE;
  const CFG_KEY_LEGACY = CFG_BASE;

  const SLOTS_KEY = KEY ? `${SLOTS_BASE}:${KEY}` : SLOTS_BASE;

  const STATE_KEY_BASE_CANDIDATES = [
    "rlc_state_v9","rlc_state_v8","rlc_state_v7","rlc_state_v6","rlc_state_v5",
    "rlc_state_v4","rlc_state_v3","rlc_state_v2","rlc_state_v1"
  ];

  function detectStateKeyCandidates() {
    const exposed = safeStr(g.RLC_STATE_KEY || "");
    if (exposed) {
      const leg = safeStr(g.RLC_STATE_KEY_LEGACY || "");
      return { primary: exposed, legacy: leg || "rlc_state_v1" };
    }

    if (KEY) {
      for (const base of STATE_KEY_BASE_CANDIDATES) {
        const k = `${base}:${KEY}`;
        if (lsGet(k)) return { primary: k, legacy: base };
      }
      for (const base of STATE_KEY_BASE_CANDIDATES) {
        if (lsGet(base)) return { primary: base, legacy: base };
      }
      return { primary: `rlc_state_v1:${KEY}`, legacy: "rlc_state_v1" };
    } else {
      for (const base of STATE_KEY_BASE_CANDIDATES) {
        if (lsGet(base)) return { primary: base, legacy: base };
      }
      return { primary: "rlc_state_v1", legacy: "rlc_state_v1" };
    }
  }

  let STATE_KEYS = detectStateKeyCandidates();

  // ───────────────────────── Key acceptance (FIX)
  // Antes: tras 6.5s se rechazaban mensajes legacy sin key => catálogo no se actualiza.
  // Ahora: si bcMain (keyed) no está llegando, aceptamos legacy para STATE/cmds.
  let allowLegacyNoKey = true;
  const allowLegacyNoKeyUntil = now() + 6500;

  let lastMainMsgAt = 0;
  let lastLegacyMsgAt = 0;

  function noteTransport(transportTag) {
    const t = now();
    if (transportTag === "bcMain") lastMainMsgAt = t;
    if (transportTag === "bcLegacy") lastLegacyMsgAt = t;
  }

  function mainSeemsDead() {
    const t = now();
    // si hace > 8s que no llega nada por bcMain, consideramos fallback a legacy
    return (t - lastMainMsgAt) > 8000;
  }

  function keyOk(msg, transportTag) {
    if (!KEY) return true;

    const mk = (msg && typeof msg.key === "string") ? String(msg.key).trim() : "";
    if (mk) return mk === KEY;

    // Si llega por el canal "main" y ese canal parece keyed => aceptamos
    if (transportTag === "bcMain" && BUS_MAIN_LOOKS_KEYED) {
      allowLegacyNoKey = false;
      return true;
    }

    // FIX: si el main keyed NO está llegando, permitimos legacy sin key (evita “catálogo congelado”)
    if (transportTag === "bcLegacy") {
      if (!BUS_MAIN_LOOKS_KEYED) return true;
      if (mainSeemsDead()) return true;
    }

    // Ventana corta inicial (como antes)
    if (!allowLegacyNoKey) return false;
    if (now() > allowLegacyNoKeyUntil) return false;
    return true;
  }

  // ───────────────────────── Layout presets
  const LAYOUTS = {
    quad:    { tiles: 4,  cols: 2, rows: 2 },
    six:     { tiles: 6,  cols: 3, rows: 2 },
    nine:    { tiles: 9,  cols: 3, rows: 3 },
    twelve:  { tiles: 12, cols: 4, rows: 3 },
    sixteen: { tiles: 16, cols: 4, rows: 4 }
  };

  function autoGridForTiles(tiles) {
    const t = clamp((parseInt(tiles, 10) || 4), 1, 25);
    const cols = clamp(Math.ceil(Math.sqrt(t)), 1, 6);
    const rows = clamp(Math.ceil(t / cols), 1, 6);
    return { tiles: t, cols, rows };
  }

  // ───────────────────────── Config
  const DEFAULTS = {
    enabled: false,

    layout: "quad",
    tiles: 4,
    cols: 2,
    rows: 2,

    gapPx: 8,
    labels: true,
    muted: true,

    mode: "follow",
    followSlot: 0,
    ytCookies: true,
    clickCycle: true,

    wxTiles: true,
    wxRefreshSec: 30
  };

  function normalizeCfg(inCfg) {
    const c = Object.assign({}, DEFAULTS, inCfg || {});
    c.enabled = (c.enabled === true);

    c.gapPx = clamp(parseInt(c.gapPx, 10) || DEFAULTS.gapPx, 0, 24);
    c.labels = (c.labels !== false);
    c.muted = (c.muted !== false);

    const mode = safeStr(c.mode).toLowerCase();
    c.mode = (mode === "sync") ? "sync" : "follow";

    let layout = safeStr(c.layout).toLowerCase();

    if (layout && /^\d+$/.test(layout)) {
      const g0 = autoGridForTiles(parseInt(layout, 10));
      c.layout = "custom";
      c.tiles = g0.tiles; c.cols = g0.cols; c.rows = g0.rows;
    } else if (layout in LAYOUTS) {
      const p = LAYOUTS[layout];
      c.layout = layout;
      c.tiles = p.tiles; c.cols = p.cols; c.rows = p.rows;
    } else {
      c.layout = "custom";
      const g1 = autoGridForTiles(c.tiles);
      c.tiles = g1.tiles;

      c.cols = clamp((parseInt(c.cols, 10) || g1.cols), 1, 6);
      c.rows = clamp((parseInt(c.rows, 10) || g1.rows), 1, 6);

      if ((c.cols * c.rows) < c.tiles) {
        c.rows = clamp(Math.ceil(c.tiles / c.cols), 1, 6);
        if ((c.cols * c.rows) < c.tiles) {
          const g2 = autoGridForTiles(c.tiles);
          c.cols = g2.cols; c.rows = g2.rows;
        }
      }
    }

    c.followSlot = clamp((parseInt(c.followSlot, 10) || 0), 0, Math.max(0, (c.tiles | 0) - 1));
    c.ytCookies = (c.ytCookies !== false);
    c.clickCycle = (c.clickCycle !== false);

    c.wxTiles = (c.wxTiles !== false);
    c.wxRefreshSec = clamp((parseInt(c.wxRefreshSec, 10) || DEFAULTS.wxRefreshSec), 10, 180);

    return c;
  }

  function loadCfg() {
    return normalizeCfg(readJson(CFG_KEY) || readJson(CFG_KEY_LEGACY) || DEFAULTS);
  }

  let CFG = loadCfg();
  let lastState = null;

  // ───────────────────────── State helpers
  function normalizeStateMaybe(st) {
    if (!st || typeof st !== "object") return null;
    if (st.state && typeof st.state === "object") st = st.state;

    const t = safeStr(st.type || st.kind || st.name || "").toLowerCase();
    if (t === "state") return Object.assign({ type: "state" }, st);

    const hasCam = !!st.cam && typeof st.cam === "object";
    const hasIdx = Number.isFinite(st.index) || typeof st.index === "number";
    if (hasCam || hasIdx) return Object.assign({ type: "state" }, st);

    return null;
  }

  function readStateFromLS() {
    try {
      const rawMain = lsGet(STATE_KEYS.primary);
      const rawLegacy = rawMain ? null : lsGet(STATE_KEYS.legacy);
      const raw = rawMain || rawLegacy;
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      const st = normalizeStateMaybe(parsed);
      if (!st) return null;

      const isMain = !!rawMain;
      if (!keyOk(st, isMain ? "bcMain" : "bcLegacy")) return null;
      return st;
    } catch (_) {
      return null;
    }
  }

  function stateSig(st) {
    if (!st) return "";
    const id = String(st?.cam?.id || "");
    const idx = Number.isFinite(st?.index) ? String(st.index | 0) : "";
    return `${idx}|${id}`;
  }

  // ───────────────────────── Instance plumbing
  const inst = {
    __ver: VER,
    _timers: new Set(),
    _unsub: [],
    destroy() {
      try { for (const off of inst._unsub) { try { off(); } catch (_) {} } } catch (_) {}
      inst._unsub.length = 0;

      try { for (const t of inst._timers) { try { clearInterval(t); clearTimeout(t); } catch (_) {} } } catch (_) {}
      inst._timers.clear();

      try { bcMain && bcMain.close && bcMain.close(); } catch (_) {}
      try { bcLegacy && bcLegacy.close && bcLegacy.close(); } catch (_) {}

      try { if (g[INST_KEY] === inst) delete g[INST_KEY]; } catch (_) {}
    }
  };
  g[INST_KEY] = inst;

  function on(el, ev, fn, opts) {
    if (!el || !el.addEventListener) return;
    el.addEventListener(ev, fn, opts);
    inst._unsub.push(() => { try { el.removeEventListener(ev, fn, opts); } catch (_) {} });
  }

  // ───────────────────────── UI (styles + root)
  function injectStylesOnce() {
    if (qs("#rlcCatalogStyle")) return;

    const st = document.createElement("style");
    st.id = "rlcCatalogStyle";
    st.textContent = `
#rlcCatalog{
  position:absolute;
  inset: 0;
  z-index: 2;
  display:none;
  padding: 10px;
  box-sizing: border-box;
}
#rlcCatalog.on{ display:block; }

#rlcCatalog .grid{
  width: 100%;
  height: 100%;
  display:grid;
  gap: 8px;
}

#rlcCatalog .slot{
  position: relative;
  overflow:hidden;
  border-radius: 14px;
  background: #05070b;
  border: 1px solid rgba(255,255,255,.10);
  box-shadow: 0 18px 55px rgba(0,0,0,.55);
}

#rlcCatalog.on .slot iframe,
#rlcCatalog.on .slot video,
#rlcCatalog.on .slot img{
  pointer-events:none;
}

#rlcCatalog .slot iframe,
#rlcCatalog .slot video,
#rlcCatalog .slot img{
  position:absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border:0;
  object-fit: cover;
}

#rlcCatalog .tag{
  position:absolute;
  left: 10px;
  bottom: 10px;
  right: 10px;
  display:flex;
  gap: 8px;
  align-items:center;
  flex-wrap: wrap;
  pointer-events:none;
  font: 800 12px/1.1 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
  color: rgba(255,255,255,.92);
  text-shadow: 0 10px 22px rgba(0,0,0,.9);
}
#rlcCatalog .tag .chip{
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(0,0,0,.42);
  border: 1px solid rgba(255,255,255,.12);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  white-space: nowrap;
  overflow:hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
#rlcCatalog .tag .chip.small{
  opacity: .85;
  font-weight: 950;
  letter-spacing:.06em;
}
#rlcCatalog .tag .chip.wx{
  opacity: .92;
  font-weight: 950;
}

#rlcCatalog .slot.offline::after{
  content: "NO EMBED / OFFLINE";
  position:absolute;
  inset:0;
  display:flex;
  align-items:center;
  justify-content:center;
  font: 950 12px/1 ui-sans-serif, system-ui;
  letter-spacing:.18em;
  color: rgba(255,255,255,.65);
  background: repeating-linear-gradient(135deg, rgba(255,255,255,.06) 0 8px, rgba(255,255,255,.03) 8px 16px);
}
`.trim();
    document.head.appendChild(st);
  }

  function gridHtml(count) {
    const n = clamp((parseInt(count, 10) || 4), 1, 25);
    let out = `<div class="grid">`;
    for (let i = 0; i < n; i++) {
      out += `
        <div class="slot" data-slot="${i}">
          <iframe class="m iframe" title="Catalog Cam ${i}" referrerpolicy="strict-origin-when-cross-origin"
            allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
          <video class="m video" autoplay muted playsinline webkit-playsinline></video>
          <img class="m img" alt="Catalog snapshot" />
          <div class="tag">
            <div class="chip small" data-chip="n">CAM ${i + 1}</div>
            <div class="chip" data-chip="t">—</div>
            <div class="chip wx" data-chip="wx" style="display:none"></div>
          </div>
        </div>
      `;
    }
    out += `</div>`;
    return out.trim();
  }

  function ensureCatalogRoot(countWanted) {
    injectStylesOnce();

    const count = clamp((parseInt(countWanted, 10) || 4), 1, 25);

    let root = qs("#rlcCatalog");
    const stage = qs("#stage") || qs("#app") || qs("#root") || document.body;

    const mediaLayer = qs("#stage .layer.layer-media") || qs(".layer.layer-media") || stage;

    if (!root) {
      root = document.createElement("div");
      root.id = "rlcCatalog";
      mediaLayer.appendChild(root);
    }

    try {
      if (mediaLayer === document.body || mediaLayer === document.documentElement) {
        root.style.position = "fixed";
        root.style.inset = "0";
      } else {
        root.style.position = "absolute";
        root.style.inset = "0";
      }
    } catch (_) {}

    const prev = parseInt(root.dataset.rlcSlots || "0", 10) || 0;
    const hasGrid = !!root.querySelector(".grid");

    if (!hasGrid || prev !== count) {
      root.innerHTML = gridHtml(count);
      root.dataset.rlcSlots = String(count);
      root.dataset.rlcClicksHooked = "0";
    }

    return root;
  }

  function setSingleMediaVisible(on) {
    const frame = qs("#frame") || qs("#rlcFrame") || qs("#playerFrame");
    const video = qs("#video") || qs("#rlcVideo") || qs("#playerVideo");
    const img = qs("#img") || qs("#rlcImg") || qs("#playerImg");
    if (frame) frame.style.display = on ? "" : "none";
    if (video) video.style.display = on ? "" : "none";
    if (img) img.style.display = on ? "" : "none";
  }

  // HUD single hide
  let _hudEl = null;
  let _hudPrevDisplay = null;
  function findHudEl() {
    return qs(".hud") || qs("#hud") || qs("#rlcHud") || null;
  }
  function setSingleHudVisible(on) {
    if (!_hudEl || !_hudEl.isConnected) _hudEl = findHudEl();
    if (!_hudEl) return;

    if (on) {
      _hudEl.style.display = (_hudPrevDisplay == null) ? "" : _hudPrevDisplay;
    } else {
      if (_hudPrevDisplay == null) _hudPrevDisplay = _hudEl.style.display || "";
      _hudEl.style.display = "none";
    }
  }

  function signalCatalogMode(on) {
    try { document.documentElement.dataset.rlcCatalog = on ? "1" : "0"; } catch (_) {}
    try { g.dispatchEvent(new CustomEvent("rlc_catalog_mode", { detail: { on: !!on, ts: now() } })); } catch (_) {}
  }

  // ───────────────────────── Catalog data helpers
  function getCamList() {
    if (Array.isArray(g.CAM_LIST)) return g.CAM_LIST;
    if (Array.isArray(g.CAMS)) return g.CAMS;
    if (Array.isArray(g.cams)) return g.cams;
    return [];
  }

  function findIndexById(list, id) {
    const s = String(id || "");
    if (!s) return -1;
    for (let i = 0; i < list.length; i++) {
      if (String(list[i]?.id || "") === s) return i;
    }
    return -1;
  }

  function pickN(list, baseIdx, n) {
    const total = list.length;
    const N = clamp((parseInt(n, 10) || 4), 1, 25);
    if (!total) return [];
    const out = [];
    let idx = (baseIdx >= 0 ? baseIdx : 0) % total;
    for (let k = 0; k < N; k++) out.push(list[(idx + k) % total]);
    return out;
  }

  // ───────────────────────── Media kind + URL
  function detectKind(url) {
    const u = String(url || "").toLowerCase();
    if (!u) return "iframe";
    if (u.includes("youtube.com") || u.includes("youtu.be") || u.includes("youtube-nocookie.com")) return "yt";
    if (u.endsWith(".m3u8") || u.includes(".m3u8?")) return "hls";
    if (/\.(png|jpg|jpeg|gif|webp)(\?|#|$)/i.test(u)) return "img";
    return "iframe";
  }

  function extractUrl(cam) {
    if (!cam) return "";
    if (cam.kind === "youtube" && cam.youtubeId) {
      return `https://www.youtube.com/watch?v=${encodeURIComponent(cam.youtubeId)}`;
    }
    return (
      cam?.embedUrl ||
      cam?.url ||
      cam?.originUrl ||
      cam?.src ||
      cam?.streamUrl ||
      cam?.stream ||
      cam?.link ||
      ""
    );
  }

  function ytEmbed(url) {
    const u = String(url || "");
    let id = "";
    try {
      if (/\/embed\//i.test(u)) {
        const m = u.match(/\/embed\/([A-Za-z0-9_-]{6,})/i);
        id = (m && m[1]) || "";
      } else {
        const m1 = u.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/i);
        const m2 = u.match(/[?&]v=([A-Za-z0-9_-]{6,})/i);
        id = (m1 && m1[1]) || (m2 && m2[1]) || "";
      }
    } catch (_) {}
    if (!id) return u;

    const base = CFG.ytCookies
      ? `https://www.youtube.com/embed/${id}`
      : `https://www.youtube-nocookie.com/embed/${id}`;

    const o = new URL(base);
    o.searchParams.set("autoplay", "1");
    o.searchParams.set("mute", "1");
    o.searchParams.set("controls", "0");
    o.searchParams.set("playsinline", "1");
    o.searchParams.set("rel", "0");
    o.searchParams.set("modestbranding", "1");
    return o.toString();
  }

  // ───────────────────────── HLS
  function stopHls(slot) {
    try { slot._hls?.destroy?.(); } catch (_) {}
    slot._hls = null;
  }

  function showOnly(slot, kind) {
    if (slot.iframe) slot.iframe.style.display = (kind === "iframe" || kind === "yt") ? "block" : "none";
    if (slot.video)  slot.video.style.display  = (kind === "hls") ? "block" : "none";
    if (slot.img)    slot.img.style.display    = (kind === "img") ? "block" : "none";
  }

  // ───────────────────────── Labels
  function setLabel(slotEl, cam, n) {
    const labelsOn = !!CFG.labels;
    const tag = slotEl.querySelector(".tag");
    if (tag) tag.style.display = labelsOn ? "" : "none";

    const chipN = slotEl.querySelector('[data-chip="n"]');
    const chipT = slotEl.querySelector('[data-chip="t"]');

    if (chipN) chipN.textContent = `CAM ${n}`;

    const t = safeStr(cam?.title || "Live Cam");
    const p = safeStr(cam?.place || "");
    if (chipT) chipT.textContent = p ? `${t} — ${p}` : t;
  }

  // ───────────────────────── WX
  function hideWxChip(slotEl) {
    const chip = slotEl.querySelector('[data-chip="wx"]');
    if (!chip) return;
    chip.style.display = "none";
    chip.textContent = "";
  }

  function wxApi() {
    const WX = g.RLCWx;
    if (!WX || typeof WX.getSummaryForCam !== "function") return null;
    return WX;
  }

  async function setWxChipInitial(slotObj, cam) {
    const slotEl = slotObj.el;
    const chip = slotEl.querySelector('[data-chip="wx"]');
    if (!chip) return;

    if (!CFG.labels || !CFG.wxTiles) {
      hideWxChip(slotEl);
      slotObj._wxCamId = "";
      return;
    }

    const WX = wxApi();
    if (!WX) {
      hideWxChip(slotEl);
      slotObj._wxCamId = "";
      return;
    }

    const camId = String(cam?.id || "");
    if (!camId) {
      hideWxChip(slotEl);
      slotObj._wxCamId = "";
      return;
    }

    hideWxChip(slotEl);
    slotObj._wxCamId = camId;

    const tok = String((parseInt(chip.dataset.wxTok || "0", 10) || 0) + 1);
    chip.dataset.wxTok = tok;
    chip.dataset.wxCamId = camId;

    try {
      const sum = await WX.getSummaryForCam(cam);
      if (chip.dataset.wxTok !== tok) return;
      if (chip.dataset.wxCamId !== camId) return;

      if (!sum || !sum.temp || !sum.time) {
        hideWxChip(slotEl);
        return;
      }

      chip.textContent = `${sum.icon || "🌡️"} ${sum.temp} · ${sum.time}`;
      chip.style.display = "";
    } catch (_) {
      if (chip.dataset.wxTok !== tok) return;
      hideWxChip(slotEl);
    }
  }

  async function refreshWxChipSoft(slotObj) {
    if (!CFG.enabled || !CFG.labels || !CFG.wxTiles) return;
    if (document.visibilityState === "hidden") return;

    const cam = slotObj._camRef || null;
    const camId = String(cam?.id || "");
    if (!camId || slotObj._wxCamId !== camId) return;

    const slotEl = slotObj.el;
    const chip = slotEl.querySelector('[data-chip="wx"]');
    if (!chip) return;

    const WX = wxApi();
    if (!WX) {
      hideWxChip(slotEl);
      return;
    }

    const tok = String((parseInt(chip.dataset.wxTok || "0", 10) || 0) + 1);
    chip.dataset.wxTok = tok;
    chip.dataset.wxCamId = camId;

    try {
      const sum = await WX.getSummaryForCam(cam);
      if (chip.dataset.wxTok !== tok) return;
      if (chip.dataset.wxCamId !== camId) return;

      if (!sum || !sum.temp || !sum.time) {
        hideWxChip(slotEl);
        return;
      }

      const text = `${sum.icon || "🌡️"} ${sum.temp} · ${sum.time}`;
      if (chip.textContent !== text) chip.textContent = text;
      chip.style.display = "";
    } catch (_) {
      if (chip.dataset.wxTok !== tok) return;
      if (!chip.textContent) hideWxChip(slotEl);
    }
  }

  // ───────────────────────── Slot rendering
  function renderCamIntoSlot(slot, cam, n) {
    const slotEl = slot.el;
    slotEl.classList.remove("offline");

    slot._camRef = cam || null;
    slot._wxCamId = String(cam?.id || "");

    const urlRaw = extractUrl(cam);
    const kind = detectKind(urlRaw);

    setLabel(slotEl, cam, n);
    setWxChipInitial(slot, cam);

    if (slot.iframe) slot.iframe.src = "about:blank";
    if (slot.img) slot.img.src = "";
    if (slot.video) {
      try { slot.video.pause(); } catch (_) {}
      slot.video.removeAttribute("src");
      try { slot.video.load(); } catch (_) {}
    }
    stopHls(slot);

    if (!urlRaw) {
      showOnly(slot, "iframe");
      slotEl.classList.add("offline");
      return;
    }

    if (slot.video) slot.video.muted = !!CFG.muted;

    if (kind === "img") {
      showOnly(slot, "img");
      slot.img.src = urlRaw;
      return;
    }

    if (kind === "hls") {
      showOnly(slot, "hls");

      const v = slot.video;
      if (!v) { slotEl.classList.add("offline"); return; }

      const Hls = g.Hls;
      if (Hls && Hls.isSupported && Hls.isSupported()) {
        let hls = null;
        try { hls = new Hls({ enableWorker: true, lowLatencyMode: true }); } catch (_) { hls = null; }
        if (!hls) { slotEl.classList.add("offline"); return; }

        slot._hls = hls;
        try {
          hls.loadSource(urlRaw);
          hls.attachMedia(v);
          v.play?.().catch?.(() => {});
        } catch (_) {
          slotEl.classList.add("offline");
        }
      } else {
        try {
          v.src = urlRaw;
          v.play?.().catch?.(() => {});
        } catch (_) {
          slotEl.classList.add("offline");
        }
      }
      return;
    }

    showOnly(slot, "iframe");
    const src = (kind === "yt") ? ytEmbed(urlRaw) : urlRaw;

    try {
      slot.iframe.src = src;
    } catch (_) {
      slotEl.classList.add("offline");
    }
  }

  function buildSlots(root, count) {
    const n = clamp((parseInt(count, 10) || 4), 1, 25);
    const out = [];
    for (let i = 0; i < n; i++) {
      const el = root.querySelector(`.slot[data-slot="${i}"]`);
      if (!el) continue;
      out.push({
        el,
        iframe: el.querySelector("iframe"),
        video: el.querySelector("video"),
        img: el.querySelector("img"),
        _hls: null,
        _camRef: null,
        _wxCamId: ""
      });
    }
    return out;
  }

  // ───────────────────────── Sticky slots
  function loadSlotIds(nWanted) {
    const n = clamp((parseInt(nWanted, 10) || 4), 1, 25);
    const obj = readJson(SLOTS_KEY);
    const arr = Array.isArray(obj?.ids) ? obj.ids.map(x => String(x || "")) : null;
    if (!arr || !arr.length) return null;

    const out = arr.slice(0, n);
    while (out.length < n) out.push("");
    return out;
  }

  function saveSlotIds(ids) {
    const arr = Array.isArray(ids) ? ids.map(x => String(x || "")) : [];
    writeJson(SLOTS_KEY, { ts: now(), ids: arr.slice(0, 25) });
  }

  function ensureUnique(ids) {
    const seen = new Set();
    for (let i = 0; i < ids.length; i++) {
      const id = String(ids[i] || "");
      if (!id) continue;
      if (seen.has(id)) ids[i] = "";
      else seen.add(id);
    }
    return ids;
  }

  function fillMissingSlots(list, ids) {
    const used = new Set(ids.filter(Boolean));
    let ptr = 0;

    for (let i = 0; i < ids.length; i++) {
      const id = String(ids[i] || "");
      if (id && findIndexById(list, id) >= 0) continue;

      let safety = 0;
      while (safety++ < list.length) {
        const cam = list[ptr % list.length];
        ptr++;

        const cid = String(cam?.id || "");
        if (!cid) continue;
        if (used.has(cid)) continue;

        ids[i] = cid;
        used.add(cid);
        break;
      }
    }
    return ids;
  }

  function initSlotsFromState(list, nTiles) {
    let idx = -1;
    const camId = lastState?.cam?.id;

    if (Number.isFinite(lastState?.index)) idx = lastState.index | 0;
    if (idx < 0) idx = findIndexById(list, camId);

    const picked = pickN(list, idx, nTiles);
    const ids = picked.map(c => String(c?.id || ""));
    saveSlotIds(ids);
    return ids;
  }

  // Permite fijar un tile exacto desde fuera (control) si quieres:
  function setStickySlot(slotIndex, camId) {
    const list = getCamList();
    if (!list.length) return;

    const nTiles = clamp((CFG.tiles | 0), 1, 25);
    const i = clamp((slotIndex | 0), 0, Math.max(0, nTiles - 1));
    const id = String(camId || "");
    if (!id) return;

    if (findIndexById(list, id) < 0) return;

    let ids = loadSlotIds(nTiles);
    if (!ids) ids = initSlotsFromState(list, nTiles);

    const other = ids.findIndex((x, k) => x === id && k !== i);
    if (other >= 0) {
      const tmp = ids[i];
      ids[i] = ids[other];
      ids[other] = tmp;
    } else {
      ids[i] = id;
    }

    ids = fillMissingSlots(list, ensureUnique(ids));
    saveSlotIds(ids);
    updateCatalog();
  }

  // ───────────────────────── Root + structure sync
  let root = ensureCatalogRoot(CFG.tiles);
  let slots = buildSlots(root, CFG.tiles);

  let lastCfgSig = "";
  let lastRenderedIds = Array(slots.length).fill("");

  function applyCfgToUI() {
    const grid = root.querySelector(".grid");
    if (grid) {
      grid.style.gap = `${CFG.gapPx}px`;
      grid.style.gridTemplateColumns = `repeat(${CFG.cols | 0}, 1fr)`;
      grid.style.gridTemplateRows = `repeat(${CFG.rows | 0}, 1fr)`;
    }
  }

  function syncDomToCfg() {
    const want = clamp((CFG.tiles | 0), 1, 25);
    root = ensureCatalogRoot(want);
    slots = buildSlots(root, want);
    if (lastRenderedIds.length !== slots.length) {
      lastRenderedIds = Array(slots.length).fill("");
    }
    applyCfgToUI();
    hookClicksOnce();
  }

  // WX refresh loop
  let wxTimer = null;
  function stopWxRefresh() {
    if (wxTimer) clearInterval(wxTimer);
    wxTimer = null;
  }
  function startWxRefresh() {
    stopWxRefresh();
    if (!CFG.enabled || !CFG.labels || !CFG.wxTiles) return;

    const ms = (CFG.wxRefreshSec | 0) * 1000;
    wxTimer = setInterval(() => {
      if (!CFG.enabled || !root.classList.contains("on")) return;
      if (!CFG.labels || !CFG.wxTiles) return;
      for (const s of slots) refreshWxChipSoft(s);
    }, ms);
    inst._timers.add(wxTimer);
  }

  function setCatalogEnabled(on) {
    const want = !!on;
    const isOn = root.classList.contains("on");
    if (want === isOn) {
      if (want) applyCfgToUI();
      return;
    }

    root.classList.toggle("on", want);

    setSingleHudVisible(!want);
    signalCatalogMode(want);

    if (want) {
      syncDomToCfg();
      setSingleMediaVisible(false);
      startWxRefresh();
    } else {
      stopWxRefresh();

      for (const s of slots) {
        stopHls(s);
        s._camRef = null;
        s._wxCamId = "";
        hideWxChip(s.el);

        try { if (s.iframe) s.iframe.src = "about:blank"; } catch (_) {}
        try { if (s.img) s.img.src = ""; } catch (_) {}
        if (s.video) {
          try { s.video.pause(); } catch (_) {}
          s.video.removeAttribute("src");
          try { s.video.load(); } catch (_) {}
        }
      }
      setSingleMediaVisible(true);
    }
  }

  function cfgSig() {
    return [
      `en=${CFG.enabled ? 1 : 0}`,
      `tiles=${CFG.tiles | 0}`,
      `c=${CFG.cols | 0}`,
      `r=${CFG.rows | 0}`,
      `m=${CFG.muted ? 1 : 0}`,
      `l=${CFG.labels ? 1 : 0}`,
      `g=${CFG.gapPx | 0}`,
      `ytc=${CFG.ytCookies ? 1 : 0}`,
      `mode=${CFG.mode}`,
      `fs=${CFG.followSlot | 0}`,
      `cc=${CFG.clickCycle ? 1 : 0}`,
      `wx=${CFG.wxTiles ? 1 : 0}`,
      `wxr=${CFG.wxRefreshSec | 0}`
    ].join("|");
  }

  function getCurrentCamFromState(list) {
    if (!list.length) return null;

    const camId = lastState?.cam?.id;
    let idx = -1;

    if (Number.isFinite(lastState?.index)) idx = lastState.index | 0;
    if (idx < 0) idx = findIndexById(list, camId);

    return (idx >= 0) ? list[idx] : list[0];
  }

  function updateCatalog() {
    if (!CFG.enabled) return;
    if (!root.classList.contains("on")) return;

    const list = getCamList();
    if (!list.length) return;

    const sig = cfgSig();
    const cfgChanged = (sig !== lastCfgSig);
    if (cfgChanged) {
      lastCfgSig = sig;
      syncDomToCfg();
      if (lastRenderedIds.length !== slots.length) lastRenderedIds = Array(slots.length).fill("");
    }

    const nTiles = clamp((CFG.tiles | 0), 1, 25);
    let ids = loadSlotIds(nTiles);

    if (CFG.mode === "sync") {
      let idx = -1;
      const camId = lastState?.cam?.id;
      if (Number.isFinite(lastState?.index)) idx = lastState.index | 0;
      if (idx < 0) idx = findIndexById(list, camId);

      const picked = pickN(list, idx, nTiles);
      ids = picked.map(c => String(c?.id || ""));
      ids = fillMissingSlots(list, ensureUnique(ids));
      saveSlotIds(ids);
    } else {
      if (!ids) ids = initSlotsFromState(list, nTiles);
      ids = fillMissingSlots(list, ensureUnique(ids));

      const cur = getCurrentCamFromState(list);
      const curId = String(cur?.id || "");
      if (curId) {
        const fs = clamp((CFG.followSlot | 0), 0, Math.max(0, nTiles - 1));

        const other = ids.findIndex((x, i) => x === curId && i !== fs);
        if (other >= 0) {
          const tmp = ids[fs];
          ids[fs] = ids[other];
          ids[other] = tmp;
        }

        if (ids[fs] !== curId) {
          ids[fs] = curId;
          ids = fillMissingSlots(list, ensureUnique(ids));
          saveSlotIds(ids);
        }
      }
    }

    applyCfgToUI();

    for (let i = 0; i < slots.length; i++) {
      const id = String(ids?.[i] || "");
      if (!cfgChanged && id === lastRenderedIds[i]) continue;

      const camIdx = findIndexById(list, id);
      const cam = (camIdx >= 0) ? list[camIdx] : null;

      lastRenderedIds[i] = id;

      if (cam) {
        renderCamIntoSlot(slots[i], cam, i + 1);
      } else {
        const fallback = list[i % list.length];
        renderCamIntoSlot(slots[i], fallback, i + 1);
        lastRenderedIds[i] = String(fallback?.id || "");
      }
    }

    if (cfgChanged) startWxRefresh();
  }

  // click-to-cycle
  function cycleSlot(slotIndex, dir = 1) {
    if (!CFG.enabled || !CFG.clickCycle) return;

    const list = getCamList();
    if (!list.length) return;

    const nTiles = clamp((CFG.tiles | 0), 1, 25);

    let ids = loadSlotIds(nTiles);
    if (!ids) ids = initSlotsFromState(list, nTiles);

    const currentId = String(ids[slotIndex] || "");
    let idx = findIndexById(list, currentId);
    if (idx < 0) idx = slotIndex % list.length;

    idx = (idx + (dir >= 0 ? 1 : -1) + list.length) % list.length;

    const next = list[idx];
    const nextId = String(next?.id || "");
    if (!nextId) return;

    const other = ids.findIndex((x, i) => x === nextId && i !== slotIndex);
    if (other >= 0) {
      const tmp = ids[slotIndex];
      ids[slotIndex] = ids[other];
      ids[other] = tmp;
    } else {
      ids[slotIndex] = nextId;
    }

    ids = fillMissingSlots(list, ensureUnique(ids));
    saveSlotIds(ids);
    updateCatalog();
  }

  // ───────────────────────── Bus listeners
  let _lastStateSig = "";

  function applyCfgAny(rawCfg) {
    if (!rawCfg || typeof rawCfg !== "object") return;
    CFG = normalizeCfg(rawCfg);
    setCatalogEnabled(CFG.enabled);
    updateCatalog();
  }

  function isStateMessage(msg) {
    const t = safeStr(msg?.type || msg?.kind || msg?.name || "").toLowerCase();
    return t === "state";
  }

  function extractGotoFromCmd(msg) {
    const payload = (msg && typeof msg.payload === "object") ? msg.payload : (msg && typeof msg.data === "object" ? msg.data : null);
    const id =
      safeStr(payload?.camId || payload?.id || payload?.cameraId || payload?.value || "") ||
      safeStr(msg?.camId || msg?.id || msg?.cameraId || "");
    const index = Number.isFinite(payload?.index) ? (payload.index | 0) : (Number.isFinite(msg?.index) ? (msg.index | 0) : null);
    return { id, index };
  }

  function onBusMessage(msg, transportTag) {
    if (!msg || typeof msg !== "object") return;

    // marca actividad del canal (para fallback)
    noteTransport(transportTag);

    // CATALOG_CFG estándar
    if (msg.type === "CATALOG_CFG" && msg.cfg && typeof msg.cfg === "object") {
      if (!keyOk(msg, transportTag)) return;
      applyCfgAny(msg.cfg);
      return;
    }

    // comando opcional: set tile exacto desde control
    if (msg.type === "CATALOG_SLOT_SET") {
      if (!keyOk(msg, transportTag)) return;
      const slot = parseInt(msg.slot, 10);
      const camId = safeStr(msg.camId || msg.id || "");
      if (Number.isFinite(slot) && camId) setStickySlot(slot, camId);
      return;
    }

    if (msg.type === "cmd") {
      const cmd = safeStr(msg.cmd || msg.name || "").toUpperCase();

      // fallback: cmd CATALOG_SET
      if (cmd === "CATALOG_SET") {
        if (!keyOk(msg, transportTag)) return;
        const payload = (msg.payload && typeof msg.payload === "object") ? msg.payload : (msg.cfg || null);
        if (payload) applyCfgAny(payload);
        return;
      }

      // opcional: cmd para fijar tile
      if (cmd === "CATALOG_SLOT_SET") {
        if (!keyOk(msg, transportTag)) return;
        const payload = (msg.payload && typeof msg.payload === "object") ? msg.payload : {};
        const slot = parseInt(payload.slot ?? msg.slot, 10);
        const camId = safeStr(payload.camId || payload.id || msg.camId || msg.id || "");
        if (Number.isFinite(slot) && camId) setStickySlot(slot, camId);
        return;
      }

      // QoL: si llega GOTO, adelantamos lastState (ayuda cuando el STATE tarda)
      if (cmd === "GOTO" || cmd === "GOTO_ID" || cmd === "CAM_GOTO" || cmd === "SET_CAM") {
        if (!keyOk(msg, transportTag)) return;
        const { id, index } = extractGotoFromCmd(msg);
        if (id || Number.isFinite(index)) {
          lastState = { type: "state", index: Number.isFinite(index) ? index : undefined, cam: { id: id || "" } };
          if (CFG.enabled) updateCatalog();
        }
      }
      return;
    }

    // estado
    if (isStateMessage(msg)) {
      if (!keyOk(msg, transportTag)) return;
      const sig = stateSig(msg);
      if (sig && sig === _lastStateSig) return;
      _lastStateSig = sig;
      lastState = normalizeStateMaybe(msg) || msg;
      if (CFG.enabled) updateCatalog();
      return;
    }
  }

  if (bcMain) bcMain.onmessage = (ev) => onBusMessage(ev?.data, "bcMain");
  if (bcLegacy) bcLegacy.onmessage = (ev) => onBusMessage(ev?.data, "bcLegacy");

  // postMessage same-origin
  on(window, "message", (ev) => {
    try {
      if (ev.origin && ev.origin !== location.origin) return;
    } catch (_) {}
    const msg = ev && ev.data;
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "CATALOG_CFG" || msg.type === "cmd" || msg.type === "CATALOG_SLOT_SET" || isStateMessage(msg)) {
      onBusMessage(msg, "postMessage");
    }
  }, { passive: true });

  // polling suave + redetección de STATE key
  let miss = 0;
  let lastDetect = 0;

  const poll = setInterval(() => {
    const st = readStateFromLS();
    if (!st) {
      miss++;
      const t = now();
      if ((miss % 12) === 0 && (t - lastDetect) > 9000) {
        lastDetect = t;
        STATE_KEYS = detectStateKeyCandidates();
      }
      return;
    }

    miss = 0;
    const sig = stateSig(st);
    if (sig && sig === _lastStateSig) return;
    _lastStateSig = sig;
    lastState = st;
    if (CFG.enabled) updateCatalog();
  }, 550);
  inst._timers.add(poll);

  // storage: CFG cambiado por control
  on(window, "storage", (e) => {
    if (!e || !e.key) return;
    if (e.key === CFG_KEY || e.key === CFG_KEY_LEGACY) {
      CFG = normalizeCfg(loadCfg());
      setCatalogEnabled(CFG.enabled);
      updateCatalog();
    }
  });

  on(document, "visibilitychange", () => {
    if (!CFG.enabled) return;
    if (document.visibilityState !== "visible") return;
    for (const s of slots) refreshWxChipSoft(s);
  });

  // clicks
  function hookClicksOnce() {
    if (root.dataset.rlcClicksHooked === "1") return;
    root.dataset.rlcClicksHooked = "1";

    const n = slots.length;
    for (let i = 0; i < n; i++) {
      const el = root.querySelector(`.slot[data-slot="${i}"]`);
      if (!el) continue;

      on(el, "click", (ev) => {
        if (!CFG.enabled || !CFG.clickCycle) return;
        const back = !!ev?.shiftKey;
        cycleSlot(i, back ? -1 : 1);
      });
    }
  }

  function boot() {
    CFG = normalizeCfg(loadCfg());
    syncDomToCfg();
    setCatalogEnabled(CFG.enabled);

    const st = readStateFromLS();
    if (st) {
      _lastStateSig = stateSig(st);
      lastState = st;
    }

    if (CFG.enabled) updateCatalog();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
