/* weatherClock.js — RLC Weather+LocalTime v1.0.4
   ✅ NO KEY (Open-Meteo)
   ✅ NO FLICKER
   ✅ Se auto-desactiva cuando catálogo 2x2 está ON (solo WX por tile)
   ✅ window.RLCWx.getSummaryForCam() para catalogView.js
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const LOAD_GUARD = "__RLC_WX_LOADED_V104";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  const BUS_BASE = "rlc_bus_v1";
  const STATE_KEY_BASE = "rlc_state_v1";

  const GEO_CACHE_KEY_BASE = "rlc_geo_cache_v1";
  const WX_CACHE_KEY_BASE  = "rlc_wx_cache_v1";

  const qs = (s, r = document) => r.querySelector(s);
  const safeStr = (v) => (typeof v === "string") ? v.trim() : "";

  function parseParams() {
    const u = new URL(location.href);
    return {
      key: safeStr(u.searchParams.get("key") || ""),
      wxDebug: safeStr(u.searchParams.get("wxDebug") || "")
    };
  }
  const P = parseParams();
  const KEY = P.key;

  const BUS = KEY ? `${BUS_BASE}:${KEY}` : BUS_BASE;
  const BUS_LEGACY = BUS_BASE;

  const STATE_KEY = KEY ? `${STATE_KEY_BASE}:${KEY}` : STATE_KEY_BASE;
  const STATE_KEY_LEGACY = STATE_KEY_BASE;

  const GEO_CACHE_KEY = KEY ? `${GEO_CACHE_KEY_BASE}:${KEY}` : GEO_CACHE_KEY_BASE;
  const WX_CACHE_KEY  = KEY ? `${WX_CACHE_KEY_BASE}:${KEY}`  : WX_CACHE_KEY_BASE;

  const DEBUG = (P.wxDebug === "1" || P.wxDebug === "true");
  const log = (...a) => { if (DEBUG) console.log("[RLC:WX]", ...a); };

  const bcMain = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS) : null;
  const bcLegacy = (("BroadcastChannel" in window) && KEY) ? new BroadcastChannel(BUS_LEGACY) : null;

  function keyOk(msg, isMainChannel) {
    if (!KEY) return true;
    if (isMainChannel) return true;
    return (msg && msg.key === KEY);
  }

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

  function getGeoCache() { return readJson(GEO_CACHE_KEY) || {}; }
  function setGeoCache(map) { writeJson(GEO_CACHE_KEY, map || {}); }

  function getWxCache() { return readJson(WX_CACHE_KEY) || {}; }
  function setWxCache(map) { writeJson(WX_CACHE_KEY, map || {}); }

  // ───────────────────────── Catalog mode detection
  function isCatalogOn() {
    try {
      if (document.documentElement?.dataset?.rlcCatalog === "1") return true;
    } catch (_) {}
    const root = qs("#rlcCatalog");
    if (root && root.classList.contains("on")) return true;
    return false;
  }

  // ───────────────────────── UI (HUD chip)
  const HUD = { chip: null, icon: null, temp: null, time: null };

  function findHudAnchor() {
    return (
      qs("#hudTitle") ||
      qs("#hudTitleText") ||
      qs('[data-hud="title"]') ||
      qs(".hudTitle") ||
      qs("#hudLeft") ||
      qs(".hudLeft") ||
      qs("#hud") ||
      qs(".hud") ||
      null
    );
  }

  function ensureHudChip() {
    // ✅ si catálogo ON, no montamos nada
    if (isCatalogOn()) return null;

    if (HUD.chip && HUD.chip.isConnected) return HUD.chip;

    const anchor = findHudAnchor();
    if (!anchor) return null;

    let chip = qs("#rlcHudWx");
    if (!chip) {
      chip = document.createElement("div");
      chip.id = "rlcHudWx";
      chip.className = "wxOff";
      chip.innerHTML = `
        <span id="rlcHudWxIcon" aria-hidden="true">🌡️</span>
        <span id="rlcHudWxTemp" class="wxTemp">—°C</span>
        <span class="wxDot" aria-hidden="true">·</span>
        <span id="rlcHudWxTime" class="wxTime">--:--</span>
      `.trim();

      const parent = anchor.closest("#hudLeft") || anchor.parentElement || anchor;
      try { parent.appendChild(chip); } catch (_) {}
    }

    HUD.chip = chip;
    HUD.icon = qs("#rlcHudWxIcon");
    HUD.temp = qs("#rlcHudWxTemp");
    HUD.time = qs("#rlcHudWxTime");
    return chip;
  }

  function setHudChipVisible(on) {
    const chip = ensureHudChip();
    if (!chip) return;
    chip.classList.toggle("wxOff", !on);
  }

  function setHudChip(icon, tempText, timeText) {
    const chip = ensureHudChip();
    if (!chip) return;

    if (!HUD.icon || !HUD.icon.isConnected) HUD.icon = qs("#rlcHudWxIcon");
    if (!HUD.temp || !HUD.temp.isConnected) HUD.temp = qs("#rlcHudWxTemp");
    if (!HUD.time || !HUD.time.isConnected) HUD.time = qs("#rlcHudWxTime");

    if (HUD.icon) HUD.icon.textContent = icon || "🌡️";
    if (HUD.temp) HUD.temp.textContent = tempText || "—°C";
    if (HUD.time) HUD.time.textContent = timeText || "--:--";
  }

  // ───────────────────────── Open-Meteo helpers
  function iconFromCode(code, isDay) {
    const c = (code | 0);
    const day = (isDay !== false);

    if (c === 0) return day ? "☀️" : "🌙";
    if (c === 1) return day ? "🌤️" : "☁️";
    if (c === 2) return "⛅";
    if (c === 3) return "☁️";
    if (c === 45 || c === 48) return "🌫️";
    if (c >= 51 && c <= 57) return "🌦️";
    if (c >= 61 && c <= 67) return "🌧️";
    if (c >= 71 && c <= 77) return "❄️";
    if (c >= 80 && c <= 82) return "🌧️";
    if (c === 85 || c === 86) return "🌨️";
    if (c === 95) return "⛈️";
    if (c === 96 || c === 99) return "⛈️";
    return "🌡️";
  }

  async function fetchJson(url, timeoutMs = 9000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  function cleanPlaceForGeocode(place) {
    let p = safeStr(place);
    if (!p) return "";

    p = p.replace(/\[[^\]]*\]/g, " ").replace(/\([^)]*\)/g, " ");
    p = p.split("|")[0];
    p = p.split(" — ")[0];
    p = p.split(" - ")[0];
    p = p.replace(/\b(live|webcam|cam|camera|stream|hd|4k|ptz|cctv)\b/gi, " ");
    p = p.replace(/[•·–—]/g, " ");
    p = p.replace(/\s+/g, " ").trim();

    return p.slice(0, 90);
  }

  function normalizePlaceKey(place) {
    return safeStr(place).toLowerCase().replace(/\s+/g, " ").slice(0, 140);
  }

  async function geocodePlace(place, preferLang = "en") {
    const p = cleanPlaceForGeocode(place);
    if (!p) return null;

    const cache = getGeoCache();
    const key = normalizePlaceKey(p);

    // cache 7 días
    const hit = cache[key];
    if (hit && (Date.now() - (hit.ts || 0) < 7 * 24 * 60 * 60 * 1000)) {
      return hit.data || null;
    }

    const url =
      `https://geocoding-api.open-meteo.com/v1/search` +
      `?name=${encodeURIComponent(p)}` +
      `&count=1` +
      `&language=${encodeURIComponent(preferLang)}` +
      `&format=json`;

    const data = await fetchJson(url);
    const r = Array.isArray(data?.results) ? data.results[0] : null;
    if (!r) return null;

    const out = {
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      timezone: safeStr(r.timezone)
    };

    if (!Number.isFinite(out.latitude) || !Number.isFinite(out.longitude) || !out.timezone) return null;

    cache[key] = { ts: Date.now(), data: out };
    setGeoCache(cache);

    return out;
  }

  function wxKey(lat, lon, tzWanted) {
    return `${lat.toFixed(3)},${lon.toFixed(3)}@${safeStr(tzWanted || "auto")}`;
  }

  async function fetchCurrentWeather(lat, lon, tzWanted) {
    const cache = getWxCache();
    const tz = safeStr(tzWanted || "auto");
    const k = wxKey(lat, lon, tz);

    // cache 12 min
    const hit = cache[k];
    if (hit && (Date.now() - (hit.ts || 0) < 12 * 60 * 1000)) return hit.data || null;

    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${encodeURIComponent(String(lat))}` +
      `&longitude=${encodeURIComponent(String(lon))}` +
      `&current=temperature_2m,weather_code,is_day` +
      `&temperature_unit=celsius` +
      `&timezone=${encodeURIComponent(tz)}`;

    const data = await fetchJson(url);
    const cur = data?.current;
    if (!cur) return null;

    const out = {
      tempC: Number(cur.temperature_2m),
      code: Number(cur.weather_code),
      isDay: (cur.is_day === 1 || cur.is_day === true),
      timezone: safeStr(data?.timezone || tzWanted || tz)
    };

    if (!Number.isFinite(out.tempC)) return null;
    if (!out.timezone) return null;

    cache[k] = { ts: Date.now(), data: out };
    setWxCache(cache);

    return out;
  }

  function formatTimeInTZ(timezone) {
    try {
      const lang = (document.documentElement.getAttribute("lang") || "es").toLowerCase();
      const locale = lang.startsWith("es") ? "es-ES" : "en-GB";
      const fmt = new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: timezone
      });
      return fmt.format(new Date());
    } catch (_) {
      const d = new Date();
      return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    }
  }

  function extractPlace(cam) {
    const p = safeStr(cam?.place || "");
    if (p) return p;
    const l = safeStr(cam?.location || "");
    if (l) return l;
    const c = safeStr(cam?.city || "");
    if (c) return c;
    return safeStr(cam?.title || "");
  }

  function extractCoords(cam) {
    const lat = Number(cam?.lat ?? cam?.latitude);
    const lon = Number(cam?.lon ?? cam?.lng ?? cam?.longitude);
    const tz = safeStr(cam?.timezone || cam?.tz || "");
    if (Number.isFinite(lat) && Number.isFinite(lon) && tz) return { lat, lon, timezone: tz };
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon, timezone: "" };
    return null;
  }

  // ───────────────────────── Public module for catalog tiles
  async function getSummaryForCam(cam) {
    const place = extractPlace(cam);
    if (!place) return null;

    const coords = extractCoords(cam);

    if (coords) {
      const wx = await fetchCurrentWeather(coords.lat, coords.lon, coords.timezone || "auto");
      if (!wx) return null;

      const icon = iconFromCode(wx.code, wx.isDay);
      const temp = `${Math.round(wx.tempC)}°C`;
      const tz = wx.timezone;
      const time = formatTimeInTZ(tz);

      return { icon, temp, time, timezone: tz };
    }

    const geo = await geocodePlace(place, "en");
    if (!geo) return null;

    const wx = await fetchCurrentWeather(geo.latitude, geo.longitude, geo.timezone || "auto");
    if (!wx) return null;

    const icon = iconFromCode(wx.code, wx.isDay);
    const temp = `${Math.round(wx.tempC)}°C`;
    const tz = wx.timezone || geo.timezone;
    const time = formatTimeInTZ(tz);

    return { icon, temp, time, timezone: tz, approx: true };
  }

  // ───────────────────────── HUD integration (single mode only)
  let activeTimezone = "";
  let activeTempText = "—°C";
  let activeIcon = "🌡️";
  let hasData = false;

  let lastCamId = "";
  let pendingTimer = null;
  let inFlight = false;
  let lastReqToken = 0;
  let clockTimer = null;

  function stopClock() {
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = null;
  }
  function startClock() {
    stopClock();
    if (!activeTimezone) return;
    clockTimer = setInterval(() => {
      if (!activeTimezone) return;
      setHudChip(activeIcon, activeTempText, formatTimeInTZ(activeTimezone));
    }, 1000);
  }

  function hardDisableForCatalog() {
    stopClock();
    inFlight = false;
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = null;

    // si existe chip, lo apagamos
    try {
      const chip = qs("#rlcHudWx");
      if (chip) chip.classList.add("wxOff");
    } catch (_) {}
  }

  async function runUpdate(cam) {
    // ✅ si catálogo ON, no hacemos nada
    if (isCatalogOn()) return;

    const camId = String(cam?.id || "");
    if (!camId) return;

    if (inFlight && camId === lastCamId) return;

    // misma cam y ya hay data -> solo refresca hora
    if (camId === lastCamId && hasData && activeTimezone) {
      setHudChipVisible(true);
      setHudChip(activeIcon, activeTempText, formatTimeInTZ(activeTimezone));
      return;
    }

    const token = ++lastReqToken;

    setHudChipVisible(true);
    if (!hasData) setHudChip("🌡️", "…°C", "--:--");

    inFlight = true;
    try {
      const sum = await getSummaryForCam(cam);
      if (token !== lastReqToken) return;
      if (isCatalogOn()) return; // si se activó durante el fetch

      if (!sum) {
        activeTimezone = "";
        hasData = false;
        stopClock();
        setHudChip("🌡️", "—°C", "--:--");
        return;
      }

      lastCamId = camId;
      activeTimezone = sum.timezone || "";
      activeIcon = sum.icon || "🌡️";
      activeTempText = sum.temp || "—°C";
      hasData = !!activeTimezone;

      setHudChip(activeIcon, activeTempText, sum.time || "--:--");
      startClock();
      log("HUD WX OK:", { camId, sum });
    } catch (e) {
      if (token !== lastReqToken) return;
      if (isCatalogOn()) return;
      log("HUD WX error:", e?.message || e);

      activeTimezone = "";
      hasData = false;
      stopClock();
      setHudChip("🌡️", "—°C", "--:--");
    } finally {
      inFlight = false;
    }
  }

  function scheduleUpdate(cam) {
    if (isCatalogOn()) return;

    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      runUpdate(cam);
    }, 220);
  }

  // ───────────────────────── State listeners
  let lastState = null;

  function onState(st) {
    lastState = st;
    const cam = st?.cam || null;
    if (!cam) return;
    scheduleUpdate(cam);
  }

  function onBusMessage(msg, isMain) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "state") {
      if (!keyOk(msg, isMain)) return;
      onState(msg);
    }
  }

  if (bcMain) bcMain.onmessage = (ev) => onBusMessage(ev?.data, true);
  if (bcLegacy) bcLegacy.onmessage = (ev) => onBusMessage(ev?.data, false);

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

  // polling suave por si BC falla
  setInterval(() => {
    if (isCatalogOn()) return;
    const st = readStateFromLS();
    if (!st) return;
    const id = String(st?.cam?.id || "");
    const prev = String(lastState?.cam?.id || "");
    if (id && id !== prev) onState(st);
  }, 900);

  // ✅ escucha el modo catálogo que emite catalogView.js
  g.addEventListener?.("rlc_catalog_mode", (ev) => {
    const on = !!ev?.detail?.on;
    if (on) {
      hardDisableForCatalog();
    } else {
      // volver a single: intentar enganchar estado actual
      const st = readStateFromLS() || lastState;
      if (st?.cam) onState(st);
    }
  });

  // ───────────────────────── Expose module
  g.RLCWx = g.RLCWx || {};
  g.RLCWx.getSummaryForCam = getSummaryForCam;

  function boot() {
    // si arranca ya en catálogo, no montamos chip
    if (!isCatalogOn()) ensureHudChip();

    const st = readStateFromLS();
    if (st) onState(st);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
