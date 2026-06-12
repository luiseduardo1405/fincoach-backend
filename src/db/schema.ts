import { pgTable, uuid, text, numeric, boolean, timestamp, index, jsonb } from 'drizzle-orm/pg-core';

// numeric(12,2) gives up to 9,999,999,999.99 — sufficient for any realistic amount
// and avoids the float32 rounding errors of `real` (e.g. 1234567.89 → 1234568).
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').unique().notNull(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  business: text('business').notNull(),
  category: text('category').notNull(),
  capital: numeric('capital', { precision: 12, scale: 2 }).notNull().default('0'),
  city: text('city'),
  // 'free' | 'pro' | 'max' — actualizado por el webhook de Mercado Pago.
  subscriptionTier: text('subscription_tier').notNull().default('free'),
  // ANDROID_ID (estable por dispositivo + firma del APK). Es solo una PISTA de
  // recuperación tras reinstalar — la credencial sigue siendo email+password
  // aleatorios por instalación; ver /auth/recover-device.
  deviceId: text('device_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  deviceIdx: index('users_device_id_idx').on(t.deviceId),
}));

export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // 'venta' | 'gasto' | 'casa' | 'mercaderia' | 'gasto_casa'
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
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
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  product: text('product'),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  paid: boolean('paid').notNull().default(false),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  userIdx: index('fiados_user_id_idx').on(t.userId),
}));

// ── Suscripciones (Mercado Pago) ──────────────────────────────────────────────

// Catálogo de los 4 planes (Pro/Max × mensual/anual). El mpPlanId es el id del
// preapproval_plan creado en Mercado Pago (Fase 0); se siembra con seed-plans.
export const subscriptionPlans = pgTable('subscription_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  tier: text('tier').notNull(), // 'pro' | 'max'
  billing: text('billing').notNull(), // 'monthly' | 'annual'
  price: numeric('price', { precision: 10, scale: 2 }).notNull(),
  mpPlanId: text('mp_plan_id').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// Suscripción de cada usuario. Nace 'pending' al crear el preapproval y pasa a
// 'authorized' | 'paused' | 'cancelled' cuando llega el webhook de MP.
export const userSubscriptions = pgTable('user_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  planId: uuid('plan_id').references(() => subscriptionPlans.id),
  tier: text('tier').notNull().default('free'),
  billing: text('billing'), // 'monthly' | 'annual'
  mpPreapprovalId: text('mp_preapproval_id'),
  status: text('status').notNull().default('pending'),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  userIdx: index('user_subscriptions_user_id_idx').on(t.userId),
  preapprovalIdx: index('user_subscriptions_preapproval_idx').on(t.mpPreapprovalId),
}));

// Log crudo de cada notificación recibida por el webhook, para auditoría y
// para re-procesar pagos si algo falla.
export const paymentEvents = pgTable('payment_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  mpPaymentId: text('mp_payment_id'),
  mpPreapprovalId: text('mp_preapproval_id'),
  amount: numeric('amount', { precision: 10, scale: 2 }),
  currency: text('currency').default('PEN'),
  status: text('status'),
  rawPayload: jsonb('raw_payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// Consejos semanales generados por Claude para usuarios Max (cron de los lunes).
export const lucasInsights = pgTable('lucas_insights', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tips: jsonb('tips').notNull(), // string[]
  weekOf: timestamp('week_of', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  userIdx: index('lucas_insights_user_id_idx').on(t.userId),
}));
