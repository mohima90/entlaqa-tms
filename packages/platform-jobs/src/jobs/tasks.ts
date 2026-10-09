import { markEventProcessed, tenantIsServed } from '@jadarat/platform-db/jobs';
import type { WithSystemTx } from '@jadarat/platform-db/jobs';
import type { JobHelpers, Task, TaskList } from 'graphile-worker';
import { z } from 'zod';
import { toJobError } from './errors';
import { type PlatformTask, assertPlatformTasks, platformTaskRunner } from './platform-tasks';
import type { DeliveredEvent, InTenant, SubscriberRegistry } from './registry';

/** Task names (graphile-worker identifiers). */
export const DISPATCH_TASK = 'platform.events.dispatch';
export const DELIVER_TASK = 'platform.events.deliver';
/** Events dispatched per run; a full batch schedules the next run at once. */
export const DISPATCH_BATCH = 500;
const DEFAULT_MAX_ATTEMPTS = 10;

/**
 * At most one pending dispatch job (the key); a new one is added while another runs. No named queue:
 * graphile-worker would keep a queue locked for hours after a worker died mid-job, and dispatchers
 * running side by side are safe (`for update skip locked`; delivery order is not guaranteed anyway,
 * ADR 0004 §6).
 */
export const DISPATCH_JOB_OPTIONS = {
  jobKey: DISPATCH_TASK,
  jobKeyMode: 'preserve_run_at',
  maxAttempts: 25,
} as const;

const DeliverPayload = z.strictObject({
  eventId: z.uuid(),
  subscriber: z.string().min(1).max(100),
});

interface OutboxRow {
  id: string;
  tenant_id: string;
  type: string;
  schema_version: number;
  subject: string | null;
  data: Record<string, unknown>;
  actor_type: DeliveredEvent['actorType'];
  actor_id: string | null;
  actor_job: string | null;
  correlation_id: string | null;
  created_at: Date;
}

/**
 * ADR 0004 §4: fan pending outbox events out to one delivery job per (subscriber, event), then mark
 * them dispatched — in one transaction under app_queue, so a crash never loses or half-dispatches an
 * event. `job_key = <subscriber>:<event id>` makes a repeated dispatch a no-op.
 */
export function dispatchTask(registry: SubscriberRegistry): Task {
  return async (_payload, helpers) => {
    try {
      const full = await helpers.withPgClient(async (client) => {
        await client.query('begin');
        try {
          const { rows } = await client.query<{ id: string; type: string }>(
            `select id, type from platform.event_outbox where dispatched_at is null
             order by position limit $1 for update skip locked`,
            [DISPATCH_BATCH],
          );
          const payloads: string[] = [];
          const keys: string[] = [];
          const attempts: number[] = [];
          for (const row of rows) {
            for (const subscriber of registry.forType(row.type)) {
              payloads.push(JSON.stringify({ eventId: row.id, subscriber: subscriber.name }));
              keys.push(`${subscriber.name}:${row.id}`);
              attempts.push(subscriber.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
            }
          }
          if (payloads.length > 0) {
            // One round trip for the whole batch.
            await client.query(
              `select count(*) from graphile_worker.add_jobs(array(
                 select row($1::text, p, null, null, m, k, null, null)::graphile_worker.job_spec
                 from unnest($2::json[], $3::text[], $4::int[]) as t (p, k, m)))`,
              [DELIVER_TASK, payloads, keys, attempts],
            );
          }
          if (rows.length > 0) {
            await client.query(
              `update platform.event_outbox set dispatched_at = now() where id = any($1::uuid[])`,
              [rows.map((r) => r.id)],
            );
          }
          await client.query('commit');
          return rows.length === DISPATCH_BATCH;
        } catch (error) {
          await client.query('rollback');
          throw error;
        }
      });
      if (full) await helpers.addJob(DISPATCH_TASK, {}, DISPATCH_JOB_OPTIONS);
    } catch (error) {
      throw toJobError(error, 'dispatch');
    }
  };
}

async function deliver(
  registry: SubscriberRegistry,
  withSystemTx: WithSystemTx,
  payload: unknown,
  helpers: JobHelpers,
): Promise<void> {
  const { eventId, subscriber: name } = DeliverPayload.parse(payload);
  const subscriber = registry.get(name);
  if (!subscriber) {
    // Removed from the code since the job was queued: nothing left to run.
    helpers.logger.warn(`no subscriber "${name}" for a queued delivery; skipped`);
    return;
  }
  const { rows } = await helpers.query<OutboxRow>(
    `select id, tenant_id, type, schema_version, subject, data, actor_type, actor_id, actor_job,
            correlation_id, created_at
     from platform.event_outbox where id = $1`,
    [eventId],
  );
  const row = rows[0];
  if (!row) {
    helpers.logger.warn('event no longer in the outbox (retention); delivery skipped');
    return;
  }
  if (!subscriber.types.includes(row.type)) {
    // The subscriber dropped this type after the delivery was queued.
    helpers.logger.warn(`subscriber "${name}" no longer handles ${row.type}; delivery skipped`);
    return;
  }
  const event: DeliveredEvent = {
    id: row.id,
    tenantId: row.tenant_id,
    type: row.type,
    version: row.schema_version,
    subject: row.subject,
    data: row.data,
    actorType: row.actor_type,
    actorId: row.actor_id,
    actorJob: row.actor_job,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
  };
  const inTenant: InTenant = (fn) =>
    withSystemTx({ tenantId: event.tenantId, jobId: `${DELIVER_TASK}:${helpers.job.id}` }, fn);
  if (subscriber.kind === 'effect') {
    if (!(await inTenant(tenantIsServed))) {
      await subscriber.discard?.({ event, inTenant });
      helpers.logger.warn('organization not active; delivery skipped');
      return;
    }
    await subscriber.perform({
      event,
      inTenant,
      attempt: helpers.job.attempts,
      maxAttempts: helpers.job.max_attempts,
    });
    return;
  }
  const served = await inTenant(async (tx) => {
    // Suspended or closed organizations get no deliveries (ADR 0005 §4); they are not replayed later.
    if (!(await tenantIsServed(tx))) return false;
    if (await markEventProcessed(tx, subscriber.name, event.id)) {
      await subscriber.handle({ tx, event });
    }
    return true;
  });
  if (!served) helpers.logger.warn('organization not active; delivery skipped');
}

/**
 * ADR 0004 §5: deliver one event to one subscriber inside the event tenant's system transaction
 * (app_worker, RLS applies). The inbox row and the handler's work commit together; a repeated
 * delivery finds the inbox row and does nothing. Failures reach graphile-worker without their message.
 */
export function deliverTask(registry: SubscriberRegistry, withSystemTx: WithSystemTx): Task {
  return async (payload, helpers) => {
    try {
      await deliver(registry, withSystemTx, payload, helpers);
    } catch (error) {
      throw toJobError(error, 'delivery');
    }
  };
}

export function createTaskList(
  registry: SubscriberRegistry,
  withSystemTx: WithSystemTx,
  platformTasks: readonly PlatformTask[] = [],
): TaskList {
  assertPlatformTasks(platformTasks, [DISPATCH_TASK, DELIVER_TASK]);
  return {
    [DISPATCH_TASK]: dispatchTask(registry),
    [DELIVER_TASK]: deliverTask(registry, withSystemTx),
    ...Object.fromEntries(platformTasks.map((task) => [task.name, platformTaskRunner(task)])),
  };
}
