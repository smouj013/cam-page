/* rlcmap.js — RLC Interactive Map (Viewer Vote + Admin Apply Winner) v2.3.9
   ✅ Viewer: vota clickando regiones en mapa
   ✅ Admin: start/stop poll + aplicar ganador -> manda cmd GOTO al player (BC + localStorage, keyed+legacy)
   ✅ KEY auto: ?key= / ?k= / localStorage rlc_last_key_v1 / window.RLC_KEY
   ✅ Endpoint (recomendado): Cloudflare Worker (incluido en /worker)
   ✅ Fallback sin endpoint: “demo local” (solo funciona en el mismo navegador)
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
  function lsDel(k) { try { localStorage.removeItem(k); } catch (_) { return false; } }

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
  // UI refs
  // ─────────────────────────────────────────────────────────────
  const elModePill = qs("#mapModePill");
  const elRoomPill = qs("#mapRoomPill");
  const elKeyPill  = qs("#mapKeyPill");
  const elEndpoint = qs("#endpointPill");

  const elHotspots = qs("#hotspots");
  const elOptions  = qs("#options");

  const elPollTitle = qs("#pollTitle");
  const elPollTimer = qs("#pollTimer");
  const elPollHint  = qs("#pollHint");
  const elPollStateHint = qs("#pollStateHint");

  const elToast = qs("#toast");

  const elAdminCard = qs("#adminCard");
  const elAdminSecret = qs("#adminSecret");
  const elAdminDuration = qs("#adminDuration");
  const elAdminOptions = qs("#adminOptions");
  const elAdminCmdHint = qs("#adminCmdHint");

  const btnRefresh = qs("#btnRefresh");
  const btnVoteClear = qs("#btnVoteClear");

  const btnSaveSecret = qs("#btnSaveSecret");
  const btnForgetSecret = qs("#btnForgetSecret");
  const btnStart = qs("#btnStart");
  const btnStop = qs("#btnStop");
  const btnApplyWinner = qs("#btnApplyWinner");
  const btnDebugCmd = qs("#btnDebugCmd");

  // ─────────────────────────────────────────────────────────────
  // Regions (hotspots “aprox” en % de un mapa equirectangular)
  // ─────────────────────────────────────────────────────────────
  const REGIONS = [
    { code:"NA", name:"Norteamérica", box:{x:8,  y:16, w:22, h:26} },
    { code:"SA", name:"Sudamérica",   box:{x:20, y:42, w:16, h:34} },
    { code:"EU", name:"Europa",       box:{x:44, y:18, w:14, h:18} },
    { code:"AF", name:"África",       box:{x:46, y:38, w:18, h:34} },
    { code:"AS", name:"Asia",         box:{x:60, y:18, w:28, h:30} },
    { code:"OC", name:"Oceanía",      box:{x:78, y:52, w:18, h:22} },
  ];
  const REGION_BY_CODE = Object.fromEntries(REGIONS.map(r => [r.code, r]));

  // Tags “best-effort” para casar cams por región (admin apply winner)
  const REGION_TAGS = {
    NA: ["usa","unitedstates","canada","mexico","newyork","ny","la","losangeles","miami","chicago","toronto","vancouver"],
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
  // Modes & identifiers
  // ─────────────────────────────────────────────────────────────
  const P = parseParams();
  const KEY = resolveKey(P);
  const IS_ADMIN = String(P.admin || "") === "1" || String(P.mode || "").toLowerCase() === "admin";

  // “room” para el backend: por defecto usa KEY (si existe), si no “global”
  const ROOM = safeStr(P.room || "") || (KEY ? KEY : "global");

  // endpoint del backend (worker)
  const ENDPOINT = safeStr(P.endpoint || "") || safeStr(g.RLC_MAP_ENDPOINT || "");
  if (elEndpoint) elEndpoint.textContent = ENDPOINT || "(sin endpoint: demo local)";

  if (elModePill) elModePill.textContent = IS_ADMIN ? "Admin" : "Viewer";
  if (elRoomPill) elRoomPill.textContent = `room: ${ROOM}`;
  if (elKeyPill)  elKeyPill.textContent  = `key: ${KEY || "—"}`;

  // guarda last key (compatible con tu ecosistema)
  try { if (KEY) lsSet(LAST_KEY_STORE, KEY); } catch (_) {}

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
  // Backend client (endpoint) + fallback local
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
    } catch (_) {
      return defaultPoll();
    }
  }
  function writeLocalPoll(poll){
    try { lsSet(LOCAL_POLL_KEY, JSON.stringify(poll)); } catch (_) {}
  }

  function readMyVote(){
    return safeStr(lsGet(LOCAL_MYVOTE_KEY) || "");
  }
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

  async function apiVote(code){
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

  function getAdminSecret(){
    return safeStr(lsGet(ADMIN_SECRET_KEY) || "");
  }
  function setAdminSecret(v){
    const s = safeStr(v);
    if (!s) { lsDel(ADMIN_SECRET_KEY); return ""; }
    lsSet(ADMIN_SECRET_KEY, s);
    return s;
  }

  async function apiStartPoll(options, durationSec){
    if (!IS_ADMIN) return;

    const opts = (options || []).map(safeStr).map(s=>s.toUpperCase()).filter(Boolean);
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

    const c = safeStr(cmd).toUpperCase();
    const pl = (payload && typeof payload === "object") ? payload : { value: payload };

    const msg = {
      type: "cmd",
      cmd: c,
      payload: pl,
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
  // Admin apply winner -> elegir cam id por región y mandar GOTO
  // ─────────────────────────────────────────────────────────────
  function camMatchesRegion(cam, regionCode){
    try {
      const tags = Array.isArray(cam.tags) ? cam.tags.map(normTag) : [];
      const title = normTag(cam.title || cam.name || "");
      const place = normTag(cam.place || cam.location || "");
      const pool = (REGION_TAGS[regionCode] || []).map(normTag);

      const hay = new Set([...tags, title, place]);
      for (const p of pool){
        if (!p) continue;
        for (const h of hay){
          if (!h) continue;
          if (h.includes(p) || p.includes(h)) return true;
        }
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  function pickCamForRegion(regionCode){
    const list = g.CAM_LIST;
    if (!Array.isArray(list) || !list.length) return null;

    const candidates = list.filter(c => c && c.id && camMatchesRegion(c, regionCode));
    const arr = candidates.length ? candidates : list.slice(0, 80); // fallback suave

    const idx = (Math.random() * arr.length) | 0;
    return arr[idx] || null;
  }

  async function applyWinner(poll){
    if (!IS_ADMIN) return;

    const opts = Array.isArray(poll.options) ? poll.options : [];
    const votes = poll.votes && typeof poll.votes === "object" ? poll.votes : {};
    let best = "";
    let bestN = -1;

    for (const o of opts){
      const n = (votes[o] | 0);
      if (n > bestN) { bestN = n; best = o; }
    }
    best = safeStr(best).toUpperCase();
    if (!best) throw new Error("Sin ganador");

    const cam = pickCamForRegion(best);
    if (!cam || !cam.id){
      sendCmd("PING", { winner: best, votes: bestN });
      toast(`Ganador: ${best} (sin CAM_LIST: enviado PING)`);
      return;
    }

    sendCmd("GOTO", { id: cam.id, camId: cam.id, cameraId: cam.id, reason: "map-winner", winner: best, votes: bestN });
    toast(`🏆 Ganó ${best} → GOTO ${cam.id}`);
  }

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  function fmtMMSS(ms){
    const s = Math.max(0, Math.ceil(ms/1000));
    const m = (s/60)|0;
    const r = s - m*60;
    return `${String(m).padStart(2,"0")}:${String(r).padStart(2,"0")}`;
  }

  function clearNode(n){ try { while(n && n.firstChild) n.removeChild(n.firstChild); } catch (_) {} }

  function renderHotspots(poll){
    if (!elHotspots) return;
    clearNode(elHotspots);

    const votes = (poll && poll.votes) ? poll.votes : {};
    const enabledSet = new Set((poll && Array.isArray(poll.options)) ? poll.options.map(s=>safeStr(s).toUpperCase()) : []);

    for (const r of REGIONS){
      const b = r.box;
      const on = enabledSet.has(r.code);
      const n = (votes[r.code] | 0);

      const div = document.createElement("div");
      div.className = "hotspot" + (on ? "" : " disabled");
      div.style.left = `${b.x}%`;
      div.style.top  = `${b.y}%`;
      div.style.width  = `${b.w}%`;
      div.style.height = `${b.h}%`;
      div.setAttribute("data-region", r.code);
      div.title = `${r.name} (${r.code})`;

      const lab = document.createElement("div");
      lab.className = "hotspotLabel";
      lab.textContent = r.code;

      const cnt = document.createElement("div");
      cnt.className = "hotspotCount";
      cnt.textContent = String(n);

      div.appendChild(lab);
      div.appendChild(cnt);

      div.addEventListener("click", async () => {
        try {
          const cur = MOD._poll || poll;
          if (!cur || !cur.open || now() > cur.endsAt){
            toast("⛔ Votación cerrada");
            return;
          }
          if (!enabledSet.has(r.code)){
            toast("⛔ Opción no activa");
            return;
          }
          MOD._poll = await apiVote(r.code);
          toast(`✅ Voto: ${r.code}`);
          renderAll(MOD._poll);
        } catch (e) {
          toast(`⚠️ Error voto`);
        }
      }, { passive:true });

      elHotspots.appendChild(div);
    }
  }

  function renderOptions(poll){
    if (!elOptions) return;
    clearNode(elOptions);

    const votes = (poll && poll.votes) ? poll.votes : {};
    const opts = (poll && Array.isArray(poll.options)) ? poll.options.map(s=>safeStr(s).toUpperCase()) : [];
    const my = readMyVote();

    for (const code of opts){
      const reg = REGION_BY_CODE[code] || { code, name:"(custom)" };
      const n = (votes[code] | 0);

      const row = document.createElement("div");
      row.className = "opt";

      const k = document.createElement("div");
      k.className = "optKey";
      k.textContent = code;

      const nm = document.createElement("div");
      nm.className = "optName";
      nm.textContent = reg.name || code;

      const c = document.createElement("div");
      c.className = "optCount";
      c.textContent = String(n);

      const b = document.createElement("button");
      b.className = "optBtn";
      b.type = "button";
      b.textContent = (my === code) ? "✓ Mi voto" : "Votar";

      b.addEventListener("click", async () => {
        try {
          if (!poll.open || now() > poll.endsAt){
            toast("⛔ Votación cerrada");
            return;
          }
          MOD._poll = await apiVote(code);
          toast(`✅ Voto: ${code}`);
          renderAll(MOD._poll);
        } catch (_) {
          toast("⚠️ Error voto");
        }
      }, { passive:true });

      row.appendChild(k);
      row.appendChild(nm);
      row.appendChild(c);
      row.appendChild(b);

      elOptions.appendChild(row);
    }
  }

  function renderHeader(poll){
    const open = !!poll.open && now() <= (poll.endsAt|0);
    if (elPollTitle) elPollTitle.textContent = open ? "Votación abierta" : "Votación cerrada";

    if (elPollHint){
      elPollHint.textContent = open
        ? "Haz click en una región para votar."
        : "Esperando a que el admin inicie una nueva votación…";
    }

    if (elPollStateHint){
      const total = (poll.total|0);
      elPollStateHint.textContent = open
        ? `Activa · votos: ${total}`
        : `Cerrada · votos: ${total}`;
    }
  }

  function renderAll(poll){
    renderHeader(poll);
    renderHotspots(poll);
    renderOptions(poll);
  }

  // ─────────────────────────────────────────────────────────────
  // Poll loop
  // ─────────────────────────────────────────────────────────────
  let pollTimerInt = 0;
  function startTimer(){
    clearInterval(pollTimerInt);
    pollTimerInt = setInterval(() => {
      const poll = MOD._poll;
      if (!poll) return;

      const remain = (poll.endsAt|0) - now();
      const open = !!poll.open && remain > 0;

      if (elPollTimer){
        elPollTimer.textContent = open ? fmtMMSS(remain) : "—";
      }

      if (poll.open && remain <= 0){
        poll.open = false;
        MOD._poll = poll;
        renderAll(poll);
      }
    }, 250);
  }

  let refreshInt = 0;
  async function refreshState(){
    try {
      const st = await apiGetState();
      MOD._poll = st;
      renderAll(st);
    } catch (_) {}
  }

  function startRefreshLoop(){
    clearInterval(refreshInt);
    refreshInt = setInterval(refreshState, ENDPOINT ? 1200 : 800);
  }

  // ─────────────────────────────────────────────────────────────
  // Admin UI wiring
  // ─────────────────────────────────────────────────────────────
  function setupAdmin(){
    if (!IS_ADMIN) return;
    if (elAdminCard) elAdminCard.style.display = "block";

    try {
      const sec = getAdminSecret();
      if (elAdminSecret && sec) elAdminSecret.value = sec;
    } catch (_) {}

    // Solo admin: carga cams.js para poder elegir cam por región y mandar GOTO
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

    btnStart && btnStart.addEventListener("click", async () => {
      try {
        const dur = clamp(parseInt(safeStr(elAdminDuration && elAdminDuration.value) || "60", 10) || 60, 10, 600);
        const opts = safeStr(elAdminOptions && elAdminOptions.value)
          .split(",")
          .map(s => safeStr(s).toUpperCase())
          .filter(Boolean);

        MOD._poll = await apiStartPoll(opts, dur);
        toast("▶ Votación iniciada");
        renderAll(MOD._poll);
      } catch (_) {
        toast("⚠️ No se pudo iniciar");
      }
    });

    btnStop && btnStop.addEventListener("click", async () => {
      try {
        MOD._poll = await apiStopPoll();
        toast("⏹ Votación cerrada");
        renderAll(MOD._poll);
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

  // ─────────────────────────────────────────────────────────────
  // Boot
  // ─────────────────────────────────────────────────────────────
  async function boot(){
    if (!ENDPOINT){
      const p = readLocalPoll();
      writeLocalPoll(p);
      MOD._poll = p;
      renderAll(p);

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
  };

  boot();
})();
