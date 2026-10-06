import { markEventProcessed } from '@jadarat/platform-db';
import type { WithSystemTx } from '@jadarat/platform-db/jobs';
import type { JobHelpers, Task, TaskList } from 'graphile-worker';
import { z } from 'zod';
import type { DeliveredEvent, SubscriberRegistry } from './registry';

/** Task names (graphile-worker identifiers). */
export const DISPATCH_TASK = 'platform.events.dispatch';
export const DELIVER_TASK = 'platform.events.deliver';
/** Events dispatched per run; a full batch schedules the next run at once. */
export const DISPATCH_BATCH = 500;
const DEFAULT_MAX_ATTEMPTS = 10;

/** Dispatch jobs are debounced (one pending at a time) and run serially in their own queue. */
export const DISPATCH_JOB_OPTIONS = {
  jobKey: DISPATCH_TASK,
  jobKeyMode: 'preserve_run_at',
  queueName: DISPATCH_TASK,
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
    const full = await helpers.withPgClient(async (client) => {
      await client.query('begin');
      try {
        const { rows } = await client.query<{ id: string; type: string }>(
          `select id, type from platform.event_outbox where dispatched_at is null
           order by position limit $1 for update skip locked`,
          [DISPATCH_BATCH],
        );
        for (const row of rows) {
          for (const subscriber of registry.forType(row.type)) {
            await client.query(
              `select graphile_worker.add_job($1, $2::json, job_key := $3, max_attempts := $4)`,
              [
                DELIVER_TASK,
                JSON.stringify({ eventId: row.id, subscriber: subscriber.name }),
                `${subscriber.name}:${row.id}`,
                subscriber.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
              ],
            );
          }
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
  };
}

/**
 * ADR 0004 §5: deliver one event to one subscriber inside the event tenant's system transaction
 * (app_worker, RLS applies). The inbox row and the handler's work commit together; a repeated
 * delivery finds the inbox row and does nothing.
 */
export function deliverTask(registry: SubscriberRegistry, withSystemTx: WithSystemTx): Task {
  return async (payload, helpers: JobHelpers) => {
    const { eventId, subscriber: name } = DeliverPayload.parse(payload);
    const subscriber = registry.get(name);
    if (!subscriber) {
      // Removed from the code since the job was queued: nothing left to run.
      helpers.logger.warn(`no subscriber "${name}" for a queued delivery; skipped`);
      return;
    }
    const { rows } = await helpers.query<OutboxRow>(
      `select id, tenant_id, type, schema_version, subject, data, actor_type, correlation_id, created_at
       from platform.event_outbox where id = $1`,
      [eventId],
    );
    const row = rows[0];
    if (!row) {
      helpers.logger.warn('event no longer in the outbox (retention); delivery skipped');
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
      correlationId: row.correlation_id,
      createdAt: row.created_at,
    };
    await withSystemTx(
      { tenantId: event.tenantId, jobId: `${DELIVER_TASK}:${helpers.job.id}` },
      async (tx) => {
        if (!(await markEventProcessed(tx, subscriber.name, event.id))) return;
        await subscriber.handle({ tx, event });
      },
    );
  };
}

export function createTaskList(registry: SubscriberRegistry, withSystemTx: WithSystemTx): TaskList {
  return {
    [DISPATCH_TASK]: dispatchTask(registry),
    [DELIVER_TASK]: deliverTask(registry, withSystemTx),
  };
}
