# Minecraft AI Bridge Server

Fast AI bridge for Minecraft Bedrock Edition using Family Life+ addon.

## Features

- 🚀 Fast responses using Gemini Flash
- 💬 Persistent NPC memory
- 🎭 Personality-aware responses
- ❤️ Relationship tracking
- 🔒 Secure WebSocket connections

## Deploy to Render

1. Fork/upload this code to GitHub
2. Connect Render to your GitHub repo
3. Set environment variable: `GEMINI_API_KEY`
4. Deploy!

## Environment Variables

- `GEMINI_API_KEY` - Your Google Gemini API key (required)
- `PORT` - Server port (default: 3000, Render sets this automatically)

## Minecraft Setup

1. Install Family Life+ addon (BP + RP)
2. Enable WebSockets in settings
3. Disable Encrypted WebSockets
4. In-game, run: `/connect your-app-name.onrender.com`

## Local Testing

```bash
npm install
export GEMINI_API_KEY="your-key-here"
npm start
```

Server will run on http://localhost:3000

## API Key

Get your free Gemini API key at:
https://aistudio.google.com/app/apikey

## License

MIT - Free to use and modify!
