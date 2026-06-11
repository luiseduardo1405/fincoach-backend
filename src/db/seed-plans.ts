import { db } from './index';
import { subscriptionPlans } from './schema';

// Siembra el catálogo de planes con los IDs de preapproval_plan creados en
// Mercado Pago (Fase 0 del plan de integración). Ejecutar UNA vez por ambiente
// después de exportar los 4 MP_PLAN_ID_*:
//
//   npm run db:seed-plans
//
// Es idempotente a nivel práctico: si ya hay planes activos, no inserta nada.

const PLAN_ENV_VARS = [
  { tier: 'pro', billing: 'monthly', price: '7.00', envVar: 'MP_PLAN_ID_PRO_MONTHLY' },
  { tier: 'pro', billing: 'annual', price: '70.00', envVar: 'MP_PLAN_ID_PRO_ANNUAL' },
  { tier: 'max', billing: 'monthly', price: '15.00', envVar: 'MP_PLAN_ID_MAX_MONTHLY' },
  { tier: 'max', billing: 'annual', price: '150.00', envVar: 'MP_PLAN_ID_MAX_ANNUAL' },
] as const;

async function main() {
  const existing = await db.select({ id: subscriptionPlans.id }).from(subscriptionPlans);
  if (existing.length > 0) {
    console.log(`Ya existen ${existing.length} planes — no se inserta nada.`);
    process.exit(0);
  }

  const missing = PLAN_ENV_VARS.filter((p) => !process.env[p.envVar]);
  if (missing.length > 0) {
    console.error(`Faltan variables: ${missing.map((p) => p.envVar).join(', ')}`);
    console.error('Crea los 4 planes en Mercado Pago (Fase 0) y exporta sus IDs primero.');
    process.exit(1);
  }

  await db.insert(subscriptionPlans).values(
    PLAN_ENV_VARS.map((p) => ({
      tier: p.tier,
      billing: p.billing,
      price: p.price,
      mpPlanId: process.env[p.envVar] as string,
    })),
  );
  console.log('4 planes sembrados ✅');
  process.exit(0);
}

void main();
