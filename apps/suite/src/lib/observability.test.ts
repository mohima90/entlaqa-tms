import { reportError, setErrorReporter } from '@jadarat/platform-observability';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ErrorTrackingSdk, handleRequestError, startObservability } from './observability';

vi.mock('server-only', () => ({}));
vi.mock('@sentry/nextjs', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureRequestError: vi.fn(),
  flush: vi.fn(() => Promise.resolve(true)),
}));

const DSN = 'https://0123abcd@o1.ingest.de.sentry.io/4512197765103696';

function fakeSdk() {
  return {
    init: vi.fn(),
    captureException: vi.fn(),
    captureRequestError: vi.fn(),
    flush: vi.fn(() => Promise.resolve(true)),
  } satisfies ErrorTrackingSdk;
}

function silenceLogs() {
  return {
    out: vi.spyOn(process.stdout, 'write').mockReturnValue(true),
    err: vi.spyOn(process.stderr, 'write').mockReturnValue(true),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  setErrorReporter(undefined);
});

describe('startObservability', () => {
  it('stays off (logging only) without a valid DSN', () => {
    silenceLogs();
    vi.stubEnv('SENTRY_DSN', '');
    const sdk = fakeSdk();
    expect(startObservability(sdk)).toBe(false);
    expect(sdk.init).not.toHaveBeenCalled();
    reportError(new Error('x'), {});
    expect(sdk.captureException).not.toHaveBeenCalled();
  });

  it('starts the tracker with the scrubbing options and forwards reported errors with tags only', () => {
    const { out } = silenceLogs();
    vi.stubEnv('SENTRY_DSN', DSN);
    vi.stubEnv('JADARAT_ENVIRONMENT', 'staging');
    const sdk = fakeSdk();
    const keepAlive = vi.fn();
    expect(startObservability(sdk, keepAlive)).toBe(true);
    expect(sdk.init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: DSN, environment: 'staging', sendDefaultPii: false }),
    );
    const error = new Error('boom');
    reportError(error, {
      action: 'platform.auth.sign_in',
      permission: 'tms.session.create',
      correlationId: 'c-1',
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(sdk.captureException).toHaveBeenCalledWith(error, {
      tags: {
        action: 'platform.auth.sign_in',
        permission: 'tms.session.create',
        correlation_id: 'c-1',
        tenant_id: '550e8400-e29b-41d4-a716-446655440000',
      },
    });
    reportError(error, {});
    expect(sdk.captureException).toHaveBeenLastCalledWith(error, { tags: {} });
    // Each report is flushed while the (serverless) function is kept alive.
    expect(sdk.flush).toHaveBeenCalledWith(2000);
    expect(keepAlive).toHaveBeenCalledTimes(2);
    // The DSN itself is never logged.
    expect(JSON.stringify(out.mock.calls)).not.toContain('0123abcd');
  });

  it('does not fail when flushing fails', async () => {
    silenceLogs();
    vi.stubEnv('SENTRY_DSN', DSN);
    const sdk = fakeSdk();
    sdk.flush.mockImplementation(() => Promise.reject(new Error('network')));
    const tasks: Promise<unknown>[] = [];
    startObservability(sdk, (task) => tasks.push(task));
    reportError(new Error('x'), {});
    await expect(Promise.all(tasks)).resolves.toEqual([false]);
  });

  it('uses the Sentry SDK by default', () => {
    silenceLogs();
    vi.stubEnv('SENTRY_DSN', '');
    expect(startObservability()).toBe(false);
  });
});

describe('handleRequestError', () => {
  const context = { routerKind: 'App Router', routePath: '/[locale]/suite', routeType: 'render' };

  it('logs class and route only, and reports without request headers', () => {
    const { err } = silenceLogs();
    const sdk = fakeSdk();
    const error = new TypeError('failed for a@b.co');
    handleRequestError(
      error,
      { path: '/ar/suite?x=1', method: 'GET', headers: { cookie: 'sb=secret' } },
      context,
      sdk,
    );
    expect(sdk.captureRequestError).toHaveBeenCalledWith(
      error,
      { path: '/ar/suite?x=1', method: 'GET', headers: {} },
      context,
    );
    const line = JSON.parse(String(err.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(line).toMatchObject({
      level: 'error',
      msg: 'request failed',
      error_name: 'TypeError',
      route: '/[locale]/suite',
    });
    expect(JSON.stringify(err.mock.calls)).not.toMatch(/a@b\.co|secret/);
  });

  it('never throws when reporting fails', () => {
    silenceLogs();
    const sdk = fakeSdk();
    sdk.captureRequestError.mockImplementation(() => {
      throw new Error('tracker down');
    });
    expect(() => {
      handleRequestError(new Error('x'), { path: '/', method: 'GET', headers: {} }, context, sdk);
    }).not.toThrow();
    expect(() => {
      handleRequestError(new Error('x'), { path: '/', method: 'GET', headers: {} }, context);
    }).not.toThrow();
  });
});
