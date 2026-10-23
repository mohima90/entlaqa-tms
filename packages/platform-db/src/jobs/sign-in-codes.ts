import { sql } from 'drizzle-orm';
import type { ClaimsTx } from '../claims-tx';

/**
 * Sign-in codes, worker side (WP-ADM-05, FR-IAM-12; migration 20261026100200). The job leases a request in a
 * platform transaction (system claims without a tenant), learns whom to write in which organization and
 * language — or that the address has no usable account — mints the one-time Auth sign-in token, generates
 * the code and stores its keyed hash together with the token and queues the e-mail in the organization's
 * transaction. Only the definer functions reach the table; the code itself is never stored or logged here.
 */

/** Why nothing is sent for a request now (decided by the database). */
export type SignInCodeSkip = 'unknown_account' | 'banned' | 'no_membership';

export type SignInCodeRequest =
  | {
      readonly id: string;
      /** `code`: e-mail a code; `remembered`: only mint the token (no e-mail, no code). */
      readonly mode: 'code' | 'remembered';
      readonly outcome: 'send';
      readonly attempt: number;
      /** The account's address as Auth stores it. */
      readonly email: string;
      readonly userId: string;
      readonly tenantId: string;
      readonly personId: string;
      readonly locale: 'ar' | 'en';
    }
  | {
      readonly id: string;
      readonly mode: 'code' | 'remembered';
      readonly outcome: SignInCodeSkip;
      readonly attempt: number;
    };

const SKIPS: ReadonlySet<string> = new Set<SignInCodeSkip>([
  'unknown_account',
  'banned',
  'no_membership',
]);

/** Leases the oldest waiting request (2 minutes), or null when none waits. */
export async function claimSignInCodeRequest(tx: ClaimsTx): Promise<SignInCodeRequest | null> {
  const [row] = await tx.execute<{
    id: string;
    mode: string;
    outcome: string;
    email: string | null;
    user_id: string | null;
    tenant_id: string | null;
    person_id: string | null;
    locale: string | null;
    attempts: number;
  }>(sql`select * from private.claim_sign_in_code_request()`);
  if (!row) return null;
  const mode = row.mode === 'remembered' ? 'remembered' : row.mode === 'code' ? 'code' : null;
  if (!mode) throw new Error('claimSignInCodeRequest: unknown mode');
  if (row.outcome === 'send') {
    if (!row.email || !row.user_id || !row.tenant_id || !row.person_id) {
      throw new Error('claimSignInCodeRequest: incomplete recipient');
    }
    return {
      id: row.id,
      mode,
      outcome: 'send',
      attempt: row.attempts,
      email: row.email,
      userId: row.user_id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      locale: row.locale === 'en' ? 'en' : 'ar',
    };
  }
  if (!SKIPS.has(row.outcome)) throw new Error('claimSignInCodeRequest: unknown outcome');
  return { id: row.id, mode, outcome: row.outcome as SignInCodeSkip, attempt: row.attempts };
}

/**
 * Stores the keyed hash of a new code and the one-time Auth token (a remembered browser: the token only,
 * `code` null), replacing the address's older codes, in the organization's transaction that queues the
 * e-mail. False when the request is gone or already answered.
 */
export async function issueSignInCode(
  tx: ClaimsTx,
  issue: {
    readonly id: string;
    readonly userId: string;
    readonly tenantId: string;
    readonly code: string | null;
    readonly linkToken: string;
  },
): Promise<boolean> {
  const [row] = await tx.execute<{ issued: boolean }>(
    sql`select private.issue_sign_in_code(${issue.id}::uuid, ${issue.userId}::uuid, ${issue.tenantId}::uuid,
                                         ${issue.code}, ${issue.linkToken}) as issued`,
  );
  return row?.issued === true;
}

/** An address nobody can sign in with: the request stays as a row no code can match (no enumeration). */
export async function signInCodeDeadEnd(tx: ClaimsTx, id: string): Promise<boolean> {
  const [row] = await tx.execute<{ done: boolean }>(
    sql`select private.sign_in_code_dead_end(${id}::uuid) as done`,
  );
  return row?.done === true;
}

/** Puts a request back after a temporary failure; false when it was removed (attempts used up). */
export async function retrySignInCodeRequest(tx: ClaimsTx, id: string): Promise<boolean> {
  const [row] = await tx.execute<{ again: boolean }>(
    sql`select private.retry_sign_in_code_request(${id}::uuid) as again`,
  );
  return row?.again === true;
}
