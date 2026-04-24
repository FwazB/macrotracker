import 'dotenv/config';
import { migrate } from 'drizzle-orm/neon-serverless/migrator';
import { db } from './client';
import path from 'path';

export async function runMigrations(): Promise<void> {
  await migrate(db, {
    migrationsFolder: path.join(__dirname, '../../drizzle'),
  });
}
