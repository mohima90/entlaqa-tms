import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'drizzle-orm';
import type { AppDatabase } from './client';

/**
 * Marks the async context of every transaction opened by runWithClaims (withUserTx, withSystemTx,
 * withPlatformTx and the claim-less helpers), so code that must never run while this request or job holds
 * a pooled connection can refuse to (T-M2-18 integration review M1): e.g. asking Supabase Storage — which
 * sees committed rows only, on its own connection — for a signed URL, which belongs in defineAction's
 * afterCommit. The mark ends with the transaction (work after `await withUserTx(…)` is outside it).
 */
const openTransaction = new AsyncLocalStorage<true>();

/** True while the current async context is inside a transaction opened by runWithClaims. */
export function inDatabaseTransaction(): boolean {
  return openTransaction.getStore() === true;
}

/**
 * Throws when called inside a database transaction of this request or job (see inDatabaseTransaction):
 * `what` names the refused step in the error (a programming error — never shown to users).
 */
export function assertNoDatabaseTransaction(what: string): void {
  if (inDatabaseTransaction()) {
    throw new Error(
      `${what} must run after the transaction commits (defineAction afterCommit), never inside it`,
    );
  }
}

/** The transaction handle passed to units of work. RLS applies to every query. */
export type ClaimsTx = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

/**
 * ADR 0002 §5 — the only way application code reaches tenant data:
 *
 *   begin;
 *   set local role authenticated;
 *   select set_config('request.jwt.claims', $1, true);
 *   select set_config('request.jwt.claim', '', true), set_config('request.jwt.claim.sub', '', true);
 *   -- … queries …
 *   commit;
 *
 * All settings are transaction-local, so nothing leaks to the next user of a pooled connection.
 * The legacy `request.jwt.claim` / `request.jwt.claim.sub` settings are blanked for the transaction:
 * Supabase's auth.jwt()/auth.uid() read them BEFORE `request.jwt.claims`, so a session-level SET left
 * on a pooled connection must never be visible to this unit of work (our own policies and helpers read
 * only `request.jwt.claims`; this protects any Supabase-provided code that still uses auth.jwt()).
 * The database validates the claims against the login role (private.current_tenant_id(), §6a).
 *
 * `touchSession` (user sessions, withUserTx): the same third statement also records the session's
 * activity for the organization's inactivity rule (private.touch_session(), T-M2-10) — no extra round
 * trip; the database moves it at most once a minute and never revives an inactive session.
 */
export async function runWithClaims<T>(
  db: AppDatabase,
  claimsJson: string,
  fn: (tx: ClaimsTx) => Promise<T>,
  options: { readonly touchSession?: boolean } = {},
): Promise<T> {
  return openTransaction.run(true, () => runInTransaction(db, claimsJson, fn, options));
}

async function runInTransaction<T>(
  db: AppDatabase,
  claimsJson: string,
  fn: (tx: ClaimsTx) => Promise<T>,
  options: { readonly touchSession?: boolean },
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role authenticated`);
    await tx.execute(sql`select set_config('request.jwt.claims', ${claimsJson}, true)`);
    await tx.execute(
      options.touchSession === true
        ? sql`select set_config('request.jwt.claim', '', true), set_config('request.jwt.claim.sub', '', true), private.touch_session()`
        : sql`select set_config('request.jwt.claim', '', true), set_config('request.jwt.claim.sub', '', true)`,
    );
    return fn(tx);
  });
}
