import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from './schema';

// Required for WebSocket-based connections in Node.js
neonConfig.webSocketConstructor = ws;

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const pool = new Pool({ connectionString: url });
export const db = drizzle(pool, { schema });
export type Db = typeof db;
