# macro-bot

A Telegram bot that logs meals and estimates macronutrients using Claude AI, backed by Neon Postgres.

## Features

- **Text-based logging** — send a meal description (e.g., "2 eggs and toast") and get an instant macro estimate
- **Photo-based logging** — snap a photo of your food and Claude describes what it sees, then estimates macros
- **Captioned photos** — add a caption to a photo and Claude treats it as authoritative context (e.g., "1 serving of rice cakes" overrides what's visible in the bag)
- **Per-item breakdowns** — multi-item meals show individual macros per item plus totals, with an expand/collapse button
- **Official nutrition data** — chain restaurant items (Taco Bell, McDonald's, Chipotle, etc.) use published menu nutrition data
- **Known products** — custom product database with exact values (e.g., Nurri Protein Shake, Oikos Pro Yogurt)
- **Nutrition label reading** — send a photo of a nutrition label and Claude reads the exact values
- **Chat mode** — ask nutrition questions, get meal planning advice, or food recommendations
- **Daily/weekly summaries** — `/today` and `/week` commands show macro totals (Mon–Sun calendar week)
- **Undo & delete** — `/undo` removes the most recent meal; every logged meal has a 🗑️ Delete button with confirmation
- **Recent meals view** — `/recent` lists the last 10 meals with delete buttons; `/today` has a "View meals" button to expand
- **Startup recap** — bot sends today's running totals whenever it restarts

## Tech Stack

- **TypeScript** (strict mode, ES2020, CommonJS)
- **Telegraf** — Telegram bot framework
- **Anthropic Claude API** — AI-powered macro estimation and food recognition
- **Neon Postgres** — serverless Postgres database
- **Drizzle ORM** — TypeScript-first database layer with migrations
- **Railway** — deployment platform (worker process, long-polling)

## Security

- **User authentication** — Telegram ID allowlist via `ALLOWED_TELEGRAM_IDS` (fail closed if unset)
- **Per-user data scoping** — all delete/read operations scoped by `user_id`; users can only access their own meals
- **Prompt injection defenses** — user input wrapped in XML tags, system prompts hardened against override attempts
- **Input validation** — text length limits, photo size limits (5MB), base64 validation, macro bounds checking
- **Secrets management** — all credentials loaded from environment variables, nothing hardcoded
- **Generic error messages** — no stack traces or internal details exposed to users
- **Broad gitignore** — `.env.*`, `*credentials*.json`, `*.pem`, `*.key`, `*.p12` all excluded

## Setup

### Prerequisites

- Node.js 18+
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- An Anthropic API key
- A Neon Postgres database ([neon.tech](https://neon.tech) — free tier works)

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
| `DATABASE_URL` | Neon pooled connection string (`postgresql://user:pass@ep-xxx-pooler.../neondb?sslmode=require`) |
| `ALLOWED_TELEGRAM_IDS` | Comma-separated Telegram user IDs (get yours from [@userinfobot](https://t.me/userinfobot)) |

### Database setup

```bash
# Generate SQL migration from schema (only if schema changed)
npm run db:generate

# Apply migrations to Neon
npm run db:migrate
```

The bot also runs migrations automatically on startup, so this is optional for fresh deployments.

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
  mealsRepo.ts      - Postgres queries (logMeal, getTodayTotals, getWeekTotals, deleteMeal, getRecentMeals)
  db/
    schema.ts       - Drizzle schema (users, meals, meal_items, api_usage)
    client.ts       - Neon connection + Drizzle instance
    migrate.ts      - Startup migration runner
    seed-owner.ts   - Idempotent owner-user seeder
drizzle/            - Generated SQL migrations (committed)
scripts/
  importSheet.ts    - One-shot historical data importer (TSV → Postgres)
```

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and usage info |
| `/today` | Show today's macro totals (with View meals button) |
| `/week` | Show this week's macro totals (Mon–Sun) |
| `/recent` | List your last 10 meals with delete buttons |
| `/undo` | Remove your most recent meal |

## Deployment (Railway)

1. Push this repo to GitHub
2. Connect the repo in [Railway](https://railway.app)
3. Add all environment variables in the **service's** Variables tab (not project-level)
4. Railway auto-deploys on every push (~1 min)

The `Procfile` uses `worker:` (not `web:`) because the bot uses long-polling and doesn't bind to an HTTP port. `web:` causes Railway to health-check a port that doesn't exist, killing the container with SIGTERM.

## Adding Known Products

To add a product with exact nutrition values, edit the `KNOWN_PRODUCTS` list and `PRODUCT_KEYWORDS` array in `src/claudeClient.ts`:

```typescript
// In KNOWN_PRODUCTS string:
"Product Name (serving size): XXX cal, XXg protein, XXg carbs, XXg fat, XXg fiber"

// In PRODUCT_KEYWORDS array:
{ keywords: ["product", "alias"], reminder: "Product Name: XXX cal, XXg protein, ..." }
```

The keyword detector adds a reminder to the Claude prompt whenever a known product is mentioned, ensuring exact values are used instead of estimates.

## License

ISC
