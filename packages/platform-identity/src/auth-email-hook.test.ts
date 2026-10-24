import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  type AuthEmailHookDeps,
  HOOK_TIMESTAMP_TOLERANCE_S,
  type HookRequest,
  handleSendEmailHook,
  verifyHookSignature,
} from './auth-email-hook';
import { openTokenHash } from './sign-in-code-seal';

const KEY = Buffer.from('an-hmac-key-for-the-hook-tests-32by', 'utf8');
const SECRET = `v1,whsec_${KEY.toString('base64')}`;
const NOW = 1_800_000_000_000;
const USER = '9d406f51-7e80-4192-9dae-2f3a4b5c6d7e';
const TENANT = '7b2e4d3f-5c6e-4f70-9b8c-0d1e2f3a4b5c';
const EMAIL = 'sara.alharbi@raya.example';
const TOKEN_HASH = 'ab12cd34'.repeat(7);
/** Auth's own one-time password (10 digits: the sign-in code is ours): it must never be e-mailed. */
const AUTH_OTP = '5550123456';

function sign(id: string, timestamp: string, body: string, key: Buffer = KEY): string {
  return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
}

function payload(type = 'magiclink', over: { tokenHash?: string; email?: string } = {}) {
  return JSON.stringify({
    user: { id: USER, email: over.email ?? EMAIL },
    email_data: {
      token: AUTH_OTP,
      token_hash: over.tokenHash ?? TOKEN_HASH,
      email_action_type: type,
      redirect_to: 'https://tms.example.com',
      site_url: 'https://tms.example.com',
    },
  });
}

function request(body = payload(), over: Partial<HookRequest> = {}): HookRequest {
  const id = 'msg_1';
  const timestamp = String(Math.floor(NOW / 1000));
  return {
    body,
    webhookId: id,
    webhookTimestamp: timestamp,
    webhookSignature: sign(id, timestamp, body),
    ...over,
  };
}

const route = {
  route: {
    tenant: null,
    platform: null,
    brandNameAr: 'شركة الراية',
    brandNameEn: 'Al Raya',
    defaultLocale: 'en' as const,
  },
  brand: { actionColor: '#112233', linkColor: '#445566', logoAssetId: null },
};

function setup(
  over: Partial<AuthEmailHookDeps> = {},
  account: Record<string, unknown> | null = {},
) {
  const log = vi.fn();
  const send = vi.fn(() => Promise.resolve({ sender: 'organization' as const }));
  const issue = vi.fn((_input: unknown) =>
    Promise.resolve(
      account === null
        ? null
        : {
            account: {
              email: EMAIL,
              tenantId: TENANT,
              personId: '8c3f5e40-6d7f-4081-8c9d-1e2f3a4b5c6d',
              locale: 'en' as const,
              platformSender: false,
              ...account,
            },
            route,
          },
    ),
  );
  const auditSent = vi.fn((_userId: string, _tenantId: string) => Promise.resolve());
  const claimWebhook = vi.fn((_id: string) => Promise.resolve(true));
  const releaseWebhook = vi.fn((_id: string) => Promise.resolve());
  const allowSend = vi.fn((_userId: string) => Promise.resolve(true));
  const deps: AuthEmailHookDeps = {
    secret: SECRET,
    appBaseUrl: 'https://tms.example.com',
    api: {
      issue,
      verifyCode: vi.fn(() => Promise.resolve({ outcome: 'none' as const })),
      auditSent,
      auditRefused: vi.fn(() => Promise.resolve()),
    },
    sender: { send },
    limiter: { claimWebhook, releaseWebhook, allowSend },
    generateCode: () => '482913',
    now: () => NOW,
    log,
    ...over,
  };
  return { deps, log, send, issue, auditSent, claimWebhook, releaseWebhook, allowSend };
}

describe('the hook signature (standard-webhooks)', () => {
  it('accepts a valid signature, also among several (a secret rotation), and with a bare secret', () => {
    const r = request();
    expect(verifyHookSignature(SECRET, r, NOW)).toBe(true);
    expect(verifyHookSignature(KEY.toString('base64'), r, NOW)).toBe(true);
    expect(verifyHookSignature(`whsec_${KEY.toString('base64')}`, r, NOW)).toBe(true);
    const rotated = {
      ...r,
      webhookSignature: `v1,${Buffer.from('old-signature').toString('base64')} ${r.webhookSignature ?? ''}`,
    };
    expect(verifyHookSignature(SECRET, rotated, NOW)).toBe(true);
  });

  it('refuses a wrong secret, a changed body, a missing header and an old or malformed timestamp', () => {
    const r = request();
    expect(
      verifyHookSignature(`v1,whsec_${Buffer.from('another-key').toString('base64')}`, r, NOW),
    ).toBe(false);
    expect(verifyHookSignature(SECRET, { ...r, body: `${r.body} ` }, NOW)).toBe(false);
    expect(verifyHookSignature(SECRET, { ...r, webhookSignature: null }, NOW)).toBe(false);
    expect(verifyHookSignature(SECRET, { ...r, webhookId: null }, NOW)).toBe(false);
    expect(verifyHookSignature(SECRET, { ...r, webhookSignature: 'v2,abc' }, NOW)).toBe(false);
    const late = NOW + (HOOK_TIMESTAMP_TOLERANCE_S + 5) * 1000;
    expect(verifyHookSignature(SECRET, r, late)).toBe(false);
    expect(verifyHookSignature(SECRET, r, NOW - (HOOK_TIMESTAMP_TOLERANCE_S + 5) * 1000)).toBe(
      false,
    );
    expect(verifyHookSignature(SECRET, { ...r, webhookTimestamp: 'soon' }, NOW)).toBe(false);
    expect(verifyHookSignature('', r, NOW)).toBe(false);
  });
});

describe('the Send Email hook', () => {
  it("sends OUR sign-in code at once through the organization's sender, in its look and language", async () => {
    const { deps, send, auditSent, issue } = setup();
    const answer = await handleSendEmailHook(deps, request());
    expect(answer).toEqual({ status: 200, body: {} });
    expect(send).toHaveBeenCalledTimes(1);
    const message = (send.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(message).toMatchObject({
      to: EMAIL,
      tenantId: TENANT,
      platformOnly: false,
      row: route.route,
    });
    const email = message.email as { subject: string; html: string; text: string };
    expect(email.html).toContain('482 913');
    expect(email.html).toContain('Al Raya');
    expect(email.text).toContain('482913');
    expect(email.subject).not.toContain('482913');
    expect(auditSent).toHaveBeenCalledWith(USER, TENANT);
    // The code that is stored is the one e-mailed.
    expect(issue).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER, code: '482913', actionType: 'magiclink' }),
    );
  });

  it("never e-mails Auth's own one-time password, and stores Auth's token hash only sealed (re-review H1)", async () => {
    const { deps, send, issue } = setup();
    await handleSendEmailHook(deps, request());
    const message = (send.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(JSON.stringify(message.email)).not.toContain(AUTH_OTP);
    const stored = (issue.mock.calls[0] as unknown as [{ sealedTokenHash: string }])[0];
    expect(stored.sealedTokenHash).not.toContain(TOKEN_HASH);
    expect(stored.sealedTokenHash).toMatch(/^v1\./);
    // It opens again for this account only, with the hook secret.
    expect(openTokenHash(SECRET, USER, stored.sealedTokenHash)).toBe(TOKEN_HASH);
    expect(
      openTokenHash(SECRET, '11111111-2222-4333-8444-555555555555', stored.sealedTokenHash),
    ).toBeNull();
  });

  it('makes a fresh six-digit code when none is injected', async () => {
    const { deps, issue } = setup({ generateCode: undefined });
    await handleSendEmailHook(deps, request());
    const stored = (issue.mock.calls[0] as unknown as [{ code: string }])[0];
    expect(stored.code).toMatch(/^[0-9]{6}$/);
  });

  it('an account of several organizations or with a platform role: the platform sender only', async () => {
    const { deps, send } = setup({}, { platformSender: true });
    await handleSendEmailHook(deps, request());
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ platformOnly: true }));
  });

  it('refuses a call without a valid signature before reading anything', async () => {
    const { deps, send, issue, claimWebhook } = setup();
    const bad = request(payload(), { webhookSignature: sign('msg_1', '1', 'other') });
    expect(await handleSendEmailHook(deps, bad)).toMatchObject({ status: 401 });
    expect(issue).not.toHaveBeenCalled();
    expect(claimWebhook).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('without a secret the hook is not configured: 503, nothing is sent', async () => {
    const { deps, send } = setup({ secret: undefined });
    expect(await handleSendEmailHook(deps, request())).toMatchObject({ status: 503 });
    expect(send).not.toHaveBeenCalled();
    const blank = setup({ secret: '  ' });
    expect(await handleSendEmailHook(blank.deps, request())).toMatchObject({ status: 503 });
  });

  it('every other e-mail type is refused safely: nothing is sent, nothing is stored, the type is logged', async () => {
    for (const type of [
      'signup',
      'invite',
      'recovery',
      'email_change',
      'reauthentication',
      'something_new',
    ]) {
      const { deps, send, log, issue } = setup();
      const answer = await handleSendEmailHook(deps, request(payload(type)));
      expect(answer.status).toBe(400);
      expect(answer.body).toHaveProperty('error.http_code', 400);
      expect(send).not.toHaveBeenCalled();
      expect(issue).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('not handled'), { type });
    }
  });

  it('an unreadable or incomplete body is a 400', async () => {
    for (const body of [
      'not json',
      '{}',
      JSON.stringify({ user: { id: 'nope', email: EMAIL }, email_data: {} }),
    ]) {
      const { deps, send } = setup();
      expect(await handleSendEmailHook(deps, request(body))).toMatchObject({ status: 400 });
      expect(send).not.toHaveBeenCalled();
    }
  });

  it('a call without a usable token hash from Auth is not served', async () => {
    for (const tokenHash of [
      '',
      'short',
      'has a space in it that is long enough to pass the length',
    ]) {
      const { deps, send, issue } = setup();
      expect(
        await handleSendEmailHook(deps, request(payload('magiclink', { tokenHash }))),
      ).toMatchObject({ status: 400 });
      expect(send).not.toHaveBeenCalled();
      expect(issue).not.toHaveBeenCalled();
    }
  });

  it("no usable account (nothing stored), or another address than the account's: nothing is sent, a success", async () => {
    const none = setup({}, null);
    expect(await handleSendEmailHook(none.deps, request())).toEqual({ status: 200, body: {} });
    expect(none.send).not.toHaveBeenCalled();
    const other = setup({}, { email: 'someone.else@raya.example' });
    expect(await handleSendEmailHook(other.deps, request())).toEqual({ status: 200, body: {} });
    expect(other.send).not.toHaveBeenCalled();
  });

  it('the same webhook id is acted on once: a replay within five minutes is answered, not repeated (L1)', async () => {
    const { deps, send, issue, claimWebhook, allowSend } = setup();
    claimWebhook.mockResolvedValue(false);
    expect(await handleSendEmailHook(deps, request())).toEqual({ status: 200, body: {} });
    expect(claimWebhook).toHaveBeenCalledWith('msg_1');
    expect(allowSend).not.toHaveBeenCalled();
    expect(issue).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('over the hook limit for the account nothing is stored or sent, and the skip is logged (M-A)', async () => {
    const { deps, send, issue, allowSend, log } = setup();
    allowSend.mockResolvedValue(false);
    expect(await handleSendEmailHook(deps, request())).toEqual({ status: 200, body: {} });
    expect(allowSend).toHaveBeenCalledWith(USER);
    expect(issue).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('too many codes'));
    expect(JSON.stringify(log.mock.calls)).not.toContain('sara');
  });

  it('a limiter that fails closes the hook: a 500, nothing stored or sent', async () => {
    const { deps, send, issue, allowSend } = setup();
    allowSend.mockRejectedValue(new Error('limiter down'));
    expect((await handleSendEmailHook(deps, request())).status).toBe(500);
    expect(issue).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    const replay = setup();
    replay.claimWebhook.mockRejectedValue(new Error('limiter down'));
    expect((await handleSendEmailHook(replay.deps, request())).status).toBe(500);
    expect(replay.send).not.toHaveBeenCalled();
  });

  it('a sender that fails is a 500 with a code only, and the webhook id is given back for a retry', async () => {
    const { deps, send, log, auditSent, releaseWebhook } = setup();
    send.mockRejectedValue(
      Object.assign(new Error('relay said: to sara.alharbi@raya.example 482913'), {
        code: 'SEND_FAILED',
      }),
    );
    const answer = await handleSendEmailHook(deps, request());
    expect(answer.status).toBe(500);
    expect(JSON.stringify(answer)).not.toContain('sara');
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain('SEND_FAILED');
    expect(logged).not.toContain('sara');
    expect(logged).not.toContain('482913');
    expect(auditSent).not.toHaveBeenCalled();
    expect(releaseWebhook).toHaveBeenCalledWith('msg_1');
  });

  it('no sender ready is the same: nothing falls back to another sender', async () => {
    const { deps, send } = setup();
    send.mockRejectedValue(Object.assign(new Error('x'), { code: 'NO_SENDER' }));
    expect((await handleSendEmailHook(deps, request())).status).toBe(500);
  });

  it('a failure to audit never fails the e-mail', async () => {
    const { deps, log, auditSent } = setup();
    auditSent.mockRejectedValue(new Error('db'));
    expect(await handleSendEmailHook(deps, request())).toEqual({ status: 200, body: {} });
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('audit'));
  });

  it('never logs the code or the address on the success path either', async () => {
    const { deps, log } = setup();
    await handleSendEmailHook(deps, request());
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain('482913');
    expect(logged).not.toContain(AUTH_OTP);
    expect(logged).not.toContain('sara');
  });
});

describe('the password reset (type recovery)', () => {
  const facts = {
    email: EMAIL,
    tenantId: TENANT,
    personId: '8c3f5e40-6d7f-4081-8c9d-1e2f3a4b5c6d',
    locale: 'en' as const,
    platformSender: false,
    hasApp: false,
    organizationName: { ar: 'شركة الراية', en: 'Al Raya' },
    brand: { actionColor: '#112233', linkColor: '#445566', logoAssetId: null },
  };

  function recoverySetup(
    over: { facts?: Partial<typeof facts> | null; queue?: boolean; allow?: boolean } = {},
  ) {
    const base = setup();
    const factsFn = vi.fn((_userId: string) =>
      Promise.resolve(over.facts === null ? null : { ...facts, ...over.facts }),
    );
    const queue = vi.fn((_mail: unknown) =>
      Promise.resolve(over.queue === false ? null : { id: 'd1', secret: Buffer.alloc(32, 7) }),
    );
    const scheduled: (() => Promise<unknown>)[] = [];
    const deliver = vi.fn((_ticket: unknown) => Promise.resolve());
    base.allowSend.mockImplementation(() => Promise.resolve(over.allow !== false));
    const deps: AuthEmailHookDeps = {
      ...base.deps,
      recovery: {
        api: { facts: factsFn, queue },
        schedule: (work) => {
          scheduled.push(work);
        },
        deliver,
      },
    };
    return { ...base, deps, factsFn, queue, scheduled, deliver };
  }

  it("queues the reset e-mail with Auth's own token hash in the link's fragment and sends it after the answer", async () => {
    const { deps, queue, scheduled, deliver, send, issue, allowSend } = recoverySetup();
    const answer = await handleSendEmailHook(deps, request(payload('recovery')));
    expect(answer).toEqual({ status: 200, body: {} });
    expect(allowSend).toHaveBeenCalledWith(USER, 'password_reset');
    expect(queue).toHaveBeenCalledTimes(1);
    const mail = queue.mock.calls[0]?.[0] as Record<string, string>;
    expect(mail).toMatchObject({
      userId: USER,
      template: 'platform.password_reset',
      locale: 'en',
      to: EMAIL,
    });
    expect(mail.sourceKey).toMatch(/^recovery:[a-f0-9]{32}$/);
    // The link: the reset page's own format, the token in the fragment, no other secret in the e-mail.
    expect(mail.html).toContain(
      `https://tms.example.com/en/reset-password#token_hash=${TOKEN_HASH}&amp;type=recovery`,
    );
    expect(mail.text).toContain(`#token_hash=${TOKEN_HASH}&type=recovery`);
    expect(mail.html).not.toContain(AUTH_OTP);
    expect(mail.text).not.toContain(AUTH_OTP);
    // Not sent yet: after the answer, through the queued delivery; never the sign-in code's paths.
    expect(deliver).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
    await scheduled[0]?.();
    expect(deliver).toHaveBeenCalledWith({ id: 'd1', secret: Buffer.alloc(32, 7) });
    expect(send).not.toHaveBeenCalled();
    expect(issue).not.toHaveBeenCalled();
  });

  it('an account with an authenticator app: the link says the page will ask for a code', async () => {
    const { deps, queue } = recoverySetup({ facts: { hasApp: true } });
    await handleSendEmailHook(deps, request(payload('recovery')));
    const mail = queue.mock.calls[0]?.[0] as Record<string, string>;
    expect(mail.text).toContain('&type=recovery&mfa=1');
  });

  it('an account of several organizations or with a platform role: the platform-only template', async () => {
    const { deps, queue } = recoverySetup({ facts: { platformSender: true } });
    await handleSendEmailHook(deps, request(payload('recovery')));
    expect(queue.mock.calls[0]?.[0]).toMatchObject({
      template: 'platform.password_reset_platform',
    });
  });

  it('every outcome that is not a failure of ours is a success that tells nothing: no account, another address, over the limit, over the hourly cap', async () => {
    const none = recoverySetup({ facts: null });
    expect(await handleSendEmailHook(none.deps, request(payload('recovery')))).toEqual({
      status: 200,
      body: {},
    });
    expect(none.queue).not.toHaveBeenCalled();
    const other = recoverySetup({ facts: { email: 'someone.else@raya.example' } });
    expect((await handleSendEmailHook(other.deps, request(payload('recovery')))).status).toBe(200);
    expect(other.queue).not.toHaveBeenCalled();
    const limited = recoverySetup({ allow: false });
    expect((await handleSendEmailHook(limited.deps, request(payload('recovery')))).status).toBe(
      200,
    );
    expect(limited.factsFn).not.toHaveBeenCalled();
    expect(limited.queue).not.toHaveBeenCalled();
    const capped = recoverySetup({ queue: false });
    expect((await handleSendEmailHook(capped.deps, request(payload('recovery')))).status).toBe(200);
    expect(capped.scheduled).toHaveLength(0);
  });

  it('a token hash that is not safe for the link, or no usable app origin, sends nothing (and still tells nothing)', async () => {
    const bad = recoverySetup();
    expect(
      (
        await handleSendEmailHook(
          bad.deps,
          request(payload('recovery', { tokenHash: 'has space in it that is long enough' })),
        )
      ).status,
    ).toBe(200);
    expect(bad.queue).not.toHaveBeenCalled();
    const noBase = recoverySetup();
    const answer = await handleSendEmailHook(
      { ...noBase.deps, appBaseUrl: undefined },
      request(payload('recovery')),
    );
    expect(answer.status).toBe(200);
    expect(noBase.queue).not.toHaveBeenCalled();
    const insecure = recoverySetup();
    await handleSendEmailHook(
      { ...insecure.deps, appBaseUrl: 'http://tms.example.com' },
      request(payload('recovery')),
    );
    expect(insecure.queue).not.toHaveBeenCalled();
  });

  it('a repeated signed call is ignored (replay)', async () => {
    const { deps, queue, claimWebhook } = recoverySetup();
    claimWebhook.mockResolvedValue(false);
    expect((await handleSendEmailHook(deps, request(payload('recovery')))).status).toBe(200);
    expect(queue).not.toHaveBeenCalled();
  });

  it('a database failure is a 500 (the id is given back), without the address or the token in the log', async () => {
    const { deps, queue, releaseWebhook, log } = recoverySetup();
    queue.mockRejectedValue(
      Object.assign(new Error(`boom ${EMAIL} ${TOKEN_HASH}`), { code: 'ECONNRESET' }),
    );
    expect(await handleSendEmailHook(deps, request(payload('recovery')))).toMatchObject({
      status: 500,
    });
    expect(releaseWebhook).toHaveBeenCalledWith('msg_1');
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain(EMAIL);
    expect(logged).not.toContain(TOKEN_HASH);
    expect(logged).toContain('ECONNRESET');
  });

  it('a database that is not migrated yet (42883 / 42703, also wrapped) is not sent, answered with success, the code only logged', async () => {
    for (const code of ['42883', '42703']) {
      for (const wrapped of [false, true]) {
        const { deps, factsFn, releaseWebhook, log, scheduled } = recoverySetup();
        const failure = Object.assign(new Error(`function for ${EMAIL} ${TOKEN_HASH} missing`), {
          code,
        });
        factsFn.mockRejectedValue(
          wrapped ? new Error('query failed', { cause: failure }) : failure,
        );
        expect(await handleSendEmailHook(deps, request(payload('recovery')))).toEqual({
          status: 200,
          body: {},
        });
        expect(scheduled).toHaveLength(0);
        expect(releaseWebhook).toHaveBeenCalledWith('msg_1');
        expect(log).toHaveBeenCalledWith('error', expect.stringContaining('not migrated'), {
          reason: code,
        });
        const logged = JSON.stringify(log.mock.calls);
        expect(logged).not.toContain(EMAIL);
        expect(logged).not.toContain(TOKEN_HASH);
      }
    }
  });

  it('without the recovery dependency the type is refused as before', async () => {
    const { deps, send } = setup();
    expect((await handleSendEmailHook(deps, request(payload('recovery')))).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
});
