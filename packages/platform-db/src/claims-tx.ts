import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'drizzle-orm';
import type { AppDatabase } from './client';

/**
 * Marks the async context of every transaction opened by runWithClaims (withUserTx, withSystemTx,
 * withPlatformTx and the claim-less helpers), so code that must never run while this request or job holds
 * a pooled connection can refuse to (T-M2-18 integration review M1): e.g. asking Supabase Storage — which
 * sees committed rows only, on its own connection — for a signed URL, which belongs in defineAction's
 * afterCommit. The mark ends with the transaction (work after `await withUserTx(…)` is outside it) — also
 * for a callback BOUND to the context inside it and run later (Next.js `after()` binds every
 * AsyncLocalStorage of its call site, e.g. the password change's "forget the other browsers" scheduled from
 * inside the action's transaction): the store is the transaction's own state object, closed when the
 * transaction ends, not a flag frozen into the captured context.
 */
const openTransaction = new AsyncLocalStorage<{ open: boolean }>();

/** True while the current async context is inside a transaction opened by runWithClaims that is still open. */
export function inDatabaseTransaction(): boolean {
  return openTransaction.getStore()?.open === true;
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
 * ADR 0002 §5 — the only way application code reaches tenant data (never nested: one open transaction per
 * request or job at a time, see below):
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
  // One pooled connection per request or job at a time (integration review info 2): a transaction opened
  // inside another would take a second connection while holding the first — the pool (max 5, no queue
  // timeout) can then run dry with every request waiting, and the inner one can wait on row locks of the
  // outer one, a deadlock PostgreSQL cannot see. Refused before any connection is taken. Nothing in the
  // code base nests (checked against the unit, integration and worker runs); work that must follow a
  // transaction runs after it (defineAction afterCommit, or after the awaited call).
  assertNoDatabaseTransaction('A database transaction');
  const state = { open: true };
  try {
    return await openTransaction.run(state, () => runInTransaction(db, claimsJson, fn, options));
  } finally {
    state.open = false;
  }
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
