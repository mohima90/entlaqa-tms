import type { SystemTx } from '@jadarat/platform-db/jobs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SESSION_PURGE_BATCH,
  SESSION_PURGE_INTERVAL_MS,
  SESSION_PURGE_TASK,
  createSessionPurger,
} from './index';

const db = vi.hoisted(() => ({ purgeEndedSessions: vi.fn() }));
vi.mock('@jadarat/platform-db/jobs', () => db);

const platformTx = { kind: 'platform' } as unknown as SystemTx;

function setup() {
  let clock = 1_000_000;
  const log = vi.fn();
  const withPlatformTx = vi.fn((_actor: { jobId: string }, fn: (tx: SystemTx) => unknown) =>
    Promise.resolve(fn(platformTx)),
  );
  const task = createSessionPurger({
    withPlatformTx: withPlatformTx as never,
    log,
    now: () => clock,
  });
  return {
    task,
    log,
    withPlatformTx,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('session purger (T-M2-10, review M1): ended sessions leave Auth', () => {
  it('a platform task that asks the database for a batch, logging the count only', async () => {
    db.purgeEndedSessions.mockResolvedValueOnce(3);
    const { task, log, withPlatformTx } = setup();
    expect(task.name).toBe(SESSION_PURGE_TASK);
    expect(await task.run({ jobId: 'j1' })).toBe(false);
    expect(withPlatformTx).toHaveBeenCalledWith({ jobId: 'j1' }, expect.any(Function));
    expect(db.purgeEndedSessions).toHaveBeenCalledWith(platformTx, SESSION_PURGE_BATCH);
    expect(log).toHaveBeenCalledWith('info', 'ended sessions removed from Auth (3)');
  });

  it('a full batch asks for another pass at once; caught up, it waits a minute', async () => {
    db.purgeEndedSessions.mockResolvedValueOnce(SESSION_PURGE_BATCH).mockResolvedValue(0);
    const { task, log, advance } = setup();
    expect(await task.run({ jobId: 'j' })).toBe(true);
    expect(await task.run({ jobId: 'j' })).toBe(false);
    expect(db.purgeEndedSessions).toHaveBeenCalledTimes(2);
    // Wake-ups within the minute do not reach the database.
    advance(SESSION_PURGE_INTERVAL_MS - 1);
    expect(await task.run({ jobId: 'j' })).toBe(false);
    expect(db.purgeEndedSessions).toHaveBeenCalledTimes(2);
    advance(1);
    expect(await task.run({ jobId: 'j' })).toBe(false);
    expect(db.purgeEndedSessions).toHaveBeenCalledTimes(3);
    // Nothing removed: nothing logged.
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('a database failure fails the pass (graphile-worker retries) and does not count as caught up', async () => {
    db.purgeEndedSessions.mockRejectedValueOnce(new Error('db down')).mockResolvedValue(0);
    const { task } = setup();
    await expect(task.run({ jobId: 'j' })).rejects.toThrow('db down');
    expect(await task.run({ jobId: 'j' })).toBe(false);
    expect(db.purgeEndedSessions).toHaveBeenCalledTimes(2);
  });
});
