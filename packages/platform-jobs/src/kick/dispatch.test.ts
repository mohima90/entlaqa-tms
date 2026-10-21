import { generateKeyPairSync, verify } from 'node:crypto';
import type { Logger } from '@jadarat/platform-observability';
import { describe, expect, it, vi } from 'vitest';
import {
  APP_JWT_BACKDATE_S,
  APP_JWT_LIFETIME_S,
  CRON_MIN_INTERVAL_MS,
  MIN_INTERVAL_MS,
  TOKEN_REFRESH_MARGIN_MS,
  createWorkerKick,
  dispatchUrl,
  installationTokenRequest,
  installationTokenUrl,
  readWorkerKickSettings,
  requestWorkerPass,
  signAppJwt,
  workerKickConfigured,
} from './dispatch';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const PKCS1_PEM = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const EC_PEM = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString();
const INSTALLATION_TOKEN = 'ghs_16C7e42F292c6912E7710c838347Ae178B4a';
const ENV = {
  JOBS_DISPATCH_APP_ID: '123456',
  JOBS_DISPATCH_APP_PRIVATE_KEY: PEM,
  JOBS_DISPATCH_INSTALLATION_ID: '7890123',
  JOBS_DISPATCH_REPO: 'mohima90/entlaqa-tms',
};
const TOKEN_URL = 'https://api.github.com/app/installations/7890123/access_tokens';
const DISPATCH_URL =
  'https://api.github.com/repos/mohima90/entlaqa-tms/actions/workflows/jobs.yml/dispatches';
const START = 1_800_000_000_000;

function recordingLogger() {
  const lines: { level: string; message: string; fields: unknown }[] = [];
  const logger: Logger = {
    info: (message, fields) => lines.push({ level: 'info', message, fields }),
    warn: (message, fields) => lines.push({ level: 'warn', message, fields }),
    error: (message, fields) => lines.push({ level: 'error', message, fields }),
  };
  return { logger, lines };
}

function tokenAnswer(expiresAt: number, token = INSTALLATION_TOKEN): Response {
  return new Response(JSON.stringify({ token, expires_at: new Date(expiresAt).toISOString() }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
}

function setup(
  options: {
    env?: Record<string, string | undefined>;
    /** The token exchange's answer (default: a token valid one hour). */
    token?: (clock: number) => Promise<Response>;
    /** The dispatch's answer (default: 204). */
    dispatch?: (init: RequestInit) => Promise<Response>;
    timeoutMs?: number;
  } = {},
) {
  let clock = START;
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = vi.fn((input: string, init?: RequestInit) => {
    calls.push({ url: input, init: init ?? {} });
    if (input === TOKEN_URL) {
      return options.token
        ? options.token(clock)
        : Promise.resolve(tokenAnswer(clock + 60 * 60_000));
    }
    return options.dispatch
      ? options.dispatch(init ?? {})
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
    tokenCalls: () => calls.filter((c) => c.url === TOKEN_URL),
    dispatchCalls: () => calls.filter((c) => c.url === DISPATCH_URL),
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

function decodeJwt(jwt: string) {
  const [header, payload, signature] = jwt.split('.') as [string, string, string];
  const json = (part: string) =>
    JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
  return {
    header: json(header),
    payload: json(payload),
    signed: `${header}.${payload}`,
    signature,
  };
}

describe('readWorkerKickSettings', () => {
  it('is off without any App setting (self-hosted, local development)', () => {
    expect(readWorkerKickSettings({})).toEqual({ kind: 'off' });
    expect(
      readWorkerKickSettings({ JOBS_DISPATCH_APP_ID: '  ', JOBS_DISPATCH_REPO: 'a/b' }),
    ).toEqual({ kind: 'off' });
  });

  it('a personal token alone is not a configuration any more (H1): off', () => {
    expect(
      readWorkerKickSettings({
        JOBS_DISPATCH_TOKEN: 'github_pat_0123456789abcdefghijklmnopqrstuvwxyz',
        JOBS_DISPATCH_REPO: 'mohima90/entlaqa-tms',
      }),
    ).toEqual({ kind: 'off' });
  });

  it('reads the App, installation, repository and the defaults (jobs.yml on main)', () => {
    const settings = readWorkerKickSettings(ENV);
    expect(settings).toMatchObject({
      kind: 'on',
      config: {
        appId: '123456',
        installationId: '7890123',
        repo: 'mohima90/entlaqa-tms',
        workflow: 'jobs.yml',
        ref: 'main',
      },
    });
    expect(
      readWorkerKickSettings({
        ...ENV,
        JOBS_DISPATCH_WORKFLOW: 'other-jobs.yaml',
        JOBS_DISPATCH_REF: 'release/r1',
      }),
    ).toMatchObject({ config: { workflow: 'other-jobs.yaml', ref: 'release/r1' } });
  });

  it('accepts a PKCS#1 key and a key stored with literal \\n escapes', () => {
    expect(readWorkerKickSettings({ ...ENV, JOBS_DISPATCH_APP_PRIVATE_KEY: PKCS1_PEM }).kind).toBe(
      'on',
    );
    expect(
      readWorkerKickSettings({
        ...ENV,
        JOBS_DISPATCH_APP_PRIVATE_KEY: PEM.trim().replace(/\n/g, '\\n'),
      }).kind,
    ).toBe('on');
  });

  it.each([
    ['JOBS_DISPATCH_APP_ID', undefined],
    ['JOBS_DISPATCH_APP_ID', 'abc'],
    ['JOBS_DISPATCH_APP_ID', '0'],
    ['JOBS_DISPATCH_APP_ID', '12/../34'],
    ['JOBS_DISPATCH_APP_PRIVATE_KEY', undefined],
    ['JOBS_DISPATCH_APP_PRIVATE_KEY', 'not a key'],
    ['JOBS_DISPATCH_APP_PRIVATE_KEY', EC_PEM],
    ['JOBS_DISPATCH_APP_PRIVATE_KEY', publicKey.export({ type: 'spki', format: 'pem' }).toString()],
    ['JOBS_DISPATCH_INSTALLATION_ID', undefined],
    ['JOBS_DISPATCH_INSTALLATION_ID', '12 34'],
    ['JOBS_DISPATCH_INSTALLATION_ID', '../users'],
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
  ])('refuses %s=… (names the setting, never its value)', (name, value) => {
    const settings = readWorkerKickSettings({ ...ENV, [name]: value });
    expect(settings).toEqual({ kind: 'invalid', problem: name });
  });
});

describe('endpoints and the App JWT', () => {
  it('always targets api.github.com', () => {
    expect(dispatchUrl({ repo: 'mohima90/entlaqa-tms', workflow: 'jobs.yml' })).toBe(DISPATCH_URL);
    expect(installationTokenUrl({ installationId: '7890123' })).toBe(TOKEN_URL);
  });

  it('asks for a token narrowed to this repository and Actions write only', () => {
    expect(installationTokenRequest({ repo: 'mohima90/entlaqa-tms' })).toEqual({
      repositories: ['entlaqa-tms'],
      permissions: { actions: 'write' },
    });
  });

  it('signs an RS256 JWT: iat now − 60 s, exp ≤ now + 9 min, iss the App id', () => {
    const jwt = signAppJwt({ appId: '123456', privateKey: createKey() }, START);
    const { header, payload, signed, signature } = decodeJwt(jwt);
    const now = START / 1000;
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(payload).toEqual({
      iat: now - APP_JWT_BACKDATE_S,
      exp: now + APP_JWT_LIFETIME_S,
      iss: 123456,
    });
    expect(APP_JWT_LIFETIME_S).toBeLessThanOrEqual(9 * 60);
    expect(
      verify('sha256', Buffer.from(signed), publicKey, Buffer.from(signature, 'base64url')),
    ).toBe(true);
  });
});

function createKey() {
  const settings = readWorkerKickSettings(ENV);
  if (settings.kind !== 'on') throw new Error('fixture');
  return settings.config.privateKey;
}

describe('createWorkerKick', () => {
  it('no App settings → no call, no log', async () => {
    const { kick, calls, lines } = setup({ env: {} });
    expect(kick.configured()).toBe(false);
    expect(await kick.request('cron')).toBe('off');
    expect(calls).toHaveLength(0);
    expect(lines).toHaveLength(0);
  });

  it('exchanges the App JWT for a narrowed token, then dispatches jobs.yml on main with it', async () => {
    const { kick, calls, lines } = setup();
    expect(kick.configured()).toBe(true);
    expect(await kick.request('action:platform.iam.invite')).toBe('dispatched');
    expect(calls.map((c) => c.url)).toEqual([TOKEN_URL, DISPATCH_URL]);
    const [exchange, dispatch] = calls;
    expect(exchange?.init.method).toBe('POST');
    expect(exchange?.init.redirect).toBe('error');
    expect(exchange?.init.signal).toBeInstanceOf(AbortSignal);
    const jwt = String((exchange?.init.headers as Record<string, string>).authorization).replace(
      /^Bearer /,
      '',
    );
    expect(decodeJwt(jwt).payload).toMatchObject({ iss: 123456 });
    expect(JSON.parse(exchange?.init.body as string)).toEqual({
      repositories: ['entlaqa-tms'],
      permissions: { actions: 'write' },
    });
    expect(dispatch?.init.method).toBe('POST');
    expect(dispatch?.init.headers).toMatchObject({
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${INSTALLATION_TOKEN}`,
      'x-github-api-version': '2022-11-28',
    });
    expect(JSON.parse(dispatch?.init.body as string)).toEqual({ ref: 'main' });
    expect(dispatch?.init.redirect).toBe('error');
    expect(dispatch?.init.signal).toBeInstanceOf(AbortSignal);
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

  it('reuses the installation token until 5 minutes before it expires', async () => {
    const { kick, tokenCalls, dispatchCalls, advance } = setup();
    expect(await kick.request('a')).toBe('dispatched');
    advance(MIN_INTERVAL_MS);
    expect(await kick.request('b')).toBe('dispatched');
    expect(tokenCalls()).toHaveLength(1);
    // The token was issued at START, valid one hour: reused until 55 minutes after.
    advance(60 * 60_000 - TOKEN_REFRESH_MARGIN_MS - MIN_INTERVAL_MS - 1);
    expect(await kick.request('c')).toBe('dispatched');
    expect(tokenCalls()).toHaveLength(1);
    advance(MIN_INTERVAL_MS);
    expect(await kick.request('d')).toBe('dispatched');
    expect(tokenCalls()).toHaveLength(2);
    expect(dispatchCalls()).toHaveLength(4);
  });

  it('a token about to expire is used once but not cached', async () => {
    const { kick, tokenCalls, advance } = setup({
      token: (clock) => Promise.resolve(tokenAnswer(clock + TOKEN_REFRESH_MARGIN_MS - 1)),
    });
    expect(await kick.request('a')).toBe('dispatched');
    advance(MIN_INTERVAL_MS);
    expect(await kick.request('b')).toBe('dispatched');
    expect(tokenCalls()).toHaveLength(2);
  });

  it('a dispatch answered 401 drops the cached token', async () => {
    let status = 401;
    const { kick, tokenCalls, advance } = setup({
      dispatch: () => Promise.resolve(new Response(null, { status })),
    });
    expect(await kick.request('a')).toBe('failed');
    status = 204;
    advance(MIN_INTERVAL_MS);
    expect(await kick.request('b')).toBe('dispatched');
    expect(tokenCalls()).toHaveLength(2);
  });

  it.each([401, 404, 422, 500])(
    'a refused token exchange (%i): no dispatch, a warning with the status only',
    async (status) => {
      const { kick, dispatchCalls, lines } = setup({
        token: () => Promise.resolve(new Response(`{"message":"no ${PEM}"}`, { status })),
      });
      expect(await kick.request('cron')).toBe('failed');
      expect(dispatchCalls()).toHaveLength(0);
      expect(lines).toEqual([
        expect.objectContaining({
          level: 'warn',
          fields: expect.objectContaining({
            status,
            errorCode: `github_token_http_${String(status)}`,
            outcome: 'failure',
          }),
        }),
      ]);
    },
  );

  it.each([
    ['no token', JSON.stringify({ expires_at: '2030-01-01T00:00:00Z' })],
    [
      'a token with a line break',
      JSON.stringify({ token: 'ghs_x\nX-Evil: 1', expires_at: '2030-01-01T00:00:00Z' }),
    ],
    ['no expiry', JSON.stringify({ token: INSTALLATION_TOKEN })],
    ['not JSON', 'oops'],
  ])('a malformed token answer (%s): no dispatch', async (_label, body) => {
    const { kick, dispatchCalls, lines } = setup({
      token: () => Promise.resolve(new Response(body, { status: 201 })),
    });
    expect(await kick.request('cron')).toBe('failed');
    expect(dispatchCalls()).toHaveLength(0);
    expect(lines[0]).toMatchObject({ fields: { errorCode: 'github_token_malformed' } });
  });

  it('throttles actions: one dispatch per minute per instance, then again', async () => {
    const { kick, dispatchCalls, advance } = setup();
    const burst = await Promise.all([kick.request('a'), kick.request('b'), kick.request('c')]);
    expect(burst).toEqual(['dispatched', 'throttled', 'throttled']);
    advance(MIN_INTERVAL_MS - 1);
    expect(await kick.request('d')).toBe('throttled');
    advance(1);
    expect(await kick.request('e')).toBe('dispatched');
    expect(dispatchCalls()).toHaveLength(2);
  });

  it('the cron has its own window: an action kick never makes it skip (L1); a tight loop is still stopped', async () => {
    const { kick, dispatchCalls, advance } = setup();
    expect(await kick.request('action:platform.iam.invite')).toBe('dispatched');
    expect(await kick.request('cron')).toBe('dispatched');
    expect(await kick.request('cron')).toBe('throttled');
    advance(CRON_MIN_INTERVAL_MS);
    expect(await kick.request('cron')).toBe('dispatched');
    expect(await kick.request('action:x')).toBe('throttled');
    expect(dispatchCalls()).toHaveLength(3);
  });

  it('a refused dispatch (non-2xx) is a warning with the status, never the body', async () => {
    const { kick, lines } = setup({
      dispatch: () =>
        Promise.resolve(
          new Response(`{"message":"Bad credentials ${INSTALLATION_TOKEN}"}`, { status: 403 }),
        ),
    });
    expect(await kick.request('cron')).toBe('failed');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'warn',
      fields: { status: 403, errorCode: 'github_http_403', outcome: 'failure' },
    });
  });

  it('a timeout is handled (never thrown) and reported as such', async () => {
    const { kick, lines } = setup({
      timeoutMs: 5,
      dispatch: (init) =>
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
      token: () => Promise.reject(new TypeError(`fetch failed for ${PEM}`)),
    });
    expect(await kick.request('cron')).toBe('failed');
    expect(lines[0]).toMatchObject({ fields: { errorCode: 'network', errorName: 'TypeError' } });
  });

  it('never logs the key, the JWT or the token, whatever happens', async () => {
    const jwtParts: string[] = [];
    for (const variant of [
      {},
      { dispatch: () => Promise.resolve(new Response(INSTALLATION_TOKEN, { status: 500 })) },
      { dispatch: () => Promise.reject(new Error(INSTALLATION_TOKEN)) },
      { token: () => Promise.resolve(new Response(PEM, { status: 401 })) },
      { token: () => Promise.reject(new Error(PEM)) },
    ]) {
      const { kick, lines, tokenCalls } = setup(variant);
      await kick.request('cron');
      for (const call of tokenCalls()) {
        jwtParts.push(
          String((call.init.headers as Record<string, string>).authorization).split('.')[2] ?? '',
        );
      }
      const logged = JSON.stringify(lines);
      expect(logged).not.toContain(INSTALLATION_TOKEN);
      expect(logged).not.toContain('ghs_');
      expect(logged).not.toContain('PRIVATE KEY');
      for (const part of jwtParts) expect(logged).not.toContain(part);
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

  it('a malformed key is reported by name only', async () => {
    const { kick, lines } = setup({
      env: { ...ENV, JOBS_DISPATCH_APP_PRIVATE_KEY: 'secret-but-not-a-pem' },
    });
    expect(await kick.request('cron')).toBe('invalid_config');
    expect(lines[0]?.message).toBe(
      'worker pass not requested: JOBS_DISPATCH_APP_PRIVATE_KEY is invalid',
    );
    expect(JSON.stringify(lines)).not.toContain('secret-but-not-a-pem');
  });

  it('logs an unexpected reason as `other`', async () => {
    const { kick, lines } = setup();
    await kick.request('Has Spaces <and> personal@example.com');
    expect(lines[0]).toMatchObject({ fields: { reason: 'other' } });
  });

  it('never rejects, even when the logger throws', async () => {
    const kick = createWorkerKick({
      env: () => ENV,
      fetch: ((url: string) =>
        Promise.resolve(
          url === TOKEN_URL
            ? tokenAnswer(Date.now() + 60 * 60_000)
            : new Response(null, { status: 204 }),
        )) as unknown as typeof fetch,
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
  it('reads process.env at call time: no App settings → off', async () => {
    vi.stubEnv('JOBS_DISPATCH_APP_ID', '');
    vi.stubEnv('JOBS_DISPATCH_APP_PRIVATE_KEY', '');
    vi.stubEnv('JOBS_DISPATCH_INSTALLATION_ID', '');
    try {
      expect(workerKickConfigured()).toBe(false);
      expect(await requestWorkerPass('cron')).toBe('off');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
