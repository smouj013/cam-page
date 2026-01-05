# Random Live Cams — Cam Page (Player + Control) — v2.3.9

Sistema **100% web (GitHub Pages)** para emitir **cámaras LIVE aleatorias del mundo** en modo *Player* (para OBS / directo) + un **Control Room** para manejarlo (cambiar cam, overlays, voto, chat, ads, catálogo, tickers… según tu build).

> ✅ **v2.3.9** = compat total con tu setup actual + endurecido para directo (menos desync / menos “no responde”).

---

## 📁 Estructura del proyecto (raíz)

Archivos principales que tienes ahora mismo (según tu repo):

- `index.html` → **PLAYER** (lo que metes en OBS como Browser Source)
- `app.js` → lógica principal del player (rotación, autoskip, HUD, voto, chat, ads, etc.)
- `control.html` → **CONTROL ROOM** (panel admin)
- `control.js` → lógica del panel de control (comandos por BroadcastChannel / localStorage + fallback)
- `cams.js` → lista + auto-discovery de cams (video only) + catálogo + **NEWS opcional** (v2.3.9)
- `catalogView.js` → UI del catálogo (vista en Player, si está activa)
- `catalogControl.js` → controles del catálogo en Control Room (si lo usas)
- `rlcTickers.js` → tickers unificados (NEWS + ECON) para Player
- `rlcTickersControl.js` → control de tickers para Control Room
- `weatherClock.js` → reloj + clima (si está activado en tu build)
- `music.js` → BGM / música (si está activado)
- `pointsControl.js` → panel/handler de puntos (si lo estás usando con Twitch)
- `obs-cam-panel.html` → panel especial para OBS (dock / control rápido)
- `oauth.html` → retorno OAuth (captura token/params y los muestra/guarda según tu flujo)
- `styles.css` → tema visual Neo-Atlas / Newsroom
- `.nojekyll` → para GitHub Pages (evita tratamiento Jekyll)
- `.env.example` → plantilla (para local/dev; **NO** se suben tokens reales)
- `assets/` → iconos, audio, sprites, etc.
- `controller/` → carpeta auxiliar (si la usas para herramientas/extra)

> Nota: actualmente **no dependes de `sw.js`** (Service Worker) en esta estructura.

---

## 🚀 URLs (GitHub Pages)

Base (tu caso):
- **Player:** `https://smouj013.github.io/cam-page/`
- **Control:** `https://smouj013.github.io/cam-page/control.html`
- **OBS Panel:** `https://smouj013.github.io/cam-page/obs-cam-panel.html`
- **OAuth Return:** `https://smouj013.github.io/cam-page/oauth.html`

---

## 🔑 Emparejado Player ↔ Control con `key`

Todo tu sistema se vuelve mucho más estable si **Player y Control comparten la misma `key`**:

- Player: `.../cam-page/?key=TU_KEY&...`
- Control: `.../cam-page/control.html?key=TU_KEY`

**Qué hace la `key`:**
- Namespacing de bus: `rlc_bus_v1:{key}`
- Namespacing de storage/estado: evita que 2 directos se pisen
- Fallback: el sistema suele recordar la última con `rlc_last_key_v1`

> Si abres varios directos/proyectos a la vez, usa keys distintas.

---

## 🎥 Cómo usarlo en OBS

1. OBS → **Browser Source**
2. Pega la URL del **Player**
3. Tamaño típico: **1920×1080**
4. Recomendado: activar “Refresh browser when scene becomes active” (si quieres reinicio limpio al cambiar de escena)

Ejemplo (tu estilo):
`https://smouj013.github.io/cam-page/?key=TU_KEY&mins=5&fit=cover&hud=1&autoskip=1&vote=1&twitch=globaleyetv&voteOverlay=1&voteAt=60&voteWindow=60&voteLead=5&voteUi=60&stayMins=5&chat=1&chatHideCommands=1&alerts=1&ads=1&adLead=30&adShowDuring=1`

---

## 🧠 Control Room (control.html)

El Control Room sirve para:
- Cambiar cam / saltar / mantener (según tu UI)
- Ajustes (mins, autoskip, fit, HUD, etc.)
- Votación (si está activa)
- Chat + bot IRC (si lo tienes activado)
- ADS notice / eventos hacia el bot (si está activo)
- Tickers (si los tienes activos)
- Catálogo 4-up (si lo usas)

Ejemplo:
`https://smouj013.github.io/cam-page/control.html?key=TU_KEY`

---

## ⚙️ Parámetros por URL (Player)

### Núcleo
- `key=...` → empareja Player/Control
- `mins=5` → duración por cámara (minutos)
- `fit=cover|contain` → ajuste del vídeo/iframe
- `hud=1|0` → overlay/estado
- `autoskip=1|0` → saltar si falla

### Voto (si tu build lo usa)
- `vote=1|0`
- `voteOverlay=1|0`
- `voteAt=60`
- `voteWindow=60`
- `voteLead=5`
- `voteUi=60`
- `stayMins=5`

### Twitch / Chat / Alertas / Ads (según tu build)
- `twitch=globaleyetv`
- `chat=1|0`
- `chatHideCommands=1|0`
- `alerts=1|0`
- `ads=1|0`
- `adLead=30`
- `adShowDuring=1|0`

### Compat
- `allowLegacy=1` → permite compat con versiones antiguas/legacy donde aplique

---

## 📷 Cams & Catálogo — `cams.js` (v2.3.9)

### Qué hace
- **VIDEO ONLY**: solo exporta `youtube` y `hls` (descarta `image`)
- Sanitiza:
  - IDs duplicados → se queda con el primero (tus seeds ganan)
  - completa `originUrl`
  - infiere `youtubeId` desde URL
  - descarta entradas rotas
  - añade `thumb` para YouTube (catálogo)
  - filtra “walk/tour/recorded/timelapse/replay/loops” (solo live webcams)
- **Auto-discovery** (Invidious live search) para llegar a objetivo alto
- **Catálogo 4-up**: páginas de 4 cámaras
- **NEWS opcional (OFF por defecto)**:
  - Activa: `?camsNews=1`
  - Mezcla en main: `?camsNewsMix=1`
  - Mete en catálogo: `?camsNewsCatalog=1`
  - Objetivo news: `?camsNewsTarget=60`

### Parámetros de `cams.js`
- `camsTarget=650` → objetivo total cams (default v2.3.9: **650**)
- `camsDiscovery=1|0`
- `camsValidate=1|0`
- `camsValidateBudget=220`
- `camsLiveCheck=1|0`
- `camsPages=6`
- `camsMaxPerQuery=260`
- `camsConc=4`
- `camsInstances=12`
- `camsBudget=780`
- `camsAltFill=1|0` → relleno ALT si no llega al target

### API global (para integraciones)
- `window.CAM_LIST`
- `window.CAM_CATALOG_LIST`
- `window.CAM_NEWS_LIST` (si `camsNews=1`)
- `window.CAM_LIST_READY` (Promise)
- `window.RLCCams.getCatalogPage(pageIndex)`
- `window.RLCCams.getCatalogFeatured(count)`
- `window.RLCCams.onUpdate(cb)`
- Evento: `rlc_cam_list_updated`

---

## 📰 Tickers (NEWS + ECON) — `rlcTickers.js`

- Player: `rlcTickers.js`
- Control: `rlcTickersControl.js`

Tu skin (Neo-Atlas / Newsroom) está en `styles.css`.  
Si los tickers están desactivados/eliminados de tu HTML, revisa que el CSS no deje “barras fantasma” (clases/IDs).

---

## 🔐 Tokens / Seguridad (importante)

- **NO subas** OAuth tokens, IRC PASS, Client IDs, etc. al repo.
- Usa el panel/control para guardarlos en storage local (según tu flujo), o mantenlos fuera del repo.
- `.env.example` es **solo plantilla** para entorno local.

---

## 🧯 Troubleshooting rápido

- Hard reload: **Ctrl+F5**
- Añade cache-bust: `?v=239`
- Si Player y Control “no se hablan”:
  - confirma que ambos tienen la **misma `key`**
  - prueba abrirlos en pestañas separadas
  - revisa consola (errores de CORS o scripts duplicados)

---

## 🧾 Changelog — v2.3.9 (resumen)

- `cams.js`:
  - **NEWS opcional** con soporte real de **YouTube + HLS**
  - Dedupe de HLS por URL (evita repetidos con IDs distintos)
  - Mejoras de cache + emisión de update
- Mejor compat de bus/keys (namespacing + fallback)
- Catálogo 4-up y API `RLCCams` estable

---

## 📜 Licencia / Créditos

- Smouj013 — GlobalEye TV
- Cada cámara pertenece a su propietario. Si el dueño pide retirada, se elimina sin problema.
