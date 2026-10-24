import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  branchRefusalOf,
  createBranch,
  deleteBranch,
  listBranches,
  setBranchStatus,
  updateBranch,
} from './branches';
import { setStructureCompletionForTests } from './custom-roles-present';

// The database before WP-HR-01's migrations unless a test says otherwise (no presence query in the fakes).
beforeEach(() => {
  setStructureCompletionForTests(false);
});

const dialect = new PgDialect();

function fakeTx(results: (unknown[] | Error)[]) {
  const executed: { sql: string; params: unknown[] }[] = [];
  return {
    executed,
    tx: {
      execute: (query: SQL) => {
        const q = dialect.sqlToQuery(query);
        executed.push({ sql: q.sql, params: q.params });
        const next = results.shift() ?? [];
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
      },
    } as never,
  };
}

const pgError = (code: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error('db'), { cause: { code, message: '', ...extra } });
const writes = (fake: ReturnType<typeof fakeTx>) =>
  fake.executed.filter((q) => /^\s*(insert|update|delete)\b/.test(q.sql));

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  code: id.toUpperCase(),
  name_ar: `فرع ${id}`,
  name_en: null,
  parent_branch_id: null,
  country_code: 'SA',
  city_ar: null,
  city_en: 'Riyadh',
  timezone: 'Asia/Riyadh',
  is_headquarters: false,
  address_en: null,
  address_ar: null,
  latitude: null,
  longitude: null,
  working_days: null,
  status: 'active',
  version: 1,
  child_count: '0',
  unit_count: 0,
  people_count: '0',
  ...over,
});
const input = {
  code: 'JED',
  nameAr: 'جدة',
  nameEn: 'Jeddah',
  parentBranchId: null,
  countryCode: 'SA',
  cityAr: null,
  cityEn: 'Jeddah',
  timezone: 'Asia/Riyadh',
  isHeadquarters: false,
  addressEn: null,
  addressAr: null,
  latitude: null,
  longitude: null,
  workingDays: null,
};
/** The two hierarchy locks every write takes first (units, then branches). */
const LOCKS: unknown[][] = [[], []];

describe('listBranches', () => {
  it('maps the live branches with what keeps each from being deleted', async () => {
    const fake = fakeTx([
      [row('ruh', { country_code: 'SA', is_headquarters: true, unit_count: '2' })],
    ]);
    expect(await listBranches(fake.tx)).toEqual([
      {
        id: 'ruh',
        code: 'RUH',
        nameAr: 'فرع ruh',
        nameEn: null,
        parentBranchId: null,
        countryCode: 'SA',
        cityAr: null,
        cityEn: 'Riyadh',
        timezone: 'Asia/Riyadh',
        isHeadquarters: true,
        addressEn: null,
        addressAr: null,
        latitude: null,
        longitude: null,
        workingDays: null,
        status: 'active',
        version: 1,
        childCount: 0,
        unitCount: 2,
        peopleCount: 0,
      },
    ]);
    expect(fake.executed[0]?.sql).toContain('b.deleted_at is null');
    expect(
      (await listBranches(fakeTx([[row('x', { country_code: null })]]).tx))[0]?.countryCode,
    ).toBeNull();
  });
});

describe('writes', () => {
  it('creates a branch after both locks; a new headquarters moves the flag', async () => {
    const plain = fakeTx([...LOCKS, [{ id: 'jed' }], [row('jed')]]);
    expect(await createBranch(plain.tx, input)).toMatchObject({ ok: true, after: { id: 'jed' } });
    expect(plain.executed[0]?.sql).toContain("'platform.departments:'");
    expect(plain.executed[1]?.sql).toContain("'platform.branches:'");
    expect(writes(plain).map((q) => q.sql.trim().split(/\s+/)[0])).toEqual(['insert']);
    const hq = fakeTx([
      ...LOCKS,
      [{ id: 'ruh' }],
      [{ id: 'jed' }],
      [row('jed', { is_headquarters: true })],
    ]);
    // C-9: the previous headquarters is reported, for the audit.
    expect(await createBranch(hq.tx, { ...input, isHeadquarters: true })).toMatchObject({
      ok: true,
      headquartersMovedFrom: 'ruh',
    });
    expect(writes(hq)[0]?.sql).toContain('set is_headquarters = false');
    expect(writes(hq)[0]?.sql).toContain('returning id');
    const taken = fakeTx([
      ...LOCKS,
      pgError('23505', { constraint_name: 'branches_tenant_code_uq' }),
    ]);
    expect(await createBranch(taken.tx, input)).toEqual({ ok: false, refusal: 'code_taken' });
  });

  it('updates and deactivates with the version checked', async () => {
    const updated = fakeTx([
      ...LOCKS,
      [row('jed')],
      [{ id: 'ruh' }],
      [{ id: 'jed' }],
      [row('jed', { version: 2 })],
    ]);
    expect(
      await updateBranch(updated.tx, 'jed', 1, { ...input, isHeadquarters: true }),
    ).toMatchObject({
      ok: true,
      after: { version: 2 },
      headquartersMovedFrom: 'ruh',
    });
    // The flag leaves every other branch first.
    expect(writes(updated)[0]?.params).toContain('jed');
    expect(await updateBranch(fakeTx([...LOCKS, []]).tx, 'jed', 1, input)).toEqual({
      ok: false,
      refusal: 'not_found',
    });
    expect(
      await updateBranch(fakeTx([...LOCKS, [row('jed', { version: 5 })]]).tx, 'jed', 1, input),
    ).toEqual({ ok: false, refusal: 'version_conflict' });
    expect(
      await updateBranch(
        fakeTx([...LOCKS, [row('jed')], pgError('23514', { message: 'unknown time zone' })]).tx,
        'jed',
        1,
        input,
      ),
    ).toEqual({ ok: false, refusal: 'timezone_unknown' });
    const status = fakeTx([
      ...LOCKS,
      [row('jed')],
      [{ id: 'jed' }],
      [row('jed', { status: 'inactive' })],
    ]);
    expect(await setBranchStatus(status.tx, 'jed', 1, 'inactive')).toMatchObject({
      ok: true,
      after: { status: 'inactive' },
    });
    expect(
      await setBranchStatus(fakeTx([...LOCKS, [row('jed')], []]).tx, 'jed', 1, 'active'),
    ).toEqual({ ok: false, refusal: 'version_conflict' });
  });

  it('refuses to delete a branch still in use, with the numbers; deletes it otherwise', async () => {
    const used = fakeTx([
      ...LOCKS,
      [row('jed', { child_count: 1, unit_count: 2, people_count: 3 })],
    ]);
    expect(await deleteBranch(used.tx, 'jed', 1)).toEqual({
      ok: false,
      refusal: 'branch_in_use',
      usage: { branches: 1, units: 2, people: 3 },
    });
    expect(writes(used)).toEqual([]);
    const free = fakeTx([...LOCKS, [row('jed')], [{ id: 'jed' }]]);
    expect(await deleteBranch(free.tx, 'jed', 1)).toMatchObject({ ok: true, after: null });
    const raced = fakeTx([
      ...LOCKS,
      [row('jed')],
      pgError('23514', { message: 'still has departments' }),
    ]);
    expect(await deleteBranch(raced.tx, 'jed', 1)).toEqual({
      ok: false,
      refusal: 'branch_in_use',
      usage: { branches: 0, units: 0, people: 0 },
    });
    expect(await deleteBranch(fakeTx([...LOCKS, [row('jed')], []]).tx, 'jed', 1)).toEqual({
      ok: false,
      refusal: 'version_conflict',
    });
    expect(await deleteBranch(fakeTx([...LOCKS, []]).tx, 'jed', 1)).toEqual({
      ok: false,
      refusal: 'not_found',
    });
    expect(
      await deleteBranch(fakeTx([...LOCKS, [row('jed', { version: 2 })]]).tx, 'jed', 1),
    ).toEqual({
      ok: false,
      refusal: 'version_conflict',
    });
  });
});

describe('branchRefusalOf', () => {
  it('maps the branch refusals and rethrows anything else', () => {
    expect(branchRefusalOf(pgError('23503'))).toBe('parent_not_found');
    expect(
      branchRefusalOf(pgError('23514', { message: 'cannot be placed under a deleted parent' })),
    ).toBe('parent_not_found');
    expect(
      branchRefusalOf(pgError('23514', { message: 'cannot be placed under its own descendant' })),
    ).toBe('branch_tree');
    const other = new Error('boom');
    expect(() => branchRefusalOf(other)).toThrow(other);
  });
});
