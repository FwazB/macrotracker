# macro-bot

A Telegram bot that logs meals and estimates macronutrients using Claude AI, with Google Sheets as the data store.

## Features

- **Text-based logging** — send a meal description (e.g., "2 eggs and toast") and get an instant macro estimate
- **Photo-based logging** — snap a photo of your food and Claude describes what it sees, then estimates macros
- **Per-item breakdowns** — multi-item meals show individual macros per item plus totals
- **Official nutrition data** — chain restaurant items (Taco Bell, McDonald's, Chipotle, etc.) use published menu nutrition data
- **Known products** — custom product database with exact values (e.g., Nurri Protein Shake, Oikos Pro Yogurt)
- **Nutrition label reading** — send a photo of a nutrition label and Claude reads the exact values
- **Chat mode** — ask nutrition questions, get meal planning advice, or food recommendations
- **Daily/weekly summaries** — `/today` and `/week` commands show macro totals
- **Startup recap** — bot sends today's running totals whenever it restarts
- **Google Sheets logging** — every meal is automatically logged to a spreadsheet

## Tech Stack

- **TypeScript** (strict mode, ES2020, CommonJS)
- **Telegraf** — Telegram bot framework
- **Anthropic Claude API** — AI-powered macro estimation and food recognition
- **Google Sheets API** — persistent meal logging
- **Railway** — deployment platform

## Security

- **User authentication** — Telegram ID allowlist via `ALLOWED_TELEGRAM_IDS` (fail closed if unset)
- **Prompt injection defenses** — user input wrapped in XML tags, system prompts hardened against override attempts
- **Formula injection prevention** — dangerous characters sanitized before writing to Sheets, `valueInputOption: "RAW"`
- **Input validation** — text length limits, photo size limits (5MB), base64 validation, macro bounds checking
- **Secrets management** — all credentials loaded from environment variables, nothing hardcoded
- **Generic error messages** — no stack traces or internal details exposed to users

## Setup

### Prerequisites

- Node.js 18+
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- An Anthropic API key
- A Google Cloud service account with Sheets API enabled

### Install

```bash
npm install
```

### Configure

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `ANTHROPIC_API_KEY` | API key from [console.anthropic.com](https://console.anthropic.com) |
| `GOOGLE_SHEET_ID` | The ID from your Google Sheet URL (`/d/{THIS_PART}/edit`) |
| `GOOGLE_CREDENTIALS_BASE64` | Base64-encoded service account credentials JSON |
| `ALLOWED_TELEGRAM_IDS` | Comma-separated Telegram user IDs (get yours from [@userinfobot](https://t.me/userinfobot)) |

For local development with a credentials file instead of base64:

```bash
# Place credentials.json in the project root (it's gitignored)
# The bot falls back to Application Default Credentials if GOOGLE_CREDENTIALS_BASE64 is not set
```

### Run

```bash
# Development
npm run dev

# Production
npm run build && npm start
```

## Project Structure

```
src/
  types.ts          - Macros and ItemBreakdown interfaces
  index.ts          - Telegraf bot, auth middleware, command & message handlers
  claudeClient.ts   - Claude API integration, prompt engineering, macro parsing
  sheetsClient.ts   - Google Sheets read/write, date handling, aggregation
```

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and usage info |
| `/today` | Show today's macro totals |
| `/week` | Show the past 7 days' macro totals |

## Deployment (Railway)

1. Push this repo to GitHub
2. Connect the repo in [Railway](https://railway.app)
3. Add all environment variables in Railway's Variables tab
4. Railway auto-deploys on every push (~1 min)

The `Procfile` uses `worker:` (not `web:`) because the bot uses long-polling and doesn't bind to an HTTP port.

## Adding Known Products

To add a product with exact nutrition values, edit the `KNOWN_PRODUCTS` list and `PRODUCT_KEYWORDS` array in `src/claudeClient.ts`:

```typescript
// In KNOWN_PRODUCTS string:
"Product Name (serving size): XXX cal, XXg protein, XXg carbs, XXg fat, XXg fiber"

// In PRODUCT_KEYWORDS array:
{ keywords: ["product", "alias"], reminder: "Product Name: XXX cal, XXg protein, ..." }
```

## License

ISC
