/* catalogView.js — RLC Catalog View v1.2.0
   ✅ Catálogo 2x2 (4 cams)
   ✅ Modo "follow": SOLO 1 tile sigue al state
   ✅ Modo "sync": rotan las 4 a la vez
   ✅ Slots sticky por KEY
   ✅ Click-to-cycle por tile (SHIFT => anterior)
   ✅ ytCookies: youtube.com/embed vs youtube-nocookie.com/embed
   ✅ Oculta HUD single cuando catálogo ON + avisa ("rlc_catalog_mode")
   ✅ WX por tile si existe window.RLCWx.getSummaryForCam() (sin placeholders / sin flicker)

   🗳️ NUEVO: VOTACIÓN 4 OPCIONES (cambia SOLO 1 tile, las otras se mantienen)
   - Si CFG.voteEnabled:
       * Se abre una votación cada intervalo ALEATORIO [voteEveryMinSec..voteEveryMaxSec]
       * Dura voteWindowSec
       * El chat vota 1..4 (slot) y al cerrar se cambia SOLO ese slot a la siguiente cam
       * Si nadie vota y voteAllowNoVotes => slot random
   - Mensajes aceptados por BUS (para integrarlo con tu bot):
       * {type:"CATALOG_VOTE", slot:0..3, user:"name"}  (o choice:1..4)
       * {type:"VOTE_CAST",   slot:0..3, user:"name"}  (o text:"!2")
       * {type:"CHAT", user:"name", text:"!1"}         (parsea 1..4)
   - Para anunciar al chat (si tu Control soporta BOT_SAY):
       * el player emite {type:"BOT_SAY", text:"..."} cuando empieza votación (si voteAnnounce)
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const LOAD_GUARD = "__RLC_CATALOG_VIEW_LOADED_V120";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  // ───────────────────────── Keys / Bus
  const BUS_BASE = "rlc_bus_v1";
  const STATE_KEY_BASE = "rlc_state_v1";
  const CFG_BASE = "rlc_catalog_cfg_v1";
  const SLOTS_BASE = "rlc_catalog_slots_v1";

  const qs = (s, r = document) => r.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const safeStr = (v) => (typeof v === "string") ? v.trim() : "";

  function parseParams() {
    const u = new URL(location.href);
    return { key: safeStr(u.searchParams.get("key") || "") };
  }
  const KEY = String(parseParams().key || "").trim();

  const BUS = KEY ? `${BUS_BASE}:${KEY}` : BUS_BASE;
  const BUS_LEGACY = BUS_BASE;

  const STATE_KEY = KEY ? `${STATE_KEY_BASE}:${KEY}` : STATE_KEY_BASE;
  const STATE_KEY_LEGACY = STATE_KEY_BASE;

  const CFG_KEY = KEY ? `${CFG_BASE}:${KEY}` : CFG_BASE;
  const CFG_KEY_LEGACY = CFG_BASE;

  const SLOTS_KEY = KEY ? `${SLOTS_BASE}:${KEY}` : SLOTS_BASE;

  const bcMain = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS) : null;
  const bcLegacy = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_LEGACY) : null;

  // ───────────────────────── Config
  const DEFAULTS = {
    enabled: false,
    layout: "quad",
    gapPx: 8,
    labels: true,
    muted: true,

    mode: "follow",
    followSlot: 0,
    ytCookies: true,
    clickCycle: true,

    wxTiles: true,
    wxRefreshSec: 30,

    // 🗳️ voto
    voteEnabled: true,
    voteWindowSec: 18,
    voteEveryMinSec: 55,
    voteEveryMaxSec: 120,
    voteAnnounce: true,
    voteAllowNoVotes: true
  };

  function readJson(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return (obj && typeof obj === "object") ? obj : null;
    } catch (_) { return null; }
  }
  function writeJson(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch (_) {}
  }

  function normalizeCfg(inCfg) {
    const c = Object.assign({}, DEFAULTS, inCfg || {});
    c.enabled = (c.enabled === true);
    c.layout = "quad";

    c.gapPx = clamp(parseInt(c.gapPx, 10) || DEFAULTS.gapPx, 0, 24);
    c.labels = (c.labels !== false);
    c.muted = (c.muted !== false);

    const mode = safeStr(c.mode).toLowerCase();
    c.mode = (mode === "sync") ? "sync" : "follow";
    c.followSlot = clamp((parseInt(c.followSlot, 10) || 0), 0, 3);

    c.ytCookies = (c.ytCookies !== false);
    c.clickCycle = (c.clickCycle !== false);

    c.wxTiles = (c.wxTiles !== false);
    c.wxRefreshSec = clamp((parseInt(c.wxRefreshSec, 10) || DEFAULTS.wxRefreshSec), 10, 180);

    // 🗳️ voto
    c.voteEnabled = (c.voteEnabled !== false);
    c.voteWindowSec = clamp((parseInt(c.voteWindowSec, 10) || DEFAULTS.voteWindowSec), 8, 60);

    c.voteEveryMinSec = clamp((parseInt(c.voteEveryMinSec, 10) || DEFAULTS.voteEveryMinSec), 15, 900);
    c.voteEveryMaxSec = clamp((parseInt(c.voteEveryMaxSec, 10) || DEFAULTS.voteEveryMaxSec), 20, 1200);
    if (c.voteEveryMaxSec < c.voteEveryMinSec + 5) c.voteEveryMaxSec = c.voteEveryMinSec + 5;

    c.voteAnnounce = (c.voteAnnounce !== false);
    c.voteAllowNoVotes = (c.voteAllowNoVotes !== false);

    return c;
  }

  function loadCfg() {
    return normalizeCfg(readJson(CFG_KEY) || readJson(CFG_KEY_LEGACY) || DEFAULTS);
  }

  let CFG = loadCfg();
  let lastState = null;

  function keyOk(msg, isMainChannel) {
    if (!KEY) return true;
    if (isMainChannel) return true;
    return (msg && msg.key === KEY);
  }

  function readStateFromLS() {
    try {
      const rawMain = localStorage.getItem(STATE_KEY);
      const rawLegacy = rawMain ? null : localStorage.getItem(STATE_KEY_LEGACY);
      const raw = rawMain || rawLegacy;
      if (!raw) return null;

      const st = JSON.parse(raw);
      if (!st || st.type !== "state") return null;

      const isMain = !!rawMain;
      if (!keyOk(st, isMain)) return null;

      return st;
    } catch (_) { return null; }
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
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: var(--rlcCatalogGap, 8px);
}

#rlcCatalog .slot{
  position: relative;
  overflow:hidden;
  border-radius: 14px;
  background: #05070b;
  border: 1px solid rgba(255,255,255,.10);
  box-shadow: 0 18px 55px rgba(0,0,0,.55);
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
#rlcCatalog .tag .chip.vote{
  opacity: .95;
  font-weight: 950;
  border-color: rgba(255,255,255,.18);
  background: rgba(5,10,18,.52);
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

  function ensureCatalogRoot() {
    injectStylesOnce();

    let root = qs("#rlcCatalog");
    if (root) return root;

    const stage = qs("#stage") || document.body;

    root = document.createElement("div");
    root.id = "rlcCatalog";
    root.innerHTML = `
      <div class="grid">
        ${[0,1,2,3].map(i => `
          <div class="slot" data-slot="${i}">
            <iframe class="m iframe" title="Catalog Cam ${i}" referrerpolicy="strict-origin-when-cross-origin"
              allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
            <video class="m video" autoplay muted playsinline webkit-playsinline></video>
            <img class="m img" alt="Catalog snapshot" />
            <div class="tag">
              <div class="chip small" data-chip="n">CAM ${i+1}</div>
              <div class="chip" data-chip="t">—</div>
              <div class="chip wx" data-chip="wx" style="display:none"></div>
              <div class="chip vote" data-chip="v" style="display:none"></div>
            </div>
          </div>
        `).join("")}
      </div>
    `.trim();

    const mediaLayer = qs("#stage .layer.layer-media") || stage;
    mediaLayer.appendChild(root);
    return root;
  }

  function setSingleMediaVisible(on) {
    const frame = qs("#frame");
    const video = qs("#video");
    const img = qs("#img");
    if (frame) frame.style.display = on ? "" : "none";
    if (video) video.style.display = on ? "" : "none";
    if (img) img.style.display = on ? "" : "none";
  }

  // ✅ ocultar HUD single
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
    try { g.dispatchEvent(new CustomEvent("rlc_catalog_mode", { detail: { on: !!on, ts: Date.now() } })); } catch (_) {}
  }

  // ───────────────────────── Catalog data helpers
  function getCamList() {
    return Array.isArray(g.CAM_LIST) ? g.CAM_LIST : [];
  }

  function findIndexById(list, id) {
    const s = String(id || "");
    if (!s) return -1;
    for (let i = 0; i < list.length; i++) {
      if (String(list[i]?.id || "") === s) return i;
    }
    return -1;
  }

  function pick4(list, baseIdx) {
    const n = list.length;
    if (!n) return [];
    const out = [];
    let idx = (baseIdx >= 0 ? baseIdx : 0) % n;
    for (let k = 0; k < 4; k++) out.push(list[(idx + k) % n]);
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
    if (slot.video) slot.video.style.display = (kind === "hls") ? "block" : "none";
    if (slot.img) slot.img.style.display = (kind === "img") ? "block" : "none";
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

  // ───────────────────────── Vote chip
  function hideVoteChip(slotEl) {
    const chip = slotEl.querySelector('[data-chip="v"]');
    if (!chip) return;
    chip.style.display = "none";
    chip.textContent = "";
  }
  function setVoteChip(slotEl, text) {
    const chip = slotEl.querySelector('[data-chip="v"]');
    if (!chip) return;
    if (!CFG.labels || !CFG.voteEnabled) { hideVoteChip(slotEl); return; }
    if (!text) { hideVoteChip(slotEl); return; }
    chip.textContent = text;
    chip.style.display = "";
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

    // vote chip se actualiza aparte (updateVoteUI)

    // reset medias
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
        const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
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

  function buildSlots() {
    const root = ensureCatalogRoot();
    const out = [];
    for (let i = 0; i < 4; i++) {
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
  function loadSlotIds() {
    const obj = readJson(SLOTS_KEY);
    const arr = Array.isArray(obj?.ids) ? obj.ids : null;
    if (!arr || arr.length !== 4) return null;
    return arr.map(x => String(x || ""));
  }

  function saveSlotIds(ids) {
    writeJson(SLOTS_KEY, { ts: Date.now(), ids: (ids || []).slice(0, 4) });
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

  function initSlotsFromState(list) {
    let idx = -1;
    const camId = lastState?.cam?.id;

    if (Number.isFinite(lastState?.index)) idx = lastState.index | 0;
    if (idx < 0) idx = findIndexById(list, camId);

    const picked = pick4(list, idx);
    const ids = picked.map(c => String(c?.id || ""));
    saveSlotIds(ids);
    return ids;
  }

  function fillMissingSlots(list, ids) {
    const used = new Set(ids.filter(Boolean));
    let ptr = 0;

    for (let i = 0; i < 4; i++) {
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

  // ───────────────────────── Main (root + state)
  const root = ensureCatalogRoot();
  let slots = buildSlots();

  let lastCfgSig = "";
  let lastRenderedIds = ["", "", "", ""];

  function applyCfgToUI() {
    root.style.setProperty("--rlcCatalogGap", `${CFG.gapPx}px`);
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
  }

  // ───────────────────────── 🗳️ Vote engine (random duration)
  const VOTE = {
    on: false,
    startedAt: 0,
    endsAt: 0,
    counts: [0,0,0,0],
    users: new Map(),    // user => slot(0..3)
    lastAnnounceAt: 0
  };

  let voteTimer = null;
  let voteEndTimer = null;

  function randInt(a, b) {
    const min = Math.min(a|0, b|0);
    const max = Math.max(a|0, b|0);
    return (min + ((Math.random() * (max - min + 1)) | 0));
  }

  function stopVoteTimers() {
    if (voteTimer) clearTimeout(voteTimer);
    if (voteEndTimer) clearTimeout(voteEndTimer);
    voteTimer = null;
    voteEndTimer = null;
  }

  function resetVoteState() {
    VOTE.on = false;
    VOTE.startedAt = 0;
    VOTE.endsAt = 0;
    VOTE.counts = [0,0,0,0];
    VOTE.users.clear();
    for (const s of slots) hideVoteChip(s.el);
  }

  function postBus(msg) {
    if (KEY) msg.key = KEY;
    try { bcMain?.postMessage(msg); } catch (_) {}
    try { bcLegacy?.postMessage(msg); } catch (_) {}
  }

  function announceVoteStart() {
    if (!CFG.voteAnnounce) return;

    // anti-spam: mínimo 20s entre anuncios
    const now = Date.now();
    if (now - VOTE.lastAnnounceAt < 20000) return;
    VOTE.lastAnnounceAt = now;

    const text = "🗳️ CATALOGO: Vota qué tile cambia -> !1 !2 !3 !4 (solo cambia esa, las demás se quedan).";
    postBus({ type: "BOT_SAY", text, ts: now });
  }

  function updateVoteUI() {
    if (!CFG.enabled || !CFG.voteEnabled) {
      for (const s of slots) hideVoteChip(s.el);
      return;
    }

    if (!VOTE.on) {
      for (const s of slots) hideVoteChip(s.el);
      return;
    }

    // muestra conteos y tiempo restante
    const leftMs = Math.max(0, VOTE.endsAt - Date.now());
    const left = Math.ceil(leftMs / 1000);

    for (let i = 0; i < 4; i++) {
      const c = VOTE.counts[i] | 0;
      setVoteChip(slots[i].el, `VOTO: ${c} · ${left}s`);
    }
  }

  function scheduleNextVote() {
    stopVoteTimers();
    resetVoteState();

    if (!CFG.enabled || !CFG.voteEnabled) return;
    if (!root.classList.contains("on")) return;

    const delaySec = randInt(CFG.voteEveryMinSec|0, CFG.voteEveryMaxSec|0);
    voteTimer = setTimeout(() => startVoteRound(), delaySec * 1000);
  }

  function startVoteRound() {
    stopVoteTimers();
    resetVoteState();

    if (!CFG.enabled || !CFG.voteEnabled) return;
    if (!root.classList.contains("on")) return;

    VOTE.on = true;
    VOTE.startedAt = Date.now();
    VOTE.endsAt = VOTE.startedAt + (CFG.voteWindowSec|0) * 1000;

    announceVoteStart();
    updateVoteUI();

    // tick UI suave
    const uiTick = () => {
      if (!VOTE.on) return;
      updateVoteUI();
      const left = VOTE.endsAt - Date.now();
      if (left <= 0) return;
      voteEndTimer = setTimeout(uiTick, 300);
    };
    voteEndTimer = setTimeout(uiTick, 300);

    // cierre
    const closeIn = Math.max(0, VOTE.endsAt - Date.now());
    voteTimer = setTimeout(() => endVoteRound(), closeIn);
  }

  function pickVoteWinner() {
    let best = -1;
    let bestCount = -1;
    for (let i = 0; i < 4; i++) {
      const c = VOTE.counts[i] | 0;
      if (c > bestCount) { bestCount = c; best = i; }
    }

    // sin votos
    if (bestCount <= 0) {
      return CFG.voteAllowNoVotes ? ((Math.random() * 4) | 0) : -1;
    }

    // empate: elige random entre empatados
    const tied = [];
    for (let i = 0; i < 4; i++) {
      if ((VOTE.counts[i] | 0) === bestCount) tied.push(i);
    }
    if (tied.length <= 1) return best;
    return tied[(Math.random() * tied.length) | 0];
  }

  function endVoteRound() {
    if (!VOTE.on) { scheduleNextVote(); return; }

    VOTE.on = false;
    const winner = pickVoteWinner();

    // limpia UI
    for (const s of slots) hideVoteChip(s.el);

    // notifica (por si quieres overlay externo)
    try {
      g.dispatchEvent(new CustomEvent("rlc_catalog_vote", {
        detail: {
          phase: "end",
          winnerSlot: winner,
          counts: VOTE.counts.slice(0),
          ts: Date.now()
        }
      }));
    } catch (_) {}

    // aplica resultado: cambia SOLO ese slot (las otras se quedan)
    if (winner >= 0 && winner <= 3) {
      cycleSlot(winner, +1);
    }

    // siguiente ronda aleatoria
    scheduleNextVote();
  }

  function parseVoteSlotFromMsg(msg) {
    if (!msg || typeof msg !== "object") return -1;

    // campos directos
    if (Number.isFinite(msg.slot)) {
      const s = msg.slot | 0;
      if (s >= 0 && s <= 3) return s;
    }
    if (Number.isFinite(msg.followSlot)) {
      const s = msg.followSlot | 0;
      if (s >= 0 && s <= 3) return s;
    }

    // choice 1..4
    if (Number.isFinite(msg.choice)) {
      const c = msg.choice | 0;
      if (c >= 1 && c <= 4) return c - 1;
    }
    if (Number.isFinite(msg.option)) {
      const c = msg.option | 0;
      if (c >= 1 && c <= 4) return c - 1;
    }

    // texto: "!1" / "1" / "cam 2" / "!cam2"
    const t = safeStr(msg.text || msg.message || msg.msg || "");
    if (t) {
      const m = t.match(/(^|\s)!?([1-4])(\s|$)/);
      if (m && m[2]) return (parseInt(m[2], 10) - 1) | 0;

      const m2 = t.match(/!?(?:cam|slot)\s*([1-4])/i);
      if (m2 && m2[1]) return (parseInt(m2[1], 10) - 1) | 0;
    }

    return -1;
  }

  function getUserKeyFromMsg(msg) {
    const u =
      safeStr(msg.user) ||
      safeStr(msg.username) ||
      safeStr(msg.nick) ||
      safeStr(msg.displayName) ||
      safeStr(msg.userName) ||
      safeStr(msg.user_id) ||
      safeStr(msg.userId);
    return u ? u.toLowerCase() : "";
  }

  function applyVoteFromMsg(msg) {
    if (!CFG.enabled || !CFG.voteEnabled) return;
    if (!root.classList.contains("on")) return;
    if (!VOTE.on) return;

    const slot = parseVoteSlotFromMsg(msg);
    if (slot < 0 || slot > 3) return;

    const userKey = getUserKeyFromMsg(msg);

    // 1 voto por usuario (si sabemos quién es)
    if (userKey) {
      const prev = VOTE.users.get(userKey);
      if (Number.isFinite(prev)) {
        const p = prev | 0;
        if (p >= 0 && p <= 3) VOTE.counts[p] = Math.max(0, (VOTE.counts[p] | 0) - 1);
      }
      VOTE.users.set(userKey, slot);
    }

    VOTE.counts[slot] = (VOTE.counts[slot] | 0) + 1;

    try {
      g.dispatchEvent(new CustomEvent("rlc_catalog_vote", {
        detail: { phase: "vote", slot, user: userKey || "", counts: VOTE.counts.slice(0), ts: Date.now() }
      }));
    } catch (_) {}

    updateVoteUI();
  }

  // ───────────────────────── Enable/disable catalog
  function setCatalogEnabled(on) {
    root.classList.toggle("on", !!on);

    setSingleHudVisible(!on);
    signalCatalogMode(!!on);

    if (on) {
      applyCfgToUI();
      setSingleMediaVisible(false);
      startWxRefresh();
      scheduleNextVote();
    } else {
      stopWxRefresh();
      stopVoteTimers();
      resetVoteState();

      for (const s of slots) {
        stopHls(s);
        s._camRef = null;
        s._wxCamId = "";
        hideWxChip(s.el);
        hideVoteChip(s.el);

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
      `m=${CFG.muted ? 1 : 0}`,
      `l=${CFG.labels ? 1 : 0}`,
      `g=${CFG.gapPx | 0}`,
      `ytc=${CFG.ytCookies ? 1 : 0}`,
      `mode=${CFG.mode}`,
      `fs=${CFG.followSlot | 0}`,
      `cc=${CFG.clickCycle ? 1 : 0}`,
      `wx=${CFG.wxTiles ? 1 : 0}`,
      `wxr=${CFG.wxRefreshSec | 0}`,
      `ve=${CFG.voteEnabled ? 1 : 0}`,
      `vw=${CFG.voteWindowSec | 0}`,
      `vmin=${CFG.voteEveryMinSec | 0}`,
      `vmax=${CFG.voteEveryMaxSec | 0}`,
      `va=${CFG.voteAnnounce ? 1 : 0}`,
      `vnv=${CFG.voteAllowNoVotes ? 1 : 0}`
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

    const list = getCamList();
    if (!list.length) return;

    const sig = cfgSig();
    const cfgChanged = (sig !== lastCfgSig);
    if (cfgChanged) lastCfgSig = sig;

    let ids = loadSlotIds();

    if (CFG.mode === "sync") {
      // rotan 4
      let idx = -1;
      const camId = lastState?.cam?.id;
      if (Number.isFinite(lastState?.index)) idx = lastState.index | 0;
      if (idx < 0) idx = findIndexById(list, camId);

      const picked = pick4(list, idx);
      ids = picked.map(c => String(c?.id || ""));
      ids = fillMissingSlots(list, ensureUnique(ids));
      saveSlotIds(ids);
    } else {
      // follow: solo un slot sigue el state
      if (!ids) ids = initSlotsFromState(list);
      ids = fillMissingSlots(list, ensureUnique(ids));

      const cur = getCurrentCamFromState(list);
      const curId = String(cur?.id || "");
      if (curId) {
        const fs = CFG.followSlot | 0;

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

    // render solo tiles cambiados (o todos si cfg cambió)
    for (let i = 0; i < 4; i++) {
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

    if (cfgChanged) {
      startWxRefresh();
      if (CFG.enabled && CFG.voteEnabled) scheduleNextVote();
    }

    // si hay una votación activa, refresca chips (por si re-render)
    updateVoteUI();
  }

  // click-to-cycle: cambia solo ese tile
  function cycleSlot(slotIndex, dir = 1) {
    if (!CFG.enabled || !CFG.clickCycle) return;

    const list = getCamList();
    if (!list.length) return;

    let ids = loadSlotIds();
    if (!ids) ids = initSlotsFromState(list);

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
  function onBusMessage(msg, isMain) {
    if (!msg || typeof msg !== "object") return;

    // cfg
    if (msg.type === "CATALOG_CFG" && msg.cfg && typeof msg.cfg === "object") {
      if (!keyOk(msg, isMain)) return;
      CFG = normalizeCfg(msg.cfg);
      setCatalogEnabled(CFG.enabled);
      updateCatalog();
      return;
    }

    // state
    if (msg.type === "state") {
      if (!keyOk(msg, isMain)) return;
      lastState = msg;
      if (CFG.enabled) updateCatalog();
      return;
    }

    // 🗳️ votos (varios formatos)
    if (
      msg.type === "CATALOG_VOTE" ||
      msg.type === "VOTE_CAST" ||
      msg.type === "CHAT_VOTE" ||
      msg.type === "CHAT"
    ) {
      if (!keyOk(msg, isMain)) return;
      applyVoteFromMsg(msg);
      return;
    }
  }

  if (bcMain) bcMain.onmessage = (ev) => onBusMessage(ev?.data, true);
  if (bcLegacy) bcLegacy.onmessage = (ev) => onBusMessage(ev?.data, false);

  // polling suave
  setInterval(() => {
    const st = readStateFromLS();
    if (st) {
      lastState = st;
      if (CFG.enabled) updateCatalog();
    }
  }, 550);

  // storage cfg
  window.addEventListener("storage", (e) => {
    if (!e) return;
    if (e.key === CFG_KEY || e.key === CFG_KEY_LEGACY) {
      CFG = normalizeCfg(loadCfg());
      setCatalogEnabled(CFG.enabled);
      updateCatalog();
    }
  });

  // al volver a pestaña: refresh WX + vote chips
  document.addEventListener("visibilitychange", () => {
    if (!CFG.enabled) return;
    if (document.visibilityState !== "visible") return;
    for (const s of slots) refreshWxChipSoft(s);
    updateVoteUI();
  });

  // clicks (solo una vez)
  function hookClicksOnce() {
    if (root.dataset.rlcClicksHooked === "1") return;
    root.dataset.rlcClicksHooked = "1";

    for (let i = 0; i < 4; i++) {
      const el = root.querySelector(`.slot[data-slot="${i}"]`);
      if (!el) continue;

      el.addEventListener("click", (ev) => {
        if (!CFG.enabled || !CFG.clickCycle) return;
        const back = !!ev?.shiftKey; // SHIFT => atrás
        cycleSlot(i, back ? -1 : 1);
      });
    }
  }

  function boot() {
    CFG = normalizeCfg(loadCfg());
    setCatalogEnabled(CFG.enabled);

    lastState = readStateFromLS() || lastState;

    hookClicksOnce();
    if (CFG.enabled) updateCatalog();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
