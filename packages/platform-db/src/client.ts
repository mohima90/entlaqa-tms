import 'server-only';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { readEnv } from './env';
import * as schema from './schema';

export type AppDatabase = PostgresJsDatabase<typeof schema> & { $client: Sql };

/** Database login roles used by application code (ADR 0002 §5, §7). Never a superuser. */
export type DbLoginRole = 'app_server' | 'app_worker';

export const DATABASE_URL_ENV: Readonly<Record<DbLoginRole, string>> = {
  app_server: 'DATABASE_URL_APP_SERVER',
  app_worker: 'DATABASE_URL_APP_WORKER',
};

/**
 * The connection user must be the expected login role. Supabase's pooler (Supavisor) uses
 * `<role>.<project-ref>` user names, which are accepted too.
 */
export function assertConnectionRole(url: string, role: DbLoginRole): void {
  let user: string;
  try {
    user = decodeURIComponent(new URL(url).username);
  } catch {
    throw new Error(`${DATABASE_URL_ENV[role]} is not a valid connection URL`);
  }
  if (user !== role && !user.startsWith(`${role}.`)) {
    throw new Error(`${DATABASE_URL_ENV[role]} must connect as login role ${role}`);
  }
}

/**
 * Creates a Drizzle database over a postgres.js connection.
 * `prepare: false` is required behind the Supabase pooler in transaction mode (ADR 0002 §5).
 */
export function createDatabase(url: string, options: { max?: number } = {}): AppDatabase {
  const client = postgres(url, {
    prepare: false,
    max: options.max ?? 5,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return drizzle(client, { schema });
}

const databases = new Map<DbLoginRole, AppDatabase>();

/** True when the connection for `role` is configured. */
export function isDatabaseConfigured(role: DbLoginRole = 'app_server'): boolean {
  return readEnv(DATABASE_URL_ENV[role]) !== undefined;
}

/**
 * Lazily created database handle for a login role. Do not query it directly: both roles are
 * NOINHERIT and have no table privileges until withUserTx()/withSystemTx() switch role.
 */
export function getDatabase(role: DbLoginRole): AppDatabase {
  const existing = databases.get(role);
  if (existing) return existing;
  const url = readEnv(DATABASE_URL_ENV[role]);
  if (!url) throw new Error(`${DATABASE_URL_ENV[role]} is not configured`);
  assertConnectionRole(url, role);
  const db = createDatabase(url);
  databases.set(role, db);
  return db;
}
