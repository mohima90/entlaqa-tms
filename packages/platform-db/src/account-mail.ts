import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { type ClaimsTx, runWithClaims } from './claims-tx';
import { type AppDatabase, getDatabase } from './client';

/**
 * Account e-mails, request path (T-M2-17; FR-NTF-02, FR-IAM-13, FR-IAM-16; migration 20261010120000).
 * The web app only ADDS requests to the account e-mail queue; the worker decides whether an account
 * exists, which organization's brand and language apply, and sends through our notification service.
 * Nothing here reads accounts, and nothing returns anything: the forgot page's answer cannot depend on
 * it (no account enumeration).
 */
export interface AccountMailApi {
  /**
   * Screen 10: queues a reset e-mail request for the typed address, unconditionally (app_server, no
   * session, no claims). Malformed addresses, a repeat before the worker answered and a full queue are
   * dropped silently by the database.
   */
  requestPasswordResetMail(email: string): Promise<void>;
  /** After a password reset (screen 11, no session): queues the account's "password changed" notice. */
  requestPasswordChangedMail(userId: string): Promise<void>;
}

const UserId = z.uuid();

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
    async requestPasswordChangedMail(userId) {
      if (!UserId.safeParse(userId).success)
        throw new Error('requestPasswordChangedMail: invalid user id');
      await withoutClaims((tx) =>
        tx.execute(sql`select private.request_password_changed_mail(${userId}::uuid)`),
      );
    },
  };
}

const defaultAccountMailApi = createAccountMailApi(() => getDatabase('app_server'));

export function requestPasswordResetMail(email: string): Promise<void> {
  return defaultAccountMailApi.requestPasswordResetMail(email);
}

export function requestPasswordChangedMail(userId: string): Promise<void> {
  return defaultAccountMailApi.requestPasswordChangedMail(userId);
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
