import { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';

// Tokens expire after 90 days. This bounds the exposure window if a token is
// ever leaked — without expiry a stolen token grants permanent access.
const JWT_TTL = '90d';

const registerBody = {
  type: 'object',
  required: ['email', 'password', 'name', 'business', 'category', 'capital'],
  properties: {
    email: { type: 'string', format: 'email', maxLength: 254 },
    password: { type: 'string', minLength: 6, maxLength: 128 },
    name: { type: 'string', minLength: 1, maxLength: 100 },
    business: { type: 'string', minLength: 1, maxLength: 150 },
    category: { type: 'string', minLength: 1, maxLength: 50 },
    capital: { type: 'number', minimum: 0, maximum: 10_000_000 },
    city: { type: 'string', maxLength: 100 },
    deviceId: { type: 'string', minLength: 8, maxLength: 100 },
  },
} as const;

const loginBody = {
  type: 'object',
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', format: 'email', maxLength: 254 },
    password: { type: 'string', maxLength: 128 },
  },
} as const;

type RegisterBody = { email: string; password: string; name: string; business: string; category: string; capital: number; city?: string; deviceId?: string };
type LoginBody = { email: string; password: string };

const userFields = {
  id: users.id,
  email: users.email,
  name: users.name,
  business: users.business,
  category: users.category,
  capital: users.capital,
  city: users.city,
} as const;

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  // Strict rate limit for auth endpoints: 10 attempts per 15 min per IP.
  // Prevents brute-force on /login and account-spam on /register.
  const authRateLimit = {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '15 minutes',
        errorResponseBuilder: () => ({
          error: 'Demasiados intentos. Espera 15 minutos e intenta de nuevo.',
        }),
      },
    },
  };

  fastify.post<{ Body: RegisterBody }>('/register', { schema: { body: registerBody }, ...authRateLimit }, async (req, reply) => {
    const { email, password, name, business, category, capital, city, deviceId } = req.body;

    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      req.log.warn({ event: 'auth.register.duplicate', email }, 'Intento de registro con email existente');
      return reply.status(409).send({ error: 'Email ya registrado' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [user] = await db
      .insert(users)
      .values({ email, passwordHash, name, business, category, capital: capital.toString(), city: city ?? null, deviceId: deviceId ?? null })
      .returning(userFields);

    req.log.info({ event: 'auth.register', userId: user.id }, 'Nuevo usuario registrado');
    const token = fastify.jwt.sign({ sub: user.id, email: user.email }, { expiresIn: JWT_TTL });
    return reply.status(201).send({ token, user });
  });

  fastify.post<{ Body: LoginBody }>('/login', { schema: { body: loginBody }, ...authRateLimit }, async (req, reply) => {
    const { email, password } = req.body;

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      req.log.warn({ event: 'auth.login.fail', email }, 'Intento de login fallido');
      return reply.status(401).send({ error: 'Credenciales inválidas' });
    }

    req.log.info({ event: 'auth.login.success', userId: user.id }, 'Login exitoso');
    const token = fastify.jwt.sign({ sub: user.id, email: user.email }, { expiresIn: JWT_TTL });
    return {
      token,
      user: { id: user.id, email: user.email, name: user.name, business: user.business, category: user.category, capital: user.capital, city: user.city },
    };
  });

  // Recuperación por dispositivo: una reinstalación (APK nuevo, almacenamiento
  // borrado) pierde la credencial local, pero el ANDROID_ID se mantiene mientras
  // el APK conserve la misma firma. Si existe una cuenta con ese deviceId, se
  // ROTA su contraseña a una nueva aleatoria y se devuelve junto con un token,
  // para que la nueva instalación adopte la cuenta y restaure sus datos.
  //
  // Nota de seguridad: quien conozca el ANDROID_ID de un teléfono podría tomar
  // su cuenta — aceptado en este modelo (cuentas ancladas al dispositivo, sin
  // login por correo), mitigado por el rate limit de auth y porque el id no es
  // adivinable (64 bits aleatorios por dispositivo+firma).
  fastify.post<{ Body: { deviceId: string } }>(
    '/recover-device',
    {
      schema: {
        body: {
          type: 'object',
          required: ['deviceId'],
          properties: { deviceId: { type: 'string', minLength: 8, maxLength: 100 } },
        },
      },
      ...authRateLimit,
    },
    async (req, reply) => {
      const { deviceId } = req.body;

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.deviceId, deviceId))
        .orderBy(desc(users.createdAt))
        .limit(1);
      if (!user) {
        return reply.status(404).send({ error: 'No hay cuenta para este dispositivo' });
      }

      const password = randomBytes(24).toString('hex');
      const passwordHash = await bcrypt.hash(password, 10);
      await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));

      req.log.info({ event: 'auth.recover-device', userId: user.id }, 'Cuenta recuperada por deviceId');
      const token = fastify.jwt.sign({ sub: user.id, email: user.email }, { expiresIn: JWT_TTL });
      return {
        token,
        email: user.email,
        password,
        user: { id: user.id, email: user.email, name: user.name, business: user.business, category: user.category, capital: user.capital, city: user.city },
      };
    },
  );

  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (req) => {
    const [user] = await db
      .select(userFields)
      .from(users)
      .where(eq(users.id, req.user.sub))
      .limit(1);
    return user;
  });
};
