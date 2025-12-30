"use strict";

require("dotenv").config();
const express = require("express");
const tmi = require("tmi.js");

const PORT = Number(process.env.PORT || 8787);
const SET_KEY = String(process.env.SET_KEY || "");
const CHANNEL = String(process.env.TWITCH_CHANNEL || "");
const BOT_USER = String(process.env.TWITCH_BOT_USERNAME || "");
const OAUTH = String(process.env.TWITCH_OAUTH || "");

if (!SET_KEY) {
  console.error("Falta SET_KEY en .env");
  process.exit(1);
}

let state = {
  camId: 1,
  updatedAt: Date.now(),
  by: "boot"
};

const app = express();
app.use(express.json({ limit: "50kb" }));

// CORS para que GitHub Pages pueda leer /state
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Set-Key");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/state", (req, res) => {
  res.json({ ok: true, data: state });
});

app.post("/set", (req, res) => {
  const key = String(req.headers["x-set-key"] || "");
  if (key !== SET_KEY) return res.status(401).json({ ok: false, error: "unauthorized" });

  const camId = Number(req.body && req.body.camId);
  if (!Number.isFinite(camId) || camId < 0) return res.status(400).json({ ok: false, error: "bad_camId" });

  if (camId === 0) {
    // keep: no cambiamos camId
    state = { ...state, updatedAt: Date.now(), by: "keep" };
    return res.json({ ok: true, data: state });
  }

  state = { camId: camId | 0, updatedAt: Date.now(), by: String(req.body && req.body.by || "api") };
  res.json({ ok: true, data: state });
});

app.listen(PORT, () => console.log(`[local] http://localhost:${PORT}`));

// ───────────────── Twitch Bot ─────────────────
async function startBot() {
  if (!CHANNEL || !BOT_USER || !OAUTH) {
    console.log("[twitch] Falta TWITCH_CHANNEL / TWITCH_BOT_USERNAME / TWITCH_OAUTH. Bot desactivado.");
    return;
  }

  const client = new tmi.Client({
    options: { debug: false },
    identity: { username: BOT_USER, password: OAUTH },
    channels: [CHANNEL.startsWith("#") ? CHANNEL : `#${CHANNEL}`]
  });

  await client.connect();
  console.log(`[twitch] conectado a ${CHANNEL}`);

  client.on("message", async (_ch, ctx, msg, self) => {
    if (self) return;

    const text = String(msg || "").trim();
    const parts = text.split(/\s+/);
    const cmd = (parts[0] || "").toLowerCase();

    // Comandos:
    // !cam 1 / !cam 2 / !cam 3
    // !keep
    if (cmd === "!cam" && parts[1]) {
      const n = Number(parts[1]);
      if (!Number.isFinite(n)) return;

      // Cambia estado
      state = { camId: n | 0, updatedAt: Date.now(), by: ctx.username || "chat" };
      // feedback opcional
      // client.say(CHANNEL, `✅ Cámara -> ${state.camId}`);
    }

    if (cmd === "!keep") {
      state = { ...state, updatedAt: Date.now(), by: ctx.username || "chat_keep" };
    }
  });
}

startBot().catch(e => console.error(e));
