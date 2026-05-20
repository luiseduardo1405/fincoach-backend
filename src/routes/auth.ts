import { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';

const registerBody = {
  type: 'object',
  required: ['email', 'password', 'name', 'business', 'category', 'capital'],
  properties: {
    email: { type: 'string', format: 'email' },
    password: { type: 'string', minLength: 6 },
    name: { type: 'string', minLength: 1 },
    business: { type: 'string', minLength: 1 },
    category: { type: 'string', minLength: 1 },
    capital: { type: 'number', minimum: 0 },
  },
} as const;

const loginBody = {
  type: 'object',
  required: ['email', 'password'],
  properties: {
    email: { type: 'string' },
    password: { type: 'string' },
  },
} as const;

type RegisterBody = { email: string; password: string; name: string; business: string; category: string; capital: number };
type LoginBody = { email: string; password: string };

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: RegisterBody }>('/register', { schema: { body: registerBody } }, async (req, reply) => {
    const { email, password, name, business, category, capital } = req.body;

    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      return reply.status(409).send({ error: 'Email ya registrado' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [user] = await db.insert(users).values({ email, passwordHash, name, business, category, capital }).returning({
      id: users.id, email: users.email, name: users.name, business: users.business, category: users.category, capital: users.capital,
    });

    const token = fastify.jwt.sign({ sub: user.id, email: user.email });
    return reply.status(201).send({ token, user });
  });

  fastify.post<{ Body: LoginBody }>('/login', { schema: { body: loginBody } }, async (req, reply) => {
    const { email, password } = req.body;

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return reply.status(401).send({ error: 'Credenciales inválidas' });
    }

    const token = fastify.jwt.sign({ sub: user.id, email: user.email });
    return {
      token,
      user: { id: user.id, email: user.email, name: user.name, business: user.business, category: user.category, capital: user.capital },
    };
  });

  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (req) => {
    const [user] = await db.select({
      id: users.id, email: users.email, name: users.name, business: users.business, category: users.category, capital: users.capital,
    }).from(users).where(eq(users.id, req.user.sub)).limit(1);
    return user;
  });
};
