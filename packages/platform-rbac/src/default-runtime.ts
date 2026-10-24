import 'server-only';
import { type UserTx } from '@jadarat/platform-db';
import { log, reportError } from '@jadarat/platform-observability';
import type { ActionRuntime } from './define-action';
import { personResourceAttributes } from './person-scope';
import { grantsWithinPlan } from './plan-features';
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
    const { isPassiveRead, withUserTx } = await import('@jadarat/platform-db');
    const { passiveRead, ...rest } = options ?? {};
    if (passiveRead === undefined) return withUserTx(claims, fn, rest);
    // Only platform-db's named passive reads (integration review L1); anything else is a defect.
    if (!isPassiveRead(passiveRead)) {
      throw new Error('defineAction: not an allow-listed passive read (platform-db PASSIVE_READS)');
    }
    return withUserTx(claims, fn, { ...rest, passiveRead });
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
        // The unit of a department-limited custom role (EP-ORG), only while it is live and active.
        scopeUnitId: role.scopeUnitId,
      })),
      // Custom roles as stored now (EP-ROLES): a change applies at the holder's next request.
      { headedDepartmentIds: facts.headedDepartmentIds, customRoles: facts.customRoles },
    );
    // A feature the organization's plan does not include is held by nobody (WP-ADM-06; the database does
    // the same in private.member_permissions). Every member manages their own profile (FR-IAM-16).
    return [...grantsWithinPlan(roleGrants, facts.features), ...MEMBER_GRANTS];
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
  logTransactionRetry({ permission, sqlState }) {
    // A deadlock or serialization failure the retry absorbed (integration review): permission and SQLSTATE.
    log.warn('transaction retried after a conflict', {
      permission,
      reason: 'transaction_conflict',
      errorCode: sqlState,
    });
  },
  // Every emitted domain event needs a worker pass to be delivered (platform-db emitEvent marks the tx), as
  // does work noted with noteWorkQueued; limits: platform-db events.ts (review L2).
  async queuedWork(tx) {
    const { queuedWorkIn } = await import('@jadarat/platform-db');
    return queuedWorkIn(tx);
  },
  // ADR 0005 §1 amendment (PO, 20 Oct 2026): start the GitHub Jobs workflow after the response — a no-op
  // without the dispatch App settings (self-hosted runs a continuous worker), throttled per server instance.
  async requestWorkerPass({ permission }) {
    const { kickWorkerAfterResponse } = await import('@jadarat/platform-jobs/kick/next');
    kickWorkerAfterResponse(`action:${permission}`);
  },
  // WP-ADM-05 follow-up (PO 23 Oct 2026): account e-mails the action queued (policy-change and unlock notices, an
  // admin's authenticator reset) are e-mailed at once after the response; the worker is the safety net.
  async tagInlineAccountMail(tx) {
    try {
      const { inlineAccountMailer } =
        await import('@jadarat/platform-identity/inline-account-mail');
      return await inlineAccountMailer.tagTicket(tx);
    } catch {
      return null;
    }
  },
  sendInlineAccountMail(ticket) {
    void import('@jadarat/platform-identity/inline-account-mail')
      .then(({ inlineAccountMailer }) => {
        inlineAccountMailer.schedule(ticket as never);
      })
      .catch(() => undefined);
  },
  logAfterCommitRefusal({ permission, code }) {
    // An expected refusal after the commit (e.g. Storage unavailable while signing a file URL): a warning
    // with the permission and the code — not an error-tracker event (integration review L-b).
    log.warn('action refused after its commit', {
      permission,
      reason: 'after_commit_refused',
      errorCode: code,
    });
  },
};
