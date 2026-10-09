import 'server-only';
import { createHash } from 'node:crypto';
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
  MfaLinkOutcome,
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
 *   - set up: stale unfinished set-ups are removed, a new TOTP factor is created (QR code + the key to type
 *     in), then the first code verifies it. The app counts only once the account proved its mailbox
 *     (security review H1, TM-0003 T-IAM-11): the database records it as waiting, audits it and queues the
 *     set-up e-mail with a single-use confirmation link and a "not you? remove this app" link; until the
 *     link is opened, a code from that app satisfies neither the organization's policy nor a high-risk
 *     action (the database's effective AAL2: a code from a CONFIRMED app). A delayed e-mail delays nothing
 *     else; "send the e-mail again" asks for a new one;
 *   - code at sign-in or before a sensitive action: the account's verified app, one code → aal2. High-risk
 *     actions also want the code to be recent (platform-core STEP_UP_MAX_AGE_SECONDS, review L3);
 *   - remove: from a session that passed a recent code of the confirmed app (Auth's own rule is aal2);
 *     every removal is audited and e-mailed by the database.
 * The organization's MFA policy is applied by the database (private.session_access): a session it refuses
 * reads nothing until it passes here. Secrets and codes are never logged or audited.
 *
 * Attempt limits (review M3): Auth limits verifications per IP (all ours come from the app server); the
 * sign-in limiter (T-M2-11, INTEGRATION POINT) wraps verifyTotpCodeAction with per-account limits. Each
 * refused code is logged with a stable action and error code (no personal data).
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
});

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
      unenroll(params: {
        factorId: string;
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
  /**
   * After a set-up (factor id) or "send the e-mail again" (null): the app waits for its e-mailed
   * confirmation; audited and e-mailed by the database (review H1). True when an e-mail was queued.
   */
  readonly requestMfaFactorMail: (tx: UserTx, factorId: string | null) => Promise<boolean>;
  /** After the account removed its app in Auth: audited and e-mailed by the database. */
  readonly requestMfaRemovedMail: (tx: UserTx, factorId: string) => Promise<boolean>;
  /** Once a code let the session act in its organization: its device limit (review L1). */
  readonly applyDeviceLimit: (tx: UserTx) => Promise<number>;
  readonly logWarning: (message: string, fields: LogFields) => void;
}

/** The authenticator-app label (issuer) shown in the app next to the account's e-mail. */
export const TOTP_ISSUER = 'Jadarat';
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
  /** The account has a verified authenticator app in Auth (confirmed or not: see SessionAccess). */
  readonly usesApp: boolean;
  /** The current session passed a code (Auth's aal2). */
  readonly sessionVerified: boolean;
  /** …recently enough for a high-risk action (STEP_UP_MAX_AGE_SECONDS, review L3). */
  readonly codeFresh: boolean;
}

/** What the account has (strict: confirmed with Auth). */
export async function getMfaOverview(deps: MfaDeps): Promise<Result<MfaOverview, AppError>> {
  const { supabase } = deps;
  if (!supabase) return err(appError('NOT_CONFIGURED'));
  const claims = await verifyClaimsStrict(supabase);
  if (!claims.ok) return claims;
  const factors = await factorsOf(supabase);
  if (!factors.ok) return factors;
  const sessionVerified = claims.value.aal === 'aal2';
  return ok({
    usesApp: factors.value.some(isVerified),
    sessionVerified,
    codeFresh: sessionVerified && codeIsFresh(claims.value),
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
 * Starts setting up an authenticator app: removes unfinished set-ups of the account, then asks Auth for a
 * new TOTP factor. An account that already uses an app keeps it (MFA_ALREADY_SET_UP).
 */
export async function startTotpSetup(deps: MfaDeps): Promise<Result<TotpSetup, AppError>> {
  const { supabase } = deps;
  if (!supabase) return err(appError('NOT_CONFIGURED'));
  const claims = await verifyClaimsStrict(supabase);
  if (!claims.ok) return claims;
  const factors = await factorsOf(supabase);
  if (!factors.ok) return factors;
  if (factors.value.some(isVerified)) return err(appError(MfaErrors.MFA_ALREADY_SET_UP));
  for (const unfinished of factors.value) {
    const removed = await supabase.auth.mfa.unenroll({ factorId: unfinished.id });
    if (removed.error) {
      deps.logWarning('could not remove an unfinished authenticator set-up', {
        action: 'platform.auth.mfa_setup',
        ...(removed.error.status === undefined ? {} : { status: removed.error.status }),
      });
    }
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    issuer: TOTP_ISSUER,
    friendlyName: FRIENDLY_NAME,
  });
  if (error) {
    if (error.code === 'mfa_factor_name_conflict')
      return err(appError(MfaErrors.MFA_ALREADY_SET_UP));
    return authFailure(error, appError(MfaErrors.MFA_SETUP_EXPIRED));
  }
  if (!data) throw new AuthServiceError(undefined);
  return ok({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
}

export interface MfaVerification {
  /** The first code of a set-up: the app waits for its e-mailed confirmation. */
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
 * Verifies a code: the first code of a set-up (`factorId` given) or a code from the account's app (at
 * sign-in, or before a sensitive action). Auth's session becomes aal2 (it rewrites the session cookies).
 * A set-up then waits for its e-mailed confirmation; a code that let a refused session in completes its
 * sign-in (audited, and the organization's device limit applies).
 */
export async function verifyTotpCode(
  deps: MfaDeps,
  input: { readonly code: string; readonly factorId?: string | undefined },
): Promise<Result<MfaVerification, AppError>> {
  const { supabase } = deps;
  if (!supabase) return err(appError('NOT_CONFIGURED'));
  const claims = await verifyClaimsStrict(supabase);
  if (!claims.ok) return claims;
  const factors = await factorsOf(supabase);
  if (!factors.ok) return factors;
  const factor =
    input.factorId === undefined
      ? factors.value.find(isVerified)
      : factors.value.find((f) => f.id === input.factorId);
  if (!factor) {
    return err(
      appError(
        input.factorId === undefined ? MfaErrors.MFA_NOT_SET_UP : MfaErrors.MFA_SETUP_EXPIRED,
      ),
    );
  }
  const enrolled = !isVerified(factor);
  // A session the organization refused until now (selectOrganization could not write there yet).
  const before = hasTenant(claims.value)
    ? await deps.withUserTx(claims.value, (tx) => deps.getSessionAccess(tx))
    : null;
  const wasRefused = before !== null && before.state !== 'ok';
  const { data, error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: factor.id,
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
    // Also without an organization: the database records, audits and e-mails it for the account.
    await bestEffort(deps, 'platform.auth.mfa_enrolled', () =>
      deps.withUserTx(session, (tx) => deps.requestMfaFactorMail(tx, factor.id)),
    );
  }
  if (!hasTenant(session)) return ok({ enrolled });
  let access: SessionAccess | null;
  try {
    access = await deps.withUserTx(session, (tx) => deps.getSessionAccess(tx));
  } catch {
    deps.logWarning('could not record an authenticator event', { action: MFA_VERIFY_ACTION });
    access = null;
  }
  // Still refused (e.g. an app waiting for its confirmation): nothing more to record yet.
  if (access?.state !== 'ok') return ok({ enrolled });
  if (!enrolled) await recordMfaAudit(deps, session, 'platform.auth.mfa_verified');
  if (wasRefused) {
    await bestEffort(deps, 'platform.auth.signed_in', () =>
      recordAudit(deps, session, 'platform.auth.signed_in', 'password+totp'),
    );
    await bestEffort(deps, 'platform.auth.sessions_evicted', () =>
      deps.withUserTx(session, (tx) => deps.applyDeviceLimit(tx)),
    );
  }
  return ok({ enrolled });
}

/**
 * "Send the e-mail again" for an app waiting for its confirmation (review H1): a new e-mail with new links
 * (the previous links stop working). Answers the same whether or not one was queued.
 */
export async function requestMfaConfirmationMail(
  deps: MfaDeps,
): Promise<Result<{ readonly requested: true }, AppError>> {
  const { supabase } = deps;
  if (!supabase) return err(appError('NOT_CONFIGURED'));
  const claims = await verifyClaimsStrict(supabase);
  if (!claims.ok) return claims;
  const session = claims.value;
  await deps.withUserTx(session, (tx) => deps.requestMfaFactorMail(tx, null));
  return ok({ requested: true });
}

/**
 * Removes the account's authenticator app. Auth wants an aal2 session; an account whose app counts must
 * also have passed a RECENT code from it (review H1/L3): a password plus an unconfirmed app cannot remove
 * the confirmed one. Every removal is audited and e-mailed by the database.
 */
export async function removeTotp(deps: MfaDeps): Promise<Result<null, AppError>> {
  const { supabase } = deps;
  if (!supabase) return err(appError('NOT_CONFIGURED'));
  const claims = await verifyClaimsStrict(supabase);
  if (!claims.ok) return claims;
  const session = claims.value;
  if (session.aal !== 'aal2') return err(appError('STEP_UP_REQUIRED'));
  if (hasTenant(session)) {
    const access = await deps.withUserTx(session, (tx) => deps.getSessionAccess(tx));
    if (access.usesApp && !(access.aal2 && codeIsFresh(session))) {
      return err(appError('STEP_UP_REQUIRED'));
    }
  }
  const factors = await factorsOf(supabase);
  if (!factors.ok) return factors;
  const verified = factors.value.filter(isVerified);
  if (verified.length === 0) return err(appError(MfaErrors.MFA_NOT_SET_UP));
  for (const factor of verified) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (error) return authFailure(error, appError(MfaErrors.MFA_NOT_SET_UP));
    await bestEffort(deps, 'platform.auth.mfa_removed', () =>
      deps.withUserTx(session, (tx) => deps.requestMfaRemovedMail(tx, factor.id)),
    );
  }
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
// The set-up e-mail's links (review H1): no session needed — opening the link proves the mailbox
// ---------------------------------------------------------------------------------------------------

/** A link token as the worker makes it: 32 random bytes, base64url (43 characters). */
export const MFA_LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface MfaLinkDeps {
  readonly confirmMfaFactor: (tokenHash: Buffer) => Promise<'confirmed' | 'expired' | 'invalid'>;
  readonly rejectMfaFactor: (tokenHash: Buffer) => Promise<'removed' | 'expired' | 'invalid'>;
  readonly logInfo: (message: string, fields: LogFields) => void;
}

/**
 * The confirmation link ("confirm") or the "not you? remove this app" link ("remove") of a set-up e-mail,
 * with the token the page read from the URL fragment. Only its SHA-256 reaches the database (single use).
 * "remove" also ends every session of the account and e-mails it. The token is never logged.
 */
export async function openMfaLink(
  deps: MfaLinkDeps,
  kind: 'confirm' | 'remove',
  token: string,
): Promise<MfaLinkOutcome> {
  if (!MFA_LINK_TOKEN_PATTERN.test(token)) return 'invalid';
  const hash = createHash('sha256').update(token, 'utf8').digest();
  const outcome =
    kind === 'confirm' ? await deps.confirmMfaFactor(hash) : await deps.rejectMfaFactor(hash);
  deps.logInfo('authenticator e-mail link opened', {
    action: kind === 'confirm' ? 'platform.auth.mfa_confirmed' : 'platform.auth.mfa_removed',
    reason: outcome,
  });
  return outcome;
}
