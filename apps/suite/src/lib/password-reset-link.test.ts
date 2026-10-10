import { describe, expect, it, vi } from 'vitest';
import { CompletePasswordResetInput, RequestPasswordResetInput } from './password-reset-input';
import {
  PASSWORD_RESET_NOTICE,
  formatCountdown,
  linkIsSpent,
  minutesText,
  noticeFrom,
  pathAfterReset,
  resetFragment,
  resetLinkFromHash,
  resetTokenFromHash,
  withMinutesInWords,
} from './password-reset-link';

vi.mock('server-only', () => ({}));

const token = 'sample0token0hash'.padEnd(56, '0'); // shape only

describe('resetTokenFromHash (the token travels in the URL fragment)', () => {
  it('reads the token of a recovery link, with or without the leading #', () => {
    expect(resetTokenFromHash(`#token_hash=${token}&type=recovery`)).toBe(token);
    expect(resetTokenFromHash(`type=recovery&token_hash=${token}`)).toBe(token);
  });

  it('is null without a token or for another kind of Auth link', () => {
    for (const hash of [
      '',
      '#',
      '#token_hash=&type=recovery',
      `#token_hash=${token}`,
      `#token_hash=${token}&type=signup`,
      `#token_hash=${token}&type=email_change`,
      '#access_token=abc&type=recovery',
    ]) {
      expect(resetTokenFromHash(hash), hash).toBeNull();
    }
  });

  it('round-trips through the fragment the language switch adds; never injects', () => {
    expect(resetFragment(token)).toBe(`#token_hash=${token}&type=recovery`);
    expect(resetTokenFromHash(resetFragment(token))).toBe(token);
    expect(resetFragment(null)).toBe('');
    expect(resetFragment('a&type=signup#x')).toBe(
      '#token_hash=a%26type%3Dsignup%23x&type=recovery',
    );
    expect(resetTokenFromHash(resetFragment('a&type=signup#x'))).toBe('a&type=signup#x');
  });
});

describe('a link for an account with an authenticator app (T-M2-10)', () => {
  it('says the code will be asked (`&mfa=1`), and keeps saying it across the language switch', () => {
    expect(resetLinkFromHash(`#token_hash=${token}&type=recovery&mfa=1`)).toEqual({
      token,
      needsCode: true,
    });
    expect(resetLinkFromHash(`#token_hash=${token}&type=recovery`)).toEqual({
      token,
      needsCode: false,
    });
    expect(resetLinkFromHash(`#token_hash=${token}&type=recovery&mfa=yes`)?.needsCode).toBe(false);
    expect(resetLinkFromHash(`#token_hash=${token}&mfa=1`)).toBeNull();
    expect(resetFragment(token, true)).toBe(`#token_hash=${token}&type=recovery&mfa=1`);
    expect(resetLinkFromHash(resetFragment(token, true))).toEqual({ token, needsCode: true });
  });
});

describe('formatCountdown (resend after a minute, screen 10)', () => {
  it('shows m:ss and never a negative time', () => {
    expect(formatCountdown(60)).toBe('1:00');
    expect(formatCountdown(45)).toBe('0:45');
    expect(formatCountdown(9.2)).toBe('0:10');
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-3)).toBe('0:00');
  });
});

describe('after an answer of the reset action', () => {
  it('asks for a new link once the single-use link is spent (or was never valid)', () => {
    for (const code of [
      'PASSWORD_RESET_LINK_INVALID',
      'PASSWORD_RESET_SAME_PASSWORD',
      'PASSWORD_RESET_WEAK_PASSWORD',
      'PASSWORD_RESET_BREACHED_PASSWORD',
      'PASSWORD_RESET_PASSWORD_REJECTED',
      'PASSWORD_RESET_TOO_SHORT',
      'PASSWORD_RESET_CODE_REQUIRED',
      'PASSWORD_RESET_CODE_INVALID',
      'PASSWORD_RESET_CODE_LIMITED',
    ]) {
      expect(linkIsSpent(code), code).toBe(true);
    }
    // The link still works after these: the form stays.
    for (const code of ['RATE_LIMITED', 'VALIDATION_FAILED', 'INTERNAL_ERROR', 'NOT_CONFIGURED']) {
      expect(linkIsSpent(code), code).toBe(false);
    }
  });

  it('says when to ask for a new link in words (integration review M1), with Arabic number agreement', () => {
    expect(['ar', 'en'].map((l) => minutesText(l as 'ar' | 'en', 1))).toEqual([
      'دقيقة واحدة',
      '1 minute',
    ]);
    expect(minutesText('ar', 2)).toBe('دقيقتين');
    expect(minutesText('ar', 10)).toBe('10 دقائق');
    expect(minutesText('ar', 15)).toBe('15 دقيقة');
    expect(minutesText('en', 15)).toBe('15 minutes');
    expect(minutesText('en', 0.2)).toBe('1 minute');
    const limited = {
      code: 'PASSWORD_RESET_CODE_LIMITED',
      messageKey: 'passwordReset.errors.codeLimited',
      params: { minutes: 15 },
    };
    expect(withMinutesInWords(limited, 'ar').params).toEqual({ minutes: '15 دقيقة' });
    expect(withMinutesInWords(limited, 'en').params).toEqual({ minutes: '15 minutes' });
    // Any other answer is left as it is.
    const other = { code: 'PASSWORD_RESET_TOO_SHORT', params: { min: 14 } };
    expect(withMinutesInWords(other, 'ar')).toBe(other);
  });

  it('goes on to sign in, with the notice', () => {
    expect(pathAfterReset('ar')).toBe('/ar/sign-in?notice=password-reset');
    expect(pathAfterReset('en')).toBe('/en/sign-in?notice=password-reset');
  });

  it('shows only the known notice', () => {
    expect(noticeFrom({ notice: PASSWORD_RESET_NOTICE })).toBe(PASSWORD_RESET_NOTICE);
    expect(noticeFrom({ notice: 'session-ended' })).toBe('session-ended');
    expect(noticeFrom({ notice: 'anything-else' })).toBeNull();
    expect(noticeFrom({ notice: [PASSWORD_RESET_NOTICE] })).toBeNull();
    expect(noticeFrom({})).toBeNull();
  });
});

describe('password-reset inputs', () => {
  it('screen 10: a bounded e-mail address and the page language, nothing else', () => {
    expect(
      RequestPasswordResetInput.safeParse({ email: 'a@example.test', locale: 'ar' }).success,
    ).toBe(true);
    expect(RequestPasswordResetInput.safeParse({ email: 'a', locale: 'ar' }).success).toBe(false);
    expect(
      RequestPasswordResetInput.safeParse({ email: 'a@example.test', locale: 'ar', x: 1 }).success,
    ).toBe(false);
  });

  it('screen 11: the token is required; the password rules are those of My profile', () => {
    const password = 'a long enough passphrase';
    expect(
      CompletePasswordResetInput.safeParse({
        tokenHash: token,
        password,
        confirmPassword: password,
      }).success,
    ).toBe(true);
    expect(
      CompletePasswordResetInput.safeParse({ password, confirmPassword: password }).success,
    ).toBe(false);
    expect(
      CompletePasswordResetInput.safeParse({
        tokenHash: token,
        password: 'ب'.repeat(36),
        confirmPassword: 'ب'.repeat(36),
      }).success,
    ).toBe(true);
    expect(
      CompletePasswordResetInput.safeParse({
        tokenHash: token,
        password: 'eleven char',
        confirmPassword: 'eleven char',
      }).success,
    ).toBe(false);
  });
});
