import { describe, expect, it, vi } from 'vitest';
import {
  type StatusAnswer,
  type StatusPollerDeps,
  readImportStatus,
  startStatusPoller,
} from './import-polling';

/** Timers by hand: `fire()` runs the one scheduled tick. */
function fakePage(answers: StatusAnswer[]) {
  let pending: (() => void) | null = null;
  let visible = true;
  const reads: number[] = [];
  const deps = {
    read: vi.fn((): Promise<StatusAnswer> => {
      reads.push(1);
      return Promise.resolve(answers.shift() ?? { kind: 'error' });
    }),
    refresh: vi.fn((): void => undefined),
    visible: () => visible,
    schedule: vi.fn((fn: () => void, ms: number) => {
      expect(ms).toBe(3000);
      pending = fn;
      return () => {
        if (pending === fn) pending = null;
      };
    }),
  } satisfies StatusPollerDeps;
  return {
    deps,
    reads,
    scheduled: () => pending !== null,
    hide: (hidden: boolean) => {
      visible = !hidden;
    },
    async fire() {
      const fn = pending;
      pending = null;
      fn?.();
      // Let the read and the decision after it run.
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

const v = (version: string): StatusAnswer => ({ kind: 'version', version });

describe('the import page poller (integration review L1)', () => {
  it('refreshes the page only when the version changed — otherwise it only reads', async () => {
    const page = fakePage([v('a'), v('a'), v('b')]);
    startStatusPoller(page.deps, { seconds: 3, version: 'a' });
    await page.fire();
    await page.fire();
    expect(page.deps.refresh).not.toHaveBeenCalled();
    await page.fire();
    expect(page.deps.refresh).toHaveBeenCalledOnce();
    expect(page.scheduled()).toBe(true);
  });

  it('asks nothing while the tab is hidden', async () => {
    const page = fakePage([v('b')]);
    startStatusPoller(page.deps, { seconds: 3, version: 'a' });
    page.hide(true);
    await page.fire();
    await page.fire();
    expect(page.reads).toHaveLength(0);
    expect(page.scheduled()).toBe(true);
    page.hide(false);
    await page.fire();
    expect(page.reads).toHaveLength(1);
    expect(page.deps.refresh).toHaveBeenCalledOnce();
  });

  it('pauses while the inactivity warning is shown, and resumes when the member stays', async () => {
    const page = fakePage([v('a'), v('a')]);
    const poller = startStatusPoller(page.deps, { seconds: 3, version: 'a' });
    poller.pause();
    expect(page.scheduled()).toBe(false);
    await page.fire();
    expect(page.reads).toHaveLength(0);
    poller.resume();
    expect(page.scheduled()).toBe(true);
    await page.fire();
    expect(page.reads).toHaveLength(1);
  });

  it('a read that ends while paused changes nothing and schedules nothing', async () => {
    let answer: (a: StatusAnswer) => void = () => undefined;
    const page = fakePage([]);
    const deps = {
      ...page.deps,
      read: () =>
        new Promise<StatusAnswer>((resolve) => {
          answer = resolve;
        }),
    };
    const poller = startStatusPoller(deps, { seconds: 3, version: 'a' });
    await page.fire();
    poller.pause();
    answer(v('b'));
    await Promise.resolve();
    await Promise.resolve();
    expect(page.deps.refresh).not.toHaveBeenCalled();
    expect(page.scheduled()).toBe(false);
  });

  it('stops for good when the import is gone or the session ended (one refresh lets the page decide)', async () => {
    const page = fakePage([{ kind: 'gone' }]);
    const poller = startStatusPoller(page.deps, { seconds: 3, version: 'a' });
    await page.fire();
    expect(page.deps.refresh).toHaveBeenCalledOnce();
    expect(page.scheduled()).toBe(false);
    poller.resume();
    expect(page.scheduled()).toBe(false);
  });

  it('keeps asking after a network or server error, without refreshing', async () => {
    const page = fakePage([{ kind: 'error' }, v('a')]);
    startStatusPoller(page.deps, { seconds: 3, version: 'a' });
    await page.fire();
    await page.fire();
    expect(page.reads).toHaveLength(2);
    expect(page.deps.refresh).not.toHaveBeenCalled();
  });

  it('stop() cancels the next read', async () => {
    const page = fakePage([v('b')]);
    const poller = startStatusPoller(page.deps, { seconds: 3, version: 'a' });
    poller.stop();
    await page.fire();
    expect(page.reads).toHaveLength(0);
  });
});

describe('readImportStatus', () => {
  const answer = (init: { status: number; body?: unknown; type?: ResponseType }) =>
    vi.fn(() =>
      Promise.resolve({
        status: init.status,
        ok: init.status >= 200 && init.status < 300,
        type: init.type ?? 'basic',
        json: () =>
          init.body === undefined ? Promise.reject(new Error('no json')) : Promise.resolve(init.body),
      } as Response),
    );

  it('reads the version without following redirects or caching', async () => {
    const fetcher = answer({ status: 200, body: { version: 'abc' } });
    expect(await readImportStatus('/ar/x/status', fetcher)).toEqual({ kind: 'version', version: 'abc' });
    expect(fetcher).toHaveBeenCalledWith('/ar/x/status', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      redirect: 'manual',
    });
  });

  it('gone: 401, 403, 404 or a redirect; error: anything else', async () => {
    for (const status of [401, 403, 404]) {
      expect(await readImportStatus('/s', answer({ status }))).toEqual({ kind: 'gone' });
    }
    expect(await readImportStatus('/s', answer({ status: 0, type: 'opaqueredirect' }))).toEqual({
      kind: 'gone',
    });
    expect(await readImportStatus('/s', answer({ status: 500 }))).toEqual({ kind: 'error' });
    expect(await readImportStatus('/s', answer({ status: 200 }))).toEqual({ kind: 'error' });
    expect(await readImportStatus('/s', answer({ status: 200, body: { version: 1 } }))).toEqual({
      kind: 'error',
    });
    expect(
      await readImportStatus('/s', vi.fn(() => Promise.reject(new Error('offline')))),
    ).toEqual({ kind: 'error' });
  });
});
