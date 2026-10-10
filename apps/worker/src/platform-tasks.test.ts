import { describe, expect, it, vi } from 'vitest';
import { platformTasks } from './platform-tasks';

const db = vi.hoisted(() => ({
  claimAccountMailRequest: vi.fn(),
  finishAccountMailRequest: vi.fn(),
  retryAccountMailRequest: vi.fn(),
  loadAccountMailContext: vi.fn(),
  tenantIsServed: vi.fn(),
  purgeEndedSessions: vi.fn(),
  purgeUnconfirmedMfaApps: vi.fn(),
}));
vi.mock('@jadarat/platform-db/jobs', () => db);

const deps = {
  appBaseUrl: 'https://tms.example.com',
  withPlatformTx: ((_actor: unknown, fn: (tx: unknown) => unknown) =>
    Promise.resolve(fn({}))) as never,
  withSystemTx: ((_actor: unknown, fn: (tx: unknown) => unknown) =>
    Promise.resolve(fn({}))) as never,
  log: vi.fn(),
};

describe('worker platform tasks (T-M2-17, T-M2-10)', () => {
  it('removes ended sessions from Auth (review M1) and unconfirmed apps (re-review N2), with or without the admin key check', async () => {
    db.purgeEndedSessions.mockResolvedValue(0);
    db.purgeUnconfirmedMfaApps.mockResolvedValue(0);
    for (const adminKeyCheck of [undefined, vi.fn()]) {
      const tasks = platformTasks({ ...deps, authAdmin: undefined, adminKeyCheck });
      const purger = tasks.find((t) => t.name === 'platform.session_purge');
      await expect(purger?.run({ jobId: 'p' })).resolves.toBe(false);
    }
    expect(db.purgeEndedSessions).toHaveBeenCalledTimes(2);
    expect(db.purgeUnconfirmedMfaApps).toHaveBeenCalledTimes(2);
  });

  it('registers the account mailer; the Auth admin API only when it is configured', () => {
    const issue = vi.fn(() => Promise.resolve({ status: 'unknown_account' as const }));
    const recoveryLinksFor = vi.fn(() => ({ issue }));
    const settings = { url: 'https://ref.supabase.co', secretKey: 'sb_secret_sample_only' };
    const [task] = platformTasks({ ...deps, authAdmin: settings, recoveryLinksFor });
    expect(task?.name).toBe('platform.account_mail');
    expect(recoveryLinksFor).toHaveBeenCalledWith(settings);

    recoveryLinksFor.mockClear();
    const tasks = platformTasks({ ...deps, authAdmin: undefined, recoveryLinksFor });
    expect(tasks.map((t) => t.name)).toEqual(['platform.account_mail', 'platform.session_purge']);
    expect(recoveryLinksFor).not.toHaveBeenCalled();
  });

  it("runs the Auth admin key's expiry check before every account-mail pass (it rate-limits itself)", async () => {
    db.claimAccountMailRequest.mockResolvedValue(null);
    const adminKeyCheck = vi.fn();
    const [task] = platformTasks({
      ...deps,
      authAdmin: { url: 'https://ref.supabase.co', secretKey: 'sb_secret_sample_only' },
      recoveryLinksFor: () => ({ issue: vi.fn() }),
      adminKeyCheck,
    });
    expect(task?.name).toBe('platform.account_mail');
    await expect(task?.run({ jobId: '1' })).resolves.toBe(false);
    await expect(task?.run({ jobId: '2' })).resolves.toBe(false);
    expect(adminKeyCheck).toHaveBeenCalledTimes(2);
    expect(db.claimAccountMailRequest).toHaveBeenCalledTimes(2);
  });

  it('builds the real Auth admin client by default (no network until a link is asked for)', () => {
    const [task] = platformTasks({
      ...deps,
      authAdmin: { url: 'https://ref.supabase.co', secretKey: 'sb_secret_sample_only' },
    });
    expect(task?.name).toBe('platform.account_mail');
  });
});
