/**
 * A unit's «Head» written by the role forms (WP-FIX-03, T-M3-18; review M5, 12 Nov 2026) against PostgreSQL
 * under withUserTx: the two narrow writes (`setUnitHead`, `clearHeadedUnits`) and their reads, with the
 * refusals the application relies on — another organization's unit or person, an inactive or deleted unit,
 * a unit that has a head, and an actor without `platform.org.manage` (the database has the last word:
 * private.check_department_writer).
 */
import { randomUUID } from 'node:crypto';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from './client';
import {
  clearHeadedUnits,
  listHeadedUnitIds,
  listUnitHeads,
  lockUnitHeadChange,
  setUnitHead,
} from './unit-heads';
import { createWithUserTx } from './with-user-tx';

const ownerUrl = process.env.TEST_DATABASE_URL;
const appServerUrl = process.env.TEST_APP_SERVER_URL;
const configured = Boolean(ownerUrl && appServerUrl);

if ((process.env.CI || process.env.JADARAT_REQUIRE_INTEGRATION) && !configured) {
  throw new Error('TEST_DATABASE_URL and TEST_APP_SERVER_URL must be set');
}

describe.skipIf(!configured)("a unit's head written by the role forms, against PostgreSQL", () => {
  const owner = postgres(ownerUrl ?? '', { max: 1, onnotice: () => undefined });
  const serverDb = createDatabase(appServerUrl ?? '', { max: 1 });
  const withUserTx = createWithUserTx(() => serverDb);
  const id = () => randomUUID();
  const tenant = id();
  const other = id();
  const member = (role: string, name: string) => ({
    person: id(),
    user: id(),
    session: id(),
    role,
    name,
  });
  const hr = member('hr_manager', 'موارد');
  const admin = member('tenant_admin', 'مدير');
  const sara = member('learner', 'سارة');
  const omar = member('learner', 'عمر');
  const all = [hr, admin, sara, omar];
  const inactivePerson = id();
  const otherPerson = id();
  const unit = {
    finance: id(),
    hr: id(),
    sales: id(),
    empty: id(),
    closed: id(),
    gone: id(),
    other: id(),
  };

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
  const headOf = async (unitId: string) => {
    const [row] = await owner<{ head_person_id: string | null }[]>`
      select head_person_id from platform.departments where id = ${unitId}`;
    return row?.head_person_id ?? null;
  };
  /** The write as the role forms make it: the locks first, then the head. */
  const setHead = (as: (typeof all)[number], unitId: string, personId: string, replace = false) =>
    withUserTx(claimsOf(as), async (tx) => {
      await lockUnitHeadChange(tx);
      return setUnitHead(tx, unitId, personId, { replace });
    });

  beforeAll(async () => {
    await owner`insert into platform.tenants (id, slug, name_ar, status) values
      (${tenant}, ${`uh-${tenant.slice(0, 8)}`}, 'أ', 'active'),
      (${other}, ${`uh-${other.slice(0, 8)}`}, 'ب', 'active')`;
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
    await owner`insert into platform.persons (id, tenant_id, display_name_ar, status) values
      (${inactivePerson}, ${tenant}, 'غير نشط', 'inactive'),
      (${otherPerson}, ${other}, 'من منشأة أخرى', 'active')`;
    await owner`insert into platform.departments (id, tenant_id, code, name_ar, parent_id, head_person_id, sort_order) values
      (${unit.finance}, ${tenant}, 'FIN', 'المالية', null, null, 0),
      (${unit.hr}, ${tenant}, 'HR', 'الموارد البشرية', null, ${sara.person}, 1),
      (${unit.sales}, ${tenant}, 'SAL', 'المبيعات', null, ${sara.person}, 2),
      (${unit.closed}, ${tenant}, 'CLS', 'مغلقة', null, null, 3),
      (${unit.empty}, ${tenant}, 'EMP', 'بلا رئيس', null, null, 5),
      (${unit.gone}, ${tenant}, 'GON', 'محذوفة', null, ${sara.person}, 4)`;
    await owner`update platform.departments set status = 'inactive' where id = ${unit.closed}`;
    await owner`update platform.departments set deleted_at = now() where id = ${unit.gone}`;
    await owner`insert into platform.departments (id, tenant_id, code, name_ar, parent_id, head_person_id, sort_order) values
      (${unit.other}, ${other}, 'OTH', 'أخرى', null, ${otherPerson}, 0)`;
  });

  afterAll(async () => {
    for (const t of [tenant, other]) {
      await owner`delete from platform.session_context where active_tenant_id = ${t}`;
      await owner`delete from platform.person_employment where tenant_id = ${t}`;
      await owner`delete from platform.departments where tenant_id = ${t}`;
      await owner`delete from platform.tenant_memberships where tenant_id = ${t}`;
      await owner`delete from platform.persons where tenant_id = ${t}`;
    }
    for (const m of all) await owner`delete from auth.users where id = ${m.user}`;
    await owner.end();
    await serverDb.$client.end();
  });

  it('reads the heads of the live units of the organization only', async () => {
    const heads = await withUserTx(claimsOf(hr), (tx) => listUnitHeads(tx));
    expect(heads.map((h) => h.unitId).sort()).toEqual([unit.hr, unit.sales].sort());
    expect(heads.every((h) => h.personId === sara.person)).toBe(true);
    const headed = await withUserTx(claimsOf(hr), (tx) => listHeadedUnitIds(tx, sara.person));
    expect([...headed].sort()).toEqual([unit.hr, unit.sales].sort());
    // Another organization's person heads nothing here.
    expect(await withUserTx(claimsOf(hr), (tx) => listHeadedUnitIds(tx, otherPerson))).toEqual([]);
  });

  it('makes an active person the head of a unit without one', async () => {
    expect(await setHead(hr, unit.finance, omar.person)).toEqual({
      ok: true,
      unitId: unit.finance,
      before: null,
      changed: true,
    });
    expect(await headOf(unit.finance)).toBe(omar.person);
    // The same head again writes nothing.
    expect(await setHead(hr, unit.finance, omar.person)).toMatchObject({
      ok: true,
      changed: false,
    });
  });

  it('replaces another head only when asked to', async () => {
    expect(await setHead(hr, unit.hr, omar.person)).toEqual({
      ok: false,
      refusal: 'head_taken',
      headPersonId: sara.person,
    });
    expect(await headOf(unit.hr)).toBe(sara.person);
    expect(await setHead(hr, unit.hr, omar.person, true)).toEqual({
      ok: true,
      unitId: unit.hr,
      before: sara.person,
      changed: true,
    });
    expect(await headOf(unit.hr)).toBe(omar.person);
  });

  it("refuses another organization's unit and person, an inactive unit, a deleted unit, an inactive person", async () => {
    expect(await setHead(hr, unit.other, omar.person, true)).toEqual({
      ok: false,
      refusal: 'unit_not_found',
    });
    expect(await headOf(unit.other)).toBe(otherPerson);
    expect(await setHead(hr, unit.finance, otherPerson, true)).toEqual({
      ok: false,
      refusal: 'person_not_active',
    });
    expect(await setHead(hr, unit.finance, inactivePerson, true)).toEqual({
      ok: false,
      refusal: 'person_not_active',
    });
    expect(await headOf(unit.finance)).toBe(omar.person);
    expect(await setHead(hr, unit.closed, omar.person)).toEqual({
      ok: false,
      refusal: 'unit_inactive',
    });
    expect(await setHead(hr, unit.gone, omar.person, true)).toEqual({
      ok: false,
      refusal: 'unit_not_found',
    });
  });

  it('is refused by the database for an actor without platform.org.manage: nothing changes', async () => {
    const attempt = <T>(run: Promise<T>) =>
      run.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
    // The Organization Admin gives no head to a unit and takes none away: the structure is the HR
    // Manager's (private.check_department_writer raises).
    const given = await attempt(setHead(admin, unit.empty, omar.person));
    expect('error' in given).toBe(true);
    expect(await headOf(unit.empty)).toBeNull();
    const taken = await attempt(
      withUserTx(claimsOf(admin), (tx) => clearHeadedUnits(tx, sara.person)),
    );
    expect('error' in taken).toBe(true);
    expect(await headOf(unit.sales)).toBe(sara.person);
    // An Employee: the unit is not theirs to write — refused or not found, never a head changed.
    const byEmployee = await attempt(setHead(omar, unit.empty, sara.person));
    if ('value' in byEmployee) expect(byEmployee.value).toMatchObject({ ok: false });
    expect(await headOf(unit.empty)).toBeNull();
    const replaced = await attempt(setHead(omar, unit.sales, omar.person, true));
    if ('value' in replaced) expect(replaced.value).toMatchObject({ ok: false });
    expect(await headOf(unit.sales)).toBe(sara.person);
    const cleared = await attempt(
      withUserTx(claimsOf(omar), (tx) => clearHeadedUnits(tx, sara.person)),
    );
    if ('value' in cleared) expect(cleared.value).toEqual([]);
    expect(await headOf(unit.sales)).toBe(sara.person);
  });

  it('leaves the live units a person heads without a head, and only those', async () => {
    const cleared = await withUserTx(claimsOf(hr), async (tx) => {
      await lockUnitHeadChange(tx);
      return clearHeadedUnits(tx, sara.person);
    });
    expect(cleared).toEqual([unit.sales]);
    expect(await headOf(unit.sales)).toBeNull();
    // The deleted unit keeps its record; other heads and the other organization are untouched.
    expect(await headOf(unit.gone)).toBe(sara.person);
    expect(await headOf(unit.hr)).toBe(omar.person);
    expect(await headOf(unit.other)).toBe(otherPerson);
    expect(await withUserTx(claimsOf(hr), (tx) => clearHeadedUnits(tx, otherPerson))).toEqual([]);
    expect(await headOf(unit.other)).toBe(otherPerson);
  });
});
