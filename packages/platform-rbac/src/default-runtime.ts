import 'server-only';
import { type UserTx } from '@jadarat/platform-db';
import type { ActionRuntime } from './define-action';

/**
 * Production runtime for defineAction: verified claims from the request cookies (platform-identity)
 * and a withUserTx transaction (platform-db). Modules are imported lazily so that importing an
 * action module has no side effects.
 */
export const defaultActionRuntime: ActionRuntime<UserTx> = {
  async getClaims({ strict }) {
    const { getVerifiedClaims, getVerifiedClaimsStrict } =
      await import('@jadarat/platform-identity/next');
    // ADR 0003 §2: getClaims() (local JWKS verification) for normal requests; getUser() round-trip
    // before sensitive operations (high-risk / AAL2 permissions).
    return strict ? getVerifiedClaimsStrict() : getVerifiedClaims();
  },
  async withUserTx(claims, fn) {
    const { withUserTx } = await import('@jadarat/platform-db');
    return withUserTx(claims, fn);
  },
  // TODO(M2, ADR 0003 §3): load role assignments + delegations for the membership (cached per
  // request, invalidated by the membership version counter). Until then no grants → deny by default.
  loadGrants() {
    return Promise.resolve([]);
  },
  // TODO(M2): modules register resource resolvers by type. Until then → not found (deny by default).
  resolveResource() {
    return Promise.resolve(null);
  },
  // TODO(T-M1-D03): move to platform-audit when that package lands.
  async writeAudit(tx, actor, record) {
    const { schema } = await import('@jadarat/platform-db');
    await tx.insert(schema.auditEvents).values({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      actorPersonId: actor.personId,
      impersonatorUserId: actor.impersonatorUserId,
      action: record.action,
      entityType: record.entityType ?? null,
      entityId: record.entityId ?? null,
      data: record.data ?? {},
    });
  },
  logError(error, meta) {
    // No personal data: log only the error class, the permission code and the correlation id.
    console.error('[defineAction] unexpected error', {
      permission: meta.permission,
      correlationId: meta.correlationId,
      error: error instanceof Error ? error.name : typeof error,
    });
  },
};
