const express = require("express");
const cors = require("cors");
const multer = require("multer");
const QRCode = require("qrcode");
const qrcodeTerminal = require("qrcode-terminal");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");

const PORT = process.env.PORT || 3001;
const SESSION_DIR = process.env.SESSION_DIR || "/data";

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

let client = null;
let clientReady = false;
let qrDataUrl = null;
let state = "unknown"; // unknown | connecting | connected | disconnected | auth_failure
let lastConnectedAt = null;
let lastError = null;

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

function clearChromeLocks() {
  // Stale Chrome singleton locks survive container recreations and block launch.
  const fs = require("fs");
  const path = require("path");
  const profile = path.join(SESSION_DIR, "session");
  for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    try {
      fs.rmSync(path.join(profile, name), { force: true });
    } catch (_e) {}
  }
  log(`Cleared Chrome singleton locks under ${profile}`);
}

clearChromeLocks();

function buildClient() {
  qrDataUrl = null;
  state = "connecting";

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
    puppeteer: {
      headless: true,
      executablePath: process.env.CHROME_PATH || undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-blink-features=AutomationControlled",
      ],
    },
  });

  client.on("qr", (qr) => {
    state = "connecting";
    QRCode.toDataURL(qr, { margin: 1, width: 360 })
      .then((url) => {
        qrDataUrl = url;
        log("QR generated (scan with WhatsApp phone)");
      })
      .catch((err) => log("QR encoding failed:", err.message));
    qrcodeTerminal.generate(qr, { small: true });
  });

  client.on("authenticated", () => {
    log("Authenticated with WhatsApp Web");
  });

  client.on("auth_failure", (msg) => {
    lastError = `Auth failure: ${msg}`;
    state = "auth_failure";
    qrDataUrl = null;
    log("AUTH FAILURE:", msg);
    scheduleRestart(3000);
  });

  client.on("ready", () => {
    clientReady = true;
    lastConnectedAt = new Date().toISOString();
    lastError = null;
    state = "connected";
    qrDataUrl = null;
    log("WhatsApp client ready (connected)");
  });

  client.on("disconnected", (reason) => {
    clientReady = false;
    lastError = `Disconnected: ${reason}`;
    log("DISCONNECTED:", reason);
    scheduleRestart(5000);
  });

  client.on("message", () => { /* keepalive noop */ });

  client.initialize().catch((err) => {
    lastError = `Initialize failed: ${err.message}`;
    log("Initialize error:", err.message);
    scheduleRestart(5000);
  });
}

let restartTimer = null;
function scheduleRestart(ms) {
  if (restartTimer) return;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    log("Restarting client...");
    try {
      if (client) client.destroy();
    } catch (e) { /* ignore */ }
    buildClient();
  }, ms);
}

async function requireReady(req, res, next) {
  if (!client || !clientReady) {
    return res.status(503).json({
      success: false,
      error: {
        code: "WA_NOT_READY",
        message: "WhatsApp client is not connected",
        state,
        qr: qrDataUrl,
      },
    });
  }
  next();
}

function serializeChat(chat) {
  return {
    id: chat.id ? chat.id._serialized : null,
    name: chat.name || "",
    isGroup: !!chat.isGroup,
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ success: true, uptime: process.uptime() });
});

app.get("/api/status", (_req, res) => {
  res.json({
    success: true,
    connected: clientReady,
    state,
    qr: qrDataUrl,
    last_connected_at: lastConnectedAt,
    last_error: lastError,
  });
});

async function getGroupList() {
  // Fast path: read chat models synchronously from the page. The classic
  // client.getChats() hangs because it awaits a network fetch of each group's
  // metadata (WAWebCollections.GroupMetadata.update per group).
  try {
    const groups = await client.pupPage.evaluate(() => {
      const models = window.require("WAWebCollections").Chat.getModelsArray();
      const result = [];
      for (const c of models) {
        const wid = c.id && c.id._serialized;
        if (!wid || !String(wid).endsWith("@g.us")) continue;
        const metaName = c.groupMetadata && (c.groupMetadata.name || c.groupMetadata.subject);
        const contactName = c.contact && (c.contact.name || c.contact.formattedName || c.contact.pushname);
        result.push({
          id: wid,
          name: c.name || c.formattedTitle || metaName || contactName || wid,
          isGroup: true,
        });
      }
      return result;
    });
    const list = (Array.isArray(groups) ? groups : []).sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", "en")
    );
    log(`Group list: ${list.length} groups`);
    return list;
  } catch (e) {
    log("Fast group list failed, falling back to getChats:", e.message);
    const chats = await client.getChats();
    return chats
      .filter((c) => c.isGroup)
      .map((c) => ({ id: c.id._serialized, name: c.name || "", isGroup: true }))
      .sort((a, b) => a.name.localeCompare(b.name, "en"));
  }
}

app.get("/api/groups", async (_req, res) => {
  if (!client || !clientReady) {
    return res.status(503).json({
      success: false,
      error: { code: "WA_NOT_READY", message: "WhatsApp client is not connected", state, qr: qrDataUrl },
    });
  }
  try {
    const groups = await Promise.race([
      getGroupList(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Group list timed out")), 20000)),
    ]);
    res.json({ success: true, data: groups });
  } catch (err) {
    log("Groups endpoint error:", err.message);
    res.status(500).json({ success: false, error: { code: "WA_GROUPS_FAILED", message: err.message } });
  }
});

app.post("/api/send-text", requireReady, async (req, res) => {
  const { chatId, text } = req.body || {};
  if (!chatId || !text) {
    return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "chatId and text are required" } });
  }
  try {
    await client.sendMessage(chatId, text);
    // sendMessage may resolve to undefined on newer WA builds even though the
    // message is delivered; treat a non-throwing call as success.
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: "WA_SEND_FAILED", message: err.message } });
  }
});

app.post("/api/send-file", requireReady, upload.single("file"), async (req, res) => {
  const chatId = req.body.chatId;
  const caption = req.body.caption || "";
  if (!chatId || !req.file) {
    return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "chatId and file are required" } });
  }
  try {
    const base64 = req.file.buffer.toString("base64");
    const media = new MessageMedia(
      req.file.mimetype || "application/octet-stream",
      base64,
      req.file.originalname || "report.xlsx"
    );
    await client.sendMessage(chatId, media, { caption: caption || undefined });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: "WA_SEND_FAILED", message: err.message } });
  }
});

app.listen(PORT, () => {
  log(`WhatsApp service listening on port ${PORT}`);
  buildClient();
});
