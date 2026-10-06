import { describe, expect, it } from 'vitest';
import { readEmailSettings } from './config';

const CA = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';
const from = { EMAIL_FROM_ADDRESS: 'noreply@lms.entlaqa.com', EMAIL_FROM_NAME: 'ENTLAQA LMS' };

describe('readEmailSettings', () => {
  it('is off only when chosen: the provider must always be set', () => {
    const settings = readEmailSettings({ EMAIL_PROVIDER: 'none' });
    expect(settings.provider).toBe('none');
    expect(settings.createTransport()).toBeNull();
    expect(() => readEmailSettings({})).toThrow(/EMAIL_PROVIDER must be set/);
    expect(() => readEmailSettings({ EMAIL_PROVIDER: ' ' })).toThrow(/EMAIL_PROVIDER must be set/);
  });

  it('Resend: the sender and an API key', () => {
    const settings = readEmailSettings({
      ...from,
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_testtesttest', // sample, not a key
    });
    expect(settings).toMatchObject({
      provider: 'resend',
      from: { name: 'ENTLAQA LMS', address: 'noreply@lms.entlaqa.com' },
    });
    expect(settings.createTransport()?.provider).toBe('resend');
    expect(
      readEmailSettings({
        EMAIL_PROVIDER: 'resend',
        EMAIL_FROM_ADDRESS: 'a@b.co',
        RESEND_API_KEY: 're_abcdefgh',
      }).from.name,
    ).toBe('Jadarat');
  });

  it('SMTP: a URL and an optional CA (inline or file)', () => {
    const settings = readEmailSettings(
      {
        ...from,
        EMAIL_PROVIDER: 'smtp',
        SMTP_URL: 'smtp://mailpit:1025',
        SMTP_CA_CERT_FILE: '/run/ca.crt',
      },
      (path) => (path === '/run/ca.crt' ? CA : ''),
    );
    expect(settings.createTransport()?.provider).toBe('smtp');
    expect(
      readEmailSettings({
        ...from,
        EMAIL_PROVIDER: 'smtp',
        SMTP_URL: 'smtp://localhost:1025',
        SMTP_CA_CERT: CA,
      }).provider,
    ).toBe('smtp');
  });

  it('names the variable at fault, never its value', () => {
    const cases: [NodeJS.ProcessEnv, RegExp][] = [
      [{ EMAIL_PROVIDER: 'ses' }, /EMAIL_PROVIDER/],
      [{ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_abcdefgh' }, /EMAIL_FROM_ADDRESS/],
      [
        {
          ...from,
          EMAIL_FROM_NAME: 'A\nBcc: x',
          EMAIL_PROVIDER: 'resend',
          RESEND_API_KEY: 're_abcdefgh',
        },
        /EMAIL_FROM_NAME/,
      ],
      [{ ...from, EMAIL_PROVIDER: 'resend' }, /RESEND_API_KEY/],
      [{ ...from, EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'sk_live_secret' }, /RESEND_API_KEY/],
      [{ ...from, EMAIL_PROVIDER: 'smtp' }, /SMTP_URL/],
      [
        { ...from, EMAIL_PROVIDER: 'smtp', SMTP_URL: 'smtp://x', SMTP_CA_CERT: 'nope' },
        /SMTP_CA_CERT/,
      ],
    ];
    for (const [env, pattern] of cases) {
      let message = '';
      try {
        readEmailSettings(env);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toMatch(pattern);
      expect(message).not.toContain('sk_live_secret');
    }
  });
});
