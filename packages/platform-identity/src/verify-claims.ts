import 'server-only';
import {
  type AppError,
  type Result,
  type VerifiedClaims,
  appError,
  err,
} from '@jadarat/platform-core';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';

/** The subset of the Supabase Auth client this module relies on. */
export interface SupabaseAuthLike {
  readonly auth: {
    getClaims(jwt?: string): Promise<{ data: { claims: unknown } | null; error: unknown }>;
    getUser(jwt?: string): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  };
}

/**
 * Verifies the session JWT and returns its claims (ADR 0003 §2).
 * `getClaims()` verifies the signature locally against the project's asymmetric signing keys (JWKS).
 * Never uses getSession(): its contents are not verified.
 * `jwt`: verify this access token instead of the one in the session cookies (used inside the sign-in
 * flow, right after Auth issued it in the same request).
 */
export async function verifyClaims(
  supabase: SupabaseAuthLike | null,
  jwt?: string,
): Promise<Result<VerifiedClaims, AppError>> {
  if (!supabase) return err(appError('NOT_CONFIGURED'));
  let response: Awaited<ReturnType<SupabaseAuthLike['auth']['getClaims']>>;
  try {
    response = await (jwt === undefined ? supabase.auth.getClaims() : supabase.auth.getClaims(jwt));
  } catch {
    return err(appError('UNAUTHENTICATED'));
  }
  if (response.error || !response.data) {
    return err(appError('UNAUTHENTICATED'));
  }
  return brandVerifiedClaims(response.data.claims);
}

/**
 * For sensitive operations (role/permission changes, exports, security settings, impersonation):
 * additionally confirms with the Auth server that the session's user still exists and is not revoked.
 * TODO(T-M1-D03): also compare the session id against Auth once refresh-token reuse detection is wired.
 */
export async function verifyClaimsStrict(
  supabase: SupabaseAuthLike | null,
  jwt?: string,
): Promise<Result<VerifiedClaims, AppError>> {
  const claims = await verifyClaims(supabase, jwt);
  if (!claims.ok || !supabase) return claims;
  try {
    const { data, error } = await (jwt === undefined
      ? supabase.auth.getUser()
      : supabase.auth.getUser(jwt));
    if (error || data.user?.id !== claims.value.sub) {
      return err(appError('UNAUTHENTICATED'));
    }
  } catch {
    return err(appError('UNAUTHENTICATED'));
  }
  return claims;
}
