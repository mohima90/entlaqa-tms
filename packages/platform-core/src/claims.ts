import { z } from 'zod';

/**
 * Shape of the Supabase access-token claims the platform relies on (ADR 0002 §3, ADR 0003 §2).
 * `tenant_id` / `person_id` are added by the Custom Access Token Hook only for an active membership.
 * Unknown claims are preserved for the application; only an allow-listed subset is forwarded to
 * PostgreSQL as `request.jwt.claims` (`databaseClaims` in @jadarat/platform-db, re-review N5).
 */
export const JwtClaimsSchema = z.looseObject({
  sub: z.uuid(),
  role: z.string().min(1),
  aal: z.enum(['aal1', 'aal2']).optional(),
  /** Supabase Auth session id — required by the database for user claims (ADR 0002 §6a). */
  session_id: z.uuid().optional(),
  tenant_id: z.uuid().optional(),
  person_id: z.uuid().optional(),
  exp: z.number().int().optional(),
  iat: z.number().int().optional(),
  iss: z.string().optional(),
  aud: z.union([z.string(), z.array(z.string())]).optional(),
  /** Platform-staff impersonation (ADR 0003 §6) — set only by a support grant. */
  act_as: z.uuid().optional(),
  actor: z.uuid().optional(),
});

export type JwtClaims = z.infer<typeof JwtClaimsSchema>;

declare const verifiedClaimsBrand: unique symbol;

/**
 * Claims obtained from a JWT whose signature was verified server-side (or the system actor claim
 * set of a background job). Only `@jadarat/platform-core/internal/verified-claims` can create this
 * type; dependency-cruiser restricts who may import it, and ESLint forbids casts to any `…Claims` type.
 */
export type VerifiedClaims = JwtClaims & { readonly [verifiedClaimsBrand]: true };

/** Claims that carry a tenant (the user has an active membership in an active/trial tenant). */
export type TenantClaims = VerifiedClaims & { readonly tenant_id: string };

export function hasTenant(claims: VerifiedClaims): claims is TenantClaims {
  return typeof claims.tenant_id === 'string' && claims.tenant_id.length > 0;
}
