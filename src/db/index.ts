import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';
import { env } from '../env';

const client = postgres(env.DATABASE_URL, { ssl: 'require', max: 10 });
export const db = drizzle(client, { schema });
