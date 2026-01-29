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
  
  // Subscribe to TitleChanged event (this is how title commands are captured)
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
  
  // Also subscribe to PlayerMessage as fallback
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
      
      // Log all messages for debugging
      console.log('📨 Received:', JSON.stringify(message, null, 2));
      
      const header = message.header;
      const body = message.body;
      
      if (!header || !body) {
        console.log('⚠️ Message missing header or body');
        return;
      }
      
      // Handle TitleChanged events (this is where Family Life+ sends data)
      if (body.eventName === 'TitleChanged') {
        console.log('📺 Title event detected!');
        await handleTitleEvent(ws, body);
      }
      // Handle PlayerMessage events as fallback
      else if (body.eventName === 'PlayerMessage') {
        console.log('💬 Player message detected!');
        await handlePlayerMessage(ws, body);
      }
      // Handle other event types
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

// Handle title events (Family Life+ uses this)
async function handleTitleEvent(ws, body) {
  // The title text contains the JSON payload from Family Life+
  const titleText = body.title || body.text || body.message;
  
  if (!titleText) {
    console.log('⚠️ No title text found');
    return;
  }
  
  console.log('📝 Title text:', titleText);
  
  // Try to parse as JSON (Family Life+ payload)
  try {
    const payload = JSON.parse(titleText);
    
    // Check if this is a Family Life+ payload
    if (payload.pn && payload.pm && payload.nn) {
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
  const requestType = payload.t || 'D'; // D = dialogue, I = interaction
  
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
  
  // Update conversation history (keep last 10 messages)
  history.push({ role: 'user', content: playerMessage });
  history.push({ role: 'assistant', content: aiResponse });
  if (history.length > 20) {
    history.splice(0, history.length - 20);
  }
  
  console.log(`🤖 ${npcName}: "${aiResponse}"`);
  
  // Send response back to Minecraft
  // Family Life+ expects the response via tags on the NPC entity
  // We'll use tellraw to display the response to all players
  sendCommand(ws, `tellraw @a {"rawtext":[{"text":"§e${escapeJson(npcName)}§r: ${escapeJson(aiResponse)}"}]}`);
  
  // Optionally add a tag to the NPC for relationship changes
  // sendCommand(ws, `tag @e[type=minecraft:villager_v2,name="${npcName}",c=1] add AIResponse:${escapeJson(aiResponse)}`);
}

// Handle regular player messages (fallback)
async function handlePlayerMessage(ws, body) {
  const playerMessage = body.message || body.text;
  const playerName = body.sender || 'Player';
  
  console.log(`💬 Chat: ${playerName}: "${playerMessage}"`);
  
  // Simple response for testing
  const aiResponse = await callGeminiAI(
    'You are a friendly Minecraft villager. Keep responses under 40 words.',
    playerMessage,
    []
  );
  
  console.log(`🤖 Response: "${aiResponse}"`);
  sendCommand(ws, `tellraw @a {"rawtext":[{"text":"§eVillager§r: ${escapeJson(aiResponse)}"}]}`);
}

// Build character context based on NPC properties
function buildContext(npcName, personality, friendship, romance, playerName, requestType) {
  let context = `You are ${npcName}, a Minecraft villager with a ${personality} personality. `;
  
  // Friendship level
  if (friendship > 50) {
    context += `You're good friends with ${playerName}. `;
  } else if (friendship > 20) {
    context += `You're becoming friends with ${playerName}. `;
  } else if (friendship < -20) {
    context += `You don't really like ${playerName}. `;
  }
  
  // Romance level
  if (romance > 50) {
    context += `You have romantic feelings for ${playerName}. `;
  } else if (romance > 20) {
    context += `You find ${playerName} attractive. `;
  }
  
  // Personality traits
  const personalityTraits = {
    adventurous: "You love excitement and new experiences. You're always ready for adventure!",
    cautious: "You prefer to think things through carefully. Safety first!",
    ambitious: "You have big dreams and goals. You want to achieve great things.",
    grumpy: "You're often irritable but have a good heart deep down.",
    humorous: "You love making people laugh with jokes and wit.",
    romantic: "You're a hopeless romantic who loves love.",
    brave: "You're fearless and courageous in the face of danger.",
    shy: "You're a bit timid but warm up to friends over time.",
    optimistic: "You always see the bright side of things!",
    pessimistic: "You tend to expect the worst, but you're realistic.",
    sarcastic: "You love witty comebacks and sarcasm.",
    curious: "You're always asking questions and learning new things.",
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
    intellectual: "You enjoy deep conversations and learning.",
    charming: "You're smooth and charismatic.",
    naive: "You're innocent and trust others easily."
  };
  
  if (personalityTraits[personality]) {
    context += personalityTraits[personality] + " ";
  }
  
  // Request type context
  if (requestType === "I") {
    context += "The player is interacting with you (joke, story, hug, kiss, etc). Respond appropriately to their interaction. ";
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
            console.error('⚠️ No candidates in AI response');
            resolve("Hmm, I'm not sure what to say!");
          }
        } catch (error) {
          console.error('❌ Error parsing AI response:', error.message);
          resolve("Sorry, I lost my train of thought!");
        }
      });
    });
    
    req.on('error', (error) => {
      console.error('❌ API request error:', error.message);
      resolve("Sorry, I'm having trouble thinking right now!");
    });
    
    req.on('timeout', () => {
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
    if (client.readyState === 1) { // OPEN
      client.ping();
    }
  });
}, 30000);
