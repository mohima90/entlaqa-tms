import type { UserTx } from '@jadarat/platform-db';
import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  COURSE_LIST_LIMIT,
  countCourseStatuses,
  getCourse,
  insertCourse,
  insertCourseCategory,
  listCourseCategories,
  listCourses,
  updateCourseRow,
  updateCourseStatus,
} from './db';

const dialect = new PgDialect();

/** A transaction answering each statement with the next prepared result set. */
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

const raw = {
  id: 'c1',
  code: 'LEAD-101',
  title_en: 'Strategic management',
  title_ar: 'الإدارة الاستراتيجية',
  description_en: null,
  description_ar: null,
  category_id: null,
  delivery_type: 'classroom',
  duration_hours: '12.00',
  duration_days: '2.0',
  min_participants: 8,
  max_participants: 20,
  est_cost_per_session: '15000.00',
  est_cost_per_participant: null,
  cost_currency: 'SAR',
  status: 'active',
  version: 1,
};

const values = {
  code: 'LEAD-101',
  titleEn: 'Strategic management',
  titleAr: 'الإدارة الاستراتيجية',
  descriptionEn: null,
  descriptionAr: null,
  categoryId: null,
  deliveryType: 'classroom' as const,
  durationHours: 12,
  durationDays: 2,
  minParticipants: 8,
  maxParticipants: 20,
  estCostPerSession: 15000,
  estCostPerParticipant: null,
};

describe('course library SQL (T-M3-03)', () => {
  it('lists courses with Arabic-aware search, filters and costs only when allowed', async () => {
    const { tx, executed } = fakeTx([raw]);
    const rows = await listCourses(
      tx,
      { q: ' إدارة_% ', category: 'none', type: 'virtual', status: 'active' },
      { withCosts: true },
    );
    expect(rows).toEqual([
      expect.objectContaining({ durationHours: 12, durationDays: 2, estCostPerSession: 15000 }),
    ]);
    const query = executed[0];
    expect(query?.sql).toContain('private.search_key(c.title_ar) like private.search_key(');
    expect(query?.sql).toContain('c.category_id is null');
    expect(query?.sql).toContain('c.est_cost_per_session');
    // The search text is normalized and its wildcards matched literally.
    expect(query?.params).toEqual(
      expect.arrayContaining(['%اداره\\_\\%%', 'virtual', 'active', COURSE_LIST_LIMIT + 1]),
    );
  });

  it('never selects the costs for readers without tms.course_cost.read', async () => {
    const { tx, executed } = fakeTx([raw]);
    const [row] = await listCourses(
      tx,
      { category: '00000000-0000-4000-8000-000000000001' },
      { withCosts: false },
    );
    expect(row).toMatchObject({ estCostPerSession: null, costCurrency: null });
    expect(executed[0]?.sql).not.toContain('c.est_cost_per_session');
    expect(executed[0]?.sql).toContain('c.category_id = $1::uuid');
  });

  it('counts the library and reads one course and the categories', async () => {
    const { tx } = fakeTx(
      [{ total: '3', active: '2' }],
      [raw],
      [],
      [{ id: 'k1', name_en: 'Leadership', name_ar: 'القيادة' }],
    );
    expect(await countCourseStatuses(tx)).toEqual({ total: 3, active: 2, archived: 1 });
    expect(await getCourse(tx, 'c1')).toMatchObject({ code: 'LEAD-101', costCurrency: 'SAR' });
    expect(await getCourse(tx, 'c2')).toBeNull();
    expect(await listCourseCategories(tx)).toEqual([
      { id: 'k1', nameEn: 'Leadership', nameAr: 'القيادة' },
    ]);
    const empty = fakeTx([]);
    expect(await countCourseStatuses(empty.tx)).toEqual({ total: 0, active: 0, archived: 0 });
  });

  it('writes categories and courses, and reports stale versions', async () => {
    const { tx, executed } = fakeTx(
      [{ id: 'k2', name_en: 'Safety', name_ar: 'السلامة' }],
      [{ id: 'c9' }],
      [{ id: 'c9' }],
      [],
      [{ id: 'c9' }],
      [],
    );
    expect(await insertCourseCategory(tx, { nameEn: 'Safety', nameAr: 'السلامة' })).toEqual({
      id: 'k2',
      nameEn: 'Safety',
      nameAr: 'السلامة',
    });
    expect(await insertCourse(tx, values)).toBe('c9');
    expect(await updateCourseRow(tx, 'c9', 1, values)).toBe(true);
    expect(await updateCourseRow(tx, 'c9', 1, values)).toBe(false);
    expect(await updateCourseStatus(tx, 'c9', 2, 'archived')).toBe(true);
    expect(await updateCourseStatus(tx, 'c9', 2, 'archived')).toBe(false);
    expect(executed[1]?.sql).toContain('insert into tms.courses');
    expect(executed[2]?.sql).toContain('where id = $14::uuid and version = $15');
  });

  it('fails loudly when the database returns no row for an insert', async () => {
    await expect(insertCourse(fakeTx([]).tx, values)).rejects.toThrow('no row returned');
    await expect(insertCourseCategory(fakeTx([]).tx, { nameEn: 'x', nameAr: 'س' })).rejects.toThrow(
      'no row returned',
    );
  });
});
