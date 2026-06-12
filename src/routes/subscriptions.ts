import { FastifyPluginAsync } from 'fastify';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db';
import { subscriptionPlans, userSubscriptions, users, lucasInsights } from '../db/schema';
import { createPreapproval, cancelPreapproval, isMpConfigured, APP_DEEP_LINK } from '../lib/mercadopago';

type CreateBody = { tier: 'pro' | 'max'; billing: 'monthly' | 'annual' };

export const subscriptionRoutes: FastifyPluginAsync = async (fastify) => {
  // Puente de retorno del checkout: MP solo acepta back_url https, así que
  // redirige aquí y nosotros reenviamos al deep link de la app conservando
  // los query params que agrega MP (preapproval_id, status, etc.).
  fastify.get('/return', async (req, reply) => {
    const qs = req.raw.url?.split('?')[1];
    return reply.redirect(`${APP_DEEP_LINK}${qs ? `?${qs}` : ''}`, 302);
  });

  // Catálogo de planes activos (público: la pantalla de planes lo muestra
  // antes de que exista sesión de pago).
  fastify.get('/plans', { preHandler: [fastify.authenticate] }, async () => {
    const rows = await db
      .select({
        id: subscriptionPlans.id,
        tier: subscriptionPlans.tier,
        billing: subscriptionPlans.billing,
        price: subscriptionPlans.price,
      })
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.isActive, true));
    return { items: rows };
  });

  // Inicia el flujo de pago: crea el preapproval en MP y devuelve el initPoint
  // (URL de checkout) que el app abre en el navegador.
  fastify.post<{ Body: CreateBody }>(
    '/create',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['tier', 'billing'],
          properties: {
            tier: { type: 'string', enum: ['pro', 'max'] },
            billing: { type: 'string', enum: ['monthly', 'annual'] },
          },
        },
      },
    },
    async (req, reply) => {
      if (!isMpConfigured()) {
        return reply.status(503).send({ error: 'Pagos aún no disponibles' });
      }
      const { tier, billing } = req.body;

      const [plan] = await db
        .select()
        .from(subscriptionPlans)
        .where(and(
          eq(subscriptionPlans.tier, tier),
          eq(subscriptionPlans.billing, billing),
          eq(subscriptionPlans.isActive, true),
        ))
        .limit(1);
      if (!plan) return reply.status(404).send({ error: 'Plan no encontrado' });

      const preapproval = await createPreapproval({
        reason: `Lucas ${tier === 'max' ? 'Max' : 'Pro'} - ${billing === 'annual' ? 'Anual' : 'Mensual'}`,
        amount: Number(plan.price),
        frequencyMonths: billing === 'annual' ? 12 : 1,
        payerEmail: req.user.email,
      });
      if (!preapproval.id || !preapproval.init_point) {
        fastify.log.error({ preapproval }, 'MP preapproval creation failed');
        return reply.status(502).send({ error: 'No se pudo iniciar el pago en Mercado Pago' });
      }

      await db.insert(userSubscriptions).values({
        userId: req.user.sub,
        planId: plan.id,
        tier,
        billing,
        mpPreapprovalId: preapproval.id,
        status: 'pending',
      });

      return { initPoint: preapproval.init_point };
    },
  );

  // Estado actual: el app lo consulta tras volver del checkout (el webhook
  // puede tardar unos segundos) y en cada arranque para refrescar el tier.
  fastify.get('/status', { preHandler: [fastify.authenticate] }, async (req) => {
    const [sub] = await db
      .select()
      .from(userSubscriptions)
      .where(and(
        eq(userSubscriptions.userId, req.user.sub),
        eq(userSubscriptions.status, 'authorized'),
      ))
      .orderBy(desc(userSubscriptions.createdAt))
      .limit(1);

    if (!sub) return { tier: 'free', billing: null, status: 'inactive', expiresAt: null };
    return {
      tier: sub.tier,
      billing: sub.billing,
      status: sub.status,
      expiresAt: sub.currentPeriodEnd,
    };
  });

  // Cancela la suscripción activa (en MP y en la BD). El usuario vuelve a free.
  fastify.delete('/cancel', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    if (!isMpConfigured()) {
      return reply.status(503).send({ error: 'Pagos aún no disponibles' });
    }
    const [sub] = await db
      .select()
      .from(userSubscriptions)
      .where(and(
        eq(userSubscriptions.userId, req.user.sub),
        eq(userSubscriptions.status, 'authorized'),
      ))
      .orderBy(desc(userSubscriptions.createdAt))
      .limit(1);
    if (!sub || !sub.mpPreapprovalId) {
      return reply.status(404).send({ error: 'No hay suscripción activa' });
    }

    const result = await cancelPreapproval(sub.mpPreapprovalId);
    if (result.status !== 'cancelled') {
      fastify.log.error({ result }, 'MP preapproval cancellation failed');
      return reply.status(502).send({ error: 'No se pudo cancelar en Mercado Pago' });
    }

    const now = new Date();
    await db
      .update(userSubscriptions)
      .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
      .where(eq(userSubscriptions.id, sub.id));
    await db.update(users).set({ subscriptionTier: 'free' }).where(eq(users.id, req.user.sub));

    return { success: true };
  });

  // Últimos consejos semanales de Lucas (solo Max; los genera el cron).
  fastify.get('/insights', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const [user] = await db
      .select({ tier: users.subscriptionTier })
      .from(users)
      .where(eq(users.id, req.user.sub))
      .limit(1);
    if (!user || user.tier !== 'max') {
      return reply.status(403).send({ error: 'Disponible solo en el plan Max' });
    }

    const [latest] = await db
      .select()
      .from(lucasInsights)
      .where(eq(lucasInsights.userId, req.user.sub))
      .orderBy(desc(lucasInsights.weekOf))
      .limit(1);

    return { tips: (latest?.tips as string[]) ?? [], weekOf: latest?.weekOf ?? null };
  });
};
