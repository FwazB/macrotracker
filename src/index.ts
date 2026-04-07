import 'dotenv/config';
import { Telegraf } from 'telegraf';
import axios from 'axios';
import { estimateMacros } from './claudeClient';
import { logMeal, getTodayTotals, getWeekTotals } from './sheetsClient';
import { Macros } from './types';

const MAX_TEXT_LENGTH = 500;
const MAX_PHOTO_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'];

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is not set');
}

const bot = new Telegraf(token);

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

bot.command('start', async (ctx) => {
  await ctx.reply(
    'Welcome to MacroBot!\n\n' +
      'Send me a meal description or a photo of your food, ' +
      "and I'll estimate the macros and log them for you.\n\n" +
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
    await ctx.reply(`This week's totals (last 7 days):\n\n${formatMacros(totals)}`);
  } catch {
    await ctx.reply('Something went wrong fetching the weekly summary.');
  }
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
    const macros = await estimateMacros(text);
    await logMeal(text, macros);
    await ctx.reply(`Logged!\n\n${formatMacros(macros)}`);
  } catch {
    await ctx.reply('Something went wrong estimating your meal. Please try again.');
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

    const contentType = String(response.headers['content-type'] ?? '');
    if (!ALLOWED_MIME_TYPES.includes(contentType)) {
      await ctx.reply('Unsupported image format. Please send a JPEG or PNG.');
      return;
    }

    const buffer = Buffer.from(response.data);
    if (buffer.length > MAX_PHOTO_SIZE) {
      await ctx.reply('Photo is too large. Please send an image under 5MB.');
      return;
    }

    const base64 = buffer.toString('base64');
    const caption = ctx.message.caption
      ? sanitizeText(ctx.message.caption)
      : 'Food photo';

    const macros = await estimateMacros(undefined, base64, contentType);
    await logMeal(caption, macros);
    await ctx.reply(`Logged!\n\n${formatMacros(macros)}`);
  } catch {
    await ctx.reply('Something went wrong processing your photo. Please try again.');
  }
});

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
