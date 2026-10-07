import type { Task } from 'graphile-worker';
import { toJobError } from './errors';

/**
 * Work that belongs to no tenant yet (ADR 0005 §4; first: account e-mails, T-M2-17): a payload-free job
 * that drains a platform-level queue in the database through its own narrow functions. One job per task
 * is pending at most (job key = its name). It is queued whenever the workers are woken (a new event or
 * request: channel `jadarat_events`), every minute, and in each round of a one-pass run — so it runs
 * within seconds in daemon mode, like event dispatch. The task's own dependencies (its transactions,
 * Auth, settings) are bound when it is created by the worker app.
 */
export interface PlatformTask {
  /** graphile-worker task identifier, e.g. `platform.account_mail`. */
  readonly name: string;
  /**
   * One pass. Resolves `true` when work is left for another pass (queued at once). It handles failures
   * of single items itself (retry bookkeeping in its queue); a rejection fails the job, which
   * graphile-worker retries with back-off.
   */
  run(context: { readonly jobId: string }): Promise<boolean>;
}

const NAME = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

/** At most one pending job per task; a failed pass is retried a few times (the next wake-up queues it anyway). */
export function platformJobOptions(task: PlatformTask) {
  return { jobKey: task.name, jobKeyMode: 'preserve_run_at', maxAttempts: 5 } as const;
}

export function assertPlatformTasks(
  tasks: readonly PlatformTask[],
  reserved: readonly string[],
): void {
  const seen = new Set<string>(reserved);
  for (const task of tasks) {
    if (!NAME.test(task.name) || task.name.length > 100) {
      throw new Error(`platform task name "${task.name}" is invalid`);
    }
    if (seen.has(task.name)) throw new Error(`platform task "${task.name}" is registered twice`);
    seen.add(task.name);
  }
}

/** The graphile-worker task of a platform task: failures reach graphile-worker without their message. */
export function platformTaskRunner(task: PlatformTask): Task {
  return async (_payload, helpers) => {
    try {
      const more = await task.run({ jobId: `${task.name}:${helpers.job.id}` });
      if (more) await helpers.addJob(task.name, {}, platformJobOptions(task));
    } catch (error) {
      throw toJobError(error, task.name);
    }
  };
}
