import type {
  EmailTestClaim,
  SystemTx,
  WithPlatformTx,
  WithSystemTx,
} from '@jadarat/platform-db/jobs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { credentialsContext, sealCredentials } from '../credentials-seal';
import { deriveCredentialsKeyPair } from '../sending/credentials';
import {
  createEmailHousekeepingTask,
  createEmailResumeTask,
  createEmailTestTask,
} from './email-tasks';
import type { EmailRouter } from './router';
import { EMAIL_QUEUED_EVENT } from './sender';
import { EmailSendError, type EmailTransport } from '../sending/transport';

const db = vi.hoisted(() => ({
  claimEmailTests: vi.fn(),
  finishEmailTest: vi.fn(),
  isEmailSettingsMissing: (error: unknown) => (error as { code?: string }).code === '42883',
  listTenantsWaitingForSender: vi.fn(),
  publishEmailCredentialsKey: vi.fn(),
  sweepEmailDeliveries: vi.fn(),
  takeWaitingDeliveries: vi.fn(),
}));
vi.mock('@jadarat/platform-db/jobs', () => db);
const events = vi.hoisted(() => ({ emitEvent: vi.fn() }));
vi.mock('@jadarat/platform-db', () => events);

const TENANT = 'a0000000-0000-4000-8000-000000000001';
const keys = deriveCredentialsKeyPair(
  'a-generated-64-character-secret-for-the-task-tests-0123456789ab',
);
const tx = {} as SystemTx;
const withPlatformTx: WithPlatformTx = (_actor, fn) => fn(tx);
const withSystemTx: WithSystemTx = (_actor, fn) => fn(tx);

function claim(over: Partial<EmailTestClaim> = {}): EmailTestClaim {
  return {
    tenantId: TENANT,
    recipient: 'it@raya.example',
    version: 2,
    provider: 'resend',
    options: {},
    credentialsSealed: sealCredentials(
      keys.publicKey,
      credentialsContext({ kind: 'tenant', tenantId: TENANT }, 'resend'),
      {
        apiKey: 're_tenant_key_1',
      },
    ),
    fromName: 'Al Raya Training',
    fromAddress: 'training@raya.example',
    replyTo: 'hr@raya.example',
    ...over,
  };
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('test e-mails (Save and send test / Send test e-mail)', () => {
  it('publishes the worker key, sends the test through exactly the tested settings, verifies on success', async () => {
    db.publishEmailCredentialsKey.mockResolvedValue(false);
    db.claimEmailTests.mockResolvedValueOnce([claim()]).mockResolvedValue([]);
    db.finishEmailTest.mockResolvedValue(true);
    const send = vi.fn<EmailTransport['send']>(() => Promise.resolve({ providerMessageId: 'm1' }));
    const transportFor = vi.fn(() => ({ provider: 'resend' as const, send }));
    const log = vi.fn();
    const task = createEmailTestTask({ keys, withPlatformTx, log, transportFor });
    expect(await task.run({ jobId: 'j1' })).toBe(false);
    expect(db.publishEmailCredentialsKey).toHaveBeenCalledWith(tx, keys.publicKey);
    // One test claimed at a time (nothing is left claimed while another is being sent).
    expect(db.claimEmailTests).toHaveBeenCalledWith(tx, 1);
    expect(db.claimEmailTests).toHaveBeenCalledTimes(2);
    expect(transportFor).toHaveBeenCalledWith(
      'resend',
      {},
      { apiKey: 're_tenant_key_1' },
      expect.objectContaining({ organization: true }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { name: 'Al Raya Training', address: 'training@raya.example' },
        replyTo: 'hr@raya.example',
        to: 'it@raya.example',
        subject: 'Test message · رسالة تجريبية',
      }),
    );
    expect(db.finishEmailTest).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ tenantId: TENANT, version: 2 }),
      { sent: true },
    );
    expect(log).toHaveBeenCalledWith(
      'info',
      "test e-mail of the organization's provider sent (verified)",
    );
    // The key is published once per process.
    db.claimEmailTests.mockResolvedValue([]);
    await task.run({ jobId: 'j2' });
    expect(db.publishEmailCredentialsKey).toHaveBeenCalledTimes(1);
  });

  it('records a failure with our code, never the provider text or the secret', async () => {
    db.publishEmailCredentialsKey.mockResolvedValue(true);
    db.claimEmailTests.mockResolvedValue([]).mockResolvedValueOnce([
      claim({
        tenantId: null,
        provider: 'resend',
        credentialsSealed: sealCredentials(
          keys.publicKey,
          credentialsContext({ kind: 'platform' }, 'resend'),
          { apiKey: 're_platform_1' },
        ),
      }),
    ]);
    const log = vi.fn();
    const transportFor = vi.fn(() => ({
      provider: 'resend' as const,
      send: () => Promise.reject(new EmailSendError('PROVIDER_AUTH', false)),
    }));
    await createEmailTestTask({ keys, withPlatformTx, log, transportFor }).run({ jobId: 'j' });
    expect(transportFor).toHaveBeenCalledWith(
      'resend',
      {},
      { apiKey: 're_platform_1' },
      expect.objectContaining({ organization: false }),
    );
    expect(db.finishEmailTest).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ tenantId: null }),
      {
        sent: false,
        errorCode: 'PROVIDER_AUTH',
      },
    );
    expect(log).toHaveBeenCalledWith(
      'warning',
      expect.stringContaining('new e-mail credentials key'),
    );
    expect(log).toHaveBeenCalledWith(
      'warning',
      'test e-mail of the platform sender not sent (PROVIDER_AUTH)',
    );
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/re_platform|it@raya/);
  });

  it('without the worker key the test fails with CREDENTIALS_KEY_MISSING; secrets of another key with CREDENTIALS_KEY_CHANGED', async () => {
    db.claimEmailTests.mockResolvedValue([]).mockResolvedValueOnce([claim()]);
    await createEmailTestTask({ keys: null, withPlatformTx, log: vi.fn() }).run({ jobId: 'j' });
    expect(db.publishEmailCredentialsKey).not.toHaveBeenCalled();
    expect(db.finishEmailTest).toHaveBeenLastCalledWith(tx, expect.anything(), {
      sent: false,
      errorCode: 'CREDENTIALS_KEY_MISSING',
    });
    const rotated = deriveCredentialsKeyPair(
      'another-64-character-secret-after-a-rotation-0123456789abcdefgh',
    );
    db.claimEmailTests.mockResolvedValue([]).mockResolvedValueOnce([claim()]);
    await createEmailTestTask({ keys: rotated, withPlatformTx, log: vi.fn() }).run({ jobId: 'j' });
    expect(db.finishEmailTest).toHaveBeenLastCalledWith(tx, expect.anything(), {
      sent: false,
      errorCode: 'CREDENTIALS_KEY_CHANGED',
    });
  });

  it('a full batch asks for another pass; a database not migrated yet is not an error', async () => {
    db.claimEmailTests.mockResolvedValue([claim()]);
    db.finishEmailTest.mockResolvedValue(false);
    const transportFor = vi.fn(() => ({
      provider: 'resend' as const,
      send: () => Promise.resolve({ providerMessageId: null }),
    }));
    expect(
      await createEmailTestTask({ keys: null, withPlatformTx, log: vi.fn(), transportFor }).run({
        jobId: 'j',
      }),
    ).toBe(true);
    expect(db.claimEmailTests).toHaveBeenCalledTimes(5);
    db.claimEmailTests.mockRejectedValue(Object.assign(new Error('missing'), { code: '42883' }));
    expect(
      await createEmailTestTask({ keys: null, withPlatformTx, log: vi.fn() }).run({ jobId: 'j' }),
    ).toBe(false);
    db.claimEmailTests.mockRejectedValue(new Error('connection lost'));
    await expect(
      createEmailTestTask({ keys: null, withPlatformTx, log: vi.fn() }).run({ jobId: 'j' }),
    ).rejects.toThrow('connection lost');
  });

  it('stops claiming once the pass has used its time budget (slow providers cannot hold the worker)', async () => {
    db.claimEmailTests.mockResolvedValue([claim()]);
    db.finishEmailTest.mockResolvedValue(false);
    let clock = 0;
    const transportFor = vi.fn(() => ({
      provider: 'resend' as const,
      send: () => {
        clock += 60_000; // each send takes up to its 60-second deadline
        return Promise.reject(new EmailSendError('TIMEOUT', false));
      },
    }));
    expect(
      await createEmailTestTask({
        keys,
        withPlatformTx,
        log: vi.fn(),
        transportFor,
        now: () => clock,
      }).run({ jobId: 'j' }),
    ).toBe(true);
    // 0 s and 60 s are within the 90-second budget; at 120 s the pass stops (the next one continues).
    expect(db.claimEmailTests).toHaveBeenCalledTimes(2);
    expect(db.finishEmailTest).toHaveBeenLastCalledWith(tx, expect.anything(), {
      sent: false,
      errorCode: 'TIMEOUT',
    });
  });
});

describe('waiting messages are queued again once a sender is ready', () => {
  const router = (kind: 'send' | 'wait'): EmailRouter => ({
    resolve: () =>
      Promise.resolve(
        kind === 'send'
          ? {
              kind,
              transport: { provider: 'resend', send: vi.fn() },
              from: { name: 'A', address: 'a@x.example' },
              sender: 'platform',
            }
          : { kind, code: 'NO_SENDER' },
      ),
    close: () => Promise.resolve(),
  });

  it('queues the waiting messages of an organization whose sender is ready, with new events', async () => {
    db.listTenantsWaitingForSender.mockResolvedValue([{ tenantId: TENANT, waiting: 2 }]);
    db.takeWaitingDeliveries.mockResolvedValue(['d1', 'd2']);
    const log = vi.fn();
    expect(
      await createEmailResumeTask({
        router: router('send'),
        withPlatformTx,
        withSystemTx,
        log,
      }).run({ jobId: 'j' }),
    ).toBe(false);
    expect(events.emitEvent).toHaveBeenCalledWith(tx, {
      type: EMAIL_QUEUED_EVENT,
      subject: 'd1',
      data: { resumed: true },
    });
    expect(events.emitEvent).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith('info', '2 waiting e-mails queued again');
  });

  it('leaves them waiting while no sender is ready', async () => {
    db.listTenantsWaitingForSender.mockResolvedValue([{ tenantId: TENANT, waiting: 2 }]);
    await createEmailResumeTask({
      router: router('wait'),
      withPlatformTx,
      withSystemTx,
      log: vi.fn(),
    }).run({ jobId: 'j' });
    expect(db.takeWaitingDeliveries).not.toHaveBeenCalled();
    expect(events.emitEvent).not.toHaveBeenCalled();
    db.listTenantsWaitingForSender.mockRejectedValue(
      Object.assign(new Error('missing'), { code: '42883' }),
    );
    expect(
      await createEmailResumeTask({
        router: router('send'),
        withPlatformTx,
        withSystemTx,
        log: vi.fn(),
      }).run({ jobId: 'j' }),
    ).toBe(false);
  });
});

describe('delivery log housekeeping (T-M2-48)', () => {
  it('sweeps at most every 10 minutes, logs counts only', async () => {
    let now = 0;
    db.sweepEmailDeliveries.mockResolvedValue({ stale: 1, expired: 2, purged: 3, testsExpired: 4 });
    const log = vi.fn();
    const task = createEmailHousekeepingTask({ withPlatformTx, log, now: () => now });
    expect(await task.run({ jobId: 'j' })).toBe(false);
    expect(log).toHaveBeenCalledWith(
      'warning',
      'e-mail deliveries recorded as failed: 1 stale, 2 waited too long for a sender',
    );
    expect(log).toHaveBeenCalledWith('info', '3 delivery log rows older than 12 months removed');
    expect(log).toHaveBeenCalledWith(
      'warning',
      '4 test e-mails left unsent for 7 days recorded as failed',
    );
    now = 5 * 60_000;
    await task.run({ jobId: 'j' });
    expect(db.sweepEmailDeliveries).toHaveBeenCalledTimes(1);
    now = 11 * 60_000;
    db.sweepEmailDeliveries.mockResolvedValue({
      stale: 500,
      expired: 0,
      purged: 0,
      testsExpired: 0,
    });
    expect(await task.run({ jobId: 'j' })).toBe(true);
    db.sweepEmailDeliveries.mockResolvedValue({ stale: 0, expired: 0, purged: 0, testsExpired: 0 });
    expect(await task.run({ jobId: 'j' })).toBe(false); // a full batch: no wait before the next pass
    expect(db.sweepEmailDeliveries).toHaveBeenCalledTimes(3);
    db.sweepEmailDeliveries.mockRejectedValue(
      Object.assign(new Error('missing'), { code: '42883' }),
    );
    now = 30 * 60_000;
    expect(await task.run({ jobId: 'j' })).toBe(false);
  });
});
