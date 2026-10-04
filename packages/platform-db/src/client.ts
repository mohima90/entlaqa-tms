import 'server-only';
import { readFileSync } from 'node:fs';
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

/** Environment variable holding the PEM root CA of the database server (Supabase: prod-ca-2021). */
export const DATABASE_CA_CERT_ENV = 'DATABASE_CA_CERT';
/** Alternative: path to the PEM file (container / Kubernetes secrets mounted as files; T-M1-D04). */
export const DATABASE_CA_CERT_FILE_ENV = 'DATABASE_CA_CERT_FILE';

/** The root CA PEM from DATABASE_CA_CERT, else from the file named by DATABASE_CA_CERT_FILE. */
export function readDatabaseCaPem(): string | undefined {
  const inline = readEnv(DATABASE_CA_CERT_ENV);
  if (inline) return inline;
  const file = readEnv(DATABASE_CA_CERT_FILE_ENV);
  return file ? readFileSync(file, 'utf8') : undefined;
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * TLS for the application's database connections. A remote server is reached only with a VERIFIED
 * certificate chain and host name (verify-full) against the configured root CA — never with
 * encryption-only TLS, which a network attacker could intercept. Local servers (development, CI) keep
 * whatever the URL says. Fails closed: a remote URL without a CA is a configuration error.
 */
export function tlsOptionsFor(
  url: string,
  caPem: string | undefined,
): { readonly ca: string; readonly rejectUnauthorized: true } | undefined {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('database URL is not a valid connection URL');
  }
  if (LOCAL_HOSTS.has(host)) return undefined;
  if (!caPem?.includes('-----BEGIN CERTIFICATE-----')) {
    throw new Error(
      `${DATABASE_CA_CERT_ENV} (PEM root CA of the database server) is required for remote database hosts`,
    );
  }
  return { ca: caPem, rejectUnauthorized: true };
}

/**
 * Creates a Drizzle database over a postgres.js connection.
 * `prepare: false` is required behind the Supabase pooler in transaction mode (ADR 0002 §5).
 */
export function createDatabase(
  url: string,
  options: { max?: number; caPem?: string | undefined } = {},
): AppDatabase {
  const ssl = tlsOptionsFor(url, options.caPem);
  const client = postgres(url, {
    prepare: false,
    max: options.max ?? 5,
    idle_timeout: 20,
    connect_timeout: 10,
    ...(ssl ? { ssl } : {}),
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
  const db = createDatabase(url, { caPem: readDatabaseCaPem() });
  databases.set(role, db);
  return db;
}
