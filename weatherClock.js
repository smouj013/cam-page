/* weatherClock.js — RLC Weather+LocalTime v1.0.1 (NO KEY + NO LAYOUT JUMP)
   ✅ Muestra temperatura + hora local de la cam en el HUD (junto al título)
   ✅ Open-Meteo Geocoding + Weather (gratis, sin key)
   ✅ Cache local (geo + meteo) para no spamear endpoints
   ✅ Key-namespaced (BUS/STATE) compatible con tu sistema
   ✅ window.RLCWx.getSummaryForCam() para catalogView.js
   ✅ Importante: NO inyecta CSS (lo controla styles.css) -> evita reflow “tardío”
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const LOAD_GUARD = "__RLC_WX_LOADED_V101";
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

  // ───────────────────────── UI (sin CSS injection)
  function ensureHudChip() {
    const hudTitle = qs("#hudTitle");
    if (!hudTitle) return null;

    let chip = qs("#rlcHudWx");
    if (chip) return chip;

    chip = document.createElement("div");
    chip.id = "rlcHudWx";
    chip.className = "wxOff"; // ocupa espacio pero no se ve (evita “jumps”)
    chip.innerHTML = `
      <span id="rlcHudWxIcon" aria-hidden="true">🌡️</span>
      <span id="rlcHudWxTemp" class="wxTemp">—°C</span>
      <span class="wxDot" aria-hidden="true">·</span>
      <span id="rlcHudWxTime" class="wxTime">--:--</span>
    `.trim();

    // lo insertamos dentro del mismo contenedor del título (hudLeft)
    hudTitle.parentElement?.appendChild(chip);
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

    const elI = qs("#rlcHudWxIcon");
    const elT = qs("#rlcHudWxTemp");
    const elH = qs("#rlcHudWxTime");

    if (elI) elI.textContent = icon || "🌡️";
    if (elT) elT.textContent = tempText || "—°C";
    if (elH) elH.textContent = timeText || "--:--";

    setHudChipVisible(true);
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

  function normalizePlaceKey(place) {
    return safeStr(place).toLowerCase().replace(/\s+/g, " ").slice(0, 120);
  }

  async function geocodePlace(place, preferLang = "en") {
    const p = safeStr(place);
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
      name: safeStr(r.name),
      country: safeStr(r.country),
      admin1: safeStr(r.admin1),
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      timezone: safeStr(r.timezone)
    };

    if (!Number.isFinite(out.latitude) || !Number.isFinite(out.longitude) || !out.timezone) return null;

    cache[key] = { ts: Date.now(), data: out };
    setGeoCache(cache);

    return out;
  }

  function wxKey(lat, lon, tz) {
    return `${lat.toFixed(3)},${lon.toFixed(3)}@${tz}`;
  }

  async function fetchCurrentWeather(lat, lon, timezone) {
    const cache = getWxCache();
    const k = wxKey(lat, lon, timezone);

    // cache 12 min
    const hit = cache[k];
    if (hit && (Date.now() - (hit.ts || 0) < 12 * 60 * 1000)) return hit.data || null;

    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${encodeURIComponent(String(lat))}` +
      `&longitude=${encodeURIComponent(String(lon))}` +
      `&current=temperature_2m,weather_code,is_day` +
      `&temperature_unit=celsius` +
      `&timezone=${encodeURIComponent(timezone)}`;

    const data = await fetchJson(url);
    const cur = data?.current;
    if (!cur) return null;

    const out = {
      tempC: Number(cur.temperature_2m),
      code: Number(cur.weather_code),
      isDay: (cur.is_day === 1 || cur.is_day === true)
    };

    cache[k] = { ts: Date.now(), data: out };
    setWxCache(cache);

    return out;
  }

  function formatTimeInTZ(timezone) {
    try {
      const lang = (document.documentElement.getAttribute("lang") || "es").toLowerCase();
      const locale = (lang.startsWith("es")) ? "es-ES" : "en-GB";
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
    // prioridad: place -> city -> title
    const p = safeStr(cam?.place || "");
    if (p) return p;
    const c = safeStr(cam?.city || "");
    if (c) return c;
    const t = safeStr(cam?.title || "");
    return t;
  }

  function extractCoords(cam) {
    const lat = Number(cam?.lat ?? cam?.latitude);
    const lon = Number(cam?.lon ?? cam?.lng ?? cam?.longitude);
    const tz = safeStr(cam?.timezone || cam?.tz || "");
    if (Number.isFinite(lat) && Number.isFinite(lon) && tz) return { lat, lon, timezone: tz };
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon, timezone: "" };
    return null;
  }

  // ───────────────────────── Public module for catalog
  let activeTimezone = "";
  let activeTempText = "—°C";
  let activeIcon = "🌡️";

  async function getSummaryForCam(cam) {
    const place = extractPlace(cam);
    if (!place) return null;

    const coords = extractCoords(cam);
    let geo = null;

    if (coords) {
      if (coords.timezone) {
        geo = { latitude: coords.lat, longitude: coords.lon, timezone: coords.timezone };
      } else {
        geo = await geocodePlace(place, "en");
        if (!geo) geo = { latitude: coords.lat, longitude: coords.lon, timezone: "" };
      }
    } else {
      geo = await geocodePlace(place, "en");
    }

    if (!geo || !Number.isFinite(geo.latitude) || !Number.isFinite(geo.longitude) || !geo.timezone) {
      return null;
    }

    const wx = await fetchCurrentWeather(geo.latitude, geo.longitude, geo.timezone);
    if (!wx || !Number.isFinite(wx.tempC)) return null;

    const icon = iconFromCode(wx.code, wx.isDay);
    const temp = `${Math.round(wx.tempC)}°C`;
    const time = formatTimeInTZ(geo.timezone);

    return { icon, temp, time, timezone: geo.timezone };
  }

  // ───────────────────────── HUD integration
  let lastCamId = "";
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
      const t = formatTimeInTZ(activeTimezone);
      setHudChip(activeIcon, activeTempText, t);
    }, 1000);
  }

  async function updateHudForCam(cam) {
    const camId = String(cam?.id || "");
    if (!camId) { setHudChipVisible(false); return; }

    if (camId === lastCamId && activeTimezone) {
      setHudChip(activeIcon, activeTempText, formatTimeInTZ(activeTimezone));
      return;
    }

    lastCamId = camId;
    const token = ++lastReqToken;

    // placeholder rápido (sin “jump” porque el chip ya ocupa espacio)
    setHudChip("🌡️", "…°C", "--:--");

    try {
      const sum = await getSummaryForCam(cam);
      if (token !== lastReqToken) return;

      if (!sum) {
        setHudChipVisible(false);
        activeTimezone = "";
        stopClock();
        return;
      }

      activeTimezone = sum.timezone || "";
      activeIcon = sum.icon || "🌡️";
      activeTempText = sum.temp || "—°C";

      setHudChip(activeIcon, activeTempText, sum.time || "--:--");
      startClock();

      log("HUD WX:", cam?.place, sum);
    } catch (e) {
      if (token !== lastReqToken) return;
      log("HUD WX error:", e?.message || e);
      setHudChipVisible(false);
      activeTimezone = "";
      stopClock();
    }
  }

  // ───────────────────────── State listeners
  let lastState = null;

  function onState(st) {
    lastState = st;
    const cam = st?.cam || null;
    if (!cam) return;
    updateHudForCam(cam);
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
    const st = readStateFromLS();
    if (!st) return;
    const id = String(st?.cam?.id || "");
    const prev = String(lastState?.cam?.id || "");
    if (id && id !== prev) onState(st);
  }, 700);

  // ───────────────────────── Expose module
  g.RLCWx = g.RLCWx || {};
  g.RLCWx.getSummaryForCam = getSummaryForCam;

  function boot() {
    ensureHudChip();
    const st = readStateFromLS();
    if (st) onState(st);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
