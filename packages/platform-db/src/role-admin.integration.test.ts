/**
 * Changing a member's role (T-M2-14; EP-ROLES: one role per person) against PostgreSQL under withUserTx:
 * the row replaced, concurrent edits, own role, members without an account, custom roles, the HR Manager
 * vs privileged-member rule of the role guard (standard and custom roles, by permission), and the one-role
 * rule between two transactions running at the same time.
 */
import { randomUUID } from 'node:crypto';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from './client';
import { getEditableRole, replaceMemberRole, roleRefusalOf } from './role-admin';
import { createWithUserTx } from './with-user-tx';

const ownerUrl = process.env.TEST_DATABASE_URL;
const appServerUrl = process.env.TEST_APP_SERVER_URL;
const configured = Boolean(ownerUrl && appServerUrl);

if ((process.env.CI || process.env.JADARAT_REQUIRE_INTEGRATION) && !configured) {
  throw new Error('TEST_DATABASE_URL and TEST_APP_SERVER_URL must be set');
}

describe.skipIf(!configured)('changing roles against PostgreSQL', () => {
  const owner = postgres(ownerUrl ?? '', { max: 1, onnotice: () => undefined });
  const serverDb = createDatabase(appServerUrl ?? '', { max: 1 });
  const withUserTx = createWithUserTx(() => serverDb);
  // A second connection: two transactions at the same time.
  const serverDb2 = createDatabase(appServerUrl ?? '', { max: 1 });
  const withUserTx2 = createWithUserTx(() => serverDb2);
  const id = () => randomUUID();
  const tenant = id();
  const member = (role: string, name: string) => ({
    person: id(),
    user: id(),
    session: id(),
    role,
    name,
  });
  const admin = member('tenant_admin', 'أ-مدير');
  const hr = member('hr_manager', 'ب-موارد');
  const sara = member('learner', 'ث-سارة');
  const omar = member('learner', 'ح-عمر');
  const noLogin = { person: id() };
  const ordinary = `custom_${id().replace(/-/g, '').slice(0, 12)}`;
  const privileged = `custom_${id().replace(/-/g, '').slice(0, 12)}`;
  const all = [admin, hr, sara, omar];

  const claimsOf = (m: (typeof all)[number]) => {
    const r = brandVerifiedClaims({
      sub: m.user,
      role: 'authenticated',
      aal: 'aal1',
      session_id: m.session,
      tenant_id: tenant,
      person_id: m.person,
    });
    if (!r.ok) throw new Error('bad fixture');
    return r.value;
  };

  /** One transaction; a refusal is returned (and the transaction rolled back). */
  const change = (
    as: (typeof all)[number],
    personId: string,
    roleCode: string,
    options: { version?: string; isLocked?: (code: string) => boolean } = {},
  ) =>
    withUserTx(claimsOf(as), async (tx) => {
      const current = await getEditableRole(tx, personId);
      const outcome = await replaceMemberRole(
        tx,
        personId,
        options.version ?? current?.version ?? '',
        roleCode,
        options.isLocked ? { isLocked: options.isLocked } : {},
      );
      if (!outcome.ok) throw Object.assign(new Error('refused'), { outcome });
      return outcome;
    }).catch((error: unknown) => {
      const outcome = (error as { outcome?: unknown }).outcome;
      if (outcome) return outcome as { ok: false; refusal: string };
      throw error;
    });

  beforeAll(async () => {
    await owner`insert into platform.tenants (id, slug, name_ar, status)
      values (${tenant}, ${`ra-${tenant.slice(0, 8)}`}, 'أ', 'active')`;
    for (const m of all) {
      await owner`insert into auth.users (id, email) values (${m.user}, ${`${m.user}@example.test`})`;
      await owner`insert into auth.sessions (id, user_id) values (${m.session}, ${m.user})`;
      await owner`insert into platform.persons (id, tenant_id, display_name_ar)
        values (${m.person}, ${tenant}, ${m.name})`;
      await owner`insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
        values (${tenant}, ${m.user}, ${m.person}, 'active')`;
      await owner`insert into platform.session_context (session_id, user_id, active_tenant_id)
        values (${m.session}, ${m.user}, ${tenant})`;
      await owner`insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
        select tenant_id, id, ${m.role}, true from platform.tenant_memberships where user_id = ${m.user}`;
    }
    await owner`insert into platform.persons (id, tenant_id, display_name_ar)
      values (${noLogin.person}, ${tenant}, 'ج')`;
    // Custom roles (platform operation): an ordinary one (reading) and a privileged one (audit log).
    await owner`insert into platform.custom_roles (tenant_id, code, name_en, name_ar, data_scope) values
      (${tenant}, ${ordinary}, 'Reviewer', 'مراجع', 'organization'),
      (${tenant}, ${privileged}, 'Auditor', 'مدقق', 'organization')`;
    await owner`insert into platform.custom_role_permissions (tenant_id, custom_role_id, permission_code)
      select tenant_id, id, unnest(case when code = ${ordinary} then array['platform.user.read', 'platform.org.read']
                                        else array['platform.audit.read'] end)
      from platform.custom_roles where tenant_id = ${tenant}`;
  });

  afterAll(async () => {
    await owner`delete from platform.session_context where active_tenant_id = ${tenant}`;
    await owner`delete from platform.tenant_memberships where tenant_id = ${tenant}`;
    await owner`delete from platform.custom_roles where tenant_id = ${tenant}`;
    await owner`delete from platform.branches where tenant_id = ${tenant}`;
    await owner`delete from platform.persons where tenant_id = ${tenant}`;
    for (const m of all) await owner`delete from auth.users where id = ${m.user}`;
    await owner.end();
    await serverDb.$client.end();
    await serverDb2.$client.end();
  });

  it('reads the role, the version token and who may change it', async () => {
    const current = await withUserTx(claimsOf(admin), (tx) => getEditableRole(tx, sara.person));
    expect(current).toMatchObject({
      isSelf: false,
      mayManage: true,
      membershipStatus: 'active',
      roleCode: 'learner',
    });
    expect(current?.version).toMatch(/^learner:[0-9a-f-]{36}:1$/);
    const own = await withUserTx(claimsOf(admin), (tx) => getEditableRole(tx, admin.person));
    expect(own?.isSelf).toBe(true);
    const none = await withUserTx(claimsOf(admin), (tx) => getEditableRole(tx, noLogin.person));
    expect(none).toMatchObject({ membershipId: null, roleCode: null, version: '' });
  });

  it('replaces the role (one role per person); the same role again writes nothing', async () => {
    expect(await change(admin, sara.person, 'training_coordinator')).toEqual({
      ok: true,
      before: 'learner',
      after: 'training_coordinator',
      changed: true,
    });
    const [stored] = await owner<{ codes: string[] }[]>`
      select array_agg(ra.role_code) as codes from platform.role_assignments ra
      join platform.tenant_memberships m on m.id = ra.membership_id where m.user_id = ${sara.user}`;
    expect(stored?.codes).toEqual(['training_coordinator']);
    expect(await change(admin, sara.person, 'training_coordinator')).toMatchObject({
      ok: true,
      changed: false,
    });
    // A custom role of the organization.
    expect(await change(admin, sara.person, ordinary)).toMatchObject({ ok: true, after: ordinary });
    expect(await change(admin, sara.person, 'learner')).toMatchObject({ ok: true });
  });

  it('refuses a stale version, own role, members without an account and unknown roles', async () => {
    expect(
      await change(admin, sara.person, 'training_manager', { version: 'learner:x:0' }),
    ).toEqual({ ok: false, refusal: 'version_conflict' });
    expect(await change(admin, admin.person, 'learner')).toEqual({
      ok: false,
      refusal: 'own_role',
    });
    expect(await change(admin, noLogin.person, 'learner')).toEqual({
      ok: false,
      refusal: 'no_account',
    });
    expect(await change(admin, sara.person, 'auditor')).toEqual({
      ok: false,
      refusal: 'unknown_role',
    });
    expect(await change(admin, sara.person, 'custom_0123456789ab')).toEqual({
      ok: false,
      refusal: 'unknown_role',
    });
  });

  it('HR Manager: ordinary roles of ordinary members only (standard and custom, by permission)', async () => {
    // T-M3-10 (expectation changed, not the rule): department_head — the L&D Manager now grants
    // tms.needs_form.*, which the HR Manager does not hold, until the role-giving rule change.
    expect(await change(hr, sara.person, 'department_head')).toMatchObject({
      ok: true,
      changed: true,
    });
    expect(await change(hr, sara.person, ordinary)).toMatchObject({ ok: true, changed: true });
    expect(await change(hr, sara.person, privileged)).toEqual({
      ok: false,
      refusal: 'not_allowed',
    });
    expect(await change(hr, sara.person, 'hr_manager')).toEqual({
      ok: false,
      refusal: 'not_allowed',
    });
    expect(await change(hr, admin.person, 'learner')).toEqual({
      ok: false,
      refusal: 'not_allowed',
    });
    // The application's ordinary path refuses a privileged role before writing.
    expect(
      await change(hr, sara.person, privileged, { isLocked: (code) => code === privileged }),
    ).toEqual({ ok: false, refusal: 'privileged_change' });
    // Once Sara holds a privileged role (given by the Organization Admin), HR cannot change her role.
    expect(await change(admin, sara.person, privileged)).toMatchObject({ ok: true });
    expect(await change(hr, sara.person, 'learner')).toEqual({ ok: false, refusal: 'not_allowed' });
    expect(await change(admin, sara.person, 'learner')).toMatchObject({ ok: true });
  });

  it('revoked members are refused; an Organization Admin hands over to another', async () => {
    await owner`update platform.tenant_memberships set status = 'revoked' where user_id = ${sara.user}`;
    expect(await change(admin, sara.person, 'learner')).toEqual({
      ok: false,
      refusal: 'membership_revoked',
    });
    await owner`update platform.tenant_memberships set status = 'active' where user_id = ${sara.user}`;
    // Omar becomes an Organization Admin and gives uA another role (an admin remains); uA then may not
    // change roles any more.
    expect(await change(admin, omar.person, 'tenant_admin')).toMatchObject({ ok: true });
    expect(await change(omar, admin.person, 'learner')).toMatchObject({ ok: true });
    expect(await change(admin, omar.person, 'learner')).toEqual({
      ok: false,
      refusal: 'not_allowed',
    });
    // Back as it was, by the owner: one role per person, so a role is replaced (delete, then insert).
    await owner`delete from platform.role_assignments ra using platform.tenant_memberships m
      where m.id = ra.membership_id and m.user_id = ${admin.user}`;
    await owner`insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
      select tenant_id, id, 'tenant_admin', true from platform.tenant_memberships where user_id = ${admin.user}`;
    expect(await change(admin, omar.person, 'learner')).toMatchObject({ ok: true });
  });

  it('one role per person holds between two concurrent transactions (race-safe)', async () => {
    const give = (code: string) =>
      sql`insert into platform.role_assignments (membership_id, role_code, is_primary)
          select id, ${code}, true from platform.tenant_memberships where person_id = ${omar.person}::uuid`;
    // Omar starts without any role (set by the owner).
    await owner`delete from platform.role_assignments ra using platform.tenant_memberships m
      where m.id = ra.membership_id and m.person_id = ${omar.person}`;
    const signal = () => {
      let fire: () => void = () => undefined;
      const promise = new Promise<void>((resolve) => {
        fire = resolve;
      });
      return {
        promise,
        fire: () => {
          fire();
        },
      };
    };
    const { promise: held, fire: release } = signal();
    const { promise: wrote, fire: firstWrote } = signal();
    // First transaction: gives the Employee role, then stays open (holding the organization's role lock).
    const first = withUserTx(claimsOf(admin), async (tx) => {
      try {
        await tx.execute(give('learner'));
      } finally {
        firstWrote();
      }
      await held;
    });
    await wrote;
    // Second transaction, at the same time: gives Organization Admin — it waits for the first.
    const second = withUserTx2(claimsOf(admin), (tx) => tx.execute(give('tenant_admin'))).then(
      () => 'saved',
      (error: unknown) => roleRefusalOf(error),
    );
    // Wait until the second really waits for the organization's role lock (it must not run after).
    let blocked = false;
    try {
      for (let i = 0; i < 100 && !blocked; i += 1) {
        const [waiting] = await owner<{ n: number }[]>`
          select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted`;
        blocked = (waiting?.n ?? 0) > 0;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } finally {
      release();
    }
    expect(blocked).toBe(true);
    await first;
    // Once the first commits, the second sees its row and is refused (the Organization Admin is held
    // alone, BR-IAM-4 — JR001 — and one role per person).
    expect(await second).toBe('version_conflict');
    const [stored] = await owner<{ codes: string[] }[]>`
      select array_agg(ra.role_code order by ra.role_code) as codes from platform.role_assignments ra
      join platform.tenant_memberships m on m.id = ra.membership_id where m.person_id = ${omar.person}`;
    expect(stored?.codes).toEqual(['learner']);
  });
});
