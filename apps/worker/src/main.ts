import { createDatabase } from '@jadarat/platform-db';
import { createWithSystemTx } from '@jadarat/platform-db/jobs';
import { createSubscriberRegistry, runDaemon, runPass } from '@jadarat/platform-jobs/jobs';
import { createLogger, errorName, installConsoleScrubbing } from '@jadarat/platform-observability';
import { ConfigurationError, readSettings } from './config';
import { workerLog } from './log';
import { SUBSCRIBERS } from './subscribers';

/**
 * Worker process (ADR 0005): `node dist/main.mjs [daemon|once]`. Connections: DATABASE_URL_APP_QUEUE
 * (queue, login role app_queue) and DATABASE_URL_APP_WORKER (tenant work, app_worker); TLS verify-full
 * against DATABASE_CA_CERT / DATABASE_CA_CERT_FILE for remote hosts. Daemon mode stops gracefully on
 * SIGTERM/SIGINT (running jobs finish first).
 */
installConsoleScrubbing();
const logger = createLogger({ service: process.env.JADARAT_SERVICE ?? 'jadarat-worker' });

async function main(): Promise<void> {
  const settings = readSettings(process.argv.slice(2), process.env);
  const workerDb = createDatabase(settings.workerUrl, {
    caPem: settings.caPem,
    max: settings.concurrency,
  });
  try {
    const config = {
      queueUrl: settings.queueUrl,
      caPem: settings.caPem,
      registry: createSubscriberRegistry(SUBSCRIBERS),
      withSystemTx: createWithSystemTx(() => workerDb),
      concurrency: settings.concurrency,
      log: workerLog(logger),
    };
    logger.info(`worker starting (${settings.mode})`, { action: 'worker.start' });
    if (settings.mode === 'once') await runPass(config);
    else await runDaemon(config);
    logger.info('worker stopped', { action: 'worker.stop', outcome: 'success' });
  } finally {
    await workerDb.$client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  if (error instanceof ConfigurationError) {
    logger.error(`worker configuration: ${error.message}`, {
      action: 'worker.stop',
      outcome: 'failure',
    });
  } else {
    // Other messages may carry data: class name here, stack locations (message redacted) below.
    logger.error('worker failed', {
      action: 'worker.stop',
      outcome: 'failure',
      errorName: errorName(error),
    });
    console.error(error);
  }
  process.exitCode = 1;
});
