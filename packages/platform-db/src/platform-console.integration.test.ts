/**
 * Platform Super Admin console against PostgreSQL (FR-ADM-17, migration 20261018100000): a Super Admin's
 * session WITHOUT an organization (withUserTx, app_server) lists and creates organizations; the created
 * invitation's code opens the link for that e-mail; the new account accepts it and becomes the ACTIVE
 * Organization Admin; a new code replaces the old one; everyone else is refused (NOT_PLATFORM_ADMIN).
 */
import { randomUUID } from 'node:crypto';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from './client';
import {
  acceptInvitationAsCaller,
  createInvitationTokenApi,
  hashInvitationToken,
} from './invitations';
import {
  createPlatformTenant,
  isPlatformAdmin,
  listPlatformTenants,
  platformAdminInvitationCode,
  reissuePlatformAdminCode,
} from './platform-console';
import { savePlan, setTenantPlan } from './plans';
import { createWithUserTx } from './with-user-tx';

const ownerUrl = process.env.TEST_DATABASE_URL;
const appServerUrl = process.env.TEST_APP_SERVER_URL;
const configured = Boolean(ownerUrl && appServerUrl);

if ((process.env.CI || process.env.JADARAT_REQUIRE_INTEGRATION) && !configured) {
  throw new Error('TEST_DATABASE_URL and TEST_APP_SERVER_URL must be set');
}

describe.skipIf(!configured)('platform console against PostgreSQL', () => {
  const owner = postgres(ownerUrl ?? '', { max: 1, onnotice: () => undefined });
  const serverDb = createDatabase(appServerUrl ?? '', { max: 1 });
  const withUserTx = createWithUserTx(() => serverDb);
  const tokens = createInvitationTokenApi(() => serverDb);
  const tag = randomUUID().slice(0, 8);
  const account = () => ({ user: randomUUID(), session: randomUUID() });
  const superAdmin = account();
  const stranger = account();
  const newcomer = account();
  const newcomerEmail = `org-admin-${tag}@example.test`;

  const claimsOf = (a: ReturnType<typeof account>) => {
    const r = brandVerifiedClaims({
      sub: a.user,
      role: 'authenticated',
      aal: 'aal1',
      session_id: a.session,
    });
    if (!r.ok) throw new Error('bad fixture');
    return r.value;
  };
  const failureOf = (promise: Promise<unknown>) =>
    promise.then(() => null).catch((e: unknown) => e);

  beforeAll(async () => {
    for (const [a, email] of [
      [superAdmin, `super-${tag}@example.test`],
      [stranger, `stranger-${tag}@example.test`],
      [newcomer, newcomerEmail],
    ] as const) {
      await owner`insert into auth.users (id, email) values (${a.user}, ${email})`;
      await owner`insert into auth.sessions (id, user_id) values (${a.session}, ${a.user})`;
    }
    await owner`select private.grant_platform_admin(${superAdmin.user})`;
  });

  afterAll(async () => {
    await owner`select private.revoke_platform_admin(${superAdmin.user})`;
    await owner.end();
    await serverDb.$client.end();
  });

  it('refuses everyone but a Super Admin', async () => {
    await expect(withUserTx(claimsOf(stranger), (tx) => isPlatformAdmin(tx))).resolves.toBe(false);
    for (const call of [
      withUserTx(claimsOf(stranger), (tx) => listPlatformTenants(tx)),
      withUserTx(claimsOf(stranger), (tx) =>
        createPlatformTenant(tx, {
          slug: `denied-${tag}`,
          nameAr: 'منشأة',
          adminEmail: 'a@denied.test',
          locale: 'en',
        }),
      ),
    ]) {
      await expect(failureOf(call)).resolves.toMatchObject({ code: 'NOT_PLATFORM_ADMIN' });
    }
  });

  it('create → link valid for that e-mail → the new account accepts → active Organization Admin', async () => {
    const claims = claimsOf(superAdmin);
    await expect(withUserTx(claims, (tx) => isPlatformAdmin(tx))).resolves.toBe(true);
    const created = await withUserTx(claims, (tx) =>
      createPlatformTenant(tx, {
        slug: `console-${tag}`,
        nameAr: 'منظمة الاختبار',
        nameEn: null,
        adminEmail: ` ${newcomerEmail.toUpperCase()} `,
        adminFirstNameAr: 'سارة',
        locale: 'ar',
      }),
    );
    const listed = await withUserTx(claims, (tx) => listPlatformTenants(tx));
    expect(listed.find((r) => r.tenantId === created.tenantId)).toMatchObject({
      slug: `console-${tag}`,
      nameEn: null,
      status: 'active',
      memberCount: 0,
      adminState: 'pending',
      adminInvitationLocale: 'ar',
    });
    await expect(
      withUserTx(claims, (tx) => platformAdminInvitationCode(tx, created.tenantId)),
    ).resolves.toMatchObject({ inviteCode: created.inviteCode, locale: 'ar' });

    // A new code: the old one stops working.
    const renewed = await withUserTx(claims, (tx) =>
      reissuePlatformAdminCode(tx, created.tenantId),
    );
    expect(renewed.inviteCode).not.toBe(created.inviteCode);
    await expect(
      tokens.invitationByToken(hashInvitationToken(created.inviteCode)),
    ).resolves.toEqual({ state: 'invalid' });
    await expect(
      tokens.invitationByToken(hashInvitationToken(renewed.inviteCode)),
    ).resolves.toMatchObject({ state: 'valid', email: newcomerEmail, locale: 'ar' });

    // The duplicate short name.
    await expect(
      failureOf(
        withUserTx(claims, (tx) =>
          createPlatformTenant(tx, {
            slug: `console-${tag}`,
            nameAr: 'أخرى',
            adminEmail: 'b@example.test',
            locale: 'en',
          }),
        ),
      ),
    ).resolves.toMatchObject({ code: 'SLUG_TAKEN' });

    // The invitee accepts with their own session (no organization yet).
    await expect(
      withUserTx(claimsOf(newcomer), (tx) =>
        acceptInvitationAsCaller(tx, hashInvitationToken(renewed.inviteCode)),
      ),
    ).resolves.toEqual({ tenantId: created.tenantId });
    const [role] = await owner<{ role_code: string; status: string }[]>`
      select ra.role_code, m.status from platform.role_assignments ra
      join platform.tenant_memberships m on m.tenant_id = ra.tenant_id and m.id = ra.membership_id
      where m.user_id = ${newcomer.user}`;
    expect(role).toEqual({ role_code: 'tenant_admin', status: 'active' });
    const after = await withUserTx(claims, (tx) => listPlatformTenants(tx));
    expect(after.find((r) => r.tenantId === created.tenantId)).toMatchObject({
      memberCount: 1,
      adminState: 'active',
      adminInvitationLocale: null,
    });
    await expect(
      failureOf(withUserTx(claims, (tx) => reissuePlatformAdminCode(tx, created.tenantId))),
    ).resolves.toMatchObject({ code: 'NO_PENDING_ADMIN' });
  });

  it('refuses invalid input in the database (field named)', async () => {
    await expect(
      failureOf(
        withUserTx(claimsOf(superAdmin), (tx) =>
          createPlatformTenant(tx, {
            slug: `ok-${tag}`,
            nameAr: 'منظمة',
            adminEmail: 'not-an-email',
            locale: 'en',
          }),
        ),
      ),
    ).resolves.toMatchObject({ code: 'PLATFORM_INVALID_INPUT', field: 'admin_email' });
  });
  it('creates an organization on a plan in one transaction, as the console does (WP-ADM-06)', async () => {
    const claims = claimsOf(superAdmin);
    const plan = await withUserTx(claims, (tx) =>
      savePlan(tx, {
        planId: null,
        name: `Plan ${tag}`,
        description: null,
        maxPeople: 10,
        maxStorageGb: 1,
        features: [],
        version: null,
      }),
    );
    for (const trial of [false, true]) {
      const created = await withUserTx(claims, async (tx) => {
        const tenant = await createPlatformTenant(tx, {
          slug: `planned-${trial ? 't' : 'a'}-${tag}`,
          nameAr: 'منظمة بخطة',
          nameEn: 'Planned',
          adminEmail: `planned-${trial ? 't' : 'a'}-${tag}@example.test`,
          adminFirstNameEn: 'Mona',
          adminFamilyNameEn: 'Ahmed',
          locale: 'en',
        });
        await setTenantPlan(tx, {
          tenantId: tenant.tenantId,
          planId: plan.planId,
          status: trial ? 'trial' : 'active',
          trialEndsAt: trial ? new Date(Date.now() + 30 * 86_400_000) : null,
          maxPeopleOverride: null,
          maxStorageGbOverride: null,
        });
        return tenant;
      });
      const [row] = await owner<{ plan_id: string; status: string }[]>`
        select plan_id, status from platform.tenants where id = ${created.tenantId}`;
      expect(row).toEqual({ plan_id: plan.planId, status: trial ? 'trial' : 'active' });
    }
  });
});
