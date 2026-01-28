const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const https = require('https');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Get API key from environment variable
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'YOUR_API_KEY_HERE';

// Store active connections
const connections = new Map();

// Store conversation history per NPC
const npcMemory = new Map();

console.log('🚀 Minecraft AI Bridge Server Starting...');

// Health check endpoint
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

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  const clientId = Math.random().toString(36).substring(7);
  connections.set(clientId, ws);
  
  console.log(`✅ New connection: ${clientId} (Total: ${connections.size})`);
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log(`📨 Received:`, data);
      
      // Extract payload from Minecraft
      const payload = data.body || data;
      
      if (payload.pm) {
        // This is a Family Life+ message
        await handleFamilyLifeMessage(ws, payload);
      } else {
        // Generic message
        ws.send(JSON.stringify({ 
          error: 'Unknown message format',
          received: data 
        }));
      }
    } catch (error) {
      console.error('❌ Error processing message:', error);
      ws.send(JSON.stringify({ 
        error: 'Failed to process message',
        details: error.message 
      }));
    }
  });
  
  ws.on('close', () => {
    connections.delete(clientId);
    console.log(`❌ Connection closed: ${clientId} (Remaining: ${connections.size})`);
  });
  
  ws.on('error', (error) => {
    console.error(`❌ WebSocket error for ${clientId}:`, error);
  });
  
  // Send welcome message
  ws.send(JSON.stringify({
    type: 'welcome',
    message: 'Connected to Minecraft AI Bridge!',
    clientId: clientId
  }));
});

// Handle Family Life+ messages
async function handleFamilyLifeMessage(ws, payload) {
  const playerName = payload.pn || 'Player';
  const playerMessage = payload.pm || '';
  const npcName = payload.nn || 'Villager';
  const npcId = payload.ni || 'unknown';
  const personality = payload.np || 'friendly';
  const friendship = payload.a || 0;
  const romance = payload.r || 0;
  
  console.log(`💬 ${playerName} → ${npcName}: "${playerMessage}"`);
  
  // Get or create conversation history
  if (!npcMemory.has(npcId)) {
    npcMemory.set(npcId, []);
  }
  const history = npcMemory.get(npcId);
  
  // Build context for AI
  const context = buildContext(npcName, personality, friendship, romance, playerName);
  
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
  const response = {
    header: {
      requestId: payload.requestId || generateId(),
      messagePurpose: 'event',
      version: 1,
      messageType: 'commandRequest'
    },
    body: {
      origin: {
        type: 'player'
      },
      commandLine: `tellraw @a {"rawtext":[{"text":"§e${npcName}§r: ${escapeJson(aiResponse)}"}]}`,
      version: 1
    }
  };
  
  ws.send(JSON.stringify(response));
}

// Build character context
function buildContext(npcName, personality, friendship, romance, playerName) {
  let context = `You are ${npcName}, a Minecraft villager with a ${personality} personality. `;
  
  if (friendship > 50) {
    context += `You're good friends with ${playerName}. `;
  } else if (friendship < -20) {
    context += `You don't really like ${playerName}. `;
  }
  
  if (romance > 50) {
    context += `You have romantic feelings for ${playerName}. `;
  }
  
  const personalityTraits = {
    adventurous: "You love excitement and new experiences.",
    cautious: "You prefer to think things through carefully.",
    grumpy: "You're often irritable but have a good heart.",
    humorous: "You love making people laugh with jokes.",
    romantic: "You're a hopeless romantic.",
    brave: "You're fearless and courageous.",
    shy: "You're a bit timid but warm up to friends.",
    optimistic: "You always see the bright side.",
    sarcastic: "You love witty comebacks."
  };
  
  if (personalityTraits[personality]) {
    context += personalityTraits[personality];
  }
  
  context += " Keep responses under 40 words. Be natural and conversational.";
  
  return context;
}

// Call Gemini AI API
async function callGeminiAI(context, message, history) {
  return new Promise((resolve, reject) => {
    const prompt = `${context}\n\nPlayer: ${message}\n\nRespond naturally:`;
    
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
            resolve("Sorry, I'm having trouble thinking right now!");
          }
        } catch (error) {
          console.error('❌ Error parsing AI response:', error);
          resolve("Hmm, I lost my train of thought!");
        }
      });
    });
    
    req.on('error', (error) => {
      console.error('❌ API request error:', error);
      resolve("Sorry, I'm a bit confused right now!");
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve("Sorry, I'm thinking too slowly!");
    });
    
    req.write(payload);
    req.end();
  });
}

// Helper functions
function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

function escapeJson(str) {
  return str.replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 WebSocket ready for connections`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
