import 'server-only';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { runWithClaims } from './claims-tx';
import { type AppDatabase, getDatabase } from './client';
import { pgError } from './pg-error';
import type { UserTx } from './with-user-tx';

/**
 * A member's sign-in lock, for the Organization Admin (T-M2-11, PO decision 9 Oct 2026; FR-IAM-13;
 * migration 20261013090000). In the admin's own transaction (withUserTx, their claims): the database
 * checks that the caller is an active Organization Admin of the session's organization and the person an
 * ACTIVE member there, finds the member's account address itself and answers only "locked or not" — the
 * web app never sees the address or a key. Another organization's person, or a revoked or suspended
 * member, reads as "not locked" (no existence leak). Errors: 42501 for any other caller (the action's own
 * authorization comes first).
 */
export interface MemberSignInLock {
  readonly locked: boolean;
  /** Seconds until the lock lifts by itself (0 when not locked). */
  readonly retryAfterSeconds: number;
}

const PersonId = z.uuid();

/** Whether the member's account is locked now against `maxFailures` (the account budget the app applies). */
export async function memberSignInLock(
  tx: UserTx,
  personId: string,
  maxFailures: number,
): Promise<MemberSignInLock> {
  if (!PersonId.safeParse(personId).success) throw new Error('memberSignInLock: invalid person id');
  if (!Number.isInteger(maxFailures) || maxFailures < 1 || maxFailures > 1_000_000) {
    throw new Error('memberSignInLock: invalid budget');
  }
  const [row] = await tx.execute<{ locked: boolean; retry_after_seconds: number }>(
    sql`select locked, retry_after_seconds
        from private.member_sign_in_lock(${personId}::uuid, ${maxFailures}::integer)`,
  );
  return { locked: row?.locked === true, retryAfterSeconds: row?.retry_after_seconds ?? 0 };
}

/**
 * The lock state for the user's profile page: as memberSignInLock, in a savepoint, and `null` when the
 * database refuses the read (42501 — e.g. the actor lost the permission meanwhile, or a guard cannot decide
 * yet during a deploy): the page shows no lock panel instead of failing (EP-ROLES confirmation pass). Any
 * other error is rethrown.
 */
export async function memberSignInLockForProfile(
  tx: UserTx,
  personId: string,
  maxFailures: number,
): Promise<MemberSignInLock | null> {
  try {
    return await tx.transaction((savepoint) => memberSignInLock(savepoint, personId, maxFailures));
  } catch (error) {
    if (pgError(error)?.code === '42501') return null;
    throw error;
  }
}

/**
 * What an unlock did (migration 20261013090100; security review T-M2-11 M1), measured against the account
 * budget the app applies (as for memberSignInLock):
 *  - `unlocked`    the lock ended; the account's owner is e-mailed (account-mail pipeline);
 *  - `not_locked`  no lock to end (none, or a run of failures below the budget): nothing counted or sent;
 *  - `limited`     the account was unlocked 3 times within 24 hours already — the lock stays;
 *  - `no_account`  the person has no active membership with an account in the admin's organization (a
 *                  revoked or suspended member, another organization's person, no sign-in).
 */
export type UnlockSignInOutcome = 'unlocked' | 'not_locked' | 'limited' | 'no_account';

const UNLOCK_OUTCOMES: ReadonlySet<string> = new Set<UnlockSignInOutcome>([
  'unlocked',
  'not_locked',
  'limited',
  'no_account',
]);

/**
 * Ends an active member's sign-in lock against `maxFailures` (at most 3 unlocks a day per account; the
 * owner is e-mailed).
 */
export async function unlockMemberSignIn(
  tx: UserTx,
  personId: string,
  maxFailures: number,
): Promise<UnlockSignInOutcome> {
  if (!PersonId.safeParse(personId).success)
    throw new Error('unlockMemberSignIn: invalid person id');
  if (!Number.isInteger(maxFailures) || maxFailures < 1 || maxFailures > 1_000_000) {
    throw new Error('unlockMemberSignIn: invalid budget');
  }
  const [row] = await tx.execute<{ outcome: string }>(
    sql`select private.unlock_member_sign_in(${personId}::uuid, ${maxFailures}::integer) as outcome`,
  );
  if (!row || !UNLOCK_OUTCOMES.has(row.outcome)) throw new Error('unlockMemberSignIn: no answer');
  return row.outcome as UnlockSignInOutcome;
}

/**
 * Whether a typed address belongs to an account with an active membership in an organization (T-M2-11,
 * T-M2-10 security review; migration 20261013090000): that organization's own lockout policy applies to
 * its members only — anyone else signing in on its host gets the platform default. app_server without
 * claims (before any session); the address is compared in the database, never stored or returned.
 */
export function createSignInMembershipLookup(getDb: () => AppDatabase) {
  return async function accountInTenant(email: string, tenantId: string): Promise<boolean> {
    if (!PersonId.safeParse(tenantId).success) return false;
    const [row] = await runWithClaims(getDb(), '', (tx) =>
      tx.execute<{ member: boolean }>(
        sql`select private.sign_in_account_in_tenant(${email}, ${tenantId}::uuid) as member`,
      ),
    );
    return row?.member === true;
  };
}

/** The lookup of this app instance (app_server pool). */
export const signInAccountInTenant = createSignInMembershipLookup(() => getDatabase('app_server'));
