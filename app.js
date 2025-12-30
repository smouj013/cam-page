(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;
  const LOAD_GUARD = "__RANDOM_LIVE_CAMS_APPJS_LOADED_V110";
  try { if (g[LOAD_GUARD]) return; g[LOAD_GUARD] = true; } catch (_) {}

  // ───────────────────────── Helpers ─────────────────────────
  const qs = (s) => document.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtMMSS = (sec) => {
    sec = Math.max(0, sec | 0);
    const m = (sec / 60) | 0;
    const s = sec - m * 60;
    return `${pad2(m)}:${pad2(s)}`;
  };

  function parseParams() {
    const u = new URL(location.href);
    const mins = clamp(parseInt(u.searchParams.get("mins") || "5", 10) || 5, 1, 120);

    const admin = (u.searchParams.get("admin") === "1");
    const hideHud = (u.searchParams.get("hud") === "0");
    const fit = (u.searchParams.get("fit") || "cover"); // cover | contain
    const seedStr = u.searchParams.get("seed") || "";
    const debug = (u.searchParams.get("debug") === "1");
    const autoskip = (u.searchParams.get("autoskip") ?? "1") !== "0";
    const mode = (u.searchParams.get("mode") || "").toLowerCase(); // "adfree" | ""
    return { mins, admin, hideHud, fit, seedStr, debug, autoskip, mode };
  }

  // RNG (seed opcional)
  function makeRng(seedStr) {
    function xmur3(str) {
      let h = 1779033703 ^ str.length;
      for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
      }
      return function () {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        h ^= h >>> 16;
        return h >>> 0;
      };
    }
    function sfc32(a, b, c, d) {
      return function () {
        a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
        let t = (a + b) | 0;
        a = b ^ (b >>> 9);
        b = (c + (c << 3)) | 0;
        c = (c << 21) | (c >>> 11);
        d = (d + 1) | 0;
        t = (t + d) | 0;
        c = (c + t) | 0;
        return (t >>> 0) / 4294967296;
      };
    }
    const seed = seedStr ? seedStr : String(Date.now());
    const h = xmur3(seed);
    return sfc32(h(), h(), h(), h());
  }

  function shuffle(arr, rnd) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // ───────────────────────── DOM ─────────────────────────
  const frame = qs("#frame");
  const video = qs("#video");
  const img = qs("#img");
  const fallback = qs("#fallback");
  const fallbackLink = qs("#fallbackLink");

  const hud = qs("#hud");
  const hudTitle = qs("#hudTitle");
  const hudPlace = qs("#hudPlace");
  const hudSource = qs("#hudSource");
  const hudOrigin = qs("#hudOrigin");
  const hudCountdown = qs("#hudCountdown");
  const hudIndex = qs("#hudIndex");
  const progressBar = qs("#progressBar");
  const hudToggle = qs("#hudToggle");
  const hudDetails = qs("#hudDetails");

  // Admin
  const adminDrawer = qs("#admin");
  const adminFab = qs("#adminFab");
  const adminClose = qs("#adminClose");

  const btnPrev = qs("#btnPrev");
  const btnPlay = qs("#btnPlay");
  const btnNext = qs("#btnNext");
  const btnShuffle = qs("#btnShuffle");

  const admNowTitle = qs("#admNowTitle");
  const admNowPlace = qs("#admNowPlace");
  const admNowTimer = qs("#admNowTimer");

  const admMins = qs("#admMins");
  const admApplyMins = qs("#admApplyMins");

  const admHud = qs("#admHud");
  const admHudDetails = qs("#admHudDetails");
  const admFit = qs("#admFit");

  const admAutoskip = qs("#admAutoskip");
  const admAdfree = qs("#admAdfree");

  const admResetState = qs("#admResetState");

  const admSearch = qs("#admSearch");
  const admCamSelect = qs("#admCamSelect");
  const admGo = qs("#admGo");
  const admOrigin = qs("#admOrigin");

  const admUrl = qs("#admUrl");
  const admCopyUrl = qs("#admCopyUrl");

  // ───────────────────────── State ─────────────────────────
  const P = parseParams();
  const STORAGE_KEY = "random_live_cams_state_v1";
  const HUD_COLLAPSE_KEY = "random_live_cams_hud_collapsed_v1";
  const HUD_HIDE_KEY = "random_live_cams_hud_hidden_v1";

  const rnd = makeRng(P.seedStr);

  const allCams = Array.isArray(g.CAM_LIST) ? g.CAM_LIST.slice() : [];
  let cams = allCams.slice();

  let adfree = (P.mode === "adfree");
  if (adfree) cams = cams.filter(c => c && c.kind !== "youtube");

  let idx = 0;
  let playing = true;

  // duración “en caliente”
  let roundSeconds = (P.mins | 0) * 60;

  // deadline (anti drift)
  let roundEndsAt = 0;

  // Timers
  let tickTimer = null;
  let imgTimer = null;

  // HLS
  let hls = null;

  // locks
  let switching = false;

  // flags runtime
  let autoskip = !!P.autoskip;

  // ───────────────────────── HUD helpers ─────────────────────────
  function getHudCollapsed() {
    try {
      const raw = localStorage.getItem(HUD_COLLAPSE_KEY);
      if (raw === null || raw === undefined || raw === "") return true;
      return raw === "1";
    } catch (_) { return true; }
  }

  function setHudCollapsed(v) {
    const collapsed = !!v;
    hud.classList.toggle("hud--collapsed", collapsed);
    if (hudToggle) {
      hudToggle.textContent = collapsed ? "▸" : "▾";
      hudToggle.setAttribute("aria-expanded", String(!collapsed));
      hudToggle.setAttribute("aria-label", collapsed ? "Expandir HUD" : "Contraer HUD");
    }
    if (hudDetails) hudDetails.style.display = collapsed ? "none" : "";
    try { localStorage.setItem(HUD_COLLAPSE_KEY, collapsed ? "1" : "0"); } catch (_) {}
    if (admHudDetails) admHudDetails.value = collapsed ? "collapsed" : "expanded";
  }

  function getHudHidden() {
    try {
      const raw = localStorage.getItem(HUD_HIDE_KEY);
      if (raw === null || raw === undefined || raw === "") return !!P.hideHud;
      return raw === "1";
    } catch (_) { return !!P.hideHud; }
  }

  function setHudHidden(v) {
    const hidden = !!v;
    hud.classList.toggle("hidden", hidden);
    try { localStorage.setItem(HUD_HIDE_KEY, hidden ? "1" : "0"); } catch (_) {}
    if (admHud) admHud.value = hidden ? "off" : "on";
  }

  // ───────────────────────── UI helpers ─────────────────────────
  function showOnly(kind) {
    frame.classList.add("hidden");
    video.classList.add("hidden");
    img.classList.add("hidden");
    fallback.classList.add("hidden");

    if (kind === "youtube") frame.classList.remove("hidden");
    else if (kind === "hls") video.classList.remove("hidden");
    else if (kind === "image") img.classList.remove("hidden");
    else if (kind === "fallback") fallback.classList.remove("hidden");
  }

  function setFit(mode) {
    const m = (mode === "contain") ? "contain" : "cover";
    frame.style.objectFit = m;
    video.style.objectFit = m;
    img.style.objectFit = m;
    if (admFit) admFit.value = m;
  }

  function clearMedia() {
    if (imgTimer) { clearInterval(imgTimer); imgTimer = null; }

    try { if (hls) { hls.destroy(); hls = null; } } catch (_) {}

    try { frame.src = "about:blank"; } catch (_) {}
    try {
      video.pause();
      video.removeAttribute("src");
      video.load();
    } catch (_) {}
    try { img.removeAttribute("src"); } catch (_) {}

    try { img.onerror = null; } catch (_) {}
    try { video.onerror = null; } catch (_) {}
  }

  function setHud(cam) {
    hudTitle.textContent = cam.title || "Live Cam";
    hudPlace.textContent = cam.place || "—";
    hudSource.textContent = cam.source || "—";
    hudOrigin.href = cam.originUrl || "#";
    hudOrigin.style.pointerEvents = cam.originUrl ? "auto" : "none";
    hudOrigin.style.opacity = cam.originUrl ? "1" : ".6";
    hudIndex.textContent = `${idx + 1}/${cams.length}`;

    // admin "now"
    if (admNowTitle) admNowTitle.textContent = cam.title || "—";
    if (admNowPlace) admNowPlace.textContent = cam.place || "—";
    if (admOrigin) {
      admOrigin.href = cam.originUrl || "#";
      admOrigin.style.pointerEvents = cam.originUrl ? "auto" : "none";
      admOrigin.style.opacity = cam.originUrl ? "1" : ".65";
    }
  }

  function remainingSeconds() {
    if (!roundEndsAt) return roundSeconds;
    const ms = roundEndsAt - Date.now();
    return Math.max(0, Math.ceil(ms / 1000));
  }

  function setCountdownUI() {
    const rem = remainingSeconds();
    hudCountdown.textContent = fmtMMSS(rem);
    if (admNowTimer) admNowTimer.textContent = fmtMMSS(rem);

    const pct = 100 * (1 - (rem / Math.max(1, roundSeconds)));
    progressBar.style.width = `${clamp(pct, 0, 100).toFixed(2)}%`;
  }

  function startRound(seconds) {
    const s = clamp(seconds | 0, 1, 120 * 60);
    roundEndsAt = Date.now() + s * 1000;
    setCountdownUI();
  }

  function showFallback(cam, msg) {
    clearMedia();
    showOnly("fallback");
    const t = fallback.querySelector(".fallbackText");
    if (t) t.textContent = msg || "Saltando…";
    fallbackLink.href = (cam && cam.originUrl) ? cam.originUrl : "#";
    fallbackLink.style.pointerEvents = (cam && cam.originUrl) ? "auto" : "none";
    fallbackLink.style.opacity = (cam && cam.originUrl) ? "1" : ".6";
  }

  async function safePlayVideo() {
    try {
      const p = video.play();
      if (p && typeof p.then === "function") await p;
    } catch (_) {}
  }

  function effectiveCamSeconds(cam) {
    // ✅ imágenes: 1 minuto, como pediste (o maxSeconds si lo defines)
    if (cam && typeof cam.maxSeconds === "number" && cam.maxSeconds > 0) return cam.maxSeconds | 0;
    if (cam && cam.kind === "image") return 60;
    return roundSeconds;
  }

  // ───────────────────────── Playback ─────────────────────────
  function playCam(cam) {
    clearMedia();
    setHud(cam);

    // reinicia round con duración efectiva
    startRound(effectiveCamSeconds(cam));

    if (cam.kind === "youtube") {
      showOnly("youtube");
      const src =
        `https://www.youtube-nocookie.com/embed/${encodeURIComponent(cam.youtubeId)}`
        + `?autoplay=1&mute=1&controls=0&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&fs=0&disablekb=1`;
      frame.src = src;
      return;
    }

    if (cam.kind === "image") {
      showOnly("image");
      const refreshMs = Math.max(5000, (cam.refreshMs | 0) || 60000);

      const setSnap = () => {
        const u = cam.url;
        const sep = (u.indexOf("?") >= 0) ? "&" : "?";
        img.src = `${u}${sep}t=${Date.now()}`;
      };

      setSnap();
      imgTimer = setInterval(setSnap, refreshMs);

      if (autoskip) {
        img.onerror = () => {
          img.onerror = null;
          showFallback(cam, "Imagen no disponible (error). Saltando…");
          setTimeout(() => nextCam("img_error"), 900);
        };
      }
      return;
    }

    if (cam.kind === "hls") {
      showOnly("hls");
      const url = cam.url;
      const Hls = g.Hls;

      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        safePlayVideo();
      } else if (Hls && Hls.isSupported()) {
        hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 30
        });
        hls.loadSource(url);
        hls.attachMedia(video);

        hls.on(Hls.Events.ERROR, (_ev, data) => {
          if (!autoskip) return;
          if (data && data.fatal) {
            showFallback(cam, "Stream HLS no disponible. Saltando…");
            setTimeout(() => nextCam("hls_fatal"), 900);
          }
        });

        video.addEventListener("canplay", () => safePlayVideo(), { once: true });
      } else {
        showFallback(cam, "HLS no soportado aquí.");
        if (autoskip) setTimeout(() => nextCam("hls_unsupported"), 900);
      }

      if (autoskip) {
        video.onerror = () => {
          video.onerror = null;
          showFallback(cam, "Stream no disponible (error). Saltando…");
          setTimeout(() => nextCam("vid_error"), 900);
        };
      }
      return;
    }

    showFallback(cam, "Tipo de cámara no soportado.");
    if (autoskip) setTimeout(() => nextCam("unsupported"), 900);
  }

  // ───────────────────────── Rotation ─────────────────────────
  function nextCam(reason) {
    if (!cams.length || switching) return;
    switching = true;

    idx = (idx + 1) % cams.length;

    if (P.debug) console.log("[cams] next:", reason, idx, cams[idx]);
    playCam(cams[idx]);

    setTimeout(() => { switching = false; }, 250);
    syncAdminSelect();
  }

  function prevCam() {
    if (!cams.length || switching) return;
    switching = true;

    idx = (idx - 1 + cams.length) % cams.length;
    playCam(cams[idx]);

    setTimeout(() => { switching = false; }, 250);
    syncAdminSelect();
  }

  function setPlaying(v) {
    playing = !!v;
    if (btnPlay) btnPlay.textContent = playing ? "⏸" : "▶";
    if (playing) startRound(Math.max(1, remainingSeconds()));
  }

  function togglePlay() {
    setPlaying(!playing);
  }

  function reshuffle() {
    const curId = cams[idx] && cams[idx].id;
    shuffle(cams, rnd);
    const n = cams.findIndex(c => c.id === curId);
    idx = (n >= 0) ? n : 0;
    playCam(cams[idx]);
    syncAdminList();
  }

  function applyAdfree(on) {
    const want = !!on;
    if (want === adfree) return;

    adfree = want;
    const currentId = cams[idx] && cams[idx].id;

    cams = allCams.slice();
    if (adfree) cams = cams.filter(c => c && c.kind !== "youtube");
    if (!cams.length) {
      // fallback: si te quedas sin cams, revierte
      adfree = false;
      cams = allCams.slice();
    }

    let n = cams.findIndex(c => c && c.id === currentId);
    idx = (n >= 0) ? n : 0;

    syncAdminList();
    playCam(cams[idx]);
  }

  function setRoundMins(mins) {
    const m = clamp(parseInt(mins, 10) || 5, 1, 120);
    roundSeconds = m * 60;
    if (admMins) admMins.value = String(m);
    // aplica ya sin reset brusco: mantiene remaining si es menor
    const rem = remainingSeconds();
    startRound(Math.min(rem, roundSeconds));
  }

  function goToIndex(i) {
    const n = (i | 0);
    if (!cams.length) return;
    if (n < 0 || n >= cams.length) return;
    idx = n;
    playCam(cams[idx]);
    syncAdminSelect();
  }

  function goToId(id) {
    if (!cams.length) return;
    const n = cams.findIndex(c => c && c.id === id);
    if (n >= 0) goToIndex(n);
  }

  // ───────────────────────── Persistence ─────────────────────────
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) { return null; }
  }

  function saveState() {
    try {
      const rem = remainingSeconds();
      const st = {
        idx,
        remaining: rem,
        playing,
        ts: Date.now(),
        version: 2,
        adfree: adfree ? 1 : 0,
        autoskip: autoskip ? 1 : 0,
        mins: Math.max(1, (roundSeconds / 60) | 0)
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
    } catch (_) {}
  }

  function resetState() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    idx = 0;
    setPlaying(true);
    setRoundMins(5);
    applyAdfree(false);
    autoskip = true;
    if (admAutoskip) admAutoskip.value = "on";
    if (admAdfree) admAdfree.value = "off";
    playCam(cams[idx]);
  }

  // ───────────────────────── Tick ─────────────────────────
  function tick() {
    if (!playing) return;
    const rem = remainingSeconds();
    setCountdownUI();
    if (rem <= 0) nextCam("timer");
  }

  function startTick() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(tick, 250);
  }

  // ───────────────────────── Admin UI ─────────────────────────
  function openAdmin() {
    adminDrawer.classList.remove("hidden");
    adminFab.classList.add("hidden");
  }
  function closeAdmin() {
    adminDrawer.classList.add("hidden");
    adminFab.classList.remove("hidden");
  }

  function camLabel(cam) {
    const t = (cam && cam.title) ? cam.title : "Live Cam";
    const p = (cam && cam.place) ? cam.place : "";
    return p ? `${t} — ${p}` : t;
  }

  function syncAdminList(filter = "") {
    if (!admCamSelect) return;

    const f = String(filter || "").trim().toLowerCase();
    const list = [];
    for (let i = 0; i < cams.length; i++) {
      const cam = cams[i];
      const hay = `${cam?.title || ""} ${cam?.place || ""} ${cam?.source || ""}`.toLowerCase();
      if (!f || hay.includes(f)) list.push({ i, cam });
    }

    admCamSelect.innerHTML = "";
    for (const it of list) {
      const opt = document.createElement("option");
      opt.value = it.cam.id;
      opt.textContent = camLabel(it.cam);
      if (it.i === idx) opt.selected = true;
      admCamSelect.appendChild(opt);
    }
  }

  function syncAdminSelect() {
    if (!admCamSelect) return;
    const cur = cams[idx];
    if (!cur) return;

    // intenta seleccionar por id incluso con filtro
    const options = Array.from(admCamSelect.options || []);
    const match = options.find(o => o.value === cur.id);
    if (match) match.selected = true;

    // actualiza enlace origen
    if (admOrigin) {
      admOrigin.href = cur.originUrl || "#";
      admOrigin.style.pointerEvents = cur.originUrl ? "auto" : "none";
      admOrigin.style.opacity = cur.originUrl ? "1" : ".65";
    }
  }

  function fillObsUrl() {
    if (!admUrl) return;
    const u = new URL(location.href);
    u.searchParams.set("admin", "1");
    u.searchParams.set("hud", "1");
    u.searchParams.set("mins", String(Math.max(1, (roundSeconds / 60) | 0)));
    if (adfree) u.searchParams.set("mode", "adfree"); else u.searchParams.delete("mode");
    if (!autoskip) u.searchParams.set("autoskip", "0"); else u.searchParams.delete("autoskip");
    admUrl.value = u.toString();
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      // fallback
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
      } catch (_) {
        return false;
      }
    }
  }

  // ───────────────────────── Boot ─────────────────────────
  function boot() {
    if (!allCams.length) {
      showFallback({ originUrl: "#" }, "No hay cámaras definidas (revisa cams.js).");
      return;
    }

    // Fit
    setFit(P.fit);

    // HUD persisted
    setHudCollapsed(getHudCollapsed());
    setHudHidden(getHudHidden());

    if (hudToggle) {
      hudToggle.addEventListener("click", (e) => {
        e.preventDefault();
        setHudCollapsed(!hud.classList.contains("hud--collapsed"));
      });
    }

    // Admin enable
    const adminEnabled = !!P.admin;
    if (adminEnabled) {
      adminDrawer.classList.remove("hidden");
      adminFab.classList.add("hidden");
    } else {
      adminDrawer.classList.add("hidden");
      adminFab.classList.add("hidden"); // por defecto no se muestra si no admin
    }

    // mezcla inicial
    shuffle(cams, rnd);

    // cargar estado previo
    const st = loadState();
    if (st && typeof st.idx === "number" && st.idx >= 0 && st.idx < cams.length) {
      idx = st.idx | 0;
      setPlaying(!!st.playing);

      if (st.mins) setRoundMins(st.mins);
      autoskip = (st.autoskip ?? 1) !== 0;
      if (st.adfree) applyAdfree(!!st.adfree);

      const rem = clamp((st.remaining | 0) || roundSeconds, 1, 120 * 60);
      startRound(rem);
    } else {
      idx = 0;
      setPlaying(true);
      setRoundMins(P.mins);
      startRound(roundSeconds);
    }

    // play
    playCam(cams[idx]);
    startTick();

    // Admin wiring (si existe el panel en HTML)
    if (adminEnabled) {
      // fab/close
      if (adminFab) adminFab.classList.remove("hidden");
      if (adminClose) adminClose.addEventListener("click", closeAdmin);
      if (adminFab) adminFab.addEventListener("click", openAdmin);

      // buttons
      if (btnNext) btnNext.addEventListener("click", () => nextCam("admin"));
      if (btnPrev) btnPrev.addEventListener("click", () => prevCam());
      if (btnPlay) btnPlay.addEventListener("click", () => togglePlay());
      if (btnShuffle) btnShuffle.addEventListener("click", () => reshuffle());

      // rotation mins
      if (admMins) admMins.value = String(Math.max(1, (roundSeconds / 60) | 0));
      if (admApplyMins) admApplyMins.addEventListener("click", () => setRoundMins(admMins.value));

      // view
      if (admHud) {
        admHud.value = hud.classList.contains("hidden") ? "off" : "on";
        admHud.addEventListener("change", () => setHudHidden(admHud.value === "off"));
      }
      if (admHudDetails) {
        admHudDetails.value = hud.classList.contains("hud--collapsed") ? "collapsed" : "expanded";
        admHudDetails.addEventListener("change", () => setHudCollapsed(admHudDetails.value === "collapsed"));
      }
      if (admFit) {
        admFit.value = (P.fit === "contain") ? "contain" : "cover";
        admFit.addEventListener("change", () => setFit(admFit.value));
      }

      // mode
      if (admAutoskip) {
        admAutoskip.value = autoskip ? "on" : "off";
        admAutoskip.addEventListener("change", () => { autoskip = (admAutoskip.value === "on"); fillObsUrl(); });
      }
      if (admAdfree) {
        admAdfree.value = adfree ? "on" : "off";
        admAdfree.addEventListener("change", () => { applyAdfree(admAdfree.value === "on"); fillObsUrl(); });
      }

      if (admResetState) admResetState.addEventListener("click", resetState);

      // cam list
      syncAdminList("");
      syncAdminSelect();

      if (admSearch) {
        admSearch.addEventListener("input", () => {
          syncAdminList(admSearch.value);
        });
      }
      if (admGo) {
        admGo.addEventListener("click", () => {
          const id = admCamSelect && admCamSelect.value;
          if (id) goToId(id);
        });
      }
      if (admCamSelect) {
        admCamSelect.addEventListener("dblclick", () => {
          const id = admCamSelect.value;
          if (id) goToId(id);
        });
        admCamSelect.addEventListener("change", () => {
          const id = admCamSelect.value;
          const cam = cams.find(c => c && c.id === id);
          if (cam && admOrigin) {
            admOrigin.href = cam.originUrl || "#";
            admOrigin.style.pointerEvents = cam.originUrl ? "auto" : "none";
            admOrigin.style.opacity = cam.originUrl ? "1" : ".65";
          }
        });
      }

      // obs url
      fillObsUrl();
      if (admCopyUrl) {
        admCopyUrl.addEventListener("click", async () => {
          const ok = await copyToClipboard(admUrl.value || location.href);
          admCopyUrl.textContent = ok ? "✅ Copiado" : "❌";
          setTimeout(() => { admCopyUrl.textContent = "Copiar"; }, 900);
        });
      }
    }

    // teclado
    window.addEventListener("keydown", (e) => {
      const k = (e.key || "").toLowerCase();
      if (k === " ") { e.preventDefault(); togglePlay(); }
      else if (k === "n") { nextCam("key"); }
      else if (k === "p") { prevCam(); }
      else if (k === "h") { setHudHidden(!hud.classList.contains("hidden")); }
      else if (k === "i") { setHudCollapsed(!hud.classList.contains("hud--collapsed")); }
      else if (k === "a") {
        if (!P.admin) return;
        if (adminDrawer.classList.contains("hidden")) openAdmin();
        else closeAdmin();
      }
    });

    // guardado
    setInterval(saveState, 2000);
    document.addEventListener("visibilitychange", () => { if (document.hidden) saveState(); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
