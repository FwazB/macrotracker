# macro-bot

A Telegram bot that logs meals and estimates macronutrients using Claude AI, with Google Sheets as the data store.

## Features

- Send a text description of a meal and get macro estimates (calories, protein, carbs, fat, fiber)
- Send a photo of food for vision-based macro estimation
- `/today` — view today's totals
- `/week` — view the past 7 days' totals
- All meals automatically logged to a Google Sheet

## Setup

### Prerequisites

- Node.js 18+
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- An Anthropic API key
- A Google Sheet + service account with Sheets API access

### Install

```bash
npm install
```

### Configure

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

| Variable | Source |
|----------|--------|
| `TELEGRAM_BOT_TOKEN` | @BotFather on Telegram |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `GOOGLE_SHEET_ID` | The ID from your Google Sheet URL (`/d/{THIS_PART}/edit`) |

Place your Google service account `credentials.json` in the project root.

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
  types.ts          — Macros interface
  index.ts          — Telegraf bot, command & message handlers
  claudeClient.ts   — Claude API integration for macro estimation
  sheetsClient.ts   — Google Sheets read/write operations
```

## Deployment (Railway)

1. Push this repo to GitHub
2. Connect the repo in [Railway](https://railway.app)
3. Add your environment variables in Railway's Variables tab
4. Railway auto-deploys on push
