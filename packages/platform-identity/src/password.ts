import 'server-only';
import {
  type AppError,
  type Result,
  appError,
  defineErrorCodes,
  err,
  ok,
} from '@jadarat/platform-core';
import type { LogFields } from '@jadarat/platform-observability';
import { AuthServiceError } from './auth-flow';
import type { SecurityLog } from './auth-limits';

/**
 * Password change by the signed-in user (FR-IAM-16 My profile; FR-IAM-13, NFR-SEC-01):
 *   0. (before the action's transaction) the check is limited per user (T-M2-11, from the T-M2-15a
 *      security review: 5 per 15 minutes on the shared limiter — auth-next.ts
 *      allowPasswordCheckForRequest, platform-rbac my-profile.ts beforeTransaction);
 *   1. the session must still be live at the Auth server (getUser);
 *   1a. a wrong current password is a security event, audited as `platform.auth.password_change_failed`
 *      by the action (platform-rbac my-profile.ts);
 *   2. the CURRENT password is checked by signing in with it on a separate, cookie-less client whose
 *      session is ended right away — the user's own session is never touched; Auth also checks it
 *      itself when "require current password" is on (`current_password`);
 *   3. Auth sets the new password and applies its password policy (length, characters, leaked
 *      passwords where available);
 *   4. every OTHER sign-in session of the user ends (`signOut({ scope: 'others' })`);
 *   5. every OTHER browser the account trusted for the sign-in lock is forgotten — this one stays
 *      (T-M2-11 security review L2): scheduled to run after the action's transaction.
 * Passwords are never logged or audited.
 */
export const PasswordErrors = defineErrorCodes({
  AUTH_CURRENT_PASSWORD_INVALID: {
    status: 422,
    messageKey: 'auth.errors.currentPasswordInvalid',
  },
  AUTH_PASSWORD_TOO_WEAK: { status: 422, messageKey: 'auth.errors.passwordTooWeak' },
  AUTH_PASSWORD_SAME: { status: 422, messageKey: 'auth.errors.passwordSame' },
  /** Auth wants a fresh sign-in before a password change (hosted "secure password change"). */
  AUTH_REAUTHENTICATION_NEEDED: { status: 403, messageKey: 'auth.errors.reauthenticationNeeded' },
  /** Any other refusal of the new password by Auth (e.g. its length or character rules). */
  AUTH_PASSWORD_REJECTED: { status: 422, messageKey: 'auth.errors.passwordRejected' },
});

interface AuthErrorLike {
  readonly status?: number | undefined;
  readonly code?: string | undefined;
}

/** The subset of the cookie-bound Supabase Auth client the password change uses. */
export interface PasswordClientLike {
  readonly auth: {
    getUser(): Promise<{
      data: { user: { id: string; email?: string | undefined } | null };
      error: unknown;
    }>;
    updateUser(attributes: {
      password: string;
      current_password: string;
    }): Promise<{ error: AuthErrorLike | null }>;
    signOut(options: { scope: 'others' }): Promise<{ error: unknown }>;
  };
}

export type PasswordVerdict = 'valid' | 'invalid' | 'rate_limited';

export interface PasswordChangeDeps {
  readonly supabase: PasswordClientLike | null;
  /** Checks e-mail + password on a cookie-less client and ends that session (auth-next.ts). */
  readonly verifyPassword: (email: string, password: string) => Promise<PasswordVerdict>;
  readonly securityLog: SecurityLog;
  readonly logWarning: (message: string, fields: LogFields) => void;
  /**
   * After a successful change: SCHEDULES forgetting every browser the account (`email`, as Auth stores it)
   * trusted except this one (auth-next.ts: after the response, outside the action's transaction —
   * auth-limits.ts forgetOtherTrustedBrowsers; never throws).
   */
  readonly forgetOtherTrustedBrowsers?: (email: string) => void;
}

const CHANGE_ACTION = 'platform.auth.change_password';

/** A cookie-less Supabase client (createSupabaseVerifierClient) — only the calls the check needs. */
export interface VerifierClientLike {
  readonly auth: {
    signInWithPassword(credentials: {
      email: string;
      password: string;
    }): Promise<{ error: { status?: number | undefined } | null }>;
    signOut(options: { scope: 'local' }): Promise<{ error: unknown }>;
  };
}

/**
 * Checks e-mail + password by signing in on a cookie-less client and ending that session at once.
 * The user's own session is never touched (and Auth ends every other session on a password change,
 * this one included, should the sign-out here fail).
 */
export function createPasswordVerifier(
  createClient: () => VerifierClientLike | null,
  logWarning: (message: string, fields: LogFields) => void,
) {
  return async function verifyPassword(email: string, password: string): Promise<PasswordVerdict> {
    const client = createClient();
    if (!client) return 'invalid';
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.status === 429) return 'rate_limited';
      if (error.status !== undefined && error.status >= 400 && error.status < 500) return 'invalid';
      throw new AuthServiceError(error.status);
    }
    const { error: signOutError } = await client.auth.signOut({ scope: 'local' });
    if (signOutError) {
      logWarning('could not end the password-check session', { action: CHANGE_ACTION });
    }
    return 'valid';
  };
}

export async function changePassword(
  deps: PasswordChangeDeps,
  input: { readonly currentPassword: string; readonly newPassword: string },
): Promise<Result<{ readonly userId: string }, AppError>> {
  const { supabase } = deps;
  if (!supabase) return err(appError('NOT_CONFIGURED'));

  const { data, error } = await supabase.auth.getUser();
  const user = error ? null : data.user;
  if (!user?.email) return err(appError('UNAUTHENTICATED'));

  // The current-password checks are limited per user BEFORE the action's transaction (auth-next.ts
  // allowPasswordCheckForRequest, run by the action's beforeTransaction: never while a pooled connection
  // is held — security review T-M2-11).
  const currentPasswordRefused = () => {
    deps.securityLog({
      event: 'auth.password_change.failed',
      action: CHANGE_ACTION,
      reason: 'current_password',
      entityType: 'auth_user',
      entityId: user.id,
    });
    return err(appError(PasswordErrors.AUTH_CURRENT_PASSWORD_INVALID));
  };

  const verdict = await deps.verifyPassword(user.email, input.currentPassword);
  if (verdict === 'rate_limited') return err(appError('RATE_LIMITED'));
  if (verdict === 'invalid') return currentPasswordRefused();

  const updated = await supabase.auth.updateUser({
    password: input.newPassword,
    current_password: input.currentPassword,
  });
  if (updated.error) {
    const { status, code } = updated.error;
    if (status === 429) return err(appError('RATE_LIMITED'));
    if (code === 'weak_password') return err(appError(PasswordErrors.AUTH_PASSWORD_TOO_WEAK));
    if (code === 'same_password') return err(appError(PasswordErrors.AUTH_PASSWORD_SAME));
    if (code === 'current_password_mismatch' || code === 'current_password_required') {
      return currentPasswordRefused();
    }
    if (code === 'reauthentication_needed') {
      return err(appError(PasswordErrors.AUTH_REAUTHENTICATION_NEEDED));
    }
    if (code === 'insufficient_aal') return err(appError('STEP_UP_REQUIRED'));
    // The session ended between the checks (revoked, expired): sign in again.
    if (status === 401 || status === 403) return err(appError('UNAUTHENTICATED'));
    // Other refusals (4xx, e.g. validation_failed for a password Auth does not accept): a handled
    // answer, not a server error. 5xx / no status: Auth could not answer.
    if (status !== undefined && status >= 400 && status < 500) {
      return err(appError(PasswordErrors.AUTH_PASSWORD_REJECTED));
    }
    throw new AuthServiceError(status);
  }

  // Other devices must sign in again with the new password. This session stays signed in.
  const others = await supabase.auth.signOut({ scope: 'others' });
  if (others.error) {
    deps.logWarning('could not end the other sign-in sessions after a password change', {
      action: CHANGE_ACTION,
    });
  }
  // And the browsers the account trusted, but this one, are no longer trusted (T-M2-11 L2).
  deps.forgetOtherTrustedBrowsers?.(user.email);
  return ok({ userId: user.id });
}
