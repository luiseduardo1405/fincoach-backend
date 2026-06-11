import { mpAccessToken } from '../env';

// Cliente mínimo de la API de Mercado Pago para suscripciones (preapproval).
// Se usa fetch directo (sin SDK) porque solo necesitamos 3 operaciones y así
// evitamos otra dependencia. Token TEST/PROD según NODE_ENV (ver env.ts).

const MP_API = 'https://api.mercadopago.com';

// Deep link al que MP redirige al usuario al terminar el checkout. Debe
// coincidir con el "scheme" del app.json del frontend ("lucas").
export const MP_BACK_URL = 'lucas://subscription/result';

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

/** Crea la suscripción (preapproval) sobre un plan ya creado en MP. */
export function createPreapproval(mpPlanId: string, payerEmail?: string): Promise<MpPreapproval> {
  return mpFetch('/preapproval', {
    method: 'POST',
    body: JSON.stringify({
      preapproval_plan_id: mpPlanId,
      back_url: MP_BACK_URL,
      ...(payerEmail ? { payer_email: payerEmail } : {}),
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
