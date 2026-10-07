/**
 * Invitations end to end against PostgreSQL (T-M2-07, FR-IAM-03): invite (withUserTx) → the mailer job
 * issues a token (withSystemTx) → the public page looks the link up (app_server without claims) → Auth's
 * sign-up hook admits the e-mailed token for that e-mail only → the new account accepts it with its own
 * session → used; revoke; resend limit; acceptance by a signed-in existing account.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from './client';
import { isDomainError } from './domain-error';
import {
  type NewInvitation,
  acceptInvitationAsCaller,
  createInvitation,
  createInvitationTokenApi,
  hashInvitationToken,
  listInvitations,
  requestInvitationResend,
  revokeInvitation,
} from './invitations';
import {
  createWithSystemTx,
  invitationActorMayManage,
  issueInvitationToken,
  loadInvitationForMail,
} from './jobs';
import { createWithUserTx } from './with-user-tx';

const ownerUrl = process.env.TEST_DATABASE_URL;
const appServerUrl = process.env.TEST_APP_SERVER_URL;
const appWorkerUrl = process.env.TEST_APP_WORKER_URL;
const configured = Boolean(ownerUrl && appServerUrl && appWorkerUrl);

if ((process.env.CI || process.env.JADARAT_REQUIRE_INTEGRATION) && !configured) {
  throw new Error('TEST_DATABASE_URL, TEST_APP_SERVER_URL and TEST_APP_WORKER_URL must be set');
}

describe.skipIf(!configured)('invitations against PostgreSQL', () => {
  const owner = postgres(ownerUrl ?? '', { max: 1, onnotice: () => undefined });
  const serverDb = createDatabase(appServerUrl ?? '', { max: 1 });
  const workerDb = createDatabase(appWorkerUrl ?? '', { max: 1 });
  const withUserTx = createWithUserTx(() => serverDb);
  const withSystemTx = createWithSystemTx(() => workerDb);
  const tokens = createInvitationTokenApi(() => serverDb);
  const tenant = randomUUID();
  const tag = tenant.slice(0, 8);
  const member = (role: string) => ({
    user: randomUUID(),
    session: randomUUID(),
    person: randomUUID(),
    role,
  });
  const admin = member('tenant_admin');
  const hr = member('hr_manager');

  const claimsOf = (m: ReturnType<typeof member>, tenantId: string | null = tenant) => {
    const r = brandVerifiedClaims({
      sub: m.user,
      role: 'authenticated',
      aal: 'aal1',
      session_id: m.session,
      ...(tenantId ? { tenant_id: tenantId, person_id: m.person } : {}),
    });
    if (!r.ok) throw new Error('bad fixture');
    return r.value;
  };

  const newInvitation = (email: string, over: Partial<NewInvitation> = {}): NewInvitation => ({
    email,
    firstNameAr: 'سارة',
    familyNameAr: 'الأحمد',
    firstNameEn: 'Sara',
    familyNameEn: 'Ahmed',
    primaryRole: 'learner',
    additionalRoles: ['mentor'],
    locale: 'ar',
    ...over,
  });

  /** What the mailer job does: a random token, its hash stored. */
  const mail = (invitationId: string) =>
    withSystemTx({ tenantId: tenant, jobId: `platform.invitations.mailer:${tag}` }, async (tx) => {
      const token = randomBytes(32).toString('base64url');
      const issued = await issueInvitationToken(tx, invitationId, hashInvitationToken(token));
      return issued ? { token, expiresAt: issued.expiresAt } : null;
    });

  const failureOf = (promise: Promise<unknown>) =>
    promise.then(() => null).catch((e: unknown) => e);

  beforeAll(async () => {
    await owner`insert into platform.tenants (id, slug, name_ar, name_en, status)
      values (${tenant}, ${`inv-${tag}`}, 'منشأة الدعوات', 'Invitations Org', 'active')`;
    for (const m of [admin, hr]) {
      await owner`insert into auth.users (id, email) values (${m.user}, ${`${m.user}@example.test`})`;
      await owner`insert into auth.sessions (id, user_id) values (${m.session}, ${m.user})`;
      await owner`insert into platform.persons (id, tenant_id, display_name_ar, email)
        values (${m.person}, ${tenant}, ${m.role}, ${`${m.user}@example.test`})`;
      const [membership] = await owner<{ id: string }[]>`
        insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
        values (${tenant}, ${m.user}, ${m.person}, 'active') returning id`;
      await owner`insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
        values (${tenant}, ${membership?.id ?? ''}, ${m.role}, true)`;
      await owner`insert into platform.session_context (session_id, user_id, active_tenant_id)
        values (${m.session}, ${m.user}, ${tenant})`;
    }
  });

  afterAll(async () => {
    await owner.end();
    await serverDb.$client.end();
    await workerDb.$client.end();
  });

  it('invite → e-mail token → valid link → new account accepts → used', async () => {
    const email = `sara-${tag}@example.test`;
    const created = await withUserTx(claimsOf(hr), (tx) =>
      createInvitation(tx, newInvitation(email)),
    );
    const [event] = await owner<
      { n: number }[]
    >`select count(*)::int as n from platform.event_outbox
      where type = 'com.entlaqa.platform.invitation.created' and subject = ${created.invitationId}`;
    expect(event?.n).toBe(1);

    const forMail = await withSystemTx({ tenantId: tenant, jobId: 'test' }, (tx) =>
      loadInvitationForMail(tx, created.invitationId),
    );
    expect(forMail).toMatchObject({
      id: created.invitationId,
      status: 'pending',
      sendCount: 0,
      email,
      locale: 'ar',
      personId: created.personId,
      recipientName: { ar: 'سارة الأحمد', en: 'Sara Ahmed' },
      inviterName: { ar: 'hr_manager', en: null },
      organizationName: { ar: 'منشأة الدعوات', en: 'Invitations Org' },
      primaryRole: 'learner',
    });

    const sent = await mail(created.invitationId);
    expect(sent).not.toBeNull();
    const days = ((sent?.expiresAt.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
    const hash = hashInvitationToken(sent?.token ?? '');

    await expect(tokens.invitationByToken(hash)).resolves.toEqual({
      state: 'valid',
      email,
      locale: 'ar',
      organizationName: { ar: 'منشأة الدعوات', en: 'Invitations Org' },
      displayName: { ar: 'سارة الأحمد', en: 'Sara Ahmed' },
    });
    await expect(tokens.invitationByToken(hashInvitationToken('guess'))).resolves.toEqual({
      state: 'invalid',
    });

    // The invitee signs up through the public Auth API with the e-mailed (raw) token in the metadata:
    // Auth's before-user-created hook admits exactly that e-mail with exactly that token.
    const hook = (userEmail: string, token: string) =>
      owner.begin(async (sql) => {
        await sql`set local role supabase_auth_admin`;
        const [row] = await sql<{ answer: unknown }[]>`
          select private.before_user_created_hook(${sql.json({
            user: {
              email: userEmail,
              phone: '',
              is_anonymous: false,
              app_metadata: { provider: 'email', providers: ['email'] },
              user_metadata: { invitation: token },
            },
          })}::jsonb) as answer`;
        return row?.answer;
      });
    const deny = { error: { http_code: 403, message: 'Sign-up is by invitation only.' } };
    await expect(hook(email, sent?.token ?? '')).resolves.toEqual({});
    await expect(hook(`someone-${tag}@example.test`, sent?.token ?? '')).resolves.toEqual(deny);
    await expect(hook(email, hash.toString('hex'))).resolves.toEqual(deny);

    // Auth created the account and its session; the web app accepts with that session.
    const newcomer = member('learner');
    await owner`insert into auth.users (id, email) values (${newcomer.user}, ${email})`;
    await owner`insert into auth.sessions (id, user_id) values (${newcomer.session}, ${newcomer.user})`;
    await expect(
      withUserTx(claimsOf(newcomer, null), (tx) =>
        acceptInvitationAsCaller(tx, hash, { ar: 'سارة', en: null }),
      ),
    ).resolves.toEqual({ tenantId: tenant });
    const newUser = newcomer.user;

    await expect(tokens.invitationByToken(hash)).resolves.toEqual({ state: 'used' });
    await expect(hook(email, sent?.token ?? '')).resolves.toEqual(deny);
    const again = await failureOf(
      withUserTx(claimsOf(newcomer, null), (tx) => acceptInvitationAsCaller(tx, hash)),
    );
    expect(isDomainError(again, 'INVITATION_NOT_VALID')).toBe(true);

    const [membership] = await owner<{ status: string; roles: string; name: string }[]>`
      select m.status, string_agg(ra.role_code || ':' || ra.is_primary, ',' order by ra.role_code) as roles,
             p.display_name_ar as name
      from platform.tenant_memberships m
      join platform.role_assignments ra on ra.tenant_id = m.tenant_id and ra.membership_id = m.id
      join platform.persons p on p.tenant_id = m.tenant_id and p.id = m.person_id
      where m.tenant_id = ${tenant} and m.user_id = ${newUser}
      group by m.status, p.display_name_ar`;
    expect(membership).toEqual({
      status: 'active',
      roles: 'learner:true,mentor:false',
      name: 'سارة',
    });

    const accepted = await withUserTx(claimsOf(admin), (tx) =>
      listInvitations(tx, { state: 'accepted' }),
    );
    expect(accepted.map((r) => r.id)).toEqual([created.invitationId]);
    expect(accepted[0]?.expiresAt).toBeInstanceOf(Date);
    expect(accepted[0]?.sendCount).toBe(1);
  });

  it('refuses taken e-mails and privileged roles for an HR Manager', async () => {
    const email = `taken-${tag}@example.test`;
    await withUserTx(claimsOf(hr), (tx) => createInvitation(tx, newInvitation(email)));
    const taken = await failureOf(
      withUserTx(claimsOf(hr), (tx) => createInvitation(tx, newInvitation(email.toUpperCase()))),
    );
    expect(isDomainError(taken, 'EMAIL_TAKEN')).toBe(true);
    const privileged = await failureOf(
      withUserTx(claimsOf(hr), (tx) =>
        createInvitation(
          tx,
          newInvitation(`boss-${tag}@example.test`, { primaryRole: 'tenant_admin' }),
        ),
      ),
    );
    expect(isDomainError(privileged, 'ROLE_NOT_ALLOWED')).toBe(true);
    // An Organization Admin may.
    await expect(
      withUserTx(claimsOf(admin), (tx) =>
        createInvitation(
          tx,
          newInvitation(`boss-${tag}@example.test`, { primaryRole: 'tenant_admin' }),
        ),
      ),
    ).resolves.toMatchObject({ invitationId: expect.any(String) });
  });

  it('revokes a pending invitation: its link reads revoked and cannot be accepted', async () => {
    const email = `revoked-${tag}@example.test`;
    const { invitationId } = await withUserTx(claimsOf(hr), (tx) =>
      createInvitation(tx, newInvitation(email)),
    );
    const sent = await mail(invitationId);
    await expect(
      withUserTx(claimsOf(hr), (tx) => revokeInvitation(tx, invitationId)),
    ).resolves.toBe(true);
    await expect(
      withUserTx(claimsOf(hr), (tx) => revokeInvitation(tx, invitationId)),
    ).resolves.toBe(false);
    const hash = hashInvitationToken(sent?.token ?? '');
    await expect(tokens.invitationByToken(hash)).resolves.toEqual({ state: 'revoked' });
    await expect(mail(invitationId)).resolves.toBeNull();
    await expect(
      withUserTx(claimsOf(hr), (tx) => requestInvitationResend(tx, invitationId)),
    ).resolves.toBe('not_pending');
    const [revoked] = await owner<
      { n: number }[]
    >`select count(*)::int as n from platform.event_outbox
      where type = 'com.entlaqa.platform.invitation.revoked' and subject = ${invitationId}`;
    expect(revoked?.n).toBe(1);
  });

  it('resend of a privileged invitation: Organization Admin only; the mailer re-checks the actor', async () => {
    const { invitationId } = await withUserTx(claimsOf(admin), (tx) =>
      createInvitation(
        tx,
        newInvitation(`auditor-${tag}@example.test`, {
          primaryRole: 'auditor',
          additionalRoles: [],
        }),
      ),
    );
    await mail(invitationId);
    const refused = await failureOf(
      withUserTx(claimsOf(hr), (tx) => requestInvitationResend(tx, invitationId)),
    );
    expect(isDomainError(refused, 'ROLE_NOT_ALLOWED')).toBe(true);
    await expect(
      withUserTx(claimsOf(admin), (tx) => requestInvitationResend(tx, invitationId)),
    ).resolves.toBe('queued');
    const [requested] = await owner<{ by: string; events: number }[]>`
      select i.resend_requested_by as by,
             (select count(*)::int from platform.event_outbox e
              where e.type = 'com.entlaqa.platform.invitation.resend_requested' and e.subject = i.id
                and e.actor_type = 'user' and e.actor_id = ${admin.user}) as events
      from platform.invitations i where i.id = ${invitationId}`;
    expect(requested).toEqual({ by: admin.user, events: 1 });

    const mayManage = (userId: string) =>
      withSystemTx({ tenantId: tenant, jobId: 'test' }, (tx) =>
        invitationActorMayManage(tx, invitationId, userId),
      );
    await expect(mayManage(admin.user)).resolves.toBe(true);
    await expect(mayManage(hr.user)).resolves.toBe(false);
    await expect(mayManage(randomUUID())).resolves.toBe(false);
  });

  it('resends up to 4 e-mails in all; a new link replaces the old one', async () => {
    const { invitationId } = await withUserTx(claimsOf(hr), (tx) =>
      createInvitation(tx, newInvitation(`resend-${tag}@example.test`)),
    );
    const first = await mail(invitationId);
    for (let i = 0; i < 3; i += 1) {
      await expect(
        withUserTx(claimsOf(hr), (tx) => requestInvitationResend(tx, invitationId)),
      ).resolves.toBe('queued');
      await expect(mail(invitationId)).resolves.not.toBeNull();
    }
    await expect(
      withUserTx(claimsOf(hr), (tx) => requestInvitationResend(tx, invitationId)),
    ).resolves.toBe('limit_reached');
    await expect(mail(invitationId)).resolves.toBeNull();
    await expect(
      tokens.invitationByToken(hashInvitationToken(first?.token ?? '')),
    ).resolves.toEqual({ state: 'invalid' });
    const mine = (
      await withUserTx(claimsOf(hr), (tx) => listInvitations(tx, { state: 'pending' }))
    ).find((r) => r.id === invitationId);
    expect(mine?.sendCount).toBe(4);
  });

  it('a signed-in existing account accepts as caller; another account cannot', async () => {
    const existing = member('learner');
    const email = `existing-${tag}@example.test`;
    await owner`insert into auth.users (id, email, created_at)
      values (${existing.user}, ${email}, now() - interval '30 days')`;
    await owner`insert into auth.sessions (id, user_id) values (${existing.session}, ${existing.user})`;
    const { invitationId } = await withUserTx(claimsOf(hr), (tx) =>
      createInvitation(tx, newInvitation(email)),
    );
    const sent = await mail(invitationId);
    const hash = hashInvitationToken(sent?.token ?? '');

    // Another signed-in account (other e-mail) is refused.
    const other = await failureOf(
      withUserTx(claimsOf(admin, null), (tx) => acceptInvitationAsCaller(tx, hash)),
    );
    expect(isDomainError(other, 'INVITATION_ACCOUNT_MISMATCH')).toBe(true);

    await expect(
      withUserTx(claimsOf(existing, null), (tx) => acceptInvitationAsCaller(tx, hash)),
    ).resolves.toEqual({ tenantId: tenant });
    await expect(tokens.invitationByToken(hash)).resolves.toEqual({ state: 'used' });
  });
});
