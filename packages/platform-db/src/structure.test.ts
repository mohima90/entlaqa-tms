import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  addStructureLevel,
  createStructureUnit,
  deleteStructureUnit,
  listActivePersonOptions,
  listStructureLevelLabels,
  listStructureLevels,
  listStructureUnitOptions,
  removeStructureLevel,
  renameStructureLevel,
  setStructureUnitStatus,
  structureRefusalOf,
  updateStructureUnit,
} from './structure';

const dialect = new PgDialect();

/**
 * A transaction that answers each query in turn. Catalog checks of the deploy window (to_regclass) are
 * answered `present` (or by `absent`) and not recorded.
 */
function fakeTx(results: (unknown[] | Error)[], absent = false) {
  const executed: { sql: string; params: unknown[] }[] = [];
  return {
    executed,
    tx: {
      execute: (query: SQL) => {
        const q = dialect.sqlToQuery(query);
        if (q.sql.includes('to_regclass(')) return Promise.resolve([{ present: !absent }]);
        executed.push({ sql: q.sql, params: q.params });
        const next = results.shift() ?? [];
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
      },
    } as never,
  };
}

const pgError = (code: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error('db'), { cause: { code, message: '', ...extra } });
const isWrite = (q: { sql: string }) => /^\s*(insert|update|delete)\b/.test(q.sql);
const isLock = (q: { sql: string }) => q.sql.includes('pg_advisory_xact_lock');

const levelRow = (ordinal: number, over: Record<string, unknown> = {}) => ({
  id: `l${String(ordinal)}`,
  ordinal,
  name_en: `Level ${String(ordinal)}`,
  name_ar: `المستوى ${String(ordinal)}`,
  version: 1,
  unit_count: '0',
  ...over,
});
const unitRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  code: id.toUpperCase(),
  name_ar: `و-${id}`,
  name_en: null,
  parent_id: null,
  level_ordinal: 1,
  branch_id: null,
  head_person_id: null,
  head_name_ar: null,
  head_name_en: null,
  status: 'active',
  sort_order: 0,
  version: 1,
  child_count: '0',
  people_count: 0,
  role_scope_count: '0',
  ...over,
});

describe('reads', () => {
  it('lists the levels with the units at each; none before the migration', async () => {
    const fake = fakeTx([[levelRow(1, { unit_count: '3' }), levelRow(2)]]);
    expect(await listStructureLevels(fake.tx)).toEqual([
      { id: 'l1', ordinal: 1, nameEn: 'Level 1', nameAr: 'المستوى 1', version: 1, unitCount: 3 },
      { id: 'l2', ordinal: 2, nameEn: 'Level 2', nameAr: 'المستوى 2', version: 1, unitCount: 0 },
    ]);
    expect(fake.executed[0]?.sql).toContain('d.level_ordinal = l.ordinal');
    expect(await listStructureLevels(fakeTx([], true).tx)).toEqual([]);
    expect(await listStructureLevelLabels(fakeTx([[levelRow(1)]]).tx)).toEqual([
      { ordinal: 1, nameEn: 'Level 1', nameAr: 'المستوى 1' },
    ]);
  });

  it('lists the live units with their head and what keeps them from being deleted', async () => {
    const fake = fakeTx([
      [
        unitRow('a', {
          head_person_id: 'p1',
          head_name_ar: 'منى',
          head_name_en: 'Mona',
          child_count: 2,
          people_count: '5',
          role_scope_count: 1,
        }),
      ],
    ]);
    const { listStructureUnits } = await import('./structure');
    expect(await listStructureUnits(fake.tx)).toEqual([
      {
        id: 'a',
        code: 'A',
        nameAr: 'و-a',
        nameEn: null,
        parentId: null,
        levelOrdinal: 1,
        branchId: null,
        headPersonId: 'p1',
        headNameAr: 'منى',
        headNameEn: 'Mona',
        status: 'active',
        sortOrder: 0,
        version: 1,
        childCount: 2,
        peopleCount: 5,
        roleScopeCount: 1,
      },
    ]);
    const query = fake.executed[0]?.sql ?? '';
    expect(query).toContain('d.deleted_at is null');
    expect(query).toContain("p.status = 'active'");
    expect(query).toContain("m.status <> 'revoked'");
    expect(query).toContain("i.status = 'pending'");
    // Before the unit columns exist (deploy window): no level, no role scopes read.
    const early = fakeTx([[unitRow('a', { level_ordinal: null })]], true);
    expect((await listStructureUnits(early.tx))[0]?.levelOrdinal).toBeNull();
    expect(early.executed[0]?.sql).toContain('null::smallint as level_ordinal');
    expect(early.executed[0]?.sql).not.toContain('scope_unit_id');
  });

  it('lists the unit choices and the active people', async () => {
    expect(
      await listStructureUnitOptions(
        fakeTx([[unitRow('a', { status: 'inactive', parent_id: 'p', level_ordinal: 2 })]]).tx,
      ),
    ).toEqual([
      {
        id: 'a',
        code: 'A',
        nameAr: 'و-a',
        nameEn: null,
        parentId: 'p',
        levelOrdinal: 2,
        active: false,
      },
    ]);
    const people = fakeTx([
      [{ id: 'p1', display_name_ar: 'منى', display_name_en: null, employee_number: 'E1' }],
    ]);
    expect(await listActivePersonOptions(people.tx)).toEqual([
      { id: 'p1', nameAr: 'منى', nameEn: null, employeeNumber: 'E1' },
    ]);
    expect(people.executed[0]?.sql).toContain("p.status = 'active'");
  });
});

describe('levels', () => {
  it('adds a level below the last one, after the hierarchy lock', async () => {
    const fake = fakeTx([[], [levelRow(1)], [{ id: 'l2' }], [levelRow(1), levelRow(2)]]);
    const outcome = await addStructureLevel(fake.tx, { nameEn: 'Team', nameAr: 'فريق' });
    expect(outcome).toMatchObject({ ok: true, before: null, after: { id: 'l2', ordinal: 2 } });
    expect(isLock(fake.executed[0] ?? { sql: '' })).toBe(true);
    const insert = fake.executed.find(isWrite);
    expect(insert?.params).toEqual([2, 'Team', 'فريق']);
  });

  it('refuses an eleventh level before writing; maps database refusals', async () => {
    const full = fakeTx([[], Array.from({ length: 10 }, (_, i) => levelRow(i + 1))]);
    expect(await addStructureLevel(full.tx, { nameEn: 'X', nameAr: 'س' })).toEqual({
      ok: false,
      refusal: 'too_many_levels',
    });
    expect(full.executed.some(isWrite)).toBe(false);
    const taken = fakeTx([
      [],
      [levelRow(1)],
      pgError('23505', { constraint_name: 'structure_levels_tenant_name_en_uq' }),
    ]);
    expect(await addStructureLevel(taken.tx, { nameEn: 'Level 1', nameAr: 'س' })).toEqual({
      ok: false,
      refusal: 'name_en_taken',
    });
  });

  it('renames a level (version checked), refuses an unknown or changed one', async () => {
    const ok = fakeTx([[], [levelRow(1)], [{ id: 'l1' }], [levelRow(1, { name_en: 'Unit' })]]);
    expect(
      await renameStructureLevel(ok.tx, 'l1', 1, { nameEn: 'Unit', nameAr: 'وحدة' }),
    ).toMatchObject({ ok: true, before: { nameEn: 'Level 1' }, after: { nameEn: 'Unit' } });
    expect(
      await renameStructureLevel(fakeTx([[], [levelRow(1)]]).tx, 'zz', 1, {
        nameEn: 'a',
        nameAr: 'ب',
      }),
    ).toEqual({ ok: false, refusal: 'not_found' });
    expect(
      await renameStructureLevel(fakeTx([[], [levelRow(1, { version: 4 })]]).tx, 'l1', 1, {
        nameEn: 'a',
        nameAr: 'ب',
      }),
    ).toEqual({ ok: false, refusal: 'version_conflict' });
    // Changed between the read and the write (no row updated).
    expect(
      await renameStructureLevel(fakeTx([[], [levelRow(1)], []]).tx, 'l1', 1, {
        nameEn: 'a',
        nameAr: 'ب',
      }),
    ).toEqual({ ok: false, refusal: 'version_conflict' });
  });

  it('removes only the last level, never the only one, never one in use', async () => {
    const two = [levelRow(1), levelRow(2)];
    expect(await removeStructureLevel(fakeTx([[], two]).tx, 'l1', 1)).toEqual({
      ok: false,
      refusal: 'only_level',
    });
    const three = [levelRow(1), levelRow(2), levelRow(3)];
    expect(await removeStructureLevel(fakeTx([[], three]).tx, 'l2', 1)).toEqual({
      ok: false,
      refusal: 'not_last_level',
    });
    const used = [levelRow(1), levelRow(2, { unit_count: 4 })];
    expect(await removeStructureLevel(fakeTx([[], used]).tx, 'l2', 1)).toEqual({
      ok: false,
      refusal: 'level_in_use',
      usage: { units: 4, people: 0, roles: 0 },
    });
    const fine = fakeTx([[], two, [{ id: 'l2' }]]);
    expect(await removeStructureLevel(fine.tx, 'l2', 1)).toMatchObject({
      ok: true,
      before: { id: 'l2' },
      after: null,
    });
    expect(fine.executed.filter(isWrite)[0]?.sql).toContain(
      'delete from platform.structure_levels',
    );
    const raced = fakeTx([[], two, pgError('JO002')]);
    expect(await removeStructureLevel(raced.tx, 'l2', 1)).toEqual({
      ok: false,
      refusal: 'level_in_use',
    });
  });
});

describe('units', () => {
  it('creates a unit under its parent, last among its siblings', async () => {
    const units = [unitRow('p'), unitRow('c1', { parent_id: 'p', sort_order: 4 })];
    const fake = fakeTx([[], units, [{ id: 'c2' }], [...units, unitRow('c2', { parent_id: 'p' })]]);
    const outcome = await createStructureUnit(fake.tx, 'p', {
      code: 'C2',
      nameEn: 'Child',
      nameAr: 'فرعي',
      branchId: null,
      headPersonId: 'h',
    });
    expect(outcome).toMatchObject({ ok: true, after: { id: 'c2', parentId: 'p' } });
    expect(fake.executed.find(isWrite)?.params).toEqual(['C2', 'فرعي', 'Child', 'p', null, 'h', 5]);
    expect(
      await createStructureUnit(fakeTx([[], units]).tx, 'gone', {
        code: 'X',
        nameEn: 'X',
        nameAr: 'س',
        branchId: null,
        headPersonId: null,
      }),
    ).toEqual({ ok: false, refusal: 'parent_not_found' });
    const below = fakeTx([[], units, pgError('JO001')]);
    expect(
      await createStructureUnit(below.tx, 'c1', {
        code: 'X',
        nameEn: 'X',
        nameAr: 'س',
        branchId: null,
        headPersonId: null,
      }),
    ).toEqual({ ok: false, refusal: 'below_last_level' });
  });

  it('updates, deactivates and deletes with the version checked', async () => {
    const input = { code: 'A', nameEn: 'A', nameAr: 'أ', branchId: null, headPersonId: 'h2' };
    const updated = fakeTx([
      [],
      [unitRow('a')],
      [{ id: 'a' }],
      [unitRow('a', { head_person_id: 'h2', version: 2 })],
    ]);
    expect(await updateStructureUnit(updated.tx, 'a', 1, input)).toMatchObject({
      ok: true,
      before: { headPersonId: null },
      after: { headPersonId: 'h2', version: 2 },
    });
    expect(await updateStructureUnit(fakeTx([[], [unitRow('a')], []]).tx, 'a', 1, input)).toEqual({
      ok: false,
      refusal: 'version_conflict',
    });
    expect(
      await updateStructureUnit(
        fakeTx([[], [unitRow('a')], pgError('23514', { message: 'must be an active person' })]).tx,
        'a',
        1,
        input,
      ),
    ).toEqual({ ok: false, refusal: 'head_not_active' });
    const status = fakeTx([
      [],
      [unitRow('a')],
      [{ id: 'a' }],
      [unitRow('a', { status: 'inactive' })],
    ]);
    expect(await setStructureUnitStatus(status.tx, 'a', 1, 'inactive')).toMatchObject({
      ok: true,
      after: { status: 'inactive' },
    });
    expect(await setStructureUnitStatus(fakeTx([[], []]).tx, 'a', 1, 'inactive')).toEqual({
      ok: false,
      refusal: 'not_found',
    });
  });

  it('refuses to delete a unit still in use, with the numbers; deletes it otherwise', async () => {
    const used = fakeTx([
      [],
      [unitRow('a', { child_count: 1, people_count: 2, role_scope_count: 3 })],
    ]);
    expect(await deleteStructureUnit(used.tx, 'a', 1)).toEqual({
      ok: false,
      refusal: 'unit_in_use',
      usage: { units: 1, people: 2, roles: 3 },
    });
    expect(used.executed.some(isWrite)).toBe(false);
    const free = fakeTx([[], [unitRow('a')], [{ id: 'a' }]]);
    expect(await deleteStructureUnit(free.tx, 'a', 1)).toMatchObject({ ok: true, after: null });
    expect(free.executed.find(isWrite)?.sql).toContain('set deleted_at = now()');
    const raced = fakeTx([[], [unitRow('a')], pgError('23514', { message: 'is still the scope' })]);
    expect(await deleteStructureUnit(raced.tx, 'a', 1)).toEqual({
      ok: false,
      refusal: 'unit_in_use',
      usage: { units: 0, people: 0, roles: 0 },
    });
    expect(await deleteStructureUnit(fakeTx([[], [unitRow('a')], []]).tx, 'a', 1)).toEqual({
      ok: false,
      refusal: 'version_conflict',
    });
    expect(
      await deleteStructureUnit(fakeTx([[], [unitRow('a', { version: 3 })]]).tx, 'a', 1),
    ).toEqual({ ok: false, refusal: 'version_conflict' });
    expect(await deleteStructureUnit(fakeTx([[], []]).tx, 'a', 1)).toEqual({
      ok: false,
      refusal: 'not_found',
    });
  });
});

describe('structureRefusalOf', () => {
  it('maps the structure refusals and rethrows anything else', () => {
    const cases: [Error, string][] = [
      [pgError('JO001'), 'below_last_level'],
      [pgError('JO002'), 'level_in_use'],
      [
        pgError('23505', { constraint_name: 'structure_levels_tenant_name_ar_uq' }),
        'name_ar_taken',
      ],
      [pgError('23505', { constraint_name: 'departments_tenant_code_uq' }), 'code_taken'],
      [
        pgError('23505', { constraint_name: 'structure_levels_tenant_id_ordinal_key' }),
        'version_conflict',
      ],
      [pgError('23514', { constraint_name: 'structure_levels_ordinal_check' }), 'too_many_levels'],
      [pgError('23514', { message: 'cannot belong to a deleted branch' }), 'branch_not_found'],
      [
        pgError('23514', { message: 'cannot be placed under a deleted parent' }),
        'parent_not_found',
      ],
      [pgError('23514', { message: 'only the last level can be removed' }), 'not_last_level'],
      [pgError('23514', { message: 'an organization keeps at least one level' }), 'only_level'],
      [pgError('23514', { message: 'still has rows under it' }), 'unit_in_use'],
      [
        pgError('23503', { constraint_name: 'departments_tenant_id_branch_id_fkey' }),
        'branch_not_found',
      ],
      [
        pgError('23503', { constraint_name: 'departments_tenant_id_head_person_id_fkey' }),
        'head_not_active',
      ],
      [
        pgError('23503', { constraint_name: 'departments_tenant_id_parent_id_fkey' }),
        'parent_not_found',
      ],
    ];
    for (const [error, refusal] of cases) expect(structureRefusalOf(error), refusal).toBe(refusal);
    const other = new Error('boom');
    expect(() => structureRefusalOf(other)).toThrow(other);
    expect(() => structureRefusalOf(pgError('23514', { message: 'something else' }))).toThrow();
    expect(() => structureRefusalOf(pgError('23505', { constraint_name: 'x' }))).toThrow();
  });
});
