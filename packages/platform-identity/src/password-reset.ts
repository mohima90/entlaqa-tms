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
import { AuthServiceError, sessionTokens } from './auth-flow';

/**
 * Forgot / reset password (FR-IAM-13, NFR-SEC-01; T-M2-08, screens 10 and 11) with Supabase Auth's own
 * recovery: Auth stores a single-use token, e-mails the link through the project's SMTP (Resend on
 * hosted, the installation's relay self-hosted) and expires it after `otp_exp` (3600 s = 60 minutes).
 * The template builds the link `{{ .SiteURL }}/ar/reset-password#token_hash=…&type=recovery`: the token
 * travels in the URL FRAGMENT, never sent to the server with a page request (as for invitations, review
 * M3), and loading the page verifies nothing (link scanners cannot use the token up). Framework-free like
 * auth-flow.ts; the Next.js adapter is auth-next.ts and the public actions are in
 * apps/suite/src/auth/password-reset.ts. Design and GoTrue findings: docs/engineering/password-reset.md.
 *
 *   request  → (application limiter, decided by the action) → resetPasswordForEmail(email) on a
 *              STATELESS client (no PKCE: a code challenge does not protect the token_hash path) —
 *              started at once, never awaited by the answer: the answer comes after a constant time
 *              whatever Auth did (Auth answers an existing account later, and with 429 to a repeat
 *              within a minute — both would tell that the account exists)
 *   complete → verifyOtp(recovery, token_hash) on a STATELESS client: the recovery session lives only in
 *              this request's memory, never in the browser or our session cookies → updateUser(password)
 *              → signOut(global): every session of the account ends, the recovery session included →
 *              security log `platform.auth.password_reset` (user id only) → the visitor signs in
 *
 * The e-mail, password and token never reach a log.
 */
export const PasswordResetErrors = defineErrorCodes({
  /** Expired, already used, unknown or malformed link, or a banned account — one answer for all. */
  PASSWORD_RESET_LINK_INVALID: { status: 409, messageKey: 'passwordReset.errors.linkInvalid' },
  /**
   * Auth refused the new password AFTER the link was used up (it is single use): the page asks for a
   * new link and names the reason.
   */
  PASSWORD_RESET_SAME_PASSWORD: { status: 422, messageKey: 'passwordReset.errors.samePassword' },
  PASSWORD_RESET_WEAK_PASSWORD: { status: 422, messageKey: 'passwordReset.errors.weakPassword' },
  /** Auth's leaked-password check (hosted, where available). */
  PASSWORD_RESET_BREACHED_PASSWORD: {
    status: 422,
    messageKey: 'passwordReset.errors.breachedPassword',
  },
  PASSWORD_RESET_PASSWORD_REJECTED: {
    status: 422,
    messageKey: 'passwordReset.errors.passwordRejected',
  },
});

/** The answer to a reset request is sent after this long, whatever happened (timing). */
export const RESET_REQUEST_ANSWER_MS = 1_500;

/**
 * The token hash as it may appear in the link: Auth's own format (56 hex characters in GoTrue
 * v2.197.0) is not relied on — only a safe character set and length, checked before Auth is asked.
 */
export const RECOVERY_TOKEN_HASH_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

const REQUEST_ACTION = 'platform.auth.request_password_reset';
const COMPLETE_ACTION = 'platform.auth.password_reset';

interface AuthErrorLike {
  readonly status?: number | undefined;
  readonly code?: string | undefined;
}

/** A stateless Supabase Auth client (publishable key, session in memory only, no PKCE). */
export interface RecoveryClientLike {
  readonly auth: {
    resetPasswordForEmail(email: string): Promise<{ error: AuthErrorLike | null }>;
    verifyOtp(params: {
      type: 'recovery';
      token_hash: string;
    }): Promise<{ data: unknown; error: AuthErrorLike | null }>;
    updateUser(attributes: {
      password: string;
    }): Promise<{ error: (AuthErrorLike & { readonly reasons?: unknown }) | null }>;
    signOut(options: { scope: 'global' | 'local' }): Promise<{ error: unknown }>;
  };
}

export interface PasswordResetRequestDeps {
  /** A new stateless client; null when Auth is not configured. */
  readonly client: RecoveryClientLike | null;
  readonly logWarning: (message: string, fields: LogFields) => void;
  readonly sleep: (ms: number) => Promise<void>;
  /** Lets the Auth call finish after the answer was sent (Next.js `after()`). */
  readonly keepAlive: (work: Promise<unknown>) => void;
}

export interface PasswordResetDeps {
  /** A new stateless client for this request only; null when Auth is not configured. */
  readonly client: RecoveryClientLike | null;
  readonly logInfo: (message: string, fields: LogFields) => void;
  readonly logWarning: (message: string, fields: LogFields) => void;
  /** Ends this browser's own session cookies, if any (after the reset the visitor signs in again). */
  readonly endBrowserSession: () => Promise<void>;
}

/**
 * Screen 10. Starts the Auth request and answers after RESET_REQUEST_ANSWER_MS, never waiting for Auth:
 * the caller learns nothing from the result or the time taken. `limited`: the application limiter
 * refused this request (per account, per client) — Auth is not asked, the answer is the same.
 */
export async function requestPasswordReset(
  deps: PasswordResetRequestDeps,
  input: { readonly email: string; readonly limited: boolean },
): Promise<void> {
  if (input.limited) {
    deps.logWarning('password reset request limited', {
      action: REQUEST_ACTION,
      reason: 'rate_limited',
    });
  } else {
    deps.keepAlive(sendRecoveryLink(deps, input.email));
  }
  await deps.sleep(RESET_REQUEST_ANSWER_MS);
}

/** Never rejects: every outcome is logged as a code (never the address) and treated as success. */
async function sendRecoveryLink(deps: PasswordResetRequestDeps, email: string): Promise<void> {
  try {
    if (!deps.client) {
      deps.logWarning('password reset requested but Auth is not configured', {
        action: REQUEST_ACTION,
        reason: 'not_configured',
      });
      return;
    }
    const { error } = await deps.client.auth.resetPasswordForEmail(email);
    if (error) {
      deps.logWarning('password reset request not accepted by Auth', {
        action: REQUEST_ACTION,
        ...(error.status === undefined ? {} : { status: error.status }),
        ...(error.code === undefined ? {} : { errorCode: error.code }),
      });
    }
  } catch (error) {
    deps.logWarning('password reset request failed', {
      action: REQUEST_ACTION,
      errorName: error instanceof Error ? error.name : 'unknown',
    });
  }
}

function linkInvalid(): Result<never, AppError> {
  return err(appError(PasswordResetErrors.PASSWORD_RESET_LINK_INVALID));
}

/** Auth's answer to the link: expired, used, unknown or a banned account are one state. */
function verifyRefusal(error: AuthErrorLike): Result<never, AppError> {
  const { status, code } = error;
  // Not used up: the visitor may try the same link again a little later.
  if (status === 429 || code === 'over_request_rate_limit') return err(appError('RATE_LIMITED'));
  if (status === undefined || status === 0 || status >= 500) throw new AuthServiceError(status);
  return linkInvalid();
}

function weakReasons(error: { readonly reasons?: unknown }): readonly unknown[] {
  return Array.isArray(error.reasons) ? error.reasons : [];
}

/** Auth's refusal of the new password; the link is used up by now (single use). */
function passwordRefusal(error: AuthErrorLike & { readonly reasons?: unknown }): AppError {
  const { code } = error;
  if (code === 'same_password') return appError(PasswordResetErrors.PASSWORD_RESET_SAME_PASSWORD);
  if (code === 'weak_password') {
    return appError(
      weakReasons(error).includes('pwned')
        ? PasswordResetErrors.PASSWORD_RESET_BREACHED_PASSWORD
        : PasswordResetErrors.PASSWORD_RESET_WEAK_PASSWORD,
    );
  }
  return appError(PasswordResetErrors.PASSWORD_RESET_PASSWORD_REJECTED);
}

/** The user id Auth returned with the recovery session (for the security log only). */
function userIdOf(data: unknown): string | null {
  const user = typeof data === 'object' && data !== null && 'user' in data ? data.user : null;
  const id = typeof user === 'object' && user !== null && 'id' in user ? user.id : null;
  return typeof id === 'string' ? id : null;
}

/** Ends the recovery session (memory-only); a failure is logged, never shown. */
async function endRecoverySession(
  deps: PasswordResetDeps,
  client: RecoveryClientLike,
  scope: 'global' | 'local',
  userId: string | null,
): Promise<void> {
  let failed: boolean;
  try {
    failed = Boolean((await client.auth.signOut({ scope })).error);
  } catch {
    failed = true;
  }
  if (failed) {
    deps.logWarning(
      scope === 'global'
        ? 'could not end the sessions of the account after a password reset'
        : 'could not end the recovery session after a refused password',
      { action: COMPLETE_ACTION, ...(userId ? { entityType: 'auth_user', entityId: userId } : {}) },
    );
  }
}

/**
 * Screen 11: sets the new password from the e-mailed link. Order matters: the link opens a recovery
 * session (the token is used up), Auth sets the password (its policy applies; a recovery session needs
 * no current password), then EVERY session of the account ends (`global`: Auth already ends the others
 * on a password change; this also closes the recovery session), then the visitor signs in. The password
 * rules (12+ characters, ≤ 72 bytes, confirmation) are checked by the action before the link is used.
 */
export async function completePasswordReset(
  deps: PasswordResetDeps,
  input: { readonly tokenHash: string; readonly password: string },
): Promise<Result<{ readonly next: 'sign-in' }, AppError>> {
  const { client } = deps;
  if (!client) return err(appError('NOT_CONFIGURED'));
  if (!RECOVERY_TOKEN_HASH_PATTERN.test(input.tokenHash)) return linkInvalid();

  const verified = await client.auth.verifyOtp({ type: 'recovery', token_hash: input.tokenHash });
  if (verified.error) return verifyRefusal(verified.error);
  const userId = userIdOf(verified.data);
  if (!sessionTokens(verified.data) || !userId) {
    await endRecoverySession(deps, client, 'local', userId);
    return linkInvalid();
  }

  let updated: Awaited<ReturnType<RecoveryClientLike['auth']['updateUser']>>;
  try {
    updated = await client.auth.updateUser({ password: input.password });
  } catch (error) {
    await endRecoverySession(deps, client, 'local', userId);
    throw error;
  }
  if (updated.error) {
    // The link is used up and the password unchanged: end the recovery session, ask for a new link.
    await endRecoverySession(deps, client, 'local', userId);
    const { status } = updated.error;
    if (status === undefined || status === 0 || status >= 500) throw new AuthServiceError(status);
    deps.logWarning('password reset: Auth refused the new password', {
      action: COMPLETE_ACTION,
      status,
      ...(updated.error.code === undefined ? {} : { errorCode: updated.error.code }),
    });
    return err(passwordRefusal(updated.error));
  }

  await endRecoverySession(deps, client, 'global', userId);
  // Security event (the account may belong to several organizations, so no tenant audit row).
  deps.logInfo('password reset', {
    action: COMPLETE_ACTION,
    outcome: 'success',
    entityType: 'auth_user',
    entityId: userId,
  });
  await deps.endBrowserSession();
  return ok({ next: 'sign-in' });
}
