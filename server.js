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
console.log('📡 AI Companion + Family Life+ support');

// ========================================
// HEALTH CHECK
// ========================================

app.get('/', (req, res) => {
  res.send('✅ Minecraft AI Bridge running!');
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    connections: connections.size,
    timestamp: new Date().toISOString()
  });
});

// ========================================
// WEBSOCKET CONNECTION
// ========================================

wss.on('connection', (ws, req) => {
  const clientId = Math.random().toString(36).substring(7);
  connections.set(clientId, ws);
  
  console.log(`✅ Connected: ${clientId} (Total: ${connections.size})`);
  
  // Subscribe to title events
  ws.send(JSON.stringify({
    header: { 
      requestId: generateId(), 
      messagePurpose: 'subscribe', 
      version: 1, 
      messageType: 'commandRequest' 
    },
    body: { eventName: 'TitleChanged' }
  }));
  
  // Subscribe to player messages
  ws.send(JSON.stringify({
    header: { 
      requestId: generateId(), 
      messagePurpose: 'subscribe', 
      version: 1, 
      messageType: 'commandRequest' 
    },
    body: { eventName: 'PlayerMessage' }
  }));
  
  console.log('📡 Subscribed to events');
  
  // Handle messages
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      const header = message.header;
      const body = message.body;
      
      if (!header || !body) return;
      
      // Title message (type="title")
      if (body.type === 'title' && body.message) {
        await handleTitleMessage(ws, body);
      }
      // TitleChanged event
      else if (body.eventName === 'TitleChanged') {
        await handleTitleEvent(ws, body);
      }
      
    } catch (error) {
      console.error('❌ Error:', error.message);
    }
  });
  
  ws.on('close', () => {
    connections.delete(clientId);
    console.log(`❌ Disconnected: ${clientId} (Remaining: ${connections.size})`);
  });
  
  ws.on('error', (error) => {
    console.error(`❌ WebSocket error: ${error.message}`);
  });
});

// ========================================
// TITLE MESSAGE HANDLERS
// ========================================

async function handleTitleMessage(ws, body) {
  try {
    const payload = JSON.parse(body.message);
    if (payload.pn && payload.nn) {
      await processAIRequest(ws, payload);
    }
  } catch (e) {
    // Not JSON, ignore
  }
}

async function handleTitleEvent(ws, body) {
  try {
    const titleText = body.title || body.text || body.message;
    if (!titleText) return;
    
    const payload = JSON.parse(titleText);
    if (payload.pn && payload.nn) {
      await processAIRequest(ws, payload);
    }
  } catch (e) {
    // Not JSON, ignore
  }
}

// ========================================
// AI REQUEST PROCESSING
// ========================================

async function processAIRequest(ws, payload) {
  const playerName = payload.pn || 'Player';
  const playerMessage = payload.pm || '';
  const npcName = payload.nn || 'AI Companion';
  const npcId = payload.ni || 'unknown';
  const personality = payload.np || 'optimistic';
  const gender = payload.ns || 'neutral';
  const friendship = payload.a || 0;
  const romance = payload.r || 0;
  
  console.log(`💬 ${playerName} → ${npcName}: "${playerMessage}"`);
  console.log(`📊 ${personality}, Friendship: ${friendship}, Romance: ${romance}`);
  
  // Get conversation history
  if (!npcMemory.has(npcId)) {
    npcMemory.set(npcId, []);
  }
  const history = npcMemory.get(npcId);
  
  // Build AI context
  const context = buildContext(npcName, personality, gender, friendship, romance, playerName);
  
  // Call Gemini
  const aiResponse = await callGemini(context, playerMessage, history);
  
  // Update history
  history.push({ role: 'user', content: playerMessage });
  history.push({ role: 'assistant', content: aiResponse });
  if (history.length > 20) {
    history.splice(0, history.length - 20);
  }
  
  console.log(`🤖 ${npcName}: "${aiResponse}"`);
  
  // Send response to Minecraft
  sendResponse(ws, npcName, aiResponse);
}

// ========================================
// AI CONTEXT BUILDER
// ========================================

function buildContext(npcName, personality, gender, friendship, romance, playerName) {
  let context = `You are ${npcName}, a ${gender} AI companion in Minecraft with a ${personality} personality. `;
  
  // Friendship context
  if (friendship > 75) {
    context += `You're best friends with ${playerName}! `;
  } else if (friendship > 50) {
    context += `You're good friends with ${playerName}. `;
  } else if (friendship > 25) {
    context += `You're becoming friends with ${playerName}. `;
  } else if (friendship > 0) {
    context += `You're getting to know ${playerName}. `;
  }
  
  // Romance context
  if (romance > 75) {
    context += `You're in love with ${playerName}! `;
  } else if (romance > 50) {
    context += `You have romantic feelings for ${playerName}. `;
  } else if (romance > 25) {
    context += `You find ${playerName} attractive. `;
  }
  
  // Personality traits
  const traits = {
    optimistic: "You always see the bright side and spread positivity!",
    humorous: "You love making people laugh with jokes and wit!",
    intellectual: "You enjoy deep conversations and sharing knowledge.",
    romantic: "You're a hopeless romantic who loves love stories.",
    brave: "You're fearless and encourage others to be courageous!",
    shy: "You're a bit timid but warm up to close friends.",
    grumpy: "You're often irritable but have a good heart deep down.",
    adventurous: "You love excitement and trying new things!",
    cautious: "You prefer to think things through carefully.",
    charming: "You're smooth, charismatic, and naturally likeable."
  };
  
  if (traits[personality]) {
    context += traits[personality] + " ";
  }
  
  context += "Keep responses natural, friendly, and under 40 words. Stay in character!";
  
  return context;
}

// ========================================
// GEMINI AI CALL
// ========================================

async function callGemini(context, message, history) {
  return new Promise((resolve) => {
    const prompt = `${context}\n\nPlayer says: "${message}"\n\nYour response:`;
    
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
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.candidates && result.candidates[0]) {
            const text = result.candidates[0].content.parts[0].text;
            resolve(text.trim());
          } else {
            console.error('⚠️ No candidates in response');
            resolve("Hmm, I'm not sure what to say!");
          }
        } catch (error) {
          console.error('❌ Parse error:', error.message);
          resolve("Sorry, I lost my train of thought!");
        }
      });
    });
    
    req.on('error', (error) => {
      console.error('❌ Request error:', error.message);
      resolve("Sorry, I'm having trouble thinking!");
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve("I'm thinking too slowly!");
    });
    
    req.write(payload);
    req.end();
  });
}

// ========================================
// SEND RESPONSE TO MINECRAFT
// ========================================

function sendResponse(ws, npcName, response) {
  const command = `tellraw @a {"rawtext":[{"text":"§e${escapeJson(npcName)}§r: ${escapeJson(response)}"}]}`;
  
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
  
  console.log('📤 Response sent');
}

// ========================================
// HELPER FUNCTIONS
// ========================================

function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

function escapeJson(str) {
  if (!str) return '';
  return str.toString()
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/\t/g, ' ');
}

// ========================================
// START SERVER
// ========================================

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 WebSocket ready for connections`);
  console.log(`🤖 Gemini AI ready`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 Shutting down...');
  wss.clients.forEach(client => client.close());
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

// Keep-alive ping
setInterval(() => {
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.ping();
    }
  });
}, 30000);

console.log('🎮 Ready for AI Companion and Family Life+ addons!');
