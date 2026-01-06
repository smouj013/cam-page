/* rlcmap.js — RLC Interactive Map (WORLD MAP PRO + Viewer Vote + Admin Apply Winner) v2.3.9
   ✅ Mapa REAL (países) con zoom/pan + tooltip + highlight
   ✅ Drill-down USA -> Estados (doble click en USA) + botón volver
   ✅ Fallback automático a hotspots (continentes) si no cargan D3/TopoJSON
   ✅ Backend: Cloudflare Worker DurableObject (rlcmap-worker.js v2.3.9)
   ✅ Admin: start/stop + aplicar ganador -> manda cmd GOTO al player (BC + localStorage)
*/

(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;
  const VERSION = "2.3.9";
  const LOAD_GUARD = "__RLC_INTERACTIVE_MAP_V239__";

  // Update-aware singleton
  try {
    const prev = g[LOAD_GUARD];
    if (prev && typeof prev.destroy === "function") prev.destroy();
  } catch (_) {}

  const MOD = {};
  g[LOAD_GUARD] = MOD;
  MOD.VERSION = VERSION;

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────
  const qs = (s, r = document) => r.querySelector(s);
  const safeStr = (v) => String(v == null ? "" : v).trim();
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const now = () => Date.now();

  const deburr = (s) => {
    try { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
    catch (_) { return String(s || ""); }
  };

  const norm = (s) => deburr(safeStr(s)).toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\- ]+/gu, "")
    .trim();

  const normKey = (s) => deburr(safeStr(s)).toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\- ]+/gu, "")
    .trim();

  function parseParams() {
    const out = {};
    try {
      const u = new URL(location.href);
      u.searchParams.forEach((v, k) => { out[String(k)] = String(v); });
    } catch (_) {}
    return out;
  }

  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, String(v)); return true; } catch (_) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); return true; } catch (_) { return false; } }

  // ─────────────────────────────────────────────────────────────
  // KEY/BUS compat (mismo patrón que app/control)
  // ─────────────────────────────────────────────────────────────
  const BUS_BASE_DEFAULT = "rlc_bus_v1";
  const CMD_KEY_BASE = "rlc_cmd_v1";
  const LAST_KEY_STORE = "rlc_last_key_v1";

  function resolveKey(P) {
    const k =
      safeStr(P.key || "") ||
      safeStr(P.k || "") ||
      safeStr(g.RLC_KEY || "") ||
      safeStr(lsGet(LAST_KEY_STORE) || "");
    return k;
  }

  function resolveBusBase() {
    return safeStr(g.RLC_BUS_BASE || "") || BUS_BASE_DEFAULT;
  }

  function computeBus(busBase, key) {
    const K = safeStr(key);
    return K ? `${busBase}:${K}` : busBase;
  }

  function computeStorageKey(base, key) {
    const K = safeStr(key);
    return K ? `${base}:${K}` : base;
  }

  // ─────────────────────────────────────────────────────────────
  // Legacy REGIONS (fallback hotspots)
  // ─────────────────────────────────────────────────────────────
  const REGIONS = [
    { code:"NA", name:"Norteamérica", box:{x:6,  y:16, w:26, h:26} },
    { code:"SA", name:"Sudamérica",   box:{x:22, y:46, w:18, h:26} },
    { code:"EU", name:"Europa",       box:{x:44, y:18, w:16, h:18} },
    { code:"AF", name:"África",       box:{x:46, y:38, w:18, h:34} },
    { code:"AS", name:"Asia",         box:{x:60, y:18, w:28, h:30} },
    { code:"OC", name:"Oceanía",      box:{x:78, y:52, w:18, h:22} },
  ];
  const REGION_BY_CODE = Object.fromEntries(REGIONS.map(r => [r.code, r]));

  // Tags best-effort para casar cams por región (admin apply winner)
  const REGION_TAGS = {
    NA: ["usa","unitedstates","canada","mexico","newyork","ny","losangeles","la","miami","chicago","toronto","vancouver"],
    SA: ["brazil","brasil","argentina","chile","peru","colombia","venezuela","ecuador","uruguay","bolivia"],
    EU: ["spain","españa","madrid","barcelona","valencia","sevilla","uk","london","france","paris","italy","rome","germany","berlin","portugal","lisbon","amsterdam","netherlands","poland","warsaw","sweden","norway"],
    AF: ["africa","southafrica","cape","egypt","cairo","morocco","nigeria","kenya","tanzania","ghana","algeria","tunisia"],
    AS: ["japan","tokyo","osaka","china","beijing","shanghai","korea","seoul","india","delhi","taiwan","hongkong","singapore","thailand","bangkok","philippines","manila","indonesia","jakarta"],
    OC: ["australia","sydney","melbourne","perth","newzealand","auckland","wellington"],
  };

  function normTag(s){
    return safeStr(s).toLowerCase()
      .replace(/\s+/g,"")
      .replace(/[^\p{L}\p{N}_-]+/gu,"");
  }

  // ─────────────────────────────────────────────────────────────
  // Params / identifiers
  // ─────────────────────────────────────────────────────────────
  const P = parseParams();
  const KEY = resolveKey(P);
  const IS_ADMIN = String(P.admin || "") === "1" || String(P.mode || "").toLowerCase() === "admin";

  // “room” para el backend: por defecto usa KEY (si existe), si no “global”
  const ROOM = safeStr(P.room || "") || (KEY ? KEY : "global");

  // endpoint del backend (worker)
  let ENDPOINT = safeStr(P.endpoint || "") || safeStr(g.RLC_MAP_ENDPOINT || "");
  const ENDPOINT_STORE = computeStorageKey("rlc_map_endpoint_v1", KEY || ROOM);
  if (!ENDPOINT) ENDPOINT = safeStr(lsGet(ENDPOINT_STORE) || "");
  if (ENDPOINT) lsSet(ENDPOINT_STORE, ENDPOINT);

  // guarda last key (compatible con tu ecosistema)
  try { if (KEY) lsSet(LAST_KEY_STORE, KEY); } catch (_) {}

  // ─────────────────────────────────────────────────────────────
  // UI refs
  // ─────────────────────────────────────────────────────────────
  const elModePill = qs("#mapModePill");
  const elRoomPill = qs("#mapRoomPill");
  const elKeyPill  = qs("#mapKeyPill");
  const elEndpointPill = qs("#mapEndpointPill");

  const elFrame = qs("#mapFrame");
  const elHotspots = qs("#hotspots");
  const elSvgWrap = qs("#mapSvgWrap");
  const elSvg = qs("#mapSvg");
  const elMapG = qs("#mapG");
  const elTooltip = qs("#mapTooltip");

  const elPollTitle = qs("#pollTitle");
  const elPollTimer = qs("#pollTimer");
  const elPollHint  = qs("#pollHint");
  const elToast = qs("#mapToast");

  const elPollMeta = qs("#pollMeta");
  const elChoiceList = qs("#choiceList");

  const btnRefresh = qs("#btnRefresh");
  const btnVoteClear = qs("#btnVoteClear");

  const btnZoomIn = qs("#btnZoomIn");
  const btnZoomOut = qs("#btnZoomOut");
  const btnZoomReset = qs("#btnZoomReset");
  const btnBack = qs("#btnBack");

  // Admin refs
  const elAdminCard = qs("#adminCard");
  const elAdminEndpoint = qs("#adminEndpoint");
  const elAdminRoom = qs("#adminRoom");
  const elAdminSecret = qs("#adminSecret");
  const elAdminOptions = qs("#adminOptions");
  const elAdminDuration = qs("#adminDuration");

  const btnSaveSecret = qs("#btnSaveSecret");
  const btnForgetSecret = qs("#btnForgetSecret");
  const btnStart = qs("#btnStart");
  const btnStop = qs("#btnStop");
  const btnApplyWinner = qs("#btnApplyWinner");
  const btnDebugCmd = qs("#btnDebugCmd");
  const elAdminCmdHint = qs("#adminCmdHint");

  if (elModePill) elModePill.textContent = IS_ADMIN ? "Admin" : "Viewer";
  if (elRoomPill) elRoomPill.textContent = `room: ${ROOM}`;
  if (elKeyPill)  elKeyPill.textContent  = `key: ${KEY || "—"}`;
  if (elEndpointPill) elEndpointPill.textContent = `endpoint: ${ENDPOINT || "—"}`;

  // ─────────────────────────────────────────────────────────────
  // Toast
  // ─────────────────────────────────────────────────────────────
  let toastT = 0;
  function toast(msg, ms=1400){
    if (!elToast) return;
    elToast.textContent = String(msg || "");
    elToast.classList.add("on");
    clearTimeout(toastT);
    toastT = setTimeout(()=> elToast.classList.remove("on"), ms);
  }

  // ─────────────────────────────────────────────────────────────
  // Vote identity (1 voto por dispositivo best-effort)
  // ─────────────────────────────────────────────────────────────
  const VOTER_KEY = "rlc_map_voter_v1";
  function getVoterId(){
    let id = safeStr(lsGet(VOTER_KEY) || "");
    if (!id){
      id = `v_${Math.random().toString(16).slice(2)}_${Math.random().toString(16).slice(2)}`;
      lsSet(VOTER_KEY, id);
    }
    return id;
  }

  // ─────────────────────────────────────────────────────────────
  // Backend client (endpoint) + fallback local (demo)
  // ─────────────────────────────────────────────────────────────
  const LOCAL_POLL_KEY_BASE = "rlc_map_poll_v1";
  const LOCAL_POLL_KEY = computeStorageKey(LOCAL_POLL_KEY_BASE, KEY || ROOM);
  const LOCAL_MYVOTE_KEY_BASE = "rlc_map_myvote_v1";
  const LOCAL_MYVOTE_KEY = computeStorageKey(LOCAL_MYVOTE_KEY_BASE, KEY || ROOM);

  function defaultPoll(){
    return {
      pollId: `p_${now()}`,
      startedAt: 0,
      endsAt: 0,
      open: false,
      options: REGIONS.map(r=>r.code),
      votes: Object.fromEntries(REGIONS.map(r=>[r.code,0])),
      total: 0
    };
  }

  function readLocalPoll(){
    try {
      const raw = lsGet(LOCAL_POLL_KEY);
      if (!raw) return defaultPoll();
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return defaultPoll();
      return Object.assign(defaultPoll(), obj);
    } catch (_) { return defaultPoll(); }
  }
  function writeLocalPoll(poll){
    try { lsSet(LOCAL_POLL_KEY, JSON.stringify(poll)); } catch (_) {}
  }

  function readMyVote(){ return safeStr(lsGet(LOCAL_MYVOTE_KEY) || ""); }
  function writeMyVote(code){
    if (!code) { lsDel(LOCAL_MYVOTE_KEY); return; }
    lsSet(LOCAL_MYVOTE_KEY, code);
  }

  async function apiGetState(){
    if (!ENDPOINT) return readLocalPoll();
    const url = `${ENDPOINT.replace(/\/+$/,"")}/api/room/${encodeURIComponent(ROOM)}/state`;
    const r = await fetch(url, { method:"GET", cache:"no-store" });
    if (!r.ok) throw new Error(`state ${r.status}`);
    return await r.json();
  }

  async function apiVote(choice){
    const code = normKey(choice);
    if (!code) return;

    if (!ENDPOINT){
      // demo local
      const poll = readLocalPoll();
      if (!poll.open || now() > poll.endsAt) return poll;

      const prev = readMyVote();
      if (prev && poll.votes[prev] != null) poll.votes[prev] = Math.max(0, (poll.votes[prev]|0) - 1);

      poll.votes[code] = (poll.votes[code] | 0) + 1;
      poll.total = Object.values(poll.votes).reduce((a,b)=>a+(b|0),0);

      writeMyVote(code);
      writeLocalPoll(poll);
      return poll;
    }

    const url = `${ENDPOINT.replace(/\/+$/,"")}/api/room/${encodeURIComponent(ROOM)}/vote`;
    const body = { choice: code, voterId: getVoterId() };
    const r = await fetch(url, {
      method:"POST",
      headers: { "content-type":"application/json" },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(`vote ${r.status}`);
    const out = await r.json();
    writeMyVote(code);
    return out;
  }

  async function apiClearMyVote(){
    const prev = readMyVote();
    if (!prev) return;

    if (!ENDPOINT){
      writeMyVote("");
      const poll = readLocalPoll();
      if (poll.votes[prev] != null) poll.votes[prev] = Math.max(0, (poll.votes[prev]|0) - 1);
      poll.total = Object.values(poll.votes).reduce((a,b)=>a+(b|0),0);
      writeLocalPoll(poll);
      return;
    }

    const url = `${ENDPOINT.replace(/\/+$/,"")}/api/room/${encodeURIComponent(ROOM)}/vote`;
    const body = { choice: "", voterId: getVoterId() };
    const r = await fetch(url, {
      method:"POST",
      headers: { "content-type":"application/json" },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(`clear ${r.status}`);
    writeMyVote("");
  }

  // ─────────────────────────────────────────────────────────────
  // Admin secret store
  // ─────────────────────────────────────────────────────────────
  const ADMIN_SECRET_KEY_BASE = "rlc_map_admin_secret_v1";
  const ADMIN_SECRET_KEY = computeStorageKey(ADMIN_SECRET_KEY_BASE, KEY || ROOM);

  function getAdminSecret(){ return safeStr(lsGet(ADMIN_SECRET_KEY) || ""); }
  function setAdminSecret(v){
    const s = safeStr(v);
    if (!s) { lsDel(ADMIN_SECRET_KEY); return ""; }
    lsSet(ADMIN_SECRET_KEY, s);
    return s;
  }

  async function apiStartPoll(options, durationSec){
    if (!IS_ADMIN) return;

    const opts = (options || []).map(safeStr).map(s=>normKey(s)).filter(Boolean);
    const dur = clamp((durationSec|0)||60, 10, 600);

    if (!ENDPOINT){
      const poll = defaultPoll();
      poll.pollId = `p_${now()}`;
      poll.startedAt = now();
      poll.endsAt = poll.startedAt + dur*1000;
      poll.open = true;
      poll.options = opts.length ? opts : REGIONS.map(r=>r.code);
      poll.votes = Object.fromEntries(poll.options.map(c=>[c,0]));
      poll.total = 0;
      writeLocalPoll(poll);
      return poll;
    }

    const sec = getAdminSecret();
    if (!sec) throw new Error("Falta admin secret");

    const url = `${ENDPOINT.replace(/\/+$/,"")}/api/room/${encodeURIComponent(ROOM)}/start`;
    const r = await fetch(url, {
      method:"POST",
      headers: {
        "content-type":"application/json",
        "x-admin-secret": sec
      },
      body: JSON.stringify({ options: opts, durationSec: dur })
    });
    if (!r.ok) throw new Error(`start ${r.status}`);
    return await r.json();
  }

  async function apiStopPoll(){
    if (!IS_ADMIN) return;

    if (!ENDPOINT){
      const poll = readLocalPoll();
      poll.open = false;
      poll.endsAt = now();
      writeLocalPoll(poll);
      return poll;
    }

    const sec = getAdminSecret();
    if (!sec) throw new Error("Falta admin secret");

    const url = `${ENDPOINT.replace(/\/+$/,"")}/api/room/${encodeURIComponent(ROOM)}/stop`;
    const r = await fetch(url, {
      method:"POST",
      headers: {
        "content-type":"application/json",
        "x-admin-secret": sec
      },
      body: JSON.stringify({})
    });
    if (!r.ok) throw new Error(`stop ${r.status}`);
    return await r.json();
  }

  // ─────────────────────────────────────────────────────────────
  // RLC cmd bridge (solo admin)
  // ─────────────────────────────────────────────────────────────
  const BUS_BASE = resolveBusBase();
  const BUS_MAIN = computeBus(BUS_BASE, KEY);
  const CMD_KEY = computeStorageKey(CMD_KEY_BASE, KEY);
  const CMD_KEY_LEGACY = CMD_KEY_BASE;

  const canBC = ("BroadcastChannel" in g);
  const bcMain = canBC ? new BroadcastChannel(BUS_MAIN) : null;
  const bcLegacy = (canBC && KEY) ? new BroadcastChannel(BUS_BASE_DEFAULT) : null;

  MOD._bcs = [];
  try { if (bcMain) MOD._bcs.push(bcMain); } catch (_) {}
  try { if (bcLegacy) MOD._bcs.push(bcLegacy); } catch (_) {}

  function busPost(msg){
    try { if (bcMain) bcMain.postMessage(msg); } catch (_) {}
    try { if (bcLegacy) bcLegacy.postMessage(msg); } catch (_) {}
  }

  function mirrorCmdToStorage(msg){
    try {
      const raw = JSON.stringify(msg);
      lsSet(CMD_KEY, raw);
      lsSet(CMD_KEY_LEGACY, raw);
    } catch (_) {}
  }

  function sendCmd(cmd, payload = {}){
    if (!IS_ADMIN) return false;

    const c = normKey(cmd);
    const pl = (payload && typeof payload === "object") ? payload : { value: payload };

    const msg = {
      type: "cmd",
      cmd: c,
      payload: pl,

      // aliases típicos (por si tu player escucha nombres distintos)
      name: c,
      action: c,
      data: pl,

      from: "rlcmap",
      ver: VERSION,
      ts: now()
    };
    if (KEY) msg.key = KEY;

    mirrorCmdToStorage(msg);
    busPost(msg);

    if (elAdminCmdHint) elAdminCmdHint.textContent = `cmd: ${c} ${JSON.stringify(pl)}`;
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // Pretty labels (sidebar)
  // ─────────────────────────────────────────────────────────────
  function isRegionChoice(c){ return !!REGION_BY_CODE[normKey(c)]; }
  function isUSStateChoice(c){ return /^US-[A-Z0-9]{1,3}$/i.test(String(c||"").trim()); }

  // Alias “a mano” para nombres que suelen no coincidir entre datasets
  const COUNTRY_NAME_ALIASES = {
    "UNITED STATES": "UNITED STATES OF AMERICA",
    "USA": "UNITED STATES OF AMERICA",
    "EEUU": "UNITED STATES OF AMERICA",
    "UNITED KINGDOM": "UNITED KINGDOM",
    "UK": "UNITED KINGDOM",
    "RUSSIA": "RUSSIA",
    "IRAN": "IRAN",
    "SYRIA": "SYRIA",
    "CZECHIA": "CZECH REPUBLIC",
    "SOUTH KOREA": "KOREA",
    "NORTH KOREA": "KOREA",
    "VIETNAM": "VIET NAM",
    "VENEZUELA": "VENEZUELA",
    "SPAIN": "SPAIN",
    "ESPAÑA": "SPAIN",
  };

  function prettyChoice(code){
    const c = normKey(code);
    if (!c) return "—";
    if (isRegionChoice(c)) return `${c} · ${REGION_BY_CODE[c].name}`;
    if (isUSStateChoice(c)) return `${c} · Estado (USA)`;
    if (/^[A-Z]{2}$/.test(c)) return `${c} · País`;
    return c;
  }

  // ─────────────────────────────────────────────────────────────
  // Sidebar render
  // ─────────────────────────────────────────────────────────────
  function renderChoices(poll){
    if (!elChoiceList) return;
    elChoiceList.innerHTML = "";

    const opts = Array.isArray(poll?.options) ? poll.options : [];
    const votes = (poll && poll.votes) ? poll.votes : {};
    const open = !!poll?.open && now() <= (poll?.endsAt|0);

    for (const raw of opts){
      const code = normKey(raw);
      const count = (votes && votes[code] != null) ? (votes[code] | 0) : 0;

      const row = document.createElement("div");
      row.className = "choice" + (open ? "" : " disabled");

      const left = document.createElement("div");
      left.className = "left";
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = prettyChoice(code);
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = code;
      left.appendChild(name);
      left.appendChild(meta);

      const right = document.createElement("div");
      right.style.display = "flex";
      right.style.alignItems = "center";
      right.style.gap = "10px";

      const cnt = document.createElement("div");
      cnt.className = "count";
      cnt.textContent = String(count);

      const btn = document.createElement("button");
      btn.className = "btn btnVote";
      btn.type = "button";
      btn.textContent = "Votar";
      btn.disabled = !open;
      btn.addEventListener("click", async () => {
        try {
          MOD._poll = await apiVote(code);
          toast("✅ Voto enviado");
          await refreshState();
        } catch (_) {
          toast("⚠️ No se pudo votar");
        }
      });

      right.appendChild(cnt);
      right.appendChild(btn);

      row.appendChild(left);
      row.appendChild(right);
      elChoiceList.appendChild(row);
    }
  }

  function renderMeta(poll){
    const open = !!poll?.open && now() <= (poll?.endsAt|0);
    const total = poll?.total != null ? (poll.total|0) : 0;
    const opts = Array.isArray(poll?.options) ? poll.options.length : 0;
    if (elPollMeta) elPollMeta.textContent = `${open ? "OPEN" : "CLOSED"} · opciones: ${opts} · votos: ${total}`;
  }

  // ─────────────────────────────────────────────────────────────
  // Timer render
  // ─────────────────────────────────────────────────────────────
  function fmtTimeLeft(ms){
    const s = Math.max(0, Math.ceil(ms/1000));
    const m = Math.floor(s/60);
    const r = s % 60;
    return `${String(m).padStart(2,"0")}:${String(r).padStart(2,"0")}`;
  }

  function renderTimer(poll){
    if (!elPollTimer) return;
    if (!poll) { elPollTimer.textContent = "—"; return; }

    const open = !!poll.open && now() <= (poll.endsAt|0);
    if (!open){
      elPollTimer.textContent = "CERRADO";
      return;
    }
    const left = (poll.endsAt|0) - now();
    elPollTimer.textContent = `⏳ ${fmtTimeLeft(left)}`;
  }

  // ─────────────────────────────────────────────────────────────
  // MAPA REAL (D3) + fallback hotspots
  // ─────────────────────────────────────────────────────────────
  const hasD3 = () => !!(g.d3 && g.topojson && elSvg && elMapG);

  const WORLD_TOPO_URL = safeStr(P.world || "") ||
    safeStr(g.RLCMAP_WORLD_TOPO_URL || "") ||
    "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

  const US_TOPO_URL = safeStr(P.us || "") ||
    safeStr(g.RLCMAP_US_TOPO_URL || "") ||
    "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";

  MOD._map = {
    mode: "world",           // "world" | "us"
    zoom: null,
    svgSel: null,
    gSel: null,
    world: null,             // { features }
    us: null,                // { features }
    indices: { worldByName: new Map(), worldById: new Map(), usByName: new Map(), usById: new Map() },
    activeChoiceSet: new Set(),
    activeMapIds: new Set(),
  };

  function showTooltip(x, y, title, sub, count, extra){
    if (!elTooltip) return;
    elTooltip.hidden = false;

    const html = `
      <div class="tipTitle">${title || "—"}</div>
      <div class="tipSub">${sub || ""}</div>
      <div class="tipRow"><span>Votos</span><span>${count ?? "—"}</span></div>
      ${extra ? `<div class="tipHelp">${extra}</div>` : ""}
    `;
    elTooltip.innerHTML = html;

    const pad = 10;
    const rect = elFrame ? elFrame.getBoundingClientRect() : {left:0,top:0,width:window.innerWidth,height:window.innerHeight};
    const tipRect = elTooltip.getBoundingClientRect();
    let left = x + 14;
    let top = y + 14;

    if (left + tipRect.width > rect.left + rect.width - pad) left = x - tipRect.width - 14;
    if (top + tipRect.height > rect.top + rect.height - pad) top = y - tipRect.height - 14;

    elTooltip.style.left = `${left - rect.left}px`;
    elTooltip.style.top  = `${top - rect.top}px`;
  }

  function hideTooltip(){
    if (!elTooltip) return;
    elTooltip.hidden = true;
    elTooltip.innerHTML = "";
  }

  // --------- HOTSPOTS fallback ----------
  function clearHotspots(){ try { if (elHotspots) elHotspots.innerHTML = ""; } catch (_) {} }
  function createHotspots(poll){
    if (!elHotspots) return;
    clearHotspots();

    const opts = Array.isArray(poll?.options) ? poll.options.map(normKey) : [];
    const open = !!poll?.open && now() <= (poll?.endsAt|0);

    for (const r of REGIONS){
      const isEnabled = opts.includes(r.code) && open;
      const div = document.createElement("div");
      div.className = "hotspot" + (isEnabled ? "" : " disabled");
      div.style.left = `${r.box.x}%`;
      div.style.top = `${r.box.y}%`;
      div.style.width = `${r.box.w}%`;
      div.style.height = `${r.box.h}%`;

      const lab = document.createElement("div");
      lab.className = "hLabel";
      lab.textContent = `${r.code} · ${r.name}`;

      const cnt = document.createElement("div");
      cnt.className = "hCount";
      const v = (poll?.votes && poll.votes[r.code] != null) ? (poll.votes[r.code]|0) : 0;
      cnt.textContent = String(v);

      div.appendChild(lab);
      div.appendChild(cnt);

      div.addEventListener("click", async () => {
        if (!isEnabled) { toast("⛔ Opción cerrada"); return; }
        try {
          MOD._poll = await apiVote(r.code);
          toast(`✅ Votaste ${r.code}`);
          await refreshState();
        } catch (_) { toast("⚠️ No se pudo votar"); }
      });

      elHotspots.appendChild(div);
    }
  }

  // --------- WORLD MAP (D3) ----------
  async function loadWorld(){
    if (MOD._map.world) return MOD._map.world;
    const topo = await fetch(WORLD_TOPO_URL, { cache:"force-cache" }).then(r => r.json());
    const features = g.topojson.feature(topo, topo.objects.countries).features || [];
    MOD._map.world = { features };

    // índices
    const byName = new Map();
    const byId = new Map();
    for (const f of features){
      const name = normKey(f?.properties?.name || "");
      const id = String(f?.id ?? "");
      if (name) byName.set(name, f);
      if (id) byId.set(id, f);
    }
    MOD._map.indices.worldByName = byName;
    MOD._map.indices.worldById = byId;

    return MOD._map.world;
  }

  async function loadUSStates(){
    if (MOD._map.us) return MOD._map.us;
    const topo = await fetch(US_TOPO_URL, { cache:"force-cache" }).then(r => r.json());
    const features = g.topojson.feature(topo, topo.objects.states).features || [];
    MOD._map.us = { features };

    const byName = new Map();
    const byId = new Map();
    for (const f of features){
      const name = normKey(f?.properties?.name || "");
      const id = String(f?.id ?? "");
      if (name) byName.set(name, f);
      if (id) byId.set(id, f);
    }
    MOD._map.indices.usByName = byName;
    MOD._map.indices.usById = byId;

    return MOD._map.us;
  }

  function optionsToActiveSet(poll){
    const opts = Array.isArray(poll?.options) ? poll.options.map(normKey) : [];
    const set = new Set(opts);

    // aplica alias típicos (ej: UNITED STATES -> UNITED STATES OF AMERICA) para ayudar a “activar”
    for (const o of opts){
      const a = COUNTRY_NAME_ALIASES[o];
      if (a) set.add(normKey(a));
    }
    return set;
  }

  function countryFeatureMatchesChoice(feature, choice){
    const c = normKey(choice);
    const id = String(feature?.id ?? "");
    const name = normKey(feature?.properties?.name || "");

    if (!c) return false;
    if (c === id) return true;
    if (c === name) return true;

    // alias: si el choice es "US" intenta DisplayNames
    if (/^[A-Z]{2}$/.test(c)){
      try{
        const dn = new Intl.DisplayNames(["en"], { type:"region" });
        const nm = normKey(dn.of(c) || "");
        if (nm && nm === name) return true;
        const alias = COUNTRY_NAME_ALIASES[nm];
        if (alias && normKey(alias) === name) return true;
      }catch(_){}
    }

    // alias manual directo
    const manual = COUNTRY_NAME_ALIASES[c];
    if (manual && normKey(manual) === name) return true;

    return false;
  }

  function findBestChoiceForCountry(feature, poll){
    const opts = Array.isArray(poll?.options) ? poll.options.map(normKey) : [];
    if (!opts.length) return "";

    // Si hay opción exacta por id o name (rápido)
    const id = String(feature?.id ?? "");
    const name = normKey(feature?.properties?.name || "");
    if (id && opts.includes(normKey(id))) return normKey(id);
    if (name && opts.includes(name)) return name;

    // Si hay opción tipo ISO2 (US, VE, ES...) y coincide por DisplayNames / alias
    for (const o of opts){
      if (countryFeatureMatchesChoice(feature, o)) return o;
    }

    return "";
  }

  function findBestChoiceForUSState(feature, poll){
    const opts = Array.isArray(poll?.options) ? poll.options.map(normKey) : [];
    if (!opts.length) return "";

    // Si el poll es por estados USA, normalmente vendrá US-CA / US-NY etc.
    // Nosotros no tenemos abreviatura en el topojson, así que resolvemos por nombre:
    const stateName = normKey(feature?.properties?.name || "");
    if (!stateName) return "";

    // match: si existe una opción "CALIFORNIA" (por ejemplo) o "US-CALIFORNIA" no
    // => damos soporte a "CALIFORNIA" (nombre) y "US-CA" solo si el admin lo usa (no podemos deducir CA sin tabla).
    // Para robustez: permitimos que el admin ponga opciones por NOMBRE del estado.
    if (opts.includes(stateName)) return stateName;

    // Si el admin puso "US-CA", aquí no podemos adivinar CA sin tabla externa.
    // (Si lo quieres, luego metemos un mini mapa abreviaturas).
    return "";
  }

  function renderWorldSVG(poll){
    if (!hasD3()) return false;

    const d3 = g.d3;

    const rect = elFrame.getBoundingClientRect();
    const W = Math.max(320, Math.floor(rect.width));
    const H = Math.max(240, Math.floor(rect.height));

    elSvg.setAttribute("viewBox", `0 0 ${W} ${H}`);

    const svg = d3.select(elSvg);
    const gg = d3.select(elMapG);

    MOD._map.svgSel = svg;
    MOD._map.gSel = gg;

    gg.selectAll("*").remove();

    // projection
    const projection = d3.geoNaturalEarth1();
    const path = d3.geoPath(projection);

    // fit world
    const world = MOD._map.world;
    const fc = { type:"FeatureCollection", features: world.features };
    projection.fitSize([W, H], fc);

    // graticule
    const gr = d3.geoGraticule10();
    gg.append("path")
      .attr("class", "mapGraticule")
      .attr("d", path(gr));

    // active set
    const open = !!poll?.open && now() <= (poll?.endsAt|0);
    const active = optionsToActiveSet(poll);

    // countries
    const voted = normKey(readMyVote());
    const choicesVotes = poll?.votes || {};

    const countries = gg.selectAll("path.mapCountry")
      .data(world.features)
      .join("path")
      .attr("class", "mapCountry")
      .attr("d", path)
      .classed("is-disabled", (f) => {
        if (!open) return true;
        // Si hay opciones, deshabilita países que no correspondan a ninguna opción (o a aliases)
        if (!Array.isArray(poll?.options) || !poll.options.length) return false;
        const best = findBestChoiceForCountry(f, poll);
        return !best || (!active.has(best) && !active.has(normKey(COUNTRY_NAME_ALIASES[best] || "")));
      })
      .classed("is-active", (f) => {
        const best = findBestChoiceForCountry(f, poll);
        return !!best && active.has(best);
      })
      .classed("is-voted", (f) => {
        const best = findBestChoiceForCountry(f, poll);
        return !!best && best === voted;
      })
      .on("mousemove", (ev, f) => {
        const best = findBestChoiceForCountry(f, poll);
        const name = safeStr(f?.properties?.name || "—");
        const id = String(f?.id ?? "");
        const count = best ? (choicesVotes[best] | 0) : 0;
        const extra = (name.includes("United States") || name.includes("America")) ? "Doble click: ver estados (USA)" : "";
        showTooltip(ev.clientX, ev.clientY, name, `id ${id}${best ? ` · opción ${best}` : ""}`, count, extra);
      })
      .on("mouseleave", () => hideTooltip())
      .on("click", async (ev, f) => {
        ev.preventDefault();
        ev.stopPropagation();

        if (!open) { toast("⛔ Votación cerrada"); return; }

        const best = findBestChoiceForCountry(f, poll);
        if (!best || !active.has(best)) { toast("⛔ No es una opción activa"); return; }

        try {
          MOD._poll = await apiVote(best);
          toast("✅ Voto enviado");
          await refreshState();
        } catch (_) {
          toast("⚠️ No se pudo votar");
        }
      })
      .on("dblclick", async (ev, f) => {
        // Drill-down a USA estados (solo si tiene sentido)
        try {
          const name = normKey(f?.properties?.name || "");
          if (name !== "UNITED STATES OF AMERICA") return;
          await enterUSStates();
        } catch (_) {}
      });

    // Zoom
    const zoom = d3.zoom()
      .scaleExtent([1, 8])
      .on("zoom", (event) => {
        gg.attr("transform", event.transform);
      });

    svg.call(zoom);
    MOD._map.zoom = zoom;

    // botones zoom
    btnZoomIn && (btnZoomIn.onclick = () => { try { svg.transition().duration(120).call(zoom.scaleBy, 1.22); } catch(_){} });
    btnZoomOut && (btnZoomOut.onclick = () => { try { svg.transition().duration(120).call(zoom.scaleBy, 0.82); } catch(_){} });
    btnZoomReset && (btnZoomReset.onclick = () => { try { svg.transition().duration(160).call(zoom.transform, g.d3.zoomIdentity); } catch(_){} });

    return true;
  }

  async function enterUSStates(){
    if (!hasD3()) return;
    MOD._map.mode = "us";
    btnBack && (btnBack.hidden = false);
    if (elPollHint) elPollHint.textContent = "USA · Estados (si el poll es por estados, vota por nombre del estado).";

    await loadUSStates();

    const poll = MOD._poll || await apiGetState();
    renderUSSVG(poll);
  }

  function exitUSStates(){
    MOD._map.mode = "world";
    btnBack && (btnBack.hidden = true);
    if (elPollHint) elPollHint.textContent = "Haz click en un país para votar. Doble click en USA para ver estados.";
    const poll = MOD._poll || defaultPoll();
    renderWorldSVG(poll);
  }

  function renderUSSVG(poll){
    const d3 = g.d3;

    const rect = elFrame.getBoundingClientRect();
    const W = Math.max(320, Math.floor(rect.width));
    const H = Math.max(240, Math.floor(rect.height));

    elSvg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const svg = d3.select(elSvg);
    const gg = d3.select(elMapG);

    gg.selectAll("*").remove();

    const projection = d3.geoAlbersUsa();
    const path = d3.geoPath(projection);

    const us = MOD._map.us;
    const fc = { type:"FeatureCollection", features: us.features };
    projection.fitSize([W, H], fc);

    const open = !!poll?.open && now() <= (poll?.endsAt|0);
    const active = optionsToActiveSet(poll);
    const voted = normKey(readMyVote());
    const votes = poll?.votes || {};

    gg.selectAll("path.mapCountry")
      .data(us.features)
      .join("path")
      .attr("class", "mapCountry")
      .attr("d", path)
      .classed("is-disabled", (f) => {
        if (!open) return true;
        const best = findBestChoiceForUSState(f, poll);
        // si el poll NO tiene estados por nombre, deshabilitamos (para no liar a viewers)
        return !best || !active.has(best);
      })
      .classed("is-active", (f) => {
        const best = findBestChoiceForUSState(f, poll);
        return !!best && active.has(best);
      })
      .classed("is-voted", (f) => {
        const best = findBestChoiceForUSState(f, poll);
        return !!best && best === voted;
      })
      .on("mousemove", (ev, f) => {
        const nm = safeStr(f?.properties?.name || "—");
        const best = findBestChoiceForUSState(f, poll);
        const count = best ? (votes[best] | 0) : 0;
        showTooltip(ev.clientX, ev.clientY, nm, best ? `opción ${best}` : "no activo", count, "Tip: en USA vota por NOMBRE del estado (ej: CALIFORNIA).");
      })
      .on("mouseleave", () => hideTooltip())
      .on("click", async (ev, f) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (!open) { toast("⛔ Votación cerrada"); return; }

        const best = findBestChoiceForUSState(f, poll);
        if (!best || !active.has(best)) { toast("⛔ No es una opción activa"); return; }

        try {
          MOD._poll = await apiVote(best);
          toast("✅ Voto enviado");
          await refreshState();
        } catch (_) {
          toast("⚠️ No se pudo votar");
        }
      });

    // zoom
    const zoom = d3.zoom()
      .scaleExtent([1, 8])
      .on("zoom", (event) => {
        gg.attr("transform", event.transform);
      });
    svg.call(zoom);
    MOD._map.zoom = zoom;

    btnZoomIn && (btnZoomIn.onclick = () => { try { svg.transition().duration(120).call(zoom.scaleBy, 1.22); } catch(_){} });
    btnZoomOut && (btnZoomOut.onclick = () => { try { svg.transition().duration(120).call(zoom.scaleBy, 0.82); } catch(_){} });
    btnZoomReset && (btnZoomReset.onclick = () => { try { svg.transition().duration(160).call(zoom.transform, g.d3.zoomIdentity); } catch(_){} });

    btnBack && (btnBack.onclick = () => exitUSStates());
  }

  async function ensureMapEngine(poll){
    // Si no hay d3/topojson, o fallo de carga, -> fallback hotspots
    if (!hasD3()){
      if (elSvgWrap) elSvgWrap.style.display = "none";
      if (elHotspots) { elHotspots.hidden = false; }
      createHotspots(poll);
      return;
    }

    // Intentamos world data
    try{
      await loadWorld();
      if (elSvgWrap) elSvgWrap.style.display = "block";
      if (elHotspots) { elHotspots.hidden = true; }

      // render
      if (MOD._map.mode === "us"){
        await loadUSStates();
        renderUSSVG(poll);
      } else {
        renderWorldSVG(poll);
      }
    } catch (_){
      // fallback
      if (elSvgWrap) elSvgWrap.style.display = "none";
      if (elHotspots) { elHotspots.hidden = false; }
      createHotspots(poll);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Admin apply winner -> elegir cam por opción y mandar GOTO
  // ─────────────────────────────────────────────────────────────
  function camMatchesRegion(cam, regionCode){
    try {
      const tags = Array.isArray(cam.tags) ? cam.tags.map(normTag) : [];
      const title = normTag(cam.title || cam.name || "");
      const place = normTag(cam.place || cam.location || "");
      const pool = (REGION_TAGS[regionCode] || []).map(normTag);

      const hay = new Set([tags.join(" "), title, place]);
      for (const p of pool){
        if (!p) continue;
        for (const h of hay){
          if (!h) continue;
          if (h.includes(p) || p.includes(h)) return true;
        }
      }
      return false;
    } catch (_) { return false; }
  }

  function pickCamForRegion(regionCode){
    const list = g.CAM_LIST;
    if (!Array.isArray(list) || !list.length) return null;

    const candidates = list.filter(c => c && c.id && camMatchesRegion(c, regionCode));
    const arr = candidates.length ? candidates : list.filter(c => c && c.id);

    if (!arr.length) return null;
    const top = arr.slice(0, Math.min(12, arr.length));
    return top[(Math.random() * top.length) | 0] || top[0] || null;
  }

  function camMatchesChoice(cam, choice){
    const c = normKey(choice);
    if (!c) return false;

    const tags = Array.isArray(cam.tags) ? cam.tags.map(normTag) : [];
    const title = normTag(cam.title || cam.name || "");
    const place = normTag(cam.place || cam.location || "");
    const all = `${tags.join(" ")} ${title} ${place}`.trim();

    // tokens básicos
    const tokens = [c];

    // si es ISO2: añade nombre display en inglés/es (best effort)
    if (/^[A-Z]{2}$/.test(c)){
      try{
        const dnEn = new Intl.DisplayNames(["en"], { type:"region" });
        const dnEs = new Intl.DisplayNames(["es"], { type:"region" });
        const n1 = normTag(dnEn.of(c) || "");
        const n2 = normTag(dnEs.of(c) || "");
        if (n1) tokens.push(n1);
        if (n2) tokens.push(n2);
        const alias = COUNTRY_NAME_ALIASES[normKey(dnEn.of(c) || "")];
        if (alias) tokens.push(normTag(alias));
      }catch(_){}
    }

    // si es nombre “a pelo”
    tokens.push(normTag(c));

    // match
    for (const t of tokens){
      const tt = normTag(t);
      if (!tt) continue;
      if (all.includes(tt)) return true;
    }
    return false;
  }

  function pickCamForChoice(choice){
    const c = normKey(choice);
    if (isRegionChoice(c)) return pickCamForRegion(c);

    const list = g.CAM_LIST;
    if (!Array.isArray(list) || !list.length) return null;

    const candidates = list.filter(cam => cam && cam.id && camMatchesChoice(cam, c));
    const arr = candidates.length ? candidates : list.filter(cam => cam && cam.id);

    if (!arr.length) return null;
    const top = arr.slice(0, Math.min(12, arr.length));
    return top[(Math.random() * top.length) | 0] || top[0] || null;
  }

  function computeWinner(poll){
    const opts = Array.isArray(poll?.options) ? poll.options.map(normKey) : [];
    const votes = poll?.votes || {};
    let max = -1;
    let winners = [];
    for (const o of opts){
      const v = votes[o] != null ? (votes[o]|0) : 0;
      if (v > max){ max = v; winners = [o]; }
      else if (v === max){ winners.push(o); }
    }
    if (!winners.length) return "";
    return winners[(Math.random() * winners.length) | 0];
  }

  async function applyWinner(poll){
    if (!IS_ADMIN) return;
    const winner = computeWinner(poll);
    if (!winner){ toast("⚠️ Sin ganador"); return; }

    const cam = pickCamForChoice(winner);
    if (!cam){ toast(`⚠️ No hay cam para ${winner}`); return; }

    // manda GOTO al player
    sendCmd("GOTO", { id: cam.id, reason: "mapVote", choice: winner });
    toast(`🏆 ${winner} → GOTO ${cam.id}`, 2200);
  }

  // ─────────────────────────────────────────────────────────────
  // Render all
  // ─────────────────────────────────────────────────────────────
  async function renderAll(poll){
    if (elPollTitle) elPollTitle.textContent = poll?.open ? "Votación (ABIERTO)" : "Votación (CERRADO)";
    renderTimer(poll);
    renderMeta(poll);
    renderChoices(poll);
    await ensureMapEngine(poll);
  }

  // ─────────────────────────────────────────────────────────────
  // State refresh loop
  // ─────────────────────────────────────────────────────────────
  let refreshInt = 0;
  let pollTimerInt = 0;

  async function refreshState(){
    try {
      const st = await apiGetState();
      MOD._poll = st;
      await renderAll(st);
      return st;
    } catch (_) {
      // si falla endpoint, no rompas UI
      const p = ENDPOINT ? (MOD._poll || defaultPoll()) : readLocalPoll();
      MOD._poll = p;
      await renderAll(p);
      return p;
    }
  }

  function startTimer(){
    clearInterval(pollTimerInt);
    pollTimerInt = setInterval(() => {
      try { renderTimer(MOD._poll); } catch (_) {}
    }, 300);
  }

  function startRefreshLoop(){
    clearInterval(refreshInt);
    refreshInt = setInterval(() => {
      refreshState();
    }, 2000);
  }

  // ─────────────────────────────────────────────────────────────
  // Admin setup
  // ─────────────────────────────────────────────────────────────
  function setupAdmin(){
    if (!IS_ADMIN) return;

    if (elAdminCard) elAdminCard.style.display = "block";

    // precarga endpoint/room/secret
    try{
      if (elAdminEndpoint) elAdminEndpoint.value = ENDPOINT || "";
      if (elAdminRoom) elAdminRoom.value = ROOM || "";
      const sec = getAdminSecret();
      if (elAdminSecret && sec) elAdminSecret.value = sec;
    }catch(_){}

    // carga cams.js (best-effort) para aplicar ganador con id real
    try {
      const s = document.createElement("script");
      s.defer = true;
      s.src = `./cams.js?v=${VERSION}`;
      document.head.appendChild(s);
    } catch (_) {}

    btnSaveSecret && btnSaveSecret.addEventListener("click", () => {
      const sec = safeStr(elAdminSecret && elAdminSecret.value);
      setAdminSecret(sec);
      toast(sec ? "✅ Secret guardado" : "🧹 Secret vacío");
    });

    btnForgetSecret && btnForgetSecret.addEventListener("click", () => {
      setAdminSecret("");
      try { if (elAdminSecret) elAdminSecret.value = ""; } catch (_) {}
      toast("🧹 Secret borrado");
    });

    // endpoint/room editables
    elAdminEndpoint && elAdminEndpoint.addEventListener("change", () => {
      ENDPOINT = safeStr(elAdminEndpoint.value);
      if (ENDPOINT) lsSet(ENDPOINT_STORE, ENDPOINT);
      if (elEndpointPill) elEndpointPill.textContent = `endpoint: ${ENDPOINT || "—"}`;
      toast("🔧 Endpoint actualizado");
    });

    elAdminRoom && elAdminRoom.addEventListener("change", () => {
      // Nota: ROOM es const arriba para rutas; si quieres “room editable live”,
      // lo hacemos en un siguiente paso (requiere recargar o rewire completo).
      toast("ℹ️ Room editable requiere recargar la URL (por ahora)");
    });

    btnStart && btnStart.addEventListener("click", async () => {
      try {
        const dur = clamp(parseInt(safeStr(elAdminDuration && elAdminDuration.value) || "120", 10) || 120, 10, 600);
        const opts = safeStr(elAdminOptions && elAdminOptions.value)
          .split(/[\n,]+/g)
          .map(s => normKey(s))
          .filter(Boolean);

        MOD._poll = await apiStartPoll(opts, dur);
        toast("▶ Votación iniciada");
        await renderAll(MOD._poll);
      } catch (e) {
        toast("⚠️ No se pudo iniciar");
      }
    });

    btnStop && btnStop.addEventListener("click", async () => {
      try {
        MOD._poll = await apiStopPoll();
        toast("⏹ Votación cerrada");
        await renderAll(MOD._poll);
      } catch (_) {
        toast("⚠️ No se pudo cerrar");
      }
    });

    btnApplyWinner && btnApplyWinner.addEventListener("click", async () => {
      try {
        const poll = MOD._poll || await apiGetState();
        await applyWinner(poll);
      } catch (_) {
        toast("⚠️ No se pudo aplicar");
      }
    });

    btnDebugCmd && btnDebugCmd.addEventListener("click", () => {
      sendCmd("PING", { from: "rlcmap", ts: now() });
      toast("🧪 PING enviado");
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Buttons
  // ─────────────────────────────────────────────────────────────
  btnRefresh && btnRefresh.addEventListener("click", async () => {
    await refreshState();
    toast("⟳ Refrescado");
  });

  btnVoteClear && btnVoteClear.addEventListener("click", async () => {
    try {
      await apiClearMyVote();
      toast("🧹 Voto borrado");
      await refreshState();
    } catch (_) {
      toast("⚠️ No se pudo borrar");
    }
  });

  btnBack && btnBack.addEventListener("click", () => exitUSStates());

  // ─────────────────────────────────────────────────────────────
  // Boot
  // ─────────────────────────────────────────────────────────────
  async function boot(){
    if (!ENDPOINT){
      // demo local
      const p = readLocalPoll();
      writeLocalPoll(p);
      MOD._poll = p;
      await renderAll(p);

      window.addEventListener("storage", (e) => {
        if (!e || !e.key) return;
        if (e.key === LOCAL_POLL_KEY){
          try {
            MOD._poll = JSON.parse(e.newValue || "{}");
            renderAll(MOD._poll);
          } catch (_) {}
        }
      });
    }

    setupAdmin();
    await refreshState();
    startTimer();
    startRefreshLoop();
  }

  MOD.destroy = () => {
    try { clearInterval(pollTimerInt); } catch (_) {}
    try { clearInterval(refreshInt); } catch (_) {}
    try { MOD._bcs.forEach(c => { try { c.close(); } catch (_) {} }); } catch (_) {}
    MOD._bcs = [];
    try { hideTooltip(); } catch (_) {}
    try { btnZoomIn && (btnZoomIn.onclick = null); } catch (_) {}
    try { btnZoomOut && (btnZoomOut.onclick = null); } catch (_) {}
    try { btnZoomReset && (btnZoomReset.onclick = null); } catch (_) {}
  };

  boot();
})();
