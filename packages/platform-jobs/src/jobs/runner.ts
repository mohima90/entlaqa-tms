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
/** Notified by the outbox trigger when a transaction that wrote events commits (migration 20261007090000). */
export const EVENTS_CHANNEL = 'jadarat_events';

export interface WorkerConfig {
  /** Connection URL of login role app_queue. */
  readonly queueUrl: string;
  /** PEM root CA of the database server; required for remote hosts (verify-full). */
  readonly caPem: string | undefined;
  readonly registry: SubscriberRegistry;
  readonly withSystemTx: WithSystemTx;
  /** Jobs run in parallel per process (default 5); the pool holds three more connections. */
  readonly concurrency?: number;
  /** Operational log line: level and message only (no payloads, no personal data, ADR 0009). */
  readonly log: (level: WorkerLogLevel, message: string) => void;
}

export type WorkerLogLevel = 'error' | 'warning' | 'info' | 'debug';

const TLS_URL_PARAMS = [
  'ssl',
  'sslmode',
  'sslrootcert',
  'sslcert',
  'sslkey',
  'sslnegotiation',
  'uselibpqcompat',
];
const ALLOWED_URL_PARAMS: ReadonlySet<string> = new Set([...TLS_URL_PARAMS, 'application_name']);

/**
 * The URL must log in as app_queue (Supabase pooler names `app_queue.<project>` are accepted) and carry
 * no connection parameters besides TLS settings: pg lets `?host=`, `?user=` and others override the
 * parts of the URL that the role and TLS checks look at.
 */
export function assertQueueRole(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${DATABASE_URL_APP_QUEUE_ENV} is not a valid connection URL`);
  }
  const user = decodeURIComponent(parsed.username);
  if (user !== 'app_queue' && !user.startsWith('app_queue.')) {
    throw new Error(`${DATABASE_URL_APP_QUEUE_ENV} must connect as login role app_queue`);
  }
  for (const key of parsed.searchParams.keys()) {
    if (!ALLOWED_URL_PARAMS.has(key)) {
      throw new Error(
        `${DATABASE_URL_APP_QUEUE_ENV} must not set the connection parameter "${key}"`,
      );
    }
  }
}

/**
 * The pool of the runner. TLS follows the application's rule (verified chain and host name for any
 * remote server); `sslmode` and friends are removed from the URL so they cannot override it.
 */
export function createQueuePool(url: string, caPem: string | undefined, max: number): pg.Pool {
  assertQueueRole(url);
  const ssl = tlsOptionsFor(url, caPem);
  // TCP keep-alive: a half-open connection (network failure) is noticed instead of hanging a query.
  if (!ssl) return new pg.Pool({ connectionString: url, max, keepAlive: true });
  // pg lets TLS parameters in the URL override `ssl`: remove them so verification always applies.
  const cleaned = new URL(url);
  for (const key of TLS_URL_PARAMS) {
    cleaned.searchParams.delete(key);
  }
  return new pg.Pool({ connectionString: cleaned.toString(), max, ssl, keepAlive: true });
}

/** Safety net: dispatch runs every minute even when no notification arrived (one-pass mode, gaps). */
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

/** Error class and stable code only: messages of connection errors may carry connection details. */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const { code } = error as { code?: unknown };
  return typeof code === 'string' && /^[0-9A-Z_]{2,32}$/.test(code)
    ? `${error.name} ${code}`
    : error.name;
}

/**
 * The runner's pool: jobs, graphile-worker's own listener, the event listener and one spare. A
 * connection that breaks (database restart, network) emits `error` on the pool (idle) or on its client
 * (checked out); without listeners that would end the process. pg replaces the connection, and the
 * query in flight fails and its job is retried.
 */
export function openQueuePool(config: WorkerConfig): pg.Pool {
  const pool = createQueuePool(config.queueUrl, config.caPem, concurrencyOf(config) + 3);
  const onError = (error: Error) => {
    config.log('error', `queue connection lost (${describeError(error)})`);
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

/**
 * Coalesces wake-ups: while one dispatch is being queued, further calls queue exactly one more
 * afterwards (it will see every event committed in between).
 */
export function createKicker(
  queueDispatch: () => Promise<unknown>,
  log: WorkerConfig['log'],
): () => void {
  let running = false;
  let again = false;
  const kick = (): void => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    queueDispatch()
      .catch((error: unknown) => {
        log('error', `could not queue an event dispatch (${describeError(error)})`);
      })
      .finally(() => {
        running = false;
        if (again) {
          again = false;
          kick();
        }
      });
  };
  return kick;
}

/**
 * Daemon mode: listens on EVENTS_CHANNEL with its own connection and kicks a dispatch for every
 * notification — and once after each (re)connection, for events committed while it was not listening.
 * A lost connection is retried every `retryMs`; meanwhile the minutely schedule keeps events moving.
 * Returns a function that stops listening.
 */
export function listenForEvents(
  pool: pg.Pool,
  kick: () => void,
  log: WorkerConfig['log'],
  retryMs = 5000,
): () => Promise<void> {
  let stopped = false;
  let client: pg.PoolClient | undefined;
  let timer: NodeJS.Timeout | undefined;
  const released = new WeakSet<pg.PoolClient>();

  const release = (current: pg.PoolClient, error?: Error) => {
    if (released.has(current)) return;
    released.add(current);
    current.release(error);
  };
  const retry = () => {
    if (!stopped) timer = setTimeout(() => void connect(), retryMs);
  };
  /** Gives up a broken listening connection (once) and tries again later. */
  const drop = (current: pg.PoolClient, error: Error) => {
    if (released.has(current)) return;
    if (client === current) client = undefined;
    release(current, error);
    retry();
  };
  async function connect(): Promise<void> {
    let current: pg.PoolClient | undefined;
    try {
      current = await pool.connect();
      if (stopped) {
        release(current);
        return;
      }
      const listening = current;
      client = listening;
      listening.on('notification', (message) => {
        if (message.channel === EVENTS_CHANNEL) kick();
      });
      listening.on('error', (error) => {
        if (released.has(listening)) return;
        log('error', `event listener connection lost (${describeError(error)})`);
        drop(listening, error);
      });
      await listening.query(`listen ${EVENTS_CHANNEL}`);
      kick();
    } catch (error) {
      log('error', `event listener could not listen (${describeError(error)})`);
      if (current) drop(current, error instanceof Error ? error : new Error('listen failed'));
      else retry();
    }
  }
  void connect();

  return async () => {
    stopped = true;
    clearTimeout(timer);
    const current = client;
    client = undefined;
    if (!current || released.has(current)) return;
    try {
      await current.query(`unlisten ${EVENTS_CHANNEL}`);
      release(current);
    } catch (error) {
      release(current, error instanceof Error ? error : undefined);
    }
  };
}

/**
 * Daemon mode (production, ADR 0005 §1): runs until `signal` aborts, then lets running jobs finish.
 * Signals are the caller's to handle (graphile-worker's own handler would end the process before the
 * caller can clean up).
 */
export async function runDaemon(config: WorkerConfig, signal?: AbortSignal): Promise<void> {
  const pool = openQueuePool(config);
  try {
    const runner = await run({ ...runnerOptions(config, pool), noHandleSignals: true });
    const kicker = createKicker(
      () => runner.addJob(DISPATCH_TASK, {}, DISPATCH_JOB_OPTIONS),
      config.log,
    );
    // Once stopping, wake-ups are ignored: the runner no longer takes jobs.
    const kick = () => {
      if (!signal?.aborted) kicker();
    };
    const stopListening = listenForEvents(pool, kick, config.log);
    const stop = () => {
      runner.stop().catch((error: unknown) => {
        config.log('error', `worker did not stop cleanly (${describeError(error)})`);
      });
    };
    if (signal?.aborted) stop();
    else signal?.addEventListener('abort', stop, { once: true });
    try {
      await runner.promise;
    } finally {
      signal?.removeEventListener('abort', stop);
      await stopListening();
    }
  } finally {
    await pool.end();
  }
}

/** Events not dispatched this long after they were written mean the dispatch is stuck. */
export const STALE_EVENT_MINUTES = 10;

export interface PassResult {
  /** Events still waiting for dispatch after the pass, written more than STALE_EVENT_MINUTES ago. */
  readonly staleEvents: number;
}

/**
 * One pass (non-production schedules, e.g. staging): migrate, queue a dispatch, then run every job
 * that is due until none is left — deliveries created by the dispatch included. Reports events the
 * pass could not dispatch, so a stuck dispatch shows as a failed run.
 */
export async function runPass(config: WorkerConfig): Promise<PassResult> {
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
    const { rows } = await pool.query<{ stale: string }>(
      `select count(*) as stale from platform.event_outbox
       where dispatched_at is null and created_at < now() - make_interval(mins => $1)`,
      [STALE_EVENT_MINUTES],
    );
    return { staleEvents: Number(rows[0]?.stale ?? 0) };
  } finally {
    await pool.end();
  }
}
