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
import { newDeviceToken } from './auth-limits';
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
 *   remember → with «Remember this browser» ticked and the organizations allowing it, the browser gets a NEW random
 *              256-bit token in an HttpOnly cookie (only its SHA-256 is stored, per person and organization) -
 *              but only once the organization's second step has passed (BR-AUTH-f): at once when none is asked,
 *              else after the authenticator code (a short-lived cookie carries the tick, bound to the session);
 *              on that browser «Email me a code» then signs in WITHOUT a code for the period the strictest
 *              organization of the person chose, and the token is replaced at every such sign-in (a token
 *              planted or stolen once does not stay valid). The worker still mints the token, so the web app
 *              polls briefly.
 *
 * Nothing here logs or returns a code, a token or whether an address has an account.
 */

/** The remembered-browser cookie (auth-next.ts: HttpOnly, Secure, SameSite=Lax, `__Host-` prefix). */
export interface RememberedBrowserCookie {
  /** The browser's token when it sent a well-formed one, else null. */
  read(): string | null;
  /** Sets the cookie for `maxAgeSeconds`. */
  write(token: string, maxAgeSeconds: number): void;
  /** Removes the cookie (explicit sign-out). */
  clear(): void;
}

/** The remembered-browser cookie lives at most as long as the longest period an organization can choose. */
export const REMEMBERED_BROWSER_COOKIE_SECONDS = 30 * 24 * 60 * 60;

/**
 * The tick of «Remember this browser» while the second step is still to come: a short-lived HttpOnly cookie whose
 * value names the session it belongs to (`user.session`), so another person signing in on the same browser can
 * never complete it.
 */
export interface PendingRememberCookie {
  read(): string | null;
  write(value: string, maxAgeSeconds: number): void;
  clear(): void;
}

/** How long the tick waits for the second step. */
export const PENDING_REMEMBER_SECONDS = 15 * 60;

/** What remembering a browser needs (also used where the second step ends: the organization chooser, MFA). */
export interface RememberDeps extends Pick<AuthFlowDeps, 'withUserTx' | 'logWarning'> {
  readonly rememberBrowser: (
    tx: UserTx,
    tokenHash: Uint8Array,
    label: string | null,
    replaceHash: Uint8Array | null,
  ) => Promise<number>;
  /** The signed-in account forgets the browser with this token hash (explicit sign-out). */
  readonly forgetThisBrowser: (tx: UserTx, tokenHash: Uint8Array) => Promise<number>;
  readonly cookie: RememberedBrowserCookie;
  readonly pendingRemember: PendingRememberCookie;
  /** "Chrome on Windows" from the request's user agent (well-known names only), or null. */
  readonly browserLabel: () => string | null;
}

export interface SignInCodeDeps extends AuthFlowDeps, RememberDeps {
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
      newHash: Uint8Array,
    ) => Promise<RememberedSignInTake>;
    readonly isRemembered: (email: string, rememberHash: Uint8Array) => Promise<boolean>;
  };
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
  const token = input.forceCode ? null : deps.cookie.read();
  const hash = token ? rememberedBrowserHash(token) : null;
  // A remembered browser asks for no code: the address's ceilings do not stop it (asked after the client's).
  const trusted = hash ? () => deps.codes.isRemembered(input.email, hash) : undefined;
  if (!(await deps.limiter.allowRequest(input.email, trusted ? { trusted } : undefined))) {
    return err(appError('RATE_LIMITED'));
  }
  const answer = await deps.codes.request(input.email, hash);
  if (answer.outcome === 'too_soon') {
    return err(
      appError(IdentityErrors.SIGN_IN_CODE_TOO_SOON, {
        params: { seconds: answer.retryAfterSeconds },
      }),
    );
  }
  if (answer.outcome === 'full') {
    // The queue is full (nothing was stored): the person sees the same screen; this is for the operator.
    deps.logWarning('sign-in code queue is full; the request was not stored', {
      action: 'platform.auth.sign_in_code_request',
      securityEvent: 'auth.sign_in_code.queue_full',
      reason: 'queue_full',
    });
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
 * Remembers the browser in every organization of the account, for each organization's days - none when any has
 * the setting Off (the strictest wins) - and writes the cookie only when something was remembered. ALWAYS with a
 * brand-new token (security review H2): a token the browser already holds (planted, or kept from an earlier
 * remembering) is never adopted. Best effort: a failure never blocks the sign-in.
 */
async function rememberThisBrowser(deps: RememberDeps, claims: VerifiedClaims): Promise<void> {
  try {
    const token = newDeviceToken();
    // "Keep me signed in" follows the LAST account used on this browser: the token it presented before
    // (whoever's) is forgotten when this one is remembered (PO 23 Oct 2026).
    const previous = deps.cookie.read();
    const remembered = await deps.withUserTx(claims, (tx) =>
      deps.rememberBrowser(
        tx,
        rememberedBrowserHash(token),
        deps.browserLabel(),
        previous ? rememberedBrowserHash(previous) : null,
      ),
    );
    if (remembered > 0) deps.cookie.write(token, REMEMBERED_BROWSER_COOKIE_SECONDS);
  } catch {
    deps.logWarning('could not remember the browser', { action: 'platform.auth.sign_in_code' });
  }
}

/**
 * Explicit sign-out (PO 23 Oct 2026: «Remember this browser» works like "keep me signed in"): the signing-out
 * account forgets this browser server-side and the cookie is cleared. Best effort - sign-out never fails here.
 */
export async function forgetBrowserOnSignOut(
  deps: RememberDeps,
  claims: VerifiedClaims,
): Promise<void> {
  const token = deps.cookie.read();
  if (token === null) return;
  try {
    await deps.withUserTx(claims, (tx) => deps.forgetThisBrowser(tx, rememberedBrowserHash(token)));
  } catch {
    deps.logWarning('could not forget the browser', { action: 'platform.auth.sign_out' });
  }
  deps.cookie.clear();
}

/** The value of the pending tick: the account and the Auth session it belongs to. */
function pendingValue(claims: VerifiedClaims): string {
  return `${claims.sub}.${claims.session_id ?? 'none'}`;
}

/**
 * «Remember this browser» was ticked but the organization's second step is still to come (BR-AUTH-f: nothing is
 * remembered on the first step alone): the tick waits in a short-lived cookie, bound to this session.
 */
async function settleRemember(
  deps: RememberDeps,
  remember: boolean,
  claims: VerifiedClaims,
  next: SignInOutcome['next'],
): Promise<void> {
  if (!remember || next === 'platform') {
    if (deps.pendingRemember.read() !== null) deps.pendingRemember.clear();
    return;
  }
  if (next === 'home') {
    deps.pendingRemember.clear();
    await rememberThisBrowser(deps, claims);
    return;
  }
  deps.pendingRemember.write(pendingValue(claims), PENDING_REMEMBER_SECONDS);
}

/**
 * Where the second step ends (the authenticator code passed, or the organization chosen with none to pass): the
 * tick of this session, if any, remembers the browser now. A tick of another session or account is dropped.
 */
export async function rememberAfterSecondStep(
  deps: RememberDeps,
  claims: VerifiedClaims,
): Promise<void> {
  const pending = deps.pendingRemember.read();
  if (pending === null) return;
  deps.pendingRemember.clear();
  if (pending !== pendingValue(claims)) return;
  await rememberThisBrowser(deps, claims);
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
  // A browser remembered for this address is not stopped by the address's pause: its own budget counts instead.
  const cookieToken = deps.cookie.read();
  const remembered =
    cookieToken !== null &&
    (await deps.codes.isRemembered(input.email, rememberedBrowserHash(cookieToken)));
  const gate = await deps.limiter.checkCode(
    input.email,
    remembered ? { rememberedToken: cookieToken } : undefined,
  );
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
  const next = await continueAfterFirstStep(deps, session.value);
  if (next.ok) await settleRemember(deps, input.remember, session.value.claims, next.value.next);
  return next;
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
  // The token is replaced at every use (security review H2): the database swaps the hash when it hands the
  // sign-in token out, and the browser gets the new one with this answer.
  const fresh = newDeviceToken();
  const freshHash = rememberedBrowserHash(fresh);
  const deadline = deps.now() + REMEMBERED_SIGN_IN_WAIT_MS;
  for (;;) {
    const taken = await deps.codes.takeRemembered(input.requestId, input.email, hash, freshHash);
    if (taken.outcome === 'gone') return err(appError(IdentityErrors.SIGN_IN_CODE_EXPIRED));
    if (taken.outcome === 'ok') {
      deps.cookie.write(fresh, REMEMBERED_BROWSER_COOKIE_SECONDS);
      const session = await openSession(deps, taken.linkToken);
      if (!session.ok) return session;
      const outcome = await continueAfterFirstStep(deps, session.value);
      return outcome.ok ? ok({ status: 'done', outcome: outcome.value }) : outcome;
    }
    if (deps.now() + REMEMBERED_POLL_MS >= deadline) return ok({ status: 'pending' });
    await deps.sleep(REMEMBERED_POLL_MS);
  }
}
