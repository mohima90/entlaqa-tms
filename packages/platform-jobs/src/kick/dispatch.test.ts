import type { Logger } from '@jadarat/platform-observability';
import { describe, expect, it, vi } from 'vitest';
import {
  MIN_INTERVAL_MS,
  createWorkerKick,
  dispatchUrl,
  readWorkerKickSettings,
  requestWorkerPass,
  workerKickConfigured,
} from './dispatch';

const TOKEN = 'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ';
const ENV = { JOBS_DISPATCH_TOKEN: TOKEN, JOBS_DISPATCH_REPO: 'mohima90/entlaqa-tms' };

function recordingLogger() {
  const lines: { level: string; message: string; fields: unknown }[] = [];
  const logger: Logger = {
    info: (message, fields) => lines.push({ level: 'info', message, fields }),
    warn: (message, fields) => lines.push({ level: 'warn', message, fields }),
    error: (message, fields) => lines.push({ level: 'error', message, fields }),
  };
  return { logger, lines };
}

function setup(
  options: {
    env?: Record<string, string | undefined>;
    respond?: (url: string, init: RequestInit) => Promise<Response>;
    timeoutMs?: number;
  } = {},
) {
  let clock = 1_000_000;
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = vi.fn((input: string, init?: RequestInit) => {
    const url = input;
    calls.push({ url, init: init ?? {} });
    return options.respond
      ? options.respond(url, init ?? {})
      : Promise.resolve(new Response(null, { status: 204 }));
  });
  const { logger, lines } = recordingLogger();
  const kick = createWorkerKick({
    env: () => options.env ?? ENV,
    fetch: fetchFn as unknown as typeof fetch,
    now: () => clock,
    log: logger,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  return {
    kick,
    calls,
    lines,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('readWorkerKickSettings', () => {
  it('is off without a token (self-hosted, local development)', () => {
    expect(readWorkerKickSettings({})).toEqual({ kind: 'off' });
    expect(readWorkerKickSettings({ JOBS_DISPATCH_TOKEN: '  ' })).toEqual({ kind: 'off' });
  });

  it('reads token, repository and the defaults (jobs.yml on main)', () => {
    expect(readWorkerKickSettings(ENV)).toEqual({
      kind: 'on',
      config: { token: TOKEN, repo: 'mohima90/entlaqa-tms', workflow: 'jobs.yml', ref: 'main' },
    });
    expect(
      readWorkerKickSettings({
        ...ENV,
        JOBS_DISPATCH_WORKFLOW: 'other-jobs.yaml',
        JOBS_DISPATCH_REF: 'release/r1',
      }),
    ).toMatchObject({ config: { workflow: 'other-jobs.yaml', ref: 'release/r1' } });
  });

  it.each([
    ['JOBS_DISPATCH_REPO', undefined],
    ['JOBS_DISPATCH_REPO', 'entlaqa-tms'],
    ['JOBS_DISPATCH_REPO', 'evil.example.com/x'],
    ['JOBS_DISPATCH_REPO', 'owner/../../users'],
    ['JOBS_DISPATCH_REPO', 'owner/..'],
    ['JOBS_DISPATCH_REPO', 'https://evil.example/owner/repo'],
    ['JOBS_DISPATCH_REPO', 'owner/repo?x=1'],
    ['JOBS_DISPATCH_REPO', 'owner/repo#x'],
    ['JOBS_DISPATCH_REPO', '@evil.example/repo'],
    ['JOBS_DISPATCH_WORKFLOW', '../jobs.yml'],
    ['JOBS_DISPATCH_WORKFLOW', 'jobs'],
    ['JOBS_DISPATCH_WORKFLOW', 'dir/jobs.yml'],
    ['JOBS_DISPATCH_REF', '../main'],
    ['JOBS_DISPATCH_REF', 'a..b'],
    ['JOBS_DISPATCH_REF', '-main'],
    ['JOBS_DISPATCH_REF', 'main/'],
    ['JOBS_DISPATCH_REF', 'main branch'],
  ])('refuses %s=%s (names the setting, never its value)', (name, value) => {
    const settings = readWorkerKickSettings({ ...ENV, [name]: value });
    expect(settings).toEqual({ kind: 'invalid', problem: name });
  });

  it.each(['short', `${TOKEN}\nx-injected: 1`, `${TOKEN} `.repeat(2), 'tok-with-dash-0123456789'])(
    'refuses a malformed token',
    (token) => {
      expect(readWorkerKickSettings({ ...ENV, JOBS_DISPATCH_TOKEN: token })).toEqual({
        kind: 'invalid',
        problem: 'JOBS_DISPATCH_TOKEN',
      });
    },
  );
});

describe('dispatchUrl', () => {
  it('always targets api.github.com', () => {
    expect(dispatchUrl({ repo: 'mohima90/entlaqa-tms', workflow: 'jobs.yml' })).toBe(
      'https://api.github.com/repos/mohima90/entlaqa-tms/actions/workflows/jobs.yml/dispatches',
    );
  });
});

describe('createWorkerKick', () => {
  it('no token → no call, no log', async () => {
    const { kick, calls, lines } = setup({ env: {} });
    expect(kick.configured()).toBe(false);
    expect(await kick.request('cron')).toBe('off');
    expect(calls).toHaveLength(0);
    expect(lines).toHaveLength(0);
  });

  it('dispatches jobs.yml on main with the GitHub headers and body', async () => {
    const { kick, calls, lines } = setup();
    expect(kick.configured()).toBe(true);
    expect(await kick.request('action:platform.iam.invite')).toBe('dispatched');
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(
      'https://api.github.com/repos/mohima90/entlaqa-tms/actions/workflows/jobs.yml/dispatches',
    );
    expect(call?.init.method).toBe('POST');
    expect(call?.init.headers).toMatchObject({
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${TOKEN}`,
      'x-github-api-version': '2022-11-28',
    });
    expect(typeof call?.init.body).toBe('string');
    expect(JSON.parse(call?.init.body as string)).toEqual({ ref: 'main' });
    expect(call?.init.redirect).toBe('error');
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
    expect(lines).toEqual([
      {
        level: 'info',
        message: 'worker pass requested',
        fields: expect.objectContaining({
          action: 'platform.jobs.request_pass',
          reason: 'action:platform.iam.invite',
          status: 204,
          outcome: 'success',
        }),
      },
    ]);
  });

  it('throttles: one dispatch per minute per instance, then again', async () => {
    const { kick, calls, advance } = setup();
    const burst = await Promise.all([kick.request('a'), kick.request('b'), kick.request('c')]);
    expect(burst).toEqual(['dispatched', 'throttled', 'throttled']);
    advance(MIN_INTERVAL_MS - 1);
    expect(await kick.request('d')).toBe('throttled');
    advance(1);
    expect(await kick.request('e')).toBe('dispatched');
    expect(calls).toHaveLength(2);
  });

  it('a refused dispatch (non-2xx) is a warning with the status, never the body', async () => {
    const { kick, lines } = setup({
      respond: () =>
        Promise.resolve(new Response(`{"message":"Bad credentials ${TOKEN}"}`, { status: 401 })),
    });
    expect(await kick.request('cron')).toBe('failed');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'warn',
      fields: { status: 401, errorCode: 'github_http_401', outcome: 'failure' },
    });
  });

  it('a timeout is handled (never thrown) and reported as such', async () => {
    const { kick, lines } = setup({
      timeoutMs: 5,
      respond: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason as Error);
          });
        }),
    });
    expect(await kick.request('cron')).toBe('timeout');
    expect(lines[0]).toMatchObject({
      level: 'warn',
      fields: { errorCode: 'timeout', errorName: 'TimeoutError' },
    });
  });

  it('a network error is handled and logged by class only', async () => {
    const { kick, lines } = setup({
      respond: () => Promise.reject(new TypeError(`fetch failed for Bearer ${TOKEN}`)),
    });
    expect(await kick.request('cron')).toBe('failed');
    expect(lines[0]).toMatchObject({ fields: { errorCode: 'network', errorName: 'TypeError' } });
  });

  it('never logs the token, whatever happens', async () => {
    for (const respond of [
      () => Promise.resolve(new Response(null, { status: 204 })),
      () => Promise.resolve(new Response(TOKEN, { status: 500 })),
      () => Promise.reject(new Error(TOKEN)),
    ]) {
      const { kick, lines } = setup({ respond });
      await kick.request('cron');
      expect(JSON.stringify(lines)).not.toContain(TOKEN);
      expect(JSON.stringify(lines)).not.toContain('github_pat_');
    }
  });

  it('invalid configuration: no call, one error per instance naming the setting only', async () => {
    const env = { ...ENV, JOBS_DISPATCH_REPO: 'evil.example.com/x' };
    const { kick, calls, lines } = setup({ env });
    expect(await kick.request('cron')).toBe('invalid_config');
    expect(await kick.request('cron')).toBe('invalid_config');
    expect(calls).toHaveLength(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'error',
      message: 'worker pass not requested: JOBS_DISPATCH_REPO is invalid',
      fields: { reason: 'jobs_dispatch_config_invalid' },
    });
    expect(JSON.stringify(lines)).not.toContain('evil.example.com');
  });

  it('logs an unexpected reason as `other`', async () => {
    const { kick, lines } = setup();
    await kick.request('Has Spaces <and> personal@example.com');
    expect(lines[0]).toMatchObject({ fields: { reason: 'other' } });
  });

  it('never rejects, even when the logger throws', async () => {
    const kick = createWorkerKick({
      env: () => ENV,
      fetch: () => Promise.resolve(new Response(null, { status: 204 })),
      log: {
        info: () => {
          throw new Error('logger down');
        },
        warn: () => undefined,
        error: () => undefined,
      },
    });
    await expect(kick.request('cron')).resolves.toBe('failed');
  });
});

describe('default instance', () => {
  it('reads process.env at call time: unset token → off', async () => {
    vi.stubEnv('JOBS_DISPATCH_TOKEN', '');
    try {
      expect(workerKickConfigured()).toBe(false);
      expect(await requestWorkerPass('cron')).toBe('off');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
