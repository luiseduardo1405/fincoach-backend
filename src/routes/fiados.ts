import { FastifyPluginAsync } from 'fastify';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db';
import { fiados, transactions } from '../db/schema';

type CreateBody = { person: string; amount: number; product?: string; timestamp?: string };
type PaidBody = { createTransaction?: boolean };
type UpdateBody = { person?: string; amount?: number; product?: string };

export const fiadoRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (req) => {
    const rows = await db
      .select()
      .from(fiados)
      .where(eq(fiados.userId, req.user.sub))
      .orderBy(desc(fiados.timestamp));
    return { items: rows };
  });

  fastify.post<{ Body: CreateBody }>(
    '/',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['person', 'amount'],
          properties: {
            person: { type: 'string', minLength: 1 },
            amount: { type: 'number', exclusiveMinimum: 0 },
            product: { type: 'string' },
            timestamp: { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      const { person, amount, product, timestamp } = req.body;
      const [fiado] = await db
        .insert(fiados)
        .values({
          userId: req.user.sub,
          person,
          amount,
          product: product ?? null,
          timestamp: timestamp ? new Date(timestamp) : new Date(),
        })
        .returning();
      return reply.status(201).send(fiado);
    },
  );

  fastify.patch<{ Params: { id: string }; Body: PaidBody }>(
    '/:id/paid',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          properties: {
            createTransaction: { type: 'boolean' },
          },
        },
      },
    },
    async (req, reply) => {
      const [fiado] = await db
        .update(fiados)
        .set({ paid: true, paidAt: new Date() })
        .where(and(eq(fiados.id, req.params.id), eq(fiados.userId, req.user.sub)))
        .returning();

      if (!fiado) return reply.status(404).send({ error: 'Fiado no encontrado' });

      if (req.body?.createTransaction) {
        const noteText = fiado.product
          ? `Cobro fiado: ${fiado.person} - ${fiado.product}`
          : `Cobro fiado: ${fiado.person}`;
        await db.insert(transactions).values({
          userId: req.user.sub,
          type: 'venta',
          amount: fiado.amount,
          note: noteText,
          occurredAt: new Date(),
        });
      }

      return fiado;
    },
  );

  // Correct a mis-entered fiado (wrong name / amount / product). Used by the
  // app's edit sheet; only the provided fields change.
  fastify.patch<{ Params: { id: string }; Body: UpdateBody }>(
    '/:id',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          properties: {
            person: { type: 'string', minLength: 1 },
            amount: { type: 'number', exclusiveMinimum: 0 },
            product: { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      const { person, amount, product } = req.body;
      const updates: Record<string, unknown> = {};
      if (person !== undefined) updates.person = person;
      if (amount !== undefined) updates.amount = amount;
      if (product !== undefined) updates.product = product;
      if (Object.keys(updates).length === 0) {
        return reply.status(400).send({ error: 'Nada para actualizar' });
      }

      const [fiado] = await db
        .update(fiados)
        .set(updates)
        .where(and(eq(fiados.id, req.params.id), eq(fiados.userId, req.user.sub)))
        .returning();

      if (!fiado) return reply.status(404).send({ error: 'Fiado no encontrado' });
      return fiado;
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const deleted = await db
        .delete(fiados)
        .where(and(eq(fiados.id, req.params.id), eq(fiados.userId, req.user.sub)))
        .returning({ id: fiados.id });

      if (deleted.length === 0) return reply.status(404).send({ error: 'Fiado no encontrado' });
      return { success: true };
    },
  );
};
