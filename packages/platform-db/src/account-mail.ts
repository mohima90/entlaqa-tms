import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { type ClaimsTx, runWithClaims } from './claims-tx';
import { type AppDatabase, getDatabase } from './client';
import { type InlineAccountMailTicket, tagInlineAccountMail } from './inline-account-mail';

/**
 * Account e-mails, request path (T-M2-17; FR-NTF-02, FR-IAM-13, FR-IAM-16; migration 20261010120000).
 * The web app only ADDS requests to the account e-mail queue; the worker decides whether an account
 * exists, which organization's brand and language apply, and sends through our notification service.
 * Nothing here reads accounts, and nothing returns anything: the forgot page's answer cannot depend on
 * it (no account enumeration).
 */
/**
 * `inline: true` (WP-ADM-05 follow-up, PO 23 Oct 2026): the request is also TAGGED, in the same transaction, for
 * an immediate e-mail from the web app; the returned ticket is the key to claim it after the response. Null
 * without `inline`, or when the database queued nothing.
 */
export interface InlineOption {
  readonly inline?: boolean;
}

export interface AccountMailApi {
  /**
   * Screen 10: queues a reset e-mail request for the typed address, unconditionally (app_server, no
   * session, no claims). Malformed addresses, a repeat before the worker answered and a full queue are
   * dropped silently by the database.
   */
  requestPasswordResetMail(email: string): Promise<void>;
  /** After a password reset (screen 11, no session): queues the account's "password changed" notice. */
  requestPasswordChangedMail(
    userId: string,
    options?: InlineOption,
  ): Promise<InlineAccountMailTicket | null>;
  /**
   * Sign-in locked the typed address (T-M2-11, migration 20261013090100): queues the "account locked"
   * e-mail request, unconditionally — the worker decides whether an account exists. `lockMinutes`: how
   * long the lock lasts (1–1440); anything else is dropped by the database.
   */
  requestAccountLockedMail(
    email: string,
    lockMinutes: number,
    options?: InlineOption,
  ): Promise<InlineAccountMailTicket | null>;
  /**
   * Wrong codes after the password paused code checks for an account (integration review T-M2-11 M1;
   * migration 20261013090100): queues the "wrong codes after your password" notice for the signed-in user
   * whose code it was (`userId` from the session's verified token). `lockMinutes`: how long the pause
   * lasts (1–1440). One request waits per account; the worker sends at most one per pause.
   */
  requestMfaCodeLockedMail(
    userId: string,
    lockMinutes: number,
    options?: InlineOption,
  ): Promise<InlineAccountMailTicket | null>;
}

const UserId = z.uuid();

/**
 * Tags what this transaction queued for an immediate e-mail (only when asked). A savepoint: where the database
 * does not know the function yet (the app deploys before its migration) or anything else goes wrong, the
 * request stays untagged and the worker sends the e-mail as before - the request itself is never lost.
 */
async function tagQuietly(
  tx: ClaimsTx,
  options: InlineOption | undefined,
): Promise<InlineAccountMailTicket | null> {
  if (!options?.inline) return null;
  try {
    return await tx.transaction((savepoint) => tagInlineAccountMail(savepoint));
  } catch {
    return null;
  }
}

/**
 * Over a database connected as `app_server`, in a transaction WITHOUT claims (`set local role
 * authenticated`, empty request.jwt.claims): the definer functions answer only that login role.
 */
export function createAccountMailApi(getDb: () => AppDatabase): AccountMailApi {
  const withoutClaims = <T>(fn: (tx: ClaimsTx) => Promise<T>) => runWithClaims(getDb(), '', fn);
  return {
    async requestPasswordResetMail(email) {
      await withoutClaims((tx) =>
        tx.execute(sql`select private.request_password_reset_mail(${email})`),
      );
    },
    async requestPasswordChangedMail(userId, options) {
      if (!UserId.safeParse(userId).success)
        throw new Error('requestPasswordChangedMail: invalid user id');
      return withoutClaims(async (tx) => {
        await tx.execute(sql`select private.request_password_changed_mail(${userId}::uuid)`);
        return tagQuietly(tx, options);
      });
    },
    async requestAccountLockedMail(email, lockMinutes, options) {
      if (!Number.isInteger(lockMinutes) || lockMinutes < 1 || lockMinutes > 1440) {
        throw new Error('requestAccountLockedMail: lock minutes must be 1–1440');
      }
      return withoutClaims(async (tx) => {
        await tx.execute(
          sql`select private.request_account_locked_mail(${email}, ${lockMinutes}::integer)`,
        );
        return tagQuietly(tx, options);
      });
    },
    async requestMfaCodeLockedMail(userId, lockMinutes, options) {
      if (!UserId.safeParse(userId).success)
        throw new Error('requestMfaCodeLockedMail: invalid user id');
      if (!Number.isInteger(lockMinutes) || lockMinutes < 1 || lockMinutes > 1440) {
        throw new Error('requestMfaCodeLockedMail: lock minutes must be 1–1440');
      }
      return withoutClaims(async (tx) => {
        await tx.execute(
          sql`select private.request_mfa_code_locked_mail(${userId}::uuid, ${lockMinutes}::integer)`,
        );
        return tagQuietly(tx, options);
      });
    },
  };
}

const defaultAccountMailApi = createAccountMailApi(() => getDatabase('app_server'));

export function requestPasswordResetMail(email: string): Promise<void> {
  return defaultAccountMailApi.requestPasswordResetMail(email);
}

export function requestPasswordChangedMail(
  userId: string,
  options?: InlineOption,
): Promise<InlineAccountMailTicket | null> {
  return defaultAccountMailApi.requestPasswordChangedMail(userId, options);
}

export function requestAccountLockedMail(
  email: string,
  lockMinutes: number,
  options?: InlineOption,
): Promise<InlineAccountMailTicket | null> {
  return defaultAccountMailApi.requestAccountLockedMail(email, lockMinutes, options);
}

export function requestMfaCodeLockedMail(
  userId: string,
  lockMinutes: number,
  options?: InlineOption,
): Promise<InlineAccountMailTicket | null> {
  return defaultAccountMailApi.requestMfaCodeLockedMail(userId, lockMinutes, options);
}

/**
 * My profile (FR-IAM-16): queues the signed-in user's own "password changed" notice inside their
 * withUserTx — the database records the session's organization for its brand and language. Runs in a
 * savepoint: a refusal or failure here never aborts the caller's transaction (the password has already
 * changed); the caller logs it.
 */
export async function queueOwnPasswordChangedMail(tx: ClaimsTx, userId: string): Promise<void> {
  if (!UserId.safeParse(userId).success)
    throw new Error('queueOwnPasswordChangedMail: invalid user id');
  await tx.transaction(async (savepoint) => {
    await savepoint.execute(sql`select private.request_password_changed_mail(${userId}::uuid)`);
  });
}
