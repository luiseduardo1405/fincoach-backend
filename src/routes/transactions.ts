import { FastifyPluginAsync } from 'fastify';
import { eq, and, desc, gte, lte, inArray, isNotNull } from 'drizzle-orm';
import { db } from '../db';
import { transactions } from '../db/schema';

const VALID_TYPES = ['venta', 'gasto', 'casa', 'mercaderia', 'gasto_casa'] as const;
type EntryType = (typeof VALID_TYPES)[number];

type CreateBody = { type: EntryType; amount: number; note?: string; category?: string; occurredAt?: string };
type UpdateBody = { note?: string; category?: string };
type ListQuery = { page?: number; limit?: number; type?: string; from?: string; to?: string };

export const transactionRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: ListQuery }>(
    '/',
    {
      preHandler: [fastify.authenticate],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            type: { type: 'string' },
            from: { type: 'string' },
            to: { type: 'string' },
          },
        },
      },
    },
    async (req) => {
      const { page = 1, limit = 50, type, from, to } = req.query;
      const userId = req.user.sub;

      const conditions = [eq(transactions.userId, userId)];

      if (type) {
        const types = type.split(',').filter((t): t is EntryType => (VALID_TYPES as readonly string[]).includes(t));
        if (types.length > 0) conditions.push(inArray(transactions.type, types));
      }
      if (from) conditions.push(gte(transactions.occurredAt, new Date(from)));
      if (to) conditions.push(lte(transactions.occurredAt, new Date(to)));

      const rows = await db
        .select()
        .from(transactions)
        .where(and(...conditions))
        .orderBy(desc(transactions.occurredAt))
        .limit(limit)
        .offset((page - 1) * limit);

      return { items: rows, page, limit };
    },
  );

  fastify.post<{ Body: CreateBody }>(
    '/',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['type', 'amount'],
          properties: {
            type: { type: 'string', enum: VALID_TYPES },
            amount: { type: 'number', exclusiveMinimum: 0 },
            note: { type: 'string' },
            category: { type: 'string' },
            occurredAt: { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      const { type, amount, note, category, occurredAt } = req.body;

      const [tx] = await db
        .insert(transactions)
        .values({
          userId: req.user.sub,
          type,
          amount,
          note: note ?? null,
          category: category ?? null,
          occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
        })
        .returning();

      return reply.status(201).send(tx);
    },
  );

  fastify.put<{ Params: { id: string }; Body: UpdateBody }>(
    '/:id',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          properties: {
            note: { type: 'string' },
            category: { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      const { note, category } = req.body;
      const updates: Record<string, unknown> = {};
      if (note !== undefined) updates.note = note;
      if (category !== undefined) updates.category = category;

      const [tx] = await db
        .update(transactions)
        .set(updates)
        .where(and(eq(transactions.id, req.params.id), eq(transactions.userId, req.user.sub)))
        .returning();

      if (!tx) return reply.status(404).send({ error: 'Transacción no encontrada' });
      return tx;
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const deleted = await db
        .delete(transactions)
        .where(and(eq(transactions.id, req.params.id), eq(transactions.userId, req.user.sub)))
        .returning({ id: transactions.id });

      if (deleted.length === 0) {
        return reply.status(404).send({ error: 'Transacción no encontrada' });
      }
      return { success: true };
    },
  );
};
