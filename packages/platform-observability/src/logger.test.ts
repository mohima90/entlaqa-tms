import { afterEach, describe, expect, it, vi } from 'vitest';
import { type LogLevel, baseLogFields, createLogger, formatLogLine } from './logger';
import { errorCode, errorName, reportError, setErrorReporter } from './report';

afterEach(() => {
  vi.unstubAllEnvs();
  setErrorReporter(undefined);
});

describe('formatLogLine', () => {
  it('writes one JSON object with snake_case fields and scrubbed strings', () => {
    const line = formatLogLine(
      'warn',
      'sign-in refused for a@b.co',
      {
        action: 'platform.auth.sign_in',
        correlationId: 'c0ffee00-0000-4000-8000-000000000001',
        status: 400,
        durationMs: 12,
        errorName: 'AuthApiError',
        route: '/[locale]/sign-in',
      },
      { service: 'suite-web', env: 'test' },
      new Date('2026-10-04T10:00:00Z'),
    );
    expect(JSON.parse(line)).toEqual({
      time: '2026-10-04T10:00:00.000Z',
      level: 'warn',
      msg: 'sign-in refused for [email]',
      service: 'suite-web',
      env: 'test',
      action: 'platform.auth.sign_in',
      correlation_id: 'c0ffee00-0000-4000-8000-000000000001',
      status: 400,
      duration_ms: 12,
      error_name: 'AuthApiError',
      route: '/[locale]/sign-in',
    });
  });

  it('ignores fields outside the closed list and non-finite numbers', () => {
    const fields = { status: Number.NaN, email: 'a@b.co' } as unknown as Record<string, never>;
    const parsed = JSON.parse(formatLogLine('info', 'x', fields, {})) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('status');
    expect(parsed).not.toHaveProperty('email');
  });
});

describe('baseLogFields', () => {
  it('reads deployment fields from the runtime environment', () => {
    vi.stubEnv('JADARAT_ENVIRONMENT', 'staging');
    vi.stubEnv('JADARAT_DEPLOYMENT', 'eu-saas-1');
    vi.stubEnv('JADARAT_RELEASE', 'abc123');
    expect(baseLogFields('suite-web')).toEqual({
      service: 'suite-web',
      env: 'staging',
      deployment: 'eu-saas-1',
      version: 'abc123',
    });
  });

  it('uses the Vercel environment when no Jadarat environment is set', () => {
    vi.stubEnv('JADARAT_ENVIRONMENT', '');
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(baseLogFields('suite-web').env).toBe('preview');
  });

  it('falls back to the Vercel commit as version', () => {
    vi.stubEnv('JADARAT_RELEASE', '');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'def456');
    expect(baseLogFields('suite-web').version).toBe('def456');
  });
});

describe('createLogger', () => {
  it('routes each level to the writer', () => {
    const lines: [LogLevel, string][] = [];
    const logger = createLogger({
      service: 'svc',
      write: (level, line) => lines.push([level, line]),
    });
    logger.info('a');
    logger.warn('b');
    logger.error('c', { outcome: 'failure' });
    expect(lines.map(([level]) => level)).toEqual(['info', 'warn', 'error']);
    expect(JSON.parse(lines[2]?.[1] ?? '{}')).toMatchObject({ service: 'svc', outcome: 'failure' });
  });

  it('defaults to stdout for info and stderr otherwise', () => {
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const logger = createLogger();
    logger.info('a');
    logger.error('b');
    expect(out).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(out.mock.calls[0]?.[0]))).toMatchObject({ service: 'suite-web' });
    out.mockRestore();
    err.mockRestore();
  });
});

describe('reportError', () => {
  it('logs the class name only and forwards to the registered reporter', () => {
    const lines: string[] = [];
    const logger = createLogger({ write: (_level, line) => lines.push(line) });
    const reporter = vi.fn();
    setErrorReporter(reporter);
    const error = new TypeError('bad value a@b.co');
    reportError(error, { action: 'x.y', correlationId: 'c' }, logger);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      level: 'error',
      msg: 'unexpected error',
      action: 'x.y',
      correlation_id: 'c',
      error_name: 'TypeError',
    });
    expect(lines[0]).not.toContain('bad value');
    expect(reporter).toHaveBeenCalledWith(error, { action: 'x.y', correlationId: 'c' });
  });

  it('never throws, even when logging and reporting fail', () => {
    setErrorReporter(() => {
      throw new Error('tracker down');
    });
    const failing = createLogger({
      write: () => {
        throw new Error('stdout closed');
      },
    });
    expect(() => {
      reportError('oops', {}, failing);
    }).not.toThrow();
  });

  it('shares the reporter across module copies (separate Next.js bundles)', async () => {
    const reporter = vi.fn();
    setErrorReporter(reporter);
    vi.resetModules();
    const copy = await import('./report');
    copy.reportError(new Error('x'), {}, createLogger({ write: () => undefined }));
    expect(reporter).toHaveBeenCalledTimes(1);
  });

  it('works without a reporter', () => {
    const lines: string[] = [];
    reportError(new Error('x'), {}, createLogger({ write: (_l, line) => lines.push(line) }));
    expect(lines).toHaveLength(1);
  });

  it('logs a numeric status carried by the error', () => {
    const lines: string[] = [];
    const error = Object.assign(new Error('x'), { status: 503 });
    reportError(error, {}, createLogger({ write: (_l, line) => lines.push(line) }));
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ error_name: 'Error', status: 503 });
  });

  it('adds a stable error code from the error or its cause (e.g. a PostgreSQL SQLSTATE)', () => {
    const lines: string[] = [];
    const reporter = vi.fn();
    setErrorReporter(reporter);
    const cause = Object.assign(new Error('duplicate key … (email)=(a@b.co)'), { code: '23505' });
    const error = new Error('Failed query', { cause });
    reportError(error, { action: 'x' }, createLogger({ write: (_l, line) => lines.push(line) }));
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ error_code: '23505' });
    expect(reporter).toHaveBeenCalledWith(error, { action: 'x', errorCode: '23505' });
    expect(errorCode(Object.assign(new Error('x'), { code: 'lower case' }))).toBeUndefined();
    expect(errorCode({ code: 42 })).toBeUndefined();
    expect(errorCode(null)).toBeUndefined();
    expect(errorCode({ code: 'AUTH_INVALID_CREDENTIALS' })).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('names non-Error values by type', () => {
    expect(errorName('x')).toBe('string');
    expect(errorName(new RangeError('x'))).toBe('RangeError');
  });
});
