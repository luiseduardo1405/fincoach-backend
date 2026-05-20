import { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';

type PatchBody = {
  name?: string;
  business?: string;
  category?: string;
  capital?: number;
};

export const profileRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.patch<{ Body: PatchBody }>(
    '/',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1 },
            business: { type: 'string', minLength: 1 },
            category: { type: 'string', minLength: 1 },
            capital: { type: 'number', minimum: 0 },
          },
        },
      },
    },
    async (req) => {
      const { name, business, category, capital } = req.body;
      const updates: Partial<typeof users.$inferInsert> = {};
      if (name !== undefined) updates.name = name;
      if (business !== undefined) updates.business = business;
      if (category !== undefined) updates.category = category;
      if (capital !== undefined) updates.capital = capital;

      const [user] = await db
        .update(users)
        .set(updates)
        .where(eq(users.id, req.user.sub))
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
          business: users.business,
          category: users.category,
          capital: users.capital,
        });
      return user;
    },
  );
};
