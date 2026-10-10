import { describe, expect, it, vi } from 'vitest';
import {
  AcceptAsSignedInInput,
  AcceptInvitationInput,
  LookupInvitationInput,
  SignInToAcceptInput,
} from './invite-accept-input';
import { passwordRuleState, utf8Length } from './password-rules';

vi.mock('server-only', () => ({}));

const token = 'sample-invitation-token'.padEnd(43, '0'); // shape only
const valid = {
  token,
  displayNameAr: ' نورة فهد الدوسري ',
  displayNameEn: 'Noura Aldossari',
  password: 'a long enough passphrase',
  confirmPassword: 'a long enough passphrase',
  privacyAcknowledged: true,
};

function issues(input: unknown) {
  const result = AcceptInvitationInput.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
}

describe('passwordRuleState (live rules, screen 8)', () => {
  it('checks length (characters), size (UTF-8 bytes) and the confirmation', () => {
    expect(passwordRuleState('', '')).toEqual({
      min: 12,
      minLength: false,
      maxBytes: true,
      matches: false,
    });
    expect(passwordRuleState('short', 'short')).toEqual({
      min: 12,
      minLength: false,
      maxBytes: true,
      matches: true,
    });
    expect(passwordRuleState('a'.repeat(12), 'a'.repeat(11))).toEqual({
      min: 12,
      minLength: true,
      maxBytes: true,
      matches: false,
    });
    // 37 Arabic letters = 74 bytes: too long for bcrypt although only 37 characters.
    const arabic = 'ك'.repeat(37);
    expect(utf8Length(arabic)).toBe(74);
    expect(passwordRuleState(arabic, arabic)).toEqual({
      min: 12,
      minLength: true,
      maxBytes: false,
      matches: true,
    });
    expect(passwordRuleState('ك'.repeat(36), '').maxBytes).toBe(true);
  });
});

describe('AcceptInvitationInput', () => {
  it('accepts a complete form and trims the display names', () => {
    const parsed = AcceptInvitationInput.parse(valid);
    expect(parsed.displayNameAr).toBe('نورة فهد الدوسري');
    expect(AcceptInvitationInput.parse({ ...valid, displayNameAr: undefined }).displayNameAr).toBe(
      undefined,
    );
  });

  it('refuses a malformed token', () => {
    for (const bad of [
      '',
      'short',
      `${token}A`,
      `${token.slice(0, 42)}=`,
      `${token.slice(0, 42)}/`,
    ]) {
      expect(issues({ ...valid, token: bad })).toEqual(['token']);
    }
  });

  it('applies the password rules: 12+ characters, at most 72 bytes, confirmation equal', () => {
    expect(issues({ ...valid, password: 'short', confirmPassword: 'short' })).toEqual(['password']);
    const long = 'ك'.repeat(37);
    expect(issues({ ...valid, password: long, confirmPassword: long })).toEqual(['password']);
    expect(issues({ ...valid, confirmPassword: 'something else' })).toEqual(['confirmPassword']);
  });

  it('requires the privacy acknowledgement', () => {
    expect(issues({ ...valid, privacyAcknowledged: false })).toEqual(['privacyAcknowledged']);
    expect(issues({ ...valid, privacyAcknowledged: undefined })).toEqual(['privacyAcknowledged']);
  });

  it('limits display names to 200 characters and refuses unknown fields', () => {
    expect(issues({ ...valid, displayNameEn: 'x'.repeat(201) })).toEqual(['displayNameEn']);
    expect(issues({ ...valid, email: 'attacker@example.test' })).toEqual(['']);
  });

  it('refuses display names without visible text; empty keeps the organization’s name', () => {
    const invisible = [
      '‏‏', // right-to-left marks
      '​‍', // zero-width space and joiner
      '​ ​', // spaces between zero-width characters (not trimmed)
      '⁦⁩', // isolates
    ];
    for (const name of invisible) {
      expect(issues({ ...valid, displayNameAr: name }), JSON.stringify(name)).toEqual([
        'displayNameAr',
      ]);
      expect(issues({ ...valid, displayNameEn: name }), JSON.stringify(name)).toEqual([
        'displayNameEn',
      ]);
    }
    const blank = AcceptInvitationInput.parse({ ...valid, displayNameAr: '   ' });
    expect(blank.displayNameAr).toBe('');
    // Marks next to visible letters are fine.
    expect(issues({ ...valid, displayNameAr: '‏نورة' })).toEqual([]);
    const result = AcceptInvitationInput.safeParse({ ...valid, displayNameAr: '‏' });
    expect(result.success ? null : result.error.issues[0]?.message).toBe('invisible');
  });
});

describe('sign-in-to-accept and signed-in inputs', () => {
  it('take only the token (and the password), never an e-mail', () => {
    expect(SignInToAcceptInput.safeParse({ token, password: 'x' }).success).toBe(true);
    expect(SignInToAcceptInput.safeParse({ token, password: '' }).success).toBe(false);
    expect(
      SignInToAcceptInput.safeParse({ token, password: 'x', email: 'a@example.test' }).success,
    ).toBe(false);
    expect(AcceptAsSignedInInput.safeParse({ token }).success).toBe(true);
    expect(AcceptAsSignedInInput.safeParse({ token: 'nope' }).success).toBe(false);
  });

  it('the link lookup takes a well-formed token only', () => {
    expect(LookupInvitationInput.safeParse({ token }).success).toBe(true);
    expect(LookupInvitationInput.safeParse({ token: `${token}=` }).success).toBe(false);
    expect(LookupInvitationInput.safeParse({ token, locale: 'ar' }).success).toBe(false);
  });
});
