import { sql } from 'drizzle-orm';
import type { UserTx } from './with-user-tx';

/**
 * «Remember this browser» = «keep me signed in» (WP-ADM-05, migrations 20261026100100 and 100300): a session
 * the person chose to keep lives until its own date - the strictest organization's 1 / 7 / 14 / 30 days -
 * instead of the organization's idle and maximum-length rules. Everything that ends a session (sign-out,
 * «End sessions», deactivation, a password change, «Forget all») still does.
 */

/** One kept session of the signed-in account. */
export interface KeptSession {
  readonly sessionId: string;
  readonly keptUntil: Date;
  readonly startedAt: Date;
  /** Auth's recording of the browser (shown as "Chrome on Windows"; never raw). */
  readonly userAgent: string | null;
  /** The session asking. */
  readonly current: boolean;
}

/**
 * Keeps the current session after a code sign-in with the tick ticked: for the days of the strictest
 * organization of the account; 0 = nothing kept (an organization has the setting Off). `claims` may have no
 * organization yet.
 */
export async function keepSession(tx: UserTx): Promise<number> {
  const [row] = await tx.execute<{ days: number }>(sql`select private.keep_session() as days`);
  return row?.days ?? 0;
}

/** The account's own live kept sessions. */
export async function listMyKeptSessions(tx: UserTx): Promise<readonly KeptSession[]> {
  const rows = await tx.execute<{
    session_id: string;
    kept_until: string | Date;
    started_at: string | Date;
    user_agent: string | null;
    is_current: boolean;
  }>(sql`select * from private.my_kept_sessions()`);
  return rows.map((row) => ({
    sessionId: row.session_id,
    keptUntil: new Date(row.kept_until),
    startedAt: new Date(row.started_at),
    userAgent: row.user_agent,
    current: row.is_current,
  }));
}

/** «Forget all»: the account's sessions stop being kept (they follow the organization's normal rules). */
export async function forgetKeptSessions(tx: UserTx): Promise<number> {
  const [row] = await tx.execute<{ count: number }>(
    sql`select private.forget_kept_sessions() as count`,
  );
  return row?.count ?? 0;
}
