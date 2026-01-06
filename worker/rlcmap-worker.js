/* rlcmap-worker.js — RLC Map Votes Backend v2.3.9
   Durable Object por room:
     GET  /api/room/:room/state
     POST /api/room/:room/vote   { choice, voterId }
     POST /api/room/:room/start  (admin) { options[], durationSec }   header: x-admin-secret
     POST /api/room/:room/stop   (admin) {}                           header: x-admin-secret
   CORS: abierto (para GitHub Pages)
*/

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }));
    }

    const m = url.pathname.match(/^\/api\/room\/([^/]+)\/(state|vote|start|stop)$/);
    if (!m) return cors(json({ ok:false, error:"not_found" }, 404));

    const room = decodeURIComponent(m[1] || "global");
    const action = m[2];

    const id = env.ROOMS.idFromName(room);
    const stub = env.ROOMS.get(id);

    const next = new Request(new URL(url.pathname + url.search, request.url), request);
    next.headers.set("x-room", room);
    next.headers.set("x-action", action);

    return stub.fetch(next);
  }
};

export class VoteRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const room = request.headers.get("x-room") || "global";
    const action = request.headers.get("x-action") || "state";

    // CORS preflight
    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }));
    }

    try {
      if (action === "state" && request.method === "GET") {
        const st = await this._getState();
        return cors(json(st, 200));
      }

      if (action === "vote" && request.method === "POST") {
        const body = await readJson(request);
        const out = await this._vote(body);
        return cors(json(out, 200));
      }

      if (action === "start" && request.method === "POST") {
        this._assertAdmin(request);
        const body = await readJson(request);
        const out = await this._start(body);
        return cors(json(out, 200));
      }

      if (action === "stop" && request.method === "POST") {
        this._assertAdmin(request);
        const out = await this._stop();
        return cors(json(out, 200));
      }

      return cors(json({ ok:false, error:"method_not_allowed", room, action }, 405));
    } catch (e) {
      const status = (e && e.status) ? e.status : 500;
      return cors(json({ ok:false, error: String(e?.message || "error"), room, action }, status));
    }
  }

  _assertAdmin(request){
    const want = String(this.env.ADMIN_SECRET || "");
    if (!want) {
      const e = new Error("ADMIN_SECRET not set in worker env");
      e.status = 500;
      throw e;
    }
    const got = String(request.headers.get("x-admin-secret") || "");
    if (!got || got !== want) {
      const e = new Error("unauthorized");
      e.status = 401;
      throw e;
    }
  }

  _defaultState(){
    const options = ["NA","SA","EU","AF","AS","OC"];
    return {
      pollId: `p_${Date.now()}`,
      startedAt: 0,
      endsAt: 0,
      open: false,
      options,
      votes: Object.fromEntries(options.map(o=>[o,0])),
      total: 0
    };
  }

  async _getState(){
    const st = await this.state.storage.get("state");
    return st || this._defaultState();
  }

  async _putState(st){
    await this.state.storage.put("state", st);
  }

  async _start(body){
    const opts = Array.isArray(body?.options) ? body.options : [];
    const options = opts.map(s => String(s||"").trim().toUpperCase()).filter(Boolean);
    const durationSec = clampInt(body?.durationSec, 60, 10, 600);

    const st = this._defaultState();
    st.pollId = `p_${Date.now()}`;
    st.startedAt = Date.now();
    st.endsAt = st.startedAt + durationSec * 1000;
    st.open = true;

    st.options = options.length ? options : st.options;
    st.votes = Object.fromEntries(st.options.map(o=>[o,0]));
    st.total = 0;

    await this.state.storage.put("voters", {}); // voterId -> choice
    await this._putState(st);
    return st;
  }

  async _stop(){
    const st = await this._getState();
    st.open = false;
    st.endsAt = Date.now();
    await this._putState(st);
    return st;
  }

  async _vote(body){
    const st = await this._getState();
    const t = Date.now();

    if (!st.open || t > (st.endsAt|0)) {
      st.open = false;
      await this._putState(st);
      return st;
    }

    const voterId = String(body?.voterId || "").trim();
    const choice = String(body?.choice || "").trim().toUpperCase();

    if (!voterId) return st;

    const voters = (await this.state.storage.get("voters")) || {};
    const prev = voters[voterId] ? String(voters[voterId]).toUpperCase() : "";

    // borrar voto
    if (!choice) {
      if (prev && st.votes[prev] != null) st.votes[prev] = Math.max(0, (st.votes[prev]|0) - 1);
      delete voters[voterId];
      st.total = sumVotes(st.votes);
      await this.state.storage.put("voters", voters);
      await this._putState(st);
      return st;
    }

    // solo permitir opciones activas
    if (!Array.isArray(st.options) || !st.options.includes(choice)) return st;

    // cambia voto
    if (prev && prev !== choice && st.votes[prev] != null) {
      st.votes[prev] = Math.max(0, (st.votes[prev]|0) - 1);
    }
    if (st.votes[choice] == null) st.votes[choice] = 0;
    st.votes[choice] = (st.votes[choice]|0) + 1;

    voters[voterId] = choice;
    st.total = sumVotes(st.votes);

    await this.state.storage.put("voters", voters);
    await this._putState(st);
    return st;
  }
}

// ─────────────────────────────────────────────────────────────
// Utils
// ─────────────────────────────────────────────────────────────
function cors(resp){
  const h = new Headers(resp.headers);
  h.set("access-control-allow-origin", "*");
  h.set("access-control-allow-methods", "GET,POST,OPTIONS");
  h.set("access-control-allow-headers", "content-type,x-admin-secret");
  h.set("cache-control", "no-store");
  return new Response(resp.body, { status: resp.status, headers: h });
}

function json(obj, status=200){
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type":"application/json; charset=utf-8" }
  });
}

async function readJson(req){
  try {
    const t = await req.text();
    if (!t) return {};
    return JSON.parse(t);
  } catch (_) {
    return {};
  }
}

function sumVotes(votes){
  try {
    return Object.values(votes || {}).reduce((a,b)=>a + ((b|0)), 0);
  } catch (_) { return 0; }
}

function clampInt(v, def, a, b){
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(a, Math.min(b, n));
}
