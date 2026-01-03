/* rlcTickersControl.js — RLC Unified Tickers Control v2.2.0
   ✅ Unifica NEWS + ECON (solo control.html)
   ✅ Storage por key + legacy/base
   ✅ BroadcastChannel namespaced + legacy + postMessage fallback
   ✅ Inyecta cards si faltan + REPARA si existen incompletas (no rompe tu Control Room)
   ✅ Update-aware singleton: si hay versión previa cargada, se destruye y se aplica la nueva
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
    version: "2.2.0",
    destroy: () => {}
  };
  try { g[INSTANCE_KEY] = instance; } catch (_) {}

  const BUS_BASE = "rlc_bus_v1";
  const qs = (s, r = document) => r.querySelector(s);
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

  const BUS_NS = KEY ? `${BUS_BASE}:${KEY}` : BUS_BASE;

  // Broadcast channels
  const bcNs = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS_NS) : null;
  const bcLegacy = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_BASE) : null;

  // Cleanup refs
  const _cleanup = {
    listeners: [],
    intervals: [],
    observers: []
  };
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

  // ───────────────────────── Shared UI styles
  function ensureCtlStyles() {
    if (qs("#rlcCtlTickersStyle")) return;
    const st = document.createElement("style");
    st.id = "rlcCtlTickersStyle";
    st.textContent = `
/* Unified Tickers Control UI (auto-injected safe styles) */
.rlcCtlCard h3{ margin:0; font:900 12px/1 ui-sans-serif,system-ui; letter-spacing:.12em; text-transform:uppercase; opacity:.9 }
.rlcCtlHeader{ display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px; }
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
.rlcCtlRow textarea{
  min-height:110px; resize:vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size:12px;
}
.rlcCtlBtns{ display:flex; gap:10px; flex-wrap:wrap; margin-top:10px; }
.rlcCtlBtn{
  padding:10px 12px; border-radius:10px; border:1px solid rgba(255,255,255,.16);
  background: rgba(255,255,255,.06); color: rgba(255,255,255,.92);
  cursor:pointer; font:850 12px/1 ui-sans-serif,system-ui;
}
.rlcCtlBtn:hover{ background: rgba(255,255,255,.10); }
.rlcCtlFull{ grid-column: 1 / -1; }
.pill--ok{ border-color: rgba(25,226,138,.35) !important; color: rgba(25,226,138,.95) !important; }
.pill--bad{ border-color: rgba(255,90,90,.35) !important; color: rgba(255,90,90,.95) !important; }
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

    // si ya está dentro, no hacemos nada
    if (cardEl.parentElement === grid) return;

    // si quieres que ECON vaya después del NEWS
    if (afterId) {
      const after = qs(`#${afterId}`, grid);
      if (after && after.parentElement === grid) {
        after.insertAdjacentElement("afterend", cardEl);
        return;
      }
    }
    grid.appendChild(cardEl);
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

  function debounce(fn, ms = 160) {
    let t = 0;
    return () => {
      try { clearTimeout(t); } catch (_) {}
      t = setTimeout(fn, ms);
    };
  }

  // ───────────────────────── Storage helpers
  function readCfg(keyA, keyB) {
    try {
      const r1 = localStorage.getItem(keyA);
      if (r1) return JSON.parse(r1);
    } catch (_) {}
    try {
      const r2 = localStorage.getItem(keyB);
      if (r2) return JSON.parse(r2);
    } catch (_) {}
    return null;
  }

  function writeCfg(keyA, keyB, cfg) {
    const raw = JSON.stringify(cfg);
    try { localStorage.setItem(keyA, raw); } catch (_) {}
    try { localStorage.setItem(keyB, raw); } catch (_) {}
  }

  function clearCfg(keyA, keyB) {
    try { localStorage.removeItem(keyA); } catch (_) {}
    try { localStorage.removeItem(keyB); } catch (_) {}
  }

  // ───────────────────────── BUS emit
  function sendMsg(type, cfg) {
    const msg = { type, cfg, ts: Date.now(), ...(KEY ? { key: KEY } : {}) };
    try { bcNs && bcNs.postMessage(msg); } catch (_) {}
    try { bcLegacy && bcLegacy.postMessage(msg); } catch (_) {}
    try { window.postMessage(msg, "*"); } catch (_) {}
  }

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
      sources: ["gdelt", "googlenews", "bbc", "dw", "guardian"]
    };

    function normalizeTimespan(v) {
      const t = safeStr(v).toLowerCase();
      if (!t) return DEFAULTS.timespan;
      if (/^\d+(min|h|d|w|m)$/.test(t)) return t;
      return DEFAULTS.timespan;
    }

    function normalizeSources(list) {
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

      c.speedPxPerSec = clamp(num(c.speedPxPerSec, DEFAULTS.speedPxPerSec), 20, 140);
      c.refreshMins = clamp(num(c.refreshMins, DEFAULTS.refreshMins), 3, 60);
      c.topPx = clamp(num(c.topPx, DEFAULTS.topPx), 0, 120);
      c.hideOnVote = (c.hideOnVote !== false);

      c.timespan = normalizeTimespan(c.timespan);

      c.bilingual = (c.bilingual !== false);
      c.translateMax = clamp(num(c.translateMax, DEFAULTS.translateMax), 0, 22);

      c.sources = normalizeSources(c.sources);

      return c;
    }

    function renderCardHtml() {
      return `
        <div class="rlcCtlHeader">
          <h3>NEWS TICKER</h3>
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
            <input id="ctlTickerSpeed" type="number" min="20" max="140" step="1" />
          </div>

          <div class="rlcCtlRow">
            <label>Refresh (mins)</label>
            <input id="ctlTickerRefresh" type="number" min="3" max="60" step="1" />
          </div>

          <div class="rlcCtlRow">
            <label>Top (px)</label>
            <input id="ctlTickerTop" type="number" min="0" max="120" step="1" />
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
            <input id="ctlTickerTranslateMax" type="number" min="0" max="22" step="1" />
          </div>

          <div class="rlcCtlRow rlcCtlFull">
            <label>Sources (CSV)</label>
            <input id="ctlTickerSources" placeholder="gdelt,googlenews,bbc,dw,guardian" />
          </div>
        </div>

        <div class="rlcCtlBtns">
          <button class="rlcCtlBtn" id="ctlTickerApply">Aplicar</button>
          <button class="rlcCtlBtn" id="ctlTickerReset">Reset</button>
          <button class="rlcCtlBtn" id="ctlTickerCopyUrl">Copiar URL player</button>
        </div>
      `.trim();
    }

    function ensurePanel() {
      ensureCtlStyles();

      // ✅ repair-mode: si existe el card pero está incompleto, lo reconstruimos
      let card = qs("#ctlTickerCard");
      const okMarkup = !!(qs("#ctlTickerApply") && qs("#ctlTickerOn"));
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
      el.classList.toggle("pill--ok", !!ok);
      el.classList.toggle("pill--bad", !ok);
    }

    function applyUIFromCfg(cfg) {
      const c = normalizeCfg(cfg);

      qs("#ctlTickerOn").value = (c.enabled ? "on" : "off");
      qs("#ctlTickerLang").value = c.lang;
      qs("#ctlTickerSpeed").value = String(c.speedPxPerSec);
      qs("#ctlTickerRefresh").value = String(c.refreshMins);
      qs("#ctlTickerTop").value = String(c.topPx);
      qs("#ctlTickerHideOnVote").value = (c.hideOnVote ? "on" : "off");
      qs("#ctlTickerSpan").value = c.timespan;

      qs("#ctlTickerBilingual").value = (c.bilingual ? "on" : "off");
      qs("#ctlTickerTranslateMax").value = String(c.translateMax);
      qs("#ctlTickerSources").value = (c.sources || []).join(",");

      const where = KEY ? `KEY:${KEY}` : "SIN KEY";
      setStatus(c.enabled ? `Ticker: ON · ${where}` : `Ticker: OFF · ${where}`, c.enabled);
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
        sources
      });
    }

    function buildPlayerUrlWithTicker(cfg) {
      const u = new URL(location.href);
      u.pathname = u.pathname.replace(/[^/]*$/, "index.html");
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
        "#ctlTickerSources"
      ];
      const applyDebounced = debounce(() => doApply(true), 160);

      for (const sel of liveEls) {
        const el = qs(sel);
        if (!el) continue;

        on(el, "change", () => doApply(true));
        on(el, "input", () => {
          const tag = (el.tagName || "").toUpperCase();
          if (tag === "INPUT" || tag === "TEXTAREA") applyDebounced();
        });
      }

      onWin("storage", (e) => {
        if (!e || !e.key) return;
        if (e.key === CFG_KEY_NS || e.key === CFG_KEY_LEGACY) {
          const c = readCfg(CFG_KEY_NS, CFG_KEY_LEGACY);
          if (c) applyUIFromCfg(c);
        }
      });

      // primer push
      try { sendMsg("TICKER_CFG", saved); } catch (_) {}
    }

    return { boot };
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
      ]
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

    function renderCardHtml() {
      return `
        <div class="rlcCtlHeader">
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
    }

    function ensurePanel() {
      ensureCtlStyles();

      let card = qs("#ctlEconCard");
      const okMarkup = !!(qs("#ctlEconApply") && qs("#ctlEconOn"));
      if (!card) {
        card = document.createElement("div");
        card.className = "card rlcCtlCard";
        card.id = "ctlEconCard";
      }
      if (!okMarkup) card.innerHTML = renderCardHtml();

      // ✅ montamos después del NEWS card para que el orden sea pro
      mountCard(card, { afterId: "ctlTickerCard" });
    }

    function setStatus(text, ok = true) {
      const el = qs("#ctlEconStatus");
      if (!el) return;
      el.textContent = text;
      el.classList.toggle("pill--ok", !!ok);
      el.classList.toggle("pill--bad", !ok);
    }

    function applyUIFromCfg(cfg) {
      const c = normalizeCfg(cfg);

      qs("#ctlEconOn").value = (c.enabled ? "on" : "off");
      qs("#ctlEconSpeed").value = String(c.speedPxPerSec);
      qs("#ctlEconRefresh").value = String(c.refreshMins);
      qs("#ctlEconTop").value = String(c.topPx);
      qs("#ctlEconHideOnVote").value = (c.hideOnVote ? "on" : "off");
      qs("#ctlEconMode").value = c.mode;
      qs("#ctlEconClocks").value = (c.showClocks ? "on" : "off");

      qs("#ctlEconItems").value = JSON.stringify(c.items, null, 2);
      qs("#ctlEconClocksJson").value = JSON.stringify(c.clocks, null, 2);

      const where = KEY ? `KEY:${KEY}` : "SIN KEY";
      setStatus(c.enabled ? `Econ: ON · ${where}` : `Econ: OFF · ${where}`, c.enabled);
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
        ...(Array.isArray(items) ? { items } : {}),
        ...(Array.isArray(clocks) ? { clocks } : {})
      });

      if (itemsTa && itemsTa.value.trim() && !Array.isArray(items)) {
        setStatus("Items JSON inválido (usa array) — manteniendo último válido", false);
      }
      if (clocksTa && clocksTa.value.trim() && !Array.isArray(clocks)) {
        setStatus("Clocks JSON inválido (usa array) — manteniendo último válido", false);
      }

      return cfg;
    }

    function buildPlayerUrlWithEcon(cfg) {
      const u = new URL(location.href);
      u.pathname = u.pathname.replace(/[^/]*$/, "index.html");
      if (KEY) u.searchParams.set("key", KEY);

      u.searchParams.set("econ", cfg.enabled ? "1" : "0");
      u.searchParams.set("econSpeed", String(cfg.speedPxPerSec));
      u.searchParams.set("econRefresh", String(cfg.refreshMins));
      u.searchParams.set("econTop", String(cfg.topPx));
      u.searchParams.set("econHideOnVote", cfg.hideOnVote ? "1" : "0");
      u.searchParams.set("econMode", cfg.mode);
      u.searchParams.set("econClocks", cfg.showClocks ? "1" : "0");

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
        if (persist) writeCfg(CFG_KEY_NS, CFG_KEY_LEGACY, cfg);
        sendMsg("ECON_CFG", cfg);
        applyUIFromCfg(cfg);
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

      try { sendMsg("ECON_CFG", saved); } catch (_) {}
    }

    return { boot };
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
