import ar from '@jadarat/platform-i18n/messages/ar.json';
import en from '@jadarat/platform-i18n/messages/en.json';
import { describe, expect, it } from 'vitest';
import {
  inviteFragment,
  inviteTokenFromHash,
  splitLinkMessage,
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
});
