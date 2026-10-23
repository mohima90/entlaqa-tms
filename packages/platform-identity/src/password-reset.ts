import 'server-only';
import {
  type AppError,
  type Result,
  appError,
  defineErrorCodes,
  err,
  ok,
} from '@jadarat/platform-core';
import { PLATFORM_PASSWORD_MIN_LENGTH } from '@jadarat/platform-db';
import type { LogFields } from '@jadarat/platform-observability';
import { AuthServiceError, sessionTokens } from './auth-flow';
import type { CodeCheckLimit } from './auth-limits';

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
 *   request  → the shared application limiter (per client, then per account — T-M2-11, auth-limits.ts;
 *              a limiter failure counts as limited) → the delivery above. Both run in the background,
 *              never awaited by the answer: the answer comes after a constant time whatever happened (Auth
 *              answers an existing account later, and with 429 to a repeat within a minute — both would
 *              tell that the account exists)
 *   complete → the shared limiter per client (fail closed: the link is not spent) →
 *              verifyOtp(recovery, token_hash) on a STATELESS client: the recovery session lives only in
 *              this request's memory, never in the browser or our session cookies → for an account with an
 *              authenticator app, the code from it (Auth sets a password only from an AAL2 session when
 *              MFA is enabled — GoTrue v2.197.0; T-M2-10) → updateUser(password)
 *              → signOut(global): every session of the account ends, the recovery session included →
 *              security log `platform.auth.password_reset` (user id only) → the account's sign-in lock
 *              ends (the owner proved the mailbox — TM-0003 T-IAM-32), THIS browser becomes trusted (24
 *              hours, or 30 days with «تذكّر هذا المتصفح» ticked) and every other browser the account
 *              trusted is forgotten (T-M2-11 security review M2, re-review N1) → (worker
 *              mode) the "password changed" notice is queued → the visitor signs in
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
  /**
   * Too many attempts with the authenticator code (the reset page's own budget, integration review T-M2-11
   * M1 — or Auth's own limit): the code was not checked and the link is used up. `minutes` in params: when
   * to ask for a new link (the page says it plainly).
   */
  PASSWORD_RESET_CODE_LIMITED: { status: 429, messageKey: 'passwordReset.errors.codeLimited' },
});

/**
 * When to ask for a new link after AUTH's own limit refused the code check (it does not say for how long):
 * the code limiter's window, a wait after which Auth's per-address limits have moved on as well.
 */
export const RESET_CODE_AUTH_LIMIT_WAIT_MINUTES = 15;

function codeLimited(minutes: number): AppError {
  return appError(PasswordResetErrors.PASSWORD_RESET_CODE_LIMITED, {
    params: { minutes: Math.max(1, Math.ceil(minutes)) },
  });
}

/** Server setting: who sends the reset e-mail and the "password changed" notice (T-M2-17). */
export const PASSWORD_RESET_DELIVERY_ENV = 'PASSWORD_RESET_DELIVERY';
/** Auth's Send Email hook secret (WP-ADM-05): set means the hook is on. */
const SEND_EMAIL_HOOK_SECRET_ENV = 'SEND_EMAIL_HOOK_SECRET';
export type PasswordResetDelivery = 'auth' | 'worker' | 'hook';

/**
 * PASSWORD_RESET_DELIVERY: `auth` (default, also when unset or empty) or `worker`. Any other value is a
 * configuration error (thrown at start-up by the app's instrumentation, and on use).
 *
 * With Auth's Send Email hook on (SEND_EMAIL_HOOK_SECRET, WP-ADM-05) Auth's own mailer is not used: set
 * `auth` EXPLICITLY and it is `hook` - Auth creates the recovery token and hands it to the hook, which e-mails
 * the reset link at once (PO 23 Oct 2026; auth-email-hook.ts), no Auth admin key in the web tier. Unset with the
 * hook on stays `worker` (security review M1: the hook path needs the migration of the same release, so it is
 * switched on on purpose, after the database deploy). The "password
 * changed" notice is ours in both (`auth`: Auth's own, when switched on in Auth).
 */
export function readPasswordResetDelivery(
  env: Readonly<Record<string, string | undefined>>,
): PasswordResetDelivery {
  const raw = env[PASSWORD_RESET_DELIVERY_ENV]?.trim() ?? '';
  const hookOn = (env[SEND_EMAIL_HOOK_SECRET_ENV]?.trim() ?? '') !== '';
  if (raw === 'auth') return hookOn ? 'hook' : 'auth';
  // Unset: Auth's own mailer without the hook; with the hook on, the worker as before - the hook path (a newer
  // database function) is chosen only by setting `auth` explicitly, so an app deployed before its migration
  // cannot drop resets (security review M1).
  if (raw === '') return hookOn ? 'worker' : 'auth';
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
  /**
   * The shared limiter (auth-limits.ts createPasswordResetLimiter): per client, then per account; false =
   * limited. May throw when the limiter cannot answer: the request then counts as limited.
   */
  readonly allowRequest: (email: string) => Promise<boolean>;
  readonly logWarning: (message: string, fields: LogFields) => void;
  readonly sleep: (ms: number) => Promise<void>;
  /** Lets the Auth call finish after the answer was sent (Next.js `after()`). */
  readonly keepAlive: (work: Promise<unknown>) => void;
}

export interface PasswordResetDeps {
  /** A new stateless client for this request only; null when Auth is not configured. */
  readonly client: RecoveryClientLike | null;
  /**
   * New-password submissions per client (shared limiter); false = limited (RATE_LIMITED, the link stays
   * usable). Throws RateLimiterUnavailableError when the limiter cannot answer: fail closed, link unspent.
   */
  readonly allowAttempt: () => Promise<boolean>;
  /**
   * After a completed reset: ends the account's sign-in lock, trusts the browser that completed it (its
   * cookie is set) — for 30 days with `remember` («تذكّر هذا المتصفح» ticked on the reset page), else
   * 24 hours — and forgets every other browser the account trusted (auth-limits.ts resetAccountSignIn;
   * security review T-M2-11 M2 — an attacker who keeps the account locked cannot keep its owner out; N1 —
   * no 30-day trust unasked). Never throws.
   */
  readonly unlockSignIn: (email: string, remember: boolean) => Promise<void>;
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
  /**
   * The authenticator code's check for an account with an app (T-M2-10), limited per account and per
   * client like every code (T-M2-11 `withCodeAttemptLimit`, auth-limits.ts CodeCheckLimit).
   */
  readonly limitCodeCheck: CodeCheckLimit;
}

/**
 * Screen 10. Starts the limiter check and then the delivery (Auth's request, or the worker's queue) in the
 * background and answers after RESET_REQUEST_ANSWER_MS, never waiting for either: the caller learns
 * nothing from the result or the time taken. A limited request (per client, per account) — or one the
 * limiter could not answer — starts nothing; the answer is the same.
 */
export async function requestPasswordReset(
  deps: PasswordResetRequestDeps,
  input: { readonly email: string },
): Promise<void> {
  deps.keepAlive(limitThenSend(deps, input.email));
  await deps.sleep(RESET_REQUEST_ANSWER_MS);
}

/** Never rejects. */
async function limitThenSend(deps: PasswordResetRequestDeps, email: string): Promise<void> {
  let allowed: boolean;
  try {
    allowed = await deps.allowRequest(email);
  } catch {
    // Fail closed: no e-mail (the limiter recorded the security event).
    allowed = false;
  }
  if (!allowed) {
    deps.logWarning('password reset request limited', {
      action: REQUEST_ACTION,
      reason: 'rate_limited',
    });
    return;
  }
  await sendRecoveryLink(deps, email);
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
  const appId = factorId;
  // Auth's check of the code, limited per account — on this page's OWN budget (integration review M1:
  // wrong codes after the password, at sign-in, never lock the owner out of resetting it) — and per client
  // like every authenticator code (T-M2-11; TM-0003 T-IAM-12): a limited check never asks Auth. The link
  // is spent by now either way: a limited check answers plainly when to ask for a new one.
  const check = async (): Promise<Result<null, AppError>> => {
    const verified = await client.auth.mfa.challengeAndVerify({ factorId: appId, code });
    if (!verified.error) return ok(null);
    const { status } = verified.error;
    if (status === 429 || verified.error.code === 'over_request_rate_limit') {
      return err(appError('RATE_LIMITED'));
    }
    if (status === undefined || status === 0 || status >= 500) throw new AuthServiceError(status);
    // Logged without the code (review M3); the limiter counts it.
    deps.logWarning('password reset: authenticator code refused', {
      action: COMPLETE_ACTION,
      outcome: 'failure',
      errorCode: PasswordResetErrors.PASSWORD_RESET_CODE_INVALID.code,
    });
    return err(appError(PasswordResetErrors.PASSWORD_RESET_CODE_INVALID));
  };
  let checked: Result<null, AppError>;
  try {
    checked = await deps.limitCodeCheck(userId, check, isWrongResetCode, {
      limited: (retryAfterSeconds) => codeLimited(retryAfterSeconds / 60),
    });
  } catch (error) {
    await endRecoverySession(deps, client, 'local', userId);
    throw error;
  }
  if (checked.ok) return checked;
  await endRecoverySession(deps, client, 'local', userId);
  // Auth's own limit (the code was not compared; the limiter gave the account's failure back): the link
  // is used up all the same — say when to ask for a new one.
  if (checked.error.code === 'RATE_LIMITED') {
    deps.logWarning('password reset: the code check was limited by Auth', {
      action: COMPLETE_ACTION,
      reason: 'auth_service',
      status: 429,
    });
    return err(codeLimited(RESET_CODE_AUTH_LIMIT_WAIT_MINUTES));
  }
  return checked;
}

/** A wrong authenticator code on the reset page — what the code limiter counts as a failure. */
const isWrongResetCode = (error: AppError) =>
  error.code === PasswordResetErrors.PASSWORD_RESET_CODE_INVALID.code;

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

/** The user Auth returned with the recovery session: its id (security log) and e-mail (unlock). */
function userOf(data: unknown): { readonly id: string | null; readonly email: string | null } {
  const user = typeof data === 'object' && data !== null && 'user' in data ? data.user : null;
  const field = (name: 'id' | 'email') => {
    const value =
      typeof user === 'object' && user !== null && name in user
        ? (user as Record<string, unknown>)[name]
        : null;
    return typeof value === 'string' && value !== '' ? value : null;
  };
  return { id: field('id'), email: field('email') };
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
    /** «تذكّر هذا المتصفح» ticked on the reset page (default: not). */
    readonly remember?: boolean;
  },
): Promise<Result<{ readonly next: 'sign-in' }, AppError>> {
  const { client } = deps;
  if (!client) return err(appError('NOT_CONFIGURED'));
  // Below the platform's minimum (12 characters as people count them — an emoji is one): refused before it
  // is counted or the link is spent, as the action's own check does (integration review, 5c).
  if (Array.from(input.password).length < PLATFORM_PASSWORD_MIN_LENGTH) {
    return err(
      appError('VALIDATION_FAILED', {
        fieldErrors: [
          {
            path: 'password',
            code: 'TOO_SMALL',
            params: { minimum: PLATFORM_PASSWORD_MIN_LENGTH },
          },
        ],
      }),
    );
  }
  // Every other submission counts, malformed links included; nothing is spent when limited.
  if (!(await deps.allowAttempt())) return err(appError('RATE_LIMITED'));
  if (!RECOVERY_TOKEN_HASH_PATTERN.test(input.tokenHash)) return linkInvalid();

  const verified = await client.auth.verifyOtp({ type: 'recovery', token_hash: input.tokenHash });
  if (verified.error) return verifyRefusal(verified.error);
  const { id: userId, email: accountEmail } = userOf(verified.data);
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
  // The owner proved control of the mailbox: a sign-in lock on the account ends, this browser is trusted
  // for it, and every other browser it trusted must be remembered again (T-M2-11, PO decision 9 Oct 2026;
  // security review M2).
  if (accountEmail) await deps.unlockSignIn(accountEmail, input.remember === true);
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
