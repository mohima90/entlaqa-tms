import type { SystemTx } from '@jadarat/platform-db/jobs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TRIAL_EXPIRY_INTERVAL_MS, TRIAL_EXPIRY_TASK, createTrialExpiry } from './index';

const db = vi.hoisted(() => ({ expireTrials: vi.fn() }));
vi.mock('@jadarat/platform-db/jobs', () => db);

const platformTx = { kind: 'platform' } as unknown as SystemTx;

function setup() {
  let clock = 1_000_000;
  const log = vi.fn();
  const withPlatformTx = vi.fn((_actor: { jobId: string }, fn: (tx: SystemTx) => unknown) =>
    Promise.resolve(fn(platformTx)),
  );
  const task = createTrialExpiry({ withPlatformTx: withPlatformTx as never, log, now: () => clock });
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

describe('trial expiry (WP-ADM-06): a trial ends on its date', () => {
  it('a platform task that asks the database, logging the count only', async () => {
    db.expireTrials.mockResolvedValueOnce(2);
    const { task, log, withPlatformTx } = setup();
    expect(task.name).toBe(TRIAL_EXPIRY_TASK);
    expect(await task.run({ jobId: 'j1' })).toBe(false);
    expect(withPlatformTx).toHaveBeenCalledWith({ jobId: 'j1' }, expect.any(Function));
    expect(db.expireTrials).toHaveBeenCalledWith(platformTx);
    expect(log).toHaveBeenCalledWith('info', 'trials ended, organizations suspended (2)');
  });

  it('nothing ended: no log line', async () => {
    db.expireTrials.mockResolvedValueOnce(0);
    const { task, log } = setup();
    await task.run({ jobId: 'j1' });
    expect(log).not.toHaveBeenCalled();
  });

  it('at most every ten minutes per worker process', async () => {
    db.expireTrials.mockResolvedValue(0);
    const { task, advance } = setup();
    await task.run({ jobId: 'j1' });
    advance(TRIAL_EXPIRY_INTERVAL_MS - 1);
    await task.run({ jobId: 'j2' });
    expect(db.expireTrials).toHaveBeenCalledTimes(1);
    advance(1);
    await task.run({ jobId: 'j3' });
    expect(db.expireTrials).toHaveBeenCalledTimes(2);
  });
});
