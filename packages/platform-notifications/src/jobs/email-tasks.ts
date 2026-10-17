import { randomUUID } from 'node:crypto';
import { emitEvent } from '@jadarat/platform-db';
import {
  type EmailTestClaim,
  type WithPlatformTx,
  type WithSystemTx,
  claimEmailTests,
  finishEmailTest,
  isEmailSettingsMissing,
  listTenantsWaitingForSender,
  publishEmailCredentialsKey,
  sweepEmailDeliveries,
  takeWaitingDeliveries,
} from '@jadarat/platform-db/jobs';
import type { PlatformTask, WorkerLogLevel } from '@jadarat/platform-jobs/jobs';
import { credentialsContext } from '../credentials-seal';
import { isEmailProvider } from '../providers';
import { renderEmail } from '../templates/index';
import { CredentialsError, type CredentialsKeyPair } from './credentials';
import { createProviderTransport } from './factory';
import type { EmailRouter } from './router';
import { EMAIL_QUEUED_EVENT } from './sender';
import type { HostLookup } from './smtp';
import { EmailSendError } from './transport';

type Log = (level: WorkerLogLevel, message: string) => void;

export const EMAIL_TESTS_TASK = 'platform.email_tests';
export const EMAIL_RESUME_TASK = 'platform.email_resume';
export const EMAIL_HOUSEKEEPING_TASK = 'platform.email_housekeeping';
/** Test e-mails per pass. */
const TESTS_PER_PASS = 5;
/** Waiting messages queued again per organization and pass. */
const RESUME_PER_TENANT = 200;
/** Rows of each kind per housekeeping pass. */
const SWEEP_BATCH = 500;

/** The platform's name in a test e-mail of the platform sender. */
const PLATFORM_NAME = { ar: 'جدارات', en: 'Jadarat' } as const;

function codeOf(error: unknown): string {
  if (error instanceof CredentialsError || error instanceof EmailSendError) return error.code;
  return 'SEND_FAILED';
}

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
  readonly lookup?: HostLookup;
  readonly transportFor?: typeof createProviderTransport;
}): PlatformTask {
  const { keys, withPlatformTx, log } = options;
  const transportFor = options.transportFor ?? createProviderTransport;
  let published = false;

  async function sendTest(test: EmailTestClaim): Promise<void> {
    if (!keys) throw new CredentialsError('CREDENTIALS_KEY_MISSING');
    if (!isEmailProvider(test.provider))
      throw new EmailSendError('PROVIDER_SETTINGS_INVALID', false);
    const scope =
      test.tenantId === null
        ? ({ kind: 'platform' } as const)
        : ({ kind: 'tenant', tenantId: test.tenantId } as const);
    const secrets = keys.open(test.credentialsSealed, credentialsContext(scope, test.provider));
    const transport = transportFor(test.provider, test.options, secrets, {
      organization: test.tenantId !== null,
      smtpCaPem: options.smtpCaPem,
      ...(options.lookup ? { lookup: options.lookup } : {}),
    });
    try {
      const email = renderEmail('platform.email_test', 'en', {
        senderOwner:
          test.tenantId === null ? PLATFORM_NAME : { ar: test.fromName, en: test.fromName },
        provider: test.provider,
        fromAddress: test.fromAddress,
      });
      await transport.send({
        from: { name: test.fromName, address: test.fromAddress },
        replyTo: test.replyTo ?? undefined,
        to: test.recipient,
        subject: email.subject,
        html: email.html,
        text: email.text,
        idempotencyKey: randomUUID(),
      });
    } finally {
      await transport.close?.();
    }
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
        const tests = await withPlatformTx({ jobId }, (tx) => claimEmailTests(tx, TESTS_PER_PASS));
        for (const test of tests) {
          let outcome:
            { readonly sent: true } | { readonly sent: false; readonly errorCode: string };
          try {
            await sendTest(test);
            outcome = { sent: true };
          } catch (error) {
            outcome = { sent: false, errorCode: codeOf(error) };
          }
          const verified = await withPlatformTx({ jobId }, (tx) =>
            finishEmailTest(tx, test, outcome),
          );
          const whose = test.tenantId === null ? 'platform sender' : "organization's provider";
          log(
            outcome.sent ? 'info' : 'warning',
            outcome.sent
              ? `test e-mail of the ${whose} sent${verified ? ' (verified)' : ''}`
              : `test e-mail of the ${whose} not sent (${outcome.errorCode})`,
          );
        }
        return tests.length === TESTS_PER_PASS;
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
