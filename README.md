# NTFY Worker

Cloudflare Worker that receives notifications and sends them to Discord with AI-powered formatting.

## Features

- Accepts POST requests with JSON or text payloads
- Uses AI models to format messages into rich Discord embeds
- Supports multiple AI models with fallback (z-ai/glm-4.5-air:free → arcee-ai/trinity-mini:free)
- Dynamic avatars based on notification type (success, error, warning, info)
- **Automatic retry logic with exponential backoff**
  - Retries failed API calls up to 3 times
  - Exponential backoff: 1s, 2s, 4s
  - Applies to both OpenRouter API and Discord webhook
- Comprehensive test suite with unit and integration tests

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

## Testing

Install dependencies:
```bash
npm install
```

Run tests:
```bash
npm test                 # Run all tests once
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage report
```

### Test Coverage

The test suite includes:
- **Request validation tests** - Method checks, payload parsing
- **Retry logic tests** - Exponential backoff, max retry limits
- **Avatar selection tests** - Color-to-icon mapping
- **AI model fallback tests** - Primary → secondary → static fallback
- **Integration tests** - End-to-end notification flows
- **Error handling tests** - Malformed JSON, API failures

## Retry Logic

The worker implements robust retry logic:
- **Maximum retries**: 3 attempts
- **Backoff strategy**: Exponential (1s → 2s → 4s)
- **Applied to**:
  - OpenRouter API calls (AI formatting)
  - Discord webhook deliveries

If all retries fail, the worker falls back to a static notification format.

## Version

Deployed from Cloudflare version: be27784c-a3d9-48a3-ab35-a19643d55ec2
