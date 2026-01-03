# Random Live Cams — Cam Page (Player + Control)

Una **página para emitir cámaras online aleatorias por el mundo** en modo “player” (para OBS / directo) y un **panel “control room”** para controlar cambios, parámetros y automatismos (voto/chat/ads si están activados en tu build).

> Nota legal: si el dueño de una cámara solicita retirada, se elimina sin problema.

---

## 📁 Estructura del proyecto (raíz)
- `index.html` → **PLAYER** (lo que metes en OBS como Browser Source)
- `control.html` → **CONTROL** (panel admin para manejar el player)
- `styles.css` → tema visual (Neo-Atlas / Newsroom)
- `app.js` → lógica principal del player (rotación, autoskip, overlay, etc.)
- `control.js` → lógica del panel de control (BroadcastChannel/localStorage)
- `cams.js` → catálogo/lista de cámaras (según tu implementación)
- `catalogView.js` → UI/catálogo (si lo usas)
- `newsTicker.js` / `weatherClock.js` / `music.js` → módulos opcionales (si están incluidos)
- `manifest.webmanifest`, `sw.js` → **PWA** (si existen y los usas)
- `assets/` → icons, sprites, audio, etc.

---

## 🚀 Uso rápido (GitHub Pages)
1. Sube el repo a GitHub.
2. Activa **Settings → Pages** y publica desde `main` (root).
3. Abre:
   - **Player:** `https://TU_USUARIO.github.io/TU_REPO/`
   - **Control:** `https://TU_USUARIO.github.io/TU_REPO/control.html`

---

## 🎥 Cómo usarlo en OBS
1. En OBS → **Browser Source** → URL del **Player**.
2. Ancho/alto típico: **1920×1080** (o el canvas que uses).
3. Marca “Refresh browser when scene becomes active” si te interesa reinicio limpio.

---

## 🔧 Parámetros por URL (Player)
Estos son los más comunes en tu sistema (según lo que has venido usando):

- `mins=5` → duración por cámara (minutos)
- `stayMins=5` → “mantener” cámara si gana la opción de keep/stay
- `fit=cover|contain` → cómo ajusta el vídeo/iframe
- `hud=1|0` → overlay/estado
- `vote=1|0` → habilita la votación (si tu build la incluye)
- `voteAt=60` → tiempo de voto (segundos) o el momento de disparo (según tu versión)
- `autoskip=1|0` → saltar si la cam falla
- `ytCookies=1|0` → modo YouTube con cookies (si aplica)
- `twitch=globaleyetv` → canal (para integración chat/avisos si lo usas)
- `key=...` → clave/ID de stream (para emparejar con el panel/control)

### Ejemplo (Player)
`/cam-page/?mins=5&fit=cover&hud=1&vote=1&twitch=globaleyetv&voteAt=60&stayMins=5&ytCookies=1&autoskip=1&key=TU_KEY`

---

## 🧠 Panel de Control (control.html)
El **Control** se usa para:
- Cambiar cámara / saltar / mantener
- Ajustar opciones (voto, duración, overlays, etc.) según tu versión
- Enviar comandos al player (por `BroadcastChannel` y/o `localStorage`)

### Ejemplo (Control)
`/cam-page/control.html?key=TU_KEY`

> Importante: abre **Player y Control con la misma `key`** para que se “encuentren” fácil.

---

## 📚 Editar / añadir cámaras (catálogo)
Normalmente el catálogo está en:
- `cams.js` (lista principal)
- o dentro de `app.js` si lo integraste ahí

### Recomendación de formato (idea)
Cada cámara debería tener al menos:
- `id` (único)
- `title`
- `type` (`iframe`, `youtube`, `m3u8`, `image`, etc. según tu engine)
- `url`
- `tags` (país/ciudad/categoría)

---

## 🧯 Solución rápida si algo queda “pegado”
- Fuerza recarga dura: **Ctrl+F5**
- Prueba con un cache-bust: `?v=1` (o cambia el `v=...` de los `<link>`/`<script>`)
- Si usas PWA/Service Worker, desactívalo temporalmente o limpia caché desde DevTools.

---

## ✅ Buenas prácticas
- Mantén las cámaras **con fuente pública y embed permitido**.
- Evita repetir cámaras rotas: usa el **cooldown** (si tu versión lo trae).
- Ten un canal de contacto para “take down requests”.

---

## 🗺️ Roadmap (opcional)
- Ranking de “cams favoritas”
- Filtros por país/categoría
- Moderación/blacklist desde el Control
- Estadísticas (tiempo visto por cam, fallos, etc.)

---

## Licencia / Créditos
- Smouj013 - GlobalEye TV
- Cada cámara pertenece a su propietario; si piden retirada, se elimina.
