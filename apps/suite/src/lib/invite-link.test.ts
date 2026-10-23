import ar from '@jadarat/platform-i18n/messages/ar.json';
import en from '@jadarat/platform-i18n/messages/en.json';
import { describe, expect, it } from 'vitest';
import {
  inviteCodeFromHash,
  inviteFragment,
  inviteLink,
  inviteTokenFromHash,
  signUpFragment,
  splitLinkMessage,
  splitTaggedMessage,
  withOrganization,
} from './invite-link';

const token = 'sample-invitation-token'.padEnd(43, '0'); // shape only

describe('inviteTokenFromHash (the token travels in the URL fragment)', () => {
  it('reads the token of #token=… with or without the leading #', () => {
    expect(inviteTokenFromHash(`#token=${token}`)).toBe(token);
    expect(inviteTokenFromHash(`token=${token}`)).toBe(token);
    expect(inviteTokenFromHash(`#other=1&token=${token}`)).toBe(token);
  });

  it('is null without a token', () => {
    for (const hash of ['', '#', '#token=', '#tok=abc', '#abc']) {
      expect(inviteTokenFromHash(hash), hash).toBeNull();
    }
  });

  it('round-trips through the fragment the language switch adds', () => {
    expect(inviteFragment(token)).toBe(`#token=${token}`);
    expect(inviteTokenFromHash(inviteFragment(token))).toBe(token);
    expect(inviteFragment(null)).toBe('');
    // Anything unexpected is encoded, never injected into the URL.
    expect(inviteTokenFromHash(inviteFragment('a&b=c#d'))).toBe('a&b=c#d');
  });
});

describe('invitation codes in the sign-up link (Kawadir)', () => {
  it('reads #code=… and the older #token=… links', () => {
    expect(inviteCodeFromHash('#code=K7M2PQ9XHT4W')).toBe('K7M2PQ9XHT4W');
    expect(inviteCodeFromHash('code=k7m2pq9xht4w')).toBe('k7m2pq9xht4w');
    expect(inviteCodeFromHash(`#token=${token}`)).toBe(token);
    for (const hash of ['', '#', '#code=', '#code=%20', '#other=1']) {
      expect(inviteCodeFromHash(hash), hash).toBeNull();
    }
  });

  it('builds the copyable link from the origin, the invitation language and the code', () => {
    expect(inviteLink('https://tms.example.com/', 'ar', 'K7M2PQ9XHT4W')).toBe(
      'https://tms.example.com/ar/sign-up#code=K7M2PQ9XHT4W',
    );
    expect(inviteLink('http://localhost:3000', 'en', 'K7M2-PQ9X-HT4W')).toBe(
      'http://localhost:3000/en/sign-up#code=K7M2PQ9XHT4W',
    );
    expect(signUpFragment(null)).toBe('');
    expect(inviteCodeFromHash(signUpFragment('a&b=c#d'))).toBe('a&b=c#d');
  });
});

describe('raw invite messages on the client', () => {
  it('fill the organization and split the privacy link (both languages)', () => {
    for (const messages of [ar, en]) {
      const parts = splitLinkMessage(withOrganization(messages.invite.privacy, 'الراية'));
      expect(parts.link).not.toBe('');
      expect(`${parts.before}${parts.link}${parts.after}`).toContain('الراية');
      expect(`${parts.before}${parts.after}`).not.toMatch(/[<>{}]/);
      expect(withOrganization(messages.invite.welcomeTitle, 'Al Raya')).toContain('Al Raya');
      expect(withOrganization(messages.invite.signedIn.invitee, 'Al Raya')).not.toContain('{');
    }
  });

  it('a message without a link stays whole', () => {
    expect(splitLinkMessage('plain')).toEqual({ before: 'plain', link: '', after: '' });
  });

  it('splits the password-reset messages around their bold part and link (T-M2-08)', () => {
    for (const messages of [ar, en]) {
      const validity = splitTaggedMessage(messages.passwordReset.sent.validity, 'b');
      expect(validity.inner).toMatch(/10/);
      const link = splitTaggedMessage(messages.passwordReset.reset.validity, 'link');
      expect(link.inner).not.toBe('');
      for (const part of [validity, link]) {
        expect(`${part.before}${part.inner}${part.after}`).not.toMatch(/[<>]/);
      }
    }
    expect(splitTaggedMessage('a <b>b', 'b')).toEqual({ before: 'a <b>b', inner: '', after: '' });
    expect(splitTaggedMessage('a </b>b<b>', 'b')).toEqual({
      before: 'a </b>b<b>',
      inner: '',
      after: '',
    });
  });
});
