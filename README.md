# Twitch Cam Page (simple)

Objetivo
Cambiar la camara que se ve en OBS con comandos del chat de Twitch usando una pagina de GitHub Pages

Necesitas
OBS con Browser Source
Node.js
Un bot de Twitch con OAuth
cloudflared para tunel https

Parte 1 GitHub Pages
Crea repo cam-page
Sube index.html y page.js
Activa Pages en Settings Pages
Tu url sera https://TUUSUARIO.github.io/cam-page/

Parte 2 Controlador local
Crea carpeta cam-controller
Pon package.json server.js .env
Instala dependencias
npm install
Arranca
npm run start

OAuth del bot
Genera token aqui
https://twitchapps.com/tmi/
Pega el oauth en .env

Tunel https
Ejecuta
cloudflared tunnel --url http://localhost:8787
Copia la url https que te da
Ejemplo https://xxxx.trycloudflare.com
El endpoint sera https://xxxx.trycloudflare.com/state

Conectar la pagina
Abre tu github page asi
https://TUUSUARIO.github.io/cam-page/?state=https://xxxx.trycloudflare.com/state

Meterlo en OBS
Añade Browser Source
Pega la url anterior
Pon 1920x1080

Comandos de chat
!cam 1
!cam 2
!cam 3
!keep

Si una cam no se ve
La web puede bloquear iframes
Usa una url embed oficial o un stream directo
