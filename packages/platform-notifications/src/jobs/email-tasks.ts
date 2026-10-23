import { emitEvent } from '@jadarat/platform-db';
import {
  type EmailTestClaim,
  type WithPlatformTx,
  type WithSystemTx,
  claimEmailTests,
  finishEmailTest,
  isEmailSettingsMissing,
  listTenantsToRescueInline,
  listTenantsWaitingForSender,
  publishEmailCredentialsKey,
  sweepEmailDeliveries,
  takeInlineRescue,
  takeWaitingDeliveries,
} from '@jadarat/platform-db/jobs';
import type { PlatformTask, WorkerLogLevel } from '@jadarat/platform-jobs/jobs';
import type { CredentialsKeyPair } from '../sending/credentials';
import { createProviderTransport } from '../sending/factory';
import type { EmailRouter } from './router';
import { EMAIL_QUEUED_EVENT } from './sender';
import type { HostLookup } from '../sending/smtp';
import { emailTestErrorCode, sendEmailTest } from '../sending/test-send';

type Log = (level: WorkerLogLevel, message: string) => void;

export const EMAIL_TESTS_TASK = 'platform.email_tests';
export const EMAIL_RESUME_TASK = 'platform.email_resume';
export const EMAIL_HOUSEKEEPING_TASK = 'platform.email_housekeeping';
export const EMAIL_INLINE_RESCUE_TASK = 'platform.email_inline_rescue';
/** Test e-mails per pass. */
const TESTS_PER_PASS = 5;
/**
 * A pass stops claiming tests after this long (each send has its own 60-second deadline): slow providers
 * cannot hold the worker; the rest wait for the next pass.
 */
const TESTS_PASS_BUDGET_MS = 90_000;
/** Waiting messages queued again per organization and pass. */
const RESUME_PER_TENANT = 200;
/** Messages the web app queued and nobody finished, taken over per organization and pass. */
const RESCUE_PER_TENANT = 200;
/** Rows of each kind per housekeeping pass. */
const SWEEP_BATCH = 500;

/**
 * Test e-mails of the sender settings (WP-ADM-01; Kawadir's «Save & send test», «Send test e-mail»): at
 * every pass the worker publishes its public key (the web app seals provider secrets with it), then claims
 * the waiting tests — the platform sender's and organizations' — and sends each straight through the
 * settings being tested (never another sender), to the address the admin chose. A test that went out marks
 * those settings verified; a failure is recorded with our code for the page. Each test is claimed and
 * finished in its own short transaction; nothing is held open while the provider answers.
 */
export function createEmailTestTask(options: {
  readonly keys: CredentialsKeyPair | null;
  readonly withPlatformTx: WithPlatformTx;
  readonly log: Log;
  readonly smtpCaPem?: string | undefined;
  /** EMAIL_PLATFORM_SMTP_ALLOW_PRIVATE=true: the platform sender's SMTP relay may be internal. */
  readonly allowPrivatePlatformSmtp?: boolean;
  readonly lookup?: HostLookup;
  readonly transportFor?: typeof createProviderTransport;
  readonly now?: () => number;
}): PlatformTask {
  const { keys, withPlatformTx, log } = options;
  const transportFor = options.transportFor ?? createProviderTransport;
  const now = options.now ?? Date.now;
  let published = false;

  const sendTest = (test: EmailTestClaim) =>
    sendEmailTest(test, {
      keys,
      allowPrivatePlatformSmtp: options.allowPrivatePlatformSmtp === true,
      smtpCaPem: options.smtpCaPem,
      lookup: options.lookup,
      transportFor,
    });

  async function runTest(jobId: string, test: EmailTestClaim): Promise<void> {
    let outcome: { readonly sent: true } | { readonly sent: false; readonly errorCode: string };
    try {
      await sendTest(test);
      outcome = { sent: true };
    } catch (error) {
      outcome = { sent: false, errorCode: emailTestErrorCode(error) };
    }
    const verified = await withPlatformTx({ jobId }, (tx) => finishEmailTest(tx, test, outcome));
    const whose = test.tenantId === null ? 'platform sender' : "organization's provider";
    log(
      outcome.sent ? 'info' : 'warning',
      outcome.sent
        ? `test e-mail of the ${whose} sent${verified ? ' (verified)' : ''}`
        : `test e-mail of the ${whose} not sent (${outcome.errorCode})`,
    );
  }

  return {
    name: EMAIL_TESTS_TASK,
    async run({ jobId }) {
      try {
        if (keys && !published) {
          const key = keys.publicKey;
          if (await withPlatformTx({ jobId }, (tx) => publishEmailCredentialsKey(tx, key))) {
            log(
              'warning',
              'a new e-mail credentials key was published: saved provider secrets must be entered again',
            );
          }
          published = true;
        }
        // One test claimed at a time, within the pass's time budget: a test is never left claimed while the
        // worker is busy with another (the database fails a test after 3 claims — TIMEOUT).
        const started = now();
        let handled = 0;
        while (handled < TESTS_PER_PASS && now() - started < TESTS_PASS_BUDGET_MS) {
          const tests = await withPlatformTx({ jobId }, (tx) => claimEmailTests(tx, 1));
          if (tests.length === 0) return false;
          for (const test of tests) {
            handled += 1;
            await runTest(jobId, test);
          }
        }
        return true; // more may be waiting: the next pass continues
      } catch (error) {
        if (isEmailSettingsMissing(error)) return false; // the database is not migrated yet
        throw error;
      }
    },
  };
}

/**
 * Messages waiting for a sender (WP-ADM-01): for each served organization with waiting messages, the sender
 * rule is asked again; once a sender is ready (the platform sender verified, the organization's provider
 * enabled, a usable key), up to 200 of its messages are queued again (oldest first) — each in its
 * organization's transaction, with a new event for the e-mail sender. Nothing ready: they keep waiting.
 */
export function createEmailResumeTask(options: {
  readonly router: EmailRouter;
  readonly withPlatformTx: WithPlatformTx;
  readonly withSystemTx: WithSystemTx;
  readonly log: Log;
}): PlatformTask {
  const { router, withPlatformTx, withSystemTx, log } = options;
  return {
    name: EMAIL_RESUME_TASK,
    async run({ jobId }) {
      let tenants: readonly { readonly tenantId: string; readonly waiting: number }[];
      try {
        tenants = await withPlatformTx({ jobId }, (tx) => listTenantsWaitingForSender(tx));
      } catch (error) {
        if (isEmailSettingsMissing(error)) return false;
        throw error;
      }
      let more = false;
      for (const { tenantId } of tenants) {
        const resumed = await withSystemTx({ tenantId, jobId }, async (tx) => {
          const route = await router.resolve(tx, tenantId);
          if (route.kind !== 'send') return 0;
          const ids = await takeWaitingDeliveries(tx, RESUME_PER_TENANT);
          for (const id of ids) {
            await emitEvent(tx, { type: EMAIL_QUEUED_EVENT, subject: id, data: { resumed: true } });
          }
          return ids.length;
        });
        if (resumed > 0) log('info', `${String(resumed)} waiting e-mails queued again`);
        if (resumed === RESUME_PER_TENANT) more = true;
      }
      return more;
    },
  };
}

/**
 * The safety net of immediate sending (WP-ADM-05 follow-up, PO 23 Oct 2026): the web app queues an e-mail in
 * its action's transaction and sends it the moment the action commits. A message nobody finished within a
 * minute - the function died, the provider was slow, the outcome was not recorded - is queued here for the
 * worker's own sender (the same event the mailers emit), which claims it under the same lease the web app
 * uses, so it is sent once. A message waiting for a sender is left to the resume task above. Each message is
 * taken over once an hour at most.
 */
export function createEmailInlineRescueTask(options: {
  readonly withPlatformTx: WithPlatformTx;
  readonly withSystemTx: WithSystemTx;
  readonly log: Log;
}): PlatformTask {
  const { withPlatformTx, withSystemTx, log } = options;
  return {
    name: EMAIL_INLINE_RESCUE_TASK,
    async run({ jobId }) {
      const tenants = await withPlatformTx({ jobId }, (tx) => listTenantsToRescueInline(tx));
      let more = false;
      for (const tenantId of tenants) {
        const taken = await withSystemTx({ tenantId, jobId }, async (tx) => {
          const ids = await takeInlineRescue(tx, RESCUE_PER_TENANT);
          for (const id of ids) {
            await emitEvent(tx, { type: EMAIL_QUEUED_EVENT, subject: id, data: { rescued: true } });
          }
          return ids.length;
        });
        if (taken > 0)
          log('warning', `${String(taken)} immediate e-mails unfinished; queued for the worker`);
        if (taken === RESCUE_PER_TENANT) more = true;
      }
      return more;
    },
  };
}

/**
 * The delivery log's housekeeping (T-M2-48, BR-NTF-2): messages waiting for more than a day (not for a
 * sender) and messages waiting for a sender for more than 7 days become failed with their content removed;
 * final rows older than 12 months are removed. At most every 10 minutes per worker.
 */
export function createEmailHousekeepingTask(options: {
  readonly withPlatformTx: WithPlatformTx;
  readonly log: Log;
  readonly now?: () => number;
}): PlatformTask {
  const { withPlatformTx, log } = options;
  const now = options.now ?? Date.now;
  let lastRun = Number.NEGATIVE_INFINITY;
  return {
    name: EMAIL_HOUSEKEEPING_TASK,
    async run({ jobId }) {
      if (now() - lastRun < 10 * 60_000) return false;
      lastRun = now();
      try {
        const swept = await withPlatformTx({ jobId }, (tx) =>
          sweepEmailDeliveries(tx, SWEEP_BATCH),
        );
        if (swept.stale > 0 || swept.expired > 0) {
          log(
            'warning',
            `e-mail deliveries recorded as failed: ${String(swept.stale)} stale, ${String(swept.expired)} waited too long for a sender`,
          );
        }
        if (swept.purged > 0)
          log('info', `${String(swept.purged)} delivery log rows older than 12 months removed`);
        if (swept.testsExpired > 0)
          log(
            'warning',
            `${String(swept.testsExpired)} test e-mails left unsent for 7 days recorded as failed`,
          );
        const more =
          swept.stale === SWEEP_BATCH ||
          swept.expired === SWEEP_BATCH ||
          swept.purged === SWEEP_BATCH;
        // A full batch: the next pass (queued at once) continues without waiting.
        if (more) lastRun = Number.NEGATIVE_INFINITY;
        return more;
      } catch (error) {
        if (isEmailSettingsMissing(error)) return false;
        throw error;
      }
    },
  };
}
