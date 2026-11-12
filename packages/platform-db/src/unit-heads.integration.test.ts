/**
 * A unit's «Head» written by the role forms (WP-FIX-03, T-M3-18; review M5, 12 Nov 2026) against PostgreSQL
 * under withUserTx: the two narrow writes (`setUnitHead`, `clearHeadedUnits`) and their reads, with the
 * refusals the application relies on — another organization's unit or person, an inactive or deleted unit,
 * a unit that has a head — and who may write them (the database has the last word:
 * private.check_department_writer): structure managers; and a member who gives the Department Head role
 * (the Organization Admin), only the head, only for a holder of that role or a head made an Employee
 * (PO, 12 Nov 2026; migration 20261112100400). Also the person's own department (`getOwnUnitId`).
 */
import { randomUUID } from 'node:crypto';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from './client';
import { pgError } from './pg-error';
import {
  clearHeadedUnits,
  getOwnUnitId,
  listHeadedUnitIds,
  listUnitHeads,
  lockUnitHeadChange,
  setUnitHead,
} from './unit-heads';
import { type UserTx, createWithUserTx } from './with-user-tx';

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
  // Holders of the Department Head role, an Employee who heads a unit, and a member with another role.
  const dina = member('department_head', 'دينا');
  const noura = member('department_head', 'نورة');
  const zaid = member('learner', 'زيد');
  const lama = member('training_manager', 'لمى');
  const all = [hr, admin, sara, omar, dina, noura, zaid, lama];
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
    support: id(),
    legal: id(),
    vacant: id(),
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
      (${unit.gone}, ${tenant}, 'GON', 'محذوفة', null, ${sara.person}, 4),
      (${unit.support}, ${tenant}, 'SUP', 'الدعم', null, ${zaid.person}, 6),
      (${unit.legal}, ${tenant}, 'LEG', 'الشؤون القانونية', null, ${lama.person}, 7),
      (${unit.vacant}, ${tenant}, 'VAC', 'شاغرة', null, null, 8)`;
    // Their own departments (person_employment): Omar in Finance, Sara in the closed unit, the others
    // nowhere (a deleted unit never has people placed in it: the database refuses the deletion).
    await owner`insert into platform.person_employment (tenant_id, person_id, department_id) values
      (${tenant}, ${omar.person}, ${unit.finance}),
      (${tenant}, ${sara.person}, ${unit.closed})`;
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
    expect(heads.map((h) => h.unitId).sort()).toEqual(
      [unit.hr, unit.sales, unit.support, unit.legal].sort(),
    );
    expect(
      heads
        .filter((h) => h.personId === sara.person)
        .map((h) => h.unitId)
        .sort(),
    ).toEqual([unit.hr, unit.sales].sort());
    const headed = await withUserTx(claimsOf(hr), (tx) => listHeadedUnitIds(tx, sara.person));
    expect([...headed].sort()).toEqual([unit.hr, unit.sales].sort());
    // Another organization's person heads nothing here.
    expect(await withUserTx(claimsOf(hr), (tx) => listHeadedUnitIds(tx, otherPerson))).toEqual([]);
  });

  it("reads a person's own department: live and active only, their own organization only", async () => {
    for (const reader of [hr, admin]) {
      const own = (personId: string) =>
        withUserTx(claimsOf(reader), (tx) => getOwnUnitId(tx, personId));
      expect(await own(omar.person)).toBe(unit.finance);
      // An inactive department, no department on the record, another organization.
      expect(await own(sara.person)).toBeNull();
      expect(await own(dina.person)).toBeNull();
      expect(await own(otherPerson)).toBeNull();
    }
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

  const attempt = <T>(run: Promise<T>) =>
    run.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );

  it('the Organization Admin sets the head that goes with the Department Head role — and only that', async () => {
    // A holder of the Department Head role becomes the head of a unit without one …
    expect(await setHead(admin, unit.empty, dina.person)).toEqual({
      ok: true,
      unitId: unit.empty,
      before: null,
      changed: true,
    });
    expect(await headOf(unit.empty)).toBe(dina.person);
    // … and replaces another head, once asked to (Omar, an Employee the admin may manage).
    expect(await setHead(admin, unit.finance, noura.person)).toEqual({
      ok: false,
      refusal: 'head_taken',
      headPersonId: omar.person,
    });
    expect(await setHead(admin, unit.finance, noura.person, true)).toEqual({
      ok: true,
      unitId: unit.finance,
      before: omar.person,
      changed: true,
    });
    expect(await headOf(unit.finance)).toBe(noura.person);
    // The same rules as for everyone: inactive, deleted and foreign units.
    expect(await setHead(admin, unit.closed, dina.person)).toMatchObject({
      refusal: 'unit_inactive',
    });
    expect(await setHead(admin, unit.gone, dina.person, true)).toMatchObject({
      refusal: 'unit_not_found',
    });
    expect(await setHead(admin, unit.other, dina.person, true)).toMatchObject({
      refusal: 'unit_not_found',
    });
    expect(await headOf(unit.other)).toBe(otherPerson);
  });

  it('the Organization Admin makes nobody a head who does not hold the role, nor themselves', async () => {
    // An Employee, a member with another role, the admin: the database refuses (42501 → not_allowed).
    // (A unit without a head: replacing an existing head is also the hand-over of a leaver's units, which
    // a member who deactivates may make to any active person but themselves — 20261020210000.)
    for (const person of [omar.person, lama.person, admin.person]) {
      const refused = await attempt(setHead(admin, unit.vacant, person));
      if ('value' in refused) expect(refused.value).toEqual({ ok: false, refusal: 'not_allowed' });
      expect(await headOf(unit.vacant), person).toBeNull();
    }
    // Never themselves in place of another head either (the hand-over excludes the actor too).
    const self = await attempt(setHead(admin, unit.sales, admin.person, true));
    if ('value' in self) expect(self.value).toEqual({ ok: false, refusal: 'not_allowed' });
    expect(await headOf(unit.sales)).toBe(sara.person);
    // Nothing else of a unit is theirs to change: its name, its status, its parent.
    for (const change of [
      (tx: UserTx) =>
        tx.execute(
          sql`update platform.departments set name_ar = 'غير' where id = ${unit.empty}::uuid`,
        ),
      (tx: UserTx) =>
        tx.execute(
          sql`update platform.departments set status = 'inactive' where id = ${unit.empty}::uuid`,
        ),
      // The head together with another column: refused as a whole.
      (tx: UserTx) =>
        tx.execute(sql`update platform.departments set head_person_id = ${noura.person}::uuid,
          sort_order = 99 where id = ${unit.empty}::uuid`),
    ]) {
      const result = await attempt(withUserTx(claimsOf(admin), change));
      expect('error' in result && pgError(result.error)?.code).toBe('42501');
    }
    const [row] = await owner<{ name_ar: string; status: string; sort_order: number }[]>`
      select name_ar, status, sort_order from platform.departments where id = ${unit.empty}`;
    expect(row).toEqual({ name_ar: 'بلا رئيس', status: 'active', sort_order: 5 });
    expect(await headOf(unit.empty)).toBe(dina.person);
  });

  it('the Organization Admin leaves a unit without a head only for a head who is an Employee', async () => {
    const clear = (personId: string) =>
      withUserTx(claimsOf(admin), async (tx) => {
        await lockUnitHeadChange(tx);
        return clearHeadedUnits(tx, personId);
      });
    // A Department Head and a head with another role keep their units: refused (null → the action fails).
    for (const [person, headed] of [
      [dina.person, unit.empty],
      [lama.person, unit.legal],
    ] as const) {
      const refused = await attempt(clear(person));
      if ('value' in refused) expect(refused.value).toBeNull();
      expect(await headOf(headed)).toBe(person);
    }
    // Zaid is an Employee (a head made an Employee, asked first by the form): his unit is cleared.
    expect(await clear(zaid.person)).toEqual([unit.support]);
    expect(await headOf(unit.support)).toBeNull();
  });

  it('is refused by the database for a member who neither manages the structure nor gives the role', async () => {
    // An Employee: the unit is not theirs to write — refused or not found, never a head changed.
    const byEmployee = await attempt(setHead(omar, unit.legal, dina.person, true));
    if ('value' in byEmployee) expect(byEmployee.value).toMatchObject({ ok: false });
    expect(await headOf(unit.legal)).toBe(lama.person);
    const replaced = await attempt(setHead(omar, unit.sales, omar.person, true));
    if ('value' in replaced) expect(replaced.value).toMatchObject({ ok: false });
    expect(await headOf(unit.sales)).toBe(sara.person);
    const cleared = await attempt(
      withUserTx(claimsOf(omar), (tx) => clearHeadedUnits(tx, sara.person)),
    );
    if ('value' in cleared) expect(cleared.value ?? []).toEqual([]);
    expect(await headOf(unit.sales)).toBe(sara.person);
    // A Department Head does not hand their unit to another Department Head either.
    const byHead = await attempt(setHead(dina, unit.empty, noura.person, true));
    if ('value' in byHead) expect(byHead.value).toMatchObject({ ok: false });
    expect(await headOf(unit.empty)).toBe(dina.person);
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
