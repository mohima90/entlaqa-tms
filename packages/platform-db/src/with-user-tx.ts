import 'server-only';
import {
  type JwtClaims,
  JwtClaimsSchema,
  type VerifiedClaims,
  codeVerifiedAt,
} from '@jadarat/platform-core';
import { sql } from 'drizzle-orm';
import { type ClaimsTx, runWithClaims } from './claims-tx';
import { type AppDatabase, getDatabase } from './client';
import { isTransactionConflict } from './pg-error';

/** Transaction handle for request-path units of work (connection role app_server). */
export type UserTx = ClaimsTx;

/**
 * The only claims forwarded to PostgreSQL as `request.jwt.claims` (re-review N5, TM-0001 T-15): what the
 * database reads through private.request_claims() — `sub`, `role`, `session_id`, `tenant_id`,
 * `person_id` — and `aal`. Everything else in the access token (e-mail, phone, `user_metadata` with the
 * caller-chosen sign-up data such as a raw invitation token, `app_metadata`, `amr`, …) stays out of the
 * database session.
 */
const DATABASE_CLAIM_KEYS = ['sub', 'role', 'session_id', 'tenant_id', 'person_id', 'aal'] as const;

/**
 * Plus one DERIVED claim, `code_at` (T-M2-10 re-review): when the session last passed an authenticator code
 * (the newest `totp` entry of the verified token's `amr`, seconds since the epoch, as a string). The database
 * checks the 15-minute rule of high-risk changes with it itself (private.request_code_fresh) — the `amr`
 * array itself stays out.
 */
export function databaseClaims(claims: JwtClaims): Readonly<Record<string, string>> {
  const subset: Record<string, string> = {};
  for (const key of DATABASE_CLAIM_KEYS) {
    const value = claims[key];
    if (typeof value === 'string') subset[key] = value;
  }
  const codeAt = codeVerifiedAt(claims);
  if (codeAt !== null && codeAt.getTime() > 0) {
    subset.code_at = String(Math.floor(codeAt.getTime() / 1000));
  }
  return subset;
}

/**
 * `retryOnConflict`: when PostgreSQL rolls the transaction back as a deadlock victim (40P01) or after a
 * serialization failure (40001), run the WHOLE unit of work once more, in a new transaction (T-M2-09 ×
 * T-M2-10 review L1: a request recording its activity — private.touch_session() — can deadlock with a
 * deactivation of the same member). Only for units of work that do nothing outside the database before
 * they commit: the first attempt's database work is gone, anything else it did (an Auth call, an e-mail, a
 * log of success) would run twice. defineAction turns it on unless the action declares `externalEffects`.
 * Work after the commit (outside `fn`) is not repeated. At most one retry; any other error, or a second
 * conflict, is thrown as is.
 */
export interface UserTxOptions {
  readonly retryOnConflict?: boolean;
}

export type WithUserTx = <T>(
  claims: VerifiedClaims,
  fn: (tx: UserTx) => Promise<T>,
  options?: UserTxOptions,
) => Promise<T>;

/**
 * Builds withUserTx over a database handle connected as `app_server`.
 * Only claims from a server-verified JWT (VerifiedClaims) are accepted; the shape is re-validated
 * here, only the allow-listed subset reaches PostgreSQL (databaseClaims), and the database accepts them
 * only for a live Auth session with an active membership.
 */
export function createWithUserTx(getDb: () => AppDatabase): WithUserTx {
  return async function withUserTx<T>(
    claims: VerifiedClaims,
    fn: (tx: UserTx) => Promise<T>,
    options: UserTxOptions = {},
  ): Promise<T> {
    const parsed = JwtClaimsSchema.safeParse(claims);
    if (!parsed.success || parsed.data.role !== 'authenticated' || !parsed.data.session_id) {
      throw new Error('withUserTx: refusing claims that are not a verified user session claim set');
    }
    const claimsJson = JSON.stringify(databaseClaims(parsed.data));
    // A session acting in an organization records its activity (inactivity rule, T-M2-10).
    const run = () =>
      runWithClaims(getDb(), claimsJson, fn, {
        touchSession: typeof parsed.data.tenant_id === 'string',
      });
    if (options.retryOnConflict !== true) return run();
    try {
      return await run();
    } catch (error) {
      if (!isTransactionConflict(error)) throw error;
      return run();
    }
  };
}

/** Runs `fn` in a transaction as the signed-in user identified by `claims`, with RLS enforced. */
export const withUserTx: WithUserTx = createWithUserTx(() => getDatabase('app_server'));

/**
 * Tenant switch for the CURRENT session (ADR 0002 §3). Call from the explicit POST server action,
 * then refresh the Auth session so the access-token hook issues a token with the new tenant claim.
 * Returns false when the user has no active membership in an active/trial target tenant.
 */
export async function switchActiveTenant(tx: UserTx, tenantId: string): Promise<boolean> {
  const rows = await tx.execute<{ switched: boolean }>(
    sql`select private.switch_active_tenant(${tenantId}::uuid) as switched`,
  );
  return rows[0]?.switched === true;
}

/** An organization the signed-in user may act in (before a tenant is selected). */
export interface SessionTenant {
  readonly tenantId: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
}

/**
 * The CURRENT session's organizations (active memberships in active/trial tenants), for the sign-in
 * flow before a tenant is selected (private.session_tenants(), migration 20261001120000). Empty for an
 * invalid or expired session.
 */
export async function listSessionTenants(tx: UserTx): Promise<readonly SessionTenant[]> {
  const rows = await tx.execute<{ tenant_id: string; name_ar: string; name_en: string | null }>(
    sql`select tenant_id, name_ar, name_en from private.session_tenants()`,
  );
  return rows.map((row) => ({ tenantId: row.tenant_id, nameAr: row.name_ar, nameEn: row.name_en }));
}
