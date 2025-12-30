(() => {
  "use strict";

  const g = (typeof globalThis !== "undefined") ? globalThis : window;

  // ───────────────────── Helpers ─────────────────────
  const qs = (s) => document.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtMMSS = (sec) => {
    sec = Math.max(0, sec|0);
    const m = (sec / 60) | 0;
    const s = sec - m * 60;
    return `${pad2(m)}:${pad2(s)}`;
  };

  function parseParams(){
    const u = new URL(location.href);
    const mins = clamp(parseInt(u.searchParams.get("mins") || "5", 10) || 5, 1, 60);
    const admin = (u.searchParams.get("admin") === "1");
    const hideHud = (u.searchParams.get("hud") === "0");
    const fit = (u.searchParams.get("fit") || "cover"); // cover | contain
    const seedStr = u.searchParams.get("seed") || "";
    const debug = (u.searchParams.get("debug") === "1");
    return { mins, admin, hideHud, fit, seedStr, debug };
  }

  // RNG (seed opcional)
  function makeRng(seedStr){
    // xmur3 + sfc32 (simple y estable)
    function xmur3(str){
      let h = 1779033703 ^ str.length;
      for (let i=0;i<str.length;i++){
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
      }
      return function(){
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        h ^= h >>> 16;
        return h >>> 0;
      };
    }
    function sfc32(a,b,c,d){
      return function(){
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

  function shuffle(arr, rnd){
    for (let i = arr.length - 1; i > 0; i--){
      const j = (rnd() * (i + 1)) | 0;
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // ───────────────────── DOM ─────────────────────
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

  const adminPanel = qs("#admin");
  const btnPrev = qs("#btnPrev");
  const btnToggle = qs("#btnToggle");
  const btnNext = qs("#btnNext");
  const btnShuffle = qs("#btnShuffle");

  // ───────────────────── State ─────────────────────
  const P = parseParams();
  const ROUND_SECONDS = P.mins * 60;

  const STORAGE_KEY = "random_live_cams_state_v1";

  const rnd = makeRng(P.seedStr);
  let cams = Array.isArray(g.CAM_LIST) ? g.CAM_LIST.slice() : [];

  let idx = 0;
  let remaining = ROUND_SECONDS;
  let playing = true;

  let timer = null;
  let imgTimer = null;
  let failTimer = null;

  // HLS
  let hls = null;

  // ───────────────────── UI helpers ─────────────────────
  function showOnly(kind){
    frame.classList.add("hidden");
    video.classList.add("hidden");
    img.classList.add("hidden");
    fallback.classList.add("hidden");

    if (kind === "youtube") frame.classList.remove("hidden");
    else if (kind === "hls") video.classList.remove("hidden");
    else if (kind === "image") img.classList.remove("hidden");
    else if (kind === "fallback") fallback.classList.remove("hidden");
  }

  function setFit(mode){
    const m = (mode === "contain") ? "contain" : "cover";
    frame.style.objectFit = m;
    video.style.objectFit = m;
    img.style.objectFit = m;
  }

  function clearMedia(){
    // stop fail watchdog
    if (failTimer){ clearTimeout(failTimer); failTimer = null; }

    // stop image refresh
    if (imgTimer){ clearInterval(imgTimer); imgTimer = null; }

    // stop hls
    try {
      if (hls){
        hls.destroy();
        hls = null;
      }
    } catch (_) {}

    // reset elements
    try { frame.src = "about:blank"; } catch (_) {}
    try {
      video.pause();
      video.removeAttribute("src");
      video.load();
    } catch (_) {}
    try { img.removeAttribute("src"); } catch (_) {}
  }

  function setHud(cam){
    hudTitle.textContent = cam.title || "Live Cam";
    hudPlace.textContent = cam.place || "—";
    hudSource.textContent = cam.source || "—";
    hudOrigin.href = cam.originUrl || "#";
    hudOrigin.style.pointerEvents = cam.originUrl ? "auto" : "none";
    hudOrigin.style.opacity = cam.originUrl ? "1" : ".6";
    hudIndex.textContent = `${idx + 1}/${cams.length}`;
  }

  function setCountdownUI(){
    hudCountdown.textContent = fmtMMSS(remaining);
    const pct = 100 * (1 - (remaining / ROUND_SECONDS));
    progressBar.style.width = `${clamp(pct, 0, 100).toFixed(2)}%`;
  }

  function scheduleFailSkip(cam){
    // Si en ~12s no hay “señales”, saltamos (útil para embeds caídos)
    if (failTimer) clearTimeout(failTimer);
    failTimer = setTimeout(() => {
      // mostramos fallback un momento y cambiamos
      showFallback(cam, "No hay señal (timeout).");
      setTimeout(() => nextCam("timeout"), 1200);
    }, 12_000);
  }

  function showFallback(cam, msg){
    clearMedia();
    showOnly("fallback");
    fallback.querySelector(".fallbackText").textContent = msg || "Saltando…";
    fallbackLink.href = cam && cam.originUrl ? cam.originUrl : "#";
    fallbackLink.style.pointerEvents = (cam && cam.originUrl) ? "auto" : "none";
    fallbackLink.style.opacity = (cam && cam.originUrl) ? "1" : ".6";
  }

  async function safePlayVideo(){
    try {
      const p = video.play();
      if (p && typeof p.then === "function") await p;
    } catch (_) {
      // autoplay bloqueado en algunos navegadores, pero en OBS suele ir bien
    }
  }

  // ───────────────────── Playback ─────────────────────
  function playCam(cam){
    clearMedia();
    setHud(cam);

    // watchdog
    scheduleFailSkip(cam);

    if (cam.kind === "youtube"){
      showOnly("youtube");
      // youtube-nocookie + autoplay muted
      const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(cam.youtubeId)}`
        + `?autoplay=1&mute=1&controls=0&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&fs=0&disablekb=1`;
      frame.src = src;
      return;
    }

    if (cam.kind === "image"){
      showOnly("image");
      const refreshMs = Math.max(5_000, (cam.refreshMs|0) || 60_000);

      const setSnap = () => {
        const u = cam.url;
        const sep = (u.indexOf("?") >= 0) ? "&" : "?";
        img.src = `${u}${sep}t=${Date.now()}`;
      };

      setSnap();
      imgTimer = setInterval(setSnap, refreshMs);

      // si falla cargar, saltar
      img.onerror = () => {
        img.onerror = null;
        showFallback(cam, "Imagen no disponible (error). Saltando…");
        setTimeout(() => nextCam("img_error"), 900);
      };
      return;
    }

    if (cam.kind === "hls"){
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
          if (!data) return;
          if (data.fatal) {
            showFallback(cam, "Stream HLS no disponible (fatal). Saltando…");
            setTimeout(() => nextCam("hls_fatal"), 900);
          }
        });

        video.addEventListener("canplay", () => safePlayVideo(), { once:true });
      } else {
        showFallback(cam, "Tu navegador no soporta HLS aquí. Saltando…");
        setTimeout(() => nextCam("hls_unsupported"), 900);
      }

      video.onerror = () => {
        video.onerror = null;
        showFallback(cam, "Stream no disponible (error). Saltando…");
        setTimeout(() => nextCam("vid_error"), 900);
      };

      return;
    }

    // desconocido -> fallback
    showFallback(cam, "Tipo de cámara no soportado. Saltando…");
    setTimeout(() => nextCam("unsupported"), 900);
  }

  // ───────────────────── Rotation ─────────────────────
  function tick(){
    if (!playing) return;
    remaining -= 1;
    if (remaining <= 0){
      nextCam("timer");
      return;
    }
    setCountdownUI();
  }

  function startTimer(){
    if (timer) clearInterval(timer);
    timer = setInterval(tick, 1000);
  }

  function resetRound(){
    remaining = ROUND_SECONDS;
    setCountdownUI();
  }

  function nextCam(reason){
    if (!cams.length) return;
    idx = (idx + 1) % cams.length;
    resetRound();
    if (P.debug) console.log("[cams] next:", reason, idx, cams[idx]);
    playCam(cams[idx]);
  }

  function prevCam(){
    if (!cams.length) return;
    idx = (idx - 1 + cams.length) % cams.length;
    resetRound();
    playCam(cams[idx]);
  }

  function togglePlay(){
    playing = !playing;
    btnToggle && (btnToggle.textContent = playing ? "⏸" : "▶");
    // si reanudamos, no queremos “saltar” por un timeout viejo
    if (playing) scheduleFailSkip(cams[idx]);
  }

  function reshuffle(){
    const curId = cams[idx] && cams[idx].id;
    shuffle(cams, rnd);
    idx = Math.max(0, cams.findIndex(c => c.id === curId));
    resetRound();
    playCam(cams[idx]);
  }

  // ───────────────────── Persistence ─────────────────────
  function loadState(){
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) { return null; }
  }

  function saveState(){
    try {
      const st = { idx, remaining, playing, ts: Date.now(), version: 1 };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
    } catch (_) {}
  }

  // ───────────────────── Boot ─────────────────────
  function boot(){
    if (!cams.length){
      showFallback({ originUrl:"#"}, "No hay cámaras definidas en cams.js");
      return;
    }

    setFit(P.fit);

    // admin panel
    if (P.admin) adminPanel.classList.remove("hidden");
    if (P.hideHud) hud.classList.add("hidden");

    // mezcla inicial para que sea “random”
    shuffle(cams, rnd);

    // cargar estado previo (si existe)
    const st = loadState();
    if (st && typeof st.idx === "number" && st.idx >= 0 && st.idx < cams.length){
      idx = st.idx|0;
      remaining = clamp(st.remaining|0, 1, ROUND_SECONDS);
      playing = !!st.playing;
    } else {
      idx = 0;
      remaining = ROUND_SECONDS;
      playing = true;
    }

    setCountdownUI();
    playCam(cams[idx]);
    startTimer();

    // eventos admin
    if (btnNext) btnNext.addEventListener("click", () => nextCam("admin"));
    if (btnPrev) btnPrev.addEventListener("click", () => prevCam());
    if (btnToggle) btnToggle.addEventListener("click", () => togglePlay());
    if (btnShuffle) btnShuffle.addEventListener("click", () => reshuffle());

    // teclado
    window.addEventListener("keydown", (e) => {
      const k = (e.key || "").toLowerCase();
      if (k === " "){ e.preventDefault(); togglePlay(); }
      else if (k === "n"){ nextCam("key"); }
      else if (k === "p"){ prevCam(); }
      else if (k === "h"){
        hud.classList.toggle("hidden");
      }
    });

    // guardar a menudo
    setInterval(saveState, 2000);

    // si el tab se oculta, evitamos “drift” raro
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) saveState();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
