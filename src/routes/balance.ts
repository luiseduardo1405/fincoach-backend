import { FastifyPluginAsync } from 'fastify';
import { eq, and, gte, sql } from 'drizzle-orm';
import { db } from '../db';
import { transactions, users } from '../db/schema';
import { computeScore } from '../lib/score';

export const balanceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (req) => {
    const userId = req.user.sub;

    const [userData] = await db.select({ capital: users.capital }).from(users).where(eq(users.id, userId)).limit(1);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayISO = todayStart.toISOString();

    const [agg] = await db
      .select({
        totalVenta: sql<number>`COALESCE(SUM(CASE WHEN type = 'venta' THEN amount ELSE 0 END), 0)`,
        totalGasto: sql<number>`COALESCE(SUM(CASE WHEN type = 'gasto' THEN amount ELSE 0 END), 0)`,
        totalCasa: sql<number>`COALESCE(SUM(CASE WHEN type = 'casa' THEN amount ELSE 0 END), 0)`,
        totalMercaderia: sql<number>`COALESCE(SUM(CASE WHEN type = 'mercaderia' THEN amount ELSE 0 END), 0)`,
        salesToday: sql<number>`COALESCE(SUM(CASE WHEN type = 'venta' AND occurred_at >= ${todayISO}::timestamptz THEN amount ELSE 0 END), 0)`,
      })
      .from(transactions)
      .where(eq(transactions.userId, userId));

    const capital = Number(userData?.capital ?? 0);
    const business =
      capital +
      Number(agg.totalVenta) -
      Number(agg.totalGasto) -
      Number(agg.totalCasa) -
      Number(agg.totalMercaderia);

    return {
      business,
      household: Number(agg.totalCasa),
      profit: Number(agg.totalVenta) - Number(agg.totalGasto),
      salesToday: Number(agg.salesToday),
    };
  });

  fastify.get('/score', { preHandler: [fastify.authenticate] }, async (req) => {
    const txs = await db
      .select({ type: transactions.type, occurredAt: transactions.occurredAt })
      .from(transactions)
      .where(eq(transactions.userId, req.user.sub));

    return computeScore(txs as { type: string; occurredAt: Date }[]);
  });
};
