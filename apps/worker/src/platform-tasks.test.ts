import { describe, expect, it, vi } from 'vitest';
import { platformTasks } from './platform-tasks';

const db = vi.hoisted(() => ({
  claimAccountMailRequest: vi.fn(),
  finishAccountMailRequest: vi.fn(),
  retryAccountMailRequest: vi.fn(),
  loadAccountMailContext: vi.fn(),
  tenantIsServed: vi.fn(),
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

describe('worker platform tasks (T-M2-17)', () => {
  it('registers the account mailer; the Auth admin API only when it is configured', () => {
    const issue = vi.fn(() => Promise.resolve({ status: 'unknown_account' as const }));
    const recoveryLinksFor = vi.fn(() => ({ issue }));
    const settings = { url: 'https://ref.supabase.co', secretKey: 'sb_secret_sample_only' };
    const [task] = platformTasks({ ...deps, authAdmin: settings, recoveryLinksFor });
    expect(task?.name).toBe('platform.account_mail');
    expect(recoveryLinksFor).toHaveBeenCalledWith(settings);

    recoveryLinksFor.mockClear();
    const tasks = platformTasks({ ...deps, authAdmin: undefined, recoveryLinksFor });
    expect(tasks.map((t) => t.name)).toEqual(['platform.account_mail']);
    expect(recoveryLinksFor).not.toHaveBeenCalled();
  });

  it('builds the real Auth admin client by default (no network until a link is asked for)', () => {
    const [task] = platformTasks({
      ...deps,
      authAdmin: { url: 'https://ref.supabase.co', secretKey: 'sb_secret_sample_only' },
    });
    expect(task?.name).toBe('platform.account_mail');
  });
});
