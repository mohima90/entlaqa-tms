import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import {
  type AppError,
  type Result,
  type VerifiedClaims,
  actorFromClaims,
  appError,
  codeIsFresh,
  defineErrorCodes,
  err,
  hasTenant,
  ok,
} from '@jadarat/platform-core';
import type {
  AuditEventInput,
  MfaAppRemoval,
  MfaFactorMailOutcome,
  MfaLinkOutcome,
  MfaSetupConfirmation,
  MyMfaApp,
  SessionAccess,
  UserTx,
  WithUserTx,
} from '@jadarat/platform-db';
import type { LogFields } from '@jadarat/platform-observability';
import { AuthServiceError, recordAudit, sessionTokens } from './auth-flow';
import { type SupabaseAuthLike, verifyClaims, verifyClaimsStrict } from './verify-claims';

/**
 * Multi-factor authentication with an authenticator app (TOTP) — FR-IAM-12, T-M2-10, approved screens 3,
 * 6 and 8 (step 2). Supabase Auth keeps the factors and its own assurance level (aal1 → aal2); these flows
 * only call it with the signed-in user's OWN session (no Auth secret key, ADR 0002 §7):
 *   - set up: a new TOTP factor (QR code + the key to type in; a unique name, and unfinished set-ups are
 *     left alone — they may be another sign-in's, and Auth deletes them itself after a few minutes), then
 *     its first code verifies it. The app counts only once its owner proved BOTH the mailbox and the app
 *     (security re-review N1, TM-0003 T-IAM-11): the database records it as waiting with THIS session,
 *     audits it and queues the set-up e-mail with a one-time 8-digit code; the code is accepted only in the
 *     window (Auth session) that set the app up. Every other session of the account sees "an app was added
 *     from another sign-in" and can remove it (its other sessions end). Until then a code from that app
 *     satisfies neither the organization's policy nor a high-risk action (the database's effective AAL2: a
 *     code from a CONFIRMED app). A delayed e-mail delays nothing else; "send the e-mail again" works from
 *     that window;
 *   - code at sign-in or before a sensitive action: the account's CONFIRMED app, named explicitly (never
 *     "the first verified factor"), one code → aal2. High-risk actions also want the code to be recent
 *     (platform-core STEP_UP_MAX_AGE_SECONDS, review L3; the database checks it too);
 *   - remove: through the database (private.remove_mfa_app), never Auth's own unenroll — a confirmed app
 *     from a session that passed a recent code of it; this window's own set-up; or an app added from
 *     another sign-in. Every removal is audited and e-mailed by the database.
 * The organization's MFA policy is applied by the database (private.session_access): a session it refuses
 * reads nothing until it passes here. Secrets and codes are never logged or audited.
 *
 * Attempt limits (review M3): Auth limits verifications per IP (all ours come from the app server); the
 * sign-in limiter (T-M2-11, INTEGRATION POINT) wraps verifyTotpCodeAction with per-account limits. Each
 * refused code is logged with a stable action and error code (no personal data). The e-mailed code dies
 * after 5 wrong tries, and 15 wrong codes on the account within 24 hours remove its waiting apps (the
 * database; final re-review L2).
 */
export const MfaErrors = defineErrorCodes({
  /** The code is wrong or expired (one message for both). */
  MFA_CODE_INVALID: { status: 422, messageKey: 'mfa.errors.codeInvalid' },
  /** The account has no authenticator app to ask a code from. */
  MFA_NOT_SET_UP: { status: 409, messageKey: 'mfa.errors.notSetUp' },
  /** The account already uses an app (one per account in R1). */
  MFA_ALREADY_SET_UP: { status: 409, messageKey: 'mfa.errors.alreadySetUp' },
  /** The set-up was not found (expired or replaced in another tab): start again. */
  MFA_SETUP_EXPIRED: { status: 409, messageKey: 'mfa.errors.setupExpired' },
  /** The e-mailed code is wrong (the database counts the tries). */
  MFA_EMAIL_CODE_INVALID: { status: 422, messageKey: 'mfa.errors.emailCodeInvalid' },
  /** The e-mailed code expired: send the e-mail again. */
  MFA_EMAIL_CODE_EXPIRED: { status: 409, messageKey: 'mfa.errors.emailCodeExpired' },
  /** Five wrong e-mailed codes: the code no longer works; send the e-mail again for a new one. */
  MFA_EMAIL_CODE_LOCKED: { status: 409, messageKey: 'mfa.errors.emailCodeLocked' },
  /** The app waiting for its code was set up from another sign-in: only that window can confirm it. */
  MFA_SET_UP_ELSEWHERE: { status: 409, messageKey: 'mfa.errors.setUpElsewhere' },
  /** "Send the e-mail again" within 2 minutes of the last one. */
  MFA_RESEND_TOO_SOON: { status: 429, messageKey: 'mfa.errors.resendTooSoon' },
  /**
   * 15 wrong e-mailed codes on the account within 24 hours (final re-review L2): its waiting apps were removed
   * and the windows that set them up signed out; the owner was e-mailed.
   */
  MFA_SETUP_REMOVED: { status: 409, messageKey: 'mfa.errors.setupRemoved' },
});

/** The e-mailed set-up code (re-review N1): 8 digits. */
export const MFA_EMAIL_CODE_PATTERN = /^[0-9]{8}$/;

/** The stable name of a refused e-mailed set-up code in the logs (T-M2-11 may count them). */
export const MFA_CONFIRM_ACTION = 'platform.auth.mfa_confirm';

/** The stable name of a refused authenticator code in the logs (review M3; T-M2-11 counts them). */
export const MFA_VERIFY_ACTION = 'platform.auth.mfa_verify';

interface AuthErrorLike {
  readonly status?: number | undefined;
  readonly code?: string | undefined;
}

export interface FactorLike {
  readonly id: string;
  readonly factor_type?: string | undefined;
  readonly status?: string | undefined;
}

/** The subset of the cookie-bound Supabase Auth client the MFA flows use. */
export interface MfaClientLike extends SupabaseAuthLike {
  readonly auth: SupabaseAuthLike['auth'] & {
    readonly mfa: {
      listFactors(): Promise<{
        data: { readonly all: readonly FactorLike[] } | null;
        error: AuthErrorLike | null;
      }>;
      enroll(params: { factorType: 'totp'; issuer?: string; friendlyName?: string }): Promise<{
        data: {
          readonly id: string;
          readonly totp: {
            readonly qr_code: string;
            readonly secret: string;
            readonly uri: string;
          };
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

export interface MfaDeps {
  readonly supabase: MfaClientLike | null;
  readonly withUserTx: WithUserTx;
  readonly insertAuditEvent: (
    tx: UserTx,
    actor: ReturnType<typeof actorFromClaims>,
    event: AuditEventInput,
  ) => Promise<void>;
  /** Where the session stands in its organization (database decision, T-M2-10). */
  readonly getSessionAccess: (tx: UserTx) => Promise<SessionAccess>;
  /** The account's apps as this session sees them: confirmed, waiting here, or added elsewhere. */
  readonly listMyMfaApps: (tx: UserTx) => Promise<readonly MyMfaApp[]>;
  /**
   * After a set-up, or "send the e-mail again" (same session): the app waits for the e-mailed code;
   * recorded, audited and e-mailed by the database (re-review N1).
   */
  readonly requestMfaFactorMail: (tx: UserTx, factorId: string) => Promise<MfaFactorMailOutcome>;
  /** The e-mailed code, from the session that set the app up (the database decides). */
  readonly confirmMfaSetup: (
    tx: UserTx,
    factorId: string,
    code: string,
  ) => Promise<MfaSetupConfirmation>;
  /** Removes one of the account's apps (the database decides, audits and e-mails). */
  readonly removeMfaApp: (tx: UserTx, factorId: string) => Promise<MfaAppRemoval>;
  /** Once a code let the session act in its organization: its device limit (review L1). */
  readonly applyDeviceLimit: (tx: UserTx) => Promise<number>;
  readonly logWarning: (message: string, fields: LogFields) => void;
}

/** The authenticator-app label (issuer) shown in the app next to the account's e-mail. */
export const TOTP_ISSUER = 'Jadarat';
/** Auth wants a name per factor, unique per account: a fixed label plus a random suffix. */
const FRIENDLY_NAME = 'Jadarat authenticator';

const isTotp = (factor: FactorLike) => factor.factor_type === 'totp';
const isVerified = (factor: FactorLike) => factor.status === 'verified';

/** Auth's answers that mean "this session is no longer valid": sign in again. */
function sessionGone(error: AuthErrorLike): boolean {
  return error.status === 401 || error.code === 'session_not_found' || error.code === 'bad_jwt';
}

/** Unexpected Auth refusal (handled 4xx) vs Auth unavailable (thrown). */
function authFailure(error: AuthErrorLike, fallback: AppError): Result<never, AppError> {
  if (error.status === 429 || error.code === 'over_request_rate_limit') {
    return err(appError('RATE_LIMITED'));
  }
  if (sessionGone(error)) return err(appError('UNAUTHENTICATED'));
  if (error.code === 'insufficient_aal') return err(appError('STEP_UP_REQUIRED'));
  if (error.status !== undefined && error.status >= 400 && error.status < 500) return err(fallback);
  throw new AuthServiceError(error.status);
}

async function factorsOf(
  supabase: MfaClientLike,
): Promise<Result<readonly FactorLike[], AppError>> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return authFailure(error, appError('UNAUTHENTICATED'));
  return ok((data?.all ?? []).filter(isTotp));
}

export interface MfaOverview {
  /** The account has a verified authenticator app in Auth (confirmed or not: see `apps`). */
  readonly usesApp: boolean;
  /** The current session passed a code (Auth's aal2). */
  readonly sessionVerified: boolean;
  /** …recently enough for a high-risk action (STEP_UP_MAX_AGE_SECONDS, review L3). */
  readonly codeFresh: boolean;
  /** The account's apps as the database sees them for this session (re-review N1). */
  readonly apps: readonly MyMfaApp[];
}

/** What the account has (strict: confirmed with Auth), and its apps as the database counts them. */
export async function getMfaOverview(deps: MfaDeps): Promise<Result<MfaOverview, AppError>> {
  const { supabase } = deps;
  if (!supabase) return err(appError('NOT_CONFIGURED'));
  const claims = await verifyClaimsStrict(supabase);
  if (!claims.ok) return claims;
  const factors = await factorsOf(supabase);
  if (!factors.ok) return factors;
  const sessionVerified = claims.value.aal === 'aal2';
  const apps = await deps.withUserTx(claims.value, (tx) => deps.listMyMfaApps(tx));
  return ok({
    usesApp: factors.value.some(isVerified),
    sessionVerified,
    codeFresh: sessionVerified && codeIsFresh(claims.value),
    apps,
  });
}

export interface TotpSetup {
  readonly factorId: string;
  /** SVG data URL of the QR code (the account's own secret: shown once, never stored or logged). */
  readonly qrCode: string;
  /** The key to type into the app when the QR code cannot be scanned. */
  readonly secret: string;
}

/**
 * Starts setting up an authenticator app: asks Auth for a new TOTP factor. An account that already has an
 * app — confirmed, waiting for its e-mailed code, or added from another sign-in — keeps it
 * (MFA_ALREADY_SET_UP: the /mfa page shows that app instead). Unfinished set-ups are NOT removed here
 * (re-review N1): they may belong to another sign-in, and a session at AAL1 must not cancel someone's set-up
 * (Auth deletes unfinished factors itself after a few minutes). A random suffix keeps the name unique.
 */
export async function startTotpSetup(deps: MfaDeps): Promise<Result<TotpSetup, AppError>> {
  const { supabase } = deps;
  if (!supabase) return err(appError('NOT_CONFIGURED'));
  const claims = await verifyClaimsStrict(supabase);
  if (!claims.ok) return claims;
  const factors = await factorsOf(supabase);
  if (!factors.ok) return factors;
  if (factors.value.some(isVerified)) return err(appError(MfaErrors.MFA_ALREADY_SET_UP));
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    issuer: TOTP_ISSUER,
    friendlyName: `${FRIENDLY_NAME} ${randomBytes(4).toString('hex')}`,
  });
  if (error) return authFailure(error, appError(MfaErrors.MFA_SETUP_EXPIRED));
  if (!data) throw new AuthServiceError(undefined);
  return ok({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
}

export interface MfaVerification {
  /** The first code of a set-up: the app waits for its e-mailed code. */
  readonly enrolled: boolean;
}

/** Runs `work`, logging (without details) instead of failing what Auth already did. */
async function bestEffort(deps: MfaDeps, action: string, work: () => Promise<unknown>) {
  try {
    await work();
  } catch {
    deps.logWarning('could not record an authenticator event', { action });
  }
}

/**
 * A session the organization refused until now (selectOrganization could not write there yet) that may
 * act now: its sign-in is audited and the organization's device limit applies (review L1).
 */
async function completeSignIn(
  deps: MfaDeps,
  session: VerifiedClaims,
  wasRefused: boolean,
  options: { readonly auditCode: boolean },
): Promise<void> {
  if (!hasTenant(session)) return;
  let access: SessionAccess | null;
  try {
    access = await deps.withUserTx(session, (tx) => deps.getSessionAccess(tx));
  } catch {
    deps.logWarning('could not record an authenticator event', { action: MFA_VERIFY_ACTION });
    access = null;
  }
  // Still refused (e.g. an app waiting for its e-mailed code): nothing more to record yet.
  if (access?.state !== 'ok') return;
  if (options.auditCode) await recordMfaAudit(deps, session, 'platform.auth.mfa_verified');
  if (wasRefused) {
    await bestEffort(deps, 'platform.auth.signed_in', () =>
      recordAudit(deps, session, 'platform.auth.signed_in', 'password+totp'),
    );
    await bestEffort(deps, 'platform.auth.sessions_evicted', () =>
      deps.withUserTx(session, (tx) => deps.applyDeviceLimit(tx)),
    );
  }
}

async function wasRefusedBefore(deps: MfaDeps, claims: VerifiedClaims): Promise<boolean> {
  if (!hasTenant(claims)) return false;
  const before = await deps.withUserTx(claims, (tx) => deps.getSessionAccess(tx));
  return before.state !== 'ok';
}

/**
 * Verifies a code: the first code of a set-up (`factorId` given: an UNFINISHED factor of this account in
 * Auth) or a code from the account's CONFIRMED app (at sign-in, or before a sensitive action) — always an
 * explicit factor, never "the first verified one" (re-review): an app someone else added and nobody
 * confirmed never answers a challenge. Auth's session becomes aal2 (it rewrites the session cookies). A
 * set-up then waits for its e-mailed code; a code that let a refused session in completes its sign-in
 * (audited, and the organization's device limit applies).
 */
export async function verifyTotpCode(
  deps: MfaDeps,
  input: { readonly code: string; readonly factorId?: string | undefined },
): Promise<Result<MfaVerification, AppError>> {
  const { supabase } = deps;
  if (!supabase) return err(appError('NOT_CONFIGURED'));
  const claims = await verifyClaimsStrict(supabase);
  if (!claims.ok) return claims;
  let factorId: string;
  const enrolled = input.factorId !== undefined;
  if (input.factorId !== undefined) {
    const factors = await factorsOf(supabase);
    if (!factors.ok) return factors;
    const unfinished = factors.value.find((f) => f.id === input.factorId && !isVerified(f));
    if (!unfinished) return err(appError(MfaErrors.MFA_SETUP_EXPIRED));
    factorId = unfinished.id;
  } else {
    const apps = await deps.withUserTx(claims.value, (tx) => deps.listMyMfaApps(tx));
    const confirmed = apps.find((app) => app.confirmed);
    if (!confirmed) return err(appError(MfaErrors.MFA_NOT_SET_UP));
    factorId = confirmed.factorId;
  }
  const wasRefused = enrolled ? false : await wasRefusedBefore(deps, claims.value);
  const { data, error } = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code: input.code,
  });
  if (error) {
    if (
      error.code === 'mfa_verification_failed' ||
      error.code === 'mfa_challenge_expired' ||
      error.code === 'mfa_verification_rejected'
    ) {
      deps.logWarning('authenticator code refused', {
        action: MFA_VERIFY_ACTION,
        outcome: 'failure',
        errorCode: MfaErrors.MFA_CODE_INVALID.code,
        status: error.status ?? 0,
        ...(hasTenant(claims.value) ? { tenantId: claims.value.tenant_id } : {}),
      });
      return err(appError(MfaErrors.MFA_CODE_INVALID));
    }
    if (error.code === 'mfa_factor_not_found') return err(appError(MfaErrors.MFA_SETUP_EXPIRED));
    return authFailure(error, appError(MfaErrors.MFA_CODE_INVALID));
  }
  // Auth answered with the upgraded session (cookies rewritten): continue with ITS claims (aal2).
  const tokens = sessionTokens({ session: data });
  const upgraded = await verifyClaims(supabase, tokens?.accessToken);
  if (!upgraded.ok) return ok({ enrolled });
  const session = upgraded.value;
  if (enrolled) {
    // Also without an organization: the database records the app with THIS session, audits it and
    // e-mails the code. If that fails, "send the e-mail again" (this window) records it later.
    await bestEffort(deps, 'platform.auth.mfa_enrolled', async () => {
      const outcome = await deps.withUserTx(session, (tx) =>
        deps.requestMfaFactorMail(tx, factorId),
      );
      if (outcome === 'refused') {
        deps.logWarning('the new authenticator app was not recorded', {
          action: 'platform.auth.mfa_enrolled',
          reason: outcome,
        });
      }
    });
    return ok({ enrolled });
  }
  await completeSignIn(deps, session, wasRefused, { auditCode: true });
  return ok({ enrolled });
}

/** This window's app waiting for its e-mailed code, or why there is none. */
async function waitingHere(
  deps: MfaDeps,
  session: VerifiedClaims,
): Promise<Result<MyMfaApp, AppError>> {
  const apps = await deps.withUserTx(session, (tx) => deps.listMyMfaApps(tx));
  const here = apps.find((app) => !app.confirmed && app.here);
  if (here) return ok(here);
  return err(
    appError(
      apps.some((app) => !app.confirmed)
        ? MfaErrors.MFA_SET_UP_ELSEWHERE
        : MfaErrors.MFA_NOT_SET_UP,
    ),
  );
}

/**
 * The e-mailed code of a new app (re-review N1), typed into the window that set the app up: the database
 * accepts it only from that Auth session (aal2 through that app) — the mailbox's owner cannot confirm an
 * app someone else set up, and whoever set it up cannot without the mailbox. From then on the app counts;
 * a session the organization refused until now completes its sign-in.
 */
export async function confirmMfaSetup(
  deps: MfaDeps,
  input: { readonly code: string },
): Promise<Result<{ readonly confirmed: true }, AppError>> {
  const { supabase } = deps;
  if (!supabase) return err(appError('NOT_CONFIGURED'));
  const claims = await verifyClaimsStrict(supabase);
  if (!claims.ok) return claims;
  const session = claims.value;
  const app = await waitingHere(deps, session);
  if (!app.ok) return app;
  const wasRefused = await wasRefusedBefore(deps, session);
  const outcome = await deps.withUserTx(session, (tx) =>
    deps.confirmMfaSetup(tx, app.value.factorId, input.code),
  );
  if (outcome !== 'confirmed') {
    const error =
      outcome === 'invalid'
        ? MfaErrors.MFA_EMAIL_CODE_INVALID
        : outcome === 'expired'
          ? MfaErrors.MFA_EMAIL_CODE_EXPIRED
          : outcome === 'locked'
            ? MfaErrors.MFA_EMAIL_CODE_LOCKED
            : outcome === 'removed'
              ? MfaErrors.MFA_SETUP_REMOVED
              : MfaErrors.MFA_SET_UP_ELSEWHERE;
    deps.logWarning('e-mailed authenticator set-up code refused', {
      action: MFA_CONFIRM_ACTION,
      outcome: 'failure',
      errorCode: error.code,
      ...(hasTenant(session) ? { tenantId: session.tenant_id } : {}),
    });
    return err(appError(error));
  }
  await completeSignIn(deps, session, wasRefused, { auditCode: false });
  return ok({ confirmed: true });
}

/**
 * "Send the e-mail again" from the window that set the app up (re-review N1): a new e-mail with a new code
 * (the earlier code stops working, the tries start again). `sent: false` — one is already on its way.
 */
export async function resendMfaSetupMail(
  deps: MfaDeps,
): Promise<Result<{ readonly sent: boolean }, AppError>> {
  const { supabase } = deps;
  if (!supabase) return err(appError('NOT_CONFIGURED'));
  const claims = await verifyClaimsStrict(supabase);
  if (!claims.ok) return claims;
  const session = claims.value;
  const app = await waitingHere(deps, session);
  if (!app.ok) return app;
  const outcome = await deps.withUserTx(session, (tx) =>
    deps.requestMfaFactorMail(tx, app.value.factorId),
  );
  if (outcome === 'too_soon') return err(appError(MfaErrors.MFA_RESEND_TOO_SOON));
  if (outcome === 'refused') return err(appError(MfaErrors.MFA_SET_UP_ELSEWHERE));
  return ok({ sent: outcome === 'queued' });
}

/**
 * Removes one of the account's apps through the database (re-review N1; never Auth's own unenroll — the
 * database knows which app it removes and why): a confirmed app needs a recent code from it (else
 * STEP_UP_REQUIRED); this window's own set-up is cancelled; an app added from another sign-in is removed and
 * every OTHER session of the account ends. Audited and e-mailed by the database.
 */
export async function removeMfaApp(
  deps: MfaDeps,
  input: { readonly factorId: string },
): Promise<Result<null, AppError>> {
  const { supabase } = deps;
  if (!supabase) return err(appError('NOT_CONFIGURED'));
  const claims = await verifyClaimsStrict(supabase);
  if (!claims.ok) return claims;
  const outcome = await deps.withUserTx(claims.value, (tx) =>
    deps.removeMfaApp(tx, input.factorId),
  );
  if (outcome === 'step_up') return err(appError('STEP_UP_REQUIRED'));
  if (outcome === 'refused') return err(appError(MfaErrors.MFA_NOT_SET_UP));
  return ok(null);
}

async function recordMfaAudit(
  deps: MfaDeps,
  claims: VerifiedClaims,
  action: 'platform.auth.mfa_verified',
): Promise<void> {
  if (!hasTenant(claims)) return;
  const actor = actorFromClaims(claims);
  await bestEffort(deps, action, () =>
    deps.withUserTx(claims, (tx) =>
      deps.insertAuditEvent(tx, actor, {
        action,
        entityType: 'user',
        entityId: claims.sub,
        data: { method: 'totp' },
      }),
    ),
  );
}

// ---------------------------------------------------------------------------------------------------
// The set-up e-mail's "not you? remove this app" link (review H1): no session needed
// ---------------------------------------------------------------------------------------------------

/** A link token as the worker makes it: 32 random bytes, base64url (43 characters). */
export const MFA_LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface MfaLinkDeps {
  readonly rejectMfaFactor: (tokenHash: Buffer) => Promise<MfaLinkOutcome>;
  readonly logInfo: (message: string, fields: LogFields) => void;
}

/**
 * The "not you? remove this app" link of a set-up e-mail, with the token the page read from the URL
 * fragment: removes that app and ends every session of the account (and e-mails it). Only its SHA-256
 * reaches the database (single use). The token is never logged. (The app itself is confirmed with the
 * e-mailed CODE in the window that set it up — re-review N1 — never with a link.)
 */
export async function openMfaRemoveLink(deps: MfaLinkDeps, token: string): Promise<MfaLinkOutcome> {
  if (!MFA_LINK_TOKEN_PATTERN.test(token)) return 'invalid';
  const hash = createHash('sha256').update(token, 'utf8').digest();
  const outcome = await deps.rejectMfaFactor(hash);
  deps.logInfo('authenticator e-mail link opened', {
    action: 'platform.auth.mfa_removed',
    reason: outcome,
  });
  return outcome;
}
