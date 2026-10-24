import { type WithPlatformTx, expireTrials } from '@jadarat/platform-db/jobs';
import type { PlatformTask, WorkerLogLevel } from '@jadarat/platform-jobs/jobs';

/** graphile-worker task that ends trials whose date has passed (a platform task: it spans organizations). */
export const TRIAL_EXPIRY_TASK = 'platform.trial_expiry';
/** Platform tasks run on every wake-up; this one at most every ten minutes per worker process. */
export const TRIAL_EXPIRY_INTERVAL_MS = 10 * 60_000;

export interface TrialExpiryOptions {
  readonly withPlatformTx: WithPlatformTx;
  readonly log: (level: WorkerLogLevel, message: string) => void;
  /** Injectable clock for tests. */
  readonly now?: () => number;
}

/**
 * A trial ends on its date (WP-ADM-06, business flow §6 "Trial ends without a decision"): the database
 * suspends every organization whose trial end date has passed and audits it (private.expire_trials), until
 * the Super Admin sets it active or gives it a new trial. Logs carry the count only.
 */
export function createTrialExpiry(options: TrialExpiryOptions): PlatformTask {
  const { withPlatformTx, log } = options;
  const now = options.now ?? Date.now;
  let lastRun = Number.NEGATIVE_INFINITY;
  return {
    name: TRIAL_EXPIRY_TASK,
    async run({ jobId }) {
      if (now() - lastRun < TRIAL_EXPIRY_INTERVAL_MS) return false;
      const ended = await withPlatformTx({ jobId }, (tx) => expireTrials(tx));
      if (ended > 0) log('info', `trials ended, organizations suspended (${String(ended)})`);
      lastRun = now();
      return false;
    },
  };
}
