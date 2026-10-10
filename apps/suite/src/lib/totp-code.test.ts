import { describe, expect, it } from 'vitest';
import { EmailSetupCode, TotpCode, looksLikeEmailSetupCode, looksLikeTotpCode } from './totp-code';

describe('authenticator codes (FR-IAM-12, T-M2-10)', () => {
  it('six digits in any script, spaces allowed (as some apps show "123 456")', () => {
    expect(TotpCode.parse('123456')).toBe('123456');
    expect(TotpCode.parse(' 123 456 ')).toBe('123456');
    expect(TotpCode.parse('١٢٣٤٥٦')).toBe('123456');
    expect(TotpCode.parse('۱۲۳ ۴۵۶')).toBe('123456');
    for (const code of ['12345', '1234567', 'abcdef', '12-456', '', '1'.repeat(40)]) {
      expect(TotpCode.safeParse(code).success, code).toBe(false);
    }
  });

  it("the client's own check before sending matches the server's", () => {
    for (const code of ['123456', '123 456', '١٢٣٤٥٦', '۱۲۳۴۵۶']) {
      expect(looksLikeTotpCode(code), code).toBe(true);
    }
    for (const code of ['12345', '1234567', 'abcdef', '12-456', '']) {
      expect(looksLikeTotpCode(code), code).toBe(false);
    }
  });
});

describe('the e-mailed set-up code (T-M2-10, re-review N1)', () => {
  it('eight digits in any script, spaces allowed (the e-mail shows "4071 8263")', () => {
    expect(EmailSetupCode.parse('40718263')).toBe('40718263');
    expect(EmailSetupCode.parse(' 4071 8263 ')).toBe('40718263');
    expect(EmailSetupCode.parse('٤٠٧١٨٢٦٣')).toBe('40718263');
    for (const code of ['4071826', '407182631', '123456', 'abcdefgh', '4071-8263', '']) {
      expect(EmailSetupCode.safeParse(code).success, code).toBe(false);
      expect(looksLikeEmailSetupCode(code), code).toBe(false);
    }
    for (const code of ['40718263', '4071 8263', '٤٠٧١ ٨٢٦٣']) {
      expect(looksLikeEmailSetupCode(code), code).toBe(true);
    }
  });
});
