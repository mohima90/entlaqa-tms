import 'server-only';
import type { ActorContext } from '@jadarat/platform-core';
import type { ClaimsTx } from './claims-tx';
import { auditEvents } from './schema/platform';

/** One audit record (FR-AUD-01). Never secrets; personal data as ids only. */
export interface AuditEventInput {
  /** Namespaced action, e.g. `platform.auth.signed_in` (checked by the table's CHECK constraint). */
  readonly action: string;
  readonly entityType?: string | undefined;
  readonly entityId?: string | undefined;
  readonly data?: Record<string, unknown> | undefined;
}

/**
 * Appends an audit event inside the caller's withUserTx transaction, so it commits or rolls back with
 * the change it describes. The database re-checks the actor against the verified claims (policy
 * audit_events_insert) and keeps the table append-only.
 * TODO(M2): move to platform-audit when that package lands (data model §2.5).
 */
export async function insertAuditEvent(
  tx: ClaimsTx,
  actor: ActorContext,
  event: AuditEventInput,
): Promise<void> {
  await tx.insert(auditEvents).values({
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    actorPersonId: actor.personId,
    impersonatorUserId: actor.impersonatorUserId,
    action: event.action,
    entityType: event.entityType ?? null,
    entityId: event.entityId ?? null,
    data: event.data ?? {},
  });
}
