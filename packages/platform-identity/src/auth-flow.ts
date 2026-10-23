import 'server-only';
import {
  type AppError,
  type Result,
  type VerifiedClaims,
  actorFromClaims,
  appError,
  defineErrorCodes,
  err,
  hasTenant,
  ok,
} from '@jadarat/platform-core';
import type {
  AuditEventInput,
  SessionAccess,
  SessionTenant,
  UserTx,
  WithUserTx,
} from '@jadarat/platform-db';
import type { LogFields } from '@jadarat/platform-observability';
import type { SignInGuard } from './auth-limits';
import { type SupabaseAuthLike, verifyClaims, verifyClaimsStrict } from './verify-claims';

/**
 * Sign-in flow (ADR 0003 §2, ADR 0002 §3; T-M1-D03). Framework-free: the Next.js adapter (auth-next.ts)
 * supplies a Supabase client bound to the request cookies and the platform-db functions.
 *
 *   signInWithPassword → the sign-in guard (T-M2-11: per account and per client, auth-limits.ts; a
 *     limited attempt never reaches Auth) → Supabase Auth (session cookie set; with «تذكّر هذا المتصفح»
 *     ticked the browser is trusted for 30 days — opt-in) → the session's organizations
 *     · none  → sign out again, AUTH_NO_ORGANIZATION — unless a Platform Super Admin (FR-ADM-17): the
 *               platform console (`next: 'platform'`); a Super Admin with organizations chooses
 *     · one   → selectOrganization() automatically
 *     · many  → the caller shows the organization chooser
 *   selectOrganization → switch_active_tenant (this session only) → refresh the session so the
 *     Custom Access Token Hook issues a token WITH the tenant claim → audit `platform.auth.signed_in`
 *   signOut → audit `platform.auth.signed_out` (when a tenant is active) → revoke this session
 *
 * After the selection the organization's MFA policy may ask for more (T-M2-10, database decision
 * private.session_access): a code from the account's authenticator app, setting one up, or — allowed
 * meanwhile — the set-up prompt (grace period; Organization Admins, PO decision 2), or an app waiting for
 * its e-mailed code (here, or added from another sign-in — re-review N1): next = 'mfa'.
 */

export const IdentityErrors = defineErrorCodes({
  /** Wrong e-mail or password — deliberately the same for unknown accounts (no account enumeration). */
  AUTH_INVALID_CREDENTIALS: { status: 401, messageKey: 'auth.errors.invalidCredentials' },
  /** Signed in, but the account has no active membership in an active organization. */
  AUTH_NO_ORGANIZATION: { status: 403, messageKey: 'auth.errors.noOrganization' },
  /**
   * Too many sign-in attempts for this account or from this client (T-M2-11). The same for unknown
   * accounts: the counters are kept per typed e-mail whether or not an account exists.
   */
  AUTH_TOO_MANY_ATTEMPTS: { status: 429, messageKey: 'auth.errors.tooManyAttempts' },
  /**
   * «Email me a code» (WP-ADM-05): a wrong code (`tries` in the params: the screen says how many are left),
   * an expired, used or replaced one, five wrong tries (the code is dead and code checks pause) and a second
   * request within a minute (`seconds`). The same for every address, with or without an account.
   */
  SIGN_IN_CODE_INVALID: { status: 401, messageKey: 'auth.errors.signInCodeInvalid' },
  SIGN_IN_CODE_LOCKED: { status: 429, messageKey: 'auth.errors.signInCodeLocked' },
  SIGN_IN_CODE_TOO_SOON: { status: 429, messageKey: 'auth.errors.signInCodeTooSoon' },
});

/**
 * Every refused sign-in (wrong e-mail or password, or limited) is answered no sooner than this after the
 * request started: Supabase Auth answers an unknown e-mail at once but compares the password of an
 * existing account first (GoTrue v2.197.0 ResourceOwnerPasswordGrant), so the time taken would tell
 * accounts apart (TM-0003 T-IAM-27). Same constant as the reset request's answer.
 */
export const SIGN_IN_REFUSAL_ANSWER_MS = 1_500;

/**
 * A refusal whose work took longer than this before the padding is logged (codes only): close to the
 * answer time, a slow limiter or Auth could start to tell accounts apart again (security review T-M2-11).
 */
export const SIGN_IN_REFUSAL_WARN_MS = 1_200;

/** The subset of the Supabase Auth client the flow uses (server-side, cookie-bound). */
export interface AuthClientLike extends SupabaseAuthLike {
  readonly auth: SupabaseAuthLike['auth'] & {
    signInWithPassword(credentials: {
      email: string;
      password: string;
    }): Promise<{ data: unknown; error: { status?: number | undefined } | null }>;
    refreshSession(current?: { refresh_token: string }): Promise<{ data: unknown; error: unknown }>;
    /**
     * Redeems Auth's one-time token hash of an e-mailed sign-in (WP-ADM-05): only after OUR code was right
     * (private.verify_sign_in_code released the hash). Auth's own short OTP is never used or e-mailed.
     */
    verifyOtp(params: {
      token_hash: string;
      type: 'magiclink';
    }): Promise<{ data: unknown; error: { status?: number | undefined } | null }>;
    signOut(options: { scope: 'local' }): Promise<{ error: unknown }>;
  };
}

export interface AuthFlowDeps {
  readonly supabase: AuthClientLike | null;
  readonly withUserTx: WithUserTx;
  readonly listSessionTenants: (tx: UserTx) => Promise<readonly SessionTenant[]>;
  /**
   * Is the session a Platform Super Admin's (FR-ADM-17; the database decides: private.is_platform_admin)?
   * A Super Admin without organizations lands on the platform console instead of being signed out.
   */
  readonly isPlatformAdmin: (tx: UserTx) => Promise<boolean>;
  readonly switchActiveTenant: (tx: UserTx, tenantId: string) => Promise<boolean>;
  /** Where the session stands in its organization (MFA policy, session rules; T-M2-10). */
  readonly getSessionAccess: (tx: UserTx) => Promise<SessionAccess>;
  readonly insertAuditEvent: (
    tx: UserTx,
    actor: ReturnType<typeof actorFromClaims>,
    event: AuditEventInput,
  ) => Promise<void>;
  /** Structured warning without personal data (platform-observability logger). */
  readonly logWarning: (message: string, fields: LogFields) => void;
  /**
   * Application limits in front of Auth for this request's client (T-M2-11, auth-limits.ts). Flows that
   * never check a password get NO_SIGN_IN_GUARD, which refuses any use.
   */
  readonly signInGuard: SignInGuard;
  /** Milliseconds clock and sleep for the refusal answer time (SIGN_IN_REFUSAL_ANSWER_MS). */
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

/**
 * Supabase Auth could not answer (network error, 5xx, misconfigured URL/key). Thrown, not returned, so
 * definePublicAction answers INTERNAL_ERROR with a correlation id and logs it — never "wrong password".
 */
export class AuthServiceError extends Error {
  override readonly name = 'AuthServiceError';
  constructor(readonly status: number | undefined) {
    super(`Supabase Auth request failed (status ${String(status ?? 'none')})`);
  }
}

export type SignInOutcome =
  | { readonly next: 'home' }
  | { readonly next: 'choose-organization' }
  /** A Platform Super Admin without organizations: the platform console (FR-ADM-17). */
  | { readonly next: 'platform' }
  /** The organization's MFA policy asks for a code or an app first, or invites to set one up. */
  | { readonly next: 'mfa' };

/** Tokens Auth just issued in THIS request (the session cookies are written, but not re-read). */
export interface SessionTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
}

/** The session tokens in an Auth answer (sign-in, sign-up, refresh), if any. */
export function sessionTokens(data: unknown): SessionTokens | null {
  const session =
    typeof data === 'object' && data !== null && 'session' in data ? data.session : null;
  if (typeof session !== 'object' || session === null) return null;
  const { access_token: accessToken, refresh_token: refreshToken } = session as Record<
    string,
    unknown
  >;
  return typeof accessToken === 'string' && typeof refreshToken === 'string'
    ? { accessToken, refreshToken }
    : null;
}

/** A session Auth just opened in THIS request, with its verified (tenant-less) claims. */
export interface PasswordSession {
  readonly tokens: SessionTokens;
  readonly claims: VerifiedClaims;
}

/** E-mail and password, and whether to remember this browser (sign-in page only; default: not). */
export interface PasswordCredentials {
  readonly email: string;
  readonly password: string;
  /**
   * «تذكّر هذا المتصفح» / "Remember this browser" was ticked (PO decision 9 Oct 2026: opt-in, unticked
   * by default): only then does a successful sign-in trust this browser — or renew its trust — for 30 days.
   */
  readonly remember?: boolean;
}

/**
 * Whether Auth's answer to a password sign-in names a verified authenticator app of the account (GoTrue
 * returns the user with its factors, and leaves `factors` out when there are none). A missing user counts
 * as one (the safe side: the browser waits for a code before it is remembered). Not the authority: the
 * database also looks at the user's factors itself (integration review L4 re-review), so an Auth answer
 * that stopped carrying `factors` can never make a password alone trust a browser.
 */
function usesAuthenticatorApp(data: unknown): boolean {
  const user = typeof data === 'object' && data !== null && 'user' in data ? data.user : null;
  if (typeof user !== 'object' || user === null) return true;
  const factors = 'factors' in user ? user.factors : null;
  return (
    Array.isArray(factors) &&
    factors.some(
      (f: unknown) =>
        typeof f === 'object' &&
        f !== null &&
        (f as Record<string, unknown>).factor_type === 'totp' &&
        (f as Record<string, unknown>).status === 'verified',
    )
  );
}

/**
 * Signs in with e-mail + password and verifies the issued access token. No organization is required
 * here: signInWithPassword() continues with the organizations, the invitation flow
 * (invitation-accept.ts) with the invitation.
 *
 * Limits first (T-M2-11): the attempt is counted BEFORE Auth is asked — a limited attempt gets
 * AUTH_TOO_MANY_ATTEMPTS without asking Auth; when the limiter cannot answer, RateLimiterUnavailableError
 * is thrown (fail closed: the generic internal error). Auth's verdict is then reported to the attempt
 * (failed: events and the lockout e-mail; succeeded: the provisional failure is given back and — only with
 * `remember` — the browser trusted; Auth's own 429: the account's failure is given back, no password was
 * compared). Every refusal — limited, or wrong e-mail or password — is answered after the same minimum time.
 * For an account with an authenticator app (integration review L4), a ticked «تذكّر هذا المتصفح» trusts
 * nothing yet: it waits — server-side, bound to this Auth session — for the session's sign-in code
 * (mfa.ts verifyTotpCode → auth-limits.ts rememberBrowserAfterCode). The database decides whether the
 * account has one: Auth's answer, the verified token's user (none: nothing is trusted) and the user's
 * factors it reads itself. So the success is recorded once the issued token is verified.
 */
export async function startPasswordSession(
  deps: AuthFlowDeps,
  credentials: PasswordCredentials,
): Promise<Result<PasswordSession, AppError>> {
  const { supabase } = deps;
  if (!supabase) return err(appError('NOT_CONFIGURED'));
  const started = deps.now();
  const refuse = async (error: AppError): Promise<Result<never, AppError>> => {
    const elapsed = deps.now() - started;
    if (elapsed > SIGN_IN_REFUSAL_WARN_MS) {
      deps.logWarning('sign-in refusal took longer than its padding allows', {
        action: 'platform.auth.sign_in',
        reason: 'refusal_padding_exceeded',
        durationMs: Math.round(elapsed),
      });
    }
    await deps.sleep(Math.max(0, SIGN_IN_REFUSAL_ANSWER_MS - elapsed));
    return err(error);
  };

  const gate = await deps.signInGuard.check(credentials.email);
  if (!gate.allowed) return refuse(appError(IdentityErrors.AUTH_TOO_MANY_ATTEMPTS));

  const { data, error } = await supabase.auth.signInWithPassword({
    email: credentials.email,
    password: credentials.password,
  });
  if (error) {
    if (error.status === 429) {
      // Auth's own limits (on hosted Supabase: the app's egress address, shared by every visitor) answer
      // before any password is compared: the account's (or trusted browser's) provisional failure is given
      // back — a flood elsewhere must not lock this account — and the client's stays (security review
      // T-M2-11 L6).
      await gate.attempt.notChecked();
      deps.logWarning('sign-in limited by Auth', {
        action: 'platform.auth.sign_in',
        securityEvent: 'auth.rate_limited',
        reason: 'auth_service',
        status: 429,
      });
      return refuse(appError('RATE_LIMITED'));
    }
    // 4xx: refused credentials (wrong e-mail or password, unconfirmed or banned account) — one answer
    // for all of them (no account enumeration). The failure was counted before Auth was asked; the
    // attempt records the security events (keyed references only) and, when the account locks now,
    // requests the lockout e-mail. 5xx (thrown below): Auth could not answer — the failure stays counted.
    if (error.status !== undefined && error.status >= 400 && error.status < 500) {
      await gate.attempt.failed();
      return refuse(appError(IdentityErrors.AUTH_INVALID_CREDENTIALS));
    }
    throw new AuthServiceError(error.status);
  }
  // The password was right: the provisional failure is given back and the run of failures ends; the
  // browser is trusted for the account (30 days) only when «تذكّر هذا المتصفح» was ticked — and, for an
  // account with an authenticator app, only once the sign-in code passed (integration review L4; the
  // database decides, given the verified token's user and session).
  const tokens = sessionTokens(data);
  const claims = tokens ? await verifyClaims(supabase, tokens.accessToken) : null;
  const verified = claims?.ok
    ? { userId: claims.value.sub, sessionId: claims.value.session_id ?? null }
    : null;
  await gate.attempt.succeeded({
    remember: credentials.remember === true,
    verified,
    authNamesApp: usesAuthenticatorApp(data),
  });
  if (!tokens || !claims) return err(appError('UNAUTHENTICATED'));
  return claims.ok ? ok({ tokens, claims: claims.value }) : claims;
}

export async function signInWithPassword(
  deps: AuthFlowDeps,
  credentials: PasswordCredentials,
): Promise<Result<SignInOutcome, AppError>> {
  const { supabase } = deps;
  if (!supabase) return err(appError('NOT_CONFIGURED'));
  const session = await startPasswordSession(deps, credentials);
  if (!session.ok) return session;
  return continueAfterFirstStep(deps, session.value);
}

/**
 * What follows the first step, whichever way it was taken (the password, or an e-mailed code - WP-ADM-05): the
 * session's organizations - none (sign out; a Platform Super Admin: the console), one (selected at once) or
 * several (the chooser) - and then the organization's MFA policy (`selectOrganization`), which asks for the
 * authenticator app after BOTH ways alike (PO 23 Oct 2026: the second step follows the first, never a second
 * e-mailed code).
 */
export async function continueAfterFirstStep(
  deps: AuthFlowDeps,
  session: PasswordSession,
): Promise<Result<SignInOutcome, AppError>> {
  const { supabase } = deps;
  if (!supabase) return err(appError('NOT_CONFIGURED'));
  const { tokens, claims } = session;

  const { tenants, platformAdmin } = await deps.withUserTx(claims, async (tx) => ({
    tenants: await deps.listSessionTenants(tx),
    platformAdmin: await deps.isPlatformAdmin(tx),
  }));
  const [only, ...others] = tenants;
  if (!only) {
    // A Platform Super Admin (ENTLAQA staff, no organization of their own): the platform console.
    if (platformAdmin) return ok({ next: 'platform' });
    await supabase.auth.signOut({ scope: 'local' });
    return err(appError(IdentityErrors.AUTH_NO_ORGANIZATION));
  }
  // A Super Admin who is also a member chooses: an organization, or the platform console.
  if (others.length > 0 || platformAdmin) return ok({ next: 'choose-organization' });

  const selected = await selectOrganization(deps, only.tenantId, tokens);
  return selected.ok ? ok({ next: selected.value.next }) : selected;
}

/** The organizations of the current session (for the chooser). Fails closed without a session. */
export async function getSessionOrganizations(
  deps: AuthFlowDeps,
): Promise<Result<readonly SessionTenant[], AppError>> {
  const claims = await verifyClaims(deps.supabase);
  if (!claims.ok) return claims;
  return ok(await deps.withUserTx(claims.value, (tx) => deps.listSessionTenants(tx)));
}

export async function selectOrganization(
  deps: AuthFlowDeps,
  tenantId: string,
  tokens?: SessionTokens,
): Promise<Result<{ readonly tenantId: string; readonly next: 'home' | 'mfa' }, AppError>> {
  const { supabase } = deps;
  // Strict: the Auth server confirms the session is still live before it gains a tenant.
  const claims = await verifyClaimsStrict(supabase, tokens?.accessToken);
  if (!claims.ok || !supabase) return claims.ok ? err(appError('NOT_CONFIGURED')) : claims;

  const switched = await deps.withUserTx(claims.value, (tx) =>
    deps.switchActiveTenant(tx, tenantId),
  );
  // Not a member (or not active): same answer as an unknown organization — no existence leak.
  if (!switched) return err(appError('NOT_FOUND'));

  // New access token: the Custom Access Token Hook adds tenant_id/person_id for the selected tenant.
  const refreshed = await (tokens
    ? supabase.auth.refreshSession({ refresh_token: tokens.refreshToken })
    : supabase.auth.refreshSession());
  const refreshedTokens = refreshed.error ? null : sessionTokens(refreshed.data);
  if (!refreshedTokens) return err(appError('UNAUTHENTICATED'));
  const tenantClaims = await verifyClaims(supabase, refreshedTokens.accessToken);
  if (!tenantClaims.ok) return tenantClaims;
  if (!hasTenant(tenantClaims.value) || tenantClaims.value.tenant_id !== tenantId) {
    // The hook is not enabled (or returned another tenant): never continue without the tenant claim.
    deps.logWarning('access token has no tenant claim after selection; is the hook enabled?', {
      action: 'platform.auth.select_organization',
    });
    return err(appError('NOT_CONFIGURED'));
  }

  // The organization's MFA policy (T-M2-10). A session it refuses until a code is entered cannot write
  // in the organization yet: its sign-in is audited once the code passed (mfa.ts).
  const access = await deps.withUserTx(tenantClaims.value, (tx) => deps.getSessionAccess(tx));
  if (access.state === 'mfa_challenge' || access.state === 'mfa_enrol') {
    return ok({ tenantId, next: 'mfa' });
  }
  await recordAudit(deps, tenantClaims.value, 'platform.auth.signed_in');
  const prompt = access.state === 'prompt_grace' || access.state === 'prompt_admin';
  // An app waits for its e-mailed code (re-review N1): the window that set it up enters the code; every
  // other sign-in is told "an app was added from another sign-in" — also when nothing requires an app.
  return ok({ tenantId, next: prompt || access.mfaPending ? 'mfa' : 'home' });
}

export async function signOut(deps: AuthFlowDeps): Promise<Result<null, AppError>> {
  const { supabase } = deps;
  if (!supabase) return err(appError('NOT_CONFIGURED'));
  const claims = await verifyClaims(supabase);
  if (claims.ok && hasTenant(claims.value)) {
    try {
      await recordAudit(deps, claims.value, 'platform.auth.signed_out');
    } catch {
      // Signing out must never be blocked by the audit write; the failure is logged without details.
      deps.logWarning('could not record sign-out audit event', {
        action: 'platform.auth.sign_out',
      });
    }
  }
  // Revokes this session's refresh token in Auth and clears the session cookies. The cookies are cleared
  // even when the revocation fails (auth-js drops the local session first, so a retry could not revoke);
  // the refresh token then stays valid until it expires — logged.
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) {
    deps.logWarning('could not revoke the session in Auth', { action: 'platform.auth.sign_out' });
  }
  return ok(null);
}

/**
 * A session the organization's rules ended (T-M2-10: inactivity, maximum length, device limit, signed
 * out from another device or by a user manager) is signed out at Auth with its own token and its cookies
 * are cleared. Anything else is left alone (this is called from the sign-in page, for any visitor).
 */
export async function signOutEndedSession(
  deps: AuthFlowDeps,
): Promise<Result<{ readonly signedOut: boolean }, AppError>> {
  const { supabase } = deps;
  if (!supabase) return err(appError('NOT_CONFIGURED'));
  const claims = await verifyClaims(supabase);
  if (!claims.ok || !hasTenant(claims.value)) return ok({ signedOut: false });
  const access = await deps.withUserTx(claims.value, (tx) => deps.getSessionAccess(tx));
  if (access.state !== 'ended') return ok({ signedOut: false });
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) {
    deps.logWarning('could not revoke an ended session in Auth', {
      action: 'platform.auth.session_ended',
    });
  }
  return ok({ signedOut: true });
}

export async function recordAudit(
  deps: Pick<AuthFlowDeps, 'withUserTx' | 'insertAuditEvent'>,
  claims: VerifiedClaims,
  action: 'platform.auth.signed_in' | 'platform.auth.signed_out',
  method: SignInMethodName = firstFactorOf(claims),
): Promise<void> {
  if (!hasTenant(claims)) return;
  const actor = actorFromClaims(claims);
  await deps.withUserTx(claims, (tx) =>
    deps.insertAuditEvent(tx, actor, {
      action,
      entityType: 'auth_session',
      entityId: claims.session_id,
      data: { method, aal: actor.aal },
    }),
  );
}

/** How a sign-in was done, as audited (`data.method`). */
export type SignInMethodName = 'password' | 'password+totp' | 'email_code' | 'email_code+totp';

/**
 * The first step of a session, from the access token's authentication methods (`amr`): an e-mailed code
 * shows as `magiclink` / `otp` / `email`, anything else (the password) as `password`.
 */
export function firstFactorOf(claims: VerifiedClaims): 'password' | 'email_code' {
  const amr: unknown = 'amr' in claims ? claims.amr : undefined;
  if (!Array.isArray(amr)) return 'password';
  for (const entry of amr as unknown[]) {
    const method =
      typeof entry === 'object' && entry !== null && 'method' in entry
        ? (entry as { method?: unknown }).method
        : entry;
    if (method === 'magiclink' || method === 'otp' || method === 'email') return 'email_code';
  }
  return 'password';
}
