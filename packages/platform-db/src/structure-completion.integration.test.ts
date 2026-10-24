/**
 * Structure completion (WP-HR-01; business flow EP-ORG-structure-completion.md) against PostgreSQL, under
 * withUserTx as the HR Manager: cost centres (in use → not deleted), the move preview (who sees more or less) and
 * the move itself (a unit keeps its level; never under itself), the order among siblings, levels locked once people
 * are placed, the unit import's writes and a branch's address, location and own week.
 */
import { randomUUID } from 'node:crypto';
import { brandVerifiedClaims } from '@jadarat/platform-core/internal/verified-claims';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBranch, listBranches, updateBranch } from './branches';
import { createDatabase } from './client';
import {
  createCostCentre,
  deleteCostCentre,
  listCostCentres,
  updateCostCentre,
} from './cost-centres';
import {
  addStructureLevel,
  listStructureUnits,
  moveStructureUnit,
  previewStructureUnitMove,
  reorderStructureUnit,
  structureLevelsLocked,
} from './structure';
import { applyUnitImport } from './unit-import';
import { createWithUserTx } from './with-user-tx';

const ownerUrl = process.env.TEST_DATABASE_URL;
const appServerUrl = process.env.TEST_APP_SERVER_URL;
const configured = Boolean(ownerUrl && appServerUrl);

if ((process.env.CI || process.env.JADARAT_REQUIRE_INTEGRATION) && !configured) {
  throw new Error('TEST_DATABASE_URL and TEST_APP_SERVER_URL must be set');
}

describe.skipIf(!configured)('structure completion against PostgreSQL', () => {
  const owner = postgres(ownerUrl ?? '', { max: 1, onnotice: () => undefined });
  const serverDb = createDatabase(appServerUrl ?? '', { max: 1 });
  const withUserTx = createWithUserTx(() => serverDb);
  const id = () => randomUUID();
  const tenant = id();
  const hr = { person: id(), user: id(), session: id() };
  const headA = id();
  const headB = id();
  const sara = id();
  // Sector A (head: headA) › Department A1 › Section A1x (sara placed); Sector B (head: headB).
  const unit = { a: id(), b: id(), a1: id(), a1x: id() };

  const claims = () => {
    const r = brandVerifiedClaims({
      sub: hr.user,
      role: 'authenticated',
      aal: 'aal1',
      session_id: hr.session,
      tenant_id: tenant,
      person_id: hr.person,
    });
    if (!r.ok) throw new Error('bad fixture');
    return r.value;
  };
  const asHr = <T>(work: Parameters<typeof withUserTx<T>>[1]) => withUserTx(claims(), work);
  /** As the actions do: a refusal rolls the transaction back (a refused write leaves it aborted). */
  const attempt = <T extends { ok: boolean }>(work: Parameters<typeof withUserTx<T>>[1]) =>
    asHr(async (tx) => {
      const outcome = await work(tx);
      if (!outcome.ok) throw Object.assign(new Error('refused'), { outcome });
      return outcome;
    }).catch((error: unknown) => {
      const outcome = (error as { outcome?: T }).outcome;
      if (outcome) return outcome;
      throw error;
    });

  beforeAll(async () => {
    await owner`insert into platform.tenants (id, slug, name_ar, status)
      values (${tenant}, ${`sc-${tenant.slice(0, 8)}`}, 'هيكل', 'active')`;
    await owner`insert into auth.users (id, email) values (${hr.user}, ${`${hr.user}@example.test`})`;
    await owner`insert into auth.sessions (id, user_id) values (${hr.session}, ${hr.user})`;
    await owner`insert into platform.persons (id, tenant_id, display_name_ar, email) values
      (${hr.person}, ${tenant}, 'موارد', ${`${hr.user}@example.test`}),
      (${headA}, ${tenant}, 'رئيس أ', null),
      (${headB}, ${tenant}, 'رئيس ب', null),
      (${sara}, ${tenant}, 'سارة', null)`;
    await owner`insert into platform.tenant_memberships (tenant_id, user_id, person_id, status)
      values (${tenant}, ${hr.user}, ${hr.person}, 'active')`;
    await owner`insert into platform.session_context (session_id, user_id, active_tenant_id)
      values (${hr.session}, ${hr.user}, ${tenant})`;
    await owner`insert into platform.role_assignments (tenant_id, membership_id, role_code, is_primary)
      select tenant_id, id, 'hr_manager', true from platform.tenant_memberships where user_id = ${hr.user}`;
    // Level 1 comes with the organization; two more below it.
    await owner`insert into platform.structure_levels (tenant_id, ordinal, name_en, name_ar) values
      (${tenant}, 2, 'Division', 'قسم رئيسي'), (${tenant}, 3, 'Section', 'قسم فرعي')`;
    await owner`insert into platform.departments (id, tenant_id, code, name_ar, parent_id, head_person_id, sort_order) values
      (${unit.a}, ${tenant}, 'A', 'أ', null, ${headA}, 0),
      (${unit.b}, ${tenant}, 'B', 'ب', null, ${headB}, 1)`;
    await owner`insert into platform.departments (id, tenant_id, code, name_ar, parent_id) values
      (${unit.a1}, ${tenant}, 'A1', 'أ1', ${unit.a})`;
    await owner`insert into platform.departments (id, tenant_id, code, name_ar, parent_id) values
      (${unit.a1x}, ${tenant}, 'A1X', 'أ1س', ${unit.a1})`;
  });

  afterAll(async () => {
    await owner`delete from platform.person_employment where tenant_id = ${tenant}`;
    await owner`delete from platform.branch_working_days where tenant_id = ${tenant}`;
    // Deepest first (a unit with units under it is not deleted).
    for (const level of [3, 2, 1]) {
      await owner`delete from platform.departments where tenant_id = ${tenant} and level_ordinal = ${level}`;
    }
    await owner`delete from platform.branches where tenant_id = ${tenant}`;
    await owner`delete from platform.cost_centres where tenant_id = ${tenant}`;
    await owner`delete from platform.session_context where active_tenant_id = ${tenant}`;
    await owner`delete from platform.tenant_memberships where tenant_id = ${tenant}`;
    await owner`delete from platform.persons where tenant_id = ${tenant}`;
    await owner`delete from auth.users where id = ${hr.user}`;
    await owner.end();
    await serverDb.$client.end();
  });

  it('keeps cost centres: unique codes, deactivate, and no delete while a person has one', async () => {
    const created = await asHr((tx) =>
      createCostCentre(tx, { code: 'CC-10', nameEn: 'Sales', nameAr: null, status: 'active' }),
    );
    expect(created.ok && created.after).toMatchObject({
      code: 'CC-10',
      peopleCount: 0,
      version: 1,
    });
    expect(
      await attempt((tx) =>
        createCostCentre(tx, { code: 'cc-10', nameEn: 'Again', nameAr: null, status: 'active' }),
      ),
    ).toEqual({ ok: false, refusal: 'code_taken' });
    const ccId = created.ok && created.after ? created.after.id : '';
    await owner`insert into platform.person_employment (tenant_id, person_id, cost_centre_id)
      values (${tenant}, ${headB}, ${ccId})`;
    const listed = await asHr((tx) => listCostCentres(tx));
    expect(listed.find((c) => c.id === ccId)).toMatchObject({ peopleCount: 1, unitCount: 0 });
    expect(await attempt((tx) => deleteCostCentre(tx, ccId, 1))).toEqual({
      ok: false,
      refusal: 'in_use',
      usage: { people: 1, units: 0 },
    });
    const inactive = await asHr((tx) =>
      updateCostCentre(tx, ccId, 1, {
        code: 'CC-10',
        nameEn: 'Sales',
        nameAr: 'المبيعات',
        status: 'inactive',
      }),
    );
    expect(inactive.ok && inactive.after).toMatchObject({ status: 'inactive', version: 2 });
    expect(
      await attempt((tx) =>
        updateCostCentre(tx, ccId, 1, {
          code: 'CC-10',
          nameEn: 'Stale',
          nameAr: null,
          status: 'active',
        }),
      ),
    ).toEqual({ ok: false, refusal: 'version_conflict' });
    await owner`delete from platform.person_employment where tenant_id = ${tenant} and person_id = ${headB}`;
    expect((await asHr((tx) => deleteCostCentre(tx, ccId, 2))).ok).toBe(true);
  });

  it('previews a move: what moves and who sees more or less; nothing changes', async () => {
    await owner`insert into platform.person_employment (tenant_id, person_id, department_id)
      values (${tenant}, ${sara}, ${unit.a1x})`;
    const preview = await asHr((tx) => previewStructureUnitMove(tx, unit.a1, unit.b));
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.preview).toMatchObject({
      unitId: unit.a1,
      fromParentId: unit.a,
      toParentId: unit.b,
      unitIds: [unit.a1, unit.a1x],
      peopleCount: 1,
      openCycles: [],
    });
    expect(preview.preview.changes.map((c) => [c.kind, c.personId, c.change])).toEqual([
      ['head', headA, 'loses'],
      ['head', headB, 'gains'],
    ]);
    const units = await asHr((tx) => listStructureUnits(tx));
    expect(units.find((u) => u.id === unit.a1)?.parentId).toBe(unit.a);
  });

  it('refuses a move that changes the level or goes under itself; moves under a unit of the same level', async () => {
    expect(await asHr((tx) => previewStructureUnitMove(tx, unit.a1x, unit.b))).toEqual({
      ok: false,
      refusal: 'level_changes',
    });
    expect(await asHr((tx) => previewStructureUnitMove(tx, unit.a, unit.a1x))).toMatchObject({
      ok: false,
      refusal: 'move_into_itself',
    });
    const moved = await asHr((tx) => moveStructureUnit(tx, unit.a1, 1, unit.b));
    expect(moved.ok && moved.after).toMatchObject({ parentId: unit.b, levelOrdinal: 2 });
    // Everything below moved with it and kept its level.
    const units = await asHr((tx) => listStructureUnits(tx));
    expect(units.find((u) => u.id === unit.a1x)).toMatchObject({
      parentId: unit.a1,
      levelOrdinal: 3,
    });
    expect(await attempt((tx) => moveStructureUnit(tx, unit.a1, 1, unit.a))).toEqual({
      ok: false,
      refusal: 'version_conflict',
    });
  });

  it('reorders a unit among its siblings', async () => {
    const before = await asHr((tx) => listStructureUnits(tx));
    const b = before.find((u) => u.id === unit.b);
    expect((await asHr((tx) => reorderStructureUnit(tx, unit.b, b?.version ?? 0, 0))).ok).toBe(
      true,
    );
    const tops = (await asHr((tx) => listStructureUnits(tx))).filter((u) => u.parentId === null);
    expect(tops.map((u) => u.code)).toEqual(['B', 'A']);
  });

  it('locks the levels once people are placed (renaming stays)', async () => {
    expect(await asHr((tx) => structureLevelsLocked(tx))).toBe(true);
    expect(
      await attempt((tx) => addStructureLevel(tx, { nameEn: 'Team', nameAr: 'فريق' })),
    ).toEqual({ ok: false, refusal: 'levels_locked' });
  });

  it('writes the import: new units under a unit of an earlier row, updates by id', async () => {
    const a = (await asHr((tx) => listStructureUnits(tx))).find((u) => u.id === unit.a);
    const outcome = await asHr((tx) =>
      applyUnitImport(tx, [
        {
          kind: 'create',
          row: 2,
          code: 'C',
          nameEn: 'C',
          nameAr: 'ج',
          parentId: null,
          parentCode: null,
          branchId: null,
          defaultCostCentreId: null,
          headPersonId: null,
        },
        {
          kind: 'create',
          row: 3,
          code: 'C1',
          nameEn: 'C1',
          nameAr: 'ج1',
          parentId: null,
          parentCode: 'c',
          branchId: null,
          defaultCostCentreId: null,
          headPersonId: headA,
        },
        {
          kind: 'update',
          row: 4,
          id: unit.a,
          version: a?.version ?? 0,
          nameEn: 'Sector A',
          nameAr: 'القطاع أ',
          branchId: null,
          defaultCostCentreId: null,
          headPersonId: headA,
        },
      ]),
    );
    expect(outcome).toEqual({ ok: true, created: 2, updated: 1 });
    const units = await asHr((tx) => listStructureUnits(tx));
    const c = units.find((u) => u.code === 'C');
    expect(units.find((u) => u.code === 'C1')).toMatchObject({
      parentId: c?.id,
      levelOrdinal: 2,
      headPersonId: headA,
    });
    expect(units.find((u) => u.id === unit.a)).toMatchObject({
      nameEn: 'Sector A',
      nameAr: 'القطاع أ',
    });
  });

  it("keeps a branch's address, typed location and own week (null = the organization's)", async () => {
    const created = await asHr((tx) =>
      createBranch(tx, {
        code: 'RUH',
        nameAr: 'الرياض',
        nameEn: 'Riyadh',
        parentBranchId: null,
        countryCode: 'SA',
        cityAr: null,
        cityEn: null,
        timezone: 'Asia/Riyadh',
        isHeadquarters: false,
        addressEn: 'King Fahd Road',
        addressAr: 'طريق الملك فهد',
        latitude: 24.7136,
        longitude: 46.6753,
        workingDays: [
          { day: 0, startsAt: '08:00', endsAt: '16:00' },
          { day: 4, startsAt: '08:00', endsAt: '12:00' },
        ],
      }),
    );
    expect(created.ok).toBe(true);
    const [branch] = await asHr((tx) => listBranches(tx));
    expect(branch).toMatchObject({
      addressEn: 'King Fahd Road',
      latitude: 24.7136,
      longitude: 46.6753,
      workingDays: [
        { day: 0, startsAt: '08:00', endsAt: '16:00' },
        { day: 4, startsAt: '08:00', endsAt: '12:00' },
      ],
    });
    if (!branch) return;
    const updated = await asHr((tx) =>
      updateBranch(tx, branch.id, branch.version, {
        code: 'RUH',
        nameAr: 'الرياض',
        nameEn: 'Riyadh',
        parentBranchId: null,
        countryCode: 'SA',
        cityAr: null,
        cityEn: null,
        timezone: 'Asia/Riyadh',
        isHeadquarters: false,
        addressEn: null,
        addressAr: null,
        latitude: null,
        longitude: null,
        workingDays: null,
      }),
    );
    expect(updated.ok && updated.after).toMatchObject({ latitude: null, workingDays: null });
  });
});
