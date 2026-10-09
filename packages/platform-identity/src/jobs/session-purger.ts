import { type WithPlatformTx, purgeEndedSessions } from '@jadarat/platform-db/jobs';
import type { PlatformTask, WorkerLogLevel } from '@jadarat/platform-jobs/jobs';

/** graphile-worker task that makes Auth forget ended sessions (a platform task: sessions span tenants). */
export const SESSION_PURGE_TASK = 'platform.session_purge';
/** Sessions deleted per pass; a full pass queues the next one at once. */
export const SESSION_PURGE_BATCH = 500;
/** Platform tasks run on every wake-up; this one at most once a minute per worker process. */
export const SESSION_PURGE_INTERVAL_MS = 60_000;

export interface SessionPurgerOptions {
  readonly withPlatformTx: WithPlatformTx;
  readonly log: (level: WorkerLogLevel, message: string) => void;
  /** Injectable clock for tests. */
  readonly now?: () => number;
}

/**
 * Ended sessions leave Auth (FR-IAM-13, T-M2-10, security review M1). Sessions ended on purpose (sign-out of
 * a member, "end my sessions", the device limit, a reset authenticator) are deleted from Auth at once by the
 * database; sessions that ended by TIME — the organization's inactivity limit or maximum length, or the
 * platform's 24 hours — have nobody to end them, so this task does: the database marks them ended (the
 * marker keeps refusing their tokens) and deletes them from Auth (private.purge_ended_sessions). Logs carry
 * counts only.
 */
export function createSessionPurger(options: SessionPurgerOptions): PlatformTask {
  const { withPlatformTx, log } = options;
  const now = options.now ?? Date.now;
  let lastCaughtUp = Number.NEGATIVE_INFINITY;
  return {
    name: SESSION_PURGE_TASK,
    async run({ jobId }) {
      if (now() - lastCaughtUp < SESSION_PURGE_INTERVAL_MS) return false;
      const purged = await withPlatformTx({ jobId }, (tx) =>
        purgeEndedSessions(tx, SESSION_PURGE_BATCH),
      );
      if (purged > 0) log('info', `ended sessions removed from Auth (${String(purged)})`);
      const more = purged >= SESSION_PURGE_BATCH;
      // A full batch: another pass at once; otherwise wait for the interval.
      if (!more) lastCaughtUp = now();
      return more;
    },
  };
}
