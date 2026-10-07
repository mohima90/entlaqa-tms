import { afterEach, describe, expect, it, vi } from 'vitest';
import { type TunnelDeps, handleErrorTunnel } from './error-tunnel';

vi.mock('server-only', () => ({}));

const DSN = 'https://0123abcd@o1.ingest.de.sentry.io/4512197765103696';

const event = {
  exception: { values: [{ type: 'TypeError', value: 'x for a@b.co' }] },
  request: { url: 'https://app/ar?email=a@b.co' },
};

function body(...items: object[]): string {
  return [
    JSON.stringify({ dsn: 'https://browser@errors.invalid/1' }),
    ...items.flatMap((item) => [JSON.stringify({ type: 'event' }), JSON.stringify(item)]),
  ].join('\n');
}

function request(payload: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request('https://app/api/monitoring/errors', {
    method: 'POST',
    body: payload,
    headers: { 'sec-fetch-site': 'same-origin', ...headers },
  });
}

function deps(overrides: Partial<TunnelDeps> = {}) {
  return {
    config: () => ({ dsn: DSN, environment: 'staging', release: 'r1' }),
    allow: () => true,
    allowClient: () => true,
    send: vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleErrorTunnel', () => {
  it('scrubs and forwards error events to the runtime DSN', async () => {
    const send = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(new Response(null, { status: 200 })),
    );
    const response = await handleErrorTunnel(request(body(event)), deps({ send }));
    expect(response.status).toBe(202);
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0] ?? ['', {}];
    expect(url).toBe('https://o1.ingest.de.sentry.io/api/4512197765103696/envelope/');
    expect(init.headers).toMatchObject({
      'x-sentry-auth': expect.stringContaining('sentry_key=0123abcd') as unknown,
    });
    const sent = typeof init.body === 'string' ? init.body : '';
    expect(sent).toContain('"environment":"staging"');
    expect(sent).not.toMatch(/a@b\.co|errors\.invalid/);
  });

  it('drops the invitation token from every URL of a report (T-M2-07)', async () => {
    const token = 'sample-invitation-token'.padEnd(43, '0'); // shape only
    const url = `https://app.example/ar/invite/accept?token=${token}`;
    const send = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(new Response(null, { status: 200 })),
    );
    const invite = {
      exception: {
        values: [
          {
            type: 'TypeError',
            value: `failed at ${url}`,
            stacktrace: { frames: [{ filename: url, abs_path: `${url}#x`, lineno: 1 }] },
          },
        ],
      },
      request: { url, query_string: `token=${token}`, headers: { Referer: url } },
      transaction: url,
      contexts: { page: { url, referrer: url } },
      breadcrumbs: [{ message: url }],
    };
    expect((await handleErrorTunnel(request(body(invite)), deps({ send }))).status).toBe(202);
    const [, init] = send.mock.calls[0] ?? ['', {}];
    const sent = typeof init.body === 'string' ? init.body : '';
    expect(sent).toContain('/ar/invite/accept');
    expect(sent).not.toContain(token);
    expect(sent).not.toContain('token=');
  });

  it('drops the password-reset token (URL fragment) from every URL of a report (T-M2-08)', async () => {
    const tokenHash = `pkce_${'0a'.repeat(28)}`; // shape only
    const url = `https://app.example/ar/reset-password#token_hash=${tokenHash}&type=recovery`;
    const send = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(new Response(null, { status: 200 })),
    );
    const reset = {
      exception: {
        values: [
          {
            type: 'TypeError',
            value: `failed at ${url}`,
            stacktrace: { frames: [{ filename: url, abs_path: url, lineno: 1 }] },
          },
        ],
      },
      request: { url, headers: { Referer: url } },
      transaction: url,
      contexts: { page: { url, referrer: url, path: url } },
      breadcrumbs: [{ message: url }],
      extra: { tokenHash },
    };
    expect((await handleErrorTunnel(request(body(reset)), deps({ send }))).status).toBe(202);
    const [, init] = send.mock.calls[0] ?? ['', {}];
    const sent = typeof init.body === 'string' ? init.body : '';
    expect(sent).toContain('/ar/reset-password');
    expect(sent).not.toContain(tokenHash);
    expect(sent).not.toContain('token_hash');
  });

  it('refuses cross-site requests and oversized bodies', async () => {
    const d = deps();
    expect(
      (await handleErrorTunnel(request(body(event), { 'sec-fetch-site': 'cross-site' }), d)).status,
    ).toBe(403);
    expect(
      (await handleErrorTunnel(request(body(event), { 'content-length': '999999' }), d)).status,
    ).toBe(413);
    expect((await handleErrorTunnel(request('x'.repeat(70 * 1024)), d)).status).toBe(413);
    expect(d.send).not.toHaveBeenCalled();
  });

  it('accepts requests without fetch-metadata headers (older browsers)', async () => {
    const d = deps();
    const plain = new Request('https://app/api/monitoring/errors', {
      method: 'POST',
      body: body(event),
    });
    expect((await handleErrorTunnel(plain, d)).status).toBe(202);
  });

  it('drops reports when error tracking is off, nothing usable is sent, or the limit is reached', async () => {
    const off = deps({ config: () => null });
    expect((await handleErrorTunnel(request(body(event)), off)).status).toBe(204);
    const badDsn = deps({ config: () => ({ dsn: 'https://host/1', environment: 'x' }) });
    expect((await handleErrorTunnel(request(body(event)), badDsn)).status).toBe(204);
    const d = deps();
    expect((await handleErrorTunnel(request('not an envelope'), d)).status).toBe(400);
    expect((await handleErrorTunnel(request(null), d)).status).toBe(400);
    expect((await handleErrorTunnel(request(body({ message: 'no exception' })), d)).status).toBe(
      204,
    );
    const limited = deps({ allow: () => false });
    expect((await handleErrorTunnel(request(body(event)), limited)).status).toBe(429);
    vi.stubEnv('VERCEL', '1');
    const perClient = deps({ allowClient: (key) => key !== '203.0.113.9' });
    expect(
      (await handleErrorTunnel(request(body(event), { 'x-real-ip': '203.0.113.9' }), perClient))
        .status,
    ).toBe(429);
    expect((await handleErrorTunnel(request(body(event)), perClient)).status).toBe(202);
    vi.unstubAllEnvs();
    expect(d.send).not.toHaveBeenCalled();
    expect(limited.send).not.toHaveBeenCalled();
  });

  it('answers the same whatever happens upstream, and logs without details', async () => {
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const rejected = deps({
      send: vi.fn(() => Promise.resolve(new Response(null, { status: 429 }))),
    });
    expect((await handleErrorTunnel(request(body(event)), rejected)).status).toBe(202);
    const down = deps({ send: vi.fn(() => Promise.reject(new Error('network'))) });
    expect((await handleErrorTunnel(request(body(event)), down)).status).toBe(202);
    const lines = err.mock.calls.map(([line]) => String(line));
    expect(lines[0]).toContain('"status":429');
    expect(lines[1]).toContain('browser error report not forwarded');
  });

  it('keys clients on the configured client-IP header', async () => {
    const keys: string[] = [];
    const d = deps({
      allowClient: (key) => {
        keys.push(key);
        return true;
      },
    });
    // Outside Vercel, x-real-ip is not trusted unless configured.
    vi.stubEnv('VERCEL', '');
    await handleErrorTunnel(request(body(event), { 'x-real-ip': '198.51.100.7' }), d);
    vi.stubEnv('VERCEL', '1');
    await handleErrorTunnel(request(body(event), { 'x-real-ip': '198.51.100.1' }), d);
    await handleErrorTunnel(request(body(event), { 'x-real-ip': 'x'.repeat(5000) }), d);
    vi.stubEnv('JADARAT_CLIENT_IP_HEADER', 'x-client-ip');
    await handleErrorTunnel(request(body(event), { 'x-client-ip': '2001:db8::5' }), d);
    await handleErrorTunnel(request(body(event), { 'x-client-ip': '192.0.2.5, 10.0.0.1' }), d);
    await handleErrorTunnel(request(body(event)), d);
    vi.unstubAllEnvs();
    expect(keys).toEqual([
      'unknown',
      '198.51.100.1',
      'unknown',
      '2001:db8:0:0::/64', // IPv6 clients are keyed by their /64
      'unknown',
      'unknown',
    ]);
  });

  it('answers 400 when the request body cannot be read', async () => {
    const broken = new Request('https://app/api/monitoring/errors', {
      method: 'POST',
      body: new ReadableStream({
        pull() {
          throw new Error('aborted');
        },
      }),
      duplex: 'half',
    } as RequestInit);
    expect((await handleErrorTunnel(broken, deps())).status).toBe(400);
  });

  it('uses the runtime configuration by default', async () => {
    vi.stubEnv('SENTRY_DSN', '');
    expect((await handleErrorTunnel(request(body(event)))).status).toBe(204);
    vi.unstubAllEnvs();
  });
});
