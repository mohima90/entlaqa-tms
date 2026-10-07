/**
 * Changing a member's roles (T-M2-14) against PostgreSQL under withUserTx: diff writes, the primary
 * slot, validity days in the organization's time zone, concurrent edits, own roles, members without an
 * account, the HR Manager vs privileged-member rule of the role guard, and separation of duties
 * (BR-IAM-4, T-M2-16) — also between two transactions running at the same time.
 */
import { randomUUID } from 'node:crypto';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from './client';
import {
  type AssignedRole,
  getEditableRoles,
  replaceMemberRoles,
  rolesRefusalOf,
} from './role-admin';
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

  const role = (roleCode: string, over: Partial<AssignedRole> = {}): AssignedRole => ({
    roleCode,
    isPrimary: false,
    validFrom: null,
    validUntil: null,
    ...over,
  });

  /** One transaction; a refusal is returned (and the transaction rolled back). */
  const change = (
    as: (typeof all)[number],
    personId: string,
    desired: readonly AssignedRole[],
    version?: string,
  ) =>
    withUserTx(claimsOf(as), async (tx) => {
      const current = await getEditableRoles(tx, personId);
      const outcome = await replaceMemberRoles(
        tx,
        personId,
        version ?? current?.version ?? '',
        desired,
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
  });

  afterAll(async () => {
    await owner`delete from platform.session_context where active_tenant_id = ${tenant}`;
    await owner`delete from platform.tenant_memberships where tenant_id = ${tenant}`;
    await owner`delete from platform.branches where tenant_id = ${tenant}`;
    await owner`delete from platform.persons where tenant_id = ${tenant}`;
    for (const m of all) await owner`delete from auth.users where id = ${m.user}`;
    await owner.end();
    await serverDb.$client.end();
    await serverDb2.$client.end();
  });

  it('reads the roles, the version token and who may change them', async () => {
    const roles = await withUserTx(claimsOf(admin), (tx) => getEditableRoles(tx, sara.person));
    expect(roles).toMatchObject({
      isSelf: false,
      mayManage: true,
      membershipStatus: 'active',
      roles: [role('learner', { isPrimary: true })],
      timeZone: 'Asia/Riyadh',
    });
    expect(roles?.version).toMatch(/^learner:[0-9a-f-]{36}:1$/);
    const own = await withUserTx(claimsOf(admin), (tx) => getEditableRoles(tx, admin.person));
    expect(own?.isSelf).toBe(true);
    const none = await withUserTx(claimsOf(admin), (tx) => getEditableRoles(tx, noLogin.person));
    expect(none).toMatchObject({ membershipId: null, roles: [], version: '' });
  });

  it('writes only the differences; days are whole days in the organization time zone', async () => {
    const outcome = await change(admin, sara.person, [
      role('training_coordinator', { isPrimary: true }),
      role('learner', { validFrom: '2026-01-01', validUntil: '2026-12-31' }),
    ]);
    expect(outcome).toMatchObject({
      ok: true,
      changed: true,
      before: [role('learner', { isPrimary: true })],
      after: [
        role('training_coordinator', { isPrimary: true }),
        role('learner', { validFrom: '2026-01-01', validUntil: '2026-12-31' }),
      ],
    });
    const [stored] = await owner<{ from: Date; until: Date }[]>`
      select valid_from as from, valid_until as until from platform.role_assignments ra
      join platform.tenant_memberships m on m.id = ra.membership_id
      where m.user_id = ${sara.user} and ra.role_code = 'learner'`;
    // Riyadh is UTC+3: the year starts at 21:00 UTC the day before and ends after 31 December.
    expect(stored?.from.toISOString()).toBe('2025-12-31T21:00:00.000Z');
    expect(stored?.until.toISOString()).toBe('2026-12-31T21:00:00.000Z');

    // The same roles again: nothing written.
    const again = await change(admin, sara.person, [
      role('training_coordinator', { isPrimary: true }),
      role('learner', { validFrom: '2026-01-01', validUntil: '2026-12-31' }),
    ]);
    expect(again).toMatchObject({ ok: true, changed: false });

    // Moving the primary slot to an existing role and dropping another in one change: the promoted
    // role keeps its days (an ended role is never revived by a save).
    expect(await change(admin, sara.person, [role('learner', { isPrimary: true })])).toMatchObject({
      ok: true,
      changed: true,
      after: [
        role('learner', { isPrimary: true, validFrom: '2026-01-01', validUntil: '2026-12-31' }),
      ],
    });
    // Back to a primary without days for the following tests (set by the owner, outside the screen).
    await owner`update platform.role_assignments ra set valid_from = null, valid_until = null
      from platform.tenant_memberships m where m.id = ra.membership_id and m.user_id = ${sara.user}`;
  });

  it('refuses a stale version, own roles, members without an account and bad dates', async () => {
    expect(
      await change(admin, sara.person, [role('mentor', { isPrimary: true })], 'learner:0'),
    ).toEqual({ ok: false, refusal: 'version_conflict' });
    expect(await change(admin, admin.person, [role('tenant_admin', { isPrimary: true })])).toEqual({
      ok: false,
      refusal: 'own_roles',
    });
    expect(await change(admin, noLogin.person, [role('learner', { isPrimary: true })])).toEqual({
      ok: false,
      refusal: 'no_account',
    });
    expect(
      await change(admin, sara.person, [
        role('learner', { isPrimary: true }),
        role('mentor', { validFrom: '2026-05-02', validUntil: '2026-05-01' }),
      ]),
    ).toEqual({ ok: false, refusal: 'dates_invalid' });
  });

  it('HR Manager: ordinary roles of ordinary members only', async () => {
    expect(
      await change(hr, sara.person, [role('learner', { isPrimary: true }), role('mentor')]),
    ).toMatchObject({ ok: true, changed: true });
    expect(
      await change(hr, sara.person, [role('learner', { isPrimary: true }), role('auditor')]),
    ).toEqual({ ok: false, refusal: 'not_allowed' });
    expect(await change(hr, admin.person, [role('tenant_admin', { isPrimary: true })])).toEqual({
      ok: false,
      refusal: 'not_allowed',
    });
    // Once Sara holds a privileged role (given by the Organization Admin), HR cannot change her roles.
    expect(
      await change(admin, sara.person, [role('learner', { isPrimary: true }), role('auditor')]),
    ).toMatchObject({ ok: true });
    expect(await change(hr, sara.person, [role('learner', { isPrimary: true })])).toEqual({
      ok: false,
      refusal: 'not_allowed',
    });
  });

  it('primary days are kept; revoked members are refused', async () => {
    // A primary role that has an end day (set outside this screen) keeps it when other roles change.
    await owner`update platform.role_assignments ra set valid_until = '2030-01-01 00:00+03'
      from platform.tenant_memberships m
      where m.id = ra.membership_id and m.user_id = ${sara.user} and ra.is_primary`;
    const saved = await change(admin, sara.person, [
      role('learner', { isPrimary: true }),
      role('mentor'),
    ]);
    expect(saved).toMatchObject({ ok: true, changed: true });
    const roles = await withUserTx(claimsOf(admin), (tx) => getEditableRoles(tx, sara.person));
    expect(roles?.roles.find((r) => r.isPrimary)).toMatchObject({
      roleCode: 'learner',
      validUntil: '2029-12-31',
    });

    await owner`update platform.tenant_memberships set status = 'revoked' where user_id = ${sara.user}`;
    expect(await change(admin, sara.person, [role('learner', { isPrimary: true })])).toEqual({
      ok: false,
      refusal: 'membership_revoked',
    });
    await owner`update platform.tenant_memberships set status = 'active' where user_id = ${sara.user}`;
  });

  it("days follow the headquarters' time zone, also across a daylight-saving change", async () => {
    // Cairo moved its clocks forward at midnight on 26 April 2024: that midnight does not exist.
    await owner`insert into platform.branches (tenant_id, code, name_ar, is_headquarters, timezone)
      values (${tenant}, 'CAI', 'القاهرة', true, 'Africa/Cairo')`;
    const saved = await change(admin, sara.person, [
      role('learner', { isPrimary: true, validUntil: '2029-12-31' }),
      role('mentor', { validFrom: '2024-04-01', validUntil: '2024-04-25' }),
    ]);
    expect(saved).toMatchObject({ ok: true });
    const roles = await withUserTx(claimsOf(admin), (tx) => getEditableRoles(tx, sara.person));
    expect(roles?.timeZone).toBe('Africa/Cairo');
    expect(roles?.roles.find((r) => r.roleCode === 'mentor')).toMatchObject({
      validFrom: '2024-04-01',
      validUntil: '2024-04-25',
    });
  });

  it('separation of duties: never Organization Admin and HR Manager together (BR-IAM-4)', async () => {
    const conflicts = (roles: readonly AssignedRole[]) =>
      roles.some((r) => r.roleCode === 'tenant_admin') &&
      roles.some((r) => r.roleCode === 'hr_manager');
    const both = [role('learner', { isPrimary: true }), role('tenant_admin'), role('hr_manager')];
    // The application refuses first (before writing), the database anyway.
    const early = await withUserTx(claimsOf(admin), async (tx) => {
      const current = await getEditableRoles(tx, omar.person);
      return replaceMemberRoles(tx, omar.person, current?.version ?? '', both, { conflicts });
    });
    expect(early).toEqual({ ok: false, refusal: 'role_conflict' });
    expect(await change(admin, omar.person, both)).toEqual({ ok: false, refusal: 'role_conflict' });
    // A scheduled hand-over is fine: Organization Admin until the day before HR Manager starts.
    expect(
      await change(admin, omar.person, [
        role('learner', { isPrimary: true }),
        role('tenant_admin', { validUntil: '2031-01-31' }),
        role('hr_manager', { validFrom: '2031-02-01' }),
      ]),
    ).toMatchObject({ ok: true, changed: true });
    expect(
      await change(admin, omar.person, [
        role('learner', { isPrimary: true }),
        role('tenant_admin', { validUntil: '2031-02-01' }),
        role('hr_manager', { validFrom: '2031-02-01' }),
      ]),
    ).toEqual({ ok: false, refusal: 'role_conflict' });
    expect(await change(admin, omar.person, [role('learner', { isPrimary: true })])).toMatchObject({
      ok: true,
    });
  });

  it('separation of duties holds between two concurrent transactions (race-safe)', async () => {
    const give = (code: string) =>
      sql`insert into platform.role_assignments (membership_id, role_code)
          select id, ${code} from platform.tenant_memberships where person_id = ${omar.person}::uuid`;
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
    // First transaction: gives HR Manager, then stays open (holding the organization's role lock).
    const first = withUserTx(claimsOf(admin), async (tx) => {
      await tx.execute(give('hr_manager'));
      firstWrote();
      await held;
    });
    await wrote;
    // Second transaction, at the same time: gives Organization Admin — it waits for the first.
    const second = withUserTx2(claimsOf(admin), (tx) => tx.execute(give('tenant_admin'))).then(
      () => 'saved',
      (error: unknown) => rolesRefusalOf(error),
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
    // Once the first commits, the second sees its row and is refused.
    expect(await second).toBe('role_conflict');
    const [stored] = await owner<{ codes: string[] }[]>`
      select array_agg(ra.role_code order by ra.role_code) as codes from platform.role_assignments ra
      join platform.tenant_memberships m on m.id = ra.membership_id where m.person_id = ${omar.person}`;
    expect(stored?.codes).toEqual(['hr_manager', 'learner']);
  });
});
