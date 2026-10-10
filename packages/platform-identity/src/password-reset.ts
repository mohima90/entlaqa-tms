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
 * Forgot / reset password (FR-IAM-13, NFR-SEC-01; T-M2-08, screens 10 and 11) on Supabase Auth's
 * recovery tokens: single use, expired after `otp_exp` (3600 s = 60 minutes). The e-mailed link is
 * `{site}/{ar|en}/reset-password#token_hash=…&type=recovery`: the token travels in the URL FRAGMENT,
 * never sent to the server with a page request (as for invitations, review M3), and loading the page
 * verifies nothing (link scanners cannot use the token up). Framework-free like auth-flow.ts; the
 * Next.js adapter is auth-next.ts and the public actions are in apps/suite/src/auth/password-reset.ts.
 * Design and GoTrue findings: docs/engineering/password-reset.md.
 *
 * Who sends the e-mails is the server setting PASSWORD_RESET_DELIVERY (T-M2-17, BRD v2.5 FR-NTF-02):
 *   `auth`   (default) Supabase Auth's own mailer: resetPasswordForEmail(email) on a STATELESS client (no
 *            PKCE: a code challenge does not protect the token_hash path); Auth also sends its own
 *            "password changed" notice when that is switched on in Auth.
 *   `worker` our notification service: the request is queued in the database UNCONDITIONALLY (the
 *            worker decides whether an account exists, creates the token through the Auth admin API —
 *            held by the worker only — and e-mails it in the organization's language and brand); after a
 *            completed reset (and a My profile change) the "password changed" notice is queued too.
 *
 *   request  → (application limiter, decided by the action) → the delivery above — started at once, never
 *              awaited by the answer: the answer comes after a constant time whatever happened (Auth
 *              answers an existing account later, and with 429 to a repeat within a minute — both would
 *              tell that the account exists)
 *   complete → verifyOtp(recovery, token_hash) on a STATELESS client: the recovery session lives only in
 *              this request's memory, never in the browser or our session cookies → for an account with an
 *              authenticator app, the code from it (Auth sets a password only from an AAL2 session when
 *              MFA is enabled — GoTrue v2.197.0; T-M2-10) → updateUser(password)
 *              → signOut(global): every session of the account ends, the recovery session included →
 *              security log `platform.auth.password_reset` (user id only) → (worker mode) the "password
 *              changed" notice is queued → the visitor signs in
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
  /**
   * Shorter than the strictest minimum of the account's organizations (T-M2-10, PO decision 5; `min` in
   * params). Known only once the link has identified the account, i.e. after it was spent.
   */
  PASSWORD_RESET_TOO_SHORT: { status: 422, messageKey: 'passwordReset.errors.tooShort' },
  /**
   * The account uses an authenticator app and no code came with the new password (T-M2-10): the link is
   * used up; a new one asks for the code (the worker's e-mail says so).
   */
  PASSWORD_RESET_CODE_REQUIRED: { status: 422, messageKey: 'passwordReset.errors.codeRequired' },
  /** The authenticator code was wrong or expired; the link is used up (single use): ask for a new one. */
  PASSWORD_RESET_CODE_INVALID: { status: 422, messageKey: 'passwordReset.errors.codeInvalid' },
});

/** Server setting: who sends the reset e-mail and the "password changed" notice (T-M2-17). */
export const PASSWORD_RESET_DELIVERY_ENV = 'PASSWORD_RESET_DELIVERY';
export type PasswordResetDelivery = 'auth' | 'worker';

/**
 * PASSWORD_RESET_DELIVERY: `auth` (default, also when unset or empty) or `worker`. Any other value is a
 * configuration error (thrown at start-up by the app's instrumentation, and on use).
 */
export function readPasswordResetDelivery(
  env: Readonly<Record<string, string | undefined>>,
): PasswordResetDelivery {
  const raw = env[PASSWORD_RESET_DELIVERY_ENV]?.trim() ?? '';
  if (raw === '' || raw === 'auth') return 'auth';
  if (raw === 'worker') return 'worker';
  throw new Error(`${PASSWORD_RESET_DELIVERY_ENV} must be "auth" or "worker"`);
}

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
    readonly mfa: {
      listFactors(): Promise<{
        data: {
          readonly all: readonly {
            readonly id: string;
            readonly factor_type?: string;
            readonly status?: string;
          }[];
        } | null;
        error: AuthErrorLike | null;
      }>;
      challengeAndVerify(params: {
        factorId: string;
        code: string;
      }): Promise<{ data: unknown; error: AuthErrorLike | null }>;
    };
  };
}

/**
 * How the reset e-mail is sent: by Auth's own mailer (a new stateless client; null when Auth is not
 * configured), or queued for the worker (our notification service; never tells anything back).
 */
export type ResetEmailDelivery =
  | { readonly mode: 'auth'; readonly client: RecoveryClientLike | null }
  | { readonly mode: 'worker'; readonly enqueue: (email: string) => Promise<void> };

export interface PasswordResetRequestDeps {
  readonly delivery: ResetEmailDelivery;
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
  /**
   * Worker mode (T-M2-17): queues the account's "password changed" notice for our notification
   * service. Absent in `auth` mode (Auth sends its own notice when switched on there).
   */
  readonly queuePasswordChangedNotice?: (userId: string) => Promise<void>;
  /**
   * The account's minimum password length (strictest of its organizations, T-M2-10), asked with the
   * recovery session's access token; null when unknown (the platform's 12 applies, Auth enforces it).
   */
  readonly passwordMinLength?: (accessToken: string) => Promise<number | null>;
}

/**
 * Screen 10. Starts the delivery (Auth's request, or the worker's queue) and answers after
 * RESET_REQUEST_ANSWER_MS, never waiting for it: the caller learns nothing from the result or the time
 * taken. `limited`: the application limiter refused this request (per account, per client) — nothing is
 * started, the answer is the same.
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
  const { delivery } = deps;
  if (delivery.mode === 'worker') {
    try {
      // Unconditional: the database records the request whether or not an account exists.
      await delivery.enqueue(email);
    } catch (error) {
      deps.logWarning('password reset request could not be queued', {
        action: REQUEST_ACTION,
        reason: 'enqueue_failed',
        errorName: error instanceof Error ? error.name : 'unknown',
      });
    }
    return;
  }
  try {
    if (!delivery.client) {
      deps.logWarning('password reset requested but Auth is not configured', {
        action: REQUEST_ACTION,
        reason: 'not_configured',
      });
      return;
    }
    const { error } = await delivery.client.auth.resetPasswordForEmail(email);
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

/**
 * The code from the account's verified authenticator app, on the recovery session (T-M2-10). Nothing to do
 * for an account without one (a code given anyway is ignored). On a refusal the recovery session ends.
 */
async function secondFactor(
  deps: PasswordResetDeps,
  client: RecoveryClientLike,
  userId: string,
  code: string | undefined,
): Promise<Result<null, AppError>> {
  let factorId: string | undefined;
  try {
    const listed = await client.auth.mfa.listFactors();
    if (listed.error) {
      const { status } = listed.error;
      if (status === undefined || status === 0 || status >= 500) throw new AuthServiceError(status);
      await endRecoverySession(deps, client, 'local', userId);
      return linkInvalid();
    }
    factorId = listed.data?.all.find(
      (f) => f.factor_type === 'totp' && f.status === 'verified',
    )?.id;
  } catch (error) {
    await endRecoverySession(deps, client, 'local', userId);
    throw error;
  }
  if (factorId === undefined) return ok(null);
  if (code === undefined) {
    await endRecoverySession(deps, client, 'local', userId);
    deps.logWarning('password reset: the authenticator code is needed', {
      action: COMPLETE_ACTION,
      reason: 'code_required',
    });
    return err(appError(PasswordResetErrors.PASSWORD_RESET_CODE_REQUIRED));
  }
  let verified: Awaited<ReturnType<RecoveryClientLike['auth']['mfa']['challengeAndVerify']>>;
  try {
    verified = await client.auth.mfa.challengeAndVerify({ factorId, code });
  } catch (error) {
    await endRecoverySession(deps, client, 'local', userId);
    throw error;
  }
  if (!verified.error) return ok(null);
  await endRecoverySession(deps, client, 'local', userId);
  const { status } = verified.error;
  if (status === 429 || verified.error.code === 'over_request_rate_limit') {
    return err(appError('RATE_LIMITED'));
  }
  if (status === undefined || status === 0 || status >= 500) throw new AuthServiceError(status);
  // Logged without the code (review M3: T-M2-11 counts refused codes).
  deps.logWarning('password reset: authenticator code refused', {
    action: COMPLETE_ACTION,
    outcome: 'failure',
    errorCode: PasswordResetErrors.PASSWORD_RESET_CODE_INVALID.code,
  });
  return err(appError(PasswordResetErrors.PASSWORD_RESET_CODE_INVALID));
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
  input: {
    readonly tokenHash: string;
    readonly password: string;
    /** The code from the account's authenticator app (asked when the link says the account has one). */
    readonly code?: string | undefined;
  },
): Promise<Result<{ readonly next: 'sign-in' }, AppError>> {
  const { client } = deps;
  if (!client) return err(appError('NOT_CONFIGURED'));
  if (!RECOVERY_TOKEN_HASH_PATTERN.test(input.tokenHash)) return linkInvalid();

  const verified = await client.auth.verifyOtp({ type: 'recovery', token_hash: input.tokenHash });
  if (verified.error) return verifyRefusal(verified.error);
  const userId = userIdOf(verified.data);
  const tokens = sessionTokens(verified.data);
  if (!tokens || !userId) {
    await endRecoverySession(deps, client, 'local', userId);
    return linkInvalid();
  }

  // An account with an authenticator app: Auth sets the password only from an AAL2 session, so the code
  // first (on the same in-memory recovery session).
  const second = await secondFactor(deps, client, userId, input.code);
  if (!second.ok) return second;

  // Strictest wins (PO decision 5): the account's organizations decide the minimum, known only now.
  if (deps.passwordMinLength) {
    let min: number | null;
    try {
      min = await deps.passwordMinLength(tokens.accessToken);
    } catch (error) {
      await endRecoverySession(deps, client, 'local', userId);
      throw error;
    }
    if (min !== null && Array.from(input.password).length < min) {
      await endRecoverySession(deps, client, 'local', userId);
      deps.logWarning("password reset: shorter than the account's minimum", {
        action: COMPLETE_ACTION,
        reason: 'too_short',
      });
      return err(appError(PasswordResetErrors.PASSWORD_RESET_TOO_SHORT, { params: { min } }));
    }
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
    if (updated.error.code === 'insufficient_aal') {
      // An app Auth counts that the list above did not show (set up meanwhile): the code is needed.
      return err(appError(PasswordResetErrors.PASSWORD_RESET_CODE_REQUIRED));
    }
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
  if (deps.queuePasswordChangedNotice) {
    try {
      await deps.queuePasswordChangedNotice(userId);
    } catch (error) {
      // The password has changed: the notice is best effort, the reset still succeeds.
      deps.logWarning('password changed notice could not be queued', {
        action: COMPLETE_ACTION,
        reason: 'notice_not_queued',
        errorName: error instanceof Error ? error.name : 'unknown',
        entityType: 'auth_user',
        entityId: userId,
      });
    }
  }
  await deps.endBrowserSession();
  return ok({ next: 'sign-in' });
}
