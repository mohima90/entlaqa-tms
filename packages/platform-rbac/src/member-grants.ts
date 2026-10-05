import {
  type AppError,
  type Result,
  appError,
  err,
  hasTenant,
  internalError,
  newCorrelationId,
  ok,
} from '@jadarat/platform-core';
import type { Grant } from './authorize';
import type { ActionRuntime } from './define-action';

/**
 * The signed-in member's grants in force now, for deciding what the suite shell shows (navigation
 * entries). Display only: every page and action still authorizes itself (defineQuery / defineAction).
 * No session → UNAUTHENTICATED; no organization selected → FORBIDDEN; database failure → INTERNAL_ERROR
 * (logged).
 */
export function createLoadMemberGrants<Tx>(runtime: ActionRuntime<Tx>) {
  return async function loadMemberGrants(
    now: Date = new Date(),
  ): Promise<Result<readonly Grant[], AppError>> {
    const claims = await runtime.getClaims({ strict: false });
    if (!claims.ok) return err(claims.error);
    if (!hasTenant(claims.value)) return err(appError('FORBIDDEN'));
    const tenantClaims = claims.value;
    let grants: readonly Grant[];
    try {
      grants = await runtime.withUserTx(tenantClaims, (tx) => runtime.loadGrants(tx, tenantClaims));
    } catch (error) {
      // Same handling as defineAction: logged with a correlation id, never thrown into the page.
      const correlationId = newCorrelationId();
      runtime.logError(error, { permission: 'navigation', correlationId });
      return err(internalError(correlationId));
    }
    return ok(
      grants.filter(
        (g) => (!g.validFrom || g.validFrom <= now) && (!g.validUntil || now < g.validUntil),
      ),
    );
  };
}
