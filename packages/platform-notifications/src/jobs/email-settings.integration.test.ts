/**
 * E-mail sending set up in the product, against PostgreSQL (WP-ADM-01, migration 20261022100100): the worker
 * publishes its public key; a Super Admin (app_server, no organization) saves the platform sender with its
 * secret sealed by the web side; the worker's test task opens it, "sends" the test and the sender becomes
 * verified; an organization's messages then route through the platform sender under the organization's
 * brand name; its Organization Admin saves, tests and enables its own provider, which then wins; switching
 * it off goes back to the platform sender; a message left waiting for a sender is queued again once one is
 * ready. No real e-mail: the transports are fakes that only record what they were given.
 */
import { randomUUID } from 'node:crypto';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import {
  createDatabase,
  createWithUserTx,
  getEmailCredentialsPublicKey,
  getPlatformEmailSettings,
  getTenantEmailSettings,
  requestTenantEmailTest,
  savePlatformEmailSettings,
  saveTenantEmailSettings,
  setTenantEmailEnabled,
} from '@jadarat/platform-db';
import { createWithPlatformTx, createWithSystemTx } from '@jadarat/platform-db/jobs';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sealProviderInput } from '../credentials-seal';
import { deriveCredentialsKeyPair } from './credentials';
import { createEmailResumeTask, createEmailTestTask } from './email-tasks';
import type { createProviderTransport } from './factory';
import { createEmailRouter } from './router';
import type { EmailTransport, OutgoingEmail } from './transport';

const ownerUrl = process.env.TEST_DATABASE_URL;
const appServerUrl = process.env.TEST_APP_SERVER_URL;
const appWorkerUrl = process.env.TEST_APP_WORKER_URL;
const configured = Boolean(ownerUrl && appServerUrl && appWorkerUrl);

if ((process.env.CI || process.env.JADARAT_REQUIRE_INTEGRATION) && !configured) {
  throw new Error('TEST_DATABASE_URL, TEST_APP_SERVER_URL and TEST_APP_WORKER_URL must be set');
}

describe.skipIf(!configured)('e-mail settings against PostgreSQL', () => {
  const owner = createDatabase(ownerUrl ?? '', { max: 1 });
  const serverDb = createDatabase(appServerUrl ?? '', { max: 1 });
  const workerDb = createDatabase(appWorkerUrl ?? '', { max: 2 });
  const withUserTx = createWithUserTx(() => serverDb);
  const withSystemTx = createWithSystemTx(() => workerDb);
  const withPlatformTx = createWithPlatformTx(() => workerDb);
  const keys = deriveCredentialsKeyPair(`integration-${randomUUID()}-${randomUUID()}`);
  const tag = randomUUID().slice(0, 8);
  const tenant = randomUUID();
  const adminPerson = randomUUID();
  const superAdmin = { user: randomUUID(), session: randomUUID() };
  const orgAdmin = { user: randomUUID(), session: randomUUID() };
  const sent: {
    readonly provider: string;
    readonly secrets: unknown;
    readonly email: OutgoingEmail;
  }[] = [];
  const log = vi.fn();

  const transportFor = ((
    provider: string,
    _options: unknown,
    secrets: unknown,
  ): EmailTransport => ({
    provider: provider as EmailTransport['provider'],
    send: (email) => {
      sent.push({ provider, secrets, email });
      return Promise.resolve({ providerMessageId: `fake-${String(sent.length)}` });
    },
  })) as unknown as typeof createProviderTransport;

  const claims = (who: { user: string; session: string }, tenantId?: string, person?: string) => {
    const r = brandVerifiedClaims({
      sub: who.user,
      role: 'authenticated',
      aal: 'aal1',
      session_id: who.session,
      ...(tenantId ? { tenant_id: tenantId } : {}),
      ...(person ? { person_id: person } : {}),
    });
    if (!r.ok) throw new Error('bad fixture');
    return r.value;
  };
  const asSuper = <T>(fn: Parameters<typeof withUserTx<T>>[1]) =>
    withUserTx(claims(superAdmin), fn);
  const asOrgAdmin = <T>(fn: Parameters<typeof withUserTx<T>>[1]) =>
    withUserTx(claims(orgAdmin, tenant, adminPerson), fn);
  const testTask = createEmailTestTask({ keys, withPlatformTx, log, transportFor });
  const router = createEmailRouter({ keys, installation: null, log, transportFor });
  const route = () =>
    withSystemTx({ tenantId: tenant, jobId: 'test.route:1' }, (tx) => router.resolve(tx, tenant));

  beforeAll(async () => {
    await owner.execute(sql`insert into platform.tenants (id, slug, name_ar, name_en, status)
      values (${tenant}, ${`mail-${tag}`}, 'شركة البريد', 'Mail Company', 'active')`);
    await owner.execute(sql`insert into platform.persons (id, tenant_id, display_name_ar, email)
      values (${adminPerson}, ${tenant}, 'مدير', ${`admin-${tag}@example.test`})`);
    for (const [who, email] of [
      [superAdmin, `super-${tag}@example.test`],
      [orgAdmin, `admin-${tag}@example.test`],
    ] as const) {
      await owner.execute(sql`insert into auth.users (id, email) values (${who.user}, ${email})`);
      await owner.execute(
        sql`insert into auth.sessions (id, user_id) values (${who.session}, ${who.user})`,
      );
    }
    await owner.execute(sql`select private.grant_platform_admin(${superAdmin.user}::uuid)`);
    await owner.execute(sql`
      with m as (insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
                 values (${tenant}, ${orgAdmin.user}, ${adminPerson}, 'active') returning id)
      insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
      select ${tenant}, m.id, 'tenant_admin', true from m`);
    await owner.execute(sql`insert into platform.session_context (session_id, user_id, active_tenant_id)
      values (${orgAdmin.session}, ${orgAdmin.user}, ${tenant})`);
    // A clean slate for the singleton rows (other suites of this run may have used them).
    await owner.execute(sql`delete from private.platform_email_settings`);
    await owner.execute(sql`delete from private.email_credentials_key`);
  });

  afterAll(async () => {
    await owner.execute(sql`delete from private.platform_email_settings`);
    await owner.execute(sql`delete from private.email_credentials_key`);
    await owner.execute(sql`select private.revoke_platform_admin(${superAdmin.user}::uuid)`);
    await owner.$client.end();
    await serverDb.$client.end();
    await workerDb.$client.end();
  });

  it('nothing set up: no key for the web app, messages would wait', async () => {
    await expect(asSuper((tx) => getEmailCredentialsPublicKey(tx))).resolves.toBeNull();
    await expect(route()).resolves.toEqual({ kind: 'wait', code: 'NO_SENDER' });
  });

  it('the platform sender: saved with a sealed secret, verified only once its test went out', async () => {
    await testTask.run({ jobId: 'test.email_tests:1' }); // publishes the key
    const key = await asSuper((tx) => getEmailCredentialsPublicKey(tx));
    expect(key).toEqual(keys.publicKey);
    const sealed = sealProviderInput(
      key!,
      { kind: 'platform' },
      {
        provider: 'resend',
        options: {},
        secrets: { apiKey: 're_platform_integration' },
      },
    );
    await asSuper((tx) =>
      savePlatformEmailSettings(tx, {
        provider: 'resend',
        options: {},
        credentialsSealed: sealed,
        fromName: 'ENTLAQA',
        fromAddress: 'no-reply@jadarat.example',
        testTo: 'ops@entlaqa.example',
        version: null,
      }),
    );
    await expect(route()).resolves.toEqual({ kind: 'wait', code: 'NO_SENDER' }); // not verified yet
    await testTask.run({ jobId: 'test.email_tests:2' });
    expect(sent.at(-1)).toMatchObject({
      provider: 'resend',
      secrets: { apiKey: 're_platform_integration' },
      email: {
        to: 'ops@entlaqa.example',
        from: { name: 'ENTLAQA', address: 'no-reply@jadarat.example' },
      },
    });
    const view = await asSuper((tx) => getPlatformEmailSettings(tx));
    expect(view.sender).toMatchObject({
      status: 'verified',
      credentialsCurrent: true,
      test: { status: 'sent' },
    });
    // Organizations' messages now go out through it, with the organization's brand name.
    await expect(route()).resolves.toMatchObject({
      kind: 'send',
      sender: 'platform',
      from: { name: 'Mail Company', address: 'no-reply@jadarat.example' },
    });
  });

  it("the organization's own provider wins once tested and enabled; switching off goes back", async () => {
    const key = await asOrgAdmin((tx) => getEmailCredentialsPublicKey(tx));
    const sealed = sealProviderInput(
      key!,
      { kind: 'tenant', tenantId: tenant },
      {
        provider: 'sendgrid',
        options: {},
        secrets: { apiKey: 'SG.integration.secretvalue' },
      },
    );
    const saved = await asOrgAdmin((tx) =>
      saveTenantEmailSettings(tx, {
        provider: 'sendgrid',
        options: {},
        credentialsSealed: sealed,
        fromName: 'Mail Company Training',
        fromAddress: 'training@mail.example',
        replyTo: 'hr@mail.example',
        version: null,
      }),
    );
    expect(saved).toMatchObject({ version: 1, reverify: true });
    await asOrgAdmin((tx) => requestTenantEmailTest(tx, 'it@mail.example'));
    await testTask.run({ jobId: 'test.email_tests:3' });
    expect(sent.at(-1)).toMatchObject({
      provider: 'sendgrid',
      secrets: { apiKey: 'SG.integration.secretvalue' },
      email: { to: 'it@mail.example', replyTo: 'hr@mail.example' },
    });
    const version = await asOrgAdmin((tx) => setTenantEmailEnabled(tx, true, 1));
    await expect(route()).resolves.toMatchObject({
      kind: 'send',
      sender: 'organization',
      from: { name: 'Mail Company Training', address: 'training@mail.example' },
      replyTo: 'hr@mail.example',
    });
    const view = await asOrgAdmin((tx) => getTenantEmailSettings(tx));
    expect(view.sender).toMatchObject({ enabled: true, status: 'verified' });
    expect(JSON.stringify(view)).not.toContain('v1.');
    await asOrgAdmin((tx) => setTenantEmailEnabled(tx, false, version));
    await expect(route()).resolves.toMatchObject({ kind: 'send', sender: 'platform' });
  });

  it('a message waiting for a sender is queued again once one is ready', async () => {
    const id = await withSystemTx({ tenantId: tenant, jobId: 'test.mail:1' }, async (tx) => {
      const [row] = await tx.execute<{ id: string }>(sql`
        insert into platform.message_deliveries
          (template, template_version, locale, destination, destination_masked, subject, html_body, text_body)
        values ('platform.invitation', 1, 'en', 'w@mail.example', 'w***@mail.example', 's', 'h', 't')
        returning id`);
      await tx.execute(
        sql`update platform.message_deliveries set status = 'sending', attempts = 1 where id = ${row!.id}::uuid`,
      );
      await tx.execute(sql`update platform.message_deliveries set status = 'queued', error_code = 'NO_SENDER'
                           where id = ${row!.id}::uuid`);
      return row!.id;
    });
    const resume = createEmailResumeTask({ router, withPlatformTx, withSystemTx, log });
    await resume.run({ jobId: 'test.email_resume:1' });
    const [delivery] = await owner.execute<{ error_code: string | null; status: string }>(
      sql`select status, error_code from platform.message_deliveries where id = ${id}::uuid`,
    );
    expect(delivery).toEqual({ status: 'queued', error_code: null });
    const events = await owner.execute<{
      n: number;
    }>(sql`select count(*)::int as n from platform.event_outbox
      where subject = ${id}::uuid and type = 'com.entlaqa.platform.email.queued'`);
    expect(events[0]?.n).toBe(1);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/re_platform|SG\.integration|w@mail/);
  });
});
