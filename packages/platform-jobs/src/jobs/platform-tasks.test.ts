import type { JobHelpers } from 'graphile-worker';
import { describe, expect, it, vi } from 'vitest';
import { JobError } from './errors';
import { assertPlatformTasks, platformJobOptions, platformTaskRunner } from './platform-tasks';

function helpers(id = '42') {
  const addJob = vi.fn(() => Promise.resolve({}));
  return { addJob, helpers: { job: { id }, addJob } as unknown as JobHelpers };
}

describe('platform tasks (ADR 0005 §4, T-M2-17)', () => {
  it('runs a pass with the job id; queues another pass at once when work is left', async () => {
    const run = vi.fn(() => Promise.resolve(true));
    const task = { name: 'platform.account_mail', run };
    const busy = helpers();
    await platformTaskRunner(task)({}, busy.helpers);
    expect(run).toHaveBeenCalledWith({ jobId: 'platform.account_mail:42' });
    expect(busy.addJob).toHaveBeenCalledWith('platform.account_mail', {}, platformJobOptions(task));

    const idle = helpers();
    await platformTaskRunner({ name: 'platform.account_mail', run: () => Promise.resolve(false) })(
      {},
      idle.helpers,
    );
    expect(idle.addJob).not.toHaveBeenCalled();
  });

  it('a failed pass reaches graphile-worker without its message (it may carry data)', async () => {
    const task = {
      name: 'platform.account_mail',
      run: () => Promise.reject(new Error('could not mail sara@example.test')),
    };
    const error = await Promise.resolve(platformTaskRunner(task)({}, helpers().helpers)).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(JobError);
    expect((error as Error).message).toBe('platform.account_mail failed: Error');
  });

  it('one pending job per task (job key = its name), a few attempts', () => {
    expect(platformJobOptions({ name: 'platform.x', run: () => Promise.resolve(false) })).toEqual({
      jobKey: 'platform.x',
      jobKeyMode: 'preserve_run_at',
      maxAttempts: 5,
    });
  });

  it('checks names: dotted lower-case, unique, not a built-in task', () => {
    const run = () => Promise.resolve(false);
    expect(() => {
      assertPlatformTasks([{ name: 'platform.a', run }], ['platform.events.dispatch']);
    }).not.toThrow();
    for (const name of ['platform', 'Platform.a', 'platform.a b', `platform.${'a'.repeat(100)}`]) {
      expect(() => {
        assertPlatformTasks([{ name, run }], []);
      }).toThrow('invalid');
    }
    expect(() => {
      assertPlatformTasks(
        [{ name: 'platform.events.dispatch', run }],
        ['platform.events.dispatch'],
      );
    }).toThrow('registered twice');
  });
});
