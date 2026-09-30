/**
 * RESTRICTED ENTRY POINT — service-level database and Supabase access that is NOT bound to a user's
 * tenant context (ADR 0002 §7). Allowed importers (dependency-cruiser rule
 * `admin-client-only-in-jobs-or-admin`): `packages|modules/<name>/src/{jobs,admin}/**` and the future
 * worker app `apps/worker/**` — never `apps/suite/src/app/**` or any other request path.
 *
 * Tenant-scoped jobs must NOT use this: they use withSystemTx() from `@jadarat/platform-db/jobs`
 * (login role app_worker, system-actor claims, RLS enforced).
 */
import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { sql } from 'drizzle-orm';
import { type AppDatabase, createDatabase } from '../client';
import { readEnv } from '../env';
import { readSupabasePublicConfig } from '../supabase/config';

export interface AdminOperation {
  /** Why the platform-level (cross-tenant) operation is needed; recorded for audit. */
  readonly reason: string;
  /** Who/what performs it: a platform staff user id or a job name. */
  readonly actor: string;
}

let adminDb: AppDatabase | undefined;

function getAdminDatabase(): AppDatabase {
  if (adminDb) return adminDb;
  const url = readEnv('DATABASE_URL_ADMIN');
  if (!url) throw new Error('DATABASE_URL_ADMIN is not configured');
  adminDb = createDatabase(url, { max: 2 });
  return adminDb;
}

export function assertAdminOperation(op: AdminOperation): void {
  if (op.reason.trim().length < 10) throw new Error('Admin operation requires a meaningful reason');
  if (op.actor.trim().length === 0) throw new Error('Admin operation requires an actor');
}

/**
 * Runs a platform-level operation (tenant provisioning, migrations support, console aggregates).
 * The reason/actor are attached to the transaction as `jadarat.admin_reason` / `jadarat.admin_actor`
 * settings; nothing reads them yet.
 * TODO(T-M1-D03/M2): persist a platform audit record for every admin operation (ADR 0002 §7).
 */
export async function withAdminTx<T>(
  op: AdminOperation,
  fn: (tx: Parameters<Parameters<AppDatabase['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  assertAdminOperation(op);
  return getAdminDatabase().transaction(async (tx) => {
    await tx.execute(sql`select set_config('jadarat.admin_reason', ${op.reason}, true)`);
    await tx.execute(sql`select set_config('jadarat.admin_actor', ${op.actor}, true)`);
    return fn(tx);
  });
}

/** Supabase client with the secret (service-role) key — Auth admin API (invitations, user lifecycle). */
export function createServiceRoleSupabaseClient(
  op: AdminOperation,
): ReturnType<typeof createClient> {
  assertAdminOperation(op);
  const config = readSupabasePublicConfig({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  const secretKey = readEnv('SUPABASE_SECRET_KEY');
  if (!config || !secretKey) throw new Error('Supabase admin access is not configured');
  return createClient(config.url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
