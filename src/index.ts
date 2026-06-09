import './types';
import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import fjwt from '@fastify/jwt';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { env } from './env';
import { authRoutes } from './routes/auth';
import { profileRoutes } from './routes/profile';
import { transactionRoutes } from './routes/transactions';
import { balanceRoutes } from './routes/balance';
import { fiadoRoutes } from './routes/fiados';
import { reportRoutes } from './routes/reports';
import { voiceRoutes } from './routes/voice';

const app = Fastify({
  logger: {
    level: env.NODE_ENV === 'production' ? 'warn' : 'info',
  },
});

// Security headers (HSTS, X-Content-Type-Options, X-Frame-Options, etc.)
app.register(helmet);

// Global rate limit: max 200 req/min per IP as a baseline backstop.
// Sensitive routes (auth, voice) override this with stricter limits below.
app.register(rateLimit, {
  global: true,
  max: 200,
  timeWindow: '1 minute',
  errorResponseBuilder: () => ({
    error: 'Demasiadas solicitudes. Espera un momento e intenta de nuevo.',
  }),
});

// Mobile-only API: allow all origins (React Native bypasses CORS anyway).
// Restrict methods and headers to limit the attack surface.
app.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

app.register(fjwt, { secret: env.JWT_SECRET });

app.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.send(err);
  }
});

app.get('/health', () => ({ status: 'ok', version: '1.0.0' }));

if (process.env.REQUEST_LOG !== 'false') {
  app.addHook('onResponse', async (request, reply) => {
    console.log(`[req] ${request.method} ${request.url} → ${reply.statusCode}`);
  });
}

app.register(authRoutes, { prefix: '/auth' });
app.register(profileRoutes, { prefix: '/profile' });
app.register(transactionRoutes, { prefix: '/transactions' });
app.register(balanceRoutes, { prefix: '/balance' });
app.register(fiadoRoutes, { prefix: '/fiados' });
app.register(reportRoutes, { prefix: '/reports' });
app.register(voiceRoutes, { prefix: '/voice' });

const start = async () => {
  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    app.log.info(`Server running on port ${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
