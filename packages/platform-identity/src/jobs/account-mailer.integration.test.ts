/**
 * Account e-mails against PostgreSQL (T-M2-17; FR-NTF-02, FR-IAM-13, FR-IAM-16): the web app's
 * requests (app_server) are answered by one worker pass — the account mailer (a platform task, no
 * tenant) leases them, the database resolves account, organization and language, the reset link
 * carries the recovery token from the Auth admin API (a stand-in here), and the existing e-mail sender
 * sends the queued message. An unknown address gets nothing and leaves nothing behind; a transport
 * failure follows the sender's retry rules; logs carry no address or token.
 */
import { randomUUID } from 'node:crypto';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import {
  createAccountMailApi,
  createDatabase,
  createWithUserTx,
  queueOwnPasswordChangedMail,
} from '@jadarat/platform-db';
import { createWithPlatformTx, createWithSystemTx } from '@jadarat/platform-db/jobs';
import { type WorkerConfig, createSubscriberRegistry, runPass } from '@jadarat/platform-jobs/jobs';
import {
  EmailSendError,
  type EmailTransport,
  type OutgoingEmail,
  createEmailSender,
} from '@jadarat/platform-notifications/jobs';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type RecoveryLinks, createAccountMailer } from './account-mailer';

const ownerUrl = process.env.TEST_DATABASE_URL;
const appServerUrl = process.env.TEST_APP_SERVER_URL;
const appWorkerUrl = process.env.TEST_APP_WORKER_URL;
const appQueueUrl = process.env.TEST_APP_QUEUE_URL;
const configured = Boolean(ownerUrl && appServerUrl && appWorkerUrl && appQueueUrl);

if ((process.env.CI || process.env.JADARAT_REQUIRE_INTEGRATION) && !configured) {
  throw new Error(
    'TEST_DATABASE_URL, TEST_APP_SERVER_URL, TEST_APP_WORKER_URL and TEST_APP_QUEUE_URL must be set',
  );
}

const HASH = 'sample0token0hash'.padEnd(56, '0'); // shape only

describe.skipIf(!configured)('account mailer against PostgreSQL', () => {
  const owner = createDatabase(ownerUrl ?? '', { max: 1 });
  const serverDb = createDatabase(appServerUrl ?? '', { max: 1 });
  const workerDb = createDatabase(appWorkerUrl ?? '', { max: 2 });
  const withUserTx = createWithUserTx(() => serverDb);
  const withSystemTx = createWithSystemTx(() => workerDb);
  const withPlatformTx = createWithPlatformTx(() => workerDb);
  const requests = createAccountMailApi(() => serverDb);
  const tenant = randomUUID();
  const member = {
    user: randomUUID(),
    person: randomUUID(),
    session: randomUUID(),
    email: `sara.${tenant.slice(0, 8)}@test.example`,
  };
  const logs: string[] = [];
  const sent: OutgoingEmail[] = [];
  const issued: string[] = [];
  let failNextSend = false;

  const transport: EmailTransport = {
    provider: 'smtp',
    send(email) {
      if (failNextSend && email.to === member.email) {
        failNextSend = false;
        return Promise.reject(new EmailSendError('SMTP_UNAVAILABLE', false));
      }
      sent.push(email);
      return Promise.resolve({ providerMessageId: `msg-${String(sent.length)}` });
    },
  };
  const recoveryLinks: RecoveryLinks = {
    issue(email) {
      issued.push(email);
      return Promise.resolve(
        email === member.email
          ? { status: 'issued', hashedToken: HASH }
          : { status: 'unknown_account' },
      );
    },
  };

  /** What reached this test's addresses (a pass also sends what other tests left queued). */
  const mine = () => sent.filter((e) => e.to.endsWith(`${tenant.slice(0, 8)}@test.example`));

  const pass = () => {
    const log = (level: string, message: string) => logs.push(`${level}: ${message}`);
    const config: WorkerConfig = {
      queueUrl: appQueueUrl ?? '',
      caPem: undefined,
      registry: createSubscriberRegistry([
        createEmailSender({
          transport,
          from: { name: 'Jadarat', address: 'noreply@test.example' },
          log,
        }),
      ]),
      withSystemTx,
      platformTasks: [
        createAccountMailer({
          appBaseUrl: 'https://tms.test.example',
          recoveryLinks,
          withPlatformTx,
          withSystemTx,
          log,
        }),
      ],
      concurrency: 2,
      log,
    };
    return runPass(config);
  };

  const deliveries = (template: string) =>
    owner.execute<{
      status: string;
      locale: string;
      error_code: string | null;
      destination: string | null;
    }>(
      sql`select status, locale, error_code, destination from platform.message_deliveries
          where tenant_id = ${tenant} and template = ${template} order by created_at`,
    );
  /**
   * This test's requests still waiting (its addresses or its account). The database is shared with the SQL
   * tests and the other integration tests, which may leave requests of their own (e.g. the authenticator
   * set-up notice of the T-M2-10 fixtures): a pass answers those too, but they are not this test's.
   */
  const waiting = async () => {
    const [row] = await owner.execute<{ n: string }>(
      sql`select count(*) as n from private.account_mail_requests
          where email like ${`%.${tenant.slice(0, 8)}@test.example`} or user_id = ${member.user}`,
    );
    return Number(row?.n ?? 0);
  };

  beforeAll(async () => {
    await owner.execute(sql`insert into platform.tenants (id, slug, name_ar, name_en, status)
      values (${tenant}, ${`acm-${tenant.slice(0, 8)}`}, 'شركة الاختبار', 'Test Company', 'active')`);
    await owner.execute(
      sql`insert into auth.users (id, email) values (${member.user}, ${member.email})`,
    );
    await owner.execute(sql`insert into platform.persons (id, tenant_id, display_name_ar, display_name_en, email, preferred_locale)
      values (${member.person}, ${tenant}, 'سارة', 'Sara', ${member.email}, 'en')`);
    await owner.execute(sql`insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
      values (${tenant}, ${member.user}, ${member.person}, 'active')`);
    await owner.execute(
      sql`insert into auth.sessions (id, user_id) values (${member.session}, ${member.user})`,
    );
    await owner.execute(sql`insert into platform.session_context (session_id, user_id, active_tenant_id)
      values (${member.session}, ${member.user}, ${tenant})`);
  });

  afterAll(async () => {
    // The delivery whose send failed waits for the sender's retry: finish it here, so a later test's
    // pass (same queue) does not send it.
    await owner.execute(sql`update platform.message_deliveries
      set status = 'suppressed', error_code = 'EMAIL_DISABLED',
          destination = null, subject = null, html_body = null, text_body = null
      where tenant_id = ${tenant} and status in ('queued', 'sending')`);
    await owner.$client.end({ timeout: 5 });
    await serverDb.$client.end({ timeout: 5 });
    await workerDb.$client.end({ timeout: 5 });
  });

  it('a reset request for an unknown address: nothing sent, nothing left behind', async () => {
    await requests.requestPasswordResetMail(`nobody.${tenant.slice(0, 8)}@test.example`);
    expect(await waiting()).toBe(1);
    await pass();
    expect(await waiting()).toBe(0);
    // The database decided: Auth was not even asked.
    expect(issued).toEqual([]);
    expect(mine()).toEqual([]);
  });

  it("a reset request: the link with the new token, in the person's language and the organization's name", async () => {
    await requests.requestPasswordResetMail(member.email.toUpperCase());
    await pass();
    expect(await waiting()).toBe(0);
    expect(issued).toEqual([member.email]);
    expect(mine()).toHaveLength(1);
    const email = mine()[0];
    expect(email?.to).toBe(member.email);
    expect(email?.subject).toBe('Reset your password · إعادة تعيين كلمة المرور');
    expect(email?.html).toContain('Test Company');
    expect(email?.html).toContain(
      `href="https://tms.test.example/en/reset-password#token_hash=${HASH}&amp;type=recovery"`,
    );
    expect(email?.text).toContain(
      `https://tms.test.example/ar/reset-password#token_hash=${HASH}&type=recovery`,
    );
    // The delivery log keeps no address or content once sent.
    expect(await deliveries('platform.password_reset')).toEqual([
      { status: 'sent', locale: 'en', error_code: null, destination: null },
    ]);
  });

  it('My profile: the "password changed" notice in the session\'s organization; a transport failure is retried by the sender', async () => {
    const claims = brandVerifiedClaims({
      sub: member.user,
      role: 'authenticated',
      aal: 'aal1',
      session_id: member.session,
      tenant_id: tenant,
      person_id: member.person,
    });
    if (!claims.ok) throw new Error('bad fixture');
    await withUserTx(claims.value, (tx) => queueOwnPasswordChangedMail(tx, member.user));
    failNextSend = true;
    await pass();
    expect(await waiting()).toBe(0);
    // The send failed: the delivery waits for the sender's next attempt, its content kept.
    const [delivery] = await deliveries('platform.password_changed');
    expect(delivery).toMatchObject({ status: 'queued', error_code: 'SMTP_UNAVAILABLE' });
    expect(delivery?.destination).toBe(member.email);
    expect(mine().filter((e) => e.subject.startsWith('Your password was changed'))).toEqual([]);
  });

  it('logs carry no address and no token', () => {
    const joined = logs.join('\n');
    expect(joined).not.toContain('test.example');
    expect(joined).not.toContain(HASH);
    expect(joined).toContain('account e-mail queued (password_reset)');
  });
});
