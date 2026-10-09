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
import type { AuditEventInput, SessionAccess, UserTx, WithUserTx } from '@jadarat/platform-db';
import type { LogFields } from '@jadarat/platform-observability';
import { AuthServiceError, recordAudit, sessionTokens } from './auth-flow';
import { type SupabaseAuthLike, verifyClaims, verifyClaimsStrict } from './verify-claims';

/**
 * Multi-factor authentication with an authenticator app (TOTP) — FR-IAM-12, T-M2-10, approved screens 3,
 * 6 and 8 (step 2). Supabase Auth keeps the factors and decides the assurance level (aal1 → aal2); these
 * flows only call it with the signed-in user's OWN session (no Auth secret key, ADR 0002 §7):
 *   - set up: stale unfinished set-ups are removed, a new TOTP factor is created (QR code + the key to type
 *     in), then the first code verifies it — the session becomes aal2;
 *   - code at sign-in or before a sensitive action: the account's verified app, one code → aal2;
 *   - remove: only from an aal2 session (Auth's own rule); Auth downgrades the account's sessions to aal1.
 * The organization's MFA policy is applied by the database (private.session_access): an aal1 session it
 * refuses reads nothing until it passes here. Events are audited in the session's organization when there
 * is one; secrets and codes are never logged or audited.
 *
 * Attempt limits: Auth limits verifications per IP (all ours come from the app server) — the sign-in limiter
 * (T-M2-11, INTEGRATION POINT) adds per-account limits for codes as for passwords.
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
  /** The account has a verified authenticator app. */
  readonly usesApp: boolean;
  /** The current session passed a code (aal2). */
  readonly sessionVerified: boolean;
}

/** What the account has (strict: confirmed with Auth). */
export async function getMfaOverview(deps: MfaDeps): Promise<Result<MfaOverview, AppError>> {
  const { supabase } = deps;
  if (!supabase) return err(appError('NOT_CONFIGURED'));
  const claims = await verifyClaimsStrict(supabase);
  if (!claims.ok) return claims;
  const factors = await factorsOf(supabase);
  if (!factors.ok) return factors;
  return ok({
    usesApp: factors.value.some(isVerified),
    sessionVerified: claims.value.aal === 'aal2',
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
  readonly enrolled: boolean;
}

/**
 * Verifies a code: the first code of a set-up (`factorId` given) or a code from the account's app (at
 * sign-in, or before a sensitive action). The session becomes aal2 (Auth rewrites the session cookies).
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
  // A session the organization refused until now: this code completes its sign-in (audited below, as
  // selectOrganization could not write in the organization yet).
  const before = hasTenant(claims.value)
    ? await deps.withUserTx(claims.value, (tx) => deps.getSessionAccess(tx))
    : null;
  const completesSignIn = before?.state === 'mfa_challenge' || before?.state === 'mfa_enrol';
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
        action: 'platform.auth.mfa_verify',
        status: error.status ?? 0,
      });
      return err(appError(MfaErrors.MFA_CODE_INVALID));
    }
    if (error.code === 'mfa_factor_not_found') return err(appError(MfaErrors.MFA_SETUP_EXPIRED));
    return authFailure(error, appError(MfaErrors.MFA_CODE_INVALID));
  }
  // Auth answered with the upgraded session (cookies rewritten): audit with ITS claims (aal2).
  const tokens = sessionTokens({ session: data });
  const upgraded = await verifyClaims(supabase, tokens?.accessToken);
  if (upgraded.ok) {
    await recordMfaAudit(
      deps,
      upgraded.value,
      enrolled ? 'platform.auth.mfa_enrolled' : 'platform.auth.mfa_verified',
    );
    if (completesSignIn) {
      try {
        await recordAudit(deps, upgraded.value, 'platform.auth.signed_in', 'password+totp');
      } catch {
        deps.logWarning('could not record the sign-in audit event', {
          action: 'platform.auth.signed_in',
        });
      }
    }
  }
  return ok({ enrolled });
}

/** Removes the account's authenticator app (aal2 session only: Auth's rule). */
export async function removeTotp(deps: MfaDeps): Promise<Result<null, AppError>> {
  const { supabase } = deps;
  if (!supabase) return err(appError('NOT_CONFIGURED'));
  const claims = await verifyClaimsStrict(supabase);
  if (!claims.ok) return claims;
  if (claims.value.aal !== 'aal2') return err(appError('STEP_UP_REQUIRED'));
  const factors = await factorsOf(supabase);
  if (!factors.ok) return factors;
  const verified = factors.value.filter(isVerified);
  if (verified.length === 0) return err(appError(MfaErrors.MFA_NOT_SET_UP));
  for (const factor of verified) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (error) return authFailure(error, appError(MfaErrors.MFA_NOT_SET_UP));
  }
  // The audit row is written with the claims verified above (the organization's view of the session).
  await recordMfaAudit(deps, claims.value, 'platform.auth.mfa_removed');
  return ok(null);
}

async function recordMfaAudit(
  deps: MfaDeps,
  claims: VerifiedClaims,
  action: 'platform.auth.mfa_enrolled' | 'platform.auth.mfa_verified' | 'platform.auth.mfa_removed',
): Promise<void> {
  if (!hasTenant(claims)) return;
  const actor = actorFromClaims(claims);
  try {
    await deps.withUserTx(claims, (tx) =>
      deps.insertAuditEvent(tx, actor, {
        action,
        entityType: 'user',
        entityId: claims.sub,
        data: { method: 'totp' },
      }),
    );
  } catch {
    // Never undo what Auth did because the audit write failed; logged without details.
    deps.logWarning('could not record the MFA audit event', { action });
  }
}
