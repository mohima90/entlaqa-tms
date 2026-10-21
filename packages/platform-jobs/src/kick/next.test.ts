import { describe, expect, it, vi } from 'vitest';
import { createAfterResponseKick, kickWorkerAfterResponse, kicksWorker } from './next';

describe('createAfterResponseKick', () => {
  it('schedules the request for after the response (it does not run before)', async () => {
    const tasks: (() => Promise<unknown>)[] = [];
    const request = vi.fn(() => Promise.resolve('dispatched'));
    const kick = createAfterResponseKick({
      schedule: (task) => tasks.push(task),
      configured: () => true,
      request,
    });
    kick('action:platform.iam.invite');
    expect(request).not.toHaveBeenCalled();
    expect(tasks).toHaveLength(1);
    await tasks[0]?.();
    expect(request).toHaveBeenCalledWith('action:platform.iam.invite');
  });

  it('schedules nothing without a token', () => {
    const schedule = vi.fn();
    const request = vi.fn(() => Promise.resolve('off'));
    createAfterResponseKick({ schedule, configured: () => false, request })('cron');
    expect(schedule).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('outside a request scope (after() refuses): asks at once instead', () => {
    const request = vi.fn(() => Promise.resolve('dispatched'));
    const kick = createAfterResponseKick({
      schedule: () => {
        throw new Error('`after` was called outside a request scope');
      },
      configured: () => true,
      request,
    });
    expect(() => {
      kick('cron');
    }).not.toThrow();
    expect(request).toHaveBeenCalledWith('cron');
  });

  it('the default kick is a no-op without the dispatch App settings', () => {
    vi.stubEnv('JOBS_DISPATCH_APP_ID', '');
    vi.stubEnv('JOBS_DISPATCH_APP_PRIVATE_KEY', '');
    vi.stubEnv('JOBS_DISPATCH_INSTALLATION_ID', '');
    try {
      expect(() => {
        kickWorkerAfterResponse('cron');
      }).not.toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('kicksWorker', () => {
  it('kicks once the wrapped call has returned, with its result passed on', async () => {
    const order: string[] = [];
    const kick = vi.fn((reason: string) => order.push(`kick:${reason}`));
    const queue = kicksWorker(
      'account_mail',
      (email: string) => {
        order.push(`queue:${email}`);
        return Promise.resolve(42);
      },
      kick,
    );
    await expect(queue('a@example.com')).resolves.toBe(42);
    expect(order).toEqual(['queue:a@example.com', 'kick:account_mail']);
  });

  it('a failed call asks for nothing and passes the error on', async () => {
    const kick = vi.fn();
    const queue = kicksWorker('account_mail', () => Promise.reject(new Error('db down')), kick);
    await expect(queue()).rejects.toThrow('db down');
    expect(kick).not.toHaveBeenCalled();
  });
});
