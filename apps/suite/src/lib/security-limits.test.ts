import { SECURITY_LIMITS } from '@jadarat/platform-db';
import { describe, expect, it, vi } from 'vitest';
import { SECURITY_FORM_LIMITS } from './security-limits';

vi.mock('server-only', () => ({}));

describe('security settings form limits (screen 6, T-M2-10)', () => {
  it("are the server's (and so the database's) limits", () => {
    expect(SECURITY_FORM_LIMITS).toEqual(SECURITY_LIMITS);
  });

  it('lockout: the platform default or stricter — 3 to 5 attempts, 15 to 60 minutes (review L5)', () => {
    expect(SECURITY_FORM_LIMITS.lockoutThreshold).toEqual({ min: 3, max: 5 });
    expect(SECURITY_FORM_LIMITS.lockoutMinutes).toEqual({ min: 15, max: 60 });
  });
});
