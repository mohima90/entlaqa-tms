/**
 * RESTRICTED: the only place that brands claims as verified.
 * Allowed importers (dependency-cruiser rule `verified-claims-brand-restricted`): packages/platform-core,
 * packages/platform-identity, and test files (`*.test.ts` / `*.integration.test.ts`) for fixtures.
 * Jobs never brand claims: they use withSystemTx() with a system actor instead.
 * Callers must have verified the JWT signature (getClaims with asymmetric keys / getUser) first.
 */
import { JwtClaimsSchema, type VerifiedClaims } from '../claims';
import { type Result, err, ok } from '../result';
import { type AppError, appError } from '../errors';

export function brandVerifiedClaims(verifiedPayload: unknown): Result<VerifiedClaims, AppError> {
  const parsed = JwtClaimsSchema.safeParse(verifiedPayload);
  if (!parsed.success) {
    return err(appError('UNAUTHENTICATED'));
  }
  // eslint-disable-next-line no-restricted-syntax -- this module is the single, restricted brand point
  return ok(parsed.data as VerifiedClaims);
}
