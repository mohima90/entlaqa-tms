/**
 * Editing a person's details and placement (T-M2-13) against PostgreSQL: changed fields, unique
 * e-mail / employee number, manager loops, concurrent edits, the login e-mail, the manager picker, and
 * the HR Manager vs privileged-member rule (private.actor_may_manage_person) — under withUserTx.
 */
import { randomUUID } from 'node:crypto';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from './client';
import {
  type UserDetailsChange,
  getEditableUser,
  listManagerOptions,
  updateUserDetails,
} from './user-admin';
import { createWithUserTx } from './with-user-tx';

const ownerUrl = process.env.TEST_DATABASE_URL;
const appServerUrl = process.env.TEST_APP_SERVER_URL;
const configured = Boolean(ownerUrl && appServerUrl);

if ((process.env.CI || process.env.JADARAT_REQUIRE_INTEGRATION) && !configured) {
  throw new Error('TEST_DATABASE_URL and TEST_APP_SERVER_URL must be set');
}

describe.skipIf(!configured)('editing a user against PostgreSQL', () => {
  const owner = postgres(ownerUrl ?? '', { max: 1, onnotice: () => undefined });
  const serverDb = createDatabase(appServerUrl ?? '', { max: 1 });
  const withUserTx = createWithUserTx(() => serverDb);
  const id = () => randomUUID();
  const tenant = id();
  const dept = { training: id(), finance: id() };
  const member = (role: string | null, name: string) => ({
    person: id(),
    user: id(),
    session: id(),
    role,
    name,
  });
  const admin = member('tenant_admin', 'أ-مدير');
  const hr = member('hr_manager', 'ب-موارد');
  const lead = member('line_manager', 'ت-قائد');
  const sara = member('learner', 'ث-سارة');
  const noLogin = { person: id(), name: 'ج-بلا حساب' };
  const all = [admin, hr, lead, sara];

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

  const base = (u: Awaited<ReturnType<typeof getEditableUser>>): UserDetailsChange => {
    if (!u) {
      return {
        firstNameAr: 'x',
        fatherNameAr: null,
        grandfatherNameAr: null,
        familyNameAr: null,
        firstNameEn: null,
        fatherNameEn: null,
        grandfatherNameEn: null,
        familyNameEn: null,
        displayNameAr: 'x',
        displayNameEn: null,
        email: null,
        mobileE164: null,
        employeeNumber: null,
        preferredLocale: 'ar',
        departmentId: null,
        branchId: null,
        managerPersonId: null,
        jobTitleAr: null,
        jobTitleEn: null,
        hireOn: null,
      };
    }
    return {
      firstNameAr: u.firstNameAr ?? u.displayNameAr,
      fatherNameAr: u.fatherNameAr,
      grandfatherNameAr: u.grandfatherNameAr,
      familyNameAr: u.familyNameAr,
      firstNameEn: u.firstNameEn,
      fatherNameEn: u.fatherNameEn,
      grandfatherNameEn: u.grandfatherNameEn,
      familyNameEn: u.familyNameEn,
      displayNameAr: u.displayNameAr,
      displayNameEn: u.displayNameEn,
      email: u.email,
      mobileE164: u.mobileE164,
      employeeNumber: u.employeeNumber,
      preferredLocale: u.preferredLocale,
      departmentId: u.departmentId,
      branchId: u.branchId,
      managerPersonId: u.managerPersonId,
      jobTitleAr: u.jobTitleAr,
      jobTitleEn: u.jobTitleEn,
      hireOn: u.hireOn,
    };
  };

  /** Runs in its own transaction; a refusal is returned (and the transaction rolled back). */
  const edit = (
    as: (typeof all)[number],
    personId: string,
    change: (current: UserDetailsChange) => UserDetailsChange,
    version?: string,
  ) =>
    withUserTx(claimsOf(as), async (tx) => {
      const current = await getEditableUser(tx, personId);
      const outcome = await updateUserDetails(
        tx,
        personId,
        version ?? current?.version ?? '',
        change(base(current)),
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
      values (${tenant}, ${`ua-${tenant.slice(0, 8)}`}, 'أ', 'active')`;
    for (const m of all) {
      await owner`insert into auth.users (id, email) values (${m.user}, ${`${m.user}@example.test`})`;
      await owner`insert into auth.sessions (id, user_id) values (${m.session}, ${m.user})`;
      await owner`insert into platform.persons (id, tenant_id, display_name_ar, email)
        values (${m.person}, ${tenant}, ${m.name}, ${`${m.user}@example.test`})`;
      await owner`insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
        values (${tenant}, ${m.user}, ${m.person}, 'active')`;
      await owner`insert into platform.session_context (session_id, user_id, active_tenant_id)
        values (${m.session}, ${m.user}, ${tenant})`;
      await owner`insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
        select tenant_id, id, ${m.role}, true from platform.tenant_memberships where user_id = ${m.user}`;
    }
    await owner`insert into platform.persons (id, tenant_id, display_name_ar, employee_number)
      values (${noLogin.person}, ${tenant}, ${noLogin.name}, 'E-NO')`;
    await owner`insert into platform.departments (id, tenant_id, code, name_ar, head_person_id) values
      (${dept.training}, ${tenant}, 'TRN', 'التدريب', ${admin.person}),
      (${dept.finance}, ${tenant}, 'FIN', 'المالية', null)`;
    await owner`insert into platform.person_employment (tenant_id, person_id, department_id, manager_person_id) values
      (${tenant}, ${lead.person}, ${dept.finance}, null),
      (${tenant}, ${sara.person}, ${dept.training}, ${lead.person})`;
  });

  afterAll(async () => {
    await owner`delete from platform.person_employment where tenant_id = ${tenant}`;
    await owner`delete from platform.departments where tenant_id = ${tenant}`;
    await owner`delete from platform.session_context where active_tenant_id = ${tenant}`;
    await owner`delete from platform.tenant_memberships where tenant_id = ${tenant}`;
    await owner`delete from platform.persons where tenant_id = ${tenant}`;
    for (const m of all) await owner`delete from auth.users where id = ${m.user}`;
    await owner.end();
    await serverDb.$client.end();
  });

  it('reads the record with its placement, login flag, version and the manage rule', async () => {
    const asAdmin = await withUserTx(claimsOf(admin), (tx) => getEditableUser(tx, sara.person));
    expect(asAdmin).toMatchObject({
      displayNameAr: sara.name,
      hasLogin: true,
      departmentId: dept.training,
      managerPersonId: lead.person,
      version: '1:1',
      mayManage: true,
    });
    expect(await withUserTx(claimsOf(hr), (tx) => getEditableUser(tx, admin.person))).toMatchObject(
      { mayManage: false },
    );
    expect(
      await withUserTx(claimsOf(sara), (tx) => getEditableUser(tx, lead.person)),
    ).toMatchObject({ mayManage: false });
  });

  it('lists managers with the departments they belong to or head', async () => {
    const managers = await withUserTx(claimsOf(admin), (tx) => listManagerOptions(tx));
    const byPerson = Object.fromEntries(managers.map((m) => [m.personId, m.departmentIds]));
    expect(byPerson[lead.person]).toEqual([dept.finance]); // line manager placed in finance
    expect(byPerson[admin.person]).toEqual([dept.training]); // heads training
    expect(byPerson[sara.person]).toBeUndefined(); // learner, heads nothing
  });

  it('saves details and placement and reports the changed fields; the login e-mail stays', async () => {
    const outcome = await edit(admin, sara.person, (c) => ({
      ...c,
      firstNameAr: 'سارة',
      familyNameAr: 'القحطاني',
      displayNameAr: 'سارة القحطاني',
      email: 'changed@example.test',
      employeeNumber: 'E-1187',
      jobTitleAr: 'أخصائية تدريب',
      departmentId: dept.finance,
      hireOn: '2024-03-03',
    }));
    expect(outcome).toEqual({
      ok: true,
      changed: [
        'firstNameAr',
        'familyNameAr',
        'displayNameAr',
        'employeeNumber',
        'departmentId',
        'jobTitleAr',
        'hireOn',
      ],
    });
    const after = await withUserTx(claimsOf(admin), (tx) => getEditableUser(tx, sara.person));
    expect(after).toMatchObject({
      email: `${sara.user}@example.test`, // login e-mail unchanged
      employeeNumber: 'E-1187',
      departmentId: dept.finance,
      hireOn: '2024-03-03',
      version: '2:2',
    });
  });

  it('creates the placement of a person who has none; changes the e-mail of a person without login', async () => {
    const outcome = await edit(hr, noLogin.person, (c) => ({
      ...c,
      email: 'nologin@example.test',
      departmentId: dept.training,
      managerPersonId: lead.person,
    }));
    expect(outcome).toMatchObject({ ok: true });
    expect(
      await withUserTx(claimsOf(hr), (tx) => getEditableUser(tx, noLogin.person)),
    ).toMatchObject({
      email: 'nologin@example.test',
      managerPersonId: lead.person,
      version: '2:1',
    });
  });

  it('refuses duplicates, manager loops, stale versions and HR on a privileged record', async () => {
    expect(await edit(admin, sara.person, (c) => ({ ...c, employeeNumber: 'E-NO' }))).toEqual({
      ok: false,
      refusal: 'employee_number_taken',
    });
    expect(
      await edit(admin, noLogin.person, (c) => ({ ...c, email: `${lead.user}@example.test` })),
    ).toEqual({ ok: false, refusal: 'email_taken' });
    // lead → managed by sara, while sara is managed by lead: a loop.
    expect(await edit(admin, lead.person, (c) => ({ ...c, managerPersonId: sara.person }))).toEqual(
      { ok: false, refusal: 'manager_loop' },
    );
    expect(
      await edit(admin, sara.person, (c) => ({ ...c, mobileE164: '+966500000000' }), '1:1'),
    ).toEqual({ ok: false, refusal: 'version_conflict' });
    expect(await edit(hr, admin.person, (c) => ({ ...c, employeeNumber: 'HACK' }))).toEqual({
      ok: false,
      refusal: 'not_allowed',
    });
    expect(await edit(admin, id(), (c) => c)).toEqual({ ok: false, refusal: 'not_found' });
  });
});
