import 'server-only';
import { sql } from 'drizzle-orm';
import type { AppDatabase } from './client';

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
 */
export async function runWithClaims<T>(
  db: AppDatabase,
  claimsJson: string,
  fn: (tx: ClaimsTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role authenticated`);
    await tx.execute(sql`select set_config('request.jwt.claims', ${claimsJson}, true)`);
    await tx.execute(
      sql`select set_config('request.jwt.claim', '', true), set_config('request.jwt.claim.sub', '', true)`,
    );
    return fn(tx);
  });
}
