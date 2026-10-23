import 'server-only';
import {
  type AppError,
  type Result,
  type VerifiedClaims,
  appError,
  err,
  ok,
} from '@jadarat/platform-core';
import type { UserTx, VerifiedSignInCode } from '@jadarat/platform-db';
import {
  type AuthFlowDeps,
  AuthServiceError,
  IdentityErrors,
  type PasswordSession,
  type SignInOutcome,
  continueAfterFirstStep,
  sessionTokens,
} from './auth-flow';
import type { SignInCodeLimiter } from './sign-in-code-limits';
import { verifyClaims } from './verify-claims';

/**
 * Sign in with an e-mailed code (WP-ADM-05, FR-IAM-12; business flow EP-AUTH-signin-extras, PO 21 and 23 Oct
 * 2026): a second way to sign in INSTEAD of the password, offered to everybody on the password step.
 * Framework-free; the Next.js adapter (auth-next.ts) supplies the clients, the cookies and the database
 * functions.
 *
 * THE CODE IS OURS, NOT AUTH'S (security re-review H1). `signInWithOtp` makes Auth issue a sign-in and call the
 * Send Email hook (auth-email-hook.ts), which e-mails a six-digit code of its own at once and stores its keyed
 * hash with Auth's encrypted `token_hash`. Auth's own one-time password (10 digits) is never e-mailed - a short
 * code Auth would accept could be guessed against Auth's public /verify, where no limiter of ours runs. The
 * web app holds no Auth secret key.
 *
 *   request  → our limits first (client, address, a minute apart, a day) → `signInWithOtp({ shouldCreateUser:
 *              false })` in the background → the answer is the same at once for every address (an unknown one
 *              gets no e-mail and no error); Auth calls the hook for an account, which sends the code
 *   verify   → the code limiter (5 wrong codes per address pause checks for 15 minutes, the length of the
 *              code's life; a ceiling for all clients together) → OUR check in the database (5 wrong tries
 *              remove the code; a right one is removed and releases the sealed token hash once) →
 *              `verifyOtp({ token_hash, type })` opens the session (cookies written) → the same continuation
 *              as after a password: organizations, then the organization's MFA policy. When MFA applies the
 *              second step is the authenticator app - never a second e-mailed code - exactly as after a
 *              password.
 *   keep     → «Remember this browser» ticked = «keep me signed in»: once the sign-in is FINISHED (an
 *              organization selected and its second step, if any, passed - re-review L3) the database keeps
 *              the session alive for the strictest organization's period (Off / 1 / 7 / 14 / 30 days) and
 *              the session cookies become persistent; until then the cookies end with the browser (L2: they
 *              are never persistent before the policy is known). Not ticked: they end with the browser. There
 *              is no sign-in without a code: a kept session is an ordinary Auth session.
 *
 * Nothing here logs or returns a code, or whether an address has an account.
 */

export interface SignInCodeDeps extends AuthFlowDeps {
  readonly limiter: SignInCodeLimiter;
  /**
   * Asks Auth to e-mail a code (`signInWithOtp`, existing users only) on a client WITHOUT the browser's session.
   * Resolves with Auth's status (undefined: the call itself failed); never rejects.
   */
  readonly requestOtp: (email: string) => Promise<{ readonly status: number | undefined }>;
  /**
   * Checks a typed code in the database (private.verify_sign_in_code): a right one is removed and releases the
   * sealed Auth token hash once; the 5th wrong try removes the code.
   */
  readonly verifyCode: (email: string, code: string) => Promise<VerifiedSignInCode>;
  /** Opens the sealed token hash (it was encrypted for this account); null when it cannot be opened. */
  readonly openTokenHash: (userId: string, sealed: string) => string | null;
  /**
   * Keeps the current session for the strictest organization's days; 0 = nothing kept (an organization has it
   * Off, or the sign-in is not finished: no organization yet, or a second step pending).
   */
  readonly keepSession: (tx: UserTx) => Promise<number>;
  /** The cookie lifetime of THIS request's session cookies: persistent (kept) or null = until the browser closes. */
  readonly setSessionCookieLifetime: (kept: boolean) => void;
  /**
   * Marks (or unmarks) this browser as keeping its session: the session cookies already written in this request
   * become persistent, and later refreshes keep them so.
   */
  readonly setKeepMarker: (kept: boolean) => void;
  /**
   * Remembers (or forgets) that «Remember this browser» was ticked while the sign-in is not finished yet (the
   * organization chooser, the second step): the keep is completed afterwards (auth-next completePendingKeep).
   */
  readonly setKeepPending: (pending: boolean) => void;
  /** Audits a refused code in the account's organizations (nothing for an address without an account). */
  readonly auditRefused: (email: string, killed: boolean) => Promise<void>;
  /** Runs `work` after the answer (the platform's `after()`), within the request's budget. */
  readonly keepAlive: (work: Promise<unknown>) => void;
}

/** What the screen needs after «Email me a code». The same for every address. */
export interface SignInCodeStart {
  readonly resendAfterSeconds: number;
}

/** The seconds before a new code may be asked for: one a minute per address. */
export const SIGN_IN_CODE_RESEND_SECONDS = 60;

export async function requestSignInCode(
  deps: SignInCodeDeps,
  input: { readonly email: string },
): Promise<Result<SignInCodeStart, AppError>> {
  const verdict = await deps.limiter.allowRequest(input.email);
  if (!verdict.allowed) {
    if (verdict.tooSoonSeconds !== undefined) {
      return err(
        appError(IdentityErrors.SIGN_IN_CODE_TOO_SOON, {
          params: {
            seconds: Math.min(Math.max(verdict.tooSoonSeconds, 1), SIGN_IN_CODE_RESEND_SECONDS),
          },
        }),
      );
    }
    return err(appError('RATE_LIMITED'));
  }
  // In the background: Auth answers an unknown address at once and an account only after the hook sent the
  // e-mail - the caller learns nothing from the result or the time taken (the answer here is immediate).
  deps.keepAlive(
    deps.requestOtp(input.email).then((outcome) => {
      const { status } = outcome;
      // An unknown address (Auth refuses to create a user) is the normal case: nothing to log.
      if (status === undefined || status >= 500 || status === 429) {
        deps.logWarning('sign-in code request not accepted by Auth', {
          action: 'platform.auth.sign_in_code_request',
          reason: status === undefined ? 'unreachable' : 'auth_service',
          ...(status === undefined ? {} : { status }),
        });
      }
    }),
  );
  return ok({ resendAfterSeconds: SIGN_IN_CODE_RESEND_SECONDS });
}

/** The tries left on the screen: `tries` in the params of SIGN_IN_CODE_INVALID. */
function wrongCode(triesLeft: number): AppError {
  return triesLeft > 0
    ? appError(IdentityErrors.SIGN_IN_CODE_INVALID, { params: { tries: triesLeft } })
    : appError(IdentityErrors.SIGN_IN_CODE_LOCKED);
}

/**
 * Checks the typed code and opens the session. OUR database check comes first (a wrong, expired, used or
 * replaced code is the same refusal, and the 5th wrong try removes the code); only a right code releases the
 * sealed Auth token hash, which Auth then redeems. Auth's refusal of that hash (4xx) is a refusal like the
 * others; its own limit (429) is not the code's fault; anything else is thrown (the generic internal error with
 * a reference).
 */
async function openSession(
  deps: SignInCodeDeps,
  input: { readonly email: string; readonly code: string },
): Promise<
  | { readonly kind: 'session'; readonly session: PasswordSession }
  | { readonly kind: 'wrong'; readonly killed: boolean }
  | { readonly kind: 'limited' }
  | { readonly kind: 'failed'; readonly error: AppError }
> {
  const { supabase } = deps;
  if (!supabase) return { kind: 'failed', error: appError('NOT_CONFIGURED') };
  const checked = await deps.verifyCode(input.email, input.code);
  if (checked.outcome !== 'ok') {
    return { kind: 'wrong', killed: checked.outcome === 'killed' };
  }
  const tokenHash = deps.openTokenHash(checked.userId, checked.sealedTokenHash);
  // A code from before the hook secret changed: nothing can open it - a new code is needed.
  if (tokenHash === null) return { kind: 'wrong', killed: false };
  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: checked.actionType,
  });
  if (error) {
    if (error.status === 429) return { kind: 'limited' };
    if (error.status !== undefined && error.status >= 400 && error.status < 500) {
      return { kind: 'wrong', killed: false };
    }
    throw new AuthServiceError(error.status);
  }
  const tokens = sessionTokens(data);
  if (!tokens) return { kind: 'failed', error: appError('UNAUTHENTICATED') };
  const claims = await verifyClaims(supabase, tokens.accessToken);
  if (!claims.ok) return { kind: 'failed', error: claims.error };
  return { kind: 'session', session: { tokens, claims: claims.value } };
}

/**
 * «Remember this browser» ticked and the sign-in finished: the session is kept for the strictest organization's
 * days (the database refuses while an organization is not selected or its second step is pending). Best
 * effort: a failure never blocks the sign-in (the session then follows the organization's normal rules).
 */
export async function keepThisSession(
  deps: Pick<SignInCodeDeps, 'withUserTx' | 'keepSession' | 'setKeepMarker' | 'logWarning'>,
  claims: VerifiedClaims,
): Promise<boolean> {
  try {
    const days = await deps.withUserTx(claims, (tx) => deps.keepSession(tx));
    deps.setKeepMarker(days > 0);
    return days > 0;
  } catch {
    deps.logWarning('could not keep the session', { action: 'platform.auth.sign_in_code' });
    return false;
  }
}

export async function signInWithEmailedCode(
  deps: SignInCodeDeps,
  input: {
    readonly email: string;
    readonly code: string;
    readonly remember: boolean;
  },
): Promise<Result<SignInOutcome, AppError>> {
  const gate = await deps.limiter.checkCode(input.email);
  if (!gate.allowed) return err(appError(IdentityErrors.SIGN_IN_CODE_LOCKED));
  const { supabase } = deps;
  if (!supabase) {
    await gate.attempt.released();
    return err(appError('NOT_CONFIGURED'));
  }
  // Signing in replaces whoever was signed in on this browser: the cookies below take the new session's place,
  // and they end with the browser until the keep is decided - never persistent before the policy is known (L2).
  deps.setKeepMarker(false);
  deps.setKeepPending(false);
  deps.setSessionCookieLifetime(false);
  let opened: Awaited<ReturnType<typeof openSession>>;
  try {
    opened = await openSession(deps, input);
  } catch (error) {
    await gate.attempt.released();
    throw error;
  }
  if (opened.kind === 'wrong') {
    const killed = gate.attempt.triesIfWrong === 0 || opened.killed;
    await gate.attempt.failed();
    try {
      await deps.auditRefused(input.email, killed);
    } catch {
      deps.logWarning('could not audit a refused sign-in code', {
        action: 'platform.auth.sign_in_code_verify',
      });
    }
    return err(wrongCode(gate.attempt.triesIfWrong));
  }
  if (opened.kind === 'limited') {
    await gate.attempt.released();
    return err(appError('RATE_LIMITED'));
  }
  if (opened.kind === 'failed') {
    await gate.attempt.released();
    return err(opened.error);
  }
  await gate.attempt.succeeded();
  const { session } = opened;
  const outcome = await continueAfterFirstStep(deps, session);
  if (input.remember && outcome.ok) {
    // L3: kept only once the sign-in is finished. At the chooser or the second step it is completed later.
    if (outcome.value.next === 'home') await keepThisSession(deps, session.claims);
    else if (outcome.value.next !== 'platform') deps.setKeepPending(true);
  }
  return outcome;
}
