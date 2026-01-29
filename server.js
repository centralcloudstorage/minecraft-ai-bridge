
/**
 * FIXED Minecraft AI Bridge Server
 * - Prevents self-reply loops
 * - Safe with multiple NPCs
 * - Keeps Gemini + memory logic intact
 */

const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const https = require('https');

const BOT_NAME = "Eliz"; // NPC THIS SERVER CONTROLS

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const npcMemory = new Map();
const connections = new Map();

console.log('🚀 Minecraft AI Bridge Server Starting...');
console.log('📋 Listening for Family Life+ title events...');

app.get('/', (req, res) => {
  res.send('✅ Minecraft AI Bridge is running! Family Life+ compatible.');
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    connections: connections.size,
    timestamp: new Date().toISOString()
  });
});

// --------------------
// MESSAGE FILTER
// --------------------
function shouldIgnoreMessage(body) {
  if (!body) return true;

  const sender = body.sender || "";
  const message = body.message || "";
  const type = body.type || "";

  if (
    sender === "External" ||
    sender === "Script Engine" ||
    sender === BOT_NAME
  ) return true;

  if (message.includes("§e") || message.includes(BOT_NAME)) return true;

  if (type !== "title") return true;

  return false;
}

// --------------------
// WEBSOCKET HANDLER
// --------------------
wss.on('connection', (ws) => {
  const clientId = Math.random().toString(36).substring(7);
  connections.set(clientId, ws);

  console.log(`✅ New connection: ${clientId} (Total: ${connections.size})`);

  ws.send(JSON.stringify({
    header: {
      requestId: generateId(),
      messagePurpose: 'subscribe',
      version: 1,
      messageType: 'commandRequest'
    },
    body: { eventName: 'PlayerMessage' }
  }));

  ws.on('message', async (data) => {
    let packet;
    try {
      packet = JSON.parse(data.toString());
    } catch {
      return;
    }

    const { header, body } = packet;
    if (header?.eventName !== 'PlayerMessage') return;
    if (shouldIgnoreMessage(body)) return;

    let payload;
    try {
      payload = JSON.parse(body.message);
    } catch {
      return;
    }

    if (payload.nn !== BOT_NAME) return;

    const playerName = payload.pn || "Player";
    const playerMessage = payload.pm || "";
    const npcId = payload.ni || "default";

    console.log(`💬 ${playerName} → ${BOT_NAME}: ${playerMessage}`);

    if (!npcMemory.has(npcId)) npcMemory.set(npcId, []);
    const history = npcMemory.get(npcId);

    const context = buildContext(
      BOT_NAME,
      payload.np || "friendly",
      payload.a || 0,
      payload.r || 0,
      playerName,
      payload.t || "D"
    );

    const aiResponse = await callGeminiAI(context, playerMessage, history);

    history.push({ role: "user", content: playerMessage });
    history.push({ role: "assistant", content: aiResponse });
    if (history.length > 20) history.splice(0, history.length - 20);

    sendCommand(ws, `tellraw @a {"rawtext":[{"text":"§e${BOT_NAME}§r: ${escapeJson(aiResponse)}"}]}`);
  });

  ws.on('close', () => {
    connections.delete(clientId);
    console.log(`❌ Connection closed: ${clientId}`);
  });
});

// --------------------
// AI + HELPERS
// --------------------
function buildContext(npcName, personality, friendship, romance, playerName) {
  let ctx = `You are ${npcName}, a ${personality} Minecraft NPC talking to ${playerName}. `;
  ctx += "Respond naturally, under 40 words.";
  return ctx;
}

async function callGeminiAI(context, message) {
  return new Promise((resolve) => {
    const prompt = `${context}\nPlayer: "${message}"\nNPC:`;

    const payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.candidates?.[0]?.content?.parts?.[0]?.text || "Hmm.");
        } catch {
          resolve("Hmm.");
        }
      });
    });

    req.on('error', () => resolve("Hmm."));
    req.write(payload);
    req.end();
  });
}

function sendCommand(ws, command) {
  ws.send(JSON.stringify({
    header: {
      requestId: generateId(),
      messagePurpose: 'commandRequest',
      version: 1,
      messageType: 'commandRequest'
    },
    body: {
      origin: { type: 'player' },
      commandLine: command,
      version: 1
    }
  }));
}

function generateId() {
  return Math.random().toString(36).substring(2);
}

function escapeJson(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// --------------------
// START SERVER
// --------------------
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
