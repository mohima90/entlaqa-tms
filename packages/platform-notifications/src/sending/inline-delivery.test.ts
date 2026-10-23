import type { ClaimedInlineMail, InlineClaim, InlineMailApi } from '@jadarat/platform-db';
import { describe, expect, it, vi } from 'vitest';
import { sendInlineDelivery } from './inline-delivery';
import type { InlineEmailRouter } from './router';
import { EmailSendError, type EmailRoute, type EmailTransport } from './transport';

const ID = '5b0e7c39-6d4c-4d36-9d0a-1f0d1d6c0f11';
const TENANT = 'a0000000-0000-4000-8000-000000000001';
const SECRET = Buffer.alloc(32, 7);

const mail: ClaimedInlineMail = {
  tenantId: TENANT,
  template: 'platform.invitation',
  destination: 'sara@example.test',
  subject: 'Invitation',
  html: '<p>Hello</p>',
  text: 'Hello',
  attempts: 1,
  route: {
    tenant: null,
    platform: null,
    brandNameAr: 'x',
    brandNameEn: 'X',
    defaultLocale: 'en',
  },
};

function setup(over: { claim?: InlineClaim; route?: EmailRoute; send?: EmailTransport['send'] } = {}) {
  const send = vi.fn(
    over.send ?? (() => Promise.resolve({ providerMessageId: 'msg-1' as string | null })),
  );
  const transport = { provider: 'resend', send } as unknown as EmailTransport;
  const route: EmailRoute = over.route ?? {
    kind: 'send',
    transport,
    from: { name: 'Org', address: 'no-reply@example.test' },
    sender: 'organization',
  };
  const fromRow = vi.fn(() => route);
  const claim = vi.fn(() =>
    Promise.resolve<InlineClaim>(over.claim ?? { outcome: 'claimed', mail }),
  );
  const finish = vi.fn((..._args: unknown[]) => Promise.resolve(true));
  const log = vi.fn();
  const deps = {
    api: { claim, finish } as unknown as InlineMailApi,
    router: { fromRow } as unknown as Pick<InlineEmailRouter, 'fromRow'>,
    log,
  };
  return { deps, claim, finish, send, fromRow, log };
}

describe('immediate sending of a message the web app queued', () => {
  it('claims with the request\'s secret, sends with the delivery id as idempotency key and records it as sent', async () => {
    const { deps, claim, finish, send, fromRow } = setup();
    expect(await sendInlineDelivery(deps, ID, SECRET)).toBe('sent');
    expect(claim).toHaveBeenCalledWith(ID, SECRET);
    expect(fromRow).toHaveBeenCalledWith(mail.route, TENANT, { platformOnly: false });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'sara@example.test',
        subject: 'Invitation',
        html: '<p>Hello</p>',
        text: 'Hello',
        idempotencyKey: ID,
      }),
    );
    expect(finish).toHaveBeenCalledWith(ID, SECRET, {
      status: 'sent',
      provider: 'resend',
      providerMessageId: 'msg-1',
      sender: 'organization',
    });
  });

  it('an account-opening template goes through the platform sender only', async () => {
    const { deps, fromRow } = setup({
      claim: { outcome: 'claimed', mail: { ...mail, template: 'platform.password_reset_platform' } },
    });
    await sendInlineDelivery(deps, ID, SECRET);
    expect(fromRow).toHaveBeenCalledWith(mail.route, TENANT, { platformOnly: true });
  });

  it('does nothing when the lease is held elsewhere or the message is gone', async () => {
    for (const outcome of ['busy', 'gone'] as const) {
      const { deps, finish, send } = setup({ claim: { outcome } });
      expect(await sendInlineDelivery(deps, ID, SECRET)).toBe(outcome);
      expect(send).not.toHaveBeenCalled();
      expect(finish).not.toHaveBeenCalled();
    }
  });

  it('a claim that fails leaves the message to the worker', async () => {
    const { deps, claim, log, send } = setup();
    claim.mockRejectedValue(Object.assign(new Error('db'), { code: 'ECONNRESET' }));
    expect(await sendInlineDelivery(deps, ID, SECRET)).toBe('error');
    expect(send).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('worker will send'), {
      reason: 'ECONNRESET',
    });
  });

  it('no sender ready: the message waits in the queue with the reason', async () => {
    const { deps, finish, send } = setup({ route: { kind: 'wait', code: 'NO_SENDER' } });
    expect(await sendInlineDelivery(deps, ID, SECRET)).toBe('waiting');
    expect(send).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith(ID, SECRET, { status: 'retry', errorCode: 'NO_SENDER' });
  });

  it('a refusal a retry cannot fix is recorded as failed, with the provider and whose sender it was', async () => {
    const { deps, finish } = setup({
      send: () => Promise.reject(new EmailSendError('INVALID_ADDRESS', true)),
    });
    expect(await sendInlineDelivery(deps, ID, SECRET)).toBe('failed');
    expect(finish).toHaveBeenCalledWith(ID, SECRET, {
      status: 'failed',
      errorCode: 'INVALID_ADDRESS',
      provider: 'resend',
      sender: 'organization',
    });
  });

  it('a temporary failure puts it back to the queue for the worker', async () => {
    const { deps, finish } = setup({
      send: () => Promise.reject(new EmailSendError('PROVIDER_DOWN', false)),
    });
    expect(await sendInlineDelivery(deps, ID, SECRET)).toBe('retry');
    expect(finish).toHaveBeenCalledWith(ID, SECRET, { status: 'retry', errorCode: 'PROVIDER_DOWN' });
    // Anything else thrown by a transport is a temporary SEND_FAILED.
    const odd = setup({ send: () => Promise.reject(new Error('boom to sara@example.test')) });
    expect(await sendInlineDelivery(odd.deps, ID, SECRET)).toBe('retry');
    expect(odd.finish).toHaveBeenCalledWith(ID, SECRET, { status: 'retry', errorCode: 'SEND_FAILED' });
    expect(JSON.stringify(odd.log.mock.calls)).not.toContain('sara');
  });

  it('a failure to record the outcome is logged, never thrown (the lease runs out and the worker takes over)', async () => {
    const { deps, finish, log } = setup();
    finish.mockRejectedValue(Object.assign(new Error('db'), { code: 'ECONNRESET' }));
    expect(await sendInlineDelivery(deps, ID, SECRET)).toBe('sent');
    expect(log).toHaveBeenCalledWith('error', expect.stringContaining('could not record'), {
      reason: 'ECONNRESET',
    });
    finish.mockResolvedValue(false);
    expect(await sendInlineDelivery(deps, ID, SECRET)).toBe('sent');
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('not recorded'));
  });

  it('never logs the address, the content or the secret', async () => {
    const { deps, log } = setup({
      send: () => Promise.reject(new EmailSendError('INVALID_ADDRESS', true)),
    });
    await sendInlineDelivery(deps, ID, SECRET);
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain('sara@example.test');
    expect(logged).not.toContain('Hello');
    expect(logged).not.toContain(SECRET.toString('hex'));
  });
});
