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
  });

  it('warns loudly when the limit windows are shortened (testing only)', () => {
    log.warn.mockClear();
    expect(checkServerSettings({ AUTH_RATE_LIMIT_WINDOW_SECONDS: '20' })).toMatchObject({
      limitWindowSeconds: 20,
    });
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('shortened for testing'),
      expect.objectContaining({ reason: 'auth_limit_window_override', retryAfterS: 20 }),
    );
  });
});
