import { describe, expect, it } from 'vitest';
import { MFA_LINK_KINDS, mfaLinkFragment, mfaLinkPath, mfaLinkTokenFromHash } from './mfa-link';

const token = 'T'.repeat(43); // shape only: 32 random bytes, base64url

describe('the authenticator set-up e-mail links (T-M2-10, review H1)', () => {
  it('read the token from the URL fragment only', () => {
    expect(mfaLinkTokenFromHash(`#token=${token}`)).toBe(token);
    expect(mfaLinkTokenFromHash(`token=${token}`)).toBe(token);
    for (const hash of ['', '#', '#token=', `#other=${token}`]) {
      expect(mfaLinkTokenFromHash(hash), hash).toBeNull();
    }
  });

  it('keep an unused link working across the language switch; never inject', () => {
    expect(mfaLinkFragment(token)).toBe(`#token=${token}`);
    expect(mfaLinkTokenFromHash(mfaLinkFragment(token))).toBe(token);
    expect(mfaLinkFragment(null)).toBe('');
    expect(mfaLinkTokenFromHash(mfaLinkFragment('a&b=c#d'))).toBe('a&b=c#d');
  });

  it('open fixed pages of the suite only', () => {
    expect(MFA_LINK_KINDS).toEqual(['confirm', 'remove']);
    expect(mfaLinkPath('ar', 'confirm')).toBe('/ar/mfa/confirm');
    expect(mfaLinkPath('en', 'remove')).toBe('/en/mfa/remove');
  });
});
