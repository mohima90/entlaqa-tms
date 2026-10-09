import { describe, expect, it, vi } from 'vitest';
import { checkServerSettings } from './server-settings';

const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@jadarat/platform-observability', () => ({ log }));

describe('server settings at start-up (T-M2-17, T-M2-11)', () => {
  it('reads PASSWORD_RESET_DELIVERY: auth by default, worker when set', () => {
    expect(checkServerSettings({})).toEqual({
      passwordResetDelivery: 'auth',
      limitWindowSeconds: null,
      authClientHeader: null,
      clientIpHeader: null,
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

  it('logs an ERROR for a self-hosted production server without a trusted client address header', () => {
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
