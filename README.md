# NTFY Worker

Cloudflare Worker that receives notifications and sends them to Discord with AI-powered formatting.

## Features

- Accepts POST requests with JSON or text payloads
- Uses AI models to format messages into rich Discord embeds
- Supports multiple AI models with fallback
- Automatic retry logic

## Environment Variables

Required secrets:
- `DISCORD_WEBHOOK` - Your Discord webhook URL
- `OPENROUTER_API_KEY` - Your OpenRouter API key

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set secrets:
```bash
wrangler secret put DISCORD_WEBHOOK
wrangler secret put OPENROUTER_API_KEY
```

3. Deploy:
```bash
npm run deploy
```

## Usage

Send a POST request to your worker URL:

```bash
curl -X POST https://your-worker.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"message": "Test notification"}'
```

## Development

Run locally:
```bash
npm run dev
```

## Version

Deployed from Cloudflare version: be27784c-a3d9-48a3-ab35-a19643d55ec2
