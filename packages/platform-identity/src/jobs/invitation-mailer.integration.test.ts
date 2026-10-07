/**
 * Invitation e-mail against PostgreSQL (T-M2-07, FR-IAM-03; invitations contract §1 step 2, §3): an
 * `invitation.created` event makes one worker pass issue a token — only its SHA-256 is stored — and
 * queue one bilingual invitation e-mail whose accept link carries that token; a resend replaces the
 * hash (the old link stops working); a revoked invitation is not mailed. Only events of a member who
 * may still manage the invitation are acted on (security review M2): a system event, or a request of a
 * member demoted since, sends nothing. Logs carry no personal data.
 */
import { randomUUID } from 'node:crypto';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import { createDatabase, createWithUserTx, emitEvent } from '@jadarat/platform-db';
import { createWithSystemTx } from '@jadarat/platform-db/jobs';
import { type WorkerConfig, createSubscriberRegistry, runPass } from '@jadarat/platform-jobs/jobs';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  INVITATION_CREATED_EVENT,
  INVITATION_RESEND_REQUESTED_EVENT,
  createInvitationMailer,
  hashToken,
} from './invitation-mailer';

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

// The token travels in the URL fragment (never sent to the server; review M3).
const ACCEPT_LINK = /https:\/\/tms\.test\.example\/en\/invite\/accept#token=([A-Za-z0-9_-]{43})/;

describe.skipIf(!configured)('invitation mailer against PostgreSQL', () => {
  const owner = createDatabase(ownerUrl ?? '', { max: 1 });
  const serverDb = createDatabase(appServerUrl ?? '', { max: 1 });
  const workerDb = createDatabase(appWorkerUrl ?? '', { max: 2 });
  const withUserTx = createWithUserTx(() => serverDb);
  const withSystemTx = createWithSystemTx(() => workerDb);
  const tenant = randomUUID();
  // The inviter: an HR Manager of the organization, signed in.
  const inviter = { user: randomUUID(), person: randomUUID(), session: randomUUID() };
  const invitee = { person: randomUUID(), email: `noura.${tenant.slice(0, 8)}@test.example` };
  const invitation = randomUUID();
  const logs: string[] = [];

  const pass = () => {
    const log = (level: string, message: string) => logs.push(`${level}: ${message}`);
    const config: WorkerConfig = {
      queueUrl: appQueueUrl ?? '',
      caPem: undefined,
      // Without the e-mail sender: the queued message stays in the log with its content.
      registry: createSubscriberRegistry([
        createInvitationMailer({
          appBaseUrl: 'https://tms.test.example/',
          roleName: (code) =>
            code === 'learner' ? { ar: 'متدرب', en: 'Learner' } : { ar: code, en: code },
          log,
        }),
      ]),
      withSystemTx,
      concurrency: 2,
      log,
    };
    return runPass(config);
  };

  const inviterClaims = () => {
    const r = brandVerifiedClaims({
      sub: inviter.user,
      role: 'authenticated',
      aal: 'aal1',
      session_id: inviter.session,
      tenant_id: tenant,
      person_id: inviter.person,
    });
    if (!r.ok) throw new Error('bad fixture');
    return r.value;
  };

  /** The event as the inviter's action emits it (actor = that member). */
  const emit = (type: string) =>
    withUserTx(inviterClaims(), (tx) => emitEvent(tx, { type, subject: invitation }));

  const emitAsSystem = (type: string) =>
    withSystemTx({ tenantId: tenant, jobId: 'test.invitations:1' }, (tx) =>
      emitEvent(tx, { type, subject: invitation }),
    );

  const grantHrManager = () =>
    owner.execute(sql`insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
      select ${tenant}, m.id, 'hr_manager', true from platform.tenant_memberships m
      where m.tenant_id = ${tenant} and m.user_id = ${inviter.user}`);

  const stored = async () => {
    const [row] = await owner.execute<{
      token_hash: string | null;
      send_count: number;
      token_issued_at: string | null;
    }>(sql`select encode(token_hash, 'hex') as token_hash, send_count, token_issued_at
           from platform.invitations where id = ${invitation}`);
    return row;
  };

  const deliveries = () =>
    owner.execute<{
      template: string;
      locale: string;
      destination: string | null;
      recipient_person_id: string | null;
      status: string;
      html_body: string | null;
      text_body: string | null;
    }>(sql`select d.template, d.locale, d.destination, d.recipient_person_id, d.status,
                  d.html_body, d.text_body
           from platform.message_deliveries d
           join platform.event_outbox e on e.id = d.source_event_id
           where e.subject = ${invitation}::uuid
           order by d.created_at`);

  const tokenOf = (html: string | null | undefined) => ACCEPT_LINK.exec(html ?? '')?.[1] ?? '';

  beforeAll(async () => {
    await owner.execute(sql`insert into platform.tenants (id, slug, name_ar, name_en, status)
      values (${tenant}, ${`inv-${tenant.slice(0, 8)}`}, 'شركة الاختبار', 'Test Company', 'active')`);
    await owner.execute(sql`insert into auth.users (id, email)
      values (${inviter.user}, ${`${inviter.user}@test.example`})`);
    await owner.execute(sql`insert into platform.persons (id, tenant_id, display_name_ar, display_name_en, email)
      values (${inviter.person}, ${tenant}, 'محمد العتيبي', 'Mohammed Alotaibi',
              ${`${inviter.user}@test.example`})`);
    await owner.execute(
      sql`insert into auth.sessions (id, user_id) values (${inviter.session}, ${inviter.user})`,
    );
    await owner.execute(sql`insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
      values (${tenant}, ${inviter.user}, ${inviter.person}, 'active')`);
    await grantHrManager();
    await owner.execute(sql`insert into platform.session_context (session_id, user_id, active_tenant_id)
      values (${inviter.session}, ${inviter.user}, ${tenant})`);
    await owner.execute(sql`insert into platform.persons (id, tenant_id, display_name_ar, display_name_en, email)
      values (${invitee.person}, ${tenant}, 'نورة القحطاني', 'Noura Alqahtani', ${invitee.email})`);
    await owner.execute(sql`insert into platform.invitations
        (id, tenant_id, person_id, email, locale, primary_role, invited_by, expires_at)
      values (${invitation}, ${tenant}, ${invitee.person}, ${invitee.email}, 'en', 'learner',
              ${inviter.user}, now() + interval '7 days')`);
  });

  afterAll(async () => {
    await owner.$client.end();
    await serverDb.$client.end();
    await workerDb.$client.end();
  });

  it('created: issues a token, stores only its hash and queues one invitation e-mail', async () => {
    await emit(INVITATION_CREATED_EVENT);
    expect(await pass()).toEqual({ staleEvents: 0 });

    const rows = await deliveries();
    expect(rows).toHaveLength(1);
    const [delivery] = rows;
    expect(delivery).toMatchObject({
      template: 'platform.invitation',
      locale: 'en',
      destination: invitee.email,
      recipient_person_id: invitee.person,
      status: 'queued',
    });
    expect(delivery?.html_body).toContain('Noura Alqahtani');
    expect(delivery?.html_body).toContain('Mohammed Alotaibi');
    expect(delivery?.html_body).toContain('Learner');
    const token = tokenOf(delivery?.html_body);
    expect(token).not.toBe('');
    expect(delivery?.text_body).toContain(token);

    const row = await stored();
    expect(row?.send_count).toBe(1);
    expect(row?.token_issued_at).not.toBeNull();
    expect(row?.token_hash).toBe(hashToken(token).toString('hex'));

    // Exactly once: another pass queues nothing more.
    await pass();
    expect(await deliveries()).toHaveLength(1);
  });

  it('resend: a new token replaces the hash (the old link stops working)', async () => {
    const before = await stored();
    await emit(INVITATION_RESEND_REQUESTED_EVENT);
    await pass();

    const rows = await deliveries();
    expect(rows).toHaveLength(2);
    const [first, second] = rows.map((r) => tokenOf(r.html_body));
    expect(second).not.toBe('');
    expect(second).not.toBe(first);
    const after = await stored();
    expect(after?.send_count).toBe(2);
    expect(after?.token_hash).toBe(hashToken(second ?? '').toString('hex'));
    expect(after?.token_hash).not.toBe(before?.token_hash);
  });

  it("acts on members' events only, while they may still manage the invitation (review M2)", async () => {
    const before = await stored();
    await emitAsSystem(INVITATION_RESEND_REQUESTED_EVENT);
    await pass();
    expect(await deliveries()).toHaveLength(2);
    expect(logs.join('\n')).toContain('invitation event not from a member; ignored');

    // The inviter asked for a resend, then lost the HR Manager role before the job ran.
    await emit(INVITATION_RESEND_REQUESTED_EVENT);
    await owner.execute(sql`delete from platform.role_assignments
      where tenant_id = ${tenant} and role_code = 'hr_manager'`);
    await pass();
    expect(await deliveries()).toHaveLength(2);
    expect(await stored()).toEqual(before);
    expect(logs.join('\n')).toContain(
      'invitation event from a member who may no longer manage it; no e-mail',
    );
    await grantHrManager();
  });

  it('a revoked invitation is not mailed', async () => {
    await owner.execute(sql`update platform.invitations
      set status = 'revoked', revoked_at = now(), revoked_by = ${inviter.user}
      where id = ${invitation}`);
    const before = await stored();
    await emit(INVITATION_RESEND_REQUESTED_EVENT);
    await pass();
    expect(await deliveries()).toHaveLength(2);
    expect(await stored()).toEqual(before);

    const logged = logs.join('\n');
    expect(logged).toContain('invitation not pending or send limit reached; no e-mail');
    for (const personal of ['noura', 'Noura', 'نورة', 'Mohammed', invitee.email]) {
      expect(logged).not.toContain(personal);
    }
  });
});
