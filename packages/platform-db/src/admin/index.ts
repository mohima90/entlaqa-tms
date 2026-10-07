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
import { readSupabasePublicConfigFromEnv } from '../supabase/config';

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

/**
 * Where the WORKER reaches the Auth admin API (T-M2-17): the Supabase URL and the secret key
 * (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, read and checked by apps/worker at start-up). Configured in the
 * worker's environment only — never in the web app's (ADR 0002 §7).
 */
export interface AuthAdminSettings {
  readonly url: string;
  readonly secretKey: string;
}

/** The outcome of asking Auth for a recovery link. */
export type RecoveryLinkResult =
  | { readonly status: 'issued'; readonly hashedToken: string }
  /** Auth has no account with this address (GoTrue: 404 user_not_found; nothing created or sent). */
  | { readonly status: 'unknown_account' };

/**
 * Auth refused or could not answer. `temporary`: worth another attempt later (Auth or the network down,
 * rate limited, the secret key wrong or revoked — fixable by an operator); otherwise the request itself
 * was refused (e.g. an address Auth does not accept). `code` is ours or Auth's stable error code, never
 * Auth's message (it may quote the address).
 */
export class AuthAdminError extends Error {
  override readonly name = 'AuthAdminError';
  constructor(
    readonly code: string,
    readonly temporary: boolean,
  ) {
    super(`Auth admin request failed (${code})`);
  }
}

export interface RecoveryLinkIssuer {
  /**
   * A new recovery token for the account with this address — Auth stores it (single use, `otp_exp`)
   * and sends NOTHING; the caller builds the link and e-mails it. A newer token replaces the older one.
   */
  issue(email: string): Promise<RecoveryLinkResult>;
}

/** The token hash's character set and size (GoTrue v2.197.0: 56 hex characters, sha224). */
const TOKEN_HASH = /^[A-Za-z0-9_-]{16,128}$/;
const STABLE_CODE = /^[a-z0-9_]{2,64}$/;
/** An Auth admin call that has not answered by then is abandoned (and retried later). */
export const AUTH_ADMIN_TIMEOUT_MS = 10_000;

/**
 * Recovery links for the worker's password-reset e-mail (T-M2-17), through Auth's admin `generate_link`
 * (type `recovery`): GoTrue v2.197.0 (`internal/api/mail.go`, adminGenerateLink) looks the account up,
 * answers 404 `user_not_found` for an unknown address BEFORE writing anything (no user is created — the
 * before-user-created hook is not even reached on this path), stores the new token hash on the account
 * and returns it with the link; it sends no e-mail, and neither Auth's per-account e-mail frequency
 * (SMTP_MAX_FREQUENCY) nor its e-mail rate limit applies (admin routes have no limiter). The one-time
 * code and Auth's own link in the answer are discarded here and never leave this function.
 */
export function createRecoveryLinkIssuer(
  settings: AuthAdminSettings,
  op: AdminOperation,
): RecoveryLinkIssuer {
  assertAdminOperation(op);
  const client = createClient(settings.url, settings.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(AUTH_ADMIN_TIMEOUT_MS) }),
    },
  });
  return {
    async issue(email) {
      let answer: Awaited<ReturnType<typeof client.auth.admin.generateLink>>;
      try {
        answer = await client.auth.admin.generateLink({ type: 'recovery', email });
      } catch {
        throw new AuthAdminError('AUTH_UNREACHABLE', true);
      }
      const { data, error } = answer;
      if (error) {
        const status = 'status' in error && typeof error.status === 'number' ? error.status : 0;
        const code =
          'code' in error && typeof error.code === 'string' && STABLE_CODE.test(error.code)
            ? error.code
            : undefined;
        if (status === 404 || code === 'user_not_found') return { status: 'unknown_account' };
        if (status === 401 || status === 403) throw new AuthAdminError('AUTH_ADMIN_KEY', true);
        if (status === 0 || status === 429 || status >= 500) {
          throw new AuthAdminError(code ?? `AUTH_HTTP_${String(status || 'NETWORK')}`, true);
        }
        throw new AuthAdminError(code ?? `AUTH_HTTP_${String(status)}`, false);
      }
      // Checked at run time: the answer comes from another service.
      const { properties } = data as { properties?: { hashed_token?: unknown } };
      const hashedToken = properties?.hashed_token;
      if (typeof hashedToken !== 'string' || !TOKEN_HASH.test(hashedToken)) {
        throw new AuthAdminError('AUTH_UNEXPECTED_ANSWER', true);
      }
      return { status: 'issued', hashedToken };
    },
  };
}

/**
 * Supabase client with the secret (service-role) key — Auth admin API (user lifecycle) for jobs/admin
 * code only. Never on the request path: invitees sign up through the public Auth API instead (ADR 0002
 * §7 note T-M2-07).
 */
export function createServiceRoleSupabaseClient(
  op: AdminOperation,
): ReturnType<typeof createClient> {
  assertAdminOperation(op);
  const config = readSupabasePublicConfigFromEnv();
  const secretKey = readEnv('SUPABASE_SECRET_KEY');
  if (!config || !secretKey) throw new Error('Supabase admin access is not configured');
  return createClient(config.url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
