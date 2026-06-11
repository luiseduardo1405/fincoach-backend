import Anthropic from '@anthropic-ai/sdk';
import cron from 'node-cron';
import { eq, and, gte } from 'drizzle-orm';
import { db } from '../db';
import { transactions, userSubscriptions, lucasInsights } from '../db/schema';
import { env } from '../env';

// Consejo semanal de Lucas (plan Max): cada lunes 6am hora Perú (11:00 UTC) se
// analizan los últimos 14 días de movimientos de cada usuario Max y Claude
// genera 3 observaciones en lenguaje simple, que el app lee de lucas_insights
// vía GET /subscriptions/insights.

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

// El plan original referenciaba claude-sonnet-4-20250514, que está deprecado
// (se retira el 15/06/2026); claude-sonnet-4-6 es su reemplazo directo.
const MODEL = 'claude-sonnet-4-6';

const TIPS_SCHEMA = {
  type: 'object',
  properties: {
    tips: {
      type: 'array',
      items: { type: 'string' },
      description: 'Exactamente 3 observaciones útiles, máx. 2 líneas cada una',
    },
  },
  required: ['tips'],
  additionalProperties: false,
} as const;

type TxRow = typeof transactions.$inferSelect;

// Resumen compacto por tipo + por categoría: suficiente señal para 3 tips sin
// mandar las transacciones crudas (menos tokens, sin notas con datos personales).
function buildSummary(rows: TxRow[]) {
  const byType: Record<string, { count: number; total: number }> = {};
  const byCategory: Record<string, { count: number; total: number }> = {};
  for (const t of rows) {
    const amount = Number(t.amount) || 0;
    (byType[t.type] ??= { count: 0, total: 0 });
    byType[t.type].count += 1;
    byType[t.type].total += amount;
    if (t.category) {
      (byCategory[t.category] ??= { count: 0, total: 0 });
      byCategory[t.category].count += 1;
      byCategory[t.category].total += amount;
    }
  }
  return { periodo: 'últimos 14 días', moneda: 'PEN', porTipo: byType, porCategoria: byCategory };
}

export async function generateLucasAdvice(userId: string): Promise<string[] | null> {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.userId, userId), gte(transactions.occurredAt, since)))
    .limit(200);

  if (rows.length < 3) return null; // sin datos suficientes no hay consejo útil

  const summary = buildSummary(rows);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    thinking: { type: 'disabled' },
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: TIPS_SCHEMA },
    },
    system:
      'Eres Lucas, asesor financiero amigable para vendedores informales peruanos. ' +
      'Hablas en lenguaje simple, sin tecnicismos, en segunda persona ("tu negocio"). ' +
      'Tipos de movimiento: venta=ingreso, gasto=gasto del negocio, mercaderia=compra de stock, ' +
      'casa/gasto_casa=retiros para gastos del hogar.',
    messages: [
      {
        role: 'user',
        content:
          'Analiza este resumen de los últimos 14 días del negocio y genera exactamente 3 ' +
          'observaciones útiles y accionables (máximo 2 líneas cada una):\n\n' +
          JSON.stringify(summary, null, 2),
      },
    ],
  });

  if (response.stop_reason === 'refusal') return null;
  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') return null;

  const { tips } = JSON.parse(block.text) as { tips: string[] };
  return Array.isArray(tips) && tips.length > 0 ? tips.slice(0, 3) : null;
}

async function runWeeklyAdvice(log: (msg: string) => void): Promise<void> {
  // Solo usuarios con plan Max activo.
  const maxUsers = await db
    .selectDistinct({ userId: userSubscriptions.userId })
    .from(userSubscriptions)
    .where(and(eq(userSubscriptions.tier, 'max'), eq(userSubscriptions.status, 'authorized')));

  log(`[Lucas Job] generando consejos para ${maxUsers.length} usuarios Max`);

  for (const { userId } of maxUsers) {
    try {
      const tips = await generateLucasAdvice(userId);
      if (tips) {
        await db.insert(lucasInsights).values({ userId, tips, weekOf: new Date() });
      }
    } catch (err) {
      // Un usuario fallido (rate limit, datos raros) no debe frenar al resto.
      log(`[Lucas Job] fallo para ${userId}: ${(err as Error).message}`);
    }
  }

  log('[Lucas Job] listo');
}

/** Programa el job semanal. No-op si ANTHROPIC_API_KEY no está configurada. */
export function startLucasAdviceJob(log: (msg: string) => void = console.log): void {
  if (!env.ANTHROPIC_API_KEY) {
    log('[Lucas Job] ANTHROPIC_API_KEY no configurada — cron de consejos desactivado');
    return;
  }
  // Lunes 11:00 UTC = 6:00 am hora Perú (UTC-5, sin horario de verano).
  cron.schedule('0 11 * * 1', () => {
    void runWeeklyAdvice(log).catch((err) =>
      log(`[Lucas Job] error general: ${(err as Error).message}`),
    );
  });
  log('[Lucas Job] programado: lunes 6:00 am (Perú)');
}
