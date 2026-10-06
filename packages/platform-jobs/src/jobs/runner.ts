import { tlsOptionsFor } from '@jadarat/platform-db';
import type { WithSystemTx } from '@jadarat/platform-db/jobs';
import {
  Logger,
  type LogFunctionFactory,
  type RunnerOptions,
  makeWorkerUtils,
  parseCronItems,
  run,
  runOnce,
} from 'graphile-worker';
import pg from 'pg';
import type { SubscriberRegistry } from './registry';
import { DISPATCH_JOB_OPTIONS, DISPATCH_TASK, createTaskList } from './tasks';

/** Connection of the job runner and dispatcher (ADR 0005 §2). */
export const DATABASE_URL_APP_QUEUE_ENV = 'DATABASE_URL_APP_QUEUE';

export interface WorkerConfig {
  /** Connection URL of login role app_queue. */
  readonly queueUrl: string;
  /** PEM root CA of the database server; required for remote hosts (verify-full). */
  readonly caPem: string | undefined;
  readonly registry: SubscriberRegistry;
  readonly withSystemTx: WithSystemTx;
  /** Jobs run in parallel per process (default 5); the pool holds two more connections. */
  readonly concurrency?: number;
  /** Operational log line: level and message only (no payloads, no personal data, ADR 0009). */
  readonly log: (level: WorkerLogLevel, message: string) => void;
}

export type WorkerLogLevel = 'error' | 'warning' | 'info' | 'debug';

/** The URL must log in as app_queue (Supabase pooler names `app_queue.<project>` are accepted). */
export function assertQueueRole(url: string): void {
  let user: string;
  try {
    user = decodeURIComponent(new URL(url).username);
  } catch {
    throw new Error(`${DATABASE_URL_APP_QUEUE_ENV} is not a valid connection URL`);
  }
  if (user !== 'app_queue' && !user.startsWith('app_queue.')) {
    throw new Error(`${DATABASE_URL_APP_QUEUE_ENV} must connect as login role app_queue`);
  }
}

const TLS_URL_PARAMS = [
  'ssl',
  'sslmode',
  'sslrootcert',
  'sslcert',
  'sslkey',
  'sslnegotiation',
  'uselibpqcompat',
];

/**
 * The pool of the runner. TLS follows the application's rule (verified chain and host name for any
 * remote server); `sslmode` and friends are removed from the URL so they cannot override it.
 */
export function createQueuePool(url: string, caPem: string | undefined, max: number): pg.Pool {
  assertQueueRole(url);
  const ssl = tlsOptionsFor(url, caPem);
  if (!ssl) return new pg.Pool({ connectionString: url, max });
  // pg lets TLS parameters in the URL override `ssl`: remove them so verification always applies.
  const cleaned = new URL(url);
  for (const key of TLS_URL_PARAMS) {
    cleaned.searchParams.delete(key);
  }
  return new pg.Pool({ connectionString: cleaned.toString(), max, ssl });
}

/** Safety net: dispatch runs every minute even if no insert kicked it (e.g. before the first start). */
export const CRON_ITEMS = parseCronItems([
  {
    task: DISPATCH_TASK,
    match: '* * * * *',
    identifier: 'platform.events.dispatch.minutely',
    options: { ...DISPATCH_JOB_OPTIONS, backfillPeriod: 0 },
  },
]);

function loggerFrom(log: WorkerConfig['log']): Logger {
  // Graphile's scope and meta (job payloads, task details) are dropped: level and message only.
  const factory: LogFunctionFactory = () => (level, message) => {
    log(level, message);
  };
  return new Logger(factory);
}

const concurrencyOf = (config: WorkerConfig) => config.concurrency ?? 5;

/**
 * The runner's pool. A connection that breaks (database restart, network) emits `error` on the pool
 * (idle) or on its client (checked out); without listeners that would end the process. pg replaces the
 * connection, and the query in flight fails and is retried by the job. We log the error class and code
 * only (messages may carry connection details).
 */
export function openQueuePool(config: WorkerConfig): pg.Pool {
  const pool = createQueuePool(config.queueUrl, config.caPem, concurrencyOf(config) + 2);
  const onError = (error: Error & { code?: unknown }) => {
    const code =
      typeof error.code === 'string' && /^[0-9A-Z_]{2,32}$/.test(error.code)
        ? ` ${error.code}`
        : '';
    config.log('error', `queue connection lost (${error.name}${code})`);
  };
  pool.on('error', onError);
  pool.on('connect', (client) => {
    client.on('error', onError);
  });
  return pool;
}

export function runnerOptions(config: WorkerConfig, pgPool: pg.Pool): RunnerOptions {
  return {
    pgPool,
    concurrency: concurrencyOf(config),
    // Behind a transaction pooler, prepared statements are not available (ADR 0005 §2).
    noPreparedStatements: true,
    logger: loggerFrom(config.log),
    taskList: createTaskList(config.registry, config.withSystemTx),
    parsedCronItems: CRON_ITEMS,
  };
}

/** Daemon mode (production, ADR 0005 §1): runs until SIGTERM/SIGINT, then finishes running jobs. */
export async function runDaemon(config: WorkerConfig): Promise<void> {
  const pool = openQueuePool(config);
  try {
    const runner = await run(runnerOptions(config, pool));
    await runner.promise;
  } finally {
    await pool.end();
  }
}

/**
 * One pass (non-production schedules, e.g. staging): migrate, queue a dispatch, then run every job
 * that is due until none is left — deliveries created by the dispatch included.
 */
export async function runPass(config: WorkerConfig): Promise<void> {
  const pool = openQueuePool(config);
  try {
    const utils = await makeWorkerUtils({ pgPool: pool, logger: loggerFrom(config.log) });
    try {
      await utils.migrate();
      await utils.addJob(DISPATCH_TASK, {}, DISPATCH_JOB_OPTIONS);
    } finally {
      await utils.release();
    }
    await runOnce(runnerOptions(config, pool));
  } finally {
    await pool.end();
  }
}
