import { describe, expect, it } from 'vitest';
import { EMAIL_TEMPLATES, PLATFORM_SENDER_TEMPLATES } from './index';

describe('e-mails that open an account and go through the platform sender only', () => {
  it('are the sign-in code, the reset link and the authenticator set-up code - each the same e-mail as its base', () => {
    expect([...PLATFORM_SENDER_TEMPLATES].sort()).toEqual([
      'platform.mfa_factor_added_platform',
      'platform.password_reset_platform',
      'platform.sign_in_code_platform',
    ]);
    for (const key of PLATFORM_SENDER_TEMPLATES) {
      const base = key.slice(0, -'_platform'.length) as keyof typeof EMAIL_TEMPLATES;
      expect(EMAIL_TEMPLATES[key as keyof typeof EMAIL_TEMPLATES]).toBe(EMAIL_TEMPLATES[base]);
    }
  });
});
