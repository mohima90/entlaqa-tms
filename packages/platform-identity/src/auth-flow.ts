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
import type { AuditEventInput, SessionTenant, UserTx, WithUserTx } from '@jadarat/platform-db';
import type { LogFields } from '@jadarat/platform-observability';
import { type SupabaseAuthLike, verifyClaims, verifyClaimsStrict } from './verify-claims';

/**
 * Sign-in flow (ADR 0003 §2, ADR 0002 §3; T-M1-D03). Framework-free: the Next.js adapter (auth-next.ts)
 * supplies a Supabase client bound to the request cookies and the platform-db functions.
 *
 *   signInWithPassword → Supabase Auth (session cookie set) → the session's organizations
 *     · none  → sign out again, AUTH_NO_ORGANIZATION
 *     · one   → selectOrganization() automatically
 *     · many  → the caller shows the organization chooser
 *   selectOrganization → switch_active_tenant (this session only) → refresh the session so the
 *     Custom Access Token Hook issues a token WITH the tenant claim → audit `platform.auth.signed_in`
 *   signOut → audit `platform.auth.signed_out` (when a tenant is active) → revoke this session
 *
 * Multi-factor authentication is off by default for now (PO decision, 1 Oct 2026; tenant policy
 * off / optional / required arrives with the security settings, ADR 0003 §1).
 */

export const IdentityErrors = defineErrorCodes({
  /** Wrong e-mail or password — deliberately the same for unknown accounts (no account enumeration). */
  AUTH_INVALID_CREDENTIALS: { status: 401, messageKey: 'auth.errors.invalidCredentials' },
  /** Signed in, but the account has no active membership in an active organization. */
  AUTH_NO_ORGANIZATION: { status: 403, messageKey: 'auth.errors.noOrganization' },
});

/** The subset of the Supabase Auth client the flow uses (server-side, cookie-bound). */
export interface AuthClientLike extends SupabaseAuthLike {
  readonly auth: SupabaseAuthLike['auth'] & {
    signInWithPassword(credentials: {
      email: string;
      password: string;
    }): Promise<{ data: unknown; error: { status?: number | undefined } | null }>;
    refreshSession(current?: { refresh_token: string }): Promise<{ data: unknown; error: unknown }>;
    signOut(options: { scope: 'local' }): Promise<{ error: unknown }>;
  };
}

export interface AuthFlowDeps {
  readonly supabase: AuthClientLike | null;
  readonly withUserTx: WithUserTx;
  readonly listSessionTenants: (tx: UserTx) => Promise<readonly SessionTenant[]>;
  readonly switchActiveTenant: (tx: UserTx, tenantId: string) => Promise<boolean>;
  readonly insertAuditEvent: (
    tx: UserTx,
    actor: ReturnType<typeof actorFromClaims>,
    event: AuditEventInput,
  ) => Promise<void>;
  /** Structured warning without personal data (platform-observability logger). */
  readonly logWarning: (message: string, fields: LogFields) => void;
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

export type SignInOutcome = { readonly next: 'home' } | { readonly next: 'choose-organization' };

/** Tokens Auth just issued in THIS request (the session cookies are written, but not re-read). */
interface SessionTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
}

function sessionTokens(data: unknown): SessionTokens | null {
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

export async function signInWithPassword(
  deps: AuthFlowDeps,
  credentials: { readonly email: string; readonly password: string },
): Promise<Result<SignInOutcome, AppError>> {
  const { supabase } = deps;
  if (!supabase) return err(appError('NOT_CONFIGURED'));

  const { data, error } = await supabase.auth.signInWithPassword({
    email: credentials.email,
    password: credentials.password,
  });
  if (error) {
    if (error.status === 429) return err(appError('RATE_LIMITED'));
    // 4xx: refused credentials (wrong e-mail or password, unconfirmed or banned account) — one answer
    // for all of them (no account enumeration). Logged without personal data (security event).
    if (error.status !== undefined && error.status >= 400 && error.status < 500) {
      deps.logWarning('sign-in refused', {
        action: 'platform.auth.sign_in',
        status: error.status,
      });
      return err(appError(IdentityErrors.AUTH_INVALID_CREDENTIALS));
    }
    throw new AuthServiceError(error.status);
  }
  const tokens = sessionTokens(data);
  if (!tokens) return err(appError('UNAUTHENTICATED'));

  const claims = await verifyClaims(supabase, tokens.accessToken);
  if (!claims.ok) return claims;

  const tenants = await deps.withUserTx(claims.value, (tx) => deps.listSessionTenants(tx));
  const [only, ...others] = tenants;
  if (!only) {
    await supabase.auth.signOut({ scope: 'local' });
    return err(appError(IdentityErrors.AUTH_NO_ORGANIZATION));
  }
  if (others.length > 0) return ok({ next: 'choose-organization' });

  const selected = await selectOrganization(deps, only.tenantId, tokens);
  return selected.ok ? ok({ next: 'home' }) : selected;
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
): Promise<Result<{ readonly tenantId: string }, AppError>> {
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

  await recordAudit(deps, tenantClaims.value, 'platform.auth.signed_in');
  return ok({ tenantId });
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

async function recordAudit(
  deps: AuthFlowDeps,
  claims: VerifiedClaims,
  action: 'platform.auth.signed_in' | 'platform.auth.signed_out',
): Promise<void> {
  if (!hasTenant(claims)) return;
  const actor = actorFromClaims(claims);
  await deps.withUserTx(claims, (tx) =>
    deps.insertAuditEvent(tx, actor, {
      action,
      entityType: 'auth_session',
      entityId: claims.session_id,
      data: { method: 'password', aal: actor.aal },
    }),
  );
}
