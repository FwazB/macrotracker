import { db } from './client';
import { users } from './schema';
import { eq } from 'drizzle-orm';

let ownerUserId: string | null = null;

export async function seedOwner(): Promise<void> {
  const allowedIdsRaw = process.env.ALLOWED_TELEGRAM_IDS?.trim();
  if (!allowedIdsRaw) throw new Error('ALLOWED_TELEGRAM_IDS is not set');

  const firstRaw = allowedIdsRaw.split(',').map((s) => s.trim()).find((s) => s.length > 0);
  if (!firstRaw) throw new Error('No valid telegram IDs in ALLOWED_TELEGRAM_IDS');

  const telegramId = BigInt(firstRaw);

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.telegram_id, telegramId))
    .limit(1);

  if (existing.length > 0) {
    ownerUserId = existing[0].id;
    return;
  }

  const inserted = await db
    .insert(users)
    .values({ telegram_id: telegramId })
    .returning({ id: users.id });

  ownerUserId = inserted[0].id;
  console.log(`Seeded owner user: ${ownerUserId}`);
}

export function getOwnerUserId(): string {
  if (!ownerUserId) throw new Error('seedOwner() must be called before getOwnerUserId()');
  return ownerUserId;
}
