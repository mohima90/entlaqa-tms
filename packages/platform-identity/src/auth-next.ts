/**
 * Next.js adapter for the sign-in flow (auth-flow.ts): a Supabase client bound to the request cookies
 * (writable in server actions) and the platform-db functions. Used only by apps/suite/src/auth/
 * (definePublicAction) and the sign-in / organization pages.
 */
import 'server-only';
import {
  type AppError,
  type Result,
  actorFromClaims,
  appError,
  err,
  hasTenant,
  ok,
} from '@jadarat/platform-core';
import {
  acceptInvitationAsCaller,
  applyDeviceLimit,
  confirmMfaSetup as confirmMfaSetupInDatabase,
  dismissMfaPrompt,
  getLockoutPolicy,
  getSessionAccess,
  hashInvitationToken,
  insertAuditEvent,
  invitationByToken,
  invitationPasswordMinLength,
  isPlatformAdmin,
  getEmailCredentialsPublicKey,
  getPlatformEmailSettings,
  savePlatformEmailSettings,
  listMyMfaApps,
  listPlatformTenants,
  createPlatformTenant,
  type NewPlatformTenant,
  platformAdminInvitationCode,
  reissuePlatformAdminCode,
  listSessionTenants,
  passwordMinLengthForCaller,
  queueOwnPasswordChangedMail,
  rateLimitStore,
  rejectMfaFactor,
  removeMfaApp as removeMfaAppInDatabase,
  requestAccountLockedMail,
  requestMfaCodeLockedMail,
  requestMfaFactorMail,
  requestPasswordChangedMail,
  requestPasswordResetMail,
  type SessionAccess,
  trustDeviceAfterCode,
  signInAccountInTenant,
  switchActiveTenant,
  withUserTx,
} from '@jadarat/platform-db';
import {
  createSupabaseServerClient,
  createSupabaseStatelessClient,
  createSupabaseVerifierClient,
} from '@jadarat/platform-db/supabase-server';
import { log } from '@jadarat/platform-observability';
import { cookies, headers } from 'next/headers';
import { after } from 'next/server';
import {
  type AuthClientLike,
  type AuthFlowDeps,
  type PasswordCredentials,
  getSessionOrganizations,
  selectOrganization,
  signInWithPassword,
  signOut,
  signOutEndedSession,
} from './auth-flow';
import {
  type CodeCheckFlow,
  type CodeCheckLimit,
  DEVICE_TOKEN_PATTERN,
  type LimiterDeps,
  NO_CODE_CHECKS,
  NO_SIGN_IN_GUARD,
  type RequestClient,
  type SecurityLog,
  type SignInGuard,
  type TrustedDeviceCookie,
  authClientHeaders,
  createCodeAttemptLimiter,
  createInvitationLimiter,
  createPasswordCheckLimiter,
  createPasswordResetLimiter,
  createSignInGuard,
  forgetOtherTrustedBrowsers,
  limitsFor,
  lockoutHostTenant,
  organizationAccountLockout,
  rememberBrowserAfterCode,
  resetAccountSignIn,
  securityLogLine,
  withCodeAttemptLimit,
} from './auth-limits';
import {
  type MfaClientLike,
  type MfaDeps,
  type MfaOverview,
  MFA_CONFIRM_ACTION,
  MFA_VERIFY_ACTION,
  confirmMfaSetup,
  getMfaOverview,
  openMfaRemoveLink,
  removeMfaApp,
  resendMfaSetupMail,
  startTotpSetup,
  verifyTotpCode,
} from './mfa';
import { type SupabaseAuthLike, verifyClaims } from './verify-claims';
import { getVerifiedClaims, getVerifiedClaimsStrict } from './next';
import {
  type ConsoleInputParser,
  type PlatformConsoleDeps,
  createOrganizationFromConsole,
  isPlatformAdminSession,
  loadPlatformOrganizations,
  reissueOrganizationAdminCode,
  viewOrganizationAdminCode,
} from './platform-console';
import {
  type PlatformEmailInput,
  loadPlatformEmailSettings,
  savePlatformEmailSettingsFromConsole,
} from './platform-email-console';
import {
  type InvitationAcceptDeps,
  type InvitationCodeGuard,
  type InvitationLinkView,
  type InvitationSignUpClientLike,
  acceptInvitationAsSignedInUser,
  acceptInvitationWithNewAccount,
  acceptInvitationWithPassword,
  codesLimited,
  lookupInvitationLink,
  normalizeInvitationSecret,
} from './invitation-accept';
import {
  type RecoveryClientLike,
  type ResetEmailDelivery,
  completePasswordReset,
  readPasswordResetDelivery,
  requestPasswordReset,
} from './password-reset';
import {
  type PasswordClientLike,
  type VerifierClientLike,
  changePassword,
  createPasswordVerifier,
} from './password';

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** Security events (TM-0003 T-IAM-25) as structured log lines: codes and keyed references only. */
const securityLog: SecurityLog = (event) => {
  const line = securityLogLine(event);
  if (line.level === 'error') log.error(line.message, line.fields);
  else log.warn(line.message, line.fields);
};

/**
 * The shared limiter (T-M2-11) with the limits for this flow (platform defaults; per-organization
 * settings join in limitsFor — T-M2-10).
 */
function limiterDeps(): LimiterDeps {
  return { store: rateLimitStore, limits: limitsFor({}), log: securityLog };
}

const SIGN_IN_ACTION = 'platform.auth.sign_in';

type CookieStore = Awaited<ReturnType<typeof cookies>>;

/** Secure cookies everywhere but `next dev` (the rule of the session cookies, platform-db supabase/server.ts). */
const SECURE_COOKIES = process.env.NODE_ENV !== 'development';

/**
 * The trusted-device cookie (PO decision 9 Oct 2026; T-M2-11): a random token only — HttpOnly (never
 * readable by scripts), Secure with the `__Host-` prefix (this host only, path /), SameSite=Lax. The
 * account it is trusted for is known to the database alone (keyed hashes); a malformed value is ignored.
 * Written only by a sign-in with «تذكّر هذا المتصفح» ticked (opt-in) and by a completed password reset
 * (30 days ticked, 24 hours not), each until the latest end of its token's trusts; an unticked sign-in
 * leaves it (and the trust) to expire.
 */
export const TRUSTED_DEVICE_COOKIE = SECURE_COOKIES ? '__Host-jadarat-device' : 'jadarat-device';

function trustedDeviceCookie(store: CookieStore): TrustedDeviceCookie {
  return {
    read: () => {
      const value = store.get(TRUSTED_DEVICE_COOKIE)?.value ?? '';
      return DEVICE_TOKEN_PATTERN.test(value) ? value : null;
    },
    write: (token, maxAgeSeconds) => {
      try {
        store.set(TRUSTED_DEVICE_COOKIE, token, {
          httpOnly: true,
          secure: SECURE_COOKIES,
          sameSite: 'lax',
          path: '/',
          maxAge: maxAgeSeconds,
        });
      } catch {
        // Not in a server action (cookies are read-only there): the browser stays untrusted.
      }
    },
  };
}

/**
 * The organization whose own host this request came to, VERIFIED (never a client-supplied value).
 * INTEGRATION POINT (ADR 0002 §4, host → tenant resolution): not built yet — the proxy only classifies the
 * Host header (apps/suite lib/host-tenant.ts) — so every request is on the platform's host today. Return
 * the verified host organization here once that lookup exists, and switch ORGANIZATION_SIGN_IN_HOSTS on.
 */
function verifiedHostOrganization(): string | null {
  return null;
}

/**
 * The organization of the host this request signs in on, by THE host rule (auth-limits.ts
 * `lockoutHostTenant`, TM-0003 D-IAM-04, integration review L1): on an organization's own host its lockout
 * policy applies to its own members; on the platform's shared sign-in host the platform default (5
 * failures, 15 minutes) applies to everyone — today every sign-in. The Organization Admin's lock state
 * and unlock follow the same rule (platform-rbac `memberLockBudget`).
 */
function hostTenantIdForRequest(): string | null {
  return lockoutHostTenant(verifiedHostOrganization());
}

/**
 * The sign-in guard for this request's client (the app passes it: apps/suite lib/request-client.ts) and
 * browser (its trusted-device cookie); the lockout e-mail goes through the account-mail queue. The account
 * budget (T-M2-10 × T-M2-11): `organizationAccountLockout` — the host organization's lockout policy
 * (platform-db `getLockoutPolicy`, its own pre-session transaction: sign-in holds none) for that
 * organization's active members only (`signInAccountInTenant`), clamped to the platform default or
 * stricter; the platform default for everyone else and on the platform's host.
 */
async function signInGuardFor(
  client: RequestClient,
  action = SIGN_IN_ACTION,
): Promise<SignInGuard> {
  const deps = limiterDeps();
  return createSignInGuard({
    ...deps,
    client,
    action,
    device: trustedDeviceCookie(await cookies()),
    requestLockedMail: requestAccountLockedMail,
    accountLockout: organizationAccountLockout(
      {
        hostTenantId: hostTenantIdForRequest(),
        lockoutPolicyFor: getLockoutPolicy,
        accountInTenant: signInAccountInTenant,
      },
      deps.limits.signIn.accountFailures,
    ),
  });
}

/**
 * Self-hosted only: the visitor's rate-limit key on the Auth calls of this request, for Auth's own per-IP
 * limits behind the installation's gateway (JADARAT_AUTH_CLIENT_HEADER; none on hosted Supabase).
 */
function authClientOptions(client: RequestClient | null) {
  const headers = client ? authClientHeaders(client) : null;
  return headers ? { headers } : {};
}

async function requestDeps(
  signInGuard: SignInGuard = NO_SIGN_IN_GUARD,
  client: RequestClient | null = null,
): Promise<AuthFlowDeps> {
  const store = await cookies();
  // The browser's User-Agent goes to Auth with our calls, so a session created at sign-in records the real
  // browser (session lists, T-M2-10); createSupabaseServerClient drops anything but printable ASCII.
  const userAgent = (await headers()).get('user-agent');
  const supabase = createSupabaseServerClient(
    {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) store.set(name, value, options);
        } catch {
          // Server Components cannot write cookies; the request proxy refreshes sessions there.
        }
      },
    },
    undefined,
    { ...authClientOptions(client), userAgent },
  );
  return {
    supabase: supabase as AuthClientLike | null,
    withUserTx,
    listSessionTenants,
    isPlatformAdmin,
    switchActiveTenant,
    getSessionAccess,
    insertAuditEvent,
    logWarning: (message, fields) => {
      log.warn(message, fields);
    },
    signInGuard,
    now: () => Date.now(),
    sleep,
  };
}

/**
 * Sign-in (screen «تسجيل الدخول»): limited per account and per client before Auth is asked (T-M2-11);
 * `remember` («تذكّر هذا المتصفح», opt-in) trusts this browser after a successful sign-in.
 */
export async function signInWithPasswordForRequest(
  credentials: PasswordCredentials,
  client: RequestClient,
) {
  return signInWithPassword(await requestDeps(await signInGuardFor(client), client), credentials);
}

export async function selectOrganizationForRequest(tenantId: string) {
  return selectOrganization(await requestDeps(), tenantId);
}

export async function getSessionOrganizationsForRequest() {
  return getSessionOrganizations(await requestDeps());
}

export async function signOutForRequest() {
  return signOut(await requestDeps());
}

/** The sign-in page signs out a session its organization's rules ended (T-M2-10). */
export async function signOutEndedSessionForRequest() {
  return signOutEndedSession(await requestDeps());
}

// Multi-factor authentication with an authenticator app (FR-IAM-12, T-M2-10): the user's own session
// only (no Auth secret key). The /mfa page and My profile use these through public actions: a session the
// organization's MFA policy refuses has no access to the organization until it passes here.

/**
 * `limitCodeCheck`: the code limiter of a flow that checks a code (`codeCheckLimitFor`); the others get
 * NO_CODE_CHECKS (any use fails closed). `client`: the visitor's key for self-hosted Auth's own limits.
 */
async function mfaDeps(
  limitCodeCheck: CodeCheckLimit = NO_CODE_CHECKS,
  client: RequestClient | null = null,
): Promise<MfaDeps> {
  const auth = await requestDeps(undefined, client);
  return {
    supabase: auth.supabase as unknown as MfaClientLike | null,
    withUserTx,
    insertAuditEvent,
    getSessionAccess,
    listMyMfaApps,
    requestMfaFactorMail,
    confirmMfaSetup: confirmMfaSetupInDatabase,
    removeMfaApp: removeMfaAppInDatabase,
    applyDeviceLimit,
    logWarning: auth.logWarning,
    limitCodeCheck,
  };
}

export async function getMfaOverviewForRequest() {
  return getMfaOverview(await mfaDeps());
}

/**
 * What the /mfa page shows: the account's apps as this session sees them (confirmed, waiting for this
 * window's code, or added from another sign-in — re-review N1), this session's level (Auth), and where the
 * session stands in its organization (the database: a code or an app needed, or the set-up prompt).
 */
export async function getMfaPageStateForRequest(): Promise<
  Result<MfaOverview & { readonly access: SessionAccess }, AppError>
> {
  const deps = await mfaDeps();
  const overview = await getMfaOverview(deps);
  if (!overview.ok) return overview;
  const claims = await verifyClaims(deps.supabase);
  if (!claims.ok) return claims;
  const tenantClaims = claims.value;
  const access: SessionAccess = hasTenant(tenantClaims)
    ? await withUserTx(tenantClaims, (tx) => getSessionAccess(tx))
    : { state: 'invalid', mfaDeadline: null, usesApp: false, mfaPending: false, aal2: false };
  return ok({ ...overview.value, access });
}

export async function startTotpSetupForRequest() {
  return startTotpSetup(await mfaDeps());
}

/**
 * A code from the authenticator app (sign-in, a sensitive action, or a set-up's first code): limited per
 * account and per client (T-M2-11 — Auth's own per-IP limit sees only the app server). Once it passed,
 * this browser becomes trusted when the session ticked «تذكّر هذا المتصفح» at sign-in (integration review
 * L4): in a transaction with the upgraded session's own claims, after the code check (never nested).
 */
export async function verifyTotpCodeForRequest(
  input: { readonly code: string; readonly factorId?: string | undefined },
  client: RequestClient,
) {
  const deps = await mfaDeps(codeCheckLimitFor(client, MFA_VERIFY_ACTION), client);
  const device = trustedDeviceCookie(await cookies());
  return verifyTotpCode(
    {
      ...deps,
      rememberBrowser: (session) =>
        rememberBrowserAfterCode(
          limiterDeps(),
          MFA_VERIFY_ACTION,
          device,
          (presented, fresh, days) =>
            withUserTx(session, (tx) => trustDeviceAfterCode(tx, presented, fresh, days)),
        ),
    },
    input,
  );
}

/**
 * The e-mailed code of a new app, in the window that set it up (re-review N1): limited like every code
 * (T-M2-11), on top of the database's 5 tries per code and 15 wrong codes a day per account.
 */
export async function confirmMfaSetupForRequest(
  input: { readonly code: string },
  client: RequestClient,
) {
  return confirmMfaSetup(
    await mfaDeps(codeCheckLimitFor(client, MFA_CONFIRM_ACTION), client),
    input,
  );
}

/** "Send the e-mail again" from the window that set the app up (re-review N1). */
export async function resendMfaSetupMailForRequest() {
  return resendMfaSetupMail(await mfaDeps());
}

/**
 * Removes one of the account's apps (re-review N1): a confirmed one (recent code), this window's set-up,
 * or an app added from another sign-in (the account's other sessions end).
 */
export async function removeMfaAppForRequest(input: { readonly factorId: string }) {
  return removeMfaApp(await mfaDeps(), input);
}

/**
 * The set-up e-mail's "not you? remove this app" link (review H1), with the token the page read from the
 * URL fragment: no session needed. It ends every session of the account; this browser's cookies are
 * cleared too.
 */
export async function openMfaRemoveLinkForRequest(token: string) {
  const outcome = await openMfaRemoveLink(
    {
      rejectMfaFactor,
      logInfo: (message, fields) => {
        log.info(message, fields);
      },
    },
    token,
  );
  if (outcome === 'removed') {
    try {
      await (await requestDeps()).supabase?.auth.signOut({ scope: 'local' });
    } catch {
      // Nothing to end, or Auth unreachable: the session has ended in the database either way.
    }
  }
  return outcome;
}

/**
 * "Not now" on the Organization Admin prompt (PO decision 2): remembered for the session's organization;
 * audited there. False when the session has no organization the database accepts.
 */
export async function dismissMfaPromptForRequest(): Promise<boolean> {
  const auth = await requestDeps();
  const claims = await verifyClaims(auth.supabase);
  if (!claims.ok || !hasTenant(claims.value)) return false;
  const tenantClaims = claims.value;
  return withUserTx(tenantClaims, async (tx) => {
    const done = await dismissMfaPrompt(tx);
    if (done) {
      await insertAuditEvent(tx, actorFromClaims(tenantClaims), {
        action: 'platform.auth.mfa_prompt_dismissed',
        entityType: 'user',
        entityId: tenantClaims.sub,
      });
    }
    return done;
  });
}

const CHANGE_PASSWORD_ACTION = 'platform.auth.change_password';

/**
 * My profile password change (FR-IAM-16). After a successful change, every browser the account trusted
 * but this one is forgotten (T-M2-11 security review L2) — with `after()`: the action is still inside its
 * transaction here, and the limiter's own transaction must never wait for a pooled connection meanwhile.
 */
export async function changePasswordForRequest(input: {
  readonly currentPassword: string;
  readonly newPassword: string;
}) {
  const deps = await requestDeps();
  const deviceToken = trustedDeviceCookie(await cookies()).read();
  return changePassword(
    {
      supabase: deps.supabase as unknown as PasswordClientLike | null,
      verifyPassword: createPasswordVerifier(
        () => createSupabaseVerifierClient() as VerifierClientLike | null,
        deps.logWarning,
      ),
      securityLog,
      logWarning: deps.logWarning,
      forgetOtherTrustedBrowsers: (email) => {
        after(() =>
          forgetOtherTrustedBrowsers(limiterDeps(), CHANGE_PASSWORD_ACTION, email, deviceToken),
        );
      },
    },
    input,
  );
}

/**
 * The code limiter of one flow for this request's client (T-M2-10 security review, TM-0003 T-IAM-12):
 * `withCodeAttemptLimit` on the shared limiter — per account (the user whose code is checked) and per
 * client, wrong codes only, fail closed. Every code check takes it: the authenticator code
 * (`verifyTotpCode`), the e-mailed set-up code (`confirmMfaSetup`) and the code on the password-reset
 * page (`completePasswordReset`); `action` names the flow in the security events.
 */
function codeCheckLimitFor(
  client: RequestClient,
  action: string,
  flow: CodeCheckFlow = 'session',
): CodeCheckLimit {
  const limiter = createCodeAttemptLimiter({
    ...limiterDeps(),
    client,
    action,
    flow,
    // Wrong codes after the password paused code checks: the owner is e-mailed (integration review M1).
    requestLockedMail: requestMfaCodeLockedMail,
  });
  return (userId, verify, isWrongCode, options) =>
    withCodeAttemptLimit(limiter, userId, verify, isWrongCode, options);
}

/**
 * My profile's current-password checks per user (T-M2-11, T-M2-15a security review): counts one; false =
 * limited; throws RateLimiterUnavailableError when the limiter cannot answer (fail closed). Called by the
 * action BEFORE its transaction (platform-rbac my-profile.ts beforeTransaction): the limiter's own short
 * transaction never waits for a pooled connection while the action holds one (security review T-M2-11).
 */
export function allowPasswordCheckForRequest(userId: string): Promise<boolean> {
  return createPasswordCheckLimiter({
    ...limiterDeps(),
    action: CHANGE_PASSWORD_ACTION,
  })(userId);
}

// Invitations (FR-IAM-03, T-M2-07). The new account signs up through the public Auth API with the same
// cookie-bound client (publishable key); Auth's before-user-created hook admits only a valid invitation.
// No Auth secret key in the web app (ADR 0002 §7 note T-M2-07, security review H1).

const INVITATION_LOOKUP_ACTION = 'platform.invitation.lookup';
const INVITATION_ACCEPT_ACTION = 'platform.invitation.accept';

function invitationLimiter(client: RequestClient) {
  return createInvitationLimiter({
    ...limiterDeps(),
    client,
    lookupAction: INVITATION_LOOKUP_ACTION,
    signUpAction: INVITATION_ACCEPT_ACTION,
  });
}

/** Unknown invitation codes per client (fail closed), for every invitation action. */
function invitationCodeGuard(client: RequestClient): InvitationCodeGuard {
  const limiter = invitationLimiter(client);
  return { attempt: () => limiter.allowCodeAttempt(), found: () => limiter.codeFound() };
}

function invitationDeps(auth: AuthFlowDeps, client: RequestClient): InvitationAcceptDeps {
  return {
    auth,
    signUpClient: auth.supabase as unknown as InvitationSignUpClientLike | null,
    hashToken: hashInvitationToken,
    invitationByToken,
    codeGuard: invitationCodeGuard(client),
    invitationPasswordMinLength,
    acceptInvitationAsCaller,
    allowSignUp: (tokenHash) => invitationLimiter(client).allowSignUp(tokenHash),
  };
}

/**
 * What the accept page shows for a link: its state and, when valid, the details and who is looking
 * (no session needed). Called by the page's public lookup action with the token from the URL fragment.
 * Lookups are limited per client (T-M2-11; RATE_LIMITED when used up).
 */
export async function lookupInvitationLinkForRequest(
  token: string,
  client: RequestClient,
): Promise<Result<InvitationLinkView, AppError>> {
  // Per link (its token hash; a malformed link: the client only) and per client (integration review M3);
  // unknown codes per client (IPv6 /48) and for all clients (codes are 12 characters). Every limit fails
  // closed.
  const normalized = normalizeInvitationSecret(token);
  const tokenHash = normalized === null ? null : hashInvitationToken(normalized);
  if (!(await invitationLimiter(client).allowLookup(tokenHash))) {
    return err(appError('RATE_LIMITED'));
  }
  try {
    return ok(
      await lookupInvitationLink(
        {
          hashToken: hashInvitationToken,
          invitationByToken,
          invitationPasswordMinLength,
          codeGuard: invitationCodeGuard(client),
          auth: await requestDeps(undefined, client),
        },
        token,
      ),
    );
  } catch (error) {
    return codesLimited(error);
  }
}

export async function acceptInvitationWithNewAccountForRequest(
  input: Parameters<typeof acceptInvitationWithNewAccount>[1],
  client: RequestClient,
) {
  return acceptInvitationWithNewAccount(
    invitationDeps(await requestDeps(undefined, client), client),
    input,
  );
}

/** "Sign in to accept": the sign-in guard applies (per account and per client), as for sign-in. */
export async function acceptInvitationWithPasswordForRequest(
  input: { readonly token: string; readonly password: string },
  client: RequestClient,
) {
  return acceptInvitationWithPassword(
    invitationDeps(
      await requestDeps(
        await signInGuardFor(client, 'platform.invitation.accept_with_sign_in'),
        client,
      ),
      client,
    ),
    input,
  );
}

export async function acceptInvitationAsSignedInUserForRequest(
  input: { readonly token: string },
  client: RequestClient,
) {
  return acceptInvitationAsSignedInUser(
    invitationDeps(await requestDeps(undefined, client), client),
    input,
  );
}

// Forgot / reset password (FR-IAM-13, T-M2-08): Supabase Auth's recovery tokens, verified on a STATELESS
// client (publishable key, session in memory only, no PKCE) — the recovery session never reaches the
// browser or the session cookies. No Auth secret key in the web app. The e-mails are sent by Auth's own
// mailer or, with PASSWORD_RESET_DELIVERY=worker, by our notification service (T-M2-17): the web app then
// only queues requests in the database; the worker holds the Auth admin key.

/** Auth's own mailer, or the worker's queue (PASSWORD_RESET_DELIVERY, read on the server only). */
function resetEmailDelivery(client: RequestClient): ResetEmailDelivery {
  if (readPasswordResetDelivery(process.env) === 'worker') {
    return { mode: 'worker', enqueue: requestPasswordResetMail };
  }
  return {
    mode: 'auth',
    client: createSupabaseStatelessClient(
      undefined,
      authClientOptions(client),
    ) as RecoveryClientLike | null,
  };
}

const RESET_REQUEST_ACTION = 'platform.auth.request_password_reset';
const RESET_COMPLETE_ACTION = 'platform.auth.password_reset';

function resetLimiter(client: RequestClient) {
  return createPasswordResetLimiter({
    ...limiterDeps(),
    client,
    requestAction: RESET_REQUEST_ACTION,
    completeAction: RESET_COMPLETE_ACTION,
  });
}

/**
 * Screen 10: checks the shared limiter (per client, then per account) and asks Auth for a reset link, or
 * queues the request for the worker, in the background; resolves after a constant time and never throws.
 * The work may finish after the answer (`after()`).
 */
export async function requestPasswordResetForRequest(
  input: { readonly email: string },
  client: RequestClient,
): Promise<void> {
  const limiter = resetLimiter(client);
  return requestPasswordReset(
    {
      delivery: resetEmailDelivery(client),
      allowRequest: (email) => limiter.allowRequest(email),
      logWarning: (message, fields) => {
        log.warn(message, fields);
      },
      sleep,
      keepAlive: (work) => {
        after(work);
      },
    },
    input,
  );
}

/**
 * Screen 11: limited per client (fail closed — the link is not spent), verifies the link, sets the
 * password, ends every session of the account and its sign-in lock; this browser becomes trusted for the
 * account — 30 days with `remember` («تذكّر هذا المتصفح»), else 24 hours — (its cookie is set) and the
 * account's other trusted browsers are forgotten (T-M2-11 M2, re-review N1).
 */
export async function completePasswordResetForRequest(
  input: {
    readonly tokenHash: string;
    readonly password: string;
    readonly code?: string | undefined;
    readonly remember?: boolean;
  },
  client: RequestClient,
) {
  const auth = await requestDeps(undefined, client);
  const limiter = resetLimiter(client);
  const recoveryClient = createSupabaseStatelessClient(
    undefined,
    authClientOptions(client),
  ) as RecoveryClientLike | null;
  const device = trustedDeviceCookie(await cookies());
  return completePasswordReset(
    {
      client: recoveryClient,
      allowAttempt: () => limiter.allowCompletion(),
      unlockSignIn: (email, remember) =>
        resetAccountSignIn(limiterDeps(), RESET_COMPLETE_ACTION, email, device, remember),
      // The authenticator code of an account with an app (T-M2-10), limited like every code (T-M2-11) —
      // with its own account budget (integration review M1): wrong codes after the password elsewhere
      // never keep the owner from resetting it.
      limitCodeCheck: codeCheckLimitFor(client, RESET_COMPLETE_ACTION, 'reset'),
      // Strictest wins (T-M2-10): asked with the recovery session's own, verified access token.
      passwordMinLength: async (accessToken) => {
        const claims = await verifyClaims(
          recoveryClient as unknown as SupabaseAuthLike | null,
          accessToken,
        );
        return claims.ok ? withUserTx(claims.value, (tx) => passwordMinLengthForCaller(tx)) : null;
      },
      logInfo: (message, fields) => {
        log.info(message, fields);
      },
      logWarning: auth.logWarning,
      // The browser's own session cookies (whoever was signed in here): the sign-in page follows.
      endBrowserSession: async () => {
        try {
          await auth.supabase?.auth.signOut({ scope: 'local' });
        } catch {
          // Nothing to end, or Auth unreachable: the cookies are cleared by auth-js either way.
        }
      },
      ...(readPasswordResetDelivery(process.env) === 'worker'
        ? { queuePasswordChangedNotice: requestPasswordChangedMail }
        : {}),
    },
    input,
  );
}

/**
 * My profile (FR-IAM-16), inside the action's withUserTx after the password changed: with
 * PASSWORD_RESET_DELIVERY=worker, queues the member's "password changed" notice (our notification
 * service, the session's organization). Best effort: never fails the change (a code is logged).
 */
export async function queueOwnPasswordChangedNoticeForRequest(
  tx: Parameters<typeof queueOwnPasswordChangedMail>[0],
  userId: string,
): Promise<void> {
  if (readPasswordResetDelivery(process.env) !== 'worker') return;
  try {
    await queueOwnPasswordChangedMail(tx, userId);
  } catch (error) {
    log.warn('password changed notice could not be queued', {
      action: 'platform.auth.change_password',
      reason: 'notice_not_queued',
      errorName: error instanceof Error ? error.name : 'unknown',
    });
  }
}

// Platform Super Admin console «مشرف المنصة» (FR-ADM-17; platform-console.ts): the session's own claims
// (getClaims; getUser before creating an organization or revealing or changing a code) and the database's
// decision whether it is a Super Admin's. Everyone else: NOT_FOUND.
function platformConsoleDeps(): PlatformConsoleDeps {
  return {
    getClaims: ({ strict }) => (strict ? getVerifiedClaimsStrict() : getVerifiedClaims()),
    withUserTx,
    isPlatformAdmin,
    listPlatformTenants,
    createPlatformTenant,
    platformAdminInvitationCode,
    reissuePlatformAdminCode,
  };
}

/** Is the current session a Platform Super Admin's? (Sign-in routing, the organization chooser.) */
export async function isPlatformAdminForRequest(): Promise<boolean> {
  return isPlatformAdminSession(platformConsoleDeps());
}

export async function loadPlatformOrganizationsForRequest() {
  return loadPlatformOrganizations(platformConsoleDeps());
}

/** The console's actions: untrusted input, parsed only after the access check (review L6). */
export async function createOrganizationFromConsoleForRequest(
  raw: unknown,
  parse: ConsoleInputParser<NewPlatformTenant>,
) {
  return createOrganizationFromConsole(platformConsoleDeps(), raw, parse);
}

export async function viewOrganizationAdminCodeForRequest(
  raw: unknown,
  parse: ConsoleInputParser<string>,
) {
  return viewOrganizationAdminCode(platformConsoleDeps(), raw, parse);
}

export async function reissueOrganizationAdminCodeForRequest(
  raw: unknown,
  parse: ConsoleInputParser<string>,
) {
  return reissueOrganizationAdminCode(platformConsoleDeps(), raw, parse);
}

// Platform settings → Email of the console (WP-ADM-01; platform-email-console.ts): the same access rule.
function platformEmailConsoleDeps() {
  return {
    getClaims: ({ strict }: { readonly strict: boolean }) =>
      strict ? getVerifiedClaimsStrict() : getVerifiedClaims(),
    withUserTx,
    isPlatformAdmin,
    getPlatformEmailSettings,
    savePlatformEmailSettings,
    getEmailCredentialsPublicKey,
  };
}

export async function loadPlatformEmailSettingsForRequest() {
  return loadPlatformEmailSettings(platformEmailConsoleDeps());
}

/** «حفظ وإرسال رسالة تجريبية»: untrusted input, parsed only after the access check (review L6). */
export async function savePlatformEmailSettingsForRequest(
  raw: unknown,
  parse: ConsoleInputParser<PlatformEmailInput>,
) {
  return savePlatformEmailSettingsFromConsole(platformEmailConsoleDeps(), raw, parse);
}
