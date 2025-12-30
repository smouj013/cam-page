(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  // Guard anti doble carga
  const LOAD_GUARD = "__RLC_CONTROL_LOADED_V212";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  const BUS = "rlc_bus_v1";
  const CMD_KEY = "rlc_cmd_v1";
  const STATE_KEY = "rlc_state_v1";

  const qs = (s) => document.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (v, fallback) => {
    const n = parseFloat(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  };

  const bc = ("BroadcastChannel" in window) ? new BroadcastChannel(BUS) : null;

  function parseParams() {
    const u = new URL(location.href);
    return { key: u.searchParams.get("key") || "" };
  }
  const P = parseParams();

  // ───────────────────────── UI ─────────────────────────
  const ctlStatus = qs("#ctlStatus");
  const ctlNowTitle = qs("#ctlNowTitle");
  const ctlNowPlace = qs("#ctlNowPlace");
  const ctlNowTimer = qs("#ctlNowTimer");
  const ctlOrigin = qs("#ctlOrigin");

  const ctlPrev = qs("#ctlPrev");
  const ctlPlay = qs("#ctlPlay");
  const ctlNext = qs("#ctlNext");
  const ctlShuffle = qs("#ctlShuffle");

  const ctlMins = qs("#ctlMins");
  const ctlApplyMins = qs("#ctlApplyMins");
  const ctlFit = qs("#ctlFit");
  const ctlHud = qs("#ctlHud");
  const ctlHudDetails = qs("#ctlHudDetails");
  const ctlAutoskip = qs("#ctlAutoskip");
  const ctlAdfree = qs("#ctlAdfree");
  const ctlReset = qs("#ctlReset");

  const ctlSearch = qs("#ctlSearch");
  const ctlSelect = qs("#ctlSelect");
  const ctlGo = qs("#ctlGo");
  const ctlBan = qs("#ctlBan");

  const ctlPreviewOn = qs("#ctlPreviewOn");
  const ctlPreviewWrap = qs("#ctlPreviewWrap");
  const ctlPreview = qs("#ctlPreview");

  const ctlCopyStreamUrl = qs("#ctlCopyStreamUrl");

  // BGM
  const ctlBgmOn = qs("#ctlBgmOn");
  const ctlBgmVol = qs("#ctlBgmVol");
  const ctlBgmTrack = qs("#ctlBgmTrack");
  const ctlBgmPrev = qs("#ctlBgmPrev");
  const ctlBgmPlay = qs("#ctlBgmPlay");
  const ctlBgmNext = qs("#ctlBgmNext");
  const ctlBgmShuffle = qs("#ctlBgmShuffle");
  const ctlBgmNow = qs("#ctlBgmNow");

  // Twitch vote
  const ctlTwitchChannel = qs("#ctlTwitchChannel");
  const ctlVoteOn = qs("#ctlVoteOn");
  const ctlVoteOverlay = qs("#ctlVoteOverlay");
  const ctlVoteWindow = qs("#ctlVoteWindow"); // duración real del voto
  const ctlVoteAt = qs("#ctlVoteAt");         // a falta de X segundos para iniciar voto
  const ctlVoteLead = qs("#ctlVoteLead");     // pre-aviso (seg antes)
  const ctlVoteCmd = qs("#ctlVoteCmd");
  const ctlVoteStart = qs("#ctlVoteStart");
  const ctlVoteApply = qs("#ctlVoteApply");

  const ctlStayMins = qs("#ctlStayMins");
  const ctlYtCookies = qs("#ctlYtCookies");

  // Data
  const allCams = Array.isArray(g.CAM_LIST) ? g.CAM_LIST.slice() : [];
  const bgmList = Array.isArray(g.BGM_LIST) ? g.BGM_LIST.slice() : [];
  let lastState = null;
  let lastSeenAt = 0;

  function fmtMMSS(sec) {
    sec = Math.max(0, sec | 0);
    const m = (sec / 60) | 0;
    const s = sec - m * 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function sendCmd(cmd, payload = {}) {
    const msg = { type: "cmd", ts: Date.now(), cmd, payload, key: P.key || "" };
    try { if (bc) bc.postMessage(msg); } catch (_) {}
    try { localStorage.setItem(CMD_KEY, JSON.stringify(msg)); } catch (_) {}
  }

  function setStatus(text, ok = true) {
    if (!ctlStatus) return;
    ctlStatus.textContent = text;
    ctlStatus.classList.toggle("pill--ok", !!ok);
    ctlStatus.classList.toggle("pill--bad", !ok);
  }

  function label(cam) {
    const t = cam?.title || "Live Cam";
    const p = cam?.place || "";
    return p ? `${t} — ${p}` : t;
  }

  function syncList(filter = "") {
    if (!ctlSelect) return;
    const f = String(filter || "").trim().toLowerCase();

    ctlSelect.innerHTML = "";
    for (const cam of allCams) {
      const hay = `${cam?.title || ""} ${cam?.place || ""} ${cam?.source || ""}`.toLowerCase();
      if (f && !hay.includes(f)) continue;
      const opt = document.createElement("option");
      opt.value = cam.id;
      opt.textContent = label(cam);
      ctlSelect.appendChild(opt);
    }
  }

  function syncBgmTracks() {
    if (!ctlBgmTrack) return;
    ctlBgmTrack.innerHTML = "";
    if (!bgmList.length) {
      const opt = document.createElement("option");
      opt.value = "0";
      opt.textContent = "— (sin playlist)";
      ctlBgmTrack.appendChild(opt);
      return;
    }
    for (let i = 0; i < bgmList.length; i++) {
      const t = bgmList[i];
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = t?.title ? t.title : `Track ${i + 1}`;
      ctlBgmTrack.appendChild(opt);
    }
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
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        return true;
      } catch (_) { return false; }
    }
  }

  // ✅ URL del stream (index.html) desde el panel
  // Enviamos también voteUi (= lead + window) para que el overlay dure desde el aviso hasta el final del voto.
  function streamUrlFromHere() {
    const u = new URL(location.href);
    u.pathname = u.pathname.replace(/control\.html$/i, "index.html");

    u.searchParams.set("mins", String(clamp(parseInt(ctlMins?.value || "5", 10) || 5, 1, 120)));
    u.searchParams.set("fit", ctlFit?.value || "cover");
    u.searchParams.set("hud", (ctlHud?.value === "off") ? "0" : "1");

    if (ctlAdfree?.value === "on") u.searchParams.set("mode", "adfree");
    else u.searchParams.delete("mode");

    if (ctlAutoskip?.value === "off") u.searchParams.set("autoskip", "0");
    else u.searchParams.delete("autoskip");

    // votación
    if (ctlVoteOn?.value === "on") u.searchParams.set("vote", "1");
    else u.searchParams.delete("vote");

    const ch = (ctlTwitchChannel?.value || "").trim().replace(/^@/, "");
    if (ch) u.searchParams.set("twitch", ch);
    else u.searchParams.delete("twitch");

    const windowSec = clamp(parseInt(ctlVoteWindow?.value || "60", 10) || 60, 5, 180);
    const leadSec = clamp(parseInt(ctlVoteLead?.value || "5", 10) || 5, 0, 30);
    const voteAtSec = clamp(parseInt(ctlVoteAt?.value || "60", 10) || 60, 5, 600);

    u.searchParams.set("voteOverlay", (ctlVoteOverlay?.value === "off") ? "0" : "1");
    u.searchParams.set("voteWindow", String(windowSec));
    u.searchParams.set("voteLead", String(leadSec));
    u.searchParams.set("voteAt", String(voteAtSec));

    // ✅ overlay visible total (pre-aviso + voto)
    u.searchParams.set("voteUi", String(windowSec + leadSec));

    if (ctlVoteCmd?.value) u.searchParams.set("voteCmd", ctlVoteCmd.value.trim());

    // stayMins
    if (ctlStayMins) {
      const sm = clamp(parseInt(ctlStayMins.value || "5", 10) || 5, 1, 120);
      u.searchParams.set("stayMins", String(sm));
    }

    // ytCookies
    if (ctlYtCookies) {
      let on = false;
      if (ctlYtCookies.type === "checkbox") on = !!ctlYtCookies.checked;
      else {
        const v = String(ctlYtCookies.value || "").toLowerCase();
        on = (v === "on" || v === "1" || v === "true" || v === "yes");
      }
      u.searchParams.set("ytCookies", on ? "1" : "0");
    }

    // bgm
    if (ctlBgmOn?.value === "on") u.searchParams.set("bgm", "1");
    else u.searchParams.delete("bgm");
    if (ctlBgmVol?.value != null) u.searchParams.set("bgmVol", String(ctlBgmVol.value));

    // key
    if (P.key) u.searchParams.set("key", P.key);
    else u.searchParams.delete("key");

    return u.toString();
  }

  function applyState(st) {
    lastState = st;
    lastSeenAt = Date.now();

    setStatus("Conectado", true);

    if (ctlNowTitle) ctlNowTitle.textContent = st?.cam?.title || "—";
    if (ctlNowPlace) ctlNowPlace.textContent = st?.cam?.place || "—";
    if (ctlNowTimer) ctlNowTimer.textContent = fmtMMSS(st?.remaining ?? 0);

    if (ctlOrigin) {
      ctlOrigin.href = st?.cam?.originUrl || "#";
      ctlOrigin.style.pointerEvents = st?.cam?.originUrl ? "auto" : "none";
      ctlOrigin.style.opacity = st?.cam?.originUrl ? "1" : ".65";
    }

    if (ctlPlay) ctlPlay.textContent = st?.playing ? "⏸" : "▶";
    if (ctlMins && st?.mins) ctlMins.value = String(st.mins);
    if (ctlFit && st?.fit) ctlFit.value = st.fit;
    if (ctlHud) ctlHud.value = st?.hudHidden ? "off" : "on";
    if (ctlHudDetails) ctlHudDetails.value = st?.hudCollapsed ? "collapsed" : "expanded";
    if (ctlAutoskip) ctlAutoskip.value = st?.autoskip ? "on" : "off";
    if (ctlAdfree) ctlAdfree.value = st?.adfree ? "on" : "off";

    // BGM
    if (ctlBgmOn) ctlBgmOn.value = st?.bgm?.enabled ? "on" : "off";
    if (ctlBgmVol && typeof st?.bgm?.vol === "number") ctlBgmVol.value = String(st.bgm.vol);
    if (ctlBgmTrack && st?.bgm?.idx != null) ctlBgmTrack.value = String(st.bgm.idx | 0);
    if (ctlBgmNow) {
      const name = st?.bgm?.track || "";
      ctlBgmNow.textContent = name ? `Now: ${name} · ${st?.bgm?.playing ? "playing" : "paused"}` : "—";
    }

    // Vote state
    const vote = st?.vote || {};
    if (ctlTwitchChannel && typeof vote?.channel === "string") {
      if (!ctlTwitchChannel.value) ctlTwitchChannel.value = vote.channel;
    }
    if (ctlVoteOn) ctlVoteOn.value = vote?.enabled ? "on" : "off";
    if (ctlVoteOverlay) ctlVoteOverlay.value = vote?.overlay ? "on" : "off";
    if (ctlVoteWindow && vote?.windowSec != null) ctlVoteWindow.value = String(vote.windowSec | 0);
    if (ctlVoteAt && vote?.voteAtSec != null) ctlVoteAt.value = String(vote.voteAtSec | 0);
    if (ctlVoteCmd && typeof vote?.cmd === "string") ctlVoteCmd.value = vote.cmd || ctlVoteCmd.value;

    if (ctlVoteLead) {
      const ls = (vote?.leadSec != null) ? (vote.leadSec | 0) : null;
      if (ls != null) ctlVoteLead.value = String(clamp(ls, 0, 30));
    }

    if (ctlStayMins) {
      const sm =
        (vote?.stayMins != null) ? (vote.stayMins | 0)
        : (vote?.staySec != null) ? Math.max(1, Math.round((vote.staySec | 0) / 60))
        : null;
      if (sm != null) ctlStayMins.value = String(clamp(sm, 1, 120));
    }

    if (ctlYtCookies) {
      const ytCookies =
        (st?.youtube?.cookies != null) ? !!st.youtube.cookies
        : (st?.ytCookies != null) ? !!st.ytCookies
        : null;

      if (ctlYtCookies.type === "checkbox") {
        if (ytCookies != null) ctlYtCookies.checked = ytCookies;
      } else {
        if (ytCookies != null) ctlYtCookies.value = ytCookies ? "on" : "off";
      }
    }
  }

  // Receive state
  if (bc) {
    bc.onmessage = (ev) => {
      const msg = ev?.data;
      if (!msg || msg.type !== "state") return;
      applyState(msg);
    };
  }

  // Fallback: state from localStorage
  setInterval(() => {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (!raw) return;
      const st = JSON.parse(raw);
      if (!st || st.type !== "state") return;
      applyState(st);
    } catch (_) {}
  }, 500);

  // Watchdog
  setInterval(() => {
    const now = Date.now();
    if (!lastSeenAt) { setStatus("Esperando player…", false); return; }
    const age = now - lastSeenAt;
    if (age > 2500) setStatus("Sin señal (¿stream abierto?)", false);
  }, 700);

  // ───────────────────────── UI events ─────────────────────────
  function wire() {
    syncList("");
    syncBgmTracks();

    // defaults
    if (ctlVoteAt && !ctlVoteAt.value) ctlVoteAt.value = "60";
    if (ctlVoteWindow && !ctlVoteWindow.value) ctlVoteWindow.value = "60";
    if (ctlVoteLead && !ctlVoteLead.value) ctlVoteLead.value = "5";
    if (ctlStayMins && !ctlStayMins.value) ctlStayMins.value = "5";
    if (ctlYtCookies && !ctlYtCookies.value && ctlYtCookies.type !== "checkbox") ctlYtCookies.value = "on";

    if (ctlSearch) ctlSearch.addEventListener("input", () => syncList(ctlSearch.value));

    if (ctlPrev) ctlPrev.addEventListener("click", () => sendCmd("PREV"));
    if (ctlNext) ctlNext.addEventListener("click", () => sendCmd("NEXT"));
    if (ctlPlay) ctlPlay.addEventListener("click", () => sendCmd("TOGGLE_PLAY"));
    if (ctlShuffle) ctlShuffle.addEventListener("click", () => sendCmd("SHUFFLE"));

    if (ctlApplyMins) ctlApplyMins.addEventListener("click", () => sendCmd("SET_MINS", { mins: ctlMins.value }));
    if (ctlFit) ctlFit.addEventListener("change", () => sendCmd("SET_FIT", { fit: ctlFit.value }));
    if (ctlHud) ctlHud.addEventListener("change", () => sendCmd("SET_HUD", { on: ctlHud.value !== "off" }));
    if (ctlHudDetails) ctlHudDetails.addEventListener("change", () => sendCmd("SET_HUD_DETAILS", { collapsed: ctlHudDetails.value === "collapsed" }));
    if (ctlAutoskip) ctlAutoskip.addEventListener("change", () => sendCmd("SET_AUTOSKIP", { on: ctlAutoskip.value === "on" }));
    if (ctlAdfree) ctlAdfree.addEventListener("change", () => sendCmd("SET_ADFREE", { on: ctlAdfree.value === "on" }));
    if (ctlReset) ctlReset.addEventListener("click", () => sendCmd("RESET"));

    if (ctlGo) ctlGo.addEventListener("click", () => {
      const id = ctlSelect?.value;
      if (id) sendCmd("GOTO_ID", { id });
    });
    if (ctlSelect) {
      ctlSelect.addEventListener("dblclick", () => {
        const id = ctlSelect.value;
        if (id) sendCmd("GOTO_ID", { id });
      });
    }

    if (ctlBan) ctlBan.addEventListener("click", () => {
      const id = ctlSelect?.value || lastState?.cam?.id;
      if (id) sendCmd("BAN_ID", { id });
    });

    // Preview
    if (ctlPreviewOn) {
      ctlPreviewOn.addEventListener("change", () => {
        const on = ctlPreviewOn.value === "on";
        if (ctlPreviewWrap) ctlPreviewWrap.classList.toggle("hidden", !on);
        if (on && ctlPreview) ctlPreview.src = streamUrlFromHere();
        else if (ctlPreview) ctlPreview.src = "about:blank";
      });
    }

    // Copy URL
    if (ctlCopyStreamUrl) {
      ctlCopyStreamUrl.addEventListener("click", async () => {
        const url = streamUrlFromHere();
        const ok = await copyToClipboard(url);
        ctlCopyStreamUrl.textContent = ok ? "✅ Copiado" : "❌";
        setTimeout(() => (ctlCopyStreamUrl.textContent = "Copiar URL stream"), 900);
      });
    }

    // BGM
    if (ctlBgmOn) ctlBgmOn.addEventListener("change", () => sendCmd("BGM_ENABLE", { on: ctlBgmOn.value === "on" }));
    if (ctlBgmVol) ctlBgmVol.addEventListener("input", () => sendCmd("BGM_VOL", { vol: num(ctlBgmVol.value, 0) }));
    if (ctlBgmTrack) ctlBgmTrack.addEventListener("change", () => sendCmd("BGM_TRACK", { index: parseInt(ctlBgmTrack.value || "0", 10) || 0 }));
    if (ctlBgmPrev) ctlBgmPrev.addEventListener("click", () => sendCmd("BGM_PREV"));
    if (ctlBgmPlay) ctlBgmPlay.addEventListener("click", () => sendCmd("BGM_PLAYPAUSE"));
    if (ctlBgmNext) ctlBgmNext.addEventListener("click", () => sendCmd("BGM_NEXT"));
    if (ctlBgmShuffle) ctlBgmShuffle.addEventListener("click", () => sendCmd("BGM_SHUFFLE"));

    // Vote controls
    function voteApply() {
      const voteAtSec = clamp(parseInt(ctlVoteAt?.value || "60", 10) || 60, 5, 600);
      const windowSec = clamp(parseInt(ctlVoteWindow?.value || "60", 10) || 60, 5, 180);
      const leadSec = clamp(parseInt(ctlVoteLead?.value || "5", 10) || 5, 0, 30);
      const uiSec = windowSec + leadSec;

      const stayMins = ctlStayMins ? clamp(parseInt(ctlStayMins.value || "5", 10) || 5, 1, 120) : undefined;

      sendCmd("TWITCH_SET", {
        channel: (ctlTwitchChannel?.value || "").trim().replace(/^@/, ""),
        enabled: (ctlVoteOn?.value === "on"),
        overlay: (ctlVoteOverlay?.value !== "off"),
        windowSec,
        voteAtSec,
        leadSec,
        uiSec, // ✅ clave: overlay visible lead+window
        cmd: (ctlVoteCmd?.value || "!next,!cam|!stay,!keep").trim(),
        stayMins
      });
    }

    if (ctlVoteApply) ctlVoteApply.addEventListener("click", voteApply);

    if (ctlVoteStart) ctlVoteStart.addEventListener("click", () => {
      // Manual: el app.js decidirá si usa leadSec+windowSec o solo windowSec.
      const w = clamp(parseInt(ctlVoteWindow?.value || "60", 10) || 60, 5, 180);
      const lead = clamp(parseInt(ctlVoteLead?.value || "5", 10) || 5, 0, 30);
      sendCmd("VOTE_START", { windowSec: w, leadSec: lead, uiSec: w + lead });
    });

    // Teclas pro
    window.addEventListener("keydown", (e) => {
      const k = (e.key || "").toLowerCase();
      if (k === " ") { e.preventDefault(); sendCmd("TOGGLE_PLAY"); }
      else if (k === "n") sendCmd("NEXT");
      else if (k === "p") sendCmd("PREV");
    });

    setStatus("Esperando player…", false);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
