const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const https = require('https');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const npcMemory = new Map();
const connections = new Map();

console.log('🚀 Minecraft AI Bridge Server');
console.log('📡 WebSocket ready for AI Companion + Family Life+');

app.get('/', (req, res) => {
  res.send('✅ Minecraft AI Bridge is running!');
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    connections: connections.size,
    timestamp: new Date().toISOString()
  });
});

wss.on('connection', (ws) => {
  const clientId = Math.random().toString(36).substring(7);
  connections.set(clientId, ws);
  
  console.log(`✅ Client connected: ${clientId} (Total: ${connections.size})`);
  
  ws.send(JSON.stringify({
    header: { 
      requestId: generateId(), 
      messagePurpose: 'subscribe', 
      version: 1, 
      messageType: 'commandRequest' 
    },
    body: { eventName: 'TitleChanged' }
  }));
  
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
    try {
      const message = JSON.parse(data.toString());
      const body = message.body;
      
      if (!body) return;
      
      if (body.type === 'title' && body.message) {
        await handleTitle(ws, body.message);
      } else if (body.eventName === 'TitleChanged') {
        const titleText = body.title || body.text || body.message;
        if (titleText) await handleTitle(ws, titleText);
      }
      
    } catch (error) {
      console.error('Error:', error.message);
    }
  });
  
  ws.on('close', () => {
    connections.delete(clientId);
    console.log(`❌ Client disconnected: ${clientId}`);
  });
});

async function handleTitle(ws, titleText) {
  try {
    const payload = JSON.parse(titleText);
    
    if (!payload.pn || !payload.nn) return;
    
    const playerName = payload.pn;
    const playerMessage = payload.pm || '';
    const npcName = payload.nn;
    const npcId = payload.ni || 'unknown';
    const personality = payload.np || 'optimistic';
    const gender = payload.ns || 'neutral';
    const friendship = payload.a || 0;
    const romance = payload.r || 0;
    
    console.log(`💬 ${playerName} → ${npcName}: "${playerMessage}"`);
    
    if (!npcMemory.has(npcId)) {
      npcMemory.set(npcId, []);
    }
    
    const context = buildContext(npcName, personality, gender, friendship, romance, playerName);
    const aiResponse = await callGemini(context, playerMessage);
    
    console.log(`🤖 ${npcName}: "${aiResponse}"`);
    
    sendToMinecraft(ws, npcName, aiResponse);
    
  } catch (e) {
    // Not JSON, ignore
  }
}

function buildContext(npcName, personality, gender, friendship, romance, playerName) {
  let context = `You are ${npcName}, a ${gender} AI companion in Minecraft with a ${personality} personality. `;
  
  if (friendship > 75) {
    context += `Best friends with ${playerName}! `;
  } else if (friendship > 50) {
    context += `Good friends with ${playerName}. `;
  } else if (friendship > 25) {
    context += `Getting to know ${playerName}. `;
  }
  
  if (romance > 75) {
    context += `In love with ${playerName}! `;
  } else if (romance > 50) {
    context += `Romantic feelings for ${playerName}. `;
  }
  
  const traits = {
    optimistic: "Always positive!",
    humorous: "Love jokes!",
    intellectual: "Enjoy deep talks.",
    romantic: "Hopeless romantic!",
    brave: "Fearless!",
    shy: "A bit timid.",
    grumpy: "Often grumpy.",
    adventurous: "Love excitement!",
    cautious: "Think carefully.",
    charming: "Smooth and likeable."
  };
  
  if (traits[personality]) {
    context += traits[personality] + " ";
  }
  
  context += "Keep responses under 40 words. Stay in character!";
  
  return context;
}

async function callGemini(context, message) {
  return new Promise((resolve) => {
    const prompt = `${context}\n\nPlayer: "${message}"\n\nResponse:`;
    
    const payload = JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }]
    });
    
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 10000
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.candidates && result.candidates[0]) {
            resolve(result.candidates[0].content.parts[0].text.trim());
          } else {
            resolve("I'm not sure what to say!");
          }
        } catch (error) {
          resolve("Sorry, lost my thought!");
        }
      });
    });
    
    req.on('error', () => resolve("Having trouble thinking!"));
    req.on('timeout', () => {
      req.destroy();
      resolve("Thinking too slow!");
    });
    
    req.write(payload);
    req.end();
  });
}

function sendToMinecraft(ws, npcName, response) {
  const escaped = response.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
  const command = `tellraw @a {"rawtext":[{"text":"§e${npcName}§r: ${escaped}"}]}`;
  
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
  return Math.random().toString(36).substring(2, 15);
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🤖 Gemini ready`);
});

process.on('SIGTERM', () => {
  wss.clients.forEach(c => c.close());
  server.close(() => process.exit(0));
});

setInterval(() => {
  wss.clients.forEach(c => {
    if (c.readyState === 1) c.ping();
  });
}, 30000);
