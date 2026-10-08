import { createDatabase } from '@jadarat/platform-db';
import { createWithPlatformTx, createWithSystemTx } from '@jadarat/platform-db/jobs';
import {
  STALE_EVENT_MINUTES,
  createSubscriberRegistry,
  runDaemon,
  runPass,
} from '@jadarat/platform-jobs/jobs';
import { sendTestEmail } from '@jadarat/platform-notifications/jobs';
import { createLogger, errorName, installConsoleScrubbing } from '@jadarat/platform-observability';
import {
  ADMIN_KEY_WARN_DAYS,
  ConfigurationError,
  type RunnerSettings,
  type TestEmailSettings,
  adminKeyDaysLeft,
  readSettings,
} from './config';
import { workerLog } from './log';
import { platformTasks } from './platform-tasks';
import { subscribers } from './subscribers';

/**
 * Worker process (ADR 0005, ADR 0008): `node dist/main.mjs [daemon|once|test-email]`. Connections:
 * DATABASE_URL_APP_QUEUE (queue, login role app_queue) and DATABASE_URL_APP_WORKER (tenant work,
 * app_worker); TLS verify-full against DATABASE_CA_CERT / DATABASE_CA_CERT_FILE for remote hosts.
 * E-mail: EMAIL_PROVIDER (resend | smtp | none) and its settings; APP_BASE_URL (the web app's public
 * origin, for links in e-mails). Password-reset links: SUPABASE_URL + SUPABASE_SECRET_KEY (the Auth
 * admin API — in the worker's environment only, T-M2-17). Daemon mode stops gracefully on
 * SIGTERM/SIGINT (running jobs finish first) and exits 0.
 */
installConsoleScrubbing();
const logger = createLogger({ service: process.env.JADARAT_SERVICE ?? 'jadarat-worker' });
const log = workerLog(logger);

async function testEmail(settings: TestEmailSettings): Promise<void> {
  const transport = settings.email.createTransport();
  if (!transport) throw new ConfigurationError('EMAIL_PROVIDER must be set to send a test e-mail');
  try {
    const id = await sendTestEmail(transport, settings.email.from, settings.testTo);
    logger.info(`test e-mail accepted by ${transport.provider}${id ? ` (${id})` : ''}`, {
      action: 'worker.test_email',
      outcome: 'success',
    });
  } finally {
    await transport.close?.();
  }
}

async function runWorker(settings: RunnerSettings): Promise<void> {
  const workerDb = createDatabase(settings.workerUrl, {
    caPem: settings.caPem,
    max: settings.concurrency,
  });
  const emailTransport = settings.email.createTransport();
  const withSystemTx = createWithSystemTx(() => workerDb);
  try {
    const config = {
      queueUrl: settings.queueUrl,
      caPem: settings.caPem,
      registry: createSubscriberRegistry(
        subscribers({
          emailTransport,
          emailFrom: settings.email.from,
          appBaseUrl: settings.appBaseUrl,
          log,
        }),
      ),
      withSystemTx,
      platformTasks: platformTasks({
        appBaseUrl: settings.appBaseUrl,
        authAdmin: settings.authAdmin,
        withPlatformTx: createWithPlatformTx(() => workerDb),
        withSystemTx,
        log,
      }),
      concurrency: settings.concurrency,
      log,
    };
    const resetLinks = settings.authAdmin ? 'on' : 'off';
    logger.info(
      `worker starting (${settings.mode}; e-mail: ${settings.email.provider}; reset links: ${resetLinks})`,
      {
        action: 'worker.start',
      },
    );
    // A self-hosted Auth admin token lives 90 days (gen-secrets.sh): warn a month ahead so that it is
    // renewed before password-reset links stop (infra/docker/README.md, "Auth admin key").
    const daysLeft = settings.authAdmin && adminKeyDaysLeft(settings.authAdmin.secretKey);
    if (daysLeft !== undefined && daysLeft < ADMIN_KEY_WARN_DAYS) {
      const expired = daysLeft < 0;
      logger.warn(
        expired
          ? 'the Auth admin key (SUPABASE_SECRET_KEY) has expired: password-reset links fail until it is renewed'
          : `the Auth admin key (SUPABASE_SECRET_KEY) expires in ${String(daysLeft)} days: renew it`,
        {
          action: 'worker.start',
          reason: 'auth_admin_key_expiry',
          state: expired ? 'expired' : 'expiring',
        },
      );
    }
    if (settings.mode === 'once') {
      // graphile-worker's own signal handling releases the pass's jobs on cancel.
      const { staleEvents } = await runPass(config);
      if (staleEvents > 0) {
        logger.error(
          `${String(staleEvents)} events still wait for dispatch after ${String(STALE_EVENT_MINUTES)} minutes`,
          { action: 'worker.pass', outcome: 'failure' },
        );
        process.exitCode = 1;
      }
    } else {
      const controller = new AbortController();
      const stop = () => {
        logger.info('worker stopping: running jobs finish first', { action: 'worker.stop' });
        controller.abort();
      };
      process.once('SIGTERM', stop);
      process.once('SIGINT', stop);
      await runDaemon(config, controller.signal);
    }
    logger.info('worker stopped', { action: 'worker.stop', outcome: 'success' });
  } finally {
    await emailTransport?.close?.();
    await workerDb.$client.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  const settings = readSettings(process.argv.slice(2), process.env);
  if (settings.mode === 'test-email') await testEmail(settings);
  else await runWorker(settings);
}

main().catch((error: unknown) => {
  if (error instanceof ConfigurationError) {
    logger.error(`worker configuration: ${error.message}`, {
      action: 'worker.stop',
      outcome: 'failure',
    });
  } else {
    // Other messages may carry data: class name (and our error code) here, stack locations below.
    const code = (error as { code?: unknown }).code;
    logger.error('worker failed', {
      action: 'worker.stop',
      outcome: 'failure',
      errorName: errorName(error),
      ...(typeof code === 'string' && /^[A-Z0-9_]{2,64}$/.test(code) ? { errorCode: code } : {}),
    });
    console.error(error);
  }
  process.exitCode = 1;
});
