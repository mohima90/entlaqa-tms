import {
  DATABASE_URL_ENV,
  assertConnectionRole,
  readDatabaseCaPem,
  tlsOptionsFor,
} from '@jadarat/platform-db';
import { DATABASE_URL_APP_QUEUE_ENV, assertQueueRole } from '@jadarat/platform-jobs/jobs';
import { isEmailAddress } from '@jadarat/platform-notifications';
import { type EmailSettings, readEmailSettings } from '@jadarat/platform-notifications/jobs';

export type WorkerMode = 'daemon' | 'once' | 'test-email';

export interface RunnerSettings {
  readonly mode: 'daemon' | 'once';
  /** Queue connection (login role app_queue). */
  readonly queueUrl: string;
  /** Tenant work of the jobs (login role app_worker, withSystemTx). */
  readonly workerUrl: string;
  readonly caPem: string | undefined;
  readonly concurrency: number;
  readonly email: EmailSettings;
}

/** Operators' check of the e-mail settings: one sample message to EMAIL_TEST_TO, no database. */
export interface TestEmailSettings {
  readonly mode: 'test-email';
  readonly email: EmailSettings;
  readonly testTo: string;
}

export type WorkerSettings = RunnerSettings | TestEmailSettings;

/** A configuration problem; its message is ours (names variables, never values) and safe to log. */
export class ConfigurationError extends Error {
  override readonly name = 'ConfigurationError';
}

const read = (env: NodeJS.ProcessEnv, name: string) => {
  const value = env[name]?.trim();
  return value === '' ? undefined : value;
};

function check<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw new ConfigurationError(error instanceof Error ? error.message : 'invalid configuration');
  }
}

/**
 * `daemon` (default): long-running, for containers (ADR 0005 §1). `once`: runs every due job, then exits —
 * for scheduled runs in environments without a container host (staging). `test-email`: sends one sample
 * e-mail to EMAIL_TEST_TO. Everything is checked before the first connection: login roles, TLS
 * verification for remote hosts, e-mail settings.
 */
export function readSettings(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  readCaPem: () => string | undefined = readDatabaseCaPem,
): WorkerSettings {
  const mode = argv[0] ?? 'daemon';
  if (mode !== 'daemon' && mode !== 'once' && mode !== 'test-email') {
    throw new ConfigurationError(`unknown mode "${mode}" (expected daemon, once or test-email)`);
  }
  const email = check(() => readEmailSettings(env));
  if (mode === 'test-email') {
    if (email.provider === 'none') {
      throw new ConfigurationError('EMAIL_PROVIDER must be set to send a test e-mail');
    }
    const testTo = read(env, 'EMAIL_TEST_TO');
    if (!testTo || !isEmailAddress(testTo)) {
      throw new ConfigurationError('EMAIL_TEST_TO must be set to an e-mail address');
    }
    return { mode, email, testTo };
  }
  const queueUrl = read(env, DATABASE_URL_APP_QUEUE_ENV);
  if (!queueUrl) throw new ConfigurationError(`${DATABASE_URL_APP_QUEUE_ENV} is not configured`);
  const workerUrl = read(env, DATABASE_URL_ENV.app_worker);
  if (!workerUrl) throw new ConfigurationError(`${DATABASE_URL_ENV.app_worker} is not configured`);
  const caPem = check(readCaPem);
  check(() => {
    assertQueueRole(queueUrl);
  });
  check(() => {
    assertConnectionRole(workerUrl, 'app_worker');
  });
  check(() => tlsOptionsFor(queueUrl, caPem));
  check(() => tlsOptionsFor(workerUrl, caPem));
  const raw = read(env, 'WORKER_CONCURRENCY') ?? (mode === 'once' ? '2' : '5');
  const concurrency = Number(raw);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 50) {
    throw new ConfigurationError('WORKER_CONCURRENCY must be a whole number from 1 to 50');
  }
  return { mode, queueUrl, workerUrl, caPem, concurrency, email };
}
