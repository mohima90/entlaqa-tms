import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  errorTrackingOptions,
  isAllowedDsn,
  isErrorTrackingDsnSet,
  readErrorTrackingConfig,
} from './error-tracking';

afterEach(() => {
  vi.unstubAllEnvs();
});

const DSN = 'https://0123abcd@o1.ingest.de.sentry.io/4512197765103696';

describe('isAllowedDsn', () => {
  it.each([
    [DSN, true],
    ['http://key@glitchtip:8000/1', true],
    ['http://key@localhost:8000/1', true],
    ['http://key@errors.example.com/1', false],
    ['http://key@127.0.0.1:8000/1', true],
    ['http://key@[2001:db8::1]/1', false],
    ['http://key@10.0.0.5/1', false],
    ['ftp://key@glitchtip/1', false],
    ['https://o1.ingest.de.sentry.io/1', false],
    ['https://key@o1.ingest.de.sentry.io/', false],
    ['not a url', false],
  ])('%s → %s', (dsn, allowed) => {
    expect(isAllowedDsn(dsn)).toBe(allowed);
  });
});

describe('readErrorTrackingConfig', () => {
  it('is off without a DSN or with an invalid one', () => {
    vi.stubEnv('SENTRY_DSN', '');
    expect(readErrorTrackingConfig()).toBeNull();
    expect(isErrorTrackingDsnSet()).toBe(false);
    vi.stubEnv('SENTRY_DSN', 'http://key@errors.example.com/1');
    expect(readErrorTrackingConfig()).toBeNull();
    expect(isErrorTrackingDsnSet()).toBe(true);
  });

  it('reads DSN, environment and release at runtime', () => {
    vi.stubEnv('SENTRY_DSN', ` ${DSN} `);
    vi.stubEnv('JADARAT_ENVIRONMENT', '');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('JADARAT_RELEASE', '');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc');
    expect(readErrorTrackingConfig()).toEqual({ dsn: DSN, environment: 'preview', release: 'abc' });
    vi.stubEnv('JADARAT_ENVIRONMENT', 'staging');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '');
    expect(readErrorTrackingConfig()).toEqual({ dsn: DSN, environment: 'staging' });
  });
});

describe('errorTrackingOptions', () => {
  it('sends errors only, without personal data', () => {
    const options = errorTrackingOptions({ dsn: DSN, environment: 'staging', release: 'r1' });
    expect(options).toMatchObject({
      dsn: DSN,
      environment: 'staging',
      release: 'r1',
      sendDefaultPii: false,
      includeLocalVariables: false,
      maxBreadcrumbs: 0,
      enableOpenTelemetrySetup: false,
      enableRuntimeChannelInjection: false,
    });
    expect(options).not.toHaveProperty('tracesSampleRate');
    expect(options.beforeBreadcrumb({ message: 'x' })).toBeNull();
    const integration = (name: string) => ({ name, setupOnce: () => undefined });
    expect(
      options.integrations([integration('ContextLines'), integration('Dedupe')]).map((i) => i.name),
    ).toEqual(['Dedupe']);
    expect(options.beforeSend({ type: undefined, user: { email: 'a@b.co' } })).toEqual({
      type: undefined,
    });
    expect(errorTrackingOptions({ dsn: DSN, environment: 'x' })).not.toHaveProperty('release');
  });
});
