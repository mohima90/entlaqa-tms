import 'server-only';
import { type UserTx } from '@jadarat/platform-db';
import { reportError } from '@jadarat/platform-observability';
import type { ActionRuntime } from './define-action';
import { personResourceAttributes } from './person-scope';
import { MEMBER_GRANTS } from './member-permissions';
import { grantsForAssignments } from './role-grants';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  async withUserTx(claims, fn, options) {
    const { withUserTx } = await import('@jadarat/platform-db');
    return withUserTx(claims, fn, options);
  },
  // T-M2-10 (review L1/H1): may the session act in its organization, and is it at AAL2 (confirmed app)?
  async loadSessionFacts(tx) {
    const { loadSessionFacts } = await import('@jadarat/platform-db');
    return loadSessionFacts(tx);
  },
  // ADR 0003 §3: the member's roles in the current tenant (T-M2-03), read on every action so role
  // changes take effect on the next request. Delegations (FR-IAM-14) join in R2.
  async loadGrants(tx) {
    const { loadMemberAuthorizationFacts } = await import('@jadarat/platform-db');
    const facts = await loadMemberAuthorizationFacts(tx);
    const roleGrants = grantsForAssignments(
      facts.roles.map((role) => ({
        roleCode: role.roleCode,
        ...(role.validFrom ? { validFrom: role.validFrom } : {}),
        ...(role.validUntil ? { validUntil: role.validUntil } : {}),
      })),
      { headedDepartmentIds: facts.headedDepartmentIds },
    );
    // Every member manages their own profile (FR-IAM-16), whatever their roles.
    return [...roleGrants, ...MEMBER_GRANTS];
  },
  // Resource attributes for scope checks (ADR 0003 §4). Platform types are resolved here; module
  // resolvers register by type as modules gain resources (TODO with the first module resource).
  // Unknown types → not found (deny by default).
  async resolveResource(tx, ref) {
    if (ref.type !== 'person' || !UUID_RE.test(ref.id)) return null;
    const { loadPersonResourceFacts } = await import('@jadarat/platform-db');
    const facts = await loadPersonResourceFacts(tx, ref.id);
    return facts ? personResourceAttributes(facts) : null;
  },
  async writeAudit(tx, actor, record) {
    const { insertAuditEvent } = await import('@jadarat/platform-db');
    await insertAuditEvent(tx, actor, record);
  },
  logError(error, meta) {
    // Logged (error class, permission, correlation id — no personal data) and sent to the error tracker.
    reportError(error, { permission: meta.permission, correlationId: meta.correlationId });
  },
};
