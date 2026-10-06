/**
 * RESTRICTED ENTRY POINT — background jobs only (ADR 0002 §7, ADR 0005).
 * Allowed importers: code under **\/jobs/** (dependency-cruiser rule `jobs-db-only-in-jobs`).
 *
 * withSystemTx connects as login role `app_worker` and sets a system-actor claim set for exactly one
 * tenant; RLS applies (private.current_tenant_id() accepts system claims only under app_worker).
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { type ClaimsTx, runWithClaims } from '../claims-tx';

export {
  type ClaimedEmail,
  type DeliveryOutcome,
  type QueuedEmail,
  CLAIM_LEASE_SECONDS,
  claimEmailDelivery,
  discardInactiveTenantDelivery,
  finishEmailDelivery,
  insertEmailDelivery,
} from './deliveries';
import { type AppDatabase, getDatabase } from '../client';

export type SystemTx = ClaimsTx;

export interface SystemActor {
  readonly tenantId: string;
  /** Job/task identifier, e.g. `notifications.dispatch:<job uuid>`; recorded for audit. */
  readonly jobId: string;
}

const SystemActorSchema = z.object({
  tenantId: z.uuid(),
  jobId: z.string().trim().min(1).max(200),
});

export type WithSystemTx = <T>(actor: SystemActor, fn: (tx: SystemTx) => Promise<T>) => Promise<T>;

/** System-actor claims (ADR 0002 §6a/§7): role `system`, tenant_id, job_id. No user subject. */
export function systemClaims(actor: SystemActor): {
  role: 'system';
  tenant_id: string;
  job_id: string;
} {
  const parsed = SystemActorSchema.safeParse(actor);
  if (!parsed.success) throw new Error('withSystemTx: invalid system actor');
  return { role: 'system', tenant_id: parsed.data.tenantId, job_id: parsed.data.jobId };
}

export function createWithSystemTx(getDb: () => AppDatabase): WithSystemTx {
  return async function withSystemTx<T>(actor: SystemActor, fn: (tx: SystemTx) => Promise<T>) {
    const claims = systemClaims(actor);
    return runWithClaims(getDb(), JSON.stringify(claims), fn);
  };
}

/** Runs `fn` for one tenant as a system actor (connection role app_worker), with RLS enforced. */
export const withSystemTx: WithSystemTx = createWithSystemTx(() => getDatabase('app_worker'));

/**
 * Records that `subscriber` processed `eventId` (platform.event_inbox, ADR 0004 §5), in the job's own
 * transaction. False when it was already recorded: the delivery was a retry or a duplicate and the
 * handler must not run again. Only jobs can write the inbox (system claims; the inbox policy enforces it).
 */
export async function markEventProcessed(
  tx: SystemTx,
  subscriber: string,
  eventId: string,
): Promise<boolean> {
  const rows = await tx.execute<{ event_id: string }>(sql`
    insert into platform.event_inbox (subscriber, event_id) values (${subscriber}, ${eventId}::uuid)
    on conflict do nothing returning event_id`);
  return rows.length > 0;
}

/**
 * True when the transaction's tenant may be served (active or trial, ADR 0002 §6a). For a suspended or
 * closed organization the claims resolve to no tenant and RLS shows nothing: jobs skip their work
 * (ADR 0005 §4).
 */
export async function tenantIsServed(tx: SystemTx): Promise<boolean> {
  const [row] = await tx.execute<{ served: boolean }>(
    sql`select private.current_tenant_id() is not null as served`,
  );
  return row?.served === true;
}
