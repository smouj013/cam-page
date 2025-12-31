/* catalogView.js — RLC Catalog View v1.0.2 (CCTV 2x2 + WX chip + HIDE SINGLE HUD)
   ✅ Modo catálogo 4 cams (2x2)
   ✅ Oculta HUD single cuando catálogo está ON
   ✅ Señaliza modo catálogo: dataset + CustomEvent ("rlc_catalog_mode")
   ✅ Si existe window.RLCWx (weatherClock.js), muestra temp+hora en cada tile
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const LOAD_GUARD = "__RLC_CATALOG_VIEW_LOADED_V102";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  const BUS_BASE = "rlc_bus_v1";
  const STATE_KEY_BASE = "rlc_state_v1";
  const CFG_BASE = "rlc_catalog_cfg_v1";

  const qs = (s, r = document) => r.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const safeStr = (v) => (typeof v === "string") ? v.trim() : "";

  function parseParams() {
    const u = new URL(location.href);
    return { key: (u.searchParams.get("key") || "").trim() };
  }
  const KEY = String(parseParams().key || "").trim();

  const BUS = KEY ? `${BUS_BASE}:${KEY}` : BUS_BASE;
  const BUS_LEGACY = BUS_BASE;

  const STATE_KEY = KEY ? `${STATE_KEY_BASE}:${KEY}` : STATE_KEY_BASE;
  const STATE_KEY_LEGACY = STATE_KEY_BASE;

  const CFG_KEY = KEY ? `${CFG_BASE}:${KEY}` : CFG_BASE;
  const CFG_KEY_LEGACY = CFG_BASE;

  const bcMain = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS) : null;
  const bcLegacy = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_LEGACY) : null;

  const DEFAULTS = {
    enabled: false,
    layout: "quad",
    gapPx: 8,
    labels: true,
    muted: true
  };

  function readJson(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return (obj && typeof obj === "object") ? obj : null;
    } catch (_) { return null; }
  }

  function normalizeCfg(inCfg) {
    const c = Object.assign({}, DEFAULTS, inCfg || {});
    c.enabled = (c.enabled === true);
    c.layout = "quad";
    c.gapPx = clamp(parseInt(c.gapPx, 10) || DEFAULTS.gapPx, 0, 24);
    c.labels = (c.labels !== false);
    c.muted = (c.muted !== false);
    return c;
  }

  function loadCfg() {
    return normalizeCfg(readJson(CFG_KEY) || readJson(CFG_KEY_LEGACY) || DEFAULTS);
  }

  let lastState = null;
  let CFG = loadCfg();

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

  // ───────────────────────── UI
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
              <div class="chip wx" data-chip="wx" style="display:none">🌡️ —°C · --:--</div>
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

  // ✅ NUEVO: ocultar/mostrar HUD single (el panel “normal”)
  let _hudEl = null;
  let _hudPrevDisplay = "";
  function findHudEl() {
    return qs(".hud") || qs("#hud") || qs("#rlcHud") || null;
  }
  function setSingleHudVisible(on) {
    if (!_hudEl || !_hudEl.isConnected) _hudEl = findHudEl();
    if (!_hudEl) return;

    if (on) {
      _hudEl.style.display = _hudPrevDisplay || "";
    } else {
      if (_hudPrevDisplay === "") _hudPrevDisplay = _hudEl.style.display || "";
      _hudEl.style.display = "none";
    }
  }

  // ✅ NUEVO: señal global para otros módulos (weatherClock)
  function signalCatalogMode(on) {
    try {
      document.documentElement.dataset.rlcCatalog = on ? "1" : "0";
    } catch (_) {}
    try {
      g.dispatchEvent(new CustomEvent("rlc_catalog_mode", { detail: { on: !!on, ts: Date.now() } }));
    } catch (_) {}
  }

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

  function detectKind(url) {
    const u = String(url || "").toLowerCase();
    if (!u) return "iframe";
    if (u.includes("youtube.com") || u.includes("youtu.be") || u.includes("youtube-nocookie.com")) return "yt";
    if (u.endsWith(".m3u8") || u.includes(".m3u8?")) return "hls";
    if (/\.(png|jpg|jpeg|gif|webp)(\?|#|$)/i.test(u)) return "img";
    return "iframe";
  }

  function extractUrl(cam) {
    // soporte para tu catálogo (youtubeId/url/originUrl)
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
    if (/\/embed\//i.test(u)) {
      const o = new URL(u, location.href);
      o.searchParams.set("autoplay", "1");
      o.searchParams.set("mute", "1");
      o.searchParams.set("controls", "0");
      o.searchParams.set("playsinline", "1");
      o.searchParams.set("rel", "0");
      return o.toString();
    }

    const m1 = u.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/i);
    const m2 = u.match(/[?&]v=([A-Za-z0-9_-]{6,})/i);
    const id = (m1 && m1[1]) || (m2 && m2[1]) || "";
    if (!id) return u;

    const o = new URL(`https://www.youtube-nocookie.com/embed/${id}`);
    o.searchParams.set("autoplay", "1");
    o.searchParams.set("mute", "1");
    o.searchParams.set("controls", "0");
    o.searchParams.set("playsinline", "1");
    o.searchParams.set("rel", "0");
    return o.toString();
  }

  function stopHls(slot) {
    try { slot._hls?.destroy?.(); } catch (_) {}
    slot._hls = null;
  }

  function showOnly(slot, kind) {
    if (slot.iframe) slot.iframe.style.display = (kind === "iframe" || kind === "yt") ? "block" : "none";
    if (slot.video) slot.video.style.display = (kind === "hls") ? "block" : "none";
    if (slot.img) slot.img.style.display = (kind === "img") ? "block" : "none";
  }

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

  async function setWxChip(slotEl, cam) {
    const chip = slotEl.querySelector('[data-chip="wx"]');
    if (!chip) return;

    const WX = g.RLCWx;
    if (!WX || typeof WX.getSummaryForCam !== "function") {
      chip.style.display = "none";
      return;
    }

    chip.style.display = "";
    chip.textContent = "🌡️ …";

    const token = String(Date.now()) + ":" + Math.random().toString(16).slice(2);
    slotEl.dataset.wxTok = token;

    try {
      const sum = await WX.getSummaryForCam(cam);
      if (slotEl.dataset.wxTok !== token) return;

      if (!sum) {
        chip.style.display = "none";
        return;
      }

      chip.style.display = "";
      chip.textContent = `${sum.icon || "🌡️"} ${sum.temp || "—°C"} · ${sum.time || "--:--"}`;
    } catch (_) {
      if (slotEl.dataset.wxTok !== token) return;
      chip.style.display = "none";
    }
  }

  function renderCamIntoSlot(slot, cam, n) {
    const slotEl = slot.el;
    slotEl.classList.remove("offline");

    const urlRaw = extractUrl(cam);
    const kind = detectKind(urlRaw);

    setLabel(slotEl, cam, n);
    setWxChip(slotEl, cam);

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
    const slots = [];
    for (let i = 0; i < 4; i++) {
      const el = root.querySelector(`.slot[data-slot="${i}"]`);
      if (!el) continue;
      slots.push({
        el,
        iframe: el.querySelector("iframe"),
        video: el.querySelector("video"),
        img: el.querySelector("img"),
        _hls: null
      });
    }
    return slots;
  }

  const root = ensureCatalogRoot();
  let slots = buildSlots();
  let lastSig = "";

  function applyCfgToUI() {
    root.style.setProperty("--rlcCatalogGap", `${CFG.gapPx}px`);
  }

  function setCatalogEnabled(on) {
    root.classList.toggle("on", !!on);

    // ✅ clave: esconder/mostrar HUD single
    setSingleHudVisible(!on);

    // ✅ avisar a otros módulos (weatherClock)
    signalCatalogMode(!!on);

    if (on) {
      applyCfgToUI();
      setSingleMediaVisible(false);
    } else {
      for (const s of slots) {
        stopHls(s);
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

  function updateCatalogFromState() {
    if (!CFG.enabled) return;

    const list = getCamList();
    if (!list.length) return;

    const camId = lastState?.cam?.id;
    let idx = -1;

    if (Number.isFinite(lastState?.index)) idx = lastState.index | 0;
    if (idx < 0) idx = findIndexById(list, camId);

    const picked = pick4(list, idx);
    const sig = picked.map(x => String(x?.id || "")).join("|") + `|m=${CFG.muted?1:0}|l=${CFG.labels?1:0}|g=${CFG.gapPx|0}`;
    if (sig === lastSig) return;
    lastSig = sig;

    applyCfgToUI();

    for (let i = 0; i < 4; i++) {
      renderCamIntoSlot(slots[i], picked[i], i + 1);
    }
  }

  function onBusMessage(msg, isMain) {
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "CATALOG_CFG" && msg.cfg && typeof msg.cfg === "object") {
      if (!keyOk(msg, isMain)) return;
      CFG = normalizeCfg(msg.cfg);
      setCatalogEnabled(CFG.enabled);
      updateCatalogFromState();
      return;
    }

    if (msg.type === "state") {
      if (!keyOk(msg, isMain)) return;
      lastState = msg;
      if (CFG.enabled) updateCatalogFromState();
      return;
    }
  }

  if (bcMain) bcMain.onmessage = (ev) => onBusMessage(ev?.data, true);
  if (bcLegacy) bcLegacy.onmessage = (ev) => onBusMessage(ev?.data, false);

  setInterval(() => {
    const st = readStateFromLS();
    if (st) {
      lastState = st;
      if (CFG.enabled) updateCatalogFromState();
    }
  }, 550);

  window.addEventListener("storage", (e) => {
    if (!e) return;
    if (e.key === CFG_KEY || e.key === CFG_KEY_LEGACY) {
      CFG = normalizeCfg(loadCfg());
      setCatalogEnabled(CFG.enabled);
      updateCatalogFromState();
    }
  });

  function boot() {
    CFG = normalizeCfg(loadCfg());
    setCatalogEnabled(CFG.enabled);
    lastState = readStateFromLS() || lastState;
    if (CFG.enabled) updateCatalogFromState();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
