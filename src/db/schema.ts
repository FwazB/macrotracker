import {
  pgTable,
  uuid,
  bigint,
  text,
  timestamp,
  numeric,
  integer,
  pgEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql, InferSelectModel } from 'drizzle-orm';

export const planEnum = pgEnum('plan', ['free', 'pro']);
export const mealSourceEnum = pgEnum('meal_source', ['text', 'photo']);
export const apiProviderEnum = pgEnum('api_provider', ['anthropic']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    telegram_id: bigint('telegram_id', { mode: 'bigint' }),
    plan: planEnum('plan').default('free').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('users_telegram_id_unique').on(table.telegram_id),
  ],
);

export const meals = pgTable(
  'meals',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    logged_at: timestamp('logged_at', { withTimezone: true }).notNull(),
    description: text('description').notNull(),
    calories: numeric('calories', { precision: 8, scale: 2 }).notNull(),
    protein_g: numeric('protein_g', { precision: 8, scale: 2 }).notNull(),
    carbs_g: numeric('carbs_g', { precision: 8, scale: 2 }).notNull(),
    fat_g: numeric('fat_g', { precision: 8, scale: 2 }).notNull(),
    fiber_g: numeric('fiber_g', { precision: 8, scale: 2 }).notNull(),
    source: mealSourceEnum('source').default('text').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('meals_user_logged_at_idx').on(table.user_id, table.logged_at),
  ],
);

export const mealItems = pgTable(
  'meal_items',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    meal_id: uuid('meal_id')
      .notNull()
      .references(() => meals.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    name: text('name').notNull(),
    calories: numeric('calories', { precision: 8, scale: 2 }).notNull(),
    protein_g: numeric('protein_g', { precision: 8, scale: 2 }).notNull(),
    carbs_g: numeric('carbs_g', { precision: 8, scale: 2 }).notNull(),
    fat_g: numeric('fat_g', { precision: 8, scale: 2 }).notNull(),
    fiber_g: numeric('fiber_g', { precision: 8, scale: 2 }).notNull(),
  },
  (table) => [
    index('meal_items_meal_id_idx').on(table.meal_id),
  ],
);

export const apiUsage = pgTable('api_usage', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  user_id: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  provider: apiProviderEnum('provider').notNull(),
  input_tokens: integer('input_tokens').default(0).notNull(),
  output_tokens: integer('output_tokens').default(0).notNull(),
  cost_usd: numeric('cost_usd', { precision: 10, scale: 6 }).default('0').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type User = InferSelectModel<typeof users>;
export type Meal = InferSelectModel<typeof meals>;
export type MealItem = InferSelectModel<typeof mealItems>;
