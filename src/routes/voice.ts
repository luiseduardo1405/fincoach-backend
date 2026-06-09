import { FastifyPluginAsync } from 'fastify';
import multipart from '@fastify/multipart';
import Groq, { toFile } from 'groq-sdk';
import { db } from '../db';
import { transactions, fiados } from '../db/schema';
import { env } from '../env';
import { parseVoiceCommand } from '../lib/voice-parser';

const groq = new Groq({ apiKey: env.GROQ_API_KEY });

const TYPE_LABELS: Record<string, string> = {
  venta: 'Venta registrada',
  gasto: 'Gasto registrado',
  casa: 'Retiro para casa registrado',
  mercaderia: 'Compra de mercadería registrada',
  gasto_casa: 'Gasto del hogar registrado',
  fiado: 'Fiado registrado',
};

async function saveIntent(
  userId: string,
  intent: ReturnType<typeof parseVoiceCommand>,
): Promise<{ saved: Record<string, unknown>; confirmation: string }> {
  if (intent.type === 'fiado') {
    const [fiado] = await db
      .insert(fiados)
      .values({
        userId,
        person: intent.person ?? 'Persona desconocida',
        amount: intent.amount,
        product: intent.item ?? null,
        timestamp: new Date(),
      })
      .returning();

    return {
      saved: fiado,
      confirmation: `Fiado registrado: S/${intent.amount} a ${fiado.person}${intent.item ? ` — ${intent.item}` : ''}`,
    };
  }

  const [tx] = await db
    .insert(transactions)
    .values({
      userId,
      type: intent.type,
      amount: intent.amount,
      note: intent.item ?? null,
      category: intent.category ?? null,
      occurredAt: new Date(),
    })
    .returning();

  const label = TYPE_LABELS[intent.type] ?? 'Registrado';
  return {
    saved: tx,
    confirmation: `${label}: S/${intent.amount}${intent.item ? ` — ${intent.item}` : ''}`,
  };
}

// Voice endpoints call Groq (paid API). Strict rate limit prevents key abuse.
const voiceRateLimit = {
  config: {
    rateLimit: {
      max: 30,
      timeWindow: '1 minute',
      errorResponseBuilder: () => ({
        error: 'Límite de comandos de voz alcanzado. Espera un momento.',
      }),
    },
  },
};

export const voiceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  // POST /voice/command
  // Recibe audio (multipart, campo "audio"), transcribe con Groq (Whisper) y parsea localmente.
  fastify.post('/command', { preHandler: [fastify.authenticate], ...voiceRateLimit }, async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.status(400).send({ error: 'No se recibió archivo de audio' });

    const chunks: Buffer[] = [];
    for await (const chunk of data.file) chunks.push(chunk);
    const audioBuffer = Buffer.concat(chunks);

    if (audioBuffer.length === 0) {
      return reply.status(400).send({ error: 'El archivo de audio está vacío' });
    }

    let transcription: string;
    try {
      const transcript = await groq.audio.transcriptions.create({
        file: await toFile(audioBuffer, data.filename || 'audio.m4a'),
        model: 'whisper-large-v3-turbo',
        language: 'es',
      });

      if (!transcript.text?.trim()) {
        return reply.status(422).send({ error: 'No se pudo transcribir el audio. Hablá más claro o acercá el micrófono.' });
      }
      transcription = transcript.text.trim();
    } catch {
      return reply.status(502).send({ error: 'Error al conectar con el servicio de transcripción' });
    }

    const intent = parseVoiceCommand(transcription);

    if (intent.type === 'unknown' || intent.confidence === 'low' || intent.amount <= 0) {
      return reply.status(422).send({
        error: 'No entendí bien el comando. Intentá ser más específico, por ejemplo: "vendí 50 soles en pollos".',
        transcription,
        intent,
      });
    }

    const { saved, confirmation } = await saveIntent(req.user.sub, intent);
    return { transcription, intent, saved, confirmation };
  });

  // POST /voice/transcribe
  // Recibe audio (multipart, campo "audio") y devuelve SOLO la transcripción.
  // No parsea ni guarda nada: la app sigue siendo la fuente de verdad y hace su
  // parsing + guardado local. Se usa como RESPALDO del reconocimiento on-device
  // (Vosk/Google) cuando este falla y hay conexión.
  fastify.post('/transcribe', { preHandler: [fastify.authenticate], ...voiceRateLimit }, async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.status(400).send({ error: 'No se recibió archivo de audio' });

    const chunks: Buffer[] = [];
    for await (const chunk of data.file) chunks.push(chunk);
    const audioBuffer = Buffer.concat(chunks);

    if (audioBuffer.length === 0) {
      return reply.status(400).send({ error: 'El archivo de audio está vacío' });
    }

    try {
      const transcript = await groq.audio.transcriptions.create({
        file: await toFile(audioBuffer, data.filename || 'audio.wav'),
        model: 'whisper-large-v3-turbo',
        language: 'es',
      });
      const text = transcript.text?.trim() ?? '';
      if (!text) {
        return reply.status(422).send({ error: 'No se pudo transcribir el audio.' });
      }
      return { text };
    } catch {
      return reply.status(502).send({ error: 'Error al conectar con el servicio de transcripción' });
    }
  });

  // POST /voice/parse-text
  // Recibe texto ya transcrito (desde expo-speech-recognition). No consume Groq.
  fastify.post<{ Body: { text: string } }>(
    '/parse-text',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['text'],
          properties: { text: { type: 'string', minLength: 1, maxLength: 500 } },
        },
      },
      ...voiceRateLimit,
    },
    async (req, reply) => {
      const transcription = req.body.text.trim();
      const intent = parseVoiceCommand(transcription);

      if (intent.type === 'unknown' || intent.confidence === 'low' || intent.amount <= 0) {
        return reply.status(422).send({
          error: 'No entendí bien el comando. Intentá ser más específico.',
          transcription,
          intent,
        });
      }

      const { saved, confirmation } = await saveIntent(req.user.sub, intent);
      return { transcription, intent, saved, confirmation };
    },
  );
};
