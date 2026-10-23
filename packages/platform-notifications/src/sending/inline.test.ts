import type { EmailRouteRow } from '@jadarat/platform-db';
import { describe, expect, it, vi } from 'vitest';
import { createInlineEmailRouter, createInlineEmailSender } from './inline';
import { EmailSendError, type EmailRoute } from './transport';

const email = { subject: 'Your sign-in code', html: '<p>482 913</p>', text: '482913' };
const row: EmailRouteRow = {
  tenant: null,
  platform: null,
  brandNameAr: 'الراية',
  brandNameEn: 'Al Raya',
  defaultLocale: 'en',
};

describe('sending at once from the web tier (the Send Email hook)', () => {
  it('sends through the transport of the sender rule, with a one-off idempotency key, and says whose sender it was', async () => {
    const send = vi.fn(() => Promise.resolve({ providerMessageId: 'm1' }));
    const fromRow = vi.fn((): EmailRoute => ({
      kind: 'send',
      transport: { provider: 'resend', send },
      from: { name: 'Al Raya', address: 'no-reply@jadarat.example' },
      replyTo: 'hr@raya.example',
      sender: 'platform',
    }));
    const sender = createInlineEmailSender({ fromRow });
    await expect(
      sender.send({ row, tenantId: 't1', platformOnly: true, to: 'sara@example.test', email }),
    ).resolves.toEqual({ sender: 'platform' });
    expect(fromRow).toHaveBeenCalledWith(row, 't1', { platformOnly: true });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'sara@example.test',
        subject: email.subject,
        html: email.html,
        text: email.text,
        replyTo: 'hr@raya.example',
        idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
      }),
    );
    // The organization's own sender stays available when the platform sender is not required.
    await sender.send({ row, tenantId: 't1', platformOnly: false, to: 'a@b.test', email });
    expect(fromRow).toHaveBeenLastCalledWith(row, 't1', undefined);
  });

  it('no sender ready: the error names the reason - nothing falls back to another sender', async () => {
    const sender = createInlineEmailSender({
      fromRow: () => ({ kind: 'wait', code: 'NO_SENDER' }),
    });
    await expect(
      sender.send({ row: null, tenantId: 't1', platformOnly: false, to: 'a@b.test', email }),
    ).rejects.toMatchObject({ code: 'NO_SENDER', permanent: false });
    await expect(
      sender.send({ row: null, tenantId: 't1', platformOnly: false, to: 'a@b.test', email }),
    ).rejects.toBeInstanceOf(EmailSendError);
  });

  it('a provider failure reaches the caller as its own code', async () => {
    const sender = createInlineEmailSender({
      fromRow: () => ({
        kind: 'send',
        transport: {
          provider: 'resend',
          send: () => Promise.reject(new EmailSendError('PROVIDER_REJECTED', true)),
        },
        from: { name: 'x', address: 'a@b.test' },
        sender: 'organization',
      }),
    });
    await expect(
      sender.send({ row, tenantId: 't1', platformOnly: false, to: 'a@b.test', email }),
    ).rejects.toMatchObject({ code: 'PROVIDER_REJECTED' });
  });
});

describe("the web tier's router from its environment", () => {
  it('without any key or installation sender nothing can be sent (the message waits for a sender)', () => {
    const log = vi.fn();
    const router = createInlineEmailRouter({}, log);
    expect(router.fromRow(row, 't1')).toEqual({ kind: 'wait', code: 'NO_SENDER' });
    expect(router.fromRow(null, 't1')).toEqual({ kind: 'wait', code: 'NO_SENDER' });
    expect(log).not.toHaveBeenCalled();
  });

  it('a key that cannot be used is logged by name, never by value', () => {
    const log = vi.fn();
    createInlineEmailRouter({ EMAIL_CREDENTIALS_KEY: 'too-short' }, log);
    expect(log).toHaveBeenCalledWith('error', expect.stringContaining('EMAIL_CREDENTIALS_KEY'));
    expect(JSON.stringify(log.mock.calls)).not.toContain('too-short');
  });

  it('an installation sender (self-hosted operator) is used while no platform sender was saved', () => {
    const router = createInlineEmailRouter(
      {
        EMAIL_PROVIDER: 'resend',
        EMAIL_FROM_ADDRESS: 'no-reply@jadarat.example',
        RESEND_API_KEY: 're_xxxxxxxxxxxx',
      },
      vi.fn(),
    );
    expect(router.fromRow(row, 't1')).toMatchObject({ kind: 'send', sender: 'installation' });
  });

  it('installation settings that cannot be used are logged and leave that part off', () => {
    const log = vi.fn();
    const router = createInlineEmailRouter({ EMAIL_PROVIDER: 'resend' }, log);
    expect(log).toHaveBeenCalledWith('error', expect.stringContaining('installation sender'));
    expect(router.fromRow(row, 't1')).toEqual({ kind: 'wait', code: 'NO_SENDER' });
  });
});
