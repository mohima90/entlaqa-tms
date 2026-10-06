import { EventEmitter } from 'node:events';
import type * as GraphileWorker from 'graphile-worker';
import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSubscriberRegistry } from './registry';
import {
  CRON_ITEMS,
  EVENTS_CHANNEL,
  type WorkerConfig,
  assertQueueRole,
  createKicker,
  createQueuePool,
  listenForEvents,
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
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

/** A pg client double: records queries, emits notifications and errors. */
function fakeClient() {
  const client = Object.assign(new EventEmitter(), {
    queries: [] as string[],
    query: vi.fn((text: string) => {
      client.queries.push(text);
      return Promise.resolve({ rows: [] });
    }),
    release: vi.fn(),
  });
  return client;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const until = async (condition: () => boolean) => {
  for (let i = 0; i < 200 && !condition(); i += 1) await new Promise((r) => setTimeout(r, 5));
  expect(condition()).toBe(true);
};

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

  it('refuses connection parameters that would override the checked host or user', () => {
    expect(() => {
      assertQueueRole(`${LOCAL}?sslmode=disable&application_name=worker`);
    }).not.toThrow();
    for (const param of [
      'host=db.remote.example',
      'user=postgres',
      'port=6543',
      'options=-c%20x',
    ]) {
      expect(() => {
        assertQueueRole(`${LOCAL}?${param}`);
      }).toThrow(/must not set the connection parameter/);
    }
  });
});

describe('createQueuePool', () => {
  it('keeps a local URL as it is', async () => {
    const pool = createQueuePool(LOCAL, undefined, 4);
    expect(pool.options).toMatchObject({ connectionString: LOCAL, max: 4, keepAlive: true });
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
      keepAlive: true,
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
    expect(pool.options.max).toBe(5);
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
  it('schedules the minutely dispatch safety net (keyed, no named queue)', () => {
    expect(CRON_ITEMS).toHaveLength(1);
    expect(CRON_ITEMS[0]).toMatchObject({
      task: DISPATCH_TASK,
      identifier: 'platform.events.dispatch.minutely',
      options: { backfillPeriod: 0, jobKey: DISPATCH_TASK },
    });
    expect(CRON_ITEMS[0]?.options).not.toHaveProperty('queueName');
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

describe('createKicker', () => {
  it('queues one dispatch at a time and one more for wake-ups that arrive meanwhile', async () => {
    const pending: (() => void)[] = [];
    const queueDispatch = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          pending.push(resolve);
        }),
    );
    const kick = createKicker(queueDispatch, vi.fn());
    kick();
    kick();
    kick();
    expect(queueDispatch).toHaveBeenCalledTimes(1);
    pending.shift()?.();
    await tick();
    expect(queueDispatch).toHaveBeenCalledTimes(2);
    pending.shift()?.();
    await tick();
    expect(queueDispatch).toHaveBeenCalledTimes(2);
  });

  it('logs a failure by class only and keeps working', async () => {
    const log = vi.fn();
    const queueDispatch = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('connection to db.internal failed'))
      .mockResolvedValue({});
    const kick = createKicker(queueDispatch, log);
    kick();
    await tick();
    expect(log).toHaveBeenCalledWith('error', 'could not queue an event dispatch (Error)');
    kick();
    await tick();
    expect(queueDispatch).toHaveBeenCalledTimes(2);
  });
});

describe('listenForEvents', () => {
  it('listens, kicks on start and on each notification of its channel, and stops cleanly', async () => {
    const client = fakeClient();
    const pool = { connect: vi.fn(() => Promise.resolve(client)) } as unknown as pg.Pool;
    const kick = vi.fn();
    const stop = listenForEvents(pool, kick, vi.fn());
    await until(() => kick.mock.calls.length === 1);
    expect(client.queries).toEqual([`listen ${EVENTS_CHANNEL}`]);
    client.emit('notification', { channel: EVENTS_CHANNEL, payload: '' });
    client.emit('notification', { channel: 'other', payload: '' });
    expect(kick).toHaveBeenCalledTimes(2);
    await stop();
    expect(client.queries.at(-1)).toBe(`unlisten ${EVENTS_CHANNEL}`);
    expect(client.release).toHaveBeenCalledWith(undefined);
  });

  it('reconnects after a lost connection or a failed connect, until stopped', async () => {
    const broken = fakeClient();
    const healthy = fakeClient();
    const connect = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce(broken)
      .mockRejectedValueOnce(new Error('refused'))
      .mockResolvedValue(healthy);
    const log = vi.fn();
    const kick = vi.fn();
    const stop = listenForEvents({ connect } as unknown as pg.Pool, kick, log, 1);
    await until(() => kick.mock.calls.length === 1);
    const lost = new Error('reset');
    broken.emit('error', lost);
    broken.emit('error', lost); // released once only
    expect(broken.release).toHaveBeenCalledTimes(1);
    expect(broken.release).toHaveBeenCalledWith(lost);
    await until(() => kick.mock.calls.length === 2);
    expect(connect).toHaveBeenCalledTimes(3);
    expect(log.mock.calls).toEqual([
      ['error', 'event listener connection lost (Error)'],
      ['error', 'event listener could not listen (Error)'],
    ]);
    await stop();
    healthy.emit('error', new Error('after stop'));
    await new Promise((r) => setTimeout(r, 10));
    expect(connect).toHaveBeenCalledTimes(3);
  });

  it('gives up a connection whose LISTEN fails, and a connection that arrives after stop', async () => {
    const failing = fakeClient();
    failing.query.mockRejectedValueOnce(new Error('denied'));
    const late = fakeClient();
    let resolveLate: (c: unknown) => void = () => undefined;
    const connect = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce(failing)
      .mockImplementationOnce(() => new Promise((r) => (resolveLate = r)));
    const stop = listenForEvents({ connect } as unknown as pg.Pool, vi.fn(), vi.fn(), 1);
    await until(() => connect.mock.calls.length === 2);
    expect(failing.release).toHaveBeenCalledTimes(1);
    await stop();
    resolveLate(late);
    await tick();
    expect(late.release).toHaveBeenCalledWith(undefined);
    expect(late.query).not.toHaveBeenCalled();
  });
});

describe('runDaemon and runPass', () => {
  /** A graphile-worker runner double that runs until stop() is called. */
  function fakeRunner() {
    let finish: () => void = () => undefined;
    const runner = {
      promise: new Promise<void>((resolve) => (finish = resolve)),
      stop: vi.fn(() => {
        finish();
        return Promise.resolve();
      }),
      addJob: vi.fn(() => Promise.resolve({})),
    };
    return runner;
  }

  it('runDaemon handles no signals itself, kicks dispatches on notifications and stops on abort', async () => {
    const client = fakeClient();
    vi.spyOn(pg.Pool.prototype, 'connect').mockImplementation((() =>
      Promise.resolve(client)) as never);
    const runner = fakeRunner();
    graphile.run.mockResolvedValue(runner);
    const controller = new AbortController();
    const done = runDaemon(config(), controller.signal);
    await until(() => runner.addJob.mock.calls.length === 1);
    expect(graphile.run.mock.calls[0]?.[0]).toMatchObject({
      concurrency: 2,
      noHandleSignals: true,
    });
    expect(runner.addJob).toHaveBeenCalledWith(DISPATCH_TASK, {}, DISPATCH_JOB_OPTIONS);
    client.emit('notification', { channel: EVENTS_CHANNEL, payload: '' });
    await until(() => runner.addJob.mock.calls.length === 2);
    controller.abort();
    await done;
    // A notification during shutdown queues nothing.
    client.emit('notification', { channel: EVENTS_CHANNEL, payload: '' });
    expect(runner.addJob).toHaveBeenCalledTimes(2);
    expect(runner.stop).toHaveBeenCalledTimes(1);
    expect(client.queries.at(-1)).toBe(`unlisten ${EVENTS_CHANNEL}`);
  });

  it('runDaemon stops at once when the signal has already been aborted; stop failures are logged', async () => {
    vi.spyOn(pg.Pool.prototype, 'connect').mockImplementation((() =>
      Promise.resolve(fakeClient())) as never);
    const runner = fakeRunner();
    runner.stop.mockImplementationOnce(() => {
      runner.stop.getMockImplementation();
      return Promise.reject(new Error('busy'));
    });
    graphile.run.mockResolvedValue(runner);
    const log = vi.fn();
    const done = runDaemon(config(log), AbortSignal.abort());
    await until(() => log.mock.calls.length > 0);
    expect(log).toHaveBeenCalledWith('error', 'worker did not stop cleanly (Error)');
    // The runner ends on its own (e.g. a later stop) and the daemon returns.
    void runner.stop();
    await done;
  });

  it('runPass migrates, queues a dispatch, then runs every due job once', async () => {
    const utils = {
      migrate: vi.fn(() => Promise.resolve()),
      addJob: vi.fn(() => Promise.resolve({})),
      release: vi.fn(() => Promise.resolve()),
    };
    graphile.makeWorkerUtils.mockResolvedValue(utils);
    graphile.runOnce.mockResolvedValue(undefined);
    const query = vi
      .spyOn(pg.Pool.prototype, 'query')
      .mockResolvedValueOnce({ rows: [{ stale: '2' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);
    expect(await runPass(config())).toEqual({ staleEvents: 2 });
    expect(query.mock.calls[0]?.[1]).toEqual([10]);
    expect(await runPass(config())).toEqual({ staleEvents: 0 });
    expect(utils.migrate).toHaveBeenCalled();
    expect(utils.addJob).toHaveBeenCalledWith(DISPATCH_TASK, {}, DISPATCH_JOB_OPTIONS);
    expect(utils.release).toHaveBeenCalled();
    expect(graphile.runOnce).toHaveBeenCalledTimes(2);
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
