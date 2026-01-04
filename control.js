/* control.js — RLC Control v2.3.8 (NEWSROOM/BROADCAST) — UNIFIED + HARDENED
   ✅ Control total del PLAYER por BroadcastChannel + localStorage + postMessage
   ✅ KEYED bus: rlc_bus_v1:{key} + Legacy bus: rlc_bus_v1 (siempre)
   ✅ Mirror LS: rlc_cmd/state/evt keyed <-> legacy
   ✅ Polling LS (cmd/state/evt) para casos donde BC/storage fallan
   ✅ Lista de cams desde CAM_LIST (cams.js) o desde state del player (fallback)
   ✅ Botón “Ir” + Prev/Next/Shuffle + Play/Pause funcionan SIEMPRE
   ✅ Copy Stream URL + Preview same-origin
   ✅ Bot IRC (opcional) + Ads buttons (opcional)
   ✅ Helix Auto Title (opcional) con cooldown + backoff 429
   ✅ Countdown cfg (opcional)
   ✅ Null-safe extremo: si falta algún ID, no rompe nada
   ✅ NO SUBE versión: respeta window.APP_VERSION=2.3.8
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;
  const APP_VERSION = String(window.APP_VERSION || "2.3.8");

  // ───────────────────────── Singleton anti-dup
  const SINGLETON_KEY = "__RLC_CONTROL_SINGLETON_V1__";
  try {
    const prev = g[SINGLETON_KEY];
    if (prev && typeof prev === "object" && prev.destroy) {
      // si ya existe, lo destruimos (hot reload) y seguimos
      try { prev.destroy(); } catch (_) {}
    }
  } catch (_) {}

  const inst = { destroy: null };
  try { g[SINGLETON_KEY] = inst; } catch (_) {}

  // ───────────────────────── Utils
  const qs = (s, r = document) => { try { return r.querySelector(s); } catch (_) { return null; } };
  const safeStr = (v) => (typeof v === "string") ? v.trim() : "";
  const isObj = (x) => !!x && typeof x === "object";
  const now = () => Date.now();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (v, fb) => {
    const n = parseFloat(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fb;
  };
  const fmtMMSS = (sec) => {
    sec = Math.max(0, sec | 0);
    const m = (sec / 60) | 0;
    const s = sec - m * 60;
    return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  };
  const tryJson = (raw) => { try { return JSON.parse(raw); } catch (_) { return null; } };
  const toJson = (obj) => { try { return JSON.stringify(obj); } catch (_) { return ""; } };

  function lsGet(k){ try { return localStorage.getItem(k) || ""; } catch(_) { return ""; } }
  function lsSet(k,v){ try { localStorage.setItem(k, v); } catch(_) {} }

  function onReady(fn){
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn, { once:true });
    else setTimeout(fn, 0);
  }

  function isTextInputActive(){
    const a = document.activeElement;
    if (!a) return false;
    const t = String(a.tagName||"").toLowerCase();
    if (t === "input" || t === "textarea" || t === "select") return true;
    try { if (a.isContentEditable) return true; } catch(_){}
    return false;
  }

  function listen(target, ev, fn, opt){
    if (!target || !target.addEventListener) return () => {};
    target.addEventListener(ev, fn, opt);
    return () => { try { target.removeEventListener(ev, fn, opt); } catch(_){} };
  }

  // ───────────────────────── Bus keys
  const BUS_BASE   = "rlc_bus_v1";
  const CMD_BASE   = "rlc_cmd_v1";
  const STATE_BASE = "rlc_state_v1";
  const EVT_BASE   = "rlc_evt_v1";
  const LAST_KEY_STORE = "rlc_last_key_v1";

  const BRIDGE_TAG = "__rlcBridgeHop_v1";
  const SRC_TAG    = "__rlcBridgeSrc_v1";
  const MAX_HOPS   = 1;

  function getUrlKey(){
    try {
      const u = new URL(location.href);
      return safeStr(u.searchParams.get("key") || "");
    } catch(_) { return ""; }
  }

  function inferKeyFromStorage(){
    const k = safeStr(lsGet(LAST_KEY_STORE) || "");
    if (k) return k;

    // fallback: intenta encontrar alguna stateKey existente
    try {
      for (let i = 0; i < localStorage.length; i++){
        const kk = localStorage.key(i);
        if (!kk) continue;
        if (!kk.startsWith(`${STATE_BASE}:`)) continue;
        const cand = safeStr(kk.slice((`${STATE_BASE}:`).length));
        if (cand) return cand;
      }
    } catch(_){}
    return "";
  }

  let KEY = getUrlKey() || inferKeyFromStorage();

  function computeKeys(key){
    const k = safeStr(key || "");
    return {
      key: k,
      busMain: k ? `${BUS_BASE}:${k}` : BUS_BASE,
      busLegacy: BUS_BASE,

      cmdKey:   k ? `${CMD_BASE}:${k}`   : CMD_BASE,
      stateKey: k ? `${STATE_BASE}:${k}` : STATE_BASE,
      evtKey:   k ? `${EVT_BASE}:${k}`   : EVT_BASE,

      cmdLegacy: CMD_BASE,
      stateLegacy: STATE_BASE,
      evtLegacy: EVT_BASE,
    };
  }

  let K = computeKeys(KEY);

  function ensureKey(maybeKey){
    const k = safeStr(maybeKey || "");
    if (!k) return false;
    if (KEY === k) return true;

    KEY = k;
    K = computeKeys(KEY);
    lsSet(LAST_KEY_STORE, KEY);

    // refleja key en footer
    try {
      const busName = qs("#ctlBusName");
      if (busName) busName.textContent = `Canal: ${K.busMain}`;
    } catch(_){}

    // si no estaba en URL, la metemos sin recargar
    try {
      const u = new URL(location.href);
      if (!u.searchParams.get("key")) {
        u.searchParams.set("key", KEY);
        history.replaceState(null, "", u.toString());
      }
    } catch(_){}

    // reabrir BC main
    try { if (bcMain) bcMain.close(); } catch(_){}
    bcMain = null;
    if ("BroadcastChannel" in window) {
      try {
        bcMain = new BroadcastChannel(K.busMain);
        unsubs.push(listen(bcMain, "message", (ev)=>onBusMessage(ev?.data, true)));
      } catch(_){ bcMain = null; }
    }
    return true;
  }

  // ───────────────────────── BroadcastChannels
  let bcLegacy = null;
  let bcMain = null;
  const unsubs = [];

  function openChannels(){
    if (!("BroadcastChannel" in window)) return;
    try {
      bcLegacy = new BroadcastChannel(K.busLegacy);
      unsubs.push(listen(bcLegacy, "message", (ev)=>onBusMessage(ev?.data, false)));
    } catch(_){ bcLegacy = null; }

    if (KEY) {
      try {
        bcMain = new BroadcastChannel(K.busMain);
        unsubs.push(listen(bcMain, "message", (ev)=>onBusMessage(ev?.data, true)));
      } catch(_){ bcMain = null; }
    }
  }

  function cloneMsg(m){
    try { return structuredClone(m); } catch(_) { return Object.assign({}, m); }
  }

  function forward(targetBc, msg, fromTag){
    if (!targetBc || !isObj(msg)) return;
    const hop = (msg[BRIDGE_TAG] | 0) || 0;
    if (hop >= MAX_HOPS) return;

    const out = cloneMsg(msg);
    out[BRIDGE_TAG] = hop + 1;
    out[SRC_TAG] = fromTag || out[SRC_TAG] || "control-bridge";
    if (KEY && !out.key) out.key = KEY;

    try { targetBc.postMessage(out); } catch(_){}
  }

  function acceptLegacyByKey(msg){
    // Si estamos en KEY mode, del legacy aceptamos:
    // - msg.key vacío (control/player viejos)
    // - o msg.key === KEY
    if (!KEY) return true;
    const mk = safeStr(msg && msg.key || "");
    if (!mk) return true;
    return mk === KEY;
  }

  // ───────────────────────── Storage mirror + polling
  function mirrorToStorage(msg){
    if (!isObj(msg)) return;
    const type = String(msg.type || "").toLowerCase();

    // adopta key si llega en msg y no teníamos
    if (!KEY) {
      const mk = safeStr(msg.key || "");
      if (mk) ensureKey(mk);
    }

    const raw = toJson(msg);
    if (!raw) return;

    if (type === "cmd") {
      lsSet(K.cmdKey, raw);
      lsSet(K.cmdLegacy, raw);
    } else if (type === "state") {
      lsSet(K.stateKey, raw);
      lsSet(K.stateLegacy, raw);
    } else if (type === "event") {
      lsSet(K.evtKey, raw);
      lsSet(K.evtLegacy, raw);
    }
  }

  // ───────────────────────── Senders
  function postToPreview(msg){
    const frame = qs("#ctlPreview");
    if (!frame) return;
    const wrap = qs("#ctlPreviewWrap");
    if (wrap && wrap.style.display === "none") return;

    try {
      const w = frame.contentWindow;
      if (w) w.postMessage(msg, location.origin);
    } catch(_){}
  }

  function sendBC(msg){
    try { if (bcMain) bcMain.postMessage(msg); } catch(_){}
    try { if (bcLegacy) bcLegacy.postMessage(msg); } catch(_){}
    // también al preview (same-origin) por si BC falla en iframes
    postToPreview(msg);
  }

  function sendCmd(cmd, payload = {}, extra = {}){
    const msg = Object.assign(
      {
        type: "cmd",
        cmd: String(cmd || ""),
        name: String(extra.name || cmd || ""),
        action: String(extra.action || cmd || ""),
        ts: now(),
        key: KEY || "",
        payload: (isObj(payload) ? payload : {}),
      },
      extra || {}
    );

    mirrorToStorage(msg);
    sendBC(msg);
    return msg;
  }

  function sendStatePatch(patch = {}, extra = {}){
    const msg = Object.assign(
      {
        type: "state",
        ts: now(),
        key: KEY || "",
        patch: isObj(patch) ? patch : {},
      },
      extra || {}
    );
    mirrorToStorage(msg);
    sendBC(msg);
    return msg;
  }

  function sendEvent(name, data = {}, extra = {}){
    const msg = Object.assign(
      { type:"event", name:String(name||""), ts:now(), key: KEY||"", data:isObj(data)?data:{} },
      extra || {}
    );
    mirrorToStorage(msg);
    sendBC(msg);
    return msg;
  }

  // ───────────────────────── Incoming messages
  let lastSeenPlayerTs = 0;
  let lastState = null;
  let lastCamSig = "";

  function setStatus(ok, text){
    const st = qs("#ctlStatus");
    if (!st) return;
    st.textContent = text;
    st.classList.toggle("pill--ok", !!ok);
    st.classList.toggle("pill--bad", !ok);
  }

  function updateConnectedUI(){
    const ok = (now() - lastSeenPlayerTs) < 2500;
    setStatus(ok, ok ? "Conectado" : "Sin señal…");
  }

  function normalizeState(s){
    if (!isObj(s)) return null;
    return s;
  }

  function extractNowFromState(s){
    // tolera formatos distintos
    const title = safeStr(s.nowTitle || s.title || s.currentTitle || (s.now && s.now.title) || "");
    const place = safeStr(s.nowPlace || s.place || s.currentPlace || (s.now && s.now.place) || "");
    const origin = safeStr(s.originUrl || s.origin || (s.now && s.now.origin) || "");
    const remain = (Number.isFinite(s.remainingSec) ? s.remainingSec :
                    Number.isFinite(s.remaining) ? s.remaining :
                    Number.isFinite(s.timer) ? s.timer :
                    Number.isFinite(s.secsLeft) ? s.secsLeft : null);

    const paused = !!(s.paused || s.isPaused || (s.player && s.player.paused));
    const idx = Number.isFinite(s.index) ? s.index :
                Number.isFinite(s.nowIndex) ? s.nowIndex :
                Number.isFinite(s.currentIndex) ? s.currentIndex : null;

    const total = Number.isFinite(s.total) ? s.total :
                  Number.isFinite(s.count) ? s.count : null;

    // id/camId
    const camId = safeStr(s.camId || s.cameraId || s.id || (s.now && (s.now.id || s.now.camId)) || "");

    return { title, place, origin, remain, paused, idx, total, camId };
  }

  function tryAdoptKeyFromMsg(msg, isMain){
    if (!isObj(msg)) return;
    // si nos llega por legacy con key y no tenemos, adoptamos
    const mk = safeStr(msg.key || "");
    if (mk && !KEY) ensureKey(mk);

    // si llega por legacy con key distinta, ignorar
    if (!isMain && KEY && mk && mk !== KEY) return false;

    // si llega por legacy y no cuadra con KEY actual, ignorar
    if (!isMain && !acceptLegacyByKey(msg)) return false;

    return true;
  }

  function onBusMessage(msg, isMain){
    if (!isObj(msg)) return;
    if (!tryAdoptKeyFromMsg(msg, isMain)) return;

    // forward entre buses (solo si procede)
    if (isMain) forward(bcLegacy, msg, "main->legacy");
    else forward(bcMain, msg, "legacy->main");

    mirrorToStorage(msg);

    const t = String(msg.type || "").toLowerCase();
    if (t === "state") {
      lastSeenPlayerTs = now();
      lastState = normalizeState(msg.state || msg.data || msg.value || msg.patch || msg) || msg;
      applyStateToUI(lastState);
      updateConnectedUI();
      return;
    }

    if (t === "event") {
      lastSeenPlayerTs = now();
      applyEventToUI(msg);
      updateConnectedUI();
      return;
    }
  }

  // storage event (entre pestañas)
  function onStorage(e){
    if (!e || !e.key) return;

    // adopta key si cambia last key y no teníamos
    if (e.key === LAST_KEY_STORE && !KEY) {
      const k = safeStr(e.newValue || "");
      if (k) ensureKey(k);
      return;
    }

    // si cambian cmd/state/evt => inyecta al bus (por fiabilidad)
    if (e.key === K.cmdKey || e.key === K.cmdLegacy) injectFromLS(e.newValue || "");
    if (e.key === K.stateKey || e.key === K.stateLegacy) injectFromLS(e.newValue || "");
    if (e.key === K.evtKey || e.key === K.evtLegacy) injectFromLS(e.newValue || "");
  }

  // Polling LS: reinyección a BC (para casos donde BC/storage no disparan)
  const POLL_MS = 250;
  let lastCmdRaw = "";
  let lastStateRaw = "";
  let lastEvtRaw = "";

  function injectFromLS(raw){
    if (!raw) return;
    const msg = tryJson(raw);
    if (!isObj(msg)) return;

    const mk = safeStr(msg.key || "");
    if (mk && !KEY) ensureKey(mk);
    if (KEY && mk && mk !== KEY) return;

    // evita loops
    if (msg[SRC_TAG] === "ls-poll") return;

    const out = Object.assign({}, msg);
    out[SRC_TAG] = "ls-poll";
    if (KEY && !out.key) out.key = KEY;

    try { if (bcMain) bcMain.postMessage(out); } catch(_){}
    try { if (bcLegacy) bcLegacy.postMessage(out); } catch(_){}
    postToPreview(out);
  }

  function pollOnce(){
    const cmdRaw   = lsGet(K.cmdKey)   || lsGet(K.cmdLegacy);
    const stateRaw = lsGet(K.stateKey) || lsGet(K.stateLegacy);
    const evtRaw   = lsGet(K.evtKey)   || lsGet(K.evtLegacy);

    if (cmdRaw && cmdRaw !== lastCmdRaw) { lastCmdRaw = cmdRaw; injectFromLS(cmdRaw); }
    if (stateRaw && stateRaw !== lastStateRaw) { lastStateRaw = stateRaw; injectFromLS(stateRaw); }
    if (evtRaw && evtRaw !== lastEvtRaw) { lastEvtRaw = evtRaw; injectFromLS(evtRaw); }
  }

  // ───────────────────────── Cams list
  const BAN_STORE_PREFIX = "rlc_ban_v1";
  function banStoreKey(){
    const k = KEY || "legacy";
    return `${BAN_STORE_PREFIX}:${k}`;
  }
  function loadBans(){
    const raw = lsGet(banStoreKey());
    const arr = tryJson(raw);
    return Array.isArray(arr) ? arr.filter(Boolean).map(String) : [];
  }
  function saveBans(arr){
    lsSet(banStoreKey(), toJson(arr || []));
  }
  let banned = loadBans();

  function getCamListFromGlobals(){
    const a = g.CAM_LIST;
    if (Array.isArray(a) && a.length) return a;

    // tolera otros nombres
    const b = g.cams || g.CAMS || g.CamList;
    if (Array.isArray(b) && b.length) return b;

    return null;
  }

  function getCamListFromState(st){
    if (!isObj(st)) return null;
    const c = st.cams || st.CAM_LIST || st.camList || (st.data && (st.data.cams || st.data.camList));
    if (Array.isArray(c) && c.length) return c;
    return null;
  }

  function camLabel(cam, idx){
    const t = safeStr(cam.title || cam.name || cam.label || `Cam ${idx+1}`);
    const p = safeStr(cam.place || cam.location || cam.city || "");
    const s = safeStr(cam.source || cam.provider || cam.site || "");
    const extra = [p, s].filter(Boolean).join(" · ");
    return extra ? `${t} — ${extra}` : t;
  }

  function camIdOf(cam, idx){
    const id = safeStr(cam.id || cam.camId || cam.cameraId || cam.key || "");
    if (id) return id;
    // fallback: id estable por index + título
    return `idx_${idx}_${safeStr(cam.title||cam.name||"").slice(0,24)}`.replace(/\s+/g,"_");
  }

  let camsAll = [];
  let camsFiltered = [];
  let optByValue = new Map(); // value -> cam

  function refreshCamList(sourceList){
    const sel = qs("#ctlSelect");
    if (!sel) return;

    const q = safeStr(qs("#ctlSearch")?.value || "").toLowerCase();
    const list = Array.isArray(sourceList) ? sourceList : [];

    camsAll = list.map((c, i) => {
      const cam = isObj(c) ? c : { title: String(c) };
      const id = camIdOf(cam, i);
      return Object.assign({}, cam, { __id: id, __i: i });
    });

    // filtra bans + búsqueda
    camsFiltered = camsAll.filter(cam => {
      if (banned.includes(cam.__id)) return false;
      if (!q) return true;
      const blob = `${cam.__id} ${cam.title||cam.name||""} ${cam.place||cam.location||""} ${cam.source||cam.provider||""}`.toLowerCase();
      return blob.includes(q);
    });

    // repinta options
    optByValue.clear();
    sel.innerHTML = "";

    for (let i = 0; i < camsFiltered.length; i++){
      const cam = camsFiltered[i];
      const opt = document.createElement("option");
      // value: id (mejor que index)
      opt.value = cam.__id;
      opt.textContent = camLabel(cam, cam.__i);
      optByValue.set(opt.value, cam);
      sel.appendChild(opt);
    }

    // intenta re-seleccionar la cam actual sin pisar interacción fuerte
    if (lastState) {
      const info = extractNowFromState(lastState);
      if (info.camId) selectCamInList(info.camId);
    }
  }

  function selectCamInList(camId){
    const sel = qs("#ctlSelect");
    if (!sel) return;
    const id = safeStr(camId || "");
    if (!id) return;

    // busca por value o por heurística
    let foundIndex = -1;
    for (let i = 0; i < sel.options.length; i++){
      if (sel.options[i].value === id) { foundIndex = i; break; }
    }
    if (foundIndex < 0) {
      // heurística: si state trae id distinto, intenta match por título+place
      const info = extractNowFromState(lastState || {});
      const want = `${info.title}||${info.place}`.toLowerCase();
      for (let i=0;i<sel.options.length;i++){
        const cam = optByValue.get(sel.options[i].value);
        const have = `${safeStr(cam?.title||cam?.name)}||${safeStr(cam?.place||cam?.location)}`.toLowerCase();
        if (want && have === want) { foundIndex = i; break; }
      }
    }

    if (foundIndex >= 0) {
      // no si el usuario está interactuando con el select
      const active = (document.activeElement === sel);
      if (!active) {
        sel.selectedIndex = foundIndex;
      }
    }
  }

  // ───────────────────────── UI apply from state/event
  function applyStateToUI(st){
    const info = extractNowFromState(st || {});
    const t = qs("#ctlNowTitle");
    const p = qs("#ctlNowPlace");
    const tm = qs("#ctlNowTimer");
    const origin = qs("#ctlOrigin");

    if (t && info.title) t.textContent = info.title || "—";
    if (p) p.textContent = info.place || "—";
    if (tm) tm.textContent = (info.remain == null) ? "--:--" : fmtMMSS(info.remain|0);

    if (origin) {
      const href = info.origin || "#";
      origin.href = href || "#";
      origin.classList.toggle("ghost", !href || href === "#");
    }

    // play/pause button icon
    const play = qs("#ctlPlay");
    if (play) play.textContent = info.paused ? "▶" : "⏸";

    // marca selección
    if (info.camId) selectCamInList(info.camId);

    // status catálogo (si el estado lo trae)
    const catSt = qs("#ctlCatalogStatus");
    if (catSt) {
      const on = !!(st.catalogOn || (st.catalog && st.catalog.on));
      catSt.textContent = `Catálogo: ${on ? "ON" : "OFF"}`;
      catSt.classList.toggle("pill--ok", on);
      catSt.classList.toggle("pill--bad", !on);
    }

    // version mismatch si el player la reporta
    const pv = safeStr(st.version || st.appVersion || (st.player && st.player.version) || "");
    if (pv && pv !== APP_VERSION) {
      setStatus(true, `Conectado (player ${pv})`);
    }
  }

  function applyEventToUI(ev){
    // events útiles: PLAYER_BOOT, etc.
    const name = safeStr(ev.name || ev.event || "");
    if (!name) return;

    if (name === "PLAYER_BOOT") {
      setStatus(true, "Conectado");
    }
  }

  // ───────────────────────── Build stream URL (para copiar y preview)
  function baseIndexUrl(){
    try {
      const u = new URL(location.href);
      const p = u.pathname || "";
      if (p.toLowerCase().endsWith("control.html")) {
        u.pathname = p.replace(/control\.html$/i, "index.html");
      } else {
        // fallback: mismo dir
        if (!p.toLowerCase().endsWith("index.html")) {
          u.pathname = p.replace(/\/?$/, "/index.html");
        }
      }
      // limpia params y reconstruye
      u.search = "";
      u.hash = "";
      return u;
    } catch(_) {
      return new URL("./index.html", location.href);
    }
  }

  function gatherBasicParams(){
    const mins = clamp((num(qs("#ctlMins")?.value, 5) | 0), 1, 120);
    const fit = safeStr(qs("#ctlFit")?.value || "cover") || "cover";
    const hud = safeStr(qs("#ctlHud")?.value || "on") || "on";
    const hudDetails = safeStr(qs("#ctlHudDetails")?.value || "off") || "off";
    const autoskip = safeStr(qs("#ctlAutoskip")?.value || "on") || "on";
    const adfree = safeStr(qs("#ctlAdfree")?.value || "off") || "off";
    return { mins, fit, hud, hudDetails, autoskip, adfree };
  }

  function buildStreamUrl(extra = {}){
    const u = baseIndexUrl();
    const P = Object.assign(gatherBasicParams(), extra || {});
    if (KEY) u.searchParams.set("key", KEY);

    // Params típicos (si el player no los usa, no rompe)
    u.searchParams.set("mins", String(P.mins));
    u.searchParams.set("fit", P.fit);
    u.searchParams.set("hud", P.hud);
    u.searchParams.set("hudDetails", P.hudDetails);
    u.searchParams.set("autoskip", P.autoskip);
    u.searchParams.set("adfree", P.adfree);

    // version bust
    u.searchParams.set("v", APP_VERSION);

    // opcionales
    for (const [k,v] of Object.entries(extra || {})){
      if (v == null) continue;
      u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  async function copyStreamUrl(){
    const url = buildStreamUrl();
    try {
      await navigator.clipboard.writeText(url);
      setStatus(true, "URL copiada ✅");
    } catch(_) {
      // fallback
      try {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setStatus(true, "URL copiada ✅");
      } catch(_) {
        setStatus(true, url);
      }
    }
  }

  // ───────────────────────── Preview
  function setPreview(on){
    const wrap = qs("#ctlPreviewWrap");
    const iframe = qs("#ctlPreview");
    if (!wrap || !iframe) return;

    wrap.style.display = on ? "block" : "none";
    if (on) {
      const url = buildStreamUrl({ preview: "1" });
      if (iframe.src !== url) iframe.src = url;
    } else {
      // no borres src para no forzar recargas si el user vuelve a ON
    }
  }

  // ───────────────────────── Core commands (NEXT/PREV/SHUFFLE/PLAY/GOTO)
  function cmdPrev(){ sendCmd("PREV"); }
  function cmdNext(){ sendCmd("NEXT"); }
  function cmdShuffle(){ sendCmd("SHUFFLE"); }
  function cmdTogglePause(){ sendCmd("TOGGLE_PAUSE"); }

  function getSelectedCam(){
    const sel = qs("#ctlSelect");
    if (!sel) return null;
    const opt = sel.selectedOptions && sel.selectedOptions[0] ? sel.selectedOptions[0] : null;
    if (!opt) return null;
    const v = safeStr(opt.value || "");
    const cam = optByValue.get(v) || null;
    return cam || { __id: v };
  }

  function cmdGotoSelected(){
    const cam = getSelectedCam();
    if (!cam) return;

    const id = safeStr(cam.__id || cam.id || cam.camId || cam.cameraId || "");
    const idx = Number.isFinite(cam.__i) ? cam.__i : null;

    // payload robusto (múltiples nombres, 1 solo mensaje)
    const payload = {
      id,
      camId: id,
      cameraId: id,
      value: id,
      index: idx,
      i: idx,
      title: safeStr(cam.title || cam.name || ""),
      place: safeStr(cam.place || cam.location || ""),
      source: safeStr(cam.source || cam.provider || ""),
    };

    sendCmd("GOTO", payload, { action: "CAM_GOTO", name: "CAM_GOTO" });
  }

  function banSelectedLocal(){
    const cam = getSelectedCam();
    if (!cam) return;

    const id = safeStr(cam.__id || cam.id || cam.camId || cam.cameraId || "");
    if (!id) return;

    if (!banned.includes(id)) {
      banned.push(id);
      saveBans(banned);
      // repinta lista
      const list = getCamListFromGlobals() || getCamListFromState(lastState) || camsAll;
      refreshCamList(list);
      setStatus(true, "Excluida (local) ✅");
    }
  }

  // ───────────────────────── Settings apply (mins/fit/hud/autoskip/adfree)
  function applyMins(){
    const mins = clamp((num(qs("#ctlMins")?.value, 5) | 0), 1, 120);
    sendStatePatch({ mins });
    sendCmd("MINS_SET", { mins }, { name:"SET_MINS", action:"SET_MINS" });
    setStatus(true, `Duración: ${mins} min ✅`);
  }

  function applySettings(){
    const P = gatherBasicParams();

    // state patch (persistente)
    sendStatePatch({
      mins: P.mins,
      fit: P.fit,
      hud: P.hud,
      hudDetails: P.hudDetails,
      autoskip: P.autoskip,
      adfree: P.adfree,
    });

    // cmd (si el player lo usa como trigger)
    sendCmd("SETTINGS_APPLY", {
      mins: P.mins, fit: P.fit, hud: P.hud, hudDetails: P.hudDetails,
      autoskip: P.autoskip, adfree: P.adfree,
    }, { name:"APPLY_SETTINGS", action:"APPLY_SETTINGS" });

    setStatus(true, "Ajustes aplicados ✅");
  }

  function resetState(){
    sendCmd("RESET", {}, { name:"RESET", action:"RESET" });
    setStatus(true, "Reset enviado ✅");
  }

  // ───────────────────────── Twitch Vote (cfg + start)
  function gatherVoteCfg(){
    const channel = safeStr(qs("#ctlTwitchChannel")?.value || "");
    const voteOn = safeStr(qs("#ctlVoteOn")?.value || "off") === "on";
    const voteOverlay = safeStr(qs("#ctlVoteOverlay")?.value || "on") === "on";
    const chatOn = safeStr(qs("#ctlChatOn")?.value || "on") === "on";
    const chatHideCmd = safeStr(qs("#ctlChatHideCmd")?.value || "on") === "on";
    const alertsOn = safeStr(qs("#ctlAlertsOn")?.value || "on") === "on";

    const voteWindow = clamp((num(qs("#ctlVoteWindow")?.value, 60) | 0), 5, 180);
    const voteAt = clamp((num(qs("#ctlVoteAt")?.value, 60) | 0), 5, 600);
    const voteLead = clamp((num(qs("#ctlVoteLead")?.value, 5) | 0), 0, 30);
    const stayMins = clamp((num(qs("#ctlStayMins")?.value, 5) | 0), 1, 120);
    const ytCookies = safeStr(qs("#ctlYtCookies")?.value || "on") === "on";
    const voteCmd = safeStr(qs("#ctlVoteCmd")?.value || "!next,!cam|!stay,!keep");

    return {
      channel, voteOn, voteOverlay, chatOn, chatHideCmd, alertsOn,
      voteWindow, voteAt, voteLead, stayMins, ytCookies, voteCmd
    };
  }

  function applyVoteCfg(){
    const cfg = gatherVoteCfg();
    sendStatePatch({ twitch: cfg });
    sendCmd("TWITCH_CFG", cfg, { name:"TWITCH_CFG", action:"TWITCH_CFG" });
    setStatus(true, "Twitch cfg aplicada ✅");
  }

  function startVoteNow(){
    // cmd recomendado por tu app.js (por lo que comentaste): TAGVOTE_START
    const cfg = gatherVoteCfg();
    sendCmd("TAGVOTE_START", cfg, { name:"VOTE_START", action:"TAGVOTE_START" });
    setStatus(true, "Voto lanzado ✅");
  }

  // ───────────────────────── Ads overlay buttons
  function gatherAdsCfg(){
    const adsOn = safeStr(qs("#ctlAdsOn")?.value || "on") === "on";
    const lead = clamp((num(qs("#ctlAdLead")?.value, 30) | 0), 0, 300);
    const dur  = clamp((num(qs("#ctlAdDur")?.value, 30) | 0), 5, 600);
    const showDuring = safeStr(qs("#ctlAdShowDuring")?.value || "on") === "on";
    const chatText = safeStr(qs("#ctlAdChatText")?.value || "");
    return { adsOn, lead, dur, showDuring, chatText };
  }

  function sendAdNotice(){
    const a = gatherAdsCfg();
    sendStatePatch({ ads: a });
    sendCmd("AD_NOTICE", a, { name:"AD_NOTICE", action:"AD_NOTICE" });
    // si bot está activo y configurado, también puede escribir (lo hacemos abajo)
    maybeBotSay(a.chatText);
    setStatus(true, "AD_NOTICE ✅");
  }
  function sendAdBegin(){
    const a = gatherAdsCfg();
    sendStatePatch({ ads: a });
    sendCmd("AD_BEGIN", a, { name:"AD_BEGIN", action:"AD_BEGIN" });
    setStatus(true, "AD_BEGIN ✅");
  }
  function sendAdClear(){
    sendCmd("AD_CLEAR", {}, { name:"AD_CLEAR", action:"AD_CLEAR" });
    setStatus(true, "AD_CLEAR ✅");
  }

  // ───────────────────────── Countdown (cfg)
  const COUNTDOWN_STORE_BASE = "rlc_countdown_cfg_v1";
  function countdownStoreKey(){
    return KEY ? `${COUNTDOWN_STORE_BASE}:${KEY}` : COUNTDOWN_STORE_BASE;
  }
  function loadCountdownCfg(){
    const raw = lsGet(countdownStoreKey()) || lsGet(COUNTDOWN_STORE_BASE);
    const c = tryJson(raw) || {};
    return {
      enabled: !!c.enabled,
      label: safeStr(c.label || "FIN DE AÑO").slice(0,60),
      targetIso: safeStr(c.targetIso || ""),
      targetMs: Number.isFinite(c.targetMs) ? c.targetMs : (parseInt(String(c.targetMs||"0"),10) || 0),
      position: (c.position==="tl"||c.position==="tr"||c.position==="bl"||c.position==="br") ? c.position : "tr",
      hideHudWhenCatalog: (c.hideHudWhenCatalog !== false),
    };
  }
  function saveCountdownCfg(cfg){
    lsSet(countdownStoreKey(), toJson(cfg));
    lsSet(COUNTDOWN_STORE_BASE, toJson(cfg)); // legacy mirror
  }

  function applyCountdown(){
    const on = safeStr(qs("#ctlCountdownOn")?.value || "off") === "on";
    const label = safeStr(qs("#ctlCountdownLabel")?.value || "FIN DE AÑO").slice(0,60);
    const dt = safeStr(qs("#ctlCountdownTarget")?.value || "");
    const d = dt ? new Date(dt) : null;
    const targetMs = d && Number.isFinite(d.getTime()) ? d.getTime() : 0;

    const cfg = loadCountdownCfg();
    cfg.enabled = on;
    cfg.label = label || cfg.label;
    cfg.targetIso = dt || "";
    cfg.targetMs = targetMs || cfg.targetMs || 0;

    saveCountdownCfg(cfg);

    // lo entiende tu bootstrap de index.html: COUNTDOWN_CFG / COUNTDOWN_SET
    sendCmd("COUNTDOWN_SET", cfg, { name:"COUNTDOWN_SET", action:"COUNTDOWN_SET" });
    sendEvent("COUNTDOWN_CFG", { cfg });

    const st = qs("#ctlCountdownStatus");
    if (st) st.textContent = `Countdown: ${cfg.enabled ? "ON" : "OFF"}`;
    setStatus(true, "Countdown aplicado ✅");
  }

  function resetCountdown(){
    const cfg = loadCountdownCfg();
    cfg.enabled = false;
    saveCountdownCfg(cfg);
    sendCmd("COUNTDOWN_SET", cfg, { name:"COUNTDOWN_SET", action:"COUNTDOWN_SET" });
    const st = qs("#ctlCountdownStatus");
    if (st) st.textContent = "Countdown: OFF";
    setStatus(true, "Countdown reset ✅");
  }

  // ───────────────────────── Bot IRC (Twitch) — opcional
  const BOT_STORE_BASE = "rlc_bot_cfg_v1";
  function botStoreKey(){ return KEY ? `${BOT_STORE_BASE}:${KEY}` : BOT_STORE_BASE; }

  function loadBotCfg(){
    const raw = lsGet(botStoreKey()) || lsGet(BOT_STORE_BASE);
    const c = tryJson(raw) || {};
    return {
      on: safeStr(c.on || "off") === "on",
      user: safeStr(c.user || ""),
      token: safeStr(c.token || ""),
      sayOnAd: (safeStr(c.sayOnAd || "on") === "on"),
      channel: safeStr(c.channel || safeStr(qs("#ctlTwitchChannel")?.value || "")),
    };
  }
  function saveBotCfg(cfg){
    lsSet(botStoreKey(), toJson(cfg));
    lsSet(BOT_STORE_BASE, toJson(cfg));
  }

  let botWS = null;
  let botConnected = false;
  let botLastSend = 0;
  let botQueue = [];
  let botFlushTimer = 0;

  function setBotStatus(text, ok){
    const el = qs("#ctlBotStatus");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("pill--ok", !!ok);
    el.classList.toggle("pill--bad", !ok);
  }

  function botDisconnect(){
    try { if (botWS) botWS.close(); } catch(_){}
    botWS = null;
    botConnected = false;
    setBotStatus("Bot OFF", false);
  }

  function botConnect(){
    const cfg = loadBotCfg();
    if (!cfg.user || !cfg.token || !cfg.channel) {
      setBotStatus("Falta user/token/canal", false);
      return;
    }
    const pass = cfg.token.startsWith("oauth:") ? cfg.token : `oauth:${cfg.token}`;

    botDisconnect();

    try {
      botWS = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
    } catch(_) {
      setBotStatus("WS no disponible", false);
      return;
    }

    botWS.onopen = () => {
      try {
        botWS.send("CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership");
        botWS.send(`PASS ${pass}`);
        botWS.send(`NICK ${cfg.user}`);
        botWS.send(`JOIN #${cfg.channel.toLowerCase()}`);
        botConnected = true;
        setBotStatus("Bot conectado ✅", true);
      } catch(_) {}
    };

    botWS.onmessage = (ev) => {
      const msg = String(ev.data || "");
      if (msg.startsWith("PING")) {
        try { botWS.send("PONG :tmi.twitch.tv"); } catch(_) {}
      }
    };

    botWS.onerror = () => setBotStatus("Bot error", false);
    botWS.onclose = () => {
      botConnected = false;
      setBotStatus("Bot desconectado", false);
    };
  }

  function botEnqueueSay(text){
    const t = safeStr(text || "");
    if (!t) return;
    botQueue.push(t);
    scheduleBotFlush();
  }

  function scheduleBotFlush(){
    if (botFlushTimer) return;
    botFlushTimer = setTimeout(flushBotQueue, 250);
  }

  function flushBotQueue(){
    botFlushTimer = 0;
    if (!botConnected || !botWS) return;
    const cfg = loadBotCfg();
    if (!cfg.channel) return;

    // rate-limit simple: 1 msg / 1200ms
    const minGap = 1200;
    const gap = now() - botLastSend;
    if (gap < minGap) {
      botFlushTimer = setTimeout(flushBotQueue, (minGap - gap));
      return;
    }

    const msg = botQueue.shift();
    if (!msg) return;

    try {
      botWS.send(`PRIVMSG #${cfg.channel.toLowerCase()} :${msg}`);
      botLastSend = now();
    } catch(_) {}

    if (botQueue.length) scheduleBotFlush();
  }

  function maybeBotSay(text){
    const cfg = loadBotCfg();
    if (!cfg.on) return;
    if (!botConnected) return;
    botEnqueueSay(text);
  }

  // ───────────────────────── Helix Auto Title — opcional
  const HELIX_STORE_BASE = "rlc_helix_cfg_v1";
  function helixStoreKey(){ return KEY ? `${HELIX_STORE_BASE}:${KEY}` : HELIX_STORE_BASE; }

  function loadHelixCfg(){
    const raw = lsGet(helixStoreKey()) || lsGet(HELIX_STORE_BASE);
    const c = tryJson(raw) || {};
    return {
      on: safeStr(c.on || "off") === "on",
      clientId: safeStr(c.clientId || ""),
      token: safeStr(c.token || ""),
      broadcasterId: safeStr(c.broadcasterId || ""),
      template: safeStr(c.template || "🌍 Ahora: {title}{placeSep}{place} | GlobalEye.TV"),
      cooldownSec: clamp((parseInt(String(c.cooldownSec||"20"),10) || 20), 10, 180),
      lastTitle: safeStr(c.lastTitle || ""),
      lastSetTs: Number.isFinite(c.lastSetTs) ? c.lastSetTs : 0,
      backoffUntil: Number.isFinite(c.backoffUntil) ? c.backoffUntil : 0
    };
  }
  function saveHelixCfg(cfg){
    lsSet(helixStoreKey(), toJson(cfg));
    lsSet(HELIX_STORE_BASE, toJson(cfg));
  }

  function fillTemplate(tpl, info){
    const title = safeStr(info.title || "");
    const place = safeStr(info.place || "");
    const source = safeStr(info.source || "");
    const label = safeStr(info.label || "");
    const placeSep = place ? " — " : "";
    return String(tpl || "")
      .replaceAll("{title}", title)
      .replaceAll("{place}", place)
      .replaceAll("{source}", source)
      .replaceAll("{label}", label)
      .replaceAll("{placeSep}", placeSep)
      .trim()
      .slice(0, 140);
  }

  async function helixSetTitle(newTitle){
    const cfg = loadHelixCfg();
    if (!cfg.on) return { ok:false, why:"off" };
    if (!cfg.clientId || !cfg.token) return { ok:false, why:"missing creds" };
    if (!cfg.broadcasterId) return { ok:false, why:"missing broadcasterId" };

    const tnow = now();
    if (cfg.backoffUntil && tnow < cfg.backoffUntil) return { ok:false, why:"backoff" };

    const since = tnow - (cfg.lastSetTs || 0);
    if (since < cfg.cooldownSec * 1000) return { ok:false, why:"cooldown" };

    const title = safeStr(newTitle || "").slice(0,140);
    if (!title) return { ok:false, why:"empty" };
    if (title === cfg.lastTitle) return { ok:false, why:"same" };

    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 9000);

    try {
      const res = await fetch(`https://api.twitch.tv/helix/channels?broadcaster_id=${encodeURIComponent(cfg.broadcasterId)}`, {
        method: "PATCH",
        headers: {
          "Client-Id": cfg.clientId,
          "Authorization": `Bearer ${cfg.token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ title }),
        signal: controller.signal
      });

      if (res.status === 429) {
        const retry = parseInt(res.headers.get("Ratelimit-Reset") || "0", 10);
        const backoffMs = retry ? Math.max(10_000, (retry * 1000) - tnow) : 30_000;
        cfg.backoffUntil = tnow + backoffMs;
        saveHelixCfg(cfg);
        return { ok:false, why:"429", backoffMs };
      }

      if (!res.ok) {
        return { ok:false, why:`http ${res.status}` };
      }

      cfg.lastTitle = title;
      cfg.lastSetTs = tnow;
      cfg.backoffUntil = 0;
      saveHelixCfg(cfg);
      return { ok:true };

    } catch (e) {
      return { ok:false, why: (e && e.name === "AbortError") ? "timeout" : "fetch error" };
    } finally {
      clearTimeout(tid);
    }
  }

  async function helixMaybeUpdateOnCamChange(st){
    const cfg = loadHelixCfg();
    if (!cfg.on) return;

    const info = extractNowFromState(st || {});
    const sig = `${info.title}||${info.place}`;
    if (!sig || sig === lastCamSig) return;
    lastCamSig = sig;

    const title = fillTemplate(cfg.template, { title: info.title, place: info.place });
    const r = await helixSetTitle(title);

    const badge = qs("#ctlTitleStatus");
    if (badge) {
      if (r.ok) {
        badge.textContent = "Título: OK ✅";
        badge.classList.add("pill--ok"); badge.classList.remove("pill--bad");
      } else {
        badge.textContent = `Título: ${r.why || "NO"}`;
        badge.classList.remove("pill--ok"); badge.classList.add("pill--bad");
      }
    }
  }

  function applyHelixCfgFromUI(){
    const cfg = loadHelixCfg();
    cfg.on = safeStr(qs("#ctlTitleOn")?.value || "off") === "on";
    cfg.clientId = safeStr(qs("#ctlTitleClientId")?.value || "");
    cfg.broadcasterId = safeStr(qs("#ctlTitleBroadcasterId")?.value || "");
    cfg.token = safeStr(qs("#ctlTitleToken")?.value || "");
    cfg.template = safeStr(qs("#ctlTitleTemplate")?.value || cfg.template);
    cfg.cooldownSec = clamp((num(qs("#ctlTitleCooldown")?.value, cfg.cooldownSec) | 0), 10, 180);
    saveHelixCfg(cfg);

    const badge = qs("#ctlTitleStatus");
    if (badge) badge.textContent = `Título: ${cfg.on ? "ON" : "OFF"}`;

    setStatus(true, "Helix cfg aplicada ✅");
  }

  async function helixTestNow(){
    const cfg = loadHelixCfg();
    const info = extractNowFromState(lastState || {});
    const title = fillTemplate(cfg.template, { title: info.title || "Test", place: info.place || "" });
    const r = await helixSetTitle(title);
    setStatus(true, r.ok ? "Título actualizado ✅" : `Título NO: ${r.why}`);
  }

  function resetHelix(){
    const cfg = loadHelixCfg();
    cfg.on = false;
    cfg.lastTitle = "";
    cfg.lastSetTs = 0;
    cfg.backoffUntil = 0;
    saveHelixCfg(cfg);
    const badge = qs("#ctlTitleStatus");
    if (badge) badge.textContent = "Título: OFF";
    setStatus(true, "Helix reset ✅");
  }

  // ───────────────────────── Wire UI
  function wireUI(){
    // Footer bus name
    const busName = qs("#ctlBusName");
    if (busName) busName.textContent = `Canal: ${K.busMain}`;

    // Status tick
    setInterval(updateConnectedUI, 500);

    // Core nav
    listen(qs("#ctlPrev"), "click", cmdPrev);
    listen(qs("#ctlNext"), "click", cmdNext);
    listen(qs("#ctlShuffle"), "click", cmdShuffle);
    listen(qs("#ctlPlay"), "click", cmdTogglePause);

    // Go / Ban
    listen(qs("#ctlGo"), "click", cmdGotoSelected);
    listen(qs("#ctlBan"), "click", banSelectedLocal);

    // Double click list -> go
    const sel = qs("#ctlSelect");
    if (sel) {
      listen(sel, "dblclick", cmdGotoSelected);
      // Enter en select => ir
      listen(sel, "keydown", (e)=>{
        if (e.key === "Enter") { e.preventDefault(); cmdGotoSelected(); }
      });
    }

    // Search filter
    const search = qs("#ctlSearch");
    if (search) {
      listen(search, "input", ()=>{
        const list = getCamListFromGlobals() || getCamListFromState(lastState) || camsAll;
        refreshCamList(list);
      });
    }

    // Copy URL
    listen(qs("#ctlCopyStreamUrl"), "click", copyStreamUrl);

    // Preview
    const prevOn = qs("#ctlPreviewOn");
    if (prevOn) {
      listen(prevOn, "change", ()=>{
        const on = safeStr(prevOn.value||"off") === "on";
        setPreview(on);
      });
      // aplica estado inicial
      setPreview(safeStr(prevOn.value||"off") === "on");
    }

    // Mins/settings
    listen(qs("#ctlApplyMins"), "click", applyMins);
    listen(qs("#ctlApplySettings"), "click", applySettings);

    // compat aliases (si existen)
    listen(qs("#ctlApply"), "click", applySettings);
    listen(qs("#ctlApplyAll"), "click", applySettings);
    listen(qs("#ctlSettingsApply"), "click", applySettings);

    // Reset
    listen(qs("#ctlReset"), "click", resetState);

    // Vote / Twitch
    listen(qs("#ctlVoteApply"), "click", applyVoteCfg);
    listen(qs("#ctlVoteStart"), "click", startVoteNow);

    // Ads buttons
    listen(qs("#ctlAdNoticeBtn"), "click", sendAdNotice);
    listen(qs("#ctlAdBeginBtn"), "click", sendAdBegin);
    listen(qs("#ctlAdClearBtn"), "click", sendAdClear);

    // Bot config bindings
    const botOn = qs("#ctlBotOn");
    if (botOn) {
      listen(botOn, "change", ()=>{
        const cfg = loadBotCfg();
        cfg.on = safeStr(botOn.value||"off") === "on";
        cfg.user = safeStr(qs("#ctlBotUser")?.value || cfg.user);
        cfg.token = safeStr(qs("#ctlBotToken")?.value || cfg.token);
        cfg.sayOnAd = safeStr(qs("#ctlBotSayOnAd")?.value || "on") === "on";
        cfg.channel = safeStr(qs("#ctlTwitchChannel")?.value || cfg.channel);
        saveBotCfg(cfg);
      });
    }

    listen(qs("#ctlBotConnect"), "click", ()=>{
      const cfg = loadBotCfg();
      cfg.on = safeStr(qs("#ctlBotOn")?.value || "off") === "on";
      cfg.user = safeStr(qs("#ctlBotUser")?.value || "");
      cfg.token = safeStr(qs("#ctlBotToken")?.value || "");
      cfg.sayOnAd = safeStr(qs("#ctlBotSayOnAd")?.value || "on") === "on";
      cfg.channel = safeStr(qs("#ctlTwitchChannel")?.value || "");
      saveBotCfg(cfg);

      if (cfg.on) botConnect();
      else botDisconnect();
    });

    listen(qs("#ctlBotTestSend"), "click", ()=>{
      const cfg = loadBotCfg();
      if (!cfg.on || !botConnected) { setBotStatus("Bot OFF", false); return; }
      const text = safeStr(qs("#ctlBotTestText")?.value || "✅ Bot online");
      botEnqueueSay(text);
      setStatus(true, "Test enviado ✅");
    });

    // Helix UI
    listen(qs("#ctlTitleApply"), "click", applyHelixCfgFromUI);
    listen(qs("#ctlTitleTest"), "click", helixTestNow);
    listen(qs("#ctlTitleReset"), "click", resetHelix);

    // Countdown UI
    listen(qs("#ctlCountdownApply"), "click", applyCountdown);
    listen(qs("#ctlCountdownReset"), "click", resetCountdown);

    // Hotkeys (si no estás escribiendo)
    listen(window, "keydown", (e)=>{
      if (isTextInputActive()) return;
      const k = e.key;
      if (k === "ArrowLeft") { e.preventDefault(); cmdPrev(); }
      if (k === "ArrowRight") { e.preventDefault(); cmdNext(); }
      if (k === " " || k === "Spacebar") { e.preventDefault(); cmdTogglePause(); }
      if (k === "r" || k === "R") { e.preventDefault(); cmdShuffle(); }
      if (k === "Enter") { /* enter fuera inputs => ir */ }
      if (k === "b" || k === "B") { e.preventDefault(); banSelectedLocal(); }
    }, { passive:false });
  }

  // ───────────────────────── Boot
  function boot(){
    // fuerza modo control
    try { document.body && document.body.classList.add("mode-control"); } catch(_){}

    // channels
    openChannels();

    // storage listener
    unsubs.push(listen(window, "storage", onStorage));

    // polling
    const pollId = setInterval(pollOnce, POLL_MS);

    // UI
    wireUI();

    // carga lista de cams inicial
    const list = getCamListFromGlobals();
    if (list) refreshCamList(list);

    // ping
    sendEvent("CONTROL_BOOT", { version: APP_VERSION });

    // loop: auto title en cambios de state
    setInterval(() => {
      if (!lastState) return;
      helixMaybeUpdateOnCamChange(lastState);
    }, 800);

    // pinta initial bot/helix/countdown badges
    try {
      const bc = loadBotCfg();
      const botOn = qs("#ctlBotOn"); if (botOn) botOn.value = bc.on ? "on" : "off";
      const bu = qs("#ctlBotUser"); if (bu && bc.user) bu.value = bc.user;
      const bt = qs("#ctlBotToken"); if (bt && bc.token) bt.value = bc.token;
      const bs = qs("#ctlBotSayOnAd"); if (bs) bs.value = bc.sayOnAd ? "on" : "off";
      setBotStatus(bc.on ? "Bot listo" : "Bot OFF", !!bc.on);
    } catch(_){}

    try {
      const hc = loadHelixCfg();
      const on = qs("#ctlTitleOn"); if (on) on.value = hc.on ? "on" : "off";
      const cid = qs("#ctlTitleClientId"); if (cid && hc.clientId) cid.value = hc.clientId;
      const bid = qs("#ctlTitleBroadcasterId"); if (bid && hc.broadcasterId) bid.value = hc.broadcasterId;
      const tok = qs("#ctlTitleToken"); if (tok && hc.token) tok.value = hc.token;
      const tpl = qs("#ctlTitleTemplate"); if (tpl && hc.template) tpl.value = hc.template;
      const cd = qs("#ctlTitleCooldown"); if (cd) cd.value = String(hc.cooldownSec || 20);
      const st = qs("#ctlTitleStatus"); if (st) st.textContent = `Título: ${hc.on ? "ON" : "OFF"}`;
    } catch(_){}

    try {
      const cc = loadCountdownCfg();
      const on = qs("#ctlCountdownOn"); if (on) on.value = cc.enabled ? "on" : "off";
      const lb = qs("#ctlCountdownLabel"); if (lb && cc.label) lb.value = cc.label;
      const tg = qs("#ctlCountdownTarget"); if (tg && cc.targetIso) tg.value = cc.targetIso;
      const st = qs("#ctlCountdownStatus"); if (st) st.textContent = `Countdown: ${cc.enabled ? "ON" : "OFF"}`;
    } catch(_){}

    // destroy
    inst.destroy = () => {
      try { clearInterval(pollId); } catch(_){}
      try { if (bcMain) bcMain.close(); } catch(_){}
      try { if (bcLegacy) bcLegacy.close(); } catch(_){}
      try { botDisconnect(); } catch(_){}
      while (unsubs.length) { try { unsubs.pop()(); } catch(_){ } }
    };
  }

  onReady(boot);
})();
