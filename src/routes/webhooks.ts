import { FastifyPluginAsync } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { userSubscriptions, paymentEvents, users } from '../db/schema';
import { fetchPreapproval } from '../lib/mercadopago';
import { env } from '../env';

type MpNotification = {
  type?: string;
  action?: string;
  data?: { id?: string };
};

function secretMatches(provided: string): boolean {
  if (!env.MP_WEBHOOK_SECRET) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(env.MP_WEBHOOK_SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const webhookRoutes: FastifyPluginAsync = async (fastify) => {
  // Notificaciones de Mercado Pago. MP no firma sus webhooks como Stripe, así
  // que la URL se registra con ?secret=MP_WEBHOOK_SECRET y aquí se valida.
  // Siempre respondemos 200 una vez autenticado: cualquier otro código hace
  // que MP reintente indefinidamente.
  fastify.post<{ Querystring: { secret?: string } }>(
    '/mercadopago',
    async (req, reply) => {
      if (!secretMatches(req.query.secret ?? '')) {
        return reply.status(401).send({ error: 'No autorizado' });
      }

      const body = (req.body ?? {}) as MpNotification;
      const preapprovalId = body.data?.id;

      try {
        if (body.type === 'subscription_preapproval' && preapprovalId) {
          // Consulta el estado real en MP — nunca confiar solo en el payload.
          const preapproval = await fetchPreapproval(preapprovalId);

          const [sub] = await db
            .select()
            .from(userSubscriptions)
            .where(eq(userSubscriptions.mpPreapprovalId, preapprovalId))
            .limit(1);

          if (sub && preapproval.status) {
            const now = new Date();
            const periodEnd = new Date(now);
            if (sub.billing === 'annual') periodEnd.setFullYear(periodEnd.getFullYear() + 1);
            else periodEnd.setMonth(periodEnd.getMonth() + 1);

            await db
              .update(userSubscriptions)
              .set({
                status: preapproval.status,
                ...(preapproval.status === 'authorized'
                  ? { currentPeriodStart: now, currentPeriodEnd: periodEnd }
                  : {}),
                ...(preapproval.status === 'cancelled' ? { cancelledAt: now } : {}),
                updatedAt: now,
              })
              .where(eq(userSubscriptions.id, sub.id));

            // El tier del usuario sigue el estado del preapproval: autorizado →
            // sube al plan pagado; cancelado/pausado → vuelve a free.
            const newTier = preapproval.status === 'authorized' ? sub.tier : 'free';
            await db.update(users).set({ subscriptionTier: newTier }).where(eq(users.id, sub.userId));
          }

          await db.insert(paymentEvents).values({
            userId: sub?.userId ?? null,
            mpPreapprovalId: preapprovalId,
            status: preapproval.status ?? body.type,
            rawPayload: body,
          });
        } else {
          // Otros eventos (payment, plan, etc.): solo se registran para auditoría.
          await db.insert(paymentEvents).values({
            mpPreapprovalId: preapprovalId ?? null,
            status: body.type ?? body.action ?? 'unknown',
            rawPayload: body,
          });
        }
      } catch (err) {
        // Loguear pero responder 200 igual: el evento quedó (o quedará) en
        // payment_events y un fallo transitorio no debe disparar la tormenta
        // de reintentos de MP.
        fastify.log.error({ err }, 'mercadopago webhook processing failed');
      }

      return reply.status(200).send({ ok: true });
    },
  );
};
