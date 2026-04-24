import 'dotenv/config';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import { and, eq } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { users, meals, mealItems } from '../src/db/schema';

neonConfig.webSocketConstructor = ws;

const TZ = 'America/New_York';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL not set');
const db = drizzle(new Pool({ connectionString: url }), { schema: { users, meals, mealItems } });

/**
 * Parse "M/D/YYYY, H:MM:SS AM/PM" (America/New_York) → UTC Date.
 * Tries both EST (UTC-5) and EDT (UTC-4) offsets and picks the one that
 * round-trips correctly through Intl.
 */
function parseEstTimestamp(tsStr: string): Date {
  const match = tsStr.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)$/,
  );
  if (!match) throw new Error(`Unparseable timestamp: "${tsStr}"`);

  const [, mo, da, yr, hr12, mi, sc, ampm] = match;
  const month = parseInt(mo, 10) - 1;
  const day = parseInt(da, 10);
  const year = parseInt(yr, 10);
  const minute = parseInt(mi, 10);
  const second = parseInt(sc, 10);
  let hour = parseInt(hr12, 10);
  if (ampm === 'PM' && hour !== 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;

  for (const offsetHours of [4, 5]) {
    const candidate = new Date(Date.UTC(year, month, day, hour + offsetHours, minute, second));
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).formatToParts(candidate);

    const p: Record<string, string> = {};
    for (const part of parts) {
      if (part.type !== 'literal') p[part.type] = part.value;
    }

    let rHour = parseInt(p['hour'] ?? '0', 10);
    const rMin = parseInt(p['minute'] ?? '0', 10);
    const rSec = parseInt(p['second'] ?? '0', 10);
    const rPeriod = p['dayPeriod'] ?? '';
    if (rPeriod === 'PM' && rHour !== 12) rHour += 12;
    if (rPeriod === 'AM' && rHour === 12) rHour = 0;

    if (rHour === hour && rMin === minute && rSec === second) {
      return candidate;
    }
  }

  // Fallback: assume EST (UTC-5)
  return new Date(Date.UTC(year, month, day, hour + 5, minute, second));
}

interface ParentRow {
  timestamp: string;
  description: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  items: Array<{
    name: string;
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    fiber_g: number;
  }>;
}

async function main() {
  const allowedIdsRaw = process.env.ALLOWED_TELEGRAM_IDS?.trim() ?? '';
  const firstId = allowedIdsRaw.split(',')[0]?.trim();
  if (!firstId) throw new Error('ALLOWED_TELEGRAM_IDS not set');

  const telegramId = BigInt(firstId);
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.telegram_id, telegramId))
    .limit(1);

  if (!owner) {
    throw new Error(
      `Owner (telegram_id=${telegramId}) not found. Run migrations and start the bot once to seed first.`,
    );
  }
  const userId = owner.id;

  const tsvPath = path.join(__dirname, '../migration-data/sheet-export.tsv');
  const lines = fs.readFileSync(tsvPath, 'utf-8').split('\n').filter((l) => l.length > 0);

  const parents: ParentRow[] = [];
  let invalidSkipped = 0;

  for (const line of lines) {
    const cols = line.split('\t');
    if (cols.length < 7) {
      invalidSkipped++;
      continue;
    }

    const firstCol = cols[0].trim();
    const desc = cols[1].trim();
    const cal = Number(cols[2]);
    const prot = Number(cols[3]);
    const carb = Number(cols[4]);
    const fat = Number(cols[5]);
    const fib = Number(cols[6]);

    if ([cal, prot, carb, fat, fib].some((n) => !Number.isFinite(n))) {
      invalidSkipped++;
      continue;
    }

    if (firstCol === '') {
      // Sub-row: belongs to the previous parent
      if (parents.length === 0) {
        invalidSkipped++;
        continue;
      }
      const name = desc.startsWith('→ ') ? desc.slice(2) : desc;
      parents[parents.length - 1].items.push({
        name,
        calories: cal,
        protein_g: prot,
        carbs_g: carb,
        fat_g: fat,
        fiber_g: fib,
      });
    } else {
      parents.push({
        timestamp: firstCol,
        description: desc,
        calories: cal,
        protein_g: prot,
        carbs_g: carb,
        fat_g: fat,
        fiber_g: fib,
        items: [],
      });
    }
  }

  let imported = 0;
  let skipped = 0;
  let itemsInserted = 0;

  for (const parent of parents) {
    let loggedAt: Date;
    try {
      loggedAt = parseEstTimestamp(parent.timestamp);
    } catch {
      console.warn(`  Skipping row with unparseable timestamp: "${parent.timestamp}"`);
      invalidSkipped++;
      continue;
    }

    // Idempotency: skip if exact (user_id, logged_at, description) already present
    const existing = await db
      .select({ id: meals.id })
      .from(meals)
      .where(
        and(
          eq(meals.user_id, userId),
          eq(meals.logged_at, loggedAt),
          eq(meals.description, parent.description),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      skipped++;
      continue;
    }

    await db.transaction(async (tx) => {
      const [meal] = await tx
        .insert(meals)
        .values({
          user_id: userId,
          logged_at: loggedAt,
          description: parent.description,
          calories: String(parent.calories),
          protein_g: String(parent.protein_g),
          carbs_g: String(parent.carbs_g),
          fat_g: String(parent.fat_g),
          fiber_g: String(parent.fiber_g),
          source: 'text',
        })
        .returning({ id: meals.id });

      if (parent.items.length > 0) {
        await tx.insert(mealItems).values(
          parent.items.map((item, i) => ({
            meal_id: meal.id,
            position: i,
            name: item.name,
            calories: String(item.calories),
            protein_g: String(item.protein_g),
            carbs_g: String(item.carbs_g),
            fat_g: String(item.fat_g),
            fiber_g: String(item.fiber_g),
          })),
        );
        itemsInserted += parent.items.length;
      }
    });

    imported++;
  }

  console.log(
    `Imported ${imported} meals (${itemsInserted} items), skipped ${skipped} already-present rows.`,
  );
  if (invalidSkipped > 0) {
    console.warn(`  ⚠ Skipped ${invalidSkipped} rows with invalid/unparseable data.`);
  }
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
