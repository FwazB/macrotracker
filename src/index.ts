import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import axios from 'axios';
import { estimateMacros, chat } from './claudeClient';
import { logMeal, getTodayTotals, getWeekTotals } from './mealsRepo';
import { Macros, ItemBreakdown } from './types';
import { runMigrations } from './db/migrate';
import { seedOwner } from './db/seed-owner';

const MAX_TEXT_LENGTH = 500;
const MAX_PHOTO_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is not set');
}

const bot = new Telegraf(token);

// Parse allowed Telegram user IDs (fail closed if not set)
const allowedIdsRaw = process.env.ALLOWED_TELEGRAM_IDS?.trim();
if (!allowedIdsRaw) {
  console.warn('WARNING: ALLOWED_TELEGRAM_IDS is not set — all users will be rejected.');
}
const allowedUserIds: Set<number> = new Set(
  (allowedIdsRaw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number)
    .filter((n) => !Number.isNaN(n)),
);

// Auth middleware — must run before all handlers
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId || !allowedUserIds.has(userId)) {
    await ctx.reply('Unauthorized.');
    return;
  }
  return next();
});

function sanitizeText(input: string): string {
  return input.replace(/[^\P{Cc}\n]/gu, '').trim().slice(0, MAX_TEXT_LENGTH);
}

function formatMacros(m: Macros): string {
  return [
    `Calories: ${m.calories} kcal`,
    `Protein: ${m.protein_g}g`,
    `Carbs: ${m.carbs_g}g`,
    `Fat: ${m.fat_g}g`,
    `Fiber: ${m.fiber_g}g`,
  ].join('\n');
}

function formatBreakdown(items: ItemBreakdown[]): string {
  return items
    .map((item) => `${item.name}\n  ${item.calories} cal | ${item.protein_g}g P | ${item.carbs_g}g C | ${item.fat_g}g F`)
    .join('\n\n');
}

function formatMacrosSummary(m: Macros): string {
  return `${m.calories} cal | ${m.protein_g}g P | ${m.carbs_g}g C | ${m.fat_g}g F | ${m.fiber_g}g Fi`;
}

interface BreakdownEntry {
  items: ItemBreakdown[];
  macros: Macros;
  prefix: string;
}

const breakdownStore = new Map<string, BreakdownEntry>();
const MAX_BREAKDOWN_ENTRIES = 200;

function storeBreakdown(items: ItemBreakdown[], macros: Macros, prefix: string): string {
  const id = Math.random().toString(36).slice(2, 10);
  if (breakdownStore.size >= MAX_BREAKDOWN_ENTRIES) {
    const firstKey = breakdownStore.keys().next().value;
    if (firstKey) breakdownStore.delete(firstKey);
  }
  breakdownStore.set(id, { items, macros, prefix });
  return id;
}

bot.command('start', async (ctx) => {
  await ctx.reply(
    'Welcome to MacroBot!\n\n' +
      'Send me a meal description or photo to log macros.\n' +
      'You can also chat with me about nutrition, food recommendations, and meal planning!\n\n' +
      'Commands:\n' +
      "/today - See today's totals\n" +
      "/week - See this week's summary",
  );
});

bot.command('today', async (ctx) => {
  try {
    const totals = await getTodayTotals();
    await ctx.reply(`Today's totals:\n\n${formatMacros(totals)}`);
  } catch {
    await ctx.reply("Something went wrong fetching today's totals.");
  }
});

bot.command('week', async (ctx) => {
  try {
    const totals = await getWeekTotals();
    await ctx.reply(`This week's totals (Mon–Sun):\n\n${formatMacros(totals)}`);
  } catch {
    await ctx.reply('Something went wrong fetching the weekly summary.');
  }
});

bot.action(/^bd_show:(.+)$/, async (ctx) => {
  const id = ctx.match[1];
  const entry = breakdownStore.get(id);
  if (!entry) {
    await ctx.answerCbQuery('Breakdown expired');
    return;
  }
  const text = `${entry.prefix}Logged!\n\n${formatBreakdown(entry.items)}\n\nTotal:\n${formatMacros(entry.macros)}`;
  await ctx.editMessageText(text, Markup.inlineKeyboard([
    Markup.button.callback('🔼 Hide breakdown', `bd_hide:${id}`),
  ]));
  await ctx.answerCbQuery();
});

bot.action(/^bd_hide:(.+)$/, async (ctx) => {
  const id = ctx.match[1];
  const entry = breakdownStore.get(id);
  if (!entry) {
    await ctx.answerCbQuery('Breakdown expired');
    return;
  }
  const text = `${entry.prefix}Logged! ${formatMacrosSummary(entry.macros)}`;
  await ctx.editMessageText(text, Markup.inlineKeyboard([
    Markup.button.callback('📊 Show breakdown', `bd_show:${id}`),
  ]));
  await ctx.answerCbQuery();
});

bot.on('text', async (ctx) => {
  const raw = ctx.message.text;
  if (raw.startsWith('/')) return;

  const text = sanitizeText(raw);
  if (!text) {
    await ctx.reply('Please send a meal description or a photo of your food.');
    return;
  }

  try {
    const result = await chat(text);
    if (result.type === 'macros') {
      await logMeal(text, result.macros, result.items, 'text');
      if (result.items && result.items.length > 1) {
        const id = storeBreakdown(result.items, result.macros, '');
        await ctx.reply(
          `Logged! ${formatMacrosSummary(result.macros)}`,
          Markup.inlineKeyboard([Markup.button.callback('📊 Show breakdown', `bd_show:${id}`)]),
        );
      } else {
        await ctx.reply(`Logged!\n\n${formatMacros(result.macros)}`);
      }
    } else {
      await ctx.reply(result.message);
    }
  } catch (err) {
    console.error('Chat error:', err);
    await ctx.reply('Something went wrong. Please try again.');
  }
});

bot.on('photo', async (ctx) => {
  try {
    const photos = ctx.message.photo;
    const photo = photos[photos.length - 1];
    const file = await ctx.telegram.getFile(photo.file_id);

    if (file.file_size && file.file_size > MAX_PHOTO_SIZE) {
      await ctx.reply('Photo is too large. Please send an image under 5MB.');
      return;
    }

    const fileLink = await ctx.telegram.getFileLink(photo.file_id);
    const response = await axios.get<ArrayBuffer>(fileLink.href, {
      responseType: 'arraybuffer',
    });

    const rawContentType = String(response.headers['content-type'] ?? '').split(';')[0].trim();
    const contentType = ALLOWED_MIME_TYPES.includes(rawContentType) ? rawContentType : 'image/jpeg';

    const buffer = Buffer.from(response.data);
    if (buffer.length > MAX_PHOTO_SIZE) {
      await ctx.reply('Photo is too large. Please send an image under 5MB.');
      return;
    }

    const base64 = buffer.toString('base64');
    const userCaption = ctx.message.caption ? sanitizeText(ctx.message.caption) : '';
    const caption = userCaption || 'Food photo';

    const { macros, items, description } = await estimateMacros(
      userCaption || undefined,
      base64,
      contentType,
    );
    await logMeal(caption, macros, items, 'photo');
    const prefix = description ? `${description}\n\n` : '';
    if (items && items.length > 1) {
      const id = storeBreakdown(items, macros, prefix);
      await ctx.reply(
        `${prefix}Logged! ${formatMacrosSummary(macros)}`,
        Markup.inlineKeyboard([Markup.button.callback('📊 Show breakdown', `bd_show:${id}`)]),
      );
    } else {
      await ctx.reply(`${prefix}Logged!\n\n${formatMacros(macros)}`);
    }
  } catch {
    await ctx.reply('Something went wrong processing your photo. Please try again.');
  }
});

(async () => {
  await runMigrations();
  await seedOwner();

  bot.launch();
  console.log('Bot started');

  // Send startup notification independently
  try {
    console.log('Fetching today totals for startup notification...');
    const totals = await getTodayTotals();
    console.log('Today totals:', JSON.stringify(totals));
    const message = `Bot restarted — here's today so far:\n\n${formatMacros(totals)}`;
    for (const userId of allowedUserIds) {
      console.log(`Sending startup notification to ${userId}...`);
      await bot.telegram.sendMessage(userId, message).catch((err) => {
        console.error(`Failed to send startup notification to ${userId}:`, err);
      });
    }
    console.log('Startup notifications sent');
  } catch (err) {
    console.error('Startup notification error:', err);
  }
})().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
