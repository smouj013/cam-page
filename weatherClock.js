/* weatherClock.js — RLC Weather+LocalTime v1.0.5
   ✅ NO KEY (Open-Meteo)
   ✅ NO FLICKER (oculta hasta tener datos válidos)
   ✅ Se auto-desactiva cuando catálogo 2x2 está ON (solo WX por tile)
   ✅ window.RLCWx.getSummaryForCam() para catalogView.js
   ✅ Si timezone/hora/temp inválidos -> NO muestra contenedor (HUD) y devuelve null (tiles)
   ✅ NO fallback a hora local (evita horas incorrectas)
   ✅ Retry con backoff si falla API/geocode
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const LOAD_GUARD = "__RLC_WX_LOADED_V105";
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
      chip.className = "wxOff"; // ✅ empieza oculto (sin placeholders)
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
    // ✅ si vamos a mostrar, aseguramos chip; si vamos a ocultar y no existe, no lo creamos
    if (on) {
      const chip = ensureHudChip();
      if (!chip) return;
      chip.classList.toggle("wxOff", false);
      return;
    }
    const chip = qs("#rlcHudWx");
    if (!chip) return;
    chip.classList.add("wxOff");
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

  // ───────────────────────── Normalizers / validators
  function normalizeTimeText(raw) {
    const s0 = safeStr(raw);
    if (!s0) return "";
    const s = s0.replace(/[\u200E\u200F\u202A-\u202E]/g, ""); // Safari/RTL marks
    const m = s.match(/(\d{1,2})\s*:\s*(\d{2})/);
    if (!m) return "";
    const hh = String(parseInt(m[1], 10)).padStart(2, "0");
    const mm = String(parseInt(m[2], 10)).padStart(2, "0");
    const h = parseInt(hh, 10), mi = parseInt(mm, 10);
    if (!(h >= 0 && h <= 23 && mi >= 0 && mi <= 59)) return "";
    return `${hh}:${mm}`;
  }

  function normalizeTempText(raw) {
    const s = safeStr(raw);
    if (!s) return "";
    const m = s.match(/-?\d{1,3}/);
    if (!m) return "";
    const n = parseInt(m[0], 10);
    if (!Number.isFinite(n)) return "";
    // rango razonable para evitar basura (sensores/parse raros)
    if (n < -90 || n > 70) return "";
    return `${n}°C`;
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
    const tzParam = safeStr(tzWanted || "auto");
    const k = wxKey(lat, lon, tzParam);

    // cache 12 min
    const hit = cache[k];
    if (hit && (Date.now() - (hit.ts || 0) < 12 * 60 * 1000)) return hit.data || null;

    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${encodeURIComponent(String(lat))}` +
      `&longitude=${encodeURIComponent(String(lon))}` +
      `&current=temperature_2m,weather_code,is_day` +
      `&temperature_unit=celsius` +
      `&timezone=${encodeURIComponent(tzParam)}`;

    const data = await fetchJson(url);
    const cur = data?.current;
    if (!cur) return null;

    const out = {
      tempC: Number(cur.temperature_2m),
      code: Number(cur.weather_code),
      isDay: (cur.is_day === 1 || cur.is_day === true),
      timezone: safeStr(data?.timezone) // ✅ NO "auto" fallback
    };

    if (!Number.isFinite(out.tempC)) return null;
    if (!out.timezone) return null; // ✅ si Open-Meteo no da tz, no mostramos nada

    cache[k] = { ts: Date.now(), data: out };
    setWxCache(cache);

    return out;
  }

  function formatTimeInTZ(timezone) {
    const tz = safeStr(timezone);
    if (!tz) return "";
    try {
      const lang = (document.documentElement.getAttribute("lang") || "es").toLowerCase();
      const locale = lang.startsWith("es") ? "es-ES" : "en-GB";
      const fmt = new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: tz
      });
      return normalizeTimeText(fmt.format(new Date()));
    } catch (_) {
      return ""; // ✅ NO fallback a hora local
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
    const coords = extractCoords(cam);
    const place = extractPlace(cam);

    // ✅ si tengo coords, no necesito place
    if (!coords && !place) return null;

    if (coords) {
      const wx = await fetchCurrentWeather(coords.lat, coords.lon, coords.timezone || "auto");
      if (!wx) return null;

      const icon = iconFromCode(wx.code, wx.isDay);
      const tz = safeStr(wx.timezone);
      const temp = normalizeTempText(`${Math.round(wx.tempC)}°C`);
      const time = formatTimeInTZ(tz);

      // ✅ si algo no es válido, no devolvemos nada
      if (!tz || !temp || !time) return null;

      return { icon, temp, time, timezone: tz };
    }

    const geo = await geocodePlace(place, "en");
    if (!geo) return null;

    const wx = await fetchCurrentWeather(geo.latitude, geo.longitude, geo.timezone || "auto");
    if (!wx) return null;

    const icon = iconFromCode(wx.code, wx.isDay);
    const tz = safeStr(wx.timezone || geo.timezone);
    const temp = normalizeTempText(`${Math.round(wx.tempC)}°C`);
    const time = formatTimeInTZ(tz);

    if (!tz || !temp || !time) return null;

    return { icon, temp, time, timezone: tz, approx: true };
  }

  // ───────────────────────── HUD integration (single mode only)
  let activeTimezone = "";
  let activeTempText = "";
  let activeIcon = "🌡️";
  let hasData = false;

  let lastCamId = "";
  let pendingTimer = null;
  let inFlight = false;
  let lastReqToken = 0;
  let clockTimer = null;

  // ✅ retry/backoff
  let retryTimer = null;
  let retryMs = 0;

  function stopClock() {
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = null;
  }

  function clearRetry() {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  }

  function scheduleRetry(camId) {
    const id = String(camId || "");
    if (!id) return;
    if (isCatalogOn()) return;
    if (retryTimer) return;

    retryMs = retryMs ? Math.min(Math.round(retryMs * 1.7), 120000) : 15000;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (isCatalogOn()) return;

      const st = readStateFromLS() || lastState;
      const cam = st?.cam || null;
      if (!cam) return;
      if (String(cam?.id || "") !== id) return;

      runUpdate(cam);
    }, retryMs);
  }

  function startClock() {
    stopClock();
    if (!activeTimezone) return;

    clockTimer = setInterval(() => {
      if (!activeTimezone) return;

      const t = formatTimeInTZ(activeTimezone);
      if (!t) {
        // ✅ si deja de ser válida, ocultar del todo
        activeTimezone = "";
        activeTempText = "";
        hasData = false;
        stopClock();
        setHudChipVisible(false);
        scheduleRetry(lastCamId);
        return;
      }

      setHudChip(activeIcon, activeTempText, t);
    }, 1000);
  }

  function hardDisableForCatalog() {
    stopClock();
    inFlight = false;
    clearRetry();
    retryMs = 0;

    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = null;

    setHudChipVisible(false);
  }

  async function runUpdate(cam) {
    // ✅ si catálogo ON, no hacemos nada
    if (isCatalogOn()) return;

    const camId = String(cam?.id || "");
    if (!camId) {
      lastCamId = "";
      activeTimezone = "";
      activeTempText = "";
      hasData = false;
      stopClock();
      clearRetry();
      retryMs = 0;
      setHudChipVisible(false);
      return;
    }

    // si está en vuelo para la misma cam, no spamear
    if (inFlight && camId === lastCamId) return;

    // misma cam y ya hay data -> solo refresca hora (valida)
    if (camId === lastCamId && hasData && activeTimezone) {
      const t = formatTimeInTZ(activeTimezone);
      if (!t) {
        activeTimezone = "";
        activeTempText = "";
        hasData = false;
        stopClock();
        setHudChipVisible(false);
        scheduleRetry(camId);
        return;
      }
      setHudChip(activeIcon, activeTempText, t);
      setHudChipVisible(true);
      if (!clockTimer) startClock();
      return;
    }

    // cam nueva -> ocultar inmediatamente (evita ver datos antiguos)
    lastCamId = camId;
    stopClock();
    clearRetry();
    setHudChipVisible(false);
    hasData = false;
    activeTimezone = "";
    activeTempText = "";

    const token = ++lastReqToken;
    inFlight = true;

    try {
      const sum = await getSummaryForCam(cam);
      if (token !== lastReqToken) return;
      if (isCatalogOn()) return;

      if (!sum) {
        // ✅ no placeholders: oculto y reintento
        hasData = false;
        activeTimezone = "";
        activeTempText = "";
        setHudChipVisible(false);
        scheduleRetry(camId);
        return;
      }

      const tz = safeStr(sum.timezone);
      const temp = normalizeTempText(sum.temp);
      const time = normalizeTimeText(sum.time);

      if (!tz || !temp || !time) {
        hasData = false;
        activeTimezone = "";
        activeTempText = "";
        setHudChipVisible(false);
        scheduleRetry(camId);
        return;
      }

      activeTimezone = tz;
      activeIcon = safeStr(sum.icon) || "🌡️";
      activeTempText = temp;
      hasData = true;

      retryMs = 0; // ✅ reset backoff
      setHudChip(activeIcon, activeTempText, time);
      setHudChipVisible(true);
      startClock();

      log("HUD WX OK:", { camId, sum });
    } catch (e) {
      if (token !== lastReqToken) return;
      if (isCatalogOn()) return;

      log("HUD WX error:", e?.message || e);

      hasData = false;
      activeTimezone = "";
      activeTempText = "";
      stopClock();
      setHudChipVisible(false);
      scheduleRetry(camId);
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
