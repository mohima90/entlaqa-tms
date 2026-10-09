import { describe, expect, it, vi } from 'vitest';
import { platformTasks } from './platform-tasks';

const db = vi.hoisted(() => ({
  claimAccountMailRequest: vi.fn(),
  finishAccountMailRequest: vi.fn(),
  retryAccountMailRequest: vi.fn(),
  loadAccountMailContext: vi.fn(),
  tenantIsServed: vi.fn(),
  claimAccountAccessCheck: vi.fn(),
  finishAccountAccessCheck: vi.fn(),
  retryAccountAccessCheck: vi.fn(),
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

const noBans = () => ({ ban: vi.fn(), unban: vi.fn() });

describe('worker platform tasks (T-M2-17, T-M2-09)', () => {
  it('registers the account mailer; the Auth admin API and the account bans only when it is configured', () => {
    const issue = vi.fn(() => Promise.resolve({ status: 'unknown_account' as const }));
    const recoveryLinksFor = vi.fn(() => ({ issue }));
    const accountBansFor = vi.fn(noBans);
    const settings = { url: 'https://ref.supabase.co', secretKey: 'sb_secret_sample_only' };
    const withAdmin = platformTasks({
      ...deps,
      authAdmin: settings,
      recoveryLinksFor,
      accountBansFor,
    });
    expect(withAdmin.map((t) => t.name)).toEqual([
      'platform.account_mail',
      'platform.account_access',
    ]);
    expect(recoveryLinksFor).toHaveBeenCalledWith(settings);
    expect(accountBansFor).toHaveBeenCalledWith(settings);

    recoveryLinksFor.mockClear();
    accountBansFor.mockClear();
    const tasks = platformTasks({
      ...deps,
      authAdmin: undefined,
      recoveryLinksFor,
      accountBansFor,
    });
    expect(tasks.map((t) => t.name)).toEqual(['platform.account_mail']);
    expect(recoveryLinksFor).not.toHaveBeenCalled();
    expect(accountBansFor).not.toHaveBeenCalled();
  });

  it("runs the Auth admin key's expiry check before every pass of both tasks (it rate-limits itself)", async () => {
    db.claimAccountMailRequest.mockResolvedValue(null);
    db.claimAccountAccessCheck.mockResolvedValue(null);
    const adminKeyCheck = vi.fn();
    const [mail, access] = platformTasks({
      ...deps,
      authAdmin: { url: 'https://ref.supabase.co', secretKey: 'sb_secret_sample_only' },
      recoveryLinksFor: () => ({ issue: vi.fn() }),
      accountBansFor: noBans,
      adminKeyCheck,
    });
    expect(mail?.name).toBe('platform.account_mail');
    expect(access?.name).toBe('platform.account_access');
    await expect(mail?.run({ jobId: '1' })).resolves.toBe(false);
    await expect(mail?.run({ jobId: '2' })).resolves.toBe(false);
    await expect(access?.run({ jobId: '3' })).resolves.toBe(false);
    expect(adminKeyCheck).toHaveBeenCalledTimes(3);
    expect(db.claimAccountMailRequest).toHaveBeenCalledTimes(2);
    expect(db.claimAccountAccessCheck).toHaveBeenCalledTimes(1);
  });

  it('builds the real Auth admin clients by default (no network until a link or a ban is asked for)', () => {
    const tasks = platformTasks({
      ...deps,
      authAdmin: { url: 'https://ref.supabase.co', secretKey: 'sb_secret_sample_only' },
    });
    expect(tasks.map((t) => t.name)).toEqual(['platform.account_mail', 'platform.account_access']);
  });
});
