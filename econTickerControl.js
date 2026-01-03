/* econTickerControl.js — RLC Econ Ticker Control v1.2.0
   ✅ Solo para control.html
   ✅ Guarda config en localStorage (por key y legacy)
   ✅ Emite config por BroadcastChannel (namespaced + legacy/base) + postMessage fallback
   ✅ Soporta #ctlEconCopyUrl para generar URL del player con params del econ ticker
   ✅ Compat EXACTA con econTicker.js v1.0.2 (ECON_CFG + campos cfg)
   ✅ Inyecta UI en Control Room si faltan los elementos (cards)
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const LOAD_GUARD = "__RLC_ECON_TICKER_CONTROL_LOADED_V120";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  const BUS_BASE = "rlc_bus_v1";
  const CFG_KEY_BASE = "rlc_econ_cfg_v1";

  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const safeStr = (v) => (typeof v === "string") ? v.trim() : "";
  const num = (v, fb) => {
    const n = parseFloat(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fb;
  };

  function parseParams() {
    const u = new URL(location.href);
    return { key: safeStr(u.searchParams.get("key") || "") };
  }

  const P = parseParams();
  const KEY = P.key;

  // ✅ Buses
  const BUS_NS = KEY ? `${BUS_BASE}:${KEY}` : BUS_BASE;
  const bcNs = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS_NS) : null;
  const bcLegacy = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_BASE) : null;

  // ✅ Storage keys
  const CFG_KEY_NS = KEY ? `${CFG_KEY_BASE}:${KEY}` : CFG_KEY_BASE;
  const CFG_KEY_LEGACY = CFG_KEY_BASE;

  // ✅ Defaults (deben casar con econTicker.js)
  const DEFAULTS = {
    enabled: true,
    speedPxPerSec: 60,   // 20..140
    refreshMins: 2,      // 1..20
    topPx: 10,           // 0..120
    hideOnVote: true,
    mode: "daily",       // daily|sinceLast
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
    ]
  };

  function normalizeMode(v) {
    const s = safeStr(v).toLowerCase();
    if (s === "sincelast" || s === "since_last" || s === "since-last" || s === "sinceLast") return "sinceLast";
    return "daily";
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
    c.speedPxPerSec = clamp(num(c.speedPxPerSec, DEFAULTS.speedPxPerSec), 20, 140);
    c.refreshMins = clamp(num(c.refreshMins, DEFAULTS.refreshMins), 1, 20);
    c.topPx = clamp(num(c.topPx, DEFAULTS.topPx), 0, 120);
    c.hideOnVote = (c.hideOnVote !== false);
    c.mode = normalizeMode(c.mode);
    c.showClocks = (c.showClocks !== false);

    c.clocks = normalizeClocks(c.clocks);
    c.items = normalizeItems(c.items);

    return c;
  }

  function readCfgFirst() {
    try {
      const raw1 = localStorage.getItem(CFG_KEY_NS);
      if (raw1) return JSON.parse(raw1);
    } catch (_) {}
    try {
      const raw2 = localStorage.getItem(CFG_KEY_LEGACY);
      if (raw2) return JSON.parse(raw2);
    } catch (_) {}
    return null;
  }

  function writeCfgEverywhere(cfg) {
    const raw = JSON.stringify(cfg);
    try { localStorage.setItem(CFG_KEY_NS, raw); } catch (_) {}
    try { localStorage.setItem(CFG_KEY_LEGACY, raw); } catch (_) {}
  }

  function clearCfgEverywhere() {
    try { localStorage.removeItem(CFG_KEY_NS); } catch (_) {}
    try { localStorage.removeItem(CFG_KEY_LEGACY); } catch (_) {}
  }

  function sendCfg(cfg) {
    const msg = {
      type: "ECON_CFG",
      cfg,
      ts: Date.now(),
      ...(KEY ? { key: KEY } : {})
    };

    try { bcNs && bcNs.postMessage(msg); } catch (_) {}
    try { bcLegacy && bcLegacy.postMessage(msg); } catch (_) {}

    // Fallbacks
    try { window.postMessage(msg, "*"); } catch (_) {}
    try { localStorage.setItem("__rlc_econ_ping", String(Date.now())); } catch (_) {}
  }

  function setStatus(text, ok = true) {
    const el = qs("#ctlEconStatus");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("pill--ok", !!ok);
    el.classList.toggle("pill--bad", !ok);
  }

  function ensureCtlStyles() {
    if (qs("#rlcCtlEconStyle")) return;
    const st = document.createElement("style");
    st.id = "rlcCtlEconStyle";
    st.textContent = `
/* Econ Ticker Control UI (auto-injected safe styles) */
.rlcCtlCard h3{ margin:0 0 10px; font:900 12px/1 ui-sans-serif,system-ui; letter-spacing:.12em; text-transform:uppercase; opacity:.9 }
.rlcCtlGrid{ display:grid; gap:10px; grid-template-columns: 1fr 1fr; }
.rlcCtlRow{ display:flex; flex-direction:column; gap:6px; }
.rlcCtlRow label{ font:800 11px/1.1 ui-sans-serif,system-ui; opacity:.75; letter-spacing:.06em; text-transform:uppercase; }
.rlcCtlRow input, .rlcCtlRow select, .rlcCtlRow textarea{
  width:100%; padding:10px 10px; border-radius:10px;
  border:1px solid rgba(255,255,255,.14);
  background: rgba(0,0,0,.24);
  color: rgba(255,255,255,.92);
  outline:none;
}
.rlcCtlRow textarea{ min-height:130px; resize:vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size:12px; }
.rlcCtlBtns{ display:flex; gap:10px; flex-wrap:wrap; margin-top:10px; }
.rlcCtlBtn{
  padding:10px 12px; border-radius:10px; border:1px solid rgba(255,255,255,.16);
  background: rgba(255,255,255,.06); color: rgba(255,255,255,.92);
  cursor:pointer; font:850 12px/1 ui-sans-serif,system-ui;
}
.rlcCtlBtn:hover{ background: rgba(255,255,255,.10); }
.rlcCtlFull{ grid-column: 1 / -1; }
@media (max-width: 720px){
  .rlcCtlGrid{ grid-template-columns: 1fr; }
}
`.trim();
    document.head.appendChild(st);
  }

  function ensurePanel() {
    // Si ya existe el panel, ok
    if (qs("#ctlEconApply") && qs("#ctlEconOn")) return;

    ensureCtlStyles();

    const grid = qs(".controlGrid") || qs(".control-grid") || qs("main .controlGrid") || qs("main") || document.body;

    const card = document.createElement("div");
    card.className = "card rlcCtlCard";
    card.id = "ctlEconCard";
    card.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
        <h3>ECON TICKER</h3>
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
          <input id="ctlEconSpeed" type="number" min="20" max="140" step="1" />
        </div>

        <div class="rlcCtlRow">
          <label>Refresh (mins)</label>
          <input id="ctlEconRefresh" type="number" min="1" max="20" step="1" />
        </div>

        <div class="rlcCtlRow">
          <label>Top (px)</label>
          <input id="ctlEconTop" type="number" min="0" max="120" step="1" />
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
    `.trim();

    // Inserta al final (no rompe tu layout actual)
    grid.appendChild(card);
  }

  function applyUIFromCfg(cfg) {
    const c = normalizeCfg(cfg);

    const on = qs("#ctlEconOn");
    const speed = qs("#ctlEconSpeed");
    const refresh = qs("#ctlEconRefresh");
    const top = qs("#ctlEconTop");
    const hideOnVote = qs("#ctlEconHideOnVote");
    const mode = qs("#ctlEconMode");
    const clocksOnOff = qs("#ctlEconClocks");
    const itemsTa = qs("#ctlEconItems");
    const clocksTa = qs("#ctlEconClocksJson");

    if (on) on.value = (c.enabled ? "on" : "off");
    if (speed) speed.value = String(c.speedPxPerSec);
    if (refresh) refresh.value = String(c.refreshMins);
    if (top) top.value = String(c.topPx);
    if (hideOnVote) hideOnVote.value = (c.hideOnVote ? "on" : "off");
    if (mode) mode.value = c.mode;
    if (clocksOnOff) clocksOnOff.value = (c.showClocks ? "on" : "off");

    if (itemsTa) itemsTa.value = JSON.stringify(c.items, null, 2);
    if (clocksTa) clocksTa.value = JSON.stringify(c.clocks, null, 2);

    const where = KEY ? `KEY:${KEY}` : "SIN KEY";
    setStatus(c.enabled ? `Econ: ON · ${where}` : `Econ: OFF · ${where}`, c.enabled);
  }

  function safeJsonParse(s, fb) {
    try {
      const o = JSON.parse(String(s || ""));
      return (o && typeof o === "object") ? o : fb;
    } catch (_) { return fb; }
  }

  function collectCfgFromUI() {
    const on = qs("#ctlEconOn")?.value || "on";
    const speed = num(qs("#ctlEconSpeed")?.value, DEFAULTS.speedPxPerSec);
    const refresh = num(qs("#ctlEconRefresh")?.value, DEFAULTS.refreshMins);
    const topPx = num(qs("#ctlEconTop")?.value, DEFAULTS.topPx);
    const hideOnVote = (qs("#ctlEconHideOnVote")?.value || "on") !== "off";
    const mode = safeStr(qs("#ctlEconMode")?.value || DEFAULTS.mode);
    const showClocks = (qs("#ctlEconClocks")?.value || "on") !== "off";

    let items;
    const itemsTa = qs("#ctlEconItems");
    if (itemsTa) {
      const parsed = safeJsonParse(itemsTa.value, null);
      if (Array.isArray(parsed)) items = parsed;
    }

    let clocks;
    const clocksTa = qs("#ctlEconClocksJson");
    if (clocksTa) {
      const parsed = safeJsonParse(clocksTa.value, null);
      if (Array.isArray(parsed)) clocks = parsed;
    }

    return normalizeCfg({
      enabled: (on !== "off"),
      speedPxPerSec: speed,
      refreshMins: refresh,
      topPx,
      hideOnVote,
      mode,
      showClocks,
      ...(Array.isArray(items) ? { items } : {}),
      ...(Array.isArray(clocks) ? { clocks } : {})
    });
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
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

  function buildPlayerUrlWithEcon(cfg) {
    const u = new URL(location.href);
    u.pathname = u.pathname.replace(/[^/]*$/, "index.html");
    if (KEY) u.searchParams.set("key", KEY);

    // ✅ Params EXACTOS econTicker.js
    u.searchParams.set("econ", cfg.enabled ? "1" : "0");
    u.searchParams.set("econSpeed", String(cfg.speedPxPerSec));
    u.searchParams.set("econRefresh", String(cfg.refreshMins));
    u.searchParams.set("econTop", String(cfg.topPx));
    u.searchParams.set("econHideOnVote", cfg.hideOnVote ? "1" : "0");
    u.searchParams.set("econMode", cfg.mode);
    u.searchParams.set("econClocks", cfg.showClocks ? "1" : "0");

    return u.toString();
  }

  let tDeb = 0;
  function debounce(fn, ms = 160) {
    return () => {
      try { clearTimeout(tDeb); } catch (_) {}
      tDeb = setTimeout(fn, ms);
    };
  }

  function boot() {
    ensurePanel();

    // Si sigue sin existir, salimos sin romper
    if (!qs("#ctlEconApply") || !qs("#ctlEconOn")) return;

    const saved = normalizeCfg(readCfgFirst() || DEFAULTS);
    writeCfgEverywhere(saved);
    applyUIFromCfg(saved);

    const doApply = (persist = true) => {
      const cfg = collectCfgFromUI();
      if (persist) writeCfgEverywhere(cfg);
      sendCfg(cfg);
      applyUIFromCfg(cfg);
    };

    qs("#ctlEconApply")?.addEventListener("click", () => doApply(true));

    qs("#ctlEconReset")?.addEventListener("click", () => {
      clearCfgEverywhere();
      const cfg = normalizeCfg(DEFAULTS);
      writeCfgEverywhere(cfg);
      sendCfg(cfg);
      applyUIFromCfg(cfg);
    });

    qs("#ctlEconCopyUrl")?.addEventListener("click", async () => {
      const cfg = collectCfgFromUI();
      const url = buildPlayerUrlWithEcon(cfg);
      const ok = await copyToClipboard(url);
      setStatus(ok ? "URL econ copiada ✅" : "No se pudo copiar ❌", ok);
      setTimeout(() => applyUIFromCfg(cfg), 900);
    });

    const liveEls = [
      "#ctlEconOn",
      "#ctlEconSpeed",
      "#ctlEconRefresh",
      "#ctlEconTop",
      "#ctlEconHideOnVote",
      "#ctlEconMode",
      "#ctlEconClocks",
      "#ctlEconItems",
      "#ctlEconClocksJson"
    ];

    const applyDebounced = debounce(() => doApply(true), 180);

    for (const sel of liveEls) {
      const el = qs(sel);
      if (!el) continue;

      el.addEventListener("change", () => doApply(true));
      el.addEventListener("input", () => applyDebounced());
    }

    window.addEventListener("storage", (e) => {
      if (!e || !e.key) return;
      if (e.key === CFG_KEY_NS || e.key === CFG_KEY_LEGACY) {
        const c = readCfgFirst();
        if (c) applyUIFromCfg(c);
      }
    });

    try { sendCfg(saved); } catch (_) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
