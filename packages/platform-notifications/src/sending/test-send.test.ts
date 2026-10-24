import type { InlineEmailTestApi, InlineEmailTestTicket } from '@jadarat/platform-db';
import { describe, expect, it, vi } from 'vitest';
import { credentialsContext, sealCredentials } from '../credentials-seal';
import { deriveCredentialsKeyPair } from './credentials';
import { emailTestErrorCode, sendEmailTest, sendInlineEmailTest } from './test-send';
import { EmailSendError, type EmailTransport } from './transport';

const TENANT = 'a0000000-0000-4000-8000-000000000001';
const keys = deriveCredentialsKeyPair(
  'test-test-test-test-test-test-test-test-test-test-test-test',
);

function test(over: Partial<{ tenantId: string | null }> = {}) {
  const tenantId = 'tenantId' in over ? (over.tenantId ?? null) : TENANT;
  const scope =
    tenantId === null ? ({ kind: 'platform' } as const) : ({ kind: 'tenant', tenantId } as const);
  return {
    tenantId,
    recipient: 'it@raya.example',
    version: 3,
    provider: 'resend',
    options: {},
    credentialsSealed: sealCredentials(keys.publicKey, credentialsContext(scope, 'resend', {}), {
      apiKey: 're_xxxxxxxxxxxx',
    }),
    fromName: 'Al Raya',
    fromAddress: 'hr@raya.example',
    replyTo: null,
  };
}

function transport(send: EmailTransport['send']) {
  const t = { provider: 'resend', send: vi.fn(send), close: vi.fn(() => Promise.resolve()) };
  return { t, transportFor: vi.fn(() => t as unknown as EmailTransport) };
}

describe('sending a test e-mail through the settings being tested', () => {
  it('opens the saved secrets for their scope and sends one sample e-mail to the chosen recipient', async () => {
    const { t, transportFor } = transport(() => Promise.resolve({ providerMessageId: 'm' }));
    await sendEmailTest(test(), { keys, transportFor });
    expect(transportFor).toHaveBeenCalledWith(
      'resend',
      {},
      { apiKey: 're_xxxxxxxxxxxx' },
      expect.objectContaining({ organization: true }),
    );
    expect(t.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'it@raya.example',
        from: { name: 'Al Raya', address: 'hr@raya.example' },
      }),
    );
    expect(t.close).toHaveBeenCalled();
  });

  it("the platform sender's test is sealed for the platform scope", async () => {
    const { transportFor } = transport(() => Promise.resolve({ providerMessageId: null }));
    await sendEmailTest(test({ tenantId: null }), { keys, transportFor });
    expect(transportFor).toHaveBeenCalledWith(
      'resend',
      {},
      expect.anything(),
      expect.objectContaining({ organization: false }),
    );
  });

  it('refuses without the key, with a provider it does not know, or with secrets sealed for another scope', async () => {
    const { transportFor } = transport(() => Promise.resolve({ providerMessageId: null }));
    await expect(sendEmailTest(test(), { keys: null, transportFor })).rejects.toMatchObject({
      code: 'CREDENTIALS_KEY_MISSING',
    });
    await expect(
      sendEmailTest({ ...test(), provider: 'carrier-pigeon' }, { keys, transportFor }),
    ).rejects.toMatchObject({ code: 'PROVIDER_SETTINGS_INVALID' });
    await expect(
      sendEmailTest(
        { ...test(), tenantId: 'b0000000-0000-4000-8000-000000000001' },
        { keys, transportFor },
      ),
    ).rejects.toBeInstanceOf(Error);
    expect(transportFor).not.toHaveBeenCalled();
  });

  it('closes the transport also when sending fails', async () => {
    const { t, transportFor } = transport(() =>
      Promise.reject(new EmailSendError('REJECTED', true)),
    );
    await expect(sendEmailTest(test(), { keys, transportFor })).rejects.toMatchObject({
      code: 'REJECTED',
    });
    expect(t.close).toHaveBeenCalled();
  });

  it('shows our codes only', () => {
    expect(emailTestErrorCode(new EmailSendError('REJECTED', true))).toBe('REJECTED');
    expect(emailTestErrorCode(new Error('to it@raya.example'))).toBe('SEND_FAILED');
  });
});

describe("the web app's immediate test", () => {
  const ticket = (): InlineEmailTestTicket => ({ secret: Buffer.alloc(32, 5), test: test() });
  function setup(send: EmailTransport['send']) {
    const { transportFor } = transport(send);
    const finish = vi.fn((..._args: unknown[]) => Promise.resolve(true));
    const log = vi.fn();
    return {
      finish,
      log,
      deps: { api: { finish } as unknown as InlineEmailTestApi, keys, transportFor, log },
    };
  }

  it("sends and records it with the request's secret and the version it tested", async () => {
    const { deps, finish, log } = setup(() => Promise.resolve({ providerMessageId: 'm' }));
    const t = ticket();
    expect(await sendInlineEmailTest(deps, t)).toBe('sent');
    expect(finish).toHaveBeenCalledWith(t.secret, 3, { sent: true });
    expect(log).toHaveBeenCalledWith(
      'info',
      expect.stringContaining("organization's provider sent (verified)"),
    );
  });

  it('a failure is recorded with our code, never the address', async () => {
    const { deps, finish, log } = setup(() => Promise.reject(new EmailSendError('REJECTED', true)));
    expect(await sendInlineEmailTest(deps, ticket())).toBe('failed');
    expect(finish).toHaveBeenCalledWith(expect.anything(), 3, {
      sent: false,
      errorCode: 'REJECTED',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('raya.example');
  });

  it('an outcome that cannot be recorded is left to the worker, without throwing', async () => {
    const { deps, finish, log } = setup(() => Promise.resolve({ providerMessageId: null }));
    finish.mockRejectedValue(new Error('db'));
    expect(await sendInlineEmailTest(deps, ticket())).toBe('error');
    expect(log).toHaveBeenCalledWith('error', expect.stringContaining('worker will redo it'));
  });
});
