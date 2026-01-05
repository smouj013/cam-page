/* rlcTickersControl.js — RLC Unified Tickers Control v2.3.9 (NEWSROOM)
   ✅ Unifica NEWS + ECON (solo control.html)
   ✅ 2.3.9 COMPAT:
      - KEY auto: window.RLC_KEY / ?key= / localStorage rlc_last_key_v1
      - BUS auto: window.RLC_BUS / window.RLC_BUS_BASE / rlc_bus_v1:{key}
      - Storage por key + legacy/base (mirror)
      - BroadcastChannel namespaced + legacy + postMessage same-origin fallback
   ✅ Inyecta cards si faltan + REPARA si existen incompletas (no rompe tu Control Room)
   ✅ Update-aware singleton: destruye versión previa y limpia listeners/BC/timers
   ✅ NUEVO (sin romper nada): controles de “escala”/tamaño de barra y texto
      - tickerUiScale / tickerBarH / tickerFontPx (NEWS)
      - econUiScale / econBarH / econFontPx (ECON)
      (Si tu player no los usa todavía, simplemente los ignora → 0 breaks)
   ✅ Preview “noticiero” en el panel (para ver cómo quedará sin glitches)
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  // ───────────────────────── Update-aware singleton
  const INSTANCE_KEY = "__RLC_TICKERS_CONTROL_INSTANCE";
  try {
    if (g[INSTANCE_KEY] && typeof g[INSTANCE_KEY].destroy === "function") {
      g[INSTANCE_KEY].destroy();
    }
  } catch (_) {}

  const instance = {
    version: "2.3.9",
    destroy: () => {}
  };
  try { g[INSTANCE_KEY] = instance; } catch (_) {}

  // ───────────────────────── helpers
  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const safeStr = (v) => (typeof v === "string") ? v.trim() : "";
  const num = (v, fb) => {
    const n = parseFloat(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fb;
  };
  const safeJson = (raw, fb = null) => { try { return JSON.parse(raw); } catch (_) { return fb; } };
  const parseBool = (v, def = false) => {
    if (v == null) return def;
    const s = String(v).trim().toLowerCase();
    if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
    if (s === "0" || s === "false" || s === "no" || s === "off") return false;
    return def;
  };

  function debounce(fn, ms = 170) {
    let t = 0;
    return () => {
      try { clearTimeout(t); } catch (_) {}
      t = setTimeout(fn, ms);
    };
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
        ta.style.left = "-9999px";
        ta.style.top = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return !!ok;
      } catch (_) { return false; }
    }
  }

  // ───────────────────────── Key + Bus (2.3.9 compat)
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (_) {} }

  function parseParams() {
    const u = new URL(location.href);
    return { key: safeStr(u.searchParams.get("key") || "") };
  }

  const P = parseParams();

  const KEY = (() => {
    const k1 = safeStr(g.RLC_KEY || "");
    if (k1) return k1;

    const k2 = safeStr(P.key || "");
    if (k2) return k2;

    const k3 = safeStr(lsGet("rlc_last_key_v1") || "");
    return k3 || "";
  })();

  const BUS_BASE_FALLBACK = "rlc_bus_v1";
  const BUS_BASE = safeStr(g.RLC_BUS_BASE || "") || BUS_BASE_FALLBACK;

  const BUS_NS = (() => {
    const b = safeStr(g.RLC_BUS || "");
    if (b) return b;
    return KEY ? `${BUS_BASE}:${KEY}` : BUS_BASE;
  })();

  // Broadcast channels
  const bcNs = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS_NS) : null;
  const bcLegacy = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_BASE) : null;

  // ───────────────────────── Cleanup refs
  const _cleanup = { listeners: [], intervals: [], observers: [] };
  function on(el, ev, fn, opts) {
    if (!el) return;
    el.addEventListener(ev, fn, opts);
    _cleanup.listeners.push(() => el.removeEventListener(ev, fn, opts));
  }
  function onWin(ev, fn, opts) { on(window, ev, fn, opts); }

  // destroy
  instance.destroy = () => {
    try { _cleanup.listeners.forEach(fn => fn()); } catch (_) {}
    try { _cleanup.intervals.forEach(id => clearInterval(id)); } catch (_) {}
    try { _cleanup.observers.forEach(o => { try { o.disconnect(); } catch (_) {} }); } catch (_) {}

    try { if (bcNs) bcNs.close(); } catch (_) {}
    try { if (bcLegacy) bcLegacy.close(); } catch (_) {}

    try { if (g[INSTANCE_KEY] === instance) delete g[INSTANCE_KEY]; } catch (_) {}
  };

  // ───────────────────────── Shared UI styles (NEWSROOM)
  function ensureCtlStyles() {
    if (qs("#rlcCtlTickersStyle")) return;
    const st = document.createElement("style");
    st.id = "rlcCtlTickersStyle";
    st.textContent = `
/* Unified Tickers Control UI (Neo-Atlas / Newsroom) */
.rlcCtlCard h3{ margin:0; font:950 12px/1 ui-sans-serif,system-ui; letter-spacing:.18em; text-transform:uppercase; opacity:.92 }
.rlcCtlHeader{ display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px; }
.rlcCtlGrid{ display:grid; gap:10px; grid-template-columns: 1fr 1fr; }
.rlcCtlRow{ display:flex; flex-direction:column; gap:6px; }
.rlcCtlRow label{ font:850 11px/1.1 ui-sans-serif,system-ui; opacity:.78; letter-spacing:.08em; text-transform:uppercase; }
.rlcCtlRow input, .rlcCtlRow select, .rlcCtlRow textarea{
  width:100%;
  padding:10px 10px;
  border-radius:12px;
  border:1px solid rgba(255,255,255,.14);
  background: rgba(0,0,0,.26);
  color: rgba(255,255,255,.92);
  outline:none;
}
.rlcCtlRow input:focus, .rlcCtlRow select:focus, .rlcCtlRow textarea:focus{
  border-color: rgba(55,214,255,.35);
  box-shadow: 0 0 0 3px rgba(55,214,255,.10);
}
.rlcCtlRow textarea{
  min-height:120px; resize:vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size:12px;
}
.rlcCtlBtns{ display:flex; gap:10px; flex-wrap:wrap; margin-top:10px; }
.rlcCtlBtn{
  padding:10px 12px;
  border-radius:12px;
  border:1px solid rgba(255,255,255,.16);
  background: rgba(255,255,255,.06);
  color: rgba(255,255,255,.94);
  cursor:pointer;
  font:900 12px/1 ui-sans-serif,system-ui;
}
.rlcCtlBtn:hover{ background: rgba(255,255,255,.10); }
.rlcCtlBtn:active{ transform: translateY(1px); }
.rlcCtlFull{ grid-column: 1 / -1; }
.pill--ok{ border-color: rgba(25,226,138,.35) !important; color: rgba(25,226,138,.95) !important; }
.pill--bad{ border-color: rgba(255,90,90,.35) !important; color: rgba(255,90,90,.95) !important; }

.rlcCtlHint{
  margin-top:10px;
  opacity:.78;
  font: 800 12px/1.35 ui-sans-serif,system-ui;
}
.rlcCtlHint b{ opacity:.92; }

.rlcCtlPreview{
  margin-top:12px;
  border-radius:16px;
  border:1px solid rgba(255,255,255,.12);
  background: linear-gradient(180deg, rgba(10,12,18,.62), rgba(10,12,18,.84));
  box-shadow: 0 10px 35px rgba(0,0,0,.35);
  overflow:hidden;
}
.rlcCtlPreview .bar{
  height: var(--barH, 34px);
  display:flex;
  align-items:center;
  gap:10px;
  padding: 0 12px;
  transform-origin: left center;
  transform: scale(var(--uiScale, 1));
  background:
    radial-gradient(600px 160px at 15% 0%, rgba(55,214,255,.18), transparent 60%),
    radial-gradient(560px 160px at 100% 0%, rgba(255,206,87,.10), transparent 60%),
    linear-gradient(180deg, rgba(0,0,0,.25), rgba(0,0,0,.38));
}
.rlcCtlPreview .badge{
  flex: 0 0 auto;
  font: 950 10px/1 ui-sans-serif,system-ui;
  letter-spacing:.22em;
  text-transform: uppercase;
  padding: 7px 10px;
  border-radius: 999px;
  border:1px solid rgba(255,255,255,.14);
  background: rgba(255,255,255,.08);
  color: rgba(255,255,255,.92);
}
.rlcCtlPreview .text{
  min-width:0;
  flex:1 1 auto;
  font: 900 var(--fontPx, 12px)/1.05 ui-sans-serif,system-ui;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: rgba(255,255,255,.92);
}
.rlcCtlPreview .sub{
  padding:10px 12px;
  display:flex;
  justify-content:space-between;
  gap:10px;
  font: 800 11px/1.2 ui-sans-serif,system-ui;
  color: rgba(255,255,255,.72);
  background: rgba(255,255,255,.04);
  border-top:1px solid rgba(255,255,255,.08);
}
.rlcCtlPreview .sub .mono{
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  opacity:.9;
}
@media (max-width: 720px){
  .rlcCtlGrid{ grid-template-columns: 1fr; }
}
`.trim();
    document.head.appendChild(st);
  }

  function pickGrid() {
    return (
      qs(".controlGrid") ||
      qs(".control-grid") ||
      qs("main .controlGrid") ||
      qs("main") ||
      document.body
    );
  }

  function mountCard(cardEl, { afterId = "" } = {}) {
    const grid = pickGrid();
    if (!grid || !cardEl) return;

    if (cardEl.parentElement === grid) return;

    if (afterId) {
      const after = qs(`#${afterId}`, grid);
      if (after && after.parentElement === grid) {
        after.insertAdjacentElement("afterend", cardEl);
        return;
      }
    }
    grid.appendChild(cardEl);
  }

  // ───────────────────────── Storage helpers
  function readCfg(keyA, keyB) {
    const a = safeJson(lsGet(keyA), null);
    if (a && typeof a === "object") return a;
    const b = safeJson(lsGet(keyB), null);
    if (b && typeof b === "object") return b;
    return null;
  }

  function writeCfg(keyA, keyB, cfg) {
    const raw = JSON.stringify(cfg);
    lsSet(keyA, raw);
    lsSet(keyB, raw); // mirror legacy
  }

  function clearCfg(keyA, keyB) {
    lsDel(keyA);
    lsDel(keyB);
  }

  // ───────────────────────── BUS emit/receive (dedupe)
  const lastSeen = { TICKER_CFG: { ts: 0, sig: "" }, ECON_CFG: { ts: 0, sig: "" } };

  function stableSig(msg) {
    try {
      const payload = msg?.cfg || {};
      return `${msg?.type || ""}|${msg?.ts || 0}|${JSON.stringify(payload)}`;
    } catch (_) {
      return `${msg?.type || ""}|${msg?.ts || 0}|x`;
    }
  }

  function shouldAccept(msg) {
    const type = String(msg?.type || "");
    if (!type || !lastSeen[type]) return false;
    const ts = (msg?.ts | 0) || 0;
    const sig = stableSig(msg);
    const prev = lastSeen[type];
    if (!ts) return true;
    if (ts > prev.ts) { prev.ts = ts; prev.sig = sig; return true; }
    if (ts === prev.ts && sig && sig !== prev.sig) { prev.sig = sig; return true; }
    return false;
  }

  function sendMsg(type, cfg) {
    const msg = { type, cfg, ts: Date.now(), ...(KEY ? { key: KEY } : {}) };
    try { bcNs && bcNs.postMessage(msg); } catch (_) {}
    try { bcLegacy && bcLegacy.postMessage(msg); } catch (_) {}
    // postMessage same-origin
    try { window.postMessage(msg, location.origin); } catch (_) {}
  }

  function recvMsg(msg) {
    if (!msg || typeof msg !== "object") return;
    if (!shouldAccept(msg)) return;

    // si hay KEY, solo acepta mensajes con esa key (o sin key en casos legacy)
    if (KEY) {
      const mk = safeStr(msg.key || "");
      if (mk && mk !== KEY) return;
    }

    if (msg.type === "TICKER_CFG") {
      try { NEWS.onExternalCfg(msg.cfg); } catch (_) {}
      return;
    }
    if (msg.type === "ECON_CFG") {
      try { ECON.onExternalCfg(msg.cfg); } catch (_) {}
      return;
    }
  }

  try { if (bcNs) bcNs.onmessage = (ev) => recvMsg(ev?.data); } catch (_) {}
  try { if (bcLegacy) bcLegacy.onmessage = (ev) => recvMsg(ev?.data); } catch (_) {}

  onWin("message", (ev) => {
    try { if (ev.origin && ev.origin !== location.origin) return; } catch (_) {}
    recvMsg(ev?.data);
  }, { passive: true });

  // ======================================================================
  // NEWS CONTROL
  // ======================================================================
  const NEWS = (() => {
    const CFG_KEY_BASE = "rlc_ticker_cfg_v1";
    const CFG_KEY_NS = KEY ? `${CFG_KEY_BASE}:${KEY}` : CFG_KEY_BASE;
    const CFG_KEY_LEGACY = CFG_KEY_BASE;

    const DEFAULTS = {
      enabled: true,
      lang: "auto",
      speedPxPerSec: 55,
      refreshMins: 12,
      topPx: 10,
      hideOnVote: true,
      timespan: "1d",
      bilingual: true,
      translateMax: 10,
      sources: ["gdelt", "googlenews", "bbc", "dw", "guardian"],

      // ✅ NUEVO (2.3.9) — escalado visual (player puede ignorarlo sin romper)
      uiScale: 1.0,      // 0.75..1.40
      barH: 34,          // 24..54
      fontPx: 12         // 10..18
    };

    function normalizeTimespan(v) {
      const t = safeStr(v).toLowerCase();
      if (!t) return DEFAULTS.timespan;
      if (/^\d+(min|h|d|w|m)$/.test(t)) return t;
      return DEFAULTS.timespan;
    }

    function normalizeSources(list) {
      // Allowed list “base” (no rompe). Tu rlcTickers.js (player) puede soportar más;
      // aquí solo evitamos typos. Si quieres permitir ANY, cambia allowed=null.
      const allowed = new Set(["gdelt","googlenews","bbc","dw","guardian"]);
      const arr = Array.isArray(list)
        ? list
        : String(list || "").split(",").map(s => safeStr(s).toLowerCase()).filter(Boolean);

      const out = [];
      for (const s of arr) {
        if (!allowed.has(s)) continue;
        if (!out.includes(s)) out.push(s);
      }
      return out.length ? out : DEFAULTS.sources.slice();
    }

    function normalizeCfg(inCfg) {
      const c = Object.assign({}, DEFAULTS, inCfg || {});
      c.enabled = (c.enabled !== false);

      const lang = safeStr(c.lang);
      c.lang = (lang === "es" || lang === "en" || lang === "auto") ? lang : "auto";

      c.speedPxPerSec = clamp(num(c.speedPxPerSec, DEFAULTS.speedPxPerSec), 20, 160);
      c.refreshMins = clamp(num(c.refreshMins, DEFAULTS.refreshMins), 3, 90);
      c.topPx = clamp(num(c.topPx, DEFAULTS.topPx), 0, 160);
      c.hideOnVote = (c.hideOnVote !== false);

      c.timespan = normalizeTimespan(c.timespan);

      c.bilingual = (c.bilingual !== false);
      c.translateMax = clamp(num(c.translateMax, DEFAULTS.translateMax), 0, 30);

      c.sources = normalizeSources(c.sources);

      // scale controls
      c.uiScale = clamp(num(c.uiScale, DEFAULTS.uiScale), 0.75, 1.40);
      c.barH = clamp(num(c.barH, DEFAULTS.barH), 24, 54);
      c.fontPx = clamp(num(c.fontPx, DEFAULTS.fontPx), 10, 18);

      return c;
    }

    function renderCardHtml() {
      return `
        <div class="rlcCtlHeader">
          <h3>🗞️ NEWS TICKER</h3>
          <div class="pill mono" id="ctlTickerStatus">Ticker: —</div>
        </div>

        <div class="rlcCtlGrid">
          <div class="rlcCtlRow">
            <label>Enabled</label>
            <select id="ctlTickerOn">
              <option value="on">ON</option>
              <option value="off">OFF</option>
            </select>
          </div>

          <div class="rlcCtlRow">
            <label>Language</label>
            <select id="ctlTickerLang">
              <option value="auto">auto</option>
              <option value="en">en</option>
              <option value="es">es</option>
            </select>
          </div>

          <div class="rlcCtlRow">
            <label>Speed (px/s)</label>
            <input id="ctlTickerSpeed" type="number" min="20" max="160" step="1" />
          </div>

          <div class="rlcCtlRow">
            <label>Refresh (mins)</label>
            <input id="ctlTickerRefresh" type="number" min="3" max="90" step="1" />
          </div>

          <div class="rlcCtlRow">
            <label>Top (px)</label>
            <input id="ctlTickerTop" type="number" min="0" max="160" step="1" />
          </div>

          <div class="rlcCtlRow">
            <label>Hide on vote</label>
            <select id="ctlTickerHideOnVote">
              <option value="on">ON</option>
              <option value="off">OFF</option>
            </select>
          </div>

          <div class="rlcCtlRow">
            <label>Timespan</label>
            <input id="ctlTickerSpan" placeholder="1d / 12h / 30min / 1w..." />
          </div>

          <div class="rlcCtlRow">
            <label>Bilingual</label>
            <select id="ctlTickerBilingual">
              <option value="on">ON</option>
              <option value="off">OFF</option>
            </select>
          </div>

          <div class="rlcCtlRow">
            <label>Translate max</label>
            <input id="ctlTickerTranslateMax" type="number" min="0" max="30" step="1" />
          </div>

          <div class="rlcCtlRow rlcCtlFull">
            <label>Sources (CSV)</label>
            <input id="ctlTickerSources" placeholder="gdelt,googlenews,bbc,dw,guardian" />
          </div>

          <div class="rlcCtlRow">
            <label>UI scale</label>
            <input id="ctlTickerUiScale" type="number" min="0.75" max="1.40" step="0.05" />
          </div>

          <div class="rlcCtlRow">
            <label>Bar height (px)</label>
            <input id="ctlTickerBarH" type="number" min="24" max="54" step="1" />
          </div>

          <div class="rlcCtlRow">
            <label>Font (px)</label>
            <input id="ctlTickerFontPx" type="number" min="10" max="18" step="1" />
          </div>
        </div>

        <div class="rlcCtlBtns">
          <button class="rlcCtlBtn" id="ctlTickerApply">Aplicar</button>
          <button class="rlcCtlBtn" id="ctlTickerReset">Reset</button>
          <button class="rlcCtlBtn" id="ctlTickerCopyUrl">Copiar URL player</button>
        </div>

        <div class="rlcCtlPreview" id="ctlTickerPreview">
          <div class="bar" id="ctlTickerPreviewBar">
            <div class="badge">NEWS</div>
            <div class="text" id="ctlTickerPreviewText">
              BREAKING · GlobalEye TV · Cams en directo por todo el mundo ·
              Vota para cambiar de cámara ✈️🎫
            </div>
          </div>
          <div class="sub">
            <div>Vista previa (noticiero)</div>
            <div class="mono" id="ctlTickerPreviewMeta">—</div>
          </div>
        </div>

        <div class="rlcCtlHint">
          Tip: si en el player “solo ves dos rayas”, suele ser CSS/altura.
          Con <b>Bar height</b> + <b>Font</b> lo dejas perfecto sin glitches.
        </div>
      `.trim();
    }

    function ensurePanel() {
      ensureCtlStyles();

      // repair-mode: si existe el card pero está incompleto, lo reconstruimos
      let card = qs("#ctlTickerCard");
      const okMarkup = !!(qs("#ctlTickerApply") && qs("#ctlTickerOn") && qs("#ctlTickerSources"));
      if (!card) {
        card = document.createElement("div");
        card.className = "card rlcCtlCard";
        card.id = "ctlTickerCard";
      }
      if (!okMarkup) card.innerHTML = renderCardHtml();

      mountCard(card);
    }

    function setStatus(text, ok = true) {
      const el = qs("#ctlTickerStatus");
      if (!el) return;
      el.textContent = text;
      try {
        el.classList.toggle("pill--ok", !!ok);
        el.classList.toggle("pill--bad", !ok);
      } catch (_) {}
    }

    function applyPreviewFromCfg(cfg) {
      const c = normalizeCfg(cfg);
      const bar = qs("#ctlTickerPreviewBar");
      const meta = qs("#ctlTickerPreviewMeta");
      if (!bar) return;

      try {
        bar.style.setProperty("--uiScale", String(c.uiScale));
        bar.style.setProperty("--barH", `${c.barH}px`);
        bar.style.setProperty("--fontPx", `${c.fontPx}px`);
      } catch (_) {}

      if (meta) {
        meta.textContent = `scale=${c.uiScale.toFixed(2)} · h=${c.barH}px · font=${c.fontPx}px`;
      }
    }

    function applyUIFromCfg(cfg) {
      const c = normalizeCfg(cfg);

      const elOn = qs("#ctlTickerOn");
      const elLang = qs("#ctlTickerLang");
      const elSpeed = qs("#ctlTickerSpeed");
      const elRefresh = qs("#ctlTickerRefresh");
      const elTop = qs("#ctlTickerTop");
      const elHide = qs("#ctlTickerHideOnVote");
      const elSpan = qs("#ctlTickerSpan");
      const elBi = qs("#ctlTickerBilingual");
      const elTr = qs("#ctlTickerTranslateMax");
      const elSrc = qs("#ctlTickerSources");

      const elScale = qs("#ctlTickerUiScale");
      const elBarH = qs("#ctlTickerBarH");
      const elFont = qs("#ctlTickerFontPx");

      if (elOn) elOn.value = (c.enabled ? "on" : "off");
      if (elLang) elLang.value = c.lang;
      if (elSpeed) elSpeed.value = String(c.speedPxPerSec);
      if (elRefresh) elRefresh.value = String(c.refreshMins);
      if (elTop) elTop.value = String(c.topPx);
      if (elHide) elHide.value = (c.hideOnVote ? "on" : "off");
      if (elSpan) elSpan.value = c.timespan;

      if (elBi) elBi.value = (c.bilingual ? "on" : "off");
      if (elTr) elTr.value = String(c.translateMax);
      if (elSrc) elSrc.value = (c.sources || []).join(",");

      if (elScale) elScale.value = String(c.uiScale);
      if (elBarH) elBarH.value = String(c.barH);
      if (elFont) elFont.value = String(c.fontPx);

      const where = KEY ? `KEY:${KEY}` : "SIN KEY";
      setStatus(c.enabled ? `Ticker: ON · ${where}` : `Ticker: OFF · ${where}`, c.enabled);

      applyPreviewFromCfg(c);
    }

    function collectCfgFromUI() {
      const onv = qs("#ctlTickerOn")?.value || "on";
      const lang = qs("#ctlTickerLang")?.value || "auto";
      const speed = num(qs("#ctlTickerSpeed")?.value, DEFAULTS.speedPxPerSec);
      const refresh = num(qs("#ctlTickerRefresh")?.value, DEFAULTS.refreshMins);
      const topPx = num(qs("#ctlTickerTop")?.value, DEFAULTS.topPx);
      const hideOnVote = (qs("#ctlTickerHideOnVote")?.value || "on") !== "off";
      const timespan = safeStr(qs("#ctlTickerSpan")?.value || DEFAULTS.timespan);

      const bilingual = (qs("#ctlTickerBilingual")?.value || "on") !== "off";
      const translateMax = num(qs("#ctlTickerTranslateMax")?.value, DEFAULTS.translateMax);
      const sources = normalizeSources(qs("#ctlTickerSources")?.value || "");

      const uiScale = num(qs("#ctlTickerUiScale")?.value, DEFAULTS.uiScale);
      const barH = num(qs("#ctlTickerBarH")?.value, DEFAULTS.barH);
      const fontPx = num(qs("#ctlTickerFontPx")?.value, DEFAULTS.fontPx);

      return normalizeCfg({
        enabled: (onv !== "off"),
        lang,
        speedPxPerSec: speed,
        refreshMins: refresh,
        topPx,
        hideOnVote,
        timespan,
        bilingual,
        translateMax,
        sources,
        uiScale,
        barH,
        fontPx
      });
    }

    function buildPlayerUrlWithTicker(cfg) {
      const u = new URL(location.href);

      // control.html → index.html (robusto)
      const p = u.pathname || "";
      if (/control\.html?$/i.test(p)) u.pathname = p.replace(/control\.html?$/i, "index.html");
      else if (/\/control$/i.test(p)) u.pathname = p.replace(/\/control$/i, "/index.html");
      else if (!/\.html$/i.test(p)) u.pathname = p.replace(/\/?$/, "/index.html");

      if (KEY) u.searchParams.set("key", KEY);

      u.searchParams.set("ticker", cfg.enabled ? "1" : "0");
      u.searchParams.set("tickerLang", cfg.lang);
      u.searchParams.set("tickerSpeed", String(cfg.speedPxPerSec));
      u.searchParams.set("tickerRefresh", String(cfg.refreshMins));
      u.searchParams.set("tickerTop", String(cfg.topPx));
      u.searchParams.set("tickerHideOnVote", cfg.hideOnVote ? "1" : "0");
      u.searchParams.set("tickerSpan", cfg.timespan);

      u.searchParams.set("tickerBilingual", cfg.bilingual ? "1" : "0");
      u.searchParams.set("tickerTranslateMax", String(cfg.translateMax));
      u.searchParams.set("tickerSources", normalizeSources(cfg.sources).join(","));

      // ✅ NUEVO (2.3.9): escalado (player puede ignorar sin romper)
      u.searchParams.set("tickerUiScale", String(cfg.uiScale));
      u.searchParams.set("tickerBarH", String(cfg.barH));
      u.searchParams.set("tickerFontPx", String(cfg.fontPx));

      return u.toString();
    }

    function boot() {
      ensurePanel();
      if (!qs("#ctlTickerApply") || !qs("#ctlTickerOn")) return;

      const saved = normalizeCfg(readCfg(CFG_KEY_NS, CFG_KEY_LEGACY) || DEFAULTS);
      writeCfg(CFG_KEY_NS, CFG_KEY_LEGACY, saved);
      applyUIFromCfg(saved);

      const doApply = (persist = true) => {
        const cfg = collectCfgFromUI();
        if (persist) writeCfg(CFG_KEY_NS, CFG_KEY_LEGACY, cfg);
        sendMsg("TICKER_CFG", cfg);
        applyUIFromCfg(cfg);
      };

      on(qs("#ctlTickerApply"), "click", () => doApply(true));
      on(qs("#ctlTickerReset"), "click", () => {
        clearCfg(CFG_KEY_NS, CFG_KEY_LEGACY);
        const cfg = normalizeCfg(DEFAULTS);
        writeCfg(CFG_KEY_NS, CFG_KEY_LEGACY, cfg);
        sendMsg("TICKER_CFG", cfg);
        applyUIFromCfg(cfg);
      });

      on(qs("#ctlTickerCopyUrl"), "click", async () => {
        const cfg = collectCfgFromUI();
        const url = buildPlayerUrlWithTicker(cfg);
        const ok = await copyToClipboard(url);
        setStatus(ok ? "URL ticker copiada ✅" : "No se pudo copiar ❌", ok);
        setTimeout(() => applyUIFromCfg(cfg), 900);
      });

      // live apply (sin glitches)
      const liveEls = [
        "#ctlTickerOn",
        "#ctlTickerLang",
        "#ctlTickerSpeed",
        "#ctlTickerRefresh",
        "#ctlTickerTop",
        "#ctlTickerHideOnVote",
        "#ctlTickerSpan",
        "#ctlTickerBilingual",
        "#ctlTickerTranslateMax",
        "#ctlTickerSources",
        "#ctlTickerUiScale",
        "#ctlTickerBarH",
        "#ctlTickerFontPx"
      ];
      const applyDebounced = debounce(() => doApply(true), 180);

      for (const sel of liveEls) {
        const el = qs(sel);
        if (!el) continue;
        on(el, "change", () => doApply(true));
        on(el, "input", () => applyDebounced());
      }

      onWin("storage", (e) => {
        if (!e || !e.key) return;
        if (e.key === CFG_KEY_NS || e.key === CFG_KEY_LEGACY) {
          const c = readCfg(CFG_KEY_NS, CFG_KEY_LEGACY);
          if (c) applyUIFromCfg(c);
        }
      });

      // primer push (para sincronizar player si está abierto)
      try { sendMsg("TICKER_CFG", saved); } catch (_) {}
    }

    function onExternalCfg(cfg) {
      const c = normalizeCfg(cfg || {});
      writeCfg(CFG_KEY_NS, CFG_KEY_LEGACY, c);
      applyUIFromCfg(c);
    }

    return { boot, onExternalCfg };
  })();

  // ======================================================================
  // ECON CONTROL
  // ======================================================================
  const ECON = (() => {
    const CFG_KEY_BASE = "rlc_econ_cfg_v1";
    const CFG_KEY_NS = KEY ? `${CFG_KEY_BASE}:${KEY}` : CFG_KEY_BASE;
    const CFG_KEY_LEGACY = CFG_KEY_BASE;

    const DEFAULTS = {
      enabled: true,
      speedPxPerSec: 60,
      refreshMins: 2,
      topPx: 10,
      hideOnVote: true,
      mode: "daily",
      showClocks: true,
      clocks: [
        { label: "MAD", country: "ES", tz: "Europe/Madrid" },
        { label: "NY",  country: "US", tz: "America/New_York" },
        { label: "LDN", country: "GB", tz: "Europe/London" },
        { label: "TYO", country: "JP", tz: "Asia/Tokyo" }
      ],
      items: [
        { id:"btc",  label:"BTC/USD", stooq:"btcusd", kind:"crypto", currency:"USD", decimals:0, country:"UN", tz:"UTC", iconSlug:"bitcoin" },
        { id:"eth",  label:"ETH/USD", stooq:"ethusd", kind:"crypto", currency:"USD", decimals:0, country:"UN", tz:"UTC", iconSlug:"ethereum" },
        { id:"eurusd", label:"EUR/USD", stooq:"eurusd", kind:"fx", currency:"USD", decimals:4, country:"EU", tz:"Europe/Brussels", iconSlug:"euro" },
        { id:"aapl", label:"AAPL", stooq:"aapl.us", kind:"stock", currency:"USD", decimals:2, country:"US", tz:"America/New_York", iconSlug:"apple", domain:"apple.com" },
        { id:"tsla", label:"TSLA", stooq:"tsla.us", kind:"stock", currency:"USD", decimals:2, country:"US", tz:"America/New_York", iconSlug:"tesla", domain:"tesla.com" }
      ],

      // ✅ NUEVO (2.3.9) — escalado visual (player puede ignorarlo sin romper)
      uiScale: 1.0,  // 0.75..1.40
      barH: 36,      // 24..54
      fontPx: 12     // 10..18
    };

    function normalizeMode(v) {
      const s = safeStr(v).toLowerCase();
      return s.includes("since") ? "sinceLast" : "daily";
    }

    function normalizeClocks(list) {
      const arr = Array.isArray(list) ? list : [];
      const out = [];
      for (const c of arr) {
        const label = safeStr(c?.label).slice(0, 8) || "CLK";
        const country = safeStr(c?.country).toUpperCase() || "UN";
        const tz = safeStr(c?.tz) || "UTC";
        if (!tz) continue;
        out.push({ label, country, tz });
      }
      return out.length ? out : DEFAULTS.clocks.slice();
    }

    function normalizeItems(list) {
      const arr = Array.isArray(list) ? list : [];
      const out = [];
      for (const it of arr) {
        const stooq = safeStr(it?.stooq);
        if (!stooq) continue;

        out.push({
          id: safeStr(it?.id) || stooq,
          label: safeStr(it?.label) || stooq.toUpperCase(),
          stooq,
          kind: safeStr(it?.kind) || "asset",
          currency: safeStr(it?.currency).toUpperCase() || "USD",
          decimals: clamp(num(it?.decimals, 2), 0, 8),
          country: safeStr(it?.country).toUpperCase() || "UN",
          tz: safeStr(it?.tz) || "UTC",
          iconSlug: safeStr(it?.iconSlug) || "",
          domain: safeStr(it?.domain) || "",
          glyph: safeStr(it?.glyph) || ""
        });
      }
      return out.length ? out : DEFAULTS.items.slice();
    }

    function normalizeCfg(inCfg) {
      const c = Object.assign({}, DEFAULTS, inCfg || {});
      c.enabled = (c.enabled !== false);
      c.speedPxPerSec = clamp(num(c.speedPxPerSec, DEFAULTS.speedPxPerSec), 20, 160);
      c.refreshMins = clamp(num(c.refreshMins, DEFAULTS.refreshMins), 1, 30);
      c.topPx = clamp(num(c.topPx, DEFAULTS.topPx), 0, 160);
      c.hideOnVote = (c.hideOnVote !== false);
      c.mode = normalizeMode(c.mode);
      c.showClocks = (c.showClocks !== false);
      c.clocks = normalizeClocks(c.clocks);
      c.items = normalizeItems(c.items);

      c.uiScale = clamp(num(c.uiScale, DEFAULTS.uiScale), 0.75, 1.40);
      c.barH = clamp(num(c.barH, DEFAULTS.barH), 24, 54);
      c.fontPx = clamp(num(c.fontPx, DEFAULTS.fontPx), 10, 18);

      return c;
    }

    function renderCardHtml() {
      return `
        <div class="rlcCtlHeader">
          <h3>📈 ECON TICKER</h3>
          <div class="pill mono" id="ctlEconStatus">Econ: —</div>
        </div>

        <div class="rlcCtlGrid">
          <div class="rlcCtlRow">
            <label>Enabled</label>
            <select id="ctlEconOn">
              <option value="on">ON</option>
              <option value="off">OFF</option>
            </select>
          </div>

          <div class="rlcCtlRow">
            <label>Hide on vote</label>
            <select id="ctlEconHideOnVote">
              <option value="on">ON</option>
              <option value="off">OFF</option>
            </select>
          </div>

          <div class="rlcCtlRow">
            <label>Speed (px/s)</label>
            <input id="ctlEconSpeed" type="number" min="20" max="160" step="1" />
          </div>

          <div class="rlcCtlRow">
            <label>Refresh (mins)</label>
            <input id="ctlEconRefresh" type="number" min="1" max="30" step="1" />
          </div>

          <div class="rlcCtlRow">
            <label>Top (px)</label>
            <input id="ctlEconTop" type="number" min="0" max="160" step="1" />
          </div>

          <div class="rlcCtlRow">
            <label>Mode</label>
            <select id="ctlEconMode">
              <option value="daily">daily</option>
              <option value="sinceLast">sinceLast</option>
            </select>
          </div>

          <div class="rlcCtlRow">
            <label>Clocks</label>
            <select id="ctlEconClocks">
              <option value="on">ON</option>
              <option value="off">OFF</option>
            </select>
          </div>

          <div class="rlcCtlRow">
            <label>UI scale</label>
            <input id="ctlEconUiScale" type="number" min="0.75" max="1.40" step="0.05" />
          </div>

          <div class="rlcCtlRow">
            <label>Bar height (px)</label>
            <input id="ctlEconBarH" type="number" min="24" max="54" step="1" />
          </div>

          <div class="rlcCtlRow">
            <label>Font (px)</label>
            <input id="ctlEconFontPx" type="number" min="10" max="18" step="1" />
          </div>

          <div class="rlcCtlRow rlcCtlFull">
            <label>Items (JSON array)</label>
            <textarea id="ctlEconItems" spellcheck="false"></textarea>
          </div>

          <div class="rlcCtlRow rlcCtlFull">
            <label>Clocks (JSON array) (opcional)</label>
            <textarea id="ctlEconClocksJson" spellcheck="false"></textarea>
          </div>
        </div>

        <div class="rlcCtlBtns">
          <button class="rlcCtlBtn" id="ctlEconApply">Aplicar</button>
          <button class="rlcCtlBtn" id="ctlEconReset">Reset</button>
          <button class="rlcCtlBtn" id="ctlEconCopyUrl">Copiar URL player</button>
        </div>

        <div class="rlcCtlPreview" id="ctlEconPreview">
          <div class="bar" id="ctlEconPreviewBar">
            <div class="badge">ECON</div>
            <div class="text" id="ctlEconPreviewText">
              BTC +2.1% · ETH +1.4% · EUR/USD 1.09 · NASDAQ +0.6% ·
              Suscriptores: perks de cámara 🚀
            </div>
          </div>
          <div class="sub">
            <div>Vista previa (noticiero)</div>
            <div class="mono" id="ctlEconPreviewMeta">—</div>
          </div>
        </div>
      `.trim();
    }

    function ensurePanel() {
      ensureCtlStyles();

      let card = qs("#ctlEconCard");
      const okMarkup = !!(qs("#ctlEconApply") && qs("#ctlEconOn") && qs("#ctlEconItems"));
      if (!card) {
        card = document.createElement("div");
        card.className = "card rlcCtlCard";
        card.id = "ctlEconCard";
      }
      if (!okMarkup) card.innerHTML = renderCardHtml();

      // montamos después del NEWS
      mountCard(card, { afterId: "ctlTickerCard" });
    }

    function setStatus(text, ok = true) {
      const el = qs("#ctlEconStatus");
      if (!el) return;
      el.textContent = text;
      try {
        el.classList.toggle("pill--ok", !!ok);
        el.classList.toggle("pill--bad", !ok);
      } catch (_) {}
    }

    function applyPreviewFromCfg(cfg) {
      const c = normalizeCfg(cfg);
      const bar = qs("#ctlEconPreviewBar");
      const meta = qs("#ctlEconPreviewMeta");
      if (!bar) return;

      try {
        bar.style.setProperty("--uiScale", String(c.uiScale));
        bar.style.setProperty("--barH", `${c.barH}px`);
        bar.style.setProperty("--fontPx", `${c.fontPx}px`);
      } catch (_) {}

      if (meta) {
        meta.textContent = `scale=${c.uiScale.toFixed(2)} · h=${c.barH}px · font=${c.fontPx}px`;
      }
    }

    function applyUIFromCfg(cfg) {
      const c = normalizeCfg(cfg);

      const elOn = qs("#ctlEconOn");
      const elSpeed = qs("#ctlEconSpeed");
      const elRefresh = qs("#ctlEconRefresh");
      const elTop = qs("#ctlEconTop");
      const elHide = qs("#ctlEconHideOnVote");
      const elMode = qs("#ctlEconMode");
      const elClocks = qs("#ctlEconClocks");

      const elScale = qs("#ctlEconUiScale");
      const elBarH = qs("#ctlEconBarH");
      const elFont = qs("#ctlEconFontPx");

      const taItems = qs("#ctlEconItems");
      const taClocks = qs("#ctlEconClocksJson");

      if (elOn) elOn.value = (c.enabled ? "on" : "off");
      if (elSpeed) elSpeed.value = String(c.speedPxPerSec);
      if (elRefresh) elRefresh.value = String(c.refreshMins);
      if (elTop) elTop.value = String(c.topPx);
      if (elHide) elHide.value = (c.hideOnVote ? "on" : "off");
      if (elMode) elMode.value = c.mode;
      if (elClocks) elClocks.value = (c.showClocks ? "on" : "off");

      if (elScale) elScale.value = String(c.uiScale);
      if (elBarH) elBarH.value = String(c.barH);
      if (elFont) elFont.value = String(c.fontPx);

      if (taItems) taItems.value = JSON.stringify(c.items, null, 2);
      if (taClocks) taClocks.value = JSON.stringify(c.clocks, null, 2);

      const where = KEY ? `KEY:${KEY}` : "SIN KEY";
      setStatus(c.enabled ? `Econ: ON · ${where}` : `Econ: OFF · ${where}`, c.enabled);

      applyPreviewFromCfg(c);
    }

    function safeJsonParse(s) {
      try { return JSON.parse(String(s || "")); } catch (_) { return null; }
    }

    function collectCfgFromUI() {
      const onv = qs("#ctlEconOn")?.value || "on";
      const speed = num(qs("#ctlEconSpeed")?.value, DEFAULTS.speedPxPerSec);
      const refresh = num(qs("#ctlEconRefresh")?.value, DEFAULTS.refreshMins);
      const topPx = num(qs("#ctlEconTop")?.value, DEFAULTS.topPx);
      const hideOnVote = (qs("#ctlEconHideOnVote")?.value || "on") !== "off";
      const mode = safeStr(qs("#ctlEconMode")?.value || DEFAULTS.mode);
      const showClocks = (qs("#ctlEconClocks")?.value || "on") !== "off";

      const uiScale = num(qs("#ctlEconUiScale")?.value, DEFAULTS.uiScale);
      const barH = num(qs("#ctlEconBarH")?.value, DEFAULTS.barH);
      const fontPx = num(qs("#ctlEconFontPx")?.value, DEFAULTS.fontPx);

      let items;
      const itemsTa = qs("#ctlEconItems");
      if (itemsTa) {
        const parsed = safeJsonParse(itemsTa.value);
        if (Array.isArray(parsed)) items = parsed;
      }

      let clocks;
      const clocksTa = qs("#ctlEconClocksJson");
      if (clocksTa) {
        const parsed = safeJsonParse(clocksTa.value);
        if (Array.isArray(parsed)) clocks = parsed;
      }

      const cfg = normalizeCfg({
        enabled: (onv !== "off"),
        speedPxPerSec: speed,
        refreshMins: refresh,
        topPx,
        hideOnVote,
        mode,
        showClocks,
        uiScale,
        barH,
        fontPx,
        ...(Array.isArray(items) ? { items } : {}),
        ...(Array.isArray(clocks) ? { clocks } : {})
      });

      // Si JSON inválido, no rompemos: mantenemos último válido en storage (cuando aplique).
      // Aquí solo avisamos con pill.
      if (itemsTa && itemsTa.value.trim() && !Array.isArray(items)) {
        setStatus("Items JSON inválido (usa array) — se mantiene último válido", false);
      } else if (clocksTa && clocksTa.value.trim() && !Array.isArray(clocks)) {
        setStatus("Clocks JSON inválido (usa array) — se mantiene último válido", false);
      }

      return cfg;
    }

    function buildPlayerUrlWithEcon(cfg) {
      const u = new URL(location.href);

      // control.html → index.html (robusto)
      const p = u.pathname || "";
      if (/control\.html?$/i.test(p)) u.pathname = p.replace(/control\.html?$/i, "index.html");
      else if (/\/control$/i.test(p)) u.pathname = p.replace(/\/control$/i, "/index.html");
      else if (!/\.html$/i.test(p)) u.pathname = p.replace(/\/?$/, "/index.html");

      if (KEY) u.searchParams.set("key", KEY);

      u.searchParams.set("econ", cfg.enabled ? "1" : "0");
      u.searchParams.set("econSpeed", String(cfg.speedPxPerSec));
      u.searchParams.set("econRefresh", String(cfg.refreshMins));
      u.searchParams.set("econTop", String(cfg.topPx));
      u.searchParams.set("econHideOnVote", cfg.hideOnVote ? "1" : "0");
      u.searchParams.set("econMode", cfg.mode);
      u.searchParams.set("econClocks", cfg.showClocks ? "1" : "0");

      // ✅ NUEVO (2.3.9): escalado (player puede ignorar sin romper)
      u.searchParams.set("econUiScale", String(cfg.uiScale));
      u.searchParams.set("econBarH", String(cfg.barH));
      u.searchParams.set("econFontPx", String(cfg.fontPx));

      return u.toString();
    }

    function boot() {
      ensurePanel();
      if (!qs("#ctlEconApply") || !qs("#ctlEconOn")) return;

      const saved = normalizeCfg(readCfg(CFG_KEY_NS, CFG_KEY_LEGACY) || DEFAULTS);
      writeCfg(CFG_KEY_NS, CFG_KEY_LEGACY, saved);
      applyUIFromCfg(saved);

      const doApply = (persist = true) => {
        const cfg = collectCfgFromUI();

        // Solo persistimos si los JSON son válidos o si están vacíos
        const itemsTa = qs("#ctlEconItems");
        const clocksTa = qs("#ctlEconClocksJson");

        const itemsParsed = itemsTa ? safeJsonParse(itemsTa.value) : null;
        const clocksParsed = clocksTa ? safeJsonParse(clocksTa.value) : null;

        const itemsOk = !itemsTa || !itemsTa.value.trim() || Array.isArray(itemsParsed);
        const clocksOk = !clocksTa || !clocksTa.value.trim() || Array.isArray(clocksParsed);

        if (persist && itemsOk && clocksOk) writeCfg(CFG_KEY_NS, CFG_KEY_LEGACY, cfg);
        sendMsg("ECON_CFG", cfg);
        applyUIFromCfg(persist && itemsOk && clocksOk ? cfg : (readCfg(CFG_KEY_NS, CFG_KEY_LEGACY) || cfg));
      };

      on(qs("#ctlEconApply"), "click", () => doApply(true));
      on(qs("#ctlEconReset"), "click", () => {
        clearCfg(CFG_KEY_NS, CFG_KEY_LEGACY);
        const cfg = normalizeCfg(DEFAULTS);
        writeCfg(CFG_KEY_NS, CFG_KEY_LEGACY, cfg);
        sendMsg("ECON_CFG", cfg);
        applyUIFromCfg(cfg);
      });

      on(qs("#ctlEconCopyUrl"), "click", async () => {
        const cfg = collectCfgFromUI();
        const url = buildPlayerUrlWithEcon(cfg);
        const ok = await copyToClipboard(url);
        setStatus(ok ? "URL econ copiada ✅" : "No se pudo copiar ❌", ok);
        setTimeout(() => applyUIFromCfg(cfg), 900);
      });

      // live apply (sin glitches) — JSON textarea con debounce un poco mayor
      const applyDebouncedFast = debounce(() => doApply(true), 200);
      const applyDebouncedJson = debounce(() => doApply(true), 350);

      const liveElsFast = [
        "#ctlEconOn",
        "#ctlEconSpeed",
        "#ctlEconRefresh",
        "#ctlEconTop",
        "#ctlEconHideOnVote",
        "#ctlEconMode",
        "#ctlEconClocks",
        "#ctlEconUiScale",
        "#ctlEconBarH",
        "#ctlEconFontPx"
      ];

      for (const sel of liveElsFast) {
        const el = qs(sel);
        if (!el) continue;
        on(el, "change", () => doApply(true));
        on(el, "input", () => applyDebouncedFast());
      }

      const jsonEls = ["#ctlEconItems", "#ctlEconClocksJson"];
      for (const sel of jsonEls) {
        const el = qs(sel);
        if (!el) continue;
        on(el, "input", () => applyDebouncedJson());
        on(el, "change", () => applyDebouncedJson());
      }

      onWin("storage", (e) => {
        if (!e || !e.key) return;
        if (e.key === CFG_KEY_NS || e.key === CFG_KEY_LEGACY) {
          const c = readCfg(CFG_KEY_NS, CFG_KEY_LEGACY);
          if (c) applyUIFromCfg(c);
        }
      });

      try { sendMsg("ECON_CFG", saved); } catch (_) {}
    }

    function onExternalCfg(cfg) {
      const c = normalizeCfg(cfg || {});
      writeCfg(CFG_KEY_NS, CFG_KEY_LEGACY, c);
      applyUIFromCfg(c);
    }

    return { boot, onExternalCfg };
  })();

  // ───────────────────────── boot (hard safe: si uno falla, el otro sigue)
  function boot() {
    try { NEWS.boot(); } catch (e) { console.warn("[RLC:TICKERS:CTL] NEWS boot failed", e); }
    try { ECON.boot(); } catch (e) { console.warn("[RLC:TICKERS:CTL] ECON boot failed", e); }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
