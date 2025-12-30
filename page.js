(() => {
  "use strict";

  // ✅ Lista de cámaras (pon aquí tus URLs)
  // OJO: algunas webs bloquean iframes (X-Frame-Options). Si te pasa, dime la URL y te doy alternativa.
  const CAMS = {
    1: { label: "CAM 1", url: "https://TU_CAMARA_1_URL" },
    2: { label: "CAM 2", url: "https://TU_CAMARA_2_URL" },
    3: { label: "CAM 3", url: "https://TU_CAMARA_3_URL" }
  };

  // ✅ La página leerá el estado desde un endpoint HTTPS
  // Puedes pasar el endpoint por query:
  // https://TUUSUARIO.github.io/cam-page/?state=https://xxxx.trycloudflare.com/state
  const qs = new URLSearchParams(location.search);
  const STATE_URL = qs.get("state") || ""; // obligatorio

  const $ = (id) => document.getElementById(id);
  const frame = $("frame");
  const camLabel = $("camLabel");
  const status = $("status");

  let currentId = null;
  let lastSeenAt = 0;

  function setCam(id) {
    const c = CAMS[id];
    if (!c) return;
    if (currentId === id) return;
    currentId = id;
    camLabel.textContent = `${id} — ${c.label}`;
    frame.src = c.url;
  }

  async function poll() {
    if (!STATE_URL) {
      status.textContent = "Falta ?state=TU_ENDPOINT";
      return;
    }
    try {
      const r = await fetch(STATE_URL, { cache: "no-store", mode: "cors" });
      const j = await r.json();

      if (j && j.ok && j.data) {
        const { camId, updatedAt } = j.data;
        lastSeenAt = Date.now();
        status.textContent = `OK · actualizado ${Math.max(0, ((Date.now()-updatedAt)/1000)|0)}s`;
        const id = Number(camId) | 0;
        if (id > 0) setCam(id);
      } else {
        status.textContent = "Respuesta inválida";
      }
    } catch (e) {
      status.textContent = "sin conexión al state";
    }
  }

  // poll rápido (1s). Si quieres más suave, 1500–2000ms.
  setInterval(poll, 1000);
  poll();
})();
