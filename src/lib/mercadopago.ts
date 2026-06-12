import { mpAccessToken } from '../env';

// Cliente mínimo de la API de Mercado Pago para suscripciones (preapproval).
// Se usa fetch directo (sin SDK) porque solo necesitamos 3 operaciones y así
// evitamos otra dependencia. Token TEST/PROD según NODE_ENV (ver env.ts).

const MP_API = 'https://api.mercadopago.com';

// MP exige que back_url sea https (rechaza schemes como lucas://), así que
// apunta a /subscriptions/return en este backend, que redirige 302 al deep
// link de la app. APP_DEEP_LINK debe coincidir con el "scheme" del app.json.
export const APP_DEEP_LINK = 'lucas://subscription/result';
export const MP_BACK_URL = 'https://fincoach-backend-iavi.onrender.com/subscriptions/return';

export type MpPreapproval = {
  id?: string;
  status?: string; // 'pending' | 'authorized' | 'paused' | 'cancelled'
  init_point?: string;
  payer_email?: string;
  message?: string; // presente en respuestas de error
};

export function isMpConfigured(): boolean {
  return mpAccessToken() !== '';
}

async function mpFetch(path: string, init?: RequestInit): Promise<MpPreapproval> {
  const res = await fetch(`${MP_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${mpAccessToken()}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  return (await res.json()) as MpPreapproval;
}

/**
 * Crea la suscripción (preapproval) en estado pendiente y devuelve el
 * init_point de checkout. Se usa auto_recurring inline en vez de
 * preapproval_plan_id: con plan asociado MP exige card_token_id (espera que
 * la tarjeta ya esté capturada), mientras que el flujo "pendiente" redirige
 * al payer al checkout de MP. payer_email es obligatorio en este flujo.
 */
export function createPreapproval(opts: {
  reason: string;
  amount: number; // en PEN
  frequencyMonths: 1 | 12;
  payerEmail: string;
}): Promise<MpPreapproval> {
  return mpFetch('/preapproval', {
    method: 'POST',
    body: JSON.stringify({
      reason: opts.reason,
      auto_recurring: {
        frequency: opts.frequencyMonths,
        frequency_type: 'months',
        transaction_amount: opts.amount,
        currency_id: 'PEN',
      },
      back_url: MP_BACK_URL,
      payer_email: opts.payerEmail,
      status: 'pending',
    }),
  });
}

/** Consulta el estado real de una suscripción (nunca confiar solo en el webhook). */
export function fetchPreapproval(preapprovalId: string): Promise<MpPreapproval> {
  return mpFetch(`/preapproval/${preapprovalId}`);
}

/** Cancela la suscripción en MP. */
export function cancelPreapproval(preapprovalId: string): Promise<MpPreapproval> {
  return mpFetch(`/preapproval/${preapprovalId}`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'cancelled' }),
  });
}
