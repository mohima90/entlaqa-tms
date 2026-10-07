import type { AccountMailRequest, SystemTx } from '@jadarat/platform-db/jobs';
import { PasswordChangedVariables, PasswordResetVariables } from '@jadarat/platform-notifications';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_MAIL_BATCH,
  ACCOUNT_MAIL_HOURLY_CAP,
  ACCOUNT_MAIL_TASK,
  type RecoveryLinks,
  createAccountMailer,
} from './index';

const db = vi.hoisted(() => ({
  claimAccountMailRequest: vi.fn(),
  finishAccountMailRequest: vi.fn(),
  retryAccountMailRequest: vi.fn(),
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
const HASH = 'sample0token0hash'.padEnd(56, '0'); // shape only
const BASE = 'https://tms.example.com';

const platformTx = { kind: 'platform' } as unknown as SystemTx;
const tenantTx = { kind: 'tenant' } as unknown as SystemTx;

const send = (overrides: Partial<Extract<AccountMailRequest, { outcome: 'send' }>> = {}) =>
  ({
    id: REQUEST,
    kind: 'password_reset',
    attempt: 1,
    outcome: 'send',
    email: EMAIL,
    userId: USER,
    tenantId: TENANT,
    personId: PERSON,
    locale: 'en',
    ...overrides,
  }) as const;

function setup(
  options: { recoveryLinks?: RecoveryLinks | null; appBaseUrl?: string | undefined } = {},
) {
  const log = vi.fn();
  const withPlatformTx = vi.fn((_actor: { jobId: string }, fn: (tx: SystemTx) => unknown) =>
    Promise.resolve(fn(platformTx)),
  );
  const withSystemTx = vi.fn(
    (_actor: { tenantId: string; jobId: string }, fn: (tx: SystemTx) => unknown) =>
      Promise.resolve(fn(tenantTx)),
  );
  const issue = vi.fn<RecoveryLinks['issue']>(() =>
    Promise.resolve({ status: 'issued', hashedToken: HASH }),
  );
  const recoveryLinks = options.recoveryLinks === undefined ? { issue } : options.recoveryLinks;
  const task = createAccountMailer({
    appBaseUrl: 'appBaseUrl' in options ? options.appBaseUrl : BASE,
    recoveryLinks,
    withPlatformTx: withPlatformTx as never,
    withSystemTx: withSystemTx as never,
    log,
  });
  return { task, log, issue, withPlatformTx, withSystemTx };
}

/** The queue answers these leases in turn, then nothing. */
function queue(...requests: AccountMailRequest[]) {
  for (const r of requests) db.claimAccountMailRequest.mockResolvedValueOnce(r);
  db.claimAccountMailRequest.mockResolvedValue(null);
}

const queued = () =>
  mail.queueEmail.mock.calls[0]?.[1] as {
    template: string;
    locale: string;
    to: string;
    recipientPersonId: string;
    variables: Record<string, unknown>;
  };

beforeEach(() => {
  db.tenantIsServed.mockResolvedValue(true);
  db.finishAccountMailRequest.mockResolvedValue(true);
  db.retryAccountMailRequest.mockResolvedValue(true);
  db.loadAccountMailContext.mockResolvedValue({
    organizationName: { ar: 'شركة الراية', en: 'Al Raya' },
    recipientName: { ar: 'سارة', en: 'Sara' },
    recentCount: 0,
  });
  mail.queueEmail.mockResolvedValue('delivery-1');
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('account mailer (T-M2-17): reset e-mail and "password changed" notice', () => {
  it('a platform task; an empty queue ends the pass', async () => {
    queue();
    const { task } = setup();
    expect(task.name).toBe(ACCOUNT_MAIL_TASK);
    expect(await task.run({ jobId: 'platform.account_mail:1' })).toBe(false);
    expect(mail.queueEmail).not.toHaveBeenCalled();
  });

  it('reset: a new recovery token from Auth, the link built exactly as before, queued in the organization', async () => {
    queue(send());
    const { task, issue, withSystemTx, withPlatformTx, log } = setup();
    await task.run({ jobId: 'platform.account_mail:7' });
    expect(withPlatformTx).toHaveBeenCalledWith(
      { jobId: 'platform.account_mail:7' },
      db.claimAccountMailRequest,
    );
    expect(issue).toHaveBeenCalledWith(EMAIL);
    expect(withSystemTx.mock.calls[0]?.[0]).toEqual({
      tenantId: TENANT,
      jobId: 'platform.account_mail:7',
    });
    expect(db.loadAccountMailContext).toHaveBeenCalledWith(
      tenantTx,
      PERSON,
      'platform.password_reset',
    );
    const email = queued();
    expect(email).toMatchObject({
      template: 'platform.password_reset',
      locale: 'en',
      to: EMAIL,
      recipientPersonId: PERSON,
    });
    expect(email.variables).toEqual({
      organizationName: { ar: 'شركة الراية', en: 'Al Raya' },
      resetUrl: {
        ar: `${BASE}/ar/reset-password#token_hash=${HASH}&type=recovery`,
        en: `${BASE}/en/reset-password#token_hash=${HASH}&type=recovery`,
      },
      validMinutes: 60,
      loginEmail: EMAIL,
    });
    // The template accepts exactly these variables.
    expect(() => PasswordResetVariables.parse(email.variables)).not.toThrow();
    // Queued and answered in the same organization transaction.
    expect(mail.queueEmail.mock.calls[0]?.[0]).toBe(tenantTx);
    expect(db.finishAccountMailRequest).toHaveBeenCalledWith(tenantTx, REQUEST);
    expect(log).toHaveBeenCalledWith('info', 'account e-mail queued (password_reset)');
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/raya\.example|sample0token/);
  });

  it('the organization and the language are the ones the database chose (several organizations)', async () => {
    const other = '0e517062-8f91-4203-8ebf-3a4b5c6d7e8f';
    queue(send({ tenantId: other, locale: 'ar' }));
    const { task, withSystemTx } = setup();
    await task.run({ jobId: 'j' });
    expect(withSystemTx.mock.calls[0]?.[0]).toMatchObject({ tenantId: other });
    expect(queued().locale).toBe('ar');
  });

  it('"password changed": no Auth call; the forgot-password page in both languages', async () => {
    queue(send({ kind: 'password_changed', locale: 'ar' }));
    const { task, issue } = setup({ recoveryLinks: null });
    await task.run({ jobId: 'j' });
    expect(issue).not.toHaveBeenCalled();
    const email = queued();
    expect(email).toMatchObject({ template: 'platform.password_changed', locale: 'ar', to: EMAIL });
    expect(email.variables).toEqual({
      organizationName: { ar: 'شركة الراية', en: 'Al Raya' },
      forgotPasswordUrl: { ar: `${BASE}/ar/forgot-password`, en: `${BASE}/en/forgot-password` },
      loginEmail: EMAIL,
    });
    expect(() => PasswordChangedVariables.parse(email.variables)).not.toThrow();
    expect(db.finishAccountMailRequest).toHaveBeenCalledWith(tenantTx, REQUEST);
  });

  it.each(['unknown_account', 'banned', 'too_soon', 'no_membership'] as const)(
    'nothing sent and no Auth call when the database says %s; the request is answered',
    async (outcome) => {
      queue({ id: REQUEST, kind: 'password_reset', attempt: 1, outcome });
      const { task, issue, log } = setup();
      await task.run({ jobId: 'j' });
      expect(issue).not.toHaveBeenCalled();
      expect(mail.queueEmail).not.toHaveBeenCalled();
      expect(db.finishAccountMailRequest).toHaveBeenCalledWith(platformTx, REQUEST);
      expect(log).toHaveBeenCalledWith(
        'info',
        `account e-mail not sent (password_reset: ${outcome})`,
      );
    },
  );

  it('Auth no longer knows the address (deleted meanwhile): answered, nothing sent', async () => {
    queue(send());
    const { task, issue } = setup();
    issue.mockResolvedValueOnce({ status: 'unknown_account' });
    await task.run({ jobId: 'j' });
    expect(mail.queueEmail).not.toHaveBeenCalled();
    expect(db.finishAccountMailRequest).toHaveBeenCalledWith(platformTx, REQUEST);
  });

  it('a temporary Auth failure puts the request back (retry), logging the code only', async () => {
    queue(send());
    const { task, issue, log } = setup();
    issue.mockRejectedValueOnce(
      Object.assign(new Error(`Auth down for ${EMAIL}`), {
        code: 'AUTH_HTTP_503',
        temporary: true,
      }),
    );
    await task.run({ jobId: 'j' });
    expect(db.retryAccountMailRequest).toHaveBeenCalledWith(platformTx, REQUEST);
    expect(db.finishAccountMailRequest).not.toHaveBeenCalled();
    expect(mail.queueEmail).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      'warning',
      'account e-mail failed (password_reset: AUTH_HTTP_503); retried later',
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('raya.example');
  });

  it('after the last attempt the request is given up (an error is logged)', async () => {
    queue(send({ attempt: 5 }));
    db.retryAccountMailRequest.mockResolvedValueOnce(false);
    const { task, issue, log } = setup();
    issue.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'AUTH_HTTP_500', temporary: true }),
    );
    await task.run({ jobId: 'j' });
    expect(log).toHaveBeenCalledWith(
      'error',
      'account e-mail failed (password_reset: AUTH_HTTP_500); given up after 5 attempts',
    );
  });

  it('a refusal a retry cannot fix answers the request without an e-mail', async () => {
    queue(send());
    const { task, issue, log } = setup();
    issue.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'email_address_invalid', temporary: false }),
    );
    await task.run({ jobId: 'j' });
    expect(db.retryAccountMailRequest).not.toHaveBeenCalled();
    expect(db.finishAccountMailRequest).toHaveBeenCalledWith(platformTx, REQUEST);
    expect(log).toHaveBeenCalledWith(
      'info',
      'account e-mail not sent (password_reset: refused email_address_invalid)',
    );
  });

  it('without the Auth admin API (not configured) reset requests wait (retried), notices still go', async () => {
    queue(send(), send({ kind: 'password_changed' }));
    const { task, log } = setup({ recoveryLinks: null });
    await task.run({ jobId: 'j' });
    expect(db.retryAccountMailRequest).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      'warning',
      'account e-mail failed (password_reset: AUTH_ADMIN_NOT_CONFIGURED); retried later',
    );
    expect(mail.queueEmail).toHaveBeenCalledTimes(1);
    expect(queued().template).toBe('platform.password_changed');
  });

  it("a database failure while queueing is temporary: retried (the sender's own retries follow once queued)", async () => {
    queue(send());
    mail.queueEmail.mockRejectedValueOnce(Object.assign(new Error('deadlock'), { code: '40P01' }));
    const { task } = setup();
    await task.run({ jobId: 'j' });
    expect(db.retryAccountMailRequest).toHaveBeenCalledWith(platformTx, REQUEST);
  });

  it('an organization suspended since the lease, or the hourly cap: answered without an e-mail', async () => {
    queue(send());
    db.tenantIsServed.mockResolvedValueOnce(false);
    const first = setup();
    await first.task.run({ jobId: 'j' });
    expect(mail.queueEmail).not.toHaveBeenCalled();
    expect(db.finishAccountMailRequest).toHaveBeenCalledWith(tenantTx, REQUEST);
    expect(first.log).toHaveBeenCalledWith(
      'info',
      'account e-mail not sent (organization_unavailable) (password_reset)',
    );

    queue(send());
    db.loadAccountMailContext.mockResolvedValueOnce({
      organizationName: { ar: 'شركة الراية', en: null },
      recipientName: { ar: 'سارة', en: null },
      recentCount: ACCOUNT_MAIL_HOURLY_CAP,
    });
    const second = setup();
    await second.task.run({ jobId: 'j' });
    expect(mail.queueEmail).not.toHaveBeenCalled();
    expect(second.log).toHaveBeenCalledWith(
      'info',
      'account e-mail not sent (hourly_cap) (password_reset)',
    );
  });

  it('with e-mail switched off (no APP_BASE_URL) requests are answered without an e-mail', async () => {
    queue(send());
    const { task, issue } = setup({ appBaseUrl: undefined });
    await task.run({ jobId: 'j' });
    expect(issue).not.toHaveBeenCalled();
    expect(db.finishAccountMailRequest).toHaveBeenCalledWith(platformTx, REQUEST);
  });

  it('answers at most a batch per pass and asks for another pass', async () => {
    db.claimAccountMailRequest.mockResolvedValue({
      id: REQUEST,
      kind: 'password_reset',
      attempt: 1,
      outcome: 'no_membership',
    });
    const { task } = setup();
    expect(await task.run({ jobId: 'j' })).toBe(true);
    expect(db.claimAccountMailRequest).toHaveBeenCalledTimes(ACCOUNT_MAIL_BATCH);
  });

  it('refuses an unsafe web app origin; trailing slashes are trimmed', async () => {
    expect(() => setup({ appBaseUrl: 'http://tms.example.com' })).toThrow('https');
    queue(send({ kind: 'password_changed' }));
    const { task } = setup({ appBaseUrl: `${BASE}//` });
    await task.run({ jobId: 'j' });
    expect(queued().variables.forgotPasswordUrl).toEqual({
      ar: `${BASE}/ar/forgot-password`,
      en: `${BASE}/en/forgot-password`,
    });
  });
});
