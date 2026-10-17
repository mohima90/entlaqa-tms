import { createDatabase } from '@jadarat/platform-db';
import { createWithPlatformTx, createWithSystemTx } from '@jadarat/platform-db/jobs';
import {
  STALE_EVENT_MINUTES,
  createSubscriberRegistry,
  runDaemon,
  runPass,
} from '@jadarat/platform-jobs/jobs';
import {
  SIGNATURE_HARD_MAX_AGE_DAYS,
  SIGNATURE_MAX_AGE_HOURS,
  createClamdScanner,
  signatureAge,
} from '@jadarat/platform-files/jobs';
import { createEmailRouter, sendTestEmail } from '@jadarat/platform-notifications/jobs';
import { createLogger, errorName, installConsoleScrubbing } from '@jadarat/platform-observability';
import { adminKeyExpiryCheck } from './admin-key-expiry';
import {
  ConfigurationError,
  type RunnerSettings,
  type ScannerCheckSettings,
  type TestEmailSettings,
  readSettings,
} from './config';
import { workerLog } from './log';
import { platformTasks } from './platform-tasks';
import { subscribers } from './subscribers';

/**
 * Worker process (ADR 0005, ADR 0008): `node dist/main.mjs [daemon|once|test-email]`. Connections:
 * DATABASE_URL_APP_QUEUE (queue, login role app_queue) and DATABASE_URL_APP_WORKER (tenant work,
 * app_worker); TLS verify-full against DATABASE_CA_CERT / DATABASE_CA_CERT_FILE for remote hosts.
 * E-mail (WP-ADM-01): the sender is set in the product (Super Admin → Platform settings → Email; an
 * organization's Email integration); EMAIL_CREDENTIALS_KEY (SECRET) opens the provider secrets saved there.
 * Self-hosted installations may add an installation sender (EMAIL_PROVIDER resend | smtp and its settings),
 * used while no platform sender was saved. APP_BASE_URL (the web app's public origin, for links in e-mails). Password-reset links: SUPABASE_URL + SUPABASE_SECRET_KEY (the Auth
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

/**
 * Operators' check of the malware scanner (T-M2-18, ADR 0006 §8): it answers, and its signatures are at
 * most SIGNATURE_MAX_AGE_HOURS old (freshclam working). Exit code 2 when they are older (stale: the scan
 * still runs), 3 when they are older than the hard limit or undated (the scan refuses to run).
 */
async function scannerCheck(settings: ScannerCheckSettings): Promise<void> {
  const scanner = createClamdScanner(settings.scanner);
  await scanner.ping();
  const version = await scanner.version();
  const { age, hours } = signatureAge(version, Date.now(), settings.scanner.maxSignatureAgeDays);
  const message = `scanner ${version.engine}, signatures ${version.signatures}${hours === null ? ' (undated)' : `, ${String(hours)} hours old`}`;
  if (age === 'too_old' || age === 'unknown') {
    logger.error(
      `${message}: older than ${String(settings.scanner.maxSignatureAgeDays)} days or undated — nothing is scanned`,
      { action: 'worker.scanner_check', outcome: 'failure', reason: 'scanner_signatures_too_old' },
    );
    process.exitCode = 3;
  } else if (age === 'stale') {
    logger.warn(`${message}: older than ${String(SIGNATURE_MAX_AGE_HOURS)} hours`, {
      action: 'worker.scanner_check',
      outcome: 'failure',
      reason: 'scanner_signatures_stale',
    });
    process.exitCode = 2;
  } else {
    logger.info(message, { action: 'worker.scanner_check', outcome: 'success' });
  }
}

async function runWorker(settings: RunnerSettings): Promise<void> {
  const workerDb = createDatabase(settings.workerUrl, {
    caPem: settings.caPem,
    max: settings.concurrency,
  });
  const emailTransport = settings.email.createTransport();
  const emailRouter = createEmailRouter({
    keys: settings.emailCredentials,
    allowPrivatePlatformSmtp: settings.allowPrivatePlatformSmtp,
    installation: emailTransport
      ? {
          transport: emailTransport,
          address: settings.email.from.address,
          name: settings.email.from.name,
        }
      : null,
    log,
  });
  const withSystemTx = createWithSystemTx(() => workerDb);
  // A self-hosted Auth admin token lives 90 days (gen-secrets.sh): warn a month ahead — at start-up and
  // then daily from the account-mail task — so that it is renewed before password-reset links stop
  // (infra/docker/README.md, "Auth admin key"). Only the days left are logged.
  const adminKeyCheck = settings.authAdmin
    ? adminKeyExpiryCheck(settings.authAdmin.secretKey, (daysLeft) => {
        const expired = daysLeft < 0;
        logger.warn(
          expired
            ? 'the Auth admin key (SUPABASE_SECRET_KEY) has expired: password-reset links fail until it is renewed'
            : `the Auth admin key (SUPABASE_SECRET_KEY) expires in ${String(daysLeft)} days: renew it`,
          {
            action: 'worker.auth_admin_key',
            reason: 'auth_admin_key_expiry',
            state: expired ? 'expired' : 'expiring',
          },
        );
      })
    : undefined;
  try {
    const config = {
      queueUrl: settings.queueUrl,
      caPem: settings.caPem,
      registry: createSubscriberRegistry(
        subscribers({ emailRouter, appBaseUrl: settings.appBaseUrl, log }),
      ),
      withSystemTx,
      platformTasks: platformTasks({
        appBaseUrl: settings.appBaseUrl,
        authAdmin: settings.authAdmin,
        scanner: settings.scanner,
        orphanSweep: settings.orphanSweep,
        importSending: settings.importSending,
        withPlatformTx: createWithPlatformTx(() => workerDb),
        withSystemTx,
        log,
        adminKeyCheck,
        email: {
          keys: settings.emailCredentials,
          router: emailRouter,
          allowPrivatePlatformSmtp: settings.allowPrivatePlatformSmtp,
        },
      }),
      concurrency: settings.concurrency,
      log,
    };
    const resetLinks = settings.authAdmin ? 'on' : 'off';
    // File scanning needs Storage (the secret key) and the scanner; without them uploads wait unscanned.
    const fileScanning = settings.authAdmin && settings.scanner ? 'on' : 'off';
    // E-mail: the key for the settings saved in the product, and the installation's own sender (if any).
    const emailKey = settings.emailCredentials ? 'on' : 'off';
    logger.info(
      `worker starting (${settings.mode}; e-mail settings key: ${emailKey}; installation sender: ${settings.email.provider}; reset links: ${resetLinks}; file scanning: ${fileScanning})`,
      {
        action: 'worker.start',
      },
    );
    adminKeyCheck?.();
    if (settings.allowPrivatePlatformSmtp) {
      logger.warn(
        'the platform sender may use an internal SMTP relay on any port (EMAIL_PLATFORM_SMTP_ALLOW_PRIVATE=true)',
        { action: 'worker.start', reason: 'platform_smtp_private_allowed' },
      );
    }
    if (settings.emailCredentialsProblem) {
      logger.warn(
        `e-mail settings saved in the product are off: ${settings.emailCredentialsProblem}`,
        { action: 'worker.start', reason: 'email_credentials_key_unusable' },
      );
    }
    if (settings.authAdmin && !settings.orphanSweep.enabled) {
      logger.warn('file orphan sweep paused (FILE_ORPHAN_SWEEP=off): orphan objects are kept', {
        action: 'worker.start',
        reason: 'file_orphan_sweep_off',
      });
    }
    if (settings.scanner && settings.scanner.maxSignatureAgeDays > SIGNATURE_HARD_MAX_AGE_DAYS) {
      logger.warn(
        `malware signatures up to ${String(settings.scanner.maxSignatureAgeDays)} days old are accepted (FILE_SCAN_SIGNATURES_MAX_AGE_DAYS): test installations with pinned signatures only`,
        { action: 'worker.start', reason: 'scanner_signatures_limit_raised' },
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
    await emailRouter.close();
    await emailTransport?.close?.();
    await workerDb.$client.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  const settings = readSettings(process.argv.slice(2), process.env);
  if (settings.mode === 'test-email') await testEmail(settings);
  else if (settings.mode === 'scanner-check') await scannerCheck(settings);
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
