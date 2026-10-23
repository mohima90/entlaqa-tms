import 'server-only';
import {
  type AppError,
  type Result,
  type VerifiedClaims,
  appError,
  err,
  ok,
} from '@jadarat/platform-core';
import type { UserTx } from '@jadarat/platform-db';
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
 * functions. The code is Supabase Auth's own e-mail OTP (6 digits, 10 minutes, single use), e-mailed AT ONCE
 * by the app's Send Email hook (auth-email-hook.ts) - the web app holds no Auth secret key.
 *
 *   request  → our limits first (client, address, a minute apart, a day) → `signInWithOtp({ shouldCreateUser:
 *              false })` in the background → the answer is the same at once for every address (an unknown one
 *              gets no e-mail and no error); Auth calls the hook for an account, which sends the code
 *   verify   → the code limiter (5 wrong codes per address pause checks for 15 minutes, the length of the
 *              code's life; a ceiling for all clients together) → `verifyOtp({ email, token, type: 'email' })`
 *              opens the session (cookies written) → the same continuation as after a password:
 *              organizations, then the organization's MFA policy. When MFA applies the second step is the
 *              authenticator app - never a second e-mailed code - exactly as after a password.
 *   keep     → «Remember this browser» ticked = «keep me signed in»: the session cookies last, and the
 *              database keeps the session alive for the strictest organization's period (Off / 1 / 7 / 14 /
 *              30 days); not ticked: the session cookies end with the browser. There is no sign-in without a
 *              code: a kept session is an ordinary Auth session.
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
  /** Keeps the current session for the strictest organization's days; 0 = nothing kept (an organization has it Off). */
  readonly keepSession: (tx: UserTx) => Promise<number>;
  /** The cookie lifetime of THIS request's session cookies: persistent (kept) or null = until the browser closes. */
  readonly setSessionCookieLifetime: (kept: boolean) => void;
  /** Marks (or unmarks) this browser as keeping its session: later refreshes keep the cookies persistent. */
  readonly setKeepMarker: (kept: boolean) => void;
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
 * Opens the session with the code. Auth refuses a wrong, expired, used or replaced code with the same 4xx
 * (it does not say which): a counted wrong code. Its own limit (429) is not the code's fault; anything else
 * is thrown (the generic internal error with a reference).
 */
async function openSession(
  deps: SignInCodeDeps,
  input: { readonly email: string; readonly code: string },
): Promise<
  | { readonly kind: 'session'; readonly session: PasswordSession }
  | { readonly kind: 'wrong' }
  | { readonly kind: 'limited' }
  | { readonly kind: 'failed'; readonly error: AppError }
> {
  const { supabase } = deps;
  if (!supabase) return { kind: 'failed', error: appError('NOT_CONFIGURED') };
  const { data, error } = await supabase.auth.verifyOtp({
    email: input.email,
    token: input.code,
    type: 'email',
  });
  if (error) {
    if (error.status === 429) return { kind: 'limited' };
    if (error.status !== undefined && error.status >= 400 && error.status < 500) {
      return { kind: 'wrong' };
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
 * «Remember this browser» ticked: the session is kept for the strictest organization's days. Best effort: a
 * failure never blocks the sign-in (the session then follows the organization's normal rules).
 */
async function keepThisSession(deps: SignInCodeDeps, claims: VerifiedClaims): Promise<void> {
  try {
    const days = await deps.withUserTx(claims, (tx) => deps.keepSession(tx));
    deps.setKeepMarker(days > 0);
  } catch {
    deps.logWarning('could not keep the session', { action: 'platform.auth.sign_in_code' });
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
  // Signing in replaces whoever was signed in on this browser: the cookies below take the new session's place.
  deps.setKeepMarker(false);
  deps.setSessionCookieLifetime(input.remember);
  let opened: Awaited<ReturnType<typeof openSession>>;
  try {
    opened = await openSession(deps, input);
  } catch (error) {
    await gate.attempt.released();
    throw error;
  }
  if (opened.kind === 'wrong') {
    const killed = gate.attempt.triesIfWrong === 0;
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
  if (input.remember) await keepThisSession(deps, session.claims);
  return continueAfterFirstStep(deps, session);
}
