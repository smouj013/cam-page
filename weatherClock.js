/* weatherClock.js — RLC Weather+LocalTime v1.0.3
   ✅ NO KEY (Open-Meteo)
   ✅ NO FLICKER REAL: debounce + no reinicia fetch si la cam no cambia + request lock
   ✅ AUTO TZ (timezone=auto si hace falta)
   ✅ Cache geo + wx
   ✅ Key-namespaced compatible (BUS/STATE)
   ✅ window.RLCWx.getSummaryForCam() para catalogView.js
   ✅ NO inyecta CSS (solo crea el chip)
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  const LOAD_GUARD = "__RLC_WX_LOADED_V103";
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
  const HUD = { chip: null, icon: null, temp: null, time: null };

  function findHudAnchor() {
    // intentamos varios anchors típicos
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
    if (HUD.chip && HUD.chip.isConnected) return HUD.chip;

    const anchor = findHudAnchor();
    if (!anchor) return null;

    let chip = qs("#rlcHudWx");
    if (!chip) {
      chip = document.createElement("div");
      chip.id = "rlcHudWx";
      chip.className = "wxOff"; // visible OFF (sin saltos) => CSS decide opacity/visibilidad
      chip.innerHTML = `
        <span id="rlcHudWxIcon" aria-hidden="true">🌡️</span>
        <span id="rlcHudWxTemp" class="wxTemp">—°C</span>
        <span class="wxDot" aria-hidden="true">·</span>
        <span id="rlcHudWxTime" class="wxTime">--:--</span>
      `.trim();

      // insertarlo cerca del título (si anchor es título, lo ponemos al lado; si es contenedor, al final)
      const parent = anchor.closest("#hudLeft") || anchor.parentElement || anchor;
      try {
        parent.appendChild(chip);
      } catch (_) {
        try { (document.body || document.documentElement).appendChild(chip); } catch (_) {}
      }
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

  // Reintento por si el HUD se monta tarde
  let hudRetry = 0;
  const hudRetryTimer = setInterval(() => {
    hudRetry++;
    const chip = ensureHudChip();
    if (chip || hudRetry > 80) { // ~40s
      clearInterval(hudRetryTimer);
      if (!chip) log("No HUD anchor found (chip not mounted).");
    }
  }, 500);

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
    return safeStr(place).toLowerCase().replace(/\s+/g, " ").slice(0, 140);
  }

  function cleanPlaceForGeocode(place) {
    let p = safeStr(place);
    if (!p) return "";

    // quita brackets/paréntesis
    p = p.replace(/\[[^\]]*\]/g, " ").replace(/\([^)]*\)/g, " ");

    // corta por separadores típicos
    p = p.split("|")[0];
    p = p.split(" — ")[0];
    p = p.split(" - ")[0];

    // elimina palabras típicas
    p = p.replace(/\b(live|webcam|cam|camera|stream|hd|4k|ptz|cctv)\b/gi, " ");

    // limpia símbolos
    p = p.replace(/[•·–—]/g, " ");
    p = p.replace(/\s+/g, " ").trim();

    return p.slice(0, 90);
  }

  function makeGeoCandidates(cam) {
    const placeRaw = safeStr(cam?.place || cam?.location || cam?.city || "");
    const titleRaw = safeStr(cam?.title || "");

    const base = cleanPlaceForGeocode(placeRaw) || cleanPlaceForGeocode(titleRaw);
    const out = [];

    const push = (s) => {
      const v = cleanPlaceForGeocode(s);
      if (!v) return;
      if (!out.includes(v)) out.push(v);
    };

    // 1) preferimos algo “aproximado”: últimas 2 partes del place (ciudad+país)
    if (placeRaw.includes(",")) {
      const parts = placeRaw.split(",").map(x => x.trim()).filter(Boolean);
      if (parts.length >= 2) push(parts.slice(-2).join(", "));
      if (parts.length >= 3) push(parts.slice(-3).join(", "));
    }

    // 2) luego el base completo
    push(base);

    // 3) si el título tiene "(...)" lo metemos como candidato
    const m = titleRaw.match(/\(([^)]+)\)/);
    if (m && m[1]) push(m[1]);

    // 4) fallback suave: primera parte del place
    if (placeRaw) push(placeRaw.split(",")[0]);

    return out.slice(0, 6);
  }

  function scoreGeoResult(r, original) {
    const o = safeStr(original).toLowerCase();
    const name = safeStr(r?.name).toLowerCase();
    const admin1 = safeStr(r?.admin1).toLowerCase();
    const country = safeStr(r?.country).toLowerCase();

    let s = 0;
    if (name && o.includes(name)) s += 6;
    if (admin1 && o.includes(admin1)) s += 4;
    if (country && o.includes(country)) s += 3;

    const pop = Number(r?.population);
    if (Number.isFinite(pop)) s += Math.min(5, Math.log10(Math.max(1, pop)) / 2);

    return s;
  }

  async function geocodePlaceBest(query, preferLang = "en") {
    const q = cleanPlaceForGeocode(query);
    if (!q) return null;

    const cache = getGeoCache();
    const key = normalizePlaceKey("q:" + q);

    // cache 7 días
    const hit = cache[key];
    if (hit && (Date.now() - (hit.ts || 0) < 7 * 24 * 60 * 60 * 1000)) {
      return hit.data || null;
    }

    const url =
      `https://geocoding-api.open-meteo.com/v1/search` +
      `?name=${encodeURIComponent(q)}` +
      `&count=5` +
      `&language=${encodeURIComponent(preferLang)}` +
      `&format=json`;

    const data = await fetchJson(url);
    const arr = Array.isArray(data?.results) ? data.results : [];
    if (!arr.length) return null;

    // elegir mejor por score
    let best = null;
    let bestScore = -1e9;
    for (const r of arr) {
      const sc = scoreGeoResult(r, q);
      if (sc > bestScore) { bestScore = sc; best = r; }
    }
    if (!best) return null;

    const out = {
      name: safeStr(best.name),
      country: safeStr(best.country),
      admin1: safeStr(best.admin1),
      latitude: Number(best.latitude),
      longitude: Number(best.longitude),
      timezone: safeStr(best.timezone),
      _query: q
    };

    if (!Number.isFinite(out.latitude) || !Number.isFinite(out.longitude) || !out.timezone) return null;

    cache[key] = { ts: Date.now(), data: out };
    setGeoCache(cache);

    return out;
  }

  async function geocodeFromCam(cam, preferLang = "en") {
    const candidates = makeGeoCandidates(cam);
    for (const q of candidates) {
      try {
        const r = await geocodePlaceBest(q, preferLang);
        if (r) return r;
      } catch (_) {}
    }
    return null;
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

  function extractCoords(cam) {
    const lat = Number(cam?.lat ?? cam?.latitude);
    const lon = Number(cam?.lon ?? cam?.lng ?? cam?.longitude);
    const tz = safeStr(cam?.timezone || cam?.tz || "");
    if (Number.isFinite(lat) && Number.isFinite(lon) && tz) return { lat, lon, timezone: tz };
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon, timezone: "" };
    return null;
  }

  // ───────────────────────── Public module for catalog
  async function getSummaryForCam(cam) {
    if (!cam) return null;

    const coords = extractCoords(cam);

    // 1) coords -> directo (timezone explícita o auto)
    if (coords) {
      const wx = await fetchCurrentWeather(coords.lat, coords.lon, coords.timezone || "auto");
      if (!wx) return null;

      const icon = iconFromCode(wx.code, wx.isDay);
      const temp = `${Math.round(wx.tempC)}°C`;
      const tz = wx.timezone;
      const time = formatTimeInTZ(tz);

      return { icon, temp, time, timezone: tz };
    }

    // 2) geocode aproximado
    const geo = await geocodeFromCam(cam, "en");
    if (!geo || !Number.isFinite(geo.latitude) || !Number.isFinite(geo.longitude) || !geo.timezone) return null;

    const wx = await fetchCurrentWeather(geo.latitude, geo.longitude, geo.timezone || "auto");
    if (!wx) return null;

    const icon = iconFromCode(wx.code, wx.isDay);
    const temp = `${Math.round(wx.tempC)}°C`;
    const tz = wx.timezone || geo.timezone;
    const time = formatTimeInTZ(tz);

    return { icon, temp, time, timezone: tz, approx: true };
  }

  // ───────────────────────── HUD integration (NO FLICKER)
  let activeTimezone = "";
  let activeTempText = "—°C";
  let activeIcon = "🌡️";
  let hasData = false;

  let lastCamId = "";
  let pendingCamId = "";
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

  async function runUpdate(cam) {
    const camId = String(cam?.id || "");
    if (!camId) return;

    // evita re-entradas
    if (inFlight && camId === pendingCamId) return;

    // si es la misma cam y ya tenemos data -> solo refresca la hora local
    if (camId === lastCamId && hasData && activeTimezone) {
      setHudChipVisible(true);
      setHudChip(activeIcon, activeTempText, formatTimeInTZ(activeTimezone));
      return;
    }

    pendingCamId = camId;
    const token = ++lastReqToken;

    // NO parpadeo: si ya hay data, NO toques el texto mientras cargas.
    // si no hay data aún (primer load), ponemos placeholder estable.
    setHudChipVisible(true);
    if (!hasData) setHudChip("🌡️", "…°C", "--:--");

    inFlight = true;
    try {
      const sum = await getSummaryForCam(cam);
      if (token !== lastReqToken) return;
      if (pendingCamId !== camId) return;

      if (!sum) {
        // estable: no ocultamos, dejamos “—”
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

      log("WX OK:", { camId, title: cam?.title, place: cam?.place, sum });
    } catch (e) {
      if (token !== lastReqToken) return;
      log("WX error:", e?.message || e);
      activeTimezone = "";
      hasData = false;
      stopClock();
      setHudChip("🌡️", "—°C", "--:--");
    } finally {
      inFlight = false;
    }
  }

  function scheduleUpdate(cam) {
    const camId = String(cam?.id || "");
    if (!camId) {
      // si no hay cam, no ocultamos de golpe: pero lo apagamos para no liar
      setHudChipVisible(false);
      activeTimezone = "";
      hasData = false;
      stopClock();
      return;
    }

    // si es la misma cam y está en vuelo, no reprogramamos
    if (inFlight && camId === pendingCamId) return;

    // debounce (muy importante si state spamea)
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

  // polling suave por si BC falla (no spamear update si no cambia cam)
  setInterval(() => {
    const st = readStateFromLS();
    if (!st) return;
    const id = String(st?.cam?.id || "");
    const prev = String(lastState?.cam?.id || "");
    if (id && id !== prev) onState(st);
  }, 900);

  // ───────────────────────── Expose module
  g.RLCWx = g.RLCWx || {};
  g.RLCWx.getSummaryForCam = getSummaryForCam;

  function boot() {
    // asegura chip (si HUD existe ya)
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
