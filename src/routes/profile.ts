import { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';

type PatchBody = {
  name?: string;
  business?: string;
  category?: string;
  capital?: number;
  city?: string;
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
            city: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (req) => {
      const { name, business, category, capital, city } = req.body;
      const updates: Partial<typeof users.$inferInsert> = {};
      if (name !== undefined) updates.name = name;
      if (business !== undefined) updates.business = business;
      if (category !== undefined) updates.category = category;
      if (capital !== undefined) updates.capital = capital;
      if (city !== undefined) updates.city = city;

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
          city: users.city,
        });
      return user;
    },
  );
};
