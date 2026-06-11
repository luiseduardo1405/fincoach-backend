import 'dotenv/config';

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing env var: ${name}`);
  return val;
}

export const env = {
  DATABASE_URL: required('DATABASE_URL'),
  JWT_SECRET: required('JWT_SECRET'),
  GROQ_API_KEY: required('GROQ_API_KEY'),
  PORT: Number(process.env.PORT ?? 3000),
  NODE_ENV: process.env.NODE_ENV ?? 'development',

  // ── Mercado Pago (opcionales: las rutas de suscripción responden 503 hasta
  // que se configuren, sin impedir que el resto del backend arranque) ──────────
  MP_ACCESS_TOKEN_TEST: process.env.MP_ACCESS_TOKEN_TEST ?? '',
  MP_ACCESS_TOKEN_PROD: process.env.MP_ACCESS_TOKEN_PROD ?? '',
  // Secreto propio (lo defines tú) para validar que los webhooks vienen de MP:
  // se registra la URL del webhook con ?secret=... y aquí se compara.
  MP_WEBHOOK_SECRET: process.env.MP_WEBHOOK_SECRET ?? '',

  // ── Anthropic (opcional: el cron de consejos Max solo arranca si existe) ────
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
};

/** Token de MP según ambiente. Vacío si aún no está configurado. */
export function mpAccessToken(): string {
  return env.NODE_ENV === 'production' ? env.MP_ACCESS_TOKEN_PROD : env.MP_ACCESS_TOKEN_TEST;
}
