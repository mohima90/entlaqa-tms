import type { SignInCodeRequest, SystemTx } from '@jadarat/platform-db/jobs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SIGN_IN_CODE_BATCH,
  SIGN_IN_CODE_HOURLY_CAP,
  SIGN_IN_CODE_TASK,
  SIGN_IN_CODE_VALID_MINUTES,
  type RecoveryLinks,
  createSignInCodeMailer,
  newSignInCode,
} from './index';

const db = vi.hoisted(() => ({
  claimSignInCodeRequest: vi.fn(),
  issueSignInCode: vi.fn(),
  signInCodeDeadEnd: vi.fn(),
  retrySignInCodeRequest: vi.fn(),
  loadAccountMailContext: vi.fn(),
  tenantIsServed: vi.fn(),
}));
const mail = vi.hoisted(() => ({ queueEmail: vi.fn() }));
vi.mock('@jadarat/platform-db/jobs', () => db);
vi.mock('@jadarat/platform-notifications/jobs', () => mail);

const REQUEST = '6a1f3c2e-4b5d-4e6f-8a7b-9c0d1e2f3a4b';
const TENANT = '7b2e4d3f-5c6e-4f70-9b8c-0d1e2f3a4b5c';
const PERSON = '8c3f5e40-6d7f-4081-8c9d-1e2f3a4b5c6d';
const USER = '9d406f51-7e80-4192-9dae-2f3a4b5c6d7e';
const EMAIL = 'sara.alharbi@raya.example';
const TOKEN = 'minted0one0time0sign0in0token0hash';
const BASE = 'https://tms.example.com';
const platformTx = { kind: 'platform' } as unknown as SystemTx;
const tenantTx = { kind: 'tenant' } as unknown as SystemTx;

const send = (overrides: Partial<Extract<SignInCodeRequest, { outcome: 'send' }>> = {}) =>
  ({
    id: REQUEST,
    mode: 'code',
    outcome: 'send',
    attempt: 1,
    email: EMAIL,
    userId: USER,
    tenantId: TENANT,
    personId: PERSON,
    locale: 'en',
    ...overrides,
  }) as const;

const context = (overrides = {}) => ({
  organizationName: { ar: 'المنشأة', en: 'Demo Organization' },
  recipientName: { ar: 'سارة', en: 'Sara' },
  recentCount: 0,
  quietCount: 0,
  tenantRecentCount: 0,
  ...overrides,
});

function build(links: { issue: ReturnType<typeof vi.fn> } | null) {
  const withPlatformTx = vi.fn((_actor: unknown, fn: (tx: SystemTx) => Promise<unknown>) =>
    fn(platformTx),
  );
  const withSystemTx = vi.fn((_actor: unknown, fn: (tx: SystemTx) => Promise<unknown>) =>
    fn(tenantTx),
  );
  const log = vi.fn();
  const task = createSignInCodeMailer({
    appBaseUrl: BASE,
    signInLinks: links as unknown as RecoveryLinks | null,
    withPlatformTx: withPlatformTx as never,
    withSystemTx: withSystemTx as never,
    log,
  });
  return { task, withPlatformTx, withSystemTx, log };
}

const issuer = (): { issue: ReturnType<typeof vi.fn> } => ({
  issue: vi.fn(() => Promise.resolve({ status: 'issued' as const, hashedToken: TOKEN })),
});

/** One request, then an empty queue. */
function queue(...requests: unknown[]) {
  for (const request of requests) db.claimSignInCodeRequest.mockResolvedValueOnce(request);
  db.claimSignInCodeRequest.mockResolvedValue(null);
}

beforeEach(() => {
  for (const fn of Object.values({ ...db, ...mail })) fn.mockReset();
  db.tenantIsServed.mockResolvedValue(true);
  db.loadAccountMailContext.mockResolvedValue(context());
  db.issueSignInCode.mockResolvedValue(true);
  db.signInCodeDeadEnd.mockResolvedValue(true);
  db.retrySignInCodeRequest.mockResolvedValue(true);
  mail.queueEmail.mockResolvedValue('delivery-1');
});

describe('sign-in code mailer (WP-ADM-05)', () => {
  it('is a platform task that drains requests in batches', async () => {
    const { task } = build(issuer());
    expect(task.name).toBe(SIGN_IN_CODE_TASK);
    db.claimSignInCodeRequest.mockResolvedValue(send());
    await expect(task.run({ jobId: 'j' })).resolves.toBe(true);
    expect(db.claimSignInCodeRequest).toHaveBeenCalledTimes(SIGN_IN_CODE_BATCH);
  });

  it('mints the token LAST, stores only through the database, and e-mails the code in the organization', async () => {
    const links = issuer();
    const { task, withSystemTx } = build(links);
    queue(send());
    await task.run({ jobId: 'j' });
    expect(links.issue).toHaveBeenCalledWith(EMAIL);
    expect(db.issueSignInCode).toHaveBeenCalledTimes(1);
    const issue = db.issueSignInCode.mock.calls[0]?.[1] as {
      code: string;
      linkToken: string;
      id: string;
    };
    expect(issue).toMatchObject({ id: REQUEST, userId: USER, tenantId: TENANT, linkToken: TOKEN });
    expect(issue.code).toMatch(/^[0-9]{6}$/);
    // The same six digits go in the e-mail - and nowhere else.
    expect(mail.queueEmail).toHaveBeenCalledWith(
      tenantTx,
      expect.objectContaining({
        template: 'platform.sign_in_code',
        locale: 'en',
        to: EMAIL,
        recipientPersonId: PERSON,
        appBaseUrl: BASE,
        variables: expect.objectContaining({
          code: issue.code,
          validMinutes: SIGN_IN_CODE_VALID_MINUTES,
          loginEmail: EMAIL,
        }),
      }),
    );
    expect(withSystemTx).toHaveBeenCalledWith(
      { tenantId: TENANT, jobId: 'j' },
      expect.any(Function),
    );
    // The token is requested from Auth after the checks and before the storing.
    expect(links.issue.mock.invocationCallOrder[0]).toBeLessThan(
      db.issueSignInCode.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('never logs a code, a token or an address', async () => {
    const { task, log } = build(issuer());
    queue(send());
    await task.run({ jobId: 'j' });
    const issue = db.issueSignInCode.mock.calls[0]?.[1] as { code: string };
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain(issue.code);
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain(EMAIL);
  });

  it('a remembered browser gets the token only: no code, no e-mail', async () => {
    const links = issuer();
    const { task } = build(links);
    queue(send({ mode: 'remembered' }));
    await task.run({ jobId: 'j' });
    expect(db.issueSignInCode).toHaveBeenCalledWith(
      tenantTx,
      expect.objectContaining({ code: null, linkToken: TOKEN }),
    );
    expect(mail.queueEmail).not.toHaveBeenCalled();
  });

  it('an address with no usable account is left as a row no code matches: nothing is minted or sent', async () => {
    const links = issuer();
    const { task } = build(links);
    queue(
      { id: REQUEST, mode: 'code', outcome: 'unknown_account', attempt: 1 },
      { id: REQUEST, mode: 'code', outcome: 'banned', attempt: 1 },
      { id: REQUEST, mode: 'code', outcome: 'no_membership', attempt: 1 },
    );
    await task.run({ jobId: 'j' });
    expect(db.signInCodeDeadEnd).toHaveBeenCalledTimes(3);
    expect(links.issue).not.toHaveBeenCalled();
    expect(mail.queueEmail).not.toHaveBeenCalled();
  });

  it('an account Auth no longer knows, an unserved organization and the hourly cap send nothing', async () => {
    const gone = issuer();
    gone.issue.mockResolvedValue({ status: 'unknown_account' });
    const a = build(gone);
    queue(send());
    await a.task.run({ jobId: 'j' });
    expect(db.signInCodeDeadEnd).toHaveBeenCalledTimes(1);
    expect(mail.queueEmail).not.toHaveBeenCalled();

    db.signInCodeDeadEnd.mockClear();
    db.tenantIsServed.mockResolvedValue(false);
    const links = issuer();
    const b = build(links);
    queue(send());
    await b.task.run({ jobId: 'j' });
    expect(db.signInCodeDeadEnd).toHaveBeenCalledTimes(1);
    expect(links.issue).not.toHaveBeenCalled();

    db.signInCodeDeadEnd.mockClear();
    db.tenantIsServed.mockResolvedValue(true);
    db.loadAccountMailContext.mockResolvedValue(context({ recentCount: SIGN_IN_CODE_HOURLY_CAP }));
    const capped = issuer();
    const c = build(capped);
    queue(send());
    await c.task.run({ jobId: 'j' });
    expect(db.signInCodeDeadEnd).toHaveBeenCalledTimes(1);
    expect(capped.issue).not.toHaveBeenCalled();
  });

  it('without the Auth admin key or after a temporary failure the request is put back, at most 5 attempts', async () => {
    const none = build(null);
    queue(send());
    await none.task.run({ jobId: 'j' });
    expect(db.retrySignInCodeRequest).toHaveBeenCalledTimes(1);
    expect(db.signInCodeDeadEnd).not.toHaveBeenCalled();

    db.retrySignInCodeRequest.mockClear();
    const flaky = issuer();
    flaky.issue.mockRejectedValue(
      Object.assign(new Error('Auth down'), { code: 'AUTH_UNREACHABLE', temporary: true }),
    );
    const b = build(flaky);
    queue(send());
    await b.task.run({ jobId: 'j' });
    expect(db.retrySignInCodeRequest).toHaveBeenCalledTimes(1);

    // The last attempt is logged as an error and not retried.
    db.retrySignInCodeRequest.mockResolvedValue(false);
    const c = build(flaky);
    queue(send({ attempt: 5 }));
    await c.task.run({ jobId: 'j' });
    expect(c.log).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('given up after 5 attempts'),
    );
  });

  it('a refused (permanent) failure ends the request without a retry', async () => {
    const refusing = issuer();
    refusing.issue.mockRejectedValue(
      Object.assign(new Error('x'), { code: 'email_address_invalid', temporary: false }),
    );
    const { task } = build(refusing);
    queue(send());
    await task.run({ jobId: 'j' });
    expect(db.signInCodeDeadEnd).toHaveBeenCalledTimes(1);
    expect(db.retrySignInCodeRequest).not.toHaveBeenCalled();
  });

  it('while e-mail is off (no app origin) nothing is minted', async () => {
    const links = issuer();
    const task = createSignInCodeMailer({
      appBaseUrl: undefined,
      signInLinks: links as unknown as RecoveryLinks,
      withPlatformTx: ((_a: unknown, fn: (tx: SystemTx) => Promise<unknown>) =>
        fn(platformTx)) as never,
      withSystemTx: ((_a: unknown, fn: (tx: SystemTx) => Promise<unknown>) =>
        fn(tenantTx)) as never,
      log: vi.fn(),
    });
    queue(send());
    await task.run({ jobId: 'j' });
    expect(links.issue).not.toHaveBeenCalled();
    expect(db.signInCodeDeadEnd).toHaveBeenCalledTimes(1);
  });

  it('refuses an app origin that is not https', () => {
    expect(() =>
      createSignInCodeMailer({
        appBaseUrl: 'http://tms.example.com',
        signInLinks: null,
        withPlatformTx: vi.fn() as never,
        withSystemTx: vi.fn() as never,
        log: vi.fn(),
      }),
    ).toThrow('must be https');
  });
});

describe('newSignInCode', () => {
  it('is six digits, uniformly random', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const code = newSignInCode();
      expect(code).toMatch(/^[0-9]{6}$/);
      seen.add(code);
    }
    expect(seen.size).toBeGreaterThan(190);
  });
});
