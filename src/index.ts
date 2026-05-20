import './types';
import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import fjwt from '@fastify/jwt';
import cors from '@fastify/cors';
import { env } from './env';
import { authRoutes } from './routes/auth';
import { profileRoutes } from './routes/profile';
import { transactionRoutes } from './routes/transactions';
import { balanceRoutes } from './routes/balance';

const app = Fastify({
  logger: {
    level: env.NODE_ENV === 'production' ? 'warn' : 'info',
  },
});

app.register(cors, { origin: true });
app.register(fjwt, { secret: env.JWT_SECRET });

app.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.send(err);
  }
});

app.register(authRoutes, { prefix: '/auth' });
app.register(profileRoutes, { prefix: '/profile' });
app.register(transactionRoutes, { prefix: '/transactions' });
app.register(balanceRoutes, { prefix: '/balance' });

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
