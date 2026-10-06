/**
 * E-mail pipeline against PostgreSQL (T-M2-06b, ADR 0008): a notification subscriber queues an
 * invitation in its tenant transaction; one worker pass dispatches it and the sender delivers it once,
 * with the delivery id as idempotency key; the log keeps the masked address and outcome only. A retry
 * reuses the key; a suspended organization's waiting message is discarded (content removed).
 */
import { randomUUID } from 'node:crypto';
import { createDatabase, emitEvent } from '@jadarat/platform-db';
import { createWithSystemTx } from '@jadarat/platform-db/jobs';
import {
  type TransactionalSubscriber,
  type WorkerConfig,
  createSubscriberRegistry,
  runPass,
} from '@jadarat/platform-jobs/jobs';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { queueEmail } from './queue';
import { createEmailSender } from './sender';
import { EmailSendError, type EmailTransport, type OutgoingEmail } from './transport';

const ownerUrl = process.env.TEST_DATABASE_URL;
const appWorkerUrl = process.env.TEST_APP_WORKER_URL;
const appQueueUrl = process.env.TEST_APP_QUEUE_URL;
const configured = Boolean(ownerUrl && appWorkerUrl && appQueueUrl);

if ((process.env.CI || process.env.JADARAT_REQUIRE_INTEGRATION) && !configured) {
  throw new Error('TEST_DATABASE_URL, TEST_APP_WORKER_URL and TEST_APP_QUEUE_URL must be set');
}

const REQUESTED = 'com.entlaqa.platform.test.invite_requested';

describe.skipIf(!configured)('e-mail pipeline against PostgreSQL', () => {
  const owner = createDatabase(ownerUrl ?? '', { max: 1 });
  const workerDb = createDatabase(appWorkerUrl ?? '', { max: 2 });
  const withSystemTx = createWithSystemTx(() => workerDb);
  const tenant = randomUUID();
  const person = randomUUID();
  /** Suspended during its test. */
  const pausedTenant = randomUUID();
  const pausedPerson = randomUUID();
  const logs: string[] = [];

  /** The test's notification subscriber: an event asks for an invitation e-mail to `data.to`. */
  const inviter: TransactionalSubscriber = {
    name: 'test.invite_mailer',
    types: [REQUESTED],
    handle: async ({ tx, event }) => {
      await queueEmail(tx, {
        template: 'platform.invitation',
        locale: 'ar',
        to: String(event.data.to),
        recipientPersonId: String(event.data.person),
        sourceEventId: event.id,
        variables: {
          recipientName: { ar: 'نورة', en: 'Noura' },
          inviterName: { ar: 'محمد العتيبي', en: 'Mohammed Alotaibi' },
          organizationName: { ar: 'شركة الاختبار', en: 'Test Company' },
          roleName: { ar: 'متدرب', en: 'Learner' },
          acceptUrl: 'https://test.jadarat.example/ar/invite/accept?token=t',
          expiresAt: '2026-10-13T09:00:00+03:00',
          timeZone: 'Asia/Riyadh',
          loginEmail: String(event.data.to),
        },
      });
    },
  };

  const pass = (transport: EmailTransport | null) => {
    const config: WorkerConfig = {
      queueUrl: appQueueUrl ?? '',
      caPem: undefined,
      registry: createSubscriberRegistry([
        inviter,
        createEmailSender({
          transport,
          from: { name: 'ENTLAQA LMS', address: 'noreply@lms.entlaqa.com' },
          log: (level, message) => logs.push(`${level}: ${message}`),
        }),
      ]),
      withSystemTx,
      concurrency: 2,
      log: (level, message) => logs.push(`${level}: ${message}`),
    };
    return runPass(config);
  };

  const request = (to: string, tenantId = tenant, personId = person) =>
    withSystemTx({ tenantId, jobId: 'test.email:1' }, (tx) =>
      emitEvent(tx, { type: REQUESTED, data: { to, person: personId } }),
    );

  /** Makes the sender's retries due now instead of after graphile-worker's back-off. */
  const retriesDue = () =>
    owner.execute(sql`update graphile_worker._private_jobs set run_at = now()
                      where key like 'notifications.email:%' and locked_at is null`);

  const deliveries = async (to: string) =>
    owner.execute<{
      id: string;
      status: string;
      destination: string | null;
      destination_masked: string;
      html_body: string | null;
      provider: string | null;
      provider_message_id: string | null;
      error_code: string | null;
      attempts: number;
      recipient_person_id: string | null;
      sent_at: string | null;
    }>(sql`select d.* from platform.message_deliveries d
           join platform.event_outbox e on e.id = d.source_event_id
           where e.data ->> 'to' = ${to}`);

  beforeAll(async () => {
    for (const [t, p] of [
      [tenant, person],
      [pausedTenant, pausedPerson],
    ] as const) {
      await owner.execute(sql`insert into platform.tenants (id, slug, name_ar, status)
        values (${t}, ${`em-${t.slice(0, 8)}`}, 'شركة الاختبار', 'active')`);
      await owner.execute(sql`insert into platform.persons (id, tenant_id, display_name_ar)
        values (${p}, ${t}, 'نورة')`);
    }
  });

  afterAll(async () => {
    await owner.$client.end();
    await workerDb.$client.end();
  });

  it('queues, dispatches and sends an invitation once, in one pass', async () => {
    const sent: OutgoingEmail[] = [];
    const transport: EmailTransport = {
      provider: 'smtp',
      send: (email) => {
        sent.push(email);
        return Promise.resolve({ providerMessageId: `<${email.idempotencyKey}@lms.entlaqa.com>` });
      },
    };
    await request('noura@test.example');
    expect(await pass(transport)).toEqual({ staleEvents: 0 });
    const [row] = await deliveries('noura@test.example');
    expect(row).toMatchObject({
      status: 'sent',
      destination: null,
      html_body: null,
      destination_masked: 'n***@test.example',
      provider: 'smtp',
      recipient_person_id: person,
      attempts: 1,
      error_code: null,
    });
    expect(row?.sent_at).toEqual(expect.any(String));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: 'noura@test.example',
      idempotencyKey: row?.id,
      subject: 'دعوة للانضمام إلى نظام التدريب في شركة الاختبار',
    });
    expect(row?.provider_message_id).toBe(`<${String(row?.id)}@lms.entlaqa.com>`);

    // Another pass sends nothing again.
    await pass(transport);
    expect(sent).toHaveLength(1);
  });

  it('records a refused address as failed, and switched-off e-mail as suppressed', async () => {
    await request('refused@test.example');
    await pass({
      provider: 'resend',
      send: () => Promise.reject(new EmailSendError('VALIDATION_ERROR', true)),
    });
    const [failed] = await deliveries('refused@test.example');
    expect(failed).toMatchObject({
      status: 'failed',
      error_code: 'VALIDATION_ERROR',
      destination: null,
    });

    await request('off@test.example');
    await pass(null);
    const [suppressed] = await deliveries('off@test.example');
    expect(suppressed).toMatchObject({
      status: 'suppressed',
      error_code: 'EMAIL_DISABLED',
      html_body: null,
    });
    expect(logs.join('\n')).not.toMatch(/refused@|off@|noura@/);
  });

  it('a temporary failure keeps the message queued for the retry', async () => {
    await request('later@test.example');
    await pass({
      provider: 'resend',
      send: () => Promise.reject(new EmailSendError('RATE_LIMIT_EXCEEDED', false)),
    });
    const [waiting] = await deliveries('later@test.example');
    expect(waiting).toMatchObject({
      status: 'queued',
      error_code: 'RATE_LIMIT_EXCEEDED',
      destination: 'later@test.example',
      attempts: 1,
    });

    // The retry sends the same delivery, with the same idempotency key.
    const keys: string[] = [];
    await retriesDue();
    await pass({
      provider: 'resend',
      send: (email) => {
        keys.push(email.idempotencyKey);
        return Promise.resolve({ providerMessageId: 'msg_retry' });
      },
    });
    const [sent] = await deliveries('later@test.example');
    expect(sent).toMatchObject({
      status: 'sent',
      attempts: 2,
      error_code: null,
      destination: null,
    });
    expect(keys).toEqual([waiting?.id]);
  });

  it("a suspended organization's waiting message is discarded, its content removed", async () => {
    await request('paused@test.example', pausedTenant, pausedPerson);
    // The organization is suspended while the message is being sent: the outcome can no longer be
    // recorded (RLS), the job fails and its retry finds the organization inactive.
    await pass({
      provider: 'resend',
      send: async () => {
        await owner.execute(
          sql`update platform.tenants set status = 'suspended' where id = ${pausedTenant}`,
        );
        throw new EmailSendError('NETWORK_ERROR', false);
      },
    });
    const [held] = await deliveries('paused@test.example');
    expect(held).toMatchObject({ status: 'sending', destination: 'paused@test.example' });

    await retriesDue();
    await pass({
      provider: 'resend',
      send: () => Promise.reject(new Error('must not be called')),
    });
    const [discarded] = await deliveries('paused@test.example');
    expect(discarded).toMatchObject({
      status: 'suppressed',
      error_code: 'TENANT_INACTIVE',
      destination: null,
      html_body: null,
      destination_masked: 'p***@test.example',
      attempts: 1,
    });
    expect(logs.join('\n')).not.toMatch(/paused@/);
  });
});
