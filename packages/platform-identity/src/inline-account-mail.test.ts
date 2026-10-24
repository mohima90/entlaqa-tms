import type {
  ClaimsTx,
  InlineAccountMailClaim,
  InlineAccountMailSend,
  InlineAccountMailTicket,
} from '@jadarat/platform-db';
import { describe, expect, it, vi } from 'vitest';
import { hashMfaSetupCode } from './account-mail-compose';
import { type InlineAccountMailerDeps, createInlineAccountMailer } from './inline-account-mail';

const REQUEST = '6a1f3c2e-4b5d-4e6f-8a7b-9c0d1e2f3a4b';
const FACTOR = 'f3000000-0000-4000-8000-0000000000a1';
const BASE = 'https://tms.example.com';
const SECRET = Buffer.alloc(32, 3);
const ticket: InlineAccountMailTicket = { secret: SECRET };

const send: InlineAccountMailSend = {
  outcome: 'send',
  requestId: REQUEST,
  kind: 'password_changed',
  userId: '5b0e7c39-6d4c-4d36-9d0a-1f0d1d6c0f11',
  tenantId: 'a0000000-0000-4000-8000-000000000001',
  personId: 'a1000000-0000-4000-8000-0000000000a1',
  email: 'noura.alqahtani@raya.example',
  locale: 'en',
  attempt: 1,
  factorId: null,
  mfaReason: null,
  detail: null,
  lockMinutes: null,
  organizationName: { ar: 'شركة الراية', en: 'Al Raya' },
  recipientName: { ar: 'نورة', en: 'Noura' },
  recentCount: 0,
  quietCount: 0,
  tenantRecentCount: 0,
  platformSender: false,
  changedByName: null,
  setUpAt: null,
  setupUserAgent: null,
  brand: { actionColor: '#112233', linkColor: '#445566', logoAssetId: null },
};

function setup(claims: InlineAccountMailClaim[], over: Partial<InlineAccountMailerDeps> = {}) {
  const queue = vi.fn((_secret: Buffer, _id: string, _mail: unknown) =>
    Promise.resolve<string | null>('d1'),
  );
  const done = vi.fn((_secret: Buffer, _id: string) => Promise.resolve(true));
  const claim = vi.fn((_secret: Buffer, _quiet: number) =>
    Promise.resolve<InlineAccountMailClaim>(claims.shift() ?? { outcome: 'none' }),
  );
  const deliver = vi.fn((_id: string, _secret: Buffer) => Promise.resolve());
  const log = vi.fn();
  const scheduled: (() => Promise<unknown>)[] = [];
  const tag = vi.fn((_tx: ClaimsTx) => Promise.resolve<InlineAccountMailTicket | null>(ticket));
  const mailer = createInlineAccountMailer({
    configured: () => true,
    base: () => BASE,
    api: { claim, queue, done },
    tag,
    schedule: (work) => {
      scheduled.push(work);
    },
    deliver,
    lockoutMail: { personQuietHours: 24, tenantPerHour: 50 },
    log,
    ...over,
  });
  return { mailer, claim, queue, done, deliver, log, scheduled, tag };
}

describe('the claimed requests of one web request', () => {
  it("claims with the request's secret, writes the worker's wording, queues the delivery and sends it", async () => {
    const { mailer, claim, queue, deliver, done } = setup([send]);
    await mailer.run(ticket);
    expect(claim).toHaveBeenCalledWith(SECRET, 24 * 60);
    expect(queue).toHaveBeenCalledTimes(1);
    const [, id, mail] = queue.mock.calls[0] ?? [];
    expect(id).toBe(REQUEST);
    expect(mail).toMatchObject({
      template: 'platform.password_changed',
      locale: 'en',
      templateVersion: expect.any(Number),
    });
    const content = mail as { subject: string; html: string; text: string };
    expect(content.text).toContain(`${BASE}/en/forgot-password`);
    expect(content.html).toContain('#112233');
    expect(deliver).toHaveBeenCalledWith('d1', SECRET);
    expect(done).not.toHaveBeenCalled();
    // The loop ended on `none`: one more claim asked.
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it('every request in turn; ones the database answered (held, banned, …) are skipped; nothing is sent for them', async () => {
    const { mailer, queue, deliver, log } = setup([
      { outcome: 'held', requestId: REQUEST, kind: 'password_changed' },
      { ...send, requestId: '7b2e4d3f-5c6e-4f70-9b8c-0d1e2f3a4b5c', kind: 'sign_in_unlocked' },
      { outcome: 'banned', requestId: REQUEST, kind: 'mfa_code_locked' },
    ]);
    await mailer.run(ticket);
    expect(queue).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('info', 'account e-mail not sent (password_changed: held)');
    expect(log).toHaveBeenCalledWith('info', 'account e-mail not sent (mfa_code_locked: banned)');
  });

  it("the worker's caps: a request over a cap is removed without an e-mail; a security notice over the hourly cap is sent and logged", async () => {
    const capped = setup([{ ...send, kind: 'sign_in_unlocked', recentCount: 5 }]);
    await capped.mailer.run(ticket);
    expect(capped.done).toHaveBeenCalledWith(SECRET, REQUEST);
    expect(capped.queue).not.toHaveBeenCalled();
    expect(capped.log).toHaveBeenCalledWith(
      'info',
      'account e-mail not sent (sign_in_unlocked: hourly_cap)',
    );

    const lockedAlready = setup([
      { ...send, kind: 'account_locked', lockMinutes: 15, quietCount: 1 },
    ]);
    await lockedAlready.mailer.run(ticket);
    expect(lockedAlready.done).toHaveBeenCalledTimes(1);
    expect(lockedAlready.queue).not.toHaveBeenCalled();

    const security = setup([{ ...send, kind: 'password_changed', recentCount: 9 }]);
    await security.mailer.run(ticket);
    expect(security.queue).toHaveBeenCalledTimes(1);
    expect(security.log).toHaveBeenCalledWith(
      'warn',
      'security notice over the hourly cap sent anyway (password_changed)',
    );
  });

  it('the set-up e-mail: the code in the e-mail is the one whose hash is stored with it; the platform-only variant for an account of several organizations', async () => {
    const claim: InlineAccountMailSend = {
      ...send,
      kind: 'mfa_factor_added',
      factorId: FACTOR,
      setUpAt: new Date('2026-10-23T10:00:00.000Z'),
      setupUserAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0',
      platformSender: true,
    };
    const { mailer, queue, log } = setup([claim]);
    await mailer.run(ticket);
    const mail = queue.mock.calls[0]?.[2] as {
      template: string;
      text: string;
      codeHash: Buffer;
      removeHash: Buffer;
    };
    expect(mail.template).toBe('platform.mfa_factor_added_platform');
    const code = /\b(\d{8})\b/.exec(mail.text)?.[1] ?? '';
    expect(code).toMatch(/^\d{8}$/);
    expect(mail.codeHash).toEqual(hashMfaSetupCode(FACTOR, code));
    expect(mail.removeHash).toHaveLength(32);
    expect(mail.text).toContain(`${BASE}/en/mfa/remove#token=`);
    // The code and the link's token never reach the log.
    expect(JSON.stringify(log.mock.calls)).not.toContain(code);
    const single = setup([{ ...claim, platformSender: false }]);
    await single.mailer.run(ticket);
    expect((single.queue.mock.calls[0]?.[2] as { template: string }).template).toBe(
      'platform.mfa_factor_added',
    );
  });

  it('a set-up whose app is gone is removed; a request the database should never have stored is removed, a temporary failure is left to the worker', async () => {
    const gone = setup([{ ...send, kind: 'mfa_factor_added', factorId: FACTOR, setUpAt: null }]);
    await gone.mailer.run(ticket);
    expect(gone.done).toHaveBeenCalledWith(SECRET, REQUEST);

    const badPolicy = setup([{ ...send, kind: 'security_policy_changed', detail: { nope: 1 } }]);
    await badPolicy.mailer.run(ticket);
    expect(badPolicy.done).toHaveBeenCalledTimes(1);
    expect(badPolicy.queue).not.toHaveBeenCalled();

    const temporary = setup([send]);
    temporary.queue.mockRejectedValue(Object.assign(new Error('db'), { code: 'ECONNRESET' }));
    await temporary.mailer.run(ticket);
    expect(temporary.done).not.toHaveBeenCalled();
    expect(temporary.deliver).not.toHaveBeenCalled();
    expect(temporary.log).toHaveBeenCalledWith(
      'warn',
      'account e-mail not sent now (password_changed); the worker will handle it',
      { reason: 'ECONNRESET' },
    );
  });

  it('the policy-change notice names the editor and the changed settings', async () => {
    const { mailer, queue } = setup([
      {
        ...send,
        kind: 'security_policy_changed',
        detail: {
          changed: ['lockoutThreshold'],
          changed_by: 'p1',
          changed_at: '2026-10-23T10:00:00.000Z',
        },
        changedByName: { ar: 'مدير', en: 'Admin' },
      },
    ]);
    await mailer.run(ticket);
    const mail = queue.mock.calls[0]?.[2] as { template: string; html: string };
    expect(mail.template).toBe('platform.security_policy_changed');
    expect(mail.html).toContain('Admin');
  });

  it('a claim that fails leaves everything to the worker; a request already taken (queue returns null) is not sent', async () => {
    const failing = setup([]);
    failing.claim.mockRejectedValue(Object.assign(new Error('db'), { code: 'ECONNRESET' }));
    await failing.mailer.run(ticket);
    expect(failing.log).toHaveBeenCalledWith(
      'warn',
      'inline account e-mail: could not claim; the worker will send it',
      { reason: 'ECONNRESET' },
    );
    const taken = setup([send]);
    taken.queue.mockResolvedValue(null);
    await taken.mailer.run(ticket);
    expect(taken.deliver).not.toHaveBeenCalled();
  });

  it('at most maxRequests in one web request; without a usable app origin nothing is claimed', async () => {
    const many = setup(
      Array.from({ length: 5 }, () => ({ ...send, kind: 'sign_in_unlocked' as const })),
      { maxRequests: 3 },
    );
    await many.mailer.run(ticket);
    expect(many.queue).toHaveBeenCalledTimes(3);
    const noBase = setup([send], { base: () => undefined });
    await noBase.mailer.run(ticket);
    expect(noBase.claim).not.toHaveBeenCalled();
  });
});

describe("tagging in the action's transaction", () => {
  const tx = {
    transaction: (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as ClaimsTx;

  it('tags in a savepoint and schedules the send for after the response', async () => {
    const { mailer, tag, scheduled, claim } = setup([]);
    await mailer.tagInTransaction(tx);
    expect(tag).toHaveBeenCalledTimes(1);
    expect(scheduled).toHaveLength(1);
    await scheduled[0]?.();
    expect(claim).toHaveBeenCalledWith(SECRET, 24 * 60);
  });

  it('nothing tagged, not configured, or no usable origin: the worker does it as before', async () => {
    const empty = setup([]);
    empty.tag.mockResolvedValue(null);
    await empty.mailer.tagInTransaction(tx);
    expect(empty.scheduled).toHaveLength(0);
    const off = setup([], { configured: () => false });
    await off.mailer.tagInTransaction(tx);
    expect(off.tag).not.toHaveBeenCalled();
    expect(await off.mailer.tagTicket(tx)).toBeNull();
    expect(off.mailer.configured()).toBe(false);
    const noBase = setup([], { base: () => undefined });
    await noBase.mailer.tagInTransaction(tx);
    expect(noBase.tag).not.toHaveBeenCalled();
    expect(noBase.mailer.configured()).toBe(false);
  });

  it('a failure never reaches the action (the request stays for the worker)', async () => {
    const { mailer, tag, log, scheduled } = setup([]);
    tag.mockRejectedValue(Object.assign(new Error('no such function'), { code: 'UNDEFINED_FN' }));
    await expect(mailer.tagInTransaction(tx)).resolves.toBeUndefined();
    expect(scheduled).toHaveLength(0);
    expect(log).toHaveBeenCalledWith(
      'warn',
      'immediate account e-mail not started; the worker will send it',
      { reason: 'UNDEFINED_FN' },
    );
    expect(await mailer.tagTicket(tx)).toBeNull();
  });

  it('tagTicket returns the key without scheduling (the action runtime sends after the commit); schedule runs a ticket', async () => {
    const { mailer, scheduled, claim } = setup([]);
    expect(await mailer.tagTicket(tx)).toBe(ticket);
    expect(scheduled).toHaveLength(0);
    mailer.schedule(null);
    expect(scheduled).toHaveLength(0);
    mailer.schedule(ticket);
    expect(scheduled).toHaveLength(1);
    await scheduled[0]?.();
    expect(claim).toHaveBeenCalledTimes(1);
  });
});
