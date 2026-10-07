import type { SystemTx } from '@jadarat/platform-db/jobs';
import type { DeliveredEvent, InTenant } from '@jadarat/platform-jobs/jobs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMAIL_MAX_ATTEMPTS, EMAIL_QUEUED_EVENT, createEmailSender } from './sender';
import { EmailSendError, type EmailTransport } from './transport';

const db = vi.hoisted(() => ({
  claimEmailDelivery: vi.fn(),
  finishEmailDelivery: vi.fn(),
  discardInactiveTenantDelivery: vi.fn(),
}));
vi.mock('@jadarat/platform-db/jobs', () => db);

const ID = '5b0e7c39-6d4c-4d36-9d0a-1f0d1d6c0f11';
const event: DeliveredEvent = {
  id: 'e1',
  tenantId: 't1',
  type: EMAIL_QUEUED_EVENT,
  version: 1,
  subject: ID,
  data: { template: 'platform.invitation' },
  actorType: 'system',
  actorId: null,
  actorJob: 'platform.events.deliver:1',
  correlationId: null,
  createdAt: new Date(),
};
const claimed = {
  id: ID,
  destination: 'sara@example.com',
  subject: 's',
  html: 'h',
  text: 't',
  attempts: 1,
};
const from = { name: 'ENTLAQA LMS', address: 'noreply@lms.entlaqa.com' };
const tx = {} as SystemTx;
const inTenant: InTenant = (fn) => fn(tx);

function transport(send: EmailTransport['send']): EmailTransport {
  return { provider: 'resend', send };
}

const run = (t: EmailTransport | null, attempt = 1, log = vi.fn()) =>
  createEmailSender({ transport: t, from, log }).perform({
    event,
    inTenant,
    attempt,
    maxAttempts: EMAIL_MAX_ATTEMPTS,
  });

afterEach(() => {
  vi.resetAllMocks();
});

describe('e-mail sender', () => {
  it('sends a claimed delivery with its id as idempotency key and records it as sent', async () => {
    db.claimEmailDelivery.mockResolvedValue(claimed);
    const send = vi.fn<EmailTransport['send']>(() =>
      Promise.resolve({ providerMessageId: 'msg_1' }),
    );
    await run(transport(send));
    expect(db.claimEmailDelivery).toHaveBeenCalledWith(tx, ID);
    expect(send).toHaveBeenCalledWith({
      from,
      to: 'sara@example.com',
      subject: 's',
      html: 'h',
      text: 't',
      idempotencyKey: ID,
    });
    expect(db.finishEmailDelivery).toHaveBeenCalledWith(tx, ID, {
      status: 'sent',
      provider: 'resend',
      providerMessageId: 'msg_1',
    });
  });

  it("asks the router for the organization's transport and sender (FR-NTF-11 seam, R2)", async () => {
    db.claimEmailDelivery.mockResolvedValue(claimed);
    const own = vi.fn<EmailTransport['send']>(() =>
      Promise.resolve({ providerMessageId: 'own_1' }),
    );
    const platform = vi.fn<EmailTransport['send']>();
    const ownFrom = { name: 'Al Raya', address: 'training@raya.example' };
    const router = vi.fn(() => ({
      transport: { provider: 'smtp' as const, send: own },
      from: ownFrom,
    }));
    await createEmailSender({ transport: transport(platform), from, log: vi.fn(), router }).perform(
      {
        event,
        inTenant,
        attempt: 1,
        maxAttempts: EMAIL_MAX_ATTEMPTS,
      },
    );
    expect(router).toHaveBeenCalledWith('t1');
    expect(platform).not.toHaveBeenCalled();
    expect(own).toHaveBeenCalledWith(
      expect.objectContaining({ from: ownFrom, idempotencyKey: ID }),
    );
    expect(db.finishEmailDelivery).toHaveBeenCalledWith(tx, ID, {
      status: 'sent',
      provider: 'smtp',
      providerMessageId: 'own_1',
    });
  });

  it('does nothing for a delivery already finished, or an event without subject', async () => {
    db.claimEmailDelivery.mockResolvedValue(null);
    const send = vi.fn<EmailTransport['send']>();
    await run(transport(send));
    await createEmailSender({ transport: transport(send), from, log: vi.fn() }).perform({
      event: { ...event, subject: null },
      inTenant,
      attempt: 1,
      maxAttempts: EMAIL_MAX_ATTEMPTS,
    });
    expect(send).not.toHaveBeenCalled();
    expect(db.finishEmailDelivery).not.toHaveBeenCalled();
  });

  it('records the delivery as suppressed when e-mail is switched off', async () => {
    db.claimEmailDelivery.mockResolvedValue(claimed);
    const log = vi.fn();
    await run(null, 1, log);
    expect(db.finishEmailDelivery).toHaveBeenCalledWith(tx, ID, {
      status: 'suppressed',
      errorCode: 'EMAIL_DISABLED',
    });
    expect(log).toHaveBeenCalledWith('warning', expect.stringContaining('suppressed'));
  });

  it('a temporary failure returns the delivery to the queue and fails the job (retry)', async () => {
    db.claimEmailDelivery.mockResolvedValue(claimed);
    const t = transport(() => Promise.reject(new EmailSendError('RATE_LIMIT_EXCEEDED', false)));
    await expect(run(t, 3)).rejects.toMatchObject({ code: 'RATE_LIMIT_EXCEEDED' });
    expect(db.finishEmailDelivery).toHaveBeenCalledWith(tx, ID, {
      status: 'retry',
      errorCode: 'RATE_LIMIT_EXCEEDED',
    });
  });

  it('a final refusal, or the last attempt, records the delivery as failed', async () => {
    db.claimEmailDelivery.mockResolvedValue(claimed);
    const log = vi.fn();
    await run(
      transport(() => Promise.reject(new EmailSendError('ADDRESS_REJECTED', true))),
      1,
      log,
    );
    expect(db.finishEmailDelivery).toHaveBeenLastCalledWith(tx, ID, {
      status: 'failed',
      errorCode: 'ADDRESS_REJECTED',
    });
    expect(log).toHaveBeenCalledWith(
      'error',
      'e-mail not delivered (ADDRESS_REJECTED); recorded as failed',
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('sara');

    await run(
      transport(() => Promise.reject(new Error('socket hang up'))),
      EMAIL_MAX_ATTEMPTS,
    );
    expect(db.finishEmailDelivery).toHaveBeenLastCalledWith(tx, ID, {
      status: 'failed',
      errorCode: 'SEND_FAILED',
    });
  });

  it('a retry after a temporary failure claims the same delivery and sends with the same key', async () => {
    db.claimEmailDelivery.mockResolvedValue(claimed);
    const send = vi
      .fn<EmailTransport['send']>()
      .mockRejectedValueOnce(new EmailSendError('NETWORK_ERROR', false))
      .mockResolvedValueOnce({ providerMessageId: 'msg_2' });
    await expect(run(transport(send), 1)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    db.claimEmailDelivery.mockResolvedValue({ ...claimed, attempts: 2 });
    await run(transport(send), 2);
    expect(send.mock.calls.map(([email]) => email.idempotencyKey)).toEqual([ID, ID]);
    expect(db.finishEmailDelivery).toHaveBeenLastCalledWith(tx, ID, {
      status: 'sent',
      provider: 'resend',
      providerMessageId: 'msg_2',
    });
  });

  it('a delivery held by another sender is tried again later, and left to it on the last attempt', async () => {
    db.claimEmailDelivery.mockResolvedValue('busy');
    const send = vi.fn<EmailTransport['send']>();
    await expect(run(transport(send), 1)).rejects.toMatchObject({ code: 'DELIVERY_BUSY' });
    await run(transport(send), EMAIL_MAX_ATTEMPTS);
    expect(send).not.toHaveBeenCalled();
    expect(db.finishEmailDelivery).not.toHaveBeenCalled();
  });

  it('ignores e-mail events that a job did not write', async () => {
    const log = vi.fn();
    const send = vi.fn<EmailTransport['send']>();
    await createEmailSender({ transport: transport(send), from, log }).perform({
      event: { ...event, actorType: 'user', actorId: 'u1', actorJob: null },
      inTenant,
      attempt: 1,
      maxAttempts: EMAIL_MAX_ATTEMPTS,
    });
    expect(db.claimEmailDelivery).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('warning', 'e-mail event not written by a job; ignored');
  });

  it('on the last attempt, a database failure still removes the content (failed)', async () => {
    db.claimEmailDelivery.mockResolvedValue(claimed);
    db.finishEmailDelivery
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce(undefined);
    const send = vi.fn<EmailTransport['send']>(() =>
      Promise.resolve({ providerMessageId: 'msg_3' }),
    );
    await expect(run(transport(send), EMAIL_MAX_ATTEMPTS)).rejects.toThrow('connection lost');
    expect(db.finishEmailDelivery).toHaveBeenLastCalledWith(tx, ID, {
      status: 'failed',
      errorCode: 'DELIVERY_ERROR',
    });
    // Suspended meanwhile (the failed update finds no row): discarded instead.
    db.finishEmailDelivery
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockRejectedValueOnce(new Error('no longer being sent'));
    db.discardInactiveTenantDelivery.mockResolvedValueOnce(true);
    await expect(run(transport(send), EMAIL_MAX_ATTEMPTS)).rejects.toThrow('connection lost');
    expect(db.discardInactiveTenantDelivery).toHaveBeenCalledWith(tx, ID);
    // Earlier attempts leave it to the retry; the best-effort clean-up's own failure is not reported.
    db.claimEmailDelivery.mockRejectedValue(new Error('connection lost'));
    db.finishEmailDelivery.mockRejectedValue(new Error('connection lost'));
    db.discardInactiveTenantDelivery.mockRejectedValue(new Error('connection lost'));
    await expect(run(transport(send), EMAIL_MAX_ATTEMPTS)).rejects.toThrow('connection lost');
    db.finishEmailDelivery.mockClear();
    await expect(run(transport(send), 1)).rejects.toThrow('connection lost');
    expect(db.finishEmailDelivery).not.toHaveBeenCalled();
  });

  it('discards the waiting delivery of a suspended organization', async () => {
    const log = vi.fn();
    const sender = createEmailSender({ transport: null, from, log });
    db.discardInactiveTenantDelivery.mockResolvedValue(true);
    await sender.discard?.({ event, inTenant });
    expect(db.discardInactiveTenantDelivery).toHaveBeenCalledWith(tx, ID);
    expect(log).toHaveBeenCalledWith('warning', expect.stringContaining('discarded'));
    log.mockClear();
    db.discardInactiveTenantDelivery.mockResolvedValue(false);
    await sender.discard?.({ event, inTenant });
    await sender.discard?.({ event: { ...event, subject: null }, inTenant });
    expect(db.discardInactiveTenantDelivery).toHaveBeenCalledTimes(2);
    expect(log).not.toHaveBeenCalled();
  });
});
