/**
 * Next.js adapter for the sign-in flow (auth-flow.ts): a Supabase client bound to the request cookies
 * (writable in server actions) and the platform-db functions. Used only by apps/suite/src/auth/
 * (definePublicAction) and the sign-in / organization pages.
 */
import 'server-only';
import {
  acceptInvitationAsCaller,
  applyDeviceLimit,
  confirmMfaFactor,
  dismissMfaPrompt,
  getSessionAccess,
  hashInvitationToken,
  insertAuditEvent,
  invitationByToken,
  invitationPasswordMinLength,
  listSessionTenants,
  passwordMinLengthForCaller,
  queueOwnPasswordChangedMail,
  rejectMfaFactor,
  requestMfaFactorMail,
  requestMfaRemovedMail,
  requestPasswordChangedMail,
  requestPasswordResetMail,
  type SessionAccess,
  switchActiveTenant,
  withUserTx,
} from '@jadarat/platform-db';
import {
  createSupabaseServerClient,
  createSupabaseStatelessClient,
  createSupabaseVerifierClient,
} from '@jadarat/platform-db/supabase-server';
import { type AppError, type Result, actorFromClaims, hasTenant, ok } from '@jadarat/platform-core';
import { log } from '@jadarat/platform-observability';
import { cookies, headers } from 'next/headers';
import { after } from 'next/server';
import {
  type AuthClientLike,
  type AuthFlowDeps,
  getSessionOrganizations,
  selectOrganization,
  signInWithPassword,
  signOut,
  signOutEndedSession,
} from './auth-flow';
import {
  type MfaClientLike,
  type MfaDeps,
  type MfaOverview,
  getMfaOverview,
  openMfaLink,
  removeTotp,
  requestMfaConfirmationMail,
  startTotpSetup,
  verifyTotpCode,
} from './mfa';
import { type SupabaseAuthLike, verifyClaims } from './verify-claims';
import {
  type InvitationAcceptDeps,
  type InvitationLinkView,
  type InvitationSignUpClientLike,
  acceptInvitationAsSignedInUser,
  acceptInvitationWithNewAccount,
  acceptInvitationWithPassword,
  lookupInvitationLink,
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

async function requestDeps(): Promise<AuthFlowDeps> {
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
    { userAgent },
  );
  return {
    supabase: supabase as AuthClientLike | null,
    withUserTx,
    listSessionTenants,
    switchActiveTenant,
    getSessionAccess,
    insertAuditEvent,
    logWarning: (message, fields) => {
      log.warn(message, fields);
    },
  };
}

export async function signInWithPasswordForRequest(credentials: {
  readonly email: string;
  readonly password: string;
}) {
  return signInWithPassword(await requestDeps(), credentials);
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

async function mfaDeps(): Promise<MfaDeps> {
  const auth = await requestDeps();
  return {
    supabase: auth.supabase as unknown as MfaClientLike | null,
    withUserTx,
    insertAuditEvent,
    getSessionAccess,
    requestMfaFactorMail,
    requestMfaRemovedMail,
    applyDeviceLimit,
    logWarning: auth.logWarning,
  };
}

export async function getMfaOverviewForRequest() {
  return getMfaOverview(await mfaDeps());
}

/**
 * What the /mfa page shows: the account's app and this session's level (Auth), and where the session
 * stands in its organization (the database: a code or an app needed, or the set-up prompt).
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

export async function verifyTotpCodeForRequest(input: {
  readonly code: string;
  readonly factorId?: string | undefined;
}) {
  return verifyTotpCode(await mfaDeps(), input);
}

export async function removeTotpForRequest() {
  return removeTotp(await mfaDeps());
}

/** "Send the e-mail again" for an app waiting for its confirmation (review H1). */
export async function requestMfaConfirmationMailForRequest() {
  return requestMfaConfirmationMail(await mfaDeps());
}

/**
 * The set-up e-mail's links (review H1), with the token the page read from the URL fragment: no session
 * needed. "remove" ends every session of the account; this browser's cookies are cleared too.
 */
export async function openMfaLinkForRequest(kind: 'confirm' | 'remove', token: string) {
  const outcome = await openMfaLink(
    {
      confirmMfaFactor,
      rejectMfaFactor,
      logInfo: (message, fields) => {
        log.info(message, fields);
      },
    },
    kind,
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

export async function changePasswordForRequest(input: {
  readonly currentPassword: string;
  readonly newPassword: string;
}) {
  const deps = await requestDeps();
  return changePassword(
    {
      supabase: deps.supabase as unknown as PasswordClientLike | null,
      verifyPassword: createPasswordVerifier(
        () => createSupabaseVerifierClient() as VerifierClientLike | null,
        deps.logWarning,
      ),
      logWarning: deps.logWarning,
    },
    input,
  );
}

// Invitations (FR-IAM-03, T-M2-07). The new account signs up through the public Auth API with the same
// cookie-bound client (publishable key); Auth's before-user-created hook admits only a valid invitation.
// No Auth secret key in the web app (ADR 0002 §7 note T-M2-07, security review H1).

function invitationDeps(auth: AuthFlowDeps): InvitationAcceptDeps {
  return {
    auth,
    signUpClient: auth.supabase as unknown as InvitationSignUpClientLike | null,
    hashToken: hashInvitationToken,
    invitationByToken,
    invitationPasswordMinLength,
    acceptInvitationAsCaller,
  };
}

/**
 * What the accept page shows for a link: its state and, when valid, the details and who is looking
 * (no session needed). Called by the page's public lookup action with the token from the URL fragment.
 */
export async function lookupInvitationLinkForRequest(token: string): Promise<InvitationLinkView> {
  return lookupInvitationLink(
    {
      hashToken: hashInvitationToken,
      invitationByToken,
      invitationPasswordMinLength,
      auth: await requestDeps(),
    },
    token,
  );
}

export async function acceptInvitationWithNewAccountForRequest(
  input: Parameters<typeof acceptInvitationWithNewAccount>[1],
) {
  return acceptInvitationWithNewAccount(invitationDeps(await requestDeps()), input);
}

export async function acceptInvitationWithPasswordForRequest(input: {
  readonly token: string;
  readonly password: string;
}) {
  return acceptInvitationWithPassword(invitationDeps(await requestDeps()), input);
}

export async function acceptInvitationAsSignedInUserForRequest(input: { readonly token: string }) {
  return acceptInvitationAsSignedInUser(invitationDeps(await requestDeps()), input);
}

// Forgot / reset password (FR-IAM-13, T-M2-08): Supabase Auth's recovery tokens, verified on a STATELESS
// client (publishable key, session in memory only, no PKCE) — the recovery session never reaches the
// browser or the session cookies. No Auth secret key in the web app. The e-mails are sent by Auth's own
// mailer or, with PASSWORD_RESET_DELIVERY=worker, by our notification service (T-M2-17): the web app then
// only queues requests in the database; the worker holds the Auth admin key.

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** Auth's own mailer, or the worker's queue (PASSWORD_RESET_DELIVERY, read on the server only). */
function resetEmailDelivery(limited: boolean): ResetEmailDelivery {
  if (readPasswordResetDelivery(process.env) === 'worker') {
    return { mode: 'worker', enqueue: requestPasswordResetMail };
  }
  return {
    mode: 'auth',
    client: limited ? null : (createSupabaseStatelessClient() as RecoveryClientLike | null),
  };
}

/**
 * Screen 10: asks Auth for a reset link, or queues the request for the worker (unless the application
 * limiter refused it), and resolves after a constant time; never throws. The call may finish after the
 * answer (`after()`).
 */
export async function requestPasswordResetForRequest(input: {
  readonly email: string;
  readonly limited: boolean;
}): Promise<void> {
  return requestPasswordReset(
    {
      delivery: resetEmailDelivery(input.limited),
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

/** Screen 11: verifies the link, sets the password, ends every session of the account. */
export async function completePasswordResetForRequest(input: {
  readonly tokenHash: string;
  readonly password: string;
  readonly code?: string | undefined;
}) {
  const auth = await requestDeps();
  const client = createSupabaseStatelessClient() as RecoveryClientLike | null;
  return completePasswordReset(
    {
      client,
      // Strictest wins (T-M2-10): asked with the recovery session's own, verified access token.
      passwordMinLength: async (accessToken) => {
        const claims = await verifyClaims(
          client as unknown as SupabaseAuthLike | null,
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
