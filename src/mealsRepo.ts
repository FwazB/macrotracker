import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from './db/client';
import { meals, mealItems } from './db/schema';
import { getOwnerUserId } from './db/seed-owner';
import { Macros, ItemBreakdown } from './types';

const TZ = 'America/New_York';

function todayEST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

/**
 * Returns UTC Date bounds for the start and end of the given local EST date.
 * Handles DST correctly by scanning for the exact hour the local date begins.
 */
function estDayBoundsUtc(localDateStr: string): { start: Date; end: Date } {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
  const [y, m, d] = localDateStr.split('-').map(Number);

  let start: Date | null = null;
  for (let h = 2; h <= 8; h++) {
    const t = new Date(Date.UTC(y, m - 1, d, h, 0, 0));
    if (fmt.format(t) === localDateStr && fmt.format(new Date(t.getTime() - 1)) !== localDateStr) {
      start = t;
      break;
    }
  }
  if (!start) start = new Date(Date.UTC(y, m - 1, d, 5, 0, 0)); // fallback: EST

  // Compute next day's start as the end bound
  const nextDayApprox = new Date(start.getTime() + 25 * 3600 * 1000);
  const nextDateStr = fmt.format(nextDayApprox);
  const [ny, nm, nd] = nextDateStr.split('-').map(Number);
  let end: Date | null = null;
  for (let h = 2; h <= 8; h++) {
    const t = new Date(Date.UTC(ny, nm - 1, nd, h, 0, 0));
    if (fmt.format(t) === nextDateStr && fmt.format(new Date(t.getTime() - 1)) !== nextDateStr) {
      end = t;
      break;
    }
  }
  if (!end) end = new Date(start.getTime() + 24 * 3600 * 1000);

  return { start, end };
}

function getESTWeekBounds(): { start: Date; end: Date } {
  const todayStr = todayEST();
  const [y, m, d] = todayStr.split('-').map(Number);
  // Use noon UTC on this EST date for unambiguous day-of-week calculation
  const noon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const day = noon.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diffToMonday = day === 0 ? 6 : day - 1;

  const mondayNoon = new Date(noon.getTime() - diffToMonday * 86_400_000);
  const mondayStr = mondayNoon.toISOString().slice(0, 10);

  const nextMondayNoon = new Date(mondayNoon.getTime() + 7 * 86_400_000);
  const nextMondayStr = nextMondayNoon.toISOString().slice(0, 10);

  return {
    start: estDayBoundsUtc(mondayStr).start,
    end: estDayBoundsUtc(nextMondayStr).start,
  };
}

async function sumMealsInWindow(start: Date, end: Date): Promise<Macros> {
  const userId = getOwnerUserId();

  const [result] = await db
    .select({
      calories: sql<string>`COALESCE(SUM(${meals.calories}), 0)`,
      protein_g: sql<string>`COALESCE(SUM(${meals.protein_g}), 0)`,
      carbs_g: sql<string>`COALESCE(SUM(${meals.carbs_g}), 0)`,
      fat_g: sql<string>`COALESCE(SUM(${meals.fat_g}), 0)`,
      fiber_g: sql<string>`COALESCE(SUM(${meals.fiber_g}), 0)`,
    })
    .from(meals)
    .where(and(eq(meals.user_id, userId), gte(meals.logged_at, start), lt(meals.logged_at, end)));

  return {
    calories: Number(result.calories),
    protein_g: Number(result.protein_g),
    carbs_g: Number(result.carbs_g),
    fat_g: Number(result.fat_g),
    fiber_g: Number(result.fiber_g),
  };
}

export async function logMeal(
  description: string,
  macros: Macros,
  items?: ItemBreakdown[],
  source: 'text' | 'photo' = 'text',
): Promise<void> {
  const userId = getOwnerUserId();
  const now = new Date();

  await db.transaction(async (tx) => {
    const [meal] = await tx
      .insert(meals)
      .values({
        user_id: userId,
        logged_at: now,
        description,
        calories: String(macros.calories),
        protein_g: String(macros.protein_g),
        carbs_g: String(macros.carbs_g),
        fat_g: String(macros.fat_g),
        fiber_g: String(macros.fiber_g),
        source,
      })
      .returning({ id: meals.id });

    if (items && items.length > 1) {
      await tx.insert(mealItems).values(
        items.map((item, i) => ({
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
    }
  });
}

export async function getTodayTotals(): Promise<Macros> {
  const { start, end } = estDayBoundsUtc(todayEST());
  return sumMealsInWindow(start, end);
}

export async function getWeekTotals(): Promise<Macros> {
  const { start, end } = getESTWeekBounds();
  return sumMealsInWindow(start, end);
}
