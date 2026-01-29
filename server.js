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

// WebSocket handler
wss.on('connection', (ws, req) => {
  const clientId = Math.random().toString(36).substring(7);
  connections.set(clientId, ws);
  
  console.log(`✅ New connection: ${clientId} (Total: ${connections.size})`);
  
  // Subscribe to TitleChanged event
  const subscribeMessage = {
    header: {
      requestId: generateId(),
      messagePurpose: 'subscribe',
      version: 1,
      messageType: 'commandRequest'
    },
    body: {
      eventName: 'TitleChanged'
    }
  };
  
  ws.send(JSON.stringify(subscribeMessage));
  console.log('📡 Subscribed to TitleChanged events');
  
  // Subscribe to PlayerMessage
  const subscribeMessage2 = {
    header: {
      requestId: generateId(),
      messagePurpose: 'subscribe',
      version: 1,
      messageType: 'commandRequest'
    },
    body: {
      eventName: 'PlayerMessage'
    }
  };
  
  ws.send(JSON.stringify(subscribeMessage2));
  
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      console.log('📨 Received:', JSON.stringify(message, null, 2));
      
      const header = message.header;
      const body = message.body;
      
      if (!header || !body) {
        console.log('⚠️ Message missing header or body');
        return;
      }
      
      // Handle title messages (Family Life+ sends as PlayerMessage with type="title")
      // Filter out messages from External (our own responses) and Script Engine (system messages)
      if (body.type === 'title' && body.message && body.sender !== 'External' && body.sender !== 'Script Engine') {
        console.log('📺 Title message detected!');
        await handleTitleMessage(ws, body);
      }
      // Handle TitleChanged events as fallback
      else if (body.eventName === 'TitleChanged') {
        console.log('📺 Title event detected!');
        await handleTitleEvent(ws, body);
      }
      // Skip other message types
      else if (header.messagePurpose === 'event') {
        console.log(`📋 Event received: ${body.eventName || 'unknown'}`);
      }
      
    } catch (error) {
      console.error('❌ Error processing message:', error.message);
      console.error('Stack:', error.stack);
    }
  });
  
  ws.on('close', () => {
    connections.delete(clientId);
    console.log(`❌ Connection closed: ${clientId} (Remaining: ${connections.size})`);
  });
  
  ws.on('error', (error) => {
    console.error(`❌ WebSocket error for ${clientId}:`, error.message);
  });
});

// Handle title messages (Family Life+ format)
async function handleTitleMessage(ws, body) {
  const titleText = body.message;
  
  if (!titleText) {
    console.log('⚠️ No message text');
    return;
  }
  
  console.log('📝 Title text:', titleText);
  
  // Try to parse as JSON
  try {
    const payload = JSON.parse(titleText);
    
    if (payload.pn && payload.nn) {
      console.log('✅ Family Life+ payload detected!');
      await handleFamilyLifePayload(ws, payload);
    } else {
      console.log('⚠️ Not Family Life+ format');
    }
  } catch (e) {
    console.log('⚠️ Not JSON:', e.message);
  }
}

// Handle title events (original TitleChanged format)
async function handleTitleEvent(ws, body) {
  const titleText = body.title || body.text || body.message;
  
  if (!titleText) {
    console.log('⚠️ No title text found');
    return;
  }
  
  console.log('📝 Title text:', titleText);
  
  try {
    const payload = JSON.parse(titleText);
    
    if (payload.pn && payload.nn) {
      console.log('✅ Family Life+ payload detected!');
      await handleFamilyLifePayload(ws, payload);
    } else {
      console.log('⚠️ Not a Family Life+ payload format');
    }
  } catch (e) {
    console.log('⚠️ Title text is not JSON:', e.message);
  }
}

// Handle Family Life+ specific payload
async function handleFamilyLifePayload(ws, payload) {
  const playerName = payload.pn || 'Player';
  const playerMessage = payload.pm || '';
  const npcName = payload.nn || 'Villager';
  const npcId = payload.ni || 'unknown';
  const personality = payload.np || 'friendly';
  const friendship = payload.a || 0;
  const romance = payload.r || 0;
  const requestType = payload.t || 'D';
  
  console.log(`💬 ${playerName} → ${npcName}: "${playerMessage}"`);
  console.log(`📊 Stats - Personality: ${personality}, Friendship: ${friendship}, Romance: ${romance}`);
  
  // Get or create conversation history
  if (!npcMemory.has(npcId)) {
    npcMemory.set(npcId, []);
  }
  const history = npcMemory.get(npcId);
  
  // Build context for AI
  const context = buildContext(npcName, personality, friendship, romance, playerName, requestType);
  
  // Call Gemini AI
  const aiResponse = await callGeminiAI(context, playerMessage, history);
  
  // Update conversation history
  history.push({ role: 'user', content: playerMessage });
  history.push({ role: 'assistant', content: aiResponse });
  if (history.length > 20) {
    history.splice(0, history.length - 20);
  }
  
  console.log(`🤖 ${npcName}: "${aiResponse}"`);
  
  // Send response back to Minecraft
  sendCommand(ws, `tellraw @a {"rawtext":[{"text":"§e${escapeJson(npcName)}§r: ${escapeJson(aiResponse)}"}]}`);
}

// Build character context
function buildContext(npcName, personality, friendship, romance, playerName, requestType) {
  let context = `You are ${npcName}, a Minecraft villager with a ${personality} personality. `;
  
  if (friendship > 50) {
    context += `You're good friends with ${playerName}. `;
  } else if (friendship > 20) {
    context += `You're becoming friends with ${playerName}. `;
  } else if (friendship < -20) {
    context += `You don't really like ${playerName}. `;
  }
  
  if (romance > 50) {
    context += `You have romantic feelings for ${playerName}. `;
  } else if (romance > 20) {
    context += `You find ${playerName} attractive. `;
  }
  
  const personalityTraits = {
    adventurous: "You love excitement and new experiences!",
    cautious: "You prefer to think things through carefully.",
    ambitious: "You have big dreams and goals.",
    grumpy: "You're often irritable but have a good heart.",
    humorous: "You love making people laugh with jokes.",
    romantic: "You're a hopeless romantic who loves love.",
    brave: "You're fearless and courageous.",
    shy: "You're a bit timid but warm up to friends.",
    optimistic: "You always see the bright side!",
    pessimistic: "You tend to expect the worst.",
    sarcastic: "You love witty comebacks and sarcasm.",
    curious: "You're always asking questions.",
    loyal: "You're fiercely loyal to your friends.",
    materialistic: "You love valuable things and treasure.",
    spiritual: "You think deeply about life's meaning.",
    pragmatic: "You're practical and down-to-earth.",
    nostalgic: "You often think about the good old days.",
    proud: "You take pride in yourself and your village.",
    fearful: "You worry about dangers and threats.",
    altruistic: "You care deeply about helping others.",
    lazy: "You prefer taking it easy when possible.",
    clumsy: "You're a bit accident-prone but lovable.",
    intellectual: "You enjoy deep conversations.",
    charming: "You're smooth and charismatic.",
    naive: "You're innocent and trust others easily."
  };
  
  if (personalityTraits[personality]) {
    context += personalityTraits[personality] + " ";
  }
  
  if (requestType === "I") {
    context += "The player is interacting with you. Respond appropriately to their interaction. ";
  }
  
  context += "Keep responses natural, conversational, and under 40 words. Stay in character!";
  
  return context;
}

// Call Gemini AI API
async function callGeminiAI(context, message, history) {
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
      timeout: 15000
    };
    
    console.log('📡 Calling Gemini API...');
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          
          // Log full response for debugging
          console.log('🔍 Gemini response:', JSON.stringify(result, null, 2));
          
          if (result.candidates && result.candidates[0]) {
            const text = result.candidates[0].content.parts[0].text;
            console.log('✅ AI response received');
            resolve(text.trim());
          } else if (result.error) {
            console.error('❌ Gemini API error:', JSON.stringify(result.error, null, 2));
            resolve("Sorry, I'm having trouble thinking right now!");
          } else {
            console.error('⚠️ Unexpected response format:', JSON.stringify(result, null, 2));
            resolve("Hmm, I'm not sure what to say!");
          }
        } catch (error) {
          console.error('❌ Error parsing AI response:', error.message);
          console.error('Raw data:', data);
          resolve("Sorry, I lost my train of thought!");
        }
      });
    });
    
    req.on('error', (error) => {
      console.error('❌ API request error:', error.message);
      resolve("Sorry, I'm having trouble connecting!");
    });
    
    req.on('timeout', () => {
      console.error('⏰ API request timeout');
      req.destroy();
      resolve("I'm thinking too slowly, sorry!");
    });
    
    req.write(payload);
    req.end();
  });
}

// Send command to Minecraft
function sendCommand(ws, command) {
  const response = {
    header: {
      requestId: generateId(),
      messagePurpose: 'commandRequest',
      version: 1,
      messageType: 'commandRequest'
    },
    body: {
      origin: {
        type: 'player'
      },
      commandLine: command,
      version: 1
    }
  };
  
  console.log('📤 Sending command:', command);
  ws.send(JSON.stringify(response));
}

// Helper functions
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

// Start server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 WebSocket ready for connections`);
  console.log(`🎮 Family Life+ protocol enabled`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 Shutting down gracefully...');
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
       
