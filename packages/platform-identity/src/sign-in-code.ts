import 'server-only';
import {
  type AppError,
  type Result,
  type VerifiedClaims,
  appError,
  err,
  ok,
} from '@jadarat/platform-core';
import type {
  RememberedSignInTake,
  SignInCodeCheck,
  SignInCodeRequest,
  UserTx,
} from '@jadarat/platform-db';
import {
  type AuthFlowDeps,
  AuthServiceError,
  IdentityErrors,
  type PasswordSession,
  type SignInOutcome,
  continueAfterFirstStep,
  sessionTokens,
} from './auth-flow';
import { DEVICE_TOKEN_PATTERN, newDeviceToken } from './auth-limits';
import { type SignInCodeLimiter, rememberedBrowserHash } from './sign-in-code-limits';
import { verifyClaims } from './verify-claims';

/**
 * Sign in with an e-mailed code (WP-ADM-05, FR-IAM-12; business flow EP-AUTH-signin-extras, PO 23 Oct 2026):
 * a second way to sign in INSTEAD of the password, offered to everybody on the password step. Framework-free;
 * the Next.js adapter (auth-next.ts) supplies the client, the cookie and the platform-db functions.
 *
 *   request  → limits (client, address) → the database queues a request for ANY address (no account lookup) and
 *              answers the same for all; the worker decides whether an account exists, mints a one-time Auth
 *              sign-in token (the Auth secret key is the worker's alone, ADR 0002 §7), generates the code, stores
 *              its keyed hash and the token, and e-mails the code through the organization's own sender (else the
 *              platform's)
 *   verify   → the code limiter (5 wrong codes pause checks for 15 minutes) → the database checks the keyed
 *              hash (5 tries kill the code; single use; 10 minutes) and hands out the token once →
 *              `verifyOtp` opens the session (cookies written) → the same continuation as after a password:
 *              organizations, then the organization's MFA policy. When MFA applies the second step is the
 *              authenticator app - never a second e-mailed code - exactly as after a password.
 *   remember → with «Remember this browser» ticked and the organizations allowing it, the browser gets a random
 *              256-bit token in an HttpOnly cookie (only its SHA-256 is stored, per person and organization);
 *              on that browser «Email me a code» then signs in WITHOUT a code for the period the strictest
 *              organization of the person chose. The worker still mints the token, so the web app polls briefly.
 *
 * Nothing here logs or returns a code, a token or whether an address has an account.
 */

/** The remembered-browser cookie (auth-next.ts: HttpOnly, Secure, SameSite=Lax, `__Host-` prefix). */
export interface RememberedBrowserCookie {
  /** The browser's token when it sent a well-formed one, else null. */
  read(): string | null;
  /** Sets the cookie for `maxAgeSeconds`. */
  write(token: string, maxAgeSeconds: number): void;
}

/** The remembered-browser cookie lives at most as long as the longest period an organization can choose. */
export const REMEMBERED_BROWSER_COOKIE_SECONDS = 30 * 24 * 60 * 60;

export interface SignInCodeDeps extends AuthFlowDeps {
  readonly limiter: SignInCodeLimiter;
  readonly codes: {
    readonly request: (
      email: string,
      rememberHash: Uint8Array | null,
    ) => Promise<SignInCodeRequest>;
    readonly verify: (requestId: string, email: string, code: string) => Promise<SignInCodeCheck>;
    readonly takeRemembered: (
      requestId: string,
      email: string,
      rememberHash: Uint8Array,
    ) => Promise<RememberedSignInTake>;
  };
  readonly rememberBrowser: (
    tx: UserTx,
    tokenHash: Uint8Array,
    label: string | null,
  ) => Promise<number>;
  readonly cookie: RememberedBrowserCookie;
  /** "Chrome on Windows" from the request's user agent (well-known names only), or null. */
  readonly browserLabel: () => string | null;
  /** Called after a request was queued: asks the worker for a pass (best effort). */
  readonly kickWorker: () => void;
}

/** What the screen needs after «Email me a code». The same for every address. */
export type SignInCodeStart =
  | { readonly kind: 'code'; readonly requestId: string; readonly resendAfterSeconds: number }
  /** This browser is remembered for this account: no code; finish with `completeRememberedSignIn`. */
  | { readonly kind: 'remembered'; readonly requestId: string };

/** The seconds before a new code may be asked for: the database's one-a-minute rule. */
export const SIGN_IN_CODE_RESEND_SECONDS = 60;

export async function requestSignInCode(
  deps: SignInCodeDeps,
  input: { readonly email: string; readonly forceCode?: boolean },
): Promise<Result<SignInCodeStart, AppError>> {
  if (!(await deps.limiter.allowRequest(input.email))) return err(appError('RATE_LIMITED'));
  const token = input.forceCode ? null : deps.cookie.read();
  const answer = await deps.codes.request(input.email, token ? rememberedBrowserHash(token) : null);
  if (answer.outcome === 'too_soon') {
    return err(
      appError(IdentityErrors.SIGN_IN_CODE_TOO_SOON, {
        params: { seconds: answer.retryAfterSeconds },
      }),
    );
  }
  deps.kickWorker();
  return ok(
    answer.outcome === 'remembered'
      ? { kind: 'remembered', requestId: answer.requestId }
      : {
          kind: 'code',
          requestId: answer.requestId,
          resendAfterSeconds: SIGN_IN_CODE_RESEND_SECONDS,
        },
  );
}

/**
 * Opens the session with the one-time token the worker minted. A token Auth refuses (used, expired, replaced by
 * a password reset - they share Auth's one-time slot) reads as an expired code; Auth's own limit as RATE_LIMITED;
 * anything else is thrown (the generic internal error with a reference).
 */
async function openSession(
  deps: SignInCodeDeps,
  linkToken: string,
): Promise<Result<PasswordSession, AppError>> {
  const { supabase } = deps;
  if (!supabase) return err(appError('NOT_CONFIGURED'));
  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: linkToken,
    type: 'magiclink',
  });
  if (error) {
    if (error.status === 429) return err(appError('RATE_LIMITED'));
    if (error.status !== undefined && error.status >= 400 && error.status < 500) {
      return err(appError(IdentityErrors.SIGN_IN_CODE_EXPIRED));
    }
    throw new AuthServiceError(error.status);
  }
  const tokens = sessionTokens(data);
  if (!tokens) return err(appError('UNAUTHENTICATED'));
  const claims = await verifyClaims(supabase, tokens.accessToken);
  if (!claims.ok) return claims;
  return ok({ tokens, claims: claims.value });
}

/**
 * «Remember this browser» ticked on the code screen: remembers the browser in every organization of the
 * account (none when any has the setting Off) and writes the cookie only when something was remembered.
 * Best effort: a failure never blocks the sign-in.
 */
async function rememberThisBrowser(deps: SignInCodeDeps, claims: VerifiedClaims): Promise<void> {
  try {
    const existing = deps.cookie.read();
    const token = existing && DEVICE_TOKEN_PATTERN.test(existing) ? existing : newDeviceToken();
    const remembered = await deps.withUserTx(claims, (tx) =>
      deps.rememberBrowser(tx, rememberedBrowserHash(token), deps.browserLabel()),
    );
    if (remembered > 0) deps.cookie.write(token, REMEMBERED_BROWSER_COOKIE_SECONDS);
  } catch {
    deps.logWarning('could not remember the browser', { action: 'platform.auth.sign_in_code' });
  }
}

/** The tries left on the screen: `tries` in the params of SIGN_IN_CODE_INVALID. */
function wrongCode(triesLeft: number): AppError {
  return triesLeft > 0
    ? appError(IdentityErrors.SIGN_IN_CODE_INVALID, { params: { tries: triesLeft } })
    : appError(IdentityErrors.SIGN_IN_CODE_LOCKED);
}

export async function signInWithEmailedCode(
  deps: SignInCodeDeps,
  input: {
    readonly requestId: string;
    readonly email: string;
    readonly code: string;
    readonly remember: boolean;
  },
): Promise<Result<SignInOutcome, AppError>> {
  const gate = await deps.limiter.checkCode(input.email);
  if (!gate.allowed) return err(appError(IdentityErrors.SIGN_IN_CODE_LOCKED));
  const check = await deps.codes.verify(input.requestId, input.email, input.code);
  if (check.outcome === 'locked') {
    await gate.attempt.failed();
    return err(appError(IdentityErrors.SIGN_IN_CODE_LOCKED));
  }
  if (check.outcome === 'wrong') {
    await gate.attempt.failed();
    return err(wrongCode(gate.attempt.triesIfWrong));
  }
  if (check.outcome === 'expired') {
    await gate.attempt.released();
    return err(appError(IdentityErrors.SIGN_IN_CODE_EXPIRED));
  }
  await gate.attempt.succeeded();
  const session = await openSession(deps, check.linkToken);
  if (!session.ok) return session;
  if (input.remember) await rememberThisBrowser(deps, session.value.claims);
  return continueAfterFirstStep(deps, session.value);
}

/** How long one call waits for the worker before the screen asks again (a server action's budget). */
export const REMEMBERED_SIGN_IN_WAIT_MS = 8_000;
const REMEMBERED_POLL_MS = 700;

/**
 * A remembered browser signs in without a code: the worker is minting the one-time token (no e-mail); this
 * waits for it a few seconds and then opens the session. `pending`: not yet, ask again. An expired, forgotten or
 * shortened remembered browser reads as an expired request - the screen falls back to sending a code.
 */
export async function completeRememberedSignIn(
  deps: SignInCodeDeps,
  input: { readonly requestId: string; readonly email: string },
): Promise<
  Result<
    { readonly status: 'pending' } | { readonly status: 'done'; readonly outcome: SignInOutcome },
    AppError
  >
> {
  const token = deps.cookie.read();
  if (!token) return err(appError(IdentityErrors.SIGN_IN_CODE_EXPIRED));
  const hash = rememberedBrowserHash(token);
  const deadline = deps.now() + REMEMBERED_SIGN_IN_WAIT_MS;
  for (;;) {
    const taken = await deps.codes.takeRemembered(input.requestId, input.email, hash);
    if (taken.outcome === 'gone') return err(appError(IdentityErrors.SIGN_IN_CODE_EXPIRED));
    if (taken.outcome === 'ok') {
      const session = await openSession(deps, taken.linkToken);
      if (!session.ok) return session;
      const outcome = await continueAfterFirstStep(deps, session.value);
      return outcome.ok ? ok({ status: 'done', outcome: outcome.value }) : outcome;
    }
    if (deps.now() + REMEMBERED_POLL_MS >= deadline) return ok({ status: 'pending' });
    await deps.sleep(REMEMBERED_POLL_MS);
  }
}
