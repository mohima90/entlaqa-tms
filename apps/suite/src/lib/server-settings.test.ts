import { describe, expect, it } from 'vitest';
import { checkServerSettings } from './server-settings';

describe('server settings at start-up (T-M2-17)', () => {
  it('reads PASSWORD_RESET_DELIVERY: auth by default, worker when set', () => {
    expect(checkServerSettings({})).toEqual({ passwordResetDelivery: 'auth' });
    expect(checkServerSettings({ PASSWORD_RESET_DELIVERY: 'worker' })).toEqual({
      passwordResetDelivery: 'worker',
    });
  });

  it('a wrong value stops the start (configuration error)', () => {
    expect(() => checkServerSettings({ PASSWORD_RESET_DELIVERY: 'smtp' })).toThrow(
      'PASSWORD_RESET_DELIVERY must be "auth" or "worker"',
    );
  });
});
