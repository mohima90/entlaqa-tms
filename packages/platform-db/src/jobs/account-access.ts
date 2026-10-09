import { sql } from 'drizzle-orm';
import type { ClaimsTx } from '../claims-tx';

/**
 * The Auth ban queue, worker side (T-M2-09, FR-IAM-05; migration 20261011090100). A platform job (system
 * claims without a tenant) leases one account's check and learns what to do in Auth — the database
 * decides from the account's memberships, invitations and our earlier bans — then records what Auth did.
 * Only the definer functions reach the queue; account ids only, never addresses.
 */
export type AccountAccessAction = 'ban' | 'unban' | 'none';

export interface AccountAccessCheck {
  readonly userId: string;
  readonly action: AccountAccessAction;
  /**
   * The change the decision is based on, exactly as stored (microseconds: text, not a JS Date); finishing
   * with an older one keeps the check due.
   */
  readonly requestedAt: string;
  /** This attempt's number (1-based). */
  readonly attempt: number;
}

/** What happened in Auth. */
export type AccountAccessOutcome = 'banned' | 'unbanned' | 'unchanged' | 'gone' | 'refused';

const ACTIONS: ReadonlySet<string> = new Set<AccountAccessAction>(['ban', 'unban', 'none']);

/** Leases the oldest due check (5 minutes), or null when none is due. */
export async function claimAccountAccessCheck(tx: ClaimsTx): Promise<AccountAccessCheck | null> {
  const [row] = await tx.execute<{
    user_id: string;
    action: string;
    requested_at: string;
    attempts: number;
  }>(sql`select c.user_id, c.action, c.requested_at::text as requested_at, c.attempts
         from private.claim_account_access_check() c`);
  if (!row) return null;
  if (!ACTIONS.has(row.action)) throw new Error('claimAccountAccessCheck: unknown action');
  return {
    userId: row.user_id,
    action: row.action as AccountAccessAction,
    requestedAt: row.requested_at,
    attempt: row.attempts,
  };
}

/**
 * Records the outcome and removes the check; false when a newer change asked for it meanwhile (it is then
 * due again at once and decided anew).
 */
export async function finishAccountAccessCheck(
  tx: ClaimsTx,
  check: Pick<AccountAccessCheck, 'userId' | 'requestedAt'>,
  outcome: AccountAccessOutcome,
): Promise<boolean> {
  const [row] = await tx.execute<{ done: boolean }>(sql`
    select private.finish_account_access_check(${check.userId}::uuid, ${check.requestedAt}::timestamptz,
      ${outcome}) as done`);
  return row?.done === true;
}

/** Puts a check back after a temporary failure (back-off up to an hour); the attempts so far. */
export async function retryAccountAccessCheck(tx: ClaimsTx, userId: string): Promise<number> {
  const [row] = await tx.execute<{ attempts: number }>(
    sql`select private.retry_account_access_check(${userId}::uuid) as attempts`,
  );
  return row?.attempts ?? 0;
}
