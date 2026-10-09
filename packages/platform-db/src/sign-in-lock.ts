import 'server-only';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { runWithClaims } from './claims-tx';
import { type AppDatabase, getDatabase } from './client';
import type { UserTx } from './with-user-tx';

/**
 * A member's sign-in lock, for the Organization Admin (T-M2-11, PO decision 9 Oct 2026; FR-IAM-13;
 * migration 20261013090000). In the admin's own transaction (withUserTx, their claims): the database
 * checks that the caller is an active Organization Admin of the session's organization and the person a
 * member there, finds the member's account address itself and answers only "locked or not" — the web app
 * never sees the address or a key. Another organization's person reads as "not locked" (no existence
 * leak). Errors: 42501 for any other caller (the action's own authorization comes first).
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

/** Ends the member's sign-in lock; true when there was a run of failures to end. */
export async function unlockMemberSignIn(tx: UserTx, personId: string): Promise<boolean> {
  if (!PersonId.safeParse(personId).success)
    throw new Error('unlockMemberSignIn: invalid person id');
  const [row] = await tx.execute<{ unlocked: boolean }>(
    sql`select private.unlock_member_sign_in(${personId}::uuid) as unlocked`,
  );
  return row?.unlocked === true;
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
