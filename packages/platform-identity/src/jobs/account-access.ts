import {
  type AccountAccessCheck,
  type AccountAccessOutcome,
  type WithPlatformTx,
  claimAccountAccessCheck,
  finishAccountAccessCheck,
  retryAccountAccessCheck,
} from '@jadarat/platform-db/jobs';
import type { PlatformTask, WorkerLogLevel } from '@jadarat/platform-jobs/jobs';

/** graphile-worker task of the Auth bans (a platform task: an account may belong to several organizations). */
export const ACCOUNT_ACCESS_TASK = 'platform.account_access';
/** Checks answered per pass; a full pass queues the next one at once. */
export const ACCOUNT_ACCESS_BATCH = 20;
/** From this attempt on, a failure is logged as an error (someone should look at Auth or the key). */
export const ACCOUNT_ACCESS_ALERT_ATTEMPT = 5;

/** Auth's admin API for bans (platform-db/admin `createAccountBans`), worker only. */
export interface AccountBanApi {
  ban(
    userId: string,
  ): Promise<{ readonly status: 'done' } | { readonly status: 'unknown_account' }>;
  unban(
    userId: string,
  ): Promise<{ readonly status: 'done' } | { readonly status: 'unknown_account' }>;
}

export interface AccountAccessTaskOptions {
  readonly bans: AccountBanApi;
  readonly withPlatformTx: WithPlatformTx;
  readonly log: (level: WorkerLogLevel, message: string) => void;
}

/** A failure worth another attempt: Auth unreachable, rate limited, misconfigured key; the database. */
function isTemporary(error: unknown): boolean {
  const temporary = (error as { temporary?: unknown } | null)?.temporary;
  return typeof temporary === 'boolean' ? temporary : true;
}

/** A stable code for the logs (never a message). */
function codeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[A-Za-z0-9_]{2,64}$/.test(code)) return code;
  return error instanceof Error ? error.name : 'unknown';
}

/**
 * Auth bans of accounts that sign in nowhere (T-M2-09, FR-IAM-05; the T-M2-08 follow-up): defence in depth
 * behind the database, which refuses a deactivated member's requests at once. Each pass leases checks the
 * membership and invitation triggers queued (platform transaction: no tenant), applies what the database
 * decided — ban until lifted, or lift OUR ban — through Auth's admin API (the worker is the only holder of
 * the key, ADR 0002 §7) and records the outcome. A temporary failure puts the check back (back-off up to an
 * hour, never given up); a refusal is logged and the check closed. Logs carry actions and codes only, never
 * account ids or addresses.
 */
export function createAccountAccessTask(options: AccountAccessTaskOptions): PlatformTask {
  const { bans, withPlatformTx, log } = options;

  const finish = (jobId: string, check: AccountAccessCheck, outcome: AccountAccessOutcome) =>
    withPlatformTx({ jobId }, (tx) => finishAccountAccessCheck(tx, check, outcome));

  async function answer(jobId: string, check: AccountAccessCheck): Promise<void> {
    if (check.action === 'none') {
      await finish(jobId, check, 'unchanged');
      return;
    }
    let outcome: AccountAccessOutcome;
    try {
      const result =
        check.action === 'ban' ? await bans.ban(check.userId) : await bans.unban(check.userId);
      outcome =
        result.status === 'unknown_account'
          ? 'gone'
          : check.action === 'ban'
            ? 'banned'
            : 'unbanned';
    } catch (error) {
      const code = codeOf(error);
      if (!isTemporary(error)) {
        await finish(jobId, check, 'refused');
        log('error', `account ${check.action} refused by Auth (${code})`);
        return;
      }
      const attempts = await withPlatformTx({ jobId }, (tx) =>
        retryAccountAccessCheck(tx, check.userId),
      );
      log(
        attempts >= ACCOUNT_ACCESS_ALERT_ATTEMPT ? 'error' : 'warning',
        `account ${check.action} failed (${code}); retried later (attempt ${String(attempts)})`,
      );
      return;
    }
    const removed = await finish(jobId, check, outcome);
    log(
      'info',
      `account access: ${outcome}${removed ? '' : ' (changed meanwhile: decided again)'}`,
    );
  }

  return {
    name: ACCOUNT_ACCESS_TASK,
    async run({ jobId }) {
      for (let i = 0; i < ACCOUNT_ACCESS_BATCH; i += 1) {
        const check = await withPlatformTx({ jobId }, claimAccountAccessCheck);
        if (!check) return false;
        await answer(jobId, check);
      }
      return true;
    },
  };
}
