/* control.js — RLC Control v2.1.4 (BOT IRC + ADS + SAFE APPLY)
   ✅ Controla el Player por BroadcastChannel/localStorage
   ✅ Copia URL del stream con params correctos (voteUi, ads, alerts, chat...)
   ✅ Bot IRC (OAuth) configurable desde el panel (manda mensajes al chat)
   ✅ Bot NO se incluye en URL (seguridad)
*/
(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  // Guard anti doble carga
  const LOAD_GUARD = "__RLC_CONTROL_LOADED_V214";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  const BUS = "rlc_bus_v1";
  const CMD_KEY = "rlc_cmd_v1";
  const STATE_KEY = "rlc_state_v1";

  const BOT_STORE_KEY = "rlc_bot_cfg_v1"; // solo control.html (no player)

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
  const ctlVoteWindow = qs("#ctlVoteWindow");
  const ctlVoteAt = qs("#ctlVoteAt");
  const ctlVoteLead = qs("#ctlVoteLead");
  const ctlVoteCmd = qs("#ctlVoteCmd");
  const ctlVoteStart = qs("#ctlVoteStart");
  const ctlVoteApply = qs("#ctlVoteApply");

  const ctlStayMins = qs("#ctlStayMins");
  const ctlYtCookies = qs("#ctlYtCookies");

  // Chat/Alerts
  const ctlChatOn = qs("#ctlChatOn");
  const ctlChatHideCmd = qs("#ctlChatHideCmd");
  const ctlAlertsOn = qs("#ctlAlertsOn");

  // ADS (player overlay)
  const ctlAdsOn = qs("#ctlAdsOn");
  const ctlAdLead = qs("#ctlAdLead");
  const ctlAdDur = qs("#ctlAdDur");
  const ctlAdShowDuring = qs("#ctlAdShowDuring");
  const ctlAdChatText = qs("#ctlAdChatText");

  const ctlAdNoticeBtn = qs("#ctlAdNoticeBtn");
  const ctlAdBeginBtn = qs("#ctlAdBeginBtn");
  const ctlAdClearBtn = qs("#ctlAdClearBtn");

  // BOT (control->twitch chat)
  const ctlBotOn = qs("#ctlBotOn");
  const ctlBotUser = qs("#ctlBotUser");
  const ctlBotToken = qs("#ctlBotToken");
  const ctlBotConnect = qs("#ctlBotConnect");
  const ctlBotStatus = qs("#ctlBotStatus");
  const ctlBotSayOnAd = qs("#ctlBotSayOnAd");
  const ctlBotTestText = qs("#ctlBotTestText");
  const ctlBotTestSend = qs("#ctlBotTestSend");

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

  function setBotStatus(text, ok = true) {
    if (!ctlBotStatus) return;
    ctlBotStatus.textContent = text;
    ctlBotStatus.classList.toggle("pill--ok", !!ok);
    ctlBotStatus.classList.toggle("pill--bad", !ok);
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

  // ✅ evita que applyState te “pise” mientras editas
  function isEditing(el) {
    if (!el) return false;
    try {
      return document.activeElement === el || el.matches(":focus");
    } catch (_) {
      return document.activeElement === el;
    }
  }

  function safeSetValue(el, v) {
    if (!el) return;
    if (isEditing(el)) return;
    el.value = String(v);
  }

  // ───────────────────────── BOT IRC (AUTH) ─────────────────────────
  // Se usa SOLO desde control.html. El token nunca viaja en URL.
  class TwitchAuthIRC {
    constructor(getCfg, onStatus) {
      this.getCfg = getCfg; // () => {on,user,token,channel}
      this.onStatus = onStatus || (() => {});
      this.ws = null;
      this.closed = true;
      this.connected = false;
      this.joinedChan = "";
      this.backoff = 900;
      this.timer = null;
      this.queue = [];
    }

    _set(ok, msg) {
      this.connected = !!ok;
      try { this.onStatus(msg, !!ok); } catch (_) {}
    }

    _normalizeToken(tok) {
      const t = String(tok || "").trim();
      if (!t) return "";
      // Acepta token con o sin "oauth:"
      return t.startsWith("oauth:") ? t : ("oauth:" + t);
    }

    connect() {
      const cfg = this.getCfg();
      if (!cfg || !cfg.on) { this.close(); this._set(false, "Bot OFF"); return; }

      const user = String(cfg.user || "").trim();
      const token = this._normalizeToken(cfg.token);
      const chan = String(cfg.channel || "").trim().replace(/^#/, "").replace(/^@/, "").toLowerCase();

      if (!user || !token || !chan) {
        this._set(false, "Falta user/token/canal");
        return;
      }

      this.closed = false;
      this._set(false, "Conectando…");

      try { this.ws?.close?.(); } catch (_) {}
      this.ws = null;

      let ws;
      try {
        ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
      } catch (_) {
        this._set(false, "WebSocket no disponible");
        return;
      }
      this.ws = ws;

      ws.onopen = () => {
        this.backoff = 900;
        this.joinedChan = "";
        this._set(true, "Conectado (auth)");

        // Auth
        ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands\r\n");
        ws.send(`PASS ${token}\r\n`);
        ws.send(`NICK ${user}\r\n`);
        ws.send(`JOIN #${chan}\r\n`);
      };

      ws.onmessage = (ev) => {
        const text = String(ev.data || "");
        const lines = text.split("\r\n").filter(Boolean);
        for (const line of lines) this._handleLine(line);
      };

      ws.onclose = () => {
        this.connected = false;
        if (this.closed) { this._set(false, "Desconectado"); return; }
        this._set(false, "Reconectando…");
        this._scheduleReconnect();
      };

      ws.onerror = () => {};
    }

    _scheduleReconnect() {
      try { if (this.timer) clearTimeout(this.timer); } catch (_) {}
      const wait = clamp(this.backoff | 0, 900, 12000);
      this.backoff = Math.min(12000, (this.backoff * 1.5) | 0);
      this.timer = setTimeout(() => {
        if (this.closed) return;
        this.connect();
      }, wait);
    }

    _handleLine(line) {
      if (!line) return;
      if (line.startsWith("PING")) {
        try { this.ws?.send?.("PONG :tmi.twitch.tv\r\n"); } catch (_) {}
        return;
      }

      // Detecta JOIN ok
      const mJoin = line.match(/ JOIN #([a-z0-9_]+)/i);
      if (mJoin) {
        this.joinedChan = (mJoin[1] || "").toLowerCase();
        // flush queue
        this._flush();
        return;
      }

      // NOTICE de auth fallida
      if (line.includes("Login authentication failed")) {
        this._set(false, "Auth fallida (token?)");
        this.close();
      }
    }

    close() {
      this.closed = true;
      this.connected = false;
      try { if (this.timer) clearTimeout(this.timer); } catch (_) {}
      this.timer = null;
      try { this.ws?.close?.(); } catch (_) {}
      this.ws = null;
      this.queue = [];
      this.joinedChan = "";
    }

    _flush() {
      if (!this.ws || this.ws.readyState !== 1) return;
      if (!this.joinedChan) return;
      const max = 10;
      let n = 0;
      while (this.queue.length && n < max) {
        const it = this.queue.shift();
        try { this.ws.send(it); } catch (_) {}
        n++;
      }
    }

    say(message, channel) {
      const cfg = this.getCfg();
      const chan = String(channel || cfg.channel || "").trim().replace(/^#/, "").replace(/^@/, "").toLowerCase();
      const msg = String(message || "").trim();
      if (!cfg || !cfg.on) return false;
      if (!chan || !msg) return false;

      const line = `PRIVMSG #${chan} :${msg}\r\n`;

      if (this.ws && this.ws.readyState === 1 && this.joinedChan) {
        try { this.ws.send(line); return true; } catch (_) { return false; }
      }

      // cola (por si está conectando)
      this.queue.push(line);
      // intenta conectar si no está
      if (!this.ws || this.ws.readyState > 1) this.connect();
      return true;
    }
  }

  function loadBotCfg() {
    try {
      const raw = localStorage.getItem(BOT_STORE_KEY);
      if (!raw) return { on: false, user: "", token: "", sayOnAd: true };
      const o = JSON.parse(raw);
      if (!o || typeof o !== "object") return { on: false, user: "", token: "", sayOnAd: true };
      return {
        on: !!o.on,
        user: String(o.user || ""),
        token: String(o.token || ""),
        sayOnAd: (typeof o.sayOnAd === "boolean") ? o.sayOnAd : true
      };
    } catch (_) {
      return { on: false, user: "", token: "", sayOnAd: true };
    }
  }

  function saveBotCfg(cfg) {
    try {
      localStorage.setItem(BOT_STORE_KEY, JSON.stringify(cfg || {}));
    } catch (_) {}
  }

  let botCfg = loadBotCfg();
  const bot = new TwitchAuthIRC(
    () => ({
      on: !!(ctlBotOn?.value === "on"),
      user: (ctlBotUser?.value || botCfg.user || "").trim(),
      token: (ctlBotToken?.value || botCfg.token || "").trim(),
      channel: (ctlTwitchChannel?.value || "").trim().replace(/^@/, "")
    }),
    (msg, ok) => setBotStatus(msg, ok)
  );

  function syncBotUIFromStore() {
    if (ctlBotOn) ctlBotOn.value = botCfg.on ? "on" : "off";
    if (ctlBotUser) ctlBotUser.value = botCfg.user || "";
    if (ctlBotToken) ctlBotToken.value = botCfg.token || "";
    if (ctlBotSayOnAd) ctlBotSayOnAd.value = (botCfg.sayOnAd !== false) ? "on" : "off";
    setBotStatus(botCfg.on ? "Bot listo" : "Bot OFF", !!botCfg.on);
  }

  function persistBotUIToStore() {
    botCfg = {
      on: !!(ctlBotOn?.value === "on"),
      user: String(ctlBotUser?.value || "").trim(),
      token: String(ctlBotToken?.value || "").trim(),
      sayOnAd: !!(ctlBotSayOnAd?.value !== "off")
    };
    saveBotCfg(botCfg);
  }

  // ✅ URL del stream (index.html) desde el panel
  function streamUrlFromHere() {
    const u = new URL(location.href);
    u.pathname = u.pathname.replace(/control\.html$/i, "index.html");

    // básicos
    u.searchParams.set("mins", String(clamp(parseInt(ctlMins?.value || "5", 10) || 5, 1, 120)));
    u.searchParams.set("fit", ctlFit?.value || "cover");
    u.searchParams.set("hud", (ctlHud?.value === "off") ? "0" : "1");

    if (ctlAdfree?.value === "on") u.searchParams.set("mode", "adfree");
    else u.searchParams.delete("mode");

    if (ctlAutoskip?.value === "off") u.searchParams.set("autoskip", "0");
    else u.searchParams.delete("autoskip");

    // voto
    if (ctlVoteOn?.value === "on") u.searchParams.set("vote", "1");
    else u.searchParams.delete("vote");

    const ch = (ctlTwitchChannel?.value || "").trim().replace(/^@/, "");
    if (ch) u.searchParams.set("twitch", ch);
    else u.searchParams.delete("twitch");

    const windowSec = clamp(parseInt(ctlVoteWindow?.value || "60", 10) || 60, 5, 180);
    const leadSec = clamp(parseInt(ctlVoteLead?.value || "0", 10) || 0, 0, 30);
    const voteAtSec = clamp(parseInt(ctlVoteAt?.value || "60", 10) || 60, 5, 600);

    u.searchParams.set("voteOverlay", (ctlVoteOverlay?.value === "off") ? "0" : "1");
    u.searchParams.set("voteWindow", String(windowSec));
    u.searchParams.set("voteLead", String(leadSec));
    u.searchParams.set("voteAt", String(voteAtSec));
    u.searchParams.set("voteUi", String(windowSec + leadSec));

    if (ctlVoteCmd?.value) u.searchParams.set("voteCmd", ctlVoteCmd.value.trim());

    // stayMins
    if (ctlStayMins) {
      const sm = clamp(parseInt(ctlStayMins.value || "5", 10) || 5, 1, 120);
      u.searchParams.set("stayMins", String(sm));
    }

    // ytCookies
    if (ctlYtCookies) {
      const v = String(ctlYtCookies.value || "off").toLowerCase();
      u.searchParams.set("ytCookies", (v === "on") ? "1" : "0");
    }

    // bgm
    if (ctlBgmOn?.value === "on") u.searchParams.set("bgm", "1");
    else u.searchParams.delete("bgm");
    if (ctlBgmVol?.value != null) u.searchParams.set("bgmVol", String(ctlBgmVol.value));

    // chat/alerts
    if (ctlChatOn?.value === "on") u.searchParams.set("chat", "1");
    else u.searchParams.delete("chat");

    if (ctlChatHideCmd?.value === "off") u.searchParams.set("chatHideCommands", "0");
    else u.searchParams.delete("chatHideCommands");

    if (ctlAlertsOn?.value === "on") u.searchParams.set("alerts", "1");
    else u.searchParams.delete("alerts");

    // ads overlay
    if (ctlAdsOn?.value === "on") u.searchParams.set("ads", "1");
    else u.searchParams.set("ads", "0");

    if (ctlAdLead?.value != null) u.searchParams.set("adLead", String(clamp(parseInt(ctlAdLead.value || "30", 10) || 30, 0, 300)));
    if (ctlAdShowDuring?.value === "off") u.searchParams.set("adShowDuring", "0");
    else u.searchParams.set("adShowDuring", "1");

    if (ctlAdChatText?.value) u.searchParams.set("adChatText", ctlAdChatText.value.trim());

    // key (IMPORTANTE: misma key que el player)
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

    // ⚠️ NO pisar inputs si el usuario los está editando
    if (ctlMins && st?.mins) safeSetValue(ctlMins, st.mins);
    if (ctlFit && st?.fit && !isEditing(ctlFit)) ctlFit.value = st.fit;

    if (ctlHud && !isEditing(ctlHud)) ctlHud.value = st?.hudHidden ? "off" : "on";
    if (ctlHudDetails && !isEditing(ctlHudDetails)) ctlHudDetails.value = st?.hudCollapsed ? "collapsed" : "expanded";
    if (ctlAutoskip && !isEditing(ctlAutoskip)) ctlAutoskip.value = st?.autoskip ? "on" : "off";
    if (ctlAdfree && !isEditing(ctlAdfree)) ctlAdfree.value = st?.adfree ? "on" : "off";

    // BGM
    if (ctlBgmOn && !isEditing(ctlBgmOn)) ctlBgmOn.value = st?.bgm?.enabled ? "on" : "off";
    if (ctlBgmVol && typeof st?.bgm?.vol === "number") safeSetValue(ctlBgmVol, st.bgm.vol);
    if (ctlBgmTrack && st?.bgm?.idx != null && !isEditing(ctlBgmTrack)) ctlBgmTrack.value = String(st.bgm.idx | 0);
    if (ctlBgmNow) {
      const name = st?.bgm?.track || "";
      ctlBgmNow.textContent = name ? `Now: ${name} · ${st?.bgm?.playing ? "playing" : "paused"}` : "—";
    }

    // Vote state
    const vote = st?.vote || {};
    if (ctlTwitchChannel && typeof vote?.channel === "string") {
      if (!ctlTwitchChannel.value || !isEditing(ctlTwitchChannel)) safeSetValue(ctlTwitchChannel, vote.channel);
    }
    if (ctlVoteOn && !isEditing(ctlVoteOn)) ctlVoteOn.value = vote?.enabled ? "on" : "off";
    if (ctlVoteOverlay && !isEditing(ctlVoteOverlay)) ctlVoteOverlay.value = vote?.overlay ? "on" : "off";
    if (ctlVoteWindow && vote?.windowSec != null) safeSetValue(ctlVoteWindow, (vote.windowSec | 0));
    if (ctlVoteAt && vote?.voteAtSec != null) safeSetValue(ctlVoteAt, (vote.voteAtSec | 0));
    if (ctlVoteLead && vote?.leadSec != null) safeSetValue(ctlVoteLead, clamp((vote.leadSec | 0), 0, 30));
    if (ctlVoteCmd && typeof vote?.cmd === "string") {
      if (!isEditing(ctlVoteCmd)) ctlVoteCmd.value = vote.cmd || ctlVoteCmd.value;
    }
    if (ctlStayMins) {
      const sm =
        (vote?.stayMins != null) ? (vote.stayMins | 0)
        : (vote?.staySec != null) ? Math.max(1, Math.round((vote.staySec | 0) / 60))
        : null;
      if (sm != null) safeSetValue(ctlStayMins, clamp(sm, 1, 120));
    }

    if (ctlYtCookies && st?.ytCookies != null && !isEditing(ctlYtCookies)) {
      ctlYtCookies.value = st.ytCookies ? "on" : "off";
    }

    // Chat/Alerts/Ads (si vienen en state)
    if (ctlChatOn && st?.chat?.enabled != null && !isEditing(ctlChatOn)) ctlChatOn.value = st.chat.enabled ? "on" : "off";
    if (ctlChatHideCmd && st?.chat?.hideCommands != null && !isEditing(ctlChatHideCmd)) ctlChatHideCmd.value = st.chat.hideCommands ? "on" : "off";
    if (ctlAlertsOn && st?.alertsEnabled != null && !isEditing(ctlAlertsOn)) ctlAlertsOn.value = st.alertsEnabled ? "on" : "off";

    if (ctlAdsOn && st?.ads?.enabled != null && !isEditing(ctlAdsOn)) ctlAdsOn.value = st.ads.enabled ? "on" : "off";
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
    syncBotUIFromStore();

    // defaults seguros
    if (ctlVoteAt && !ctlVoteAt.value) ctlVoteAt.value = "60";
    if (ctlVoteWindow && !ctlVoteWindow.value) ctlVoteWindow.value = "60";
    if (ctlVoteLead && !ctlVoteLead.value) ctlVoteLead.value = "0";
    if (ctlStayMins && !ctlStayMins.value) ctlStayMins.value = "5";
    if (ctlYtCookies && !ctlYtCookies.value) ctlYtCookies.value = "on";

    if (ctlChatOn && !ctlChatOn.value) ctlChatOn.value = "on";
    if (ctlChatHideCmd && !ctlChatHideCmd.value) ctlChatHideCmd.value = "on";
    if (ctlAlertsOn && !ctlAlertsOn.value) ctlAlertsOn.value = "on";

    if (ctlAdsOn && !ctlAdsOn.value) ctlAdsOn.value = "on";
    if (ctlAdLead && !ctlAdLead.value) ctlAdLead.value = "30";
    if (ctlAdDur && !ctlAdDur.value) ctlAdDur.value = "30";
    if (ctlAdShowDuring && !ctlAdShowDuring.value) ctlAdShowDuring.value = "on";
    if (ctlAdChatText && !ctlAdChatText.value) ctlAdChatText.value = "⚠️ Anuncio en breve… ¡gracias por apoyar el canal! 💜";

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
      const leadSec = clamp(parseInt(ctlVoteLead?.value || "0", 10) || 0, 0, 30);
      const stayMins = ctlStayMins ? clamp(parseInt(ctlStayMins.value || "5", 10) || 5, 1, 120) : undefined;

      sendCmd("TWITCH_SET", {
        channel: (ctlTwitchChannel?.value || "").trim().replace(/^@/, ""),
        enabled: (ctlVoteOn?.value === "on"),
        overlay: (ctlVoteOverlay?.value !== "off"),
        windowSec,
        voteAtSec,
        leadSec,
        uiSec: windowSec + leadSec,
        cmd: (ctlVoteCmd?.value || "!next,!cam|!stay,!keep").trim(),
        stayMins,
        // chat/alerts toggles
        chat: (ctlChatOn?.value === "on"),
        chatHideCommands: (ctlChatHideCmd?.value !== "off"),
        alerts: (ctlAlertsOn?.value === "on"),
      });

      // ads set (runtime)
      sendCmd("ADS_SET", {
        enabled: (ctlAdsOn?.value === "on"),
        adLead: clamp(parseInt(ctlAdLead?.value || "30", 10) || 30, 0, 300),
        adShowDuring: (ctlAdShowDuring?.value !== "off"),
        adChatText: (ctlAdChatText?.value || "").trim(),
      });
    }

    if (ctlVoteApply) ctlVoteApply.addEventListener("click", voteApply);

    if (ctlVoteStart) ctlVoteStart.addEventListener("click", () => {
      const w = clamp(parseInt(ctlVoteWindow?.value || "60", 10) || 60, 5, 180);
      const lead = clamp(parseInt(ctlVoteLead?.value || "0", 10) || 0, 0, 30);
      sendCmd("VOTE_START", { windowSec: w, leadSec: lead, uiSec: w + lead });
    });

    // ADS buttons (player overlay) + bot say opcional
    function maybeBotSay(text) {
      const botOn = (ctlBotOn?.value === "on");
      const sayOnAd = (ctlBotSayOnAd?.value !== "off");
      if (!botOn || !sayOnAd) return;
      const ch = (ctlTwitchChannel?.value || "").trim().replace(/^@/, "");
      if (!ch) return;
      const msg = String(text || "").trim();
      if (!msg) return;
      bot.say(msg, ch);
    }

    if (ctlAdNoticeBtn) ctlAdNoticeBtn.addEventListener("click", () => {
      const lead = clamp(parseInt(ctlAdLead?.value || "30", 10) || 30, 0, 300);
      sendCmd("AD_NOTICE", { leadSec: lead });
      const msg = (ctlAdChatText?.value || "").trim();
      if (lead > 0) maybeBotSay(msg || `⚠️ Anuncio en ${lead}s…`);
      else maybeBotSay(msg || "⚠️ Anuncio en breve…");
    });

    if (ctlAdBeginBtn) ctlAdBeginBtn.addEventListener("click", () => {
      const dur = clamp(parseInt(ctlAdDur?.value || "30", 10) || 30, 5, 600);
      sendCmd("AD_BEGIN", { durationSec: dur });
      maybeBotSay(`⏳ Anuncio en curso (${dur}s)…`);
    });

    if (ctlAdClearBtn) ctlAdClearBtn.addEventListener("click", () => {
      sendCmd("AD_CLEAR", {});
    });

    // BOT UI
    function onBotCfgChange() {
      persistBotUIToStore();
      if (ctlBotOn?.value === "on") bot.connect();
      else bot.close();
    }

    if (ctlBotOn) ctlBotOn.addEventListener("change", onBotCfgChange);
    if (ctlBotUser) ctlBotUser.addEventListener("input", () => { persistBotUIToStore(); });
    if (ctlBotToken) ctlBotToken.addEventListener("input", () => { persistBotUIToStore(); });
    if (ctlBotSayOnAd) ctlBotSayOnAd.addEventListener("change", () => { persistBotUIToStore(); });

    if (ctlBotConnect) ctlBotConnect.addEventListener("click", () => {
      persistBotUIToStore();
      if (ctlBotOn?.value !== "on") { ctlBotOn.value = "on"; persistBotUIToStore(); }
      bot.connect();
    });

    if (ctlBotTestSend) ctlBotTestSend.addEventListener("click", () => {
      persistBotUIToStore();
      const ch = (ctlTwitchChannel?.value || "").trim().replace(/^@/, "");
      const msg = (ctlBotTestText?.value || "✅ Bot OK").trim();
      if (!ch) { setBotStatus("Pon canal primero", false); return; }
      const ok = bot.say(msg, ch);
      setBotStatus(ok ? "Enviado" : "No enviado", ok);
      setTimeout(() => setBotStatus(bot.connected ? "Conectado (auth)" : "Bot listo", !!bot.connected), 900);
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
