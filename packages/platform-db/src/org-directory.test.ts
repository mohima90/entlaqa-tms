import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  MEMBER_SEARCH,
  getMemberOptionsByIds,
  listOrgStructure,
  searchMemberOptions,
} from './org-directory';
import type { UserTx } from './with-user-tx';

const dialect = new PgDialect();

function fakeTx(...results: Record<string, unknown>[][]) {
  const executed: { sql: string; params: unknown[] }[] = [];
  const tx = {
    execute: (query: SQL) => {
      executed.push(dialect.sqlToQuery(query));
      return Promise.resolve(results.shift() ?? []);
    },
  } as unknown as UserTx;
  return { tx, executed };
}

describe('listOrgStructure (EP-PLN platform service)', () => {
  it('maps departments with their heads and branches; deleted rows are filtered by the query', async () => {
    const { tx, executed } = fakeTx(
      [
        {
          id: 'd1',
          parent_id: null,
          branch_id: 'b1',
          code: 'TD',
          name_ar: 'التدريب',
          name_en: 'Training',
          status: 'active',
          sort_order: '2',
          head_person_id: 'p1',
          head_name_ar: 'سارة',
          head_name_en: null,
        },
        {
          id: 'd2',
          parent_id: 'd1',
          branch_id: null,
          code: 'TD-1',
          name_ar: 'فرعي',
          name_en: null,
          status: 'inactive',
          sort_order: 0,
          head_person_id: null,
          head_name_ar: null,
          head_name_en: null,
        },
      ],
      [{ id: 'b1', name_ar: 'الرياض', name_en: 'Riyadh', status: 'active' }],
    );
    const structure = await listOrgStructure(tx);
    expect(structure.departments).toEqual([
      {
        id: 'd1',
        parentId: null,
        branchId: 'b1',
        code: 'TD',
        nameAr: 'التدريب',
        nameEn: 'Training',
        active: true,
        sortOrder: 2,
        head: { personId: 'p1', nameAr: 'سارة', nameEn: null },
      },
      {
        id: 'd2',
        parentId: 'd1',
        branchId: null,
        code: 'TD-1',
        nameAr: 'فرعي',
        nameEn: null,
        active: false,
        sortOrder: 0,
        head: null,
      },
    ]);
    expect(structure.branches).toEqual([
      { id: 'b1', nameAr: 'الرياض', nameEn: 'Riyadh', active: true },
    ]);
    expect(executed[0]?.sql).toContain('d.deleted_at is null');
    expect(executed[1]?.sql).toContain('deleted_at is null');
  });
});

describe('getMemberOptionsByIds (C-M3: no cap)', () => {
  it('returns the named persons with whether each is an active member, ignoring malformed ids', async () => {
    const { tx, executed } = fakeTx([
      { person_id: 'p1', name_ar: 'أحمد', name_en: 'Ahmed', active: true },
      { person_id: 'p2', name_ar: 'ليلى', name_en: null, active: false },
    ]);
    const options = await getMemberOptionsByIds(tx, [
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111'.toUpperCase(),
      "x'; drop table",
    ]);
    expect(options).toEqual([
      { personId: 'p1', nameAr: 'أحمد', nameEn: 'Ahmed', active: true },
      { personId: 'p2', nameAr: 'ليلى', nameEn: null, active: false },
    ]);
    expect(executed[0]?.params).toEqual(['{11111111-1111-4111-8111-111111111111}']);
    expect(executed[0]?.sql).not.toContain('email');
    expect(executed[0]?.sql).not.toContain('limit');
  });

  it('asks nothing for no ids', async () => {
    const { tx, executed } = fakeTx();
    expect(await getMemberOptionsByIds(tx, ['nope'])).toEqual([]);
    expect(executed).toHaveLength(0);
  });
});

describe('searchMemberOptions (C-M3: server search, min 2 characters, at most 50)', () => {
  it('searches active members by Arabic or English name, wildcards taken literally', async () => {
    const { tx, executed } = fakeTx([{ person_id: 'p1', name_ar: 'سارة', name_en: 'Sara' }]);
    expect(await searchMemberOptions(tx, '  50%_a\\ ')).toEqual([
      { personId: 'p1', nameAr: 'سارة', nameEn: 'Sara' },
    ]);
    expect(executed[0]?.params).toEqual([
      '%50\\%\\_a\\\\%',
      '%50\\%\\_a\\\\%',
      MEMBER_SEARCH.limit,
    ]);
    expect(executed[0]?.sql).toContain("p.status = 'active'");
    expect(executed[0]?.sql).toContain('limit');
    expect(executed[0]?.sql).not.toContain('email');
  });

  it('asks nothing for fewer than two characters', async () => {
    const { tx, executed } = fakeTx();
    expect(await searchMemberOptions(tx, ' s ')).toEqual([]);
    expect(executed).toHaveLength(0);
  });
});
