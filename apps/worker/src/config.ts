import {
  DATABASE_URL_ENV,
  assertConnectionRole,
  readDatabaseCaPem,
  tlsOptionsFor,
} from '@jadarat/platform-db';
import { DATABASE_URL_APP_QUEUE_ENV, assertQueueRole } from '@jadarat/platform-jobs/jobs';

export type WorkerMode = 'daemon' | 'once';

export interface WorkerSettings {
  readonly mode: WorkerMode;
  /** Queue connection (login role app_queue). */
  readonly queueUrl: string;
  /** Tenant work of the jobs (login role app_worker, withSystemTx). */
  readonly workerUrl: string;
  readonly caPem: string | undefined;
  readonly concurrency: number;
}

/** A configuration problem; its message is ours (names variables, never values) and safe to log. */
export class ConfigurationError extends Error {
  override readonly name = 'ConfigurationError';
}

const read = (env: NodeJS.ProcessEnv, name: string) => {
  const value = env[name]?.trim();
  return value === '' ? undefined : value;
};

function check(fn: () => unknown): void {
  try {
    fn();
  } catch (error) {
    throw new ConfigurationError(error instanceof Error ? error.message : 'invalid configuration');
  }
}

/**
 * `daemon` (default): long-running, for containers (ADR 0005 §1). `once`: runs every due job, then exits —
 * for scheduled runs in environments without a container host (staging). Everything is checked before
 * the first connection: login roles, and TLS verification for remote hosts.
 */
export function readSettings(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  readCaPem: () => string | undefined = readDatabaseCaPem,
): WorkerSettings {
  const mode = argv[0] ?? 'daemon';
  if (mode !== 'daemon' && mode !== 'once') {
    throw new ConfigurationError(`unknown mode "${mode}" (expected daemon or once)`);
  }
  const queueUrl = read(env, DATABASE_URL_APP_QUEUE_ENV);
  if (!queueUrl) throw new ConfigurationError(`${DATABASE_URL_APP_QUEUE_ENV} is not configured`);
  const workerUrl = read(env, DATABASE_URL_ENV.app_worker);
  if (!workerUrl) throw new ConfigurationError(`${DATABASE_URL_ENV.app_worker} is not configured`);
  let caPem: string | undefined;
  check(() => (caPem = readCaPem()));
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
  return { mode, queueUrl, workerUrl, caPem, concurrency };
}
