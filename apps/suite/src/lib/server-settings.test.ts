import { describe, expect, it, vi } from 'vitest';
import { checkServerSettings } from './server-settings';

const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@jadarat/platform-observability', () => ({ log }));

describe('server settings at start-up (T-M2-17, T-M2-11)', () => {
  it('APP_BASE_URL: an https origin, refused otherwise; missing on Vercel production is a warning', () => {
    expect(checkServerSettings({ APP_BASE_URL: 'https://tms.example.com/' }).appBaseUrl).toBe(
      'https://tms.example.com',
    );
    for (const bad of [
      'tms.example.com',
      'http://tms.example.com',
      'https://tms.example.com/app',
    ]) {
      expect(() => checkServerSettings({ APP_BASE_URL: bad }), bad).toThrow('APP_BASE_URL');
    }
    log.warn.mockClear();
    checkServerSettings({ VERCEL: '1', VERCEL_ENV: 'production' });
    expect(log.warn).toHaveBeenCalledWith(
      "APP_BASE_URL is not set: copied invitation links use the browser's origin",
      { action: 'app.start', reason: 'app_base_url_missing' },
    );
  });

  it('reads PASSWORD_RESET_DELIVERY: auth by default, worker when set', () => {
    expect(checkServerSettings({})).toEqual({
      passwordResetDelivery: 'auth',
      limitWindowSeconds: null,
      authClientHeader: null,
      clientIpHeader: null,
      appBaseUrl: null,
    });
    expect(checkServerSettings({ PASSWORD_RESET_DELIVERY: 'worker' })).toMatchObject({
      passwordResetDelivery: 'worker',
    });
  });

  it('a wrong value stops the start (configuration error)', () => {
    expect(() => checkServerSettings({ PASSWORD_RESET_DELIVERY: 'smtp' })).toThrow(
      'PASSWORD_RESET_DELIVERY must be "auth" or "worker"',
    );
    expect(() => checkServerSettings({ AUTH_RATE_LIMIT_WINDOW_SECONDS: '0' })).toThrow(
      'AUTH_RATE_LIMIT_WINDOW_SECONDS',
    );
    expect(() => checkServerSettings({ JADARAT_AUTH_CLIENT_HEADER: 'not a header' })).toThrow(
      'JADARAT_AUTH_CLIENT_HEADER',
    );
    expect(checkServerSettings({ JADARAT_AUTH_CLIENT_HEADER: 'X-Jadarat-Client' })).toMatchObject({
      authClientHeader: 'X-Jadarat-Client',
    });
    // Self-hosted only: on Vercel it would send visitors' addresses to hosted Auth.
    expect(() =>
      checkServerSettings({ JADARAT_AUTH_CLIENT_HEADER: 'X-Jadarat-Client', VERCEL: '1' }),
    ).toThrow('refused on Vercel');
    // The client-IP header: a header name or none — never X-Forwarded-For (the visitor chooses its start).
    for (const value of ['x-forwarded-for', 'X-Forwarded-For', 'not a header', 'x-real-ip:1']) {
      expect(() => checkServerSettings({ JADARAT_CLIENT_IP_HEADER: value }), value).toThrow(
        'JADARAT_CLIENT_IP_HEADER',
      );
    }
  });

  it('warns loudly when the limit windows are shortened (smoke test only)', () => {
    log.warn.mockClear();
    expect(checkServerSettings({ AUTH_RATE_LIMIT_WINDOW_SECONDS: '20' })).toMatchObject({
      limitWindowSeconds: 20,
    });
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('shortened for the smoke test'),
      expect.objectContaining({ reason: 'auth_limit_window_override', retryAfterS: 20 }),
    );
  });

  it('refuses shortened windows in production unless the smoke-only flag is set; on Vercel production always', () => {
    const set = { AUTH_RATE_LIMIT_WINDOW_SECONDS: '40', JADARAT_CLIENT_IP_HEADER: 'x-real-ip' };
    expect(() => checkServerSettings({ ...set, NODE_ENV: 'production' })).toThrow(
      'refused in production',
    );
    expect(
      checkServerSettings({
        ...set,
        NODE_ENV: 'production',
        AUTH_RATE_LIMIT_WINDOW_SMOKE_ONLY: '1',
      }),
    ).toMatchObject({ limitWindowSeconds: 40 });
    expect(() =>
      checkServerSettings({
        ...set,
        NODE_ENV: 'production',
        VERCEL: '1',
        VERCEL_ENV: 'production',
        AUTH_RATE_LIMIT_WINDOW_SMOKE_ONLY: '1',
      }),
    ).toThrow('production deployment');
  });

  it('refuses to start a production server outside Vercel that names its environment without a client-IP header, unless it says none (L4, N2)', () => {
    const selfHosted = { NODE_ENV: 'production', JADARAT_ENVIRONMENT: 'self-hosted' };
    expect(() => checkServerSettings(selfHosted)).toThrow(
      'JADARAT_CLIENT_IP_HEADER is required on a production server outside Vercel',
    );
    // Any label, whatever its spelling (re-review N2): the rule does not hang on the free-form value.
    for (const label of ['Self-Hosted', 'selfhosted', 'production', 'staging', 'ksa-prod', ' x ']) {
      expect(
        () => checkServerSettings({ NODE_ENV: 'production', JADARAT_ENVIRONMENT: label }),
        label,
      ).toThrow('required');
    }
    // On Vercel (x-real-ip is the platform's) a label is fine: staging sets JADARAT_ENVIRONMENT=staging.
    expect(
      checkServerSettings({ NODE_ENV: 'production', VERCEL: '1', JADARAT_ENVIRONMENT: 'staging' }),
    ).toMatchObject({ clientIpHeader: null });
    expect(() => checkServerSettings({ ...selfHosted, JADARAT_CLIENT_IP_HEADER: ' ' })).toThrow(
      'required',
    );
    expect(
      checkServerSettings({ ...selfHosted, JADARAT_CLIENT_IP_HEADER: 'x-real-ip' }),
    ).toMatchObject({ clientIpHeader: 'x-real-ip' });
    // Explicitly none: it starts, with the ERROR at every start.
    log.error.mockClear();
    expect(checkServerSettings({ ...selfHosted, JADARAT_CLIENT_IP_HEADER: 'none' })).toMatchObject({
      clientIpHeader: null,
    });
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('JADARAT_CLIENT_IP_HEADER'), {
      action: 'app.start',
      reason: 'client_ip_header_missing',
    });
    // Not production (development, tests): no refusal.
    expect(() =>
      checkServerSettings({ NODE_ENV: 'development', JADARAT_ENVIRONMENT: 'self-hosted' }),
    ).not.toThrow();
  });

  it('logs an ERROR for another production server without a trusted client address header (local and test builds keep starting)', () => {
    log.error.mockClear();
    checkServerSettings({ NODE_ENV: 'production' });
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('JADARAT_CLIENT_IP_HEADER'), {
      action: 'app.start',
      reason: 'client_ip_header_missing',
    });
    log.error.mockClear();
    // Configured, on Vercel (x-real-ip is the platform's) or in development: nothing to report.
    expect(
      checkServerSettings({ NODE_ENV: 'production', JADARAT_CLIENT_IP_HEADER: 'x-real-ip' }),
    ).toMatchObject({ clientIpHeader: 'x-real-ip' });
    checkServerSettings({ NODE_ENV: 'production', VERCEL: '1' });
    checkServerSettings({ NODE_ENV: 'development' });
    expect(log.error).not.toHaveBeenCalled();
  });
});
