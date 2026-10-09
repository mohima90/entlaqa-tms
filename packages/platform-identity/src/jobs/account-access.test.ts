import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_ACCESS_BATCH,
  ACCOUNT_ACCESS_TASK,
  type AccountBanApi,
  createAccountAccessTask,
} from './account-access';

const db = vi.hoisted(() => ({
  claimAccountAccessCheck: vi.fn(),
  finishAccountAccessCheck: vi.fn(),
  retryAccountAccessCheck: vi.fn(),
}));
vi.mock('@jadarat/platform-db/jobs', () => db);

const USER = '9d000000-0000-4000-8000-000000000001';
const AT = '2026-10-11 10:00:00.123456+00';
const check = (action: 'ban' | 'unban' | 'none', attempt = 1) => ({
  userId: USER,
  action,
  requestedAt: AT,
  attempt,
});

const withPlatformTx = vi.fn((_actor: { jobId: string }, fn: (tx: unknown) => unknown) =>
  Promise.resolve(fn('platform-tx')),
);
const log = vi.fn();

function task(bans: Partial<AccountBanApi> = {}) {
  const api: AccountBanApi = {
    ban: vi.fn(() => Promise.resolve({ status: 'done' as const })),
    unban: vi.fn(() => Promise.resolve({ status: 'done' as const })),
    ...bans,
  };
  return {
    task: createAccountAccessTask({ bans: api, withPlatformTx: withPlatformTx as never, log }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.finishAccountAccessCheck.mockResolvedValue(true);
  db.retryAccountAccessCheck.mockResolvedValue(1);
});

describe('Auth bans (platform task, T-M2-09)', () => {
  it('bans and unbans as the database decided, records the outcome, logs no account', async () => {
    db.claimAccountAccessCheck
      .mockResolvedValueOnce(check('ban'))
      .mockResolvedValueOnce(check('unban'))
      .mockResolvedValueOnce(check('none'))
      .mockResolvedValueOnce(null);
    const ban = vi.fn(() => Promise.resolve({ status: 'done' as const }));
    const unban = vi.fn(() => Promise.resolve({ status: 'done' as const }));
    const { task: t } = task({ ban, unban });
    expect(t.name).toBe(ACCOUNT_ACCESS_TASK);
    await expect(t.run({ jobId: 'job-1' })).resolves.toBe(false);
    expect(ban).toHaveBeenCalledWith(USER);
    expect(unban).toHaveBeenCalledWith(USER);
    expect(db.finishAccountAccessCheck.mock.calls.map((c: unknown[]) => c[2])).toEqual([
      'banned',
      'unbanned',
      'unchanged',
    ]);
    expect(db.finishAccountAccessCheck).toHaveBeenCalledWith('platform-tx', check('ban'), 'banned');
    expect(withPlatformTx).toHaveBeenCalledWith({ jobId: 'job-1' }, expect.any(Function));
    for (const [, message] of log.mock.calls as [string, string][])
      expect(message).not.toContain(USER);
  });

  it('an account Auth no longer has: gone (our record of it is dropped)', async () => {
    db.claimAccountAccessCheck.mockResolvedValueOnce(check('ban')).mockResolvedValueOnce(null);
    const { task: t } = task({
      ban: vi.fn(() => Promise.resolve({ status: 'unknown_account' as const })),
    });
    await t.run({ jobId: 'j' });
    expect(db.finishAccountAccessCheck).toHaveBeenCalledWith('platform-tx', check('ban'), 'gone');
  });

  it('changed while Auth answered: says so (the database decides again at once)', async () => {
    db.claimAccountAccessCheck.mockResolvedValueOnce(check('ban')).mockResolvedValueOnce(null);
    db.finishAccountAccessCheck.mockResolvedValue(false);
    await task().task.run({ jobId: 'j' });
    expect(log).toHaveBeenCalledWith(
      'info',
      'account access: banned (changed meanwhile: decided again)',
    );
  });

  it('temporary failures are retried (an error log from the 5th attempt); refusals close the check', async () => {
    db.claimAccountAccessCheck
      .mockResolvedValueOnce(check('ban'))
      .mockResolvedValueOnce(check('ban', 5))
      .mockResolvedValueOnce(check('unban'))
      .mockResolvedValueOnce(null);
    db.retryAccountAccessCheck.mockResolvedValueOnce(1).mockResolvedValueOnce(5);
    const temporary = Object.assign(new Error('Auth admin request failed'), {
      code: 'AUTH_HTTP_503',
      temporary: true,
    });
    const refused = Object.assign(new Error('Auth admin request failed'), {
      code: 'validation_failed',
      temporary: false,
    });
    const { task: t } = task({
      ban: vi.fn(() => Promise.reject(temporary)),
      unban: vi.fn(() => Promise.reject(refused)),
    });
    await t.run({ jobId: 'j' });
    expect(db.retryAccountAccessCheck).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(
      'warning',
      'account ban failed (AUTH_HTTP_503); retried later (attempt 1)',
    );
    expect(log).toHaveBeenCalledWith(
      'error',
      'account ban failed (AUTH_HTTP_503); retried later (attempt 5)',
    );
    expect(db.finishAccountAccessCheck).toHaveBeenCalledWith(
      'platform-tx',
      check('unban'),
      'refused',
    );
    expect(log).toHaveBeenCalledWith('error', 'account unban refused by Auth (validation_failed)');
    // An error without our shape (e.g. the network) counts as temporary.
    db.claimAccountAccessCheck.mockResolvedValueOnce(check('ban')).mockResolvedValueOnce(null);
    await task({ ban: vi.fn(() => Promise.reject(new TypeError('fetch failed'))) }).task.run({
      jobId: 'j',
    });
    expect(log).toHaveBeenLastCalledWith(
      'warning',
      'account ban failed (TypeError); retried later (attempt 1)',
    );
  });

  it('a full batch asks for another pass at once', async () => {
    db.claimAccountAccessCheck.mockResolvedValue(check('none'));
    await expect(task().task.run({ jobId: 'j' })).resolves.toBe(true);
    expect(db.claimAccountAccessCheck).toHaveBeenCalledTimes(ACCOUNT_ACCESS_BATCH);
  });
});
