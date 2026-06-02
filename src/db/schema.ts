import { pgTable, uuid, text, real, boolean, timestamp, index } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').unique().notNull(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  business: text('business').notNull(),
  category: text('category').notNull(),
  capital: real('capital').notNull().default(0),
  city: text('city'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'venta' | 'gasto' | 'casa' | 'mercaderia' | 'gasto_casa'
  amount: real('amount').notNull(),
  note: text('note'),
  category: text('category'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  userIdx: index('transactions_user_id_idx').on(t.userId),
  userDateIdx: index('transactions_user_date_idx').on(t.userId, t.occurredAt),
}));

export const fiados = pgTable('fiados', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  person: text('person').notNull(),
  amount: real('amount').notNull(),
  product: text('product'),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  paid: boolean('paid').notNull().default(false),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  userIdx: index('fiados_user_id_idx').on(t.userId),
}));
