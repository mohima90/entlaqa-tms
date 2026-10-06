import { EventEmitter } from 'node:events';
import type * as GraphileWorker from 'graphile-worker';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSubscriberRegistry } from './registry';
import {
  CRON_ITEMS,
  type WorkerConfig,
  assertQueueRole,
  createQueuePool,
  openQueuePool,
  runDaemon,
  runPass,
  runnerOptions,
} from './runner';
import { DISPATCH_JOB_OPTIONS, DISPATCH_TASK } from './tasks';

const graphile = vi.hoisted(() => ({
  run: vi.fn(),
  runOnce: vi.fn(),
  makeWorkerUtils: vi.fn(),
}));
vi.mock('graphile-worker', async (importOriginal) => ({
  ...(await importOriginal<typeof GraphileWorker>()),
  ...graphile,
}));

const CA = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';
const LOCAL = 'postgres://app_queue:pw@127.0.0.1:5432/postgres';
const REMOTE =
  'postgres://app_queue.abcdef:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require&sslrootcert=/x.crt';

const config = (log = vi.fn()): WorkerConfig => ({
  queueUrl: LOCAL,
  caPem: undefined,
  registry: createSubscriberRegistry([]),
  withSystemTx: () => Promise.reject(new Error('not used in these tests')),
  concurrency: 2,
  log,
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('assertQueueRole', () => {
  it('accepts app_queue and its pooler form only', () => {
    expect(() => {
      assertQueueRole(LOCAL);
    }).not.toThrow();
    expect(() => {
      assertQueueRole(REMOTE);
    }).not.toThrow();
    expect(() => {
      assertQueueRole('postgres://app_worker:pw@127.0.0.1/postgres');
    }).toThrow(/app_queue/);
    expect(() => {
      assertQueueRole('postgres://app_queuex:pw@127.0.0.1/postgres');
    }).toThrow(/app_queue/);
    expect(() => {
      assertQueueRole('not a url');
    }).toThrow(/not a valid/);
  });
});

describe('createQueuePool', () => {
  it('keeps a local URL as it is', async () => {
    const pool = createQueuePool(LOCAL, undefined, 4);
    expect(pool.options).toMatchObject({ connectionString: LOCAL, max: 4 });
    expect(pool.options.ssl).toBeUndefined();
    await pool.end();
  });

  it('verifies remote servers against the CA; TLS parameters in the URL cannot weaken it', async () => {
    const pool = createQueuePool(REMOTE, CA, 3);
    expect(pool.options).toMatchObject({
      connectionString:
        'postgres://app_queue.abcdef:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres',
      max: 3,
      ssl: { ca: CA, rejectUnauthorized: true },
    });
    await pool.end();
  });

  it('refuses a remote server without a CA and a wrong role', () => {
    expect(() => createQueuePool(REMOTE, undefined, 3)).toThrow(/DATABASE_CA_CERT/);
    expect(() =>
      createQueuePool('postgres://postgres:pw@127.0.0.1/postgres', undefined, 3),
    ).toThrow(/app_queue/);
  });
});

describe('openQueuePool', () => {
  it('logs a lost connection by class and code only, instead of ending the process', async () => {
    const log = vi.fn();
    const pool = openQueuePool(config(log));
    expect(pool.options.max).toBe(4);
    pool.emit('error', Object.assign(new Error('terminated: host db.internal'), { code: '57P01' }));
    pool.emit('error', Object.assign(new TypeError('x'), { code: 'not a code!' }));
    // A checked-out connection gets the same listener when it connects.
    const client = new EventEmitter();
    pool.emit('connect', client);
    client.emit('error', new Error('reset'));
    expect(log.mock.calls).toEqual([
      ['error', 'queue connection lost (Error 57P01)'],
      ['error', 'queue connection lost (TypeError)'],
      ['error', 'queue connection lost (Error)'],
    ]);
    await pool.end();
  });
});

describe('runner options', () => {
  it('schedules the minutely dispatch safety net in the dispatch queue', () => {
    expect(CRON_ITEMS).toHaveLength(1);
    expect(CRON_ITEMS[0]).toMatchObject({
      task: DISPATCH_TASK,
      identifier: 'platform.events.dispatch.minutely',
      options: { backfillPeriod: 0, queueName: DISPATCH_TASK, jobKey: DISPATCH_TASK },
    });
  });

  it('runs without prepared statements and logs level and message only', () => {
    const log = vi.fn();
    const pool = {} as never;
    const options = runnerOptions(config(log), pool);
    expect(options).toMatchObject({ pgPool: pool, concurrency: 2, noPreparedStatements: true });
    expect(Object.keys(options.taskList ?? {})).toHaveLength(2);
    options.logger?.error('task failed', { job: { payload: { secret: 'x' } } });
    expect(log).toHaveBeenCalledWith('error', 'task failed');
    const { concurrency: _unused, ...withoutConcurrency } = config();
    expect(runnerOptions(withoutConcurrency, pool).concurrency).toBe(5);
  });
});

describe('runDaemon and runPass', () => {
  it('runDaemon runs until the runner stops, then closes the pool', async () => {
    graphile.run.mockResolvedValue({ promise: Promise.resolve() });
    await runDaemon(config());
    expect(graphile.run).toHaveBeenCalledTimes(1);
    expect(graphile.run.mock.calls[0]?.[0]).toMatchObject({ concurrency: 2 });
  });

  it('runPass migrates, queues a dispatch, then runs every due job once', async () => {
    const utils = {
      migrate: vi.fn(() => Promise.resolve()),
      addJob: vi.fn(() => Promise.resolve({})),
      release: vi.fn(() => Promise.resolve()),
    };
    graphile.makeWorkerUtils.mockResolvedValue(utils);
    graphile.runOnce.mockResolvedValue(undefined);
    await runPass(config());
    expect(utils.migrate).toHaveBeenCalled();
    expect(utils.addJob).toHaveBeenCalledWith(DISPATCH_TASK, {}, DISPATCH_JOB_OPTIONS);
    expect(utils.release).toHaveBeenCalled();
    expect(graphile.runOnce).toHaveBeenCalledTimes(1);
  });

  it('runPass releases the utilities when the migration fails', async () => {
    const utils = {
      migrate: vi.fn(() => Promise.reject(new Error('no'))),
      addJob: vi.fn(),
      release: vi.fn(() => Promise.resolve()),
    };
    graphile.makeWorkerUtils.mockResolvedValue(utils);
    await expect(runPass(config())).rejects.toThrow('no');
    expect(utils.release).toHaveBeenCalled();
    expect(graphile.runOnce).not.toHaveBeenCalled();
  });
});
