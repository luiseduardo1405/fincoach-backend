import { FastifyPluginAsync } from 'fastify';
import { eq, and, gte, lt, sql, isNotNull } from 'drizzle-orm';
import { db } from '../db';
import { transactions } from '../db/schema';

type MonthlyQuery = { month?: string };

export const reportRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: MonthlyQuery }>(
    '/monthly',
    {
      preHandler: [fastify.authenticate],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            month: { type: 'string' }, // YYYY-MM
          },
        },
      },
    },
    async (req, reply) => {
      const userId = req.user.sub;
      const monthStr = req.query.month ?? new Date().toISOString().slice(0, 7);

      if (!/^\d{4}-\d{2}$/.test(monthStr)) {
        return reply.status(400).send({ error: 'Formato de mes inválido. Use YYYY-MM' });
      }

      const [year, month] = monthStr.split('-').map(Number);
      const from = new Date(year, month - 1, 1);
      const to = new Date(year, month, 1); // exclusive upper bound (first day of next month)

      const rangeCondition = and(
        eq(transactions.userId, userId),
        gte(transactions.occurredAt, from),
        lt(transactions.occurredAt, to),
      );

      const [agg] = await db
        .select({
          income: sql<number>`COALESCE(SUM(CASE WHEN type = 'venta' THEN amount ELSE 0 END), 0)`,
          businessExpenses: sql<number>`COALESCE(SUM(CASE WHEN type = 'gasto' THEN amount ELSE 0 END), 0)`,
          inventorySpend: sql<number>`COALESCE(SUM(CASE WHEN type = 'mercaderia' THEN amount ELSE 0 END), 0)`,
          homeWithdrawn: sql<number>`COALESCE(SUM(CASE WHEN type = 'casa' THEN amount ELSE 0 END), 0)`,
          homeSpent: sql<number>`COALESCE(SUM(CASE WHEN type = 'gasto_casa' THEN amount ELSE 0 END), 0)`,
        })
        .from(transactions)
        .where(rangeCondition);

      const categoryRows = await db
        .select({
          category: transactions.category,
          amount: sql<number>`COALESCE(SUM(amount), 0)`,
        })
        .from(transactions)
        .where(and(rangeCondition, isNotNull(transactions.category)))
        .groupBy(transactions.category);

      const income = Number(agg.income);
      const businessExpenses = Number(agg.businessExpenses);

      return {
        income,
        businessExpenses,
        inventorySpend: Number(agg.inventorySpend),
        profit: income - businessExpenses,
        homeWithdrawn: Number(agg.homeWithdrawn),
        homeSpent: Number(agg.homeSpent),
        categoryBreakdown: categoryRows.map((r) => ({ id: r.category, amount: Number(r.amount) })),
      };
    },
  );
};
