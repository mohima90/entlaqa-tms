import { EmailProviderInput } from '@jadarat/platform-notifications';
import { describe, expect, it } from 'vitest';
import { reasonText } from './email-reasons';
import {
  fieldOfPath,
  providerFormValues,
  providerInput,
  providerLabel,
  secretsLeftEmpty,
  templateKey,
} from './email-settings-form';

describe('e-mail settings form (WP-ADM-01)', () => {
  it('starts from what is saved, never a secret', () => {
    const values = providerFormValues({
      provider: 'smtp',
      options: { host: 'smtp.raya.example', port: 465, security: 'tls', username: 'mailer' },
    });
    expect(values).toMatchObject({
      provider: 'smtp',
      smtpHost: 'smtp.raya.example',
      smtpPort: '465',
      smtpSecurity: 'tls',
      smtpUsername: 'mailer',
      smtpPassword: '',
      apiKey: '',
    });
    expect(providerFormValues(null)).toMatchObject({
      provider: 'resend',
      smtpPort: '587',
      mailgunRegion: 'us',
    });
    expect(providerFormValues({ provider: 'postmark', options: {} }).provider).toBe('resend');
  });

  it('builds a valid action input for every provider; empty secrets keep the saved ones', () => {
    const base = providerFormValues(null);
    const cases = [
      { ...base, provider: 'resend' as const, apiKey: ' re_abcdefgh123 ' },
      { ...base, provider: 'sendgrid' as const, apiKey: 'SG.abcdefghij.klmnopqrstuv' },
      {
        ...base,
        provider: 'mailgun' as const,
        apiKey: 'key-12345678',
        mailgunDomain: 'mg.raya.example',
        mailgunRegion: 'eu' as const,
      },
      {
        ...base,
        provider: 'smtp' as const,
        smtpHost: 'smtp.raya.example',
        smtpPort: '587',
        smtpUsername: 'u',
        smtpPassword: 'p w',
      },
      {
        ...base,
        provider: 'microsoft_graph' as const,
        graphTenantId: 'raya.example',
        graphClientId: '11111111-2222-3333-4444-555555555555',
        graphClientSecret: 'secret-value-1',
      },
    ];
    for (const values of cases) {
      expect(
        EmailProviderInput.safeParse(providerInput(values, false)).success,
        values.provider,
      ).toBe(true);
    }
    expect(providerInput(cases[0]!, false)).toEqual({
      provider: 'resend',
      options: {},
      secrets: { apiKey: 're_abcdefgh123' },
    });
    const keep = { ...cases[3]!, smtpPassword: '' };
    expect(secretsLeftEmpty(keep)).toBe(true);
    expect(providerInput(keep, true)).toMatchObject({ secrets: null });
    // Without a usable saved secret, an empty field is sent (and refused where a secret is required).
    expect(providerInput({ ...cases[0]!, apiKey: '' }, false)).toMatchObject({
      secrets: { apiKey: '' },
    });
    expect(
      EmailProviderInput.safeParse(providerInput({ ...cases[0]!, apiKey: '' }, false)).success,
    ).toBe(false);
    expect(providerInput({ ...cases[3]!, smtpPort: 'abc' }, false)).toMatchObject({
      options: { port: -1 },
    });
  });

  it('maps server field paths to the form fields', () => {
    expect(fieldOfPath('provider.options.host', 'smtp')).toBe('smtpHost');
    expect(fieldOfPath('provider.options.tenantId', 'microsoft_graph')).toBe('graphTenantId');
    expect(fieldOfPath('provider.secrets.apiKey', 'resend')).toBe('apiKey');
    expect(fieldOfPath('provider.secrets.password', 'smtp')).toBe('smtpPassword');
    expect(fieldOfPath('provider.secrets', 'microsoft_graph')).toBe('graphClientSecret');
    expect(fieldOfPath('provider.provider', 'resend')).toBe('provider');
    expect(fieldOfPath('fromAddress', 'resend')).toBe('fromAddress');
  });

  it('names providers, e-mail kinds and reasons', () => {
    expect(providerLabel('microsoft_graph')).toBe('Microsoft 365');
    expect(providerLabel('x')).toBe('x');
    expect(templateKey('platform.invitation')).toBe('invitation');
    expect(templateKey('tms.something')).toBe('other');
    const texts = {
      'reasons.PROVIDER_AUTH': 'refused',
      'reasons.other': 'failed ({code})',
      'reasons.SEND_FAILED': 'not sent',
    };
    expect(reasonText('PROVIDER_AUTH', texts)).toBe('refused');
    expect(reasonText('HTTP_418', texts)).toBe('failed (HTTP_418)');
    expect(reasonText(null, texts)).toBe('not sent');
    expect(reasonText('<script>', texts)).toBe('not sent');
  });
});
