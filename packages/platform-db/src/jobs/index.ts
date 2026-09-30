/**
 * RESTRICTED ENTRY POINT — background jobs only (ADR 0002 §7, ADR 0005).
 * Allowed importers: code under **\/jobs/** (dependency-cruiser rule `jobs-db-only-in-jobs`).
 *
 * withSystemTx connects as login role `app_worker` and sets a system-actor claim set for exactly one
 * tenant; RLS applies (private.current_tenant_id() accepts system claims only under app_worker).
 */
import 'server-only';
import { z } from 'zod';
import { type ClaimsTx, runWithClaims } from '../claims-tx';
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
