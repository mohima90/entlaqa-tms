import { describe, expect, it } from 'vitest';
import {
  type CourseRow,
  CourseValuesInput,
  DELIVERY_TYPES,
  countCourses,
  courseFieldProblems,
  courseMatches,
} from './model';

const VALUES = {
  code: ' LEAD-١٠١ ',
  titleEn: ' Strategic management ',
  titleAr: 'الإدارة الاستراتيجية',
  descriptionEn: '',
  descriptionAr: 'وصف قصير',
  category: { kind: 'none' as const },
  deliveryType: 'classroom' as const,
  durationHours: 12,
  durationDays: 2,
  minParticipants: 8,
  maxParticipants: 20,
  estCostPerSession: 15000,
  estCostPerParticipant: null,
};

const course = (over: Partial<CourseRow> = {}): CourseRow => ({
  id: '11111111-1111-4111-8111-111111111111',
  code: 'LEAD-101',
  titleEn: 'Strategic management',
  titleAr: 'الإدارة الاستراتيجية',
  descriptionEn: null,
  descriptionAr: null,
  categoryId: null,
  deliveryType: 'classroom',
  durationHours: 12,
  durationDays: 2,
  minParticipants: 8,
  maxParticipants: 20,
  estCostPerSession: 15000,
  estCostPerParticipant: null,
  costCurrency: 'SAR',
  status: 'active',
  version: 1,
  ...over,
});

describe('CourseValuesInput (FR-CAT-01; same rules as the tms.courses constraints)', () => {
  it('trims, turns Eastern Arabic digits into ASCII and empty descriptions into null', () => {
    const parsed = CourseValuesInput.parse(VALUES);
    expect(parsed).toMatchObject({
      code: 'LEAD-101',
      titleEn: 'Strategic management',
      descriptionEn: null,
      descriptionAr: 'وصف قصير',
    });
  });

  it('lists the delivery types of FR-CAT-01', () => {
    expect(DELIVERY_TYPES).toEqual([
      'classroom',
      'virtual',
      'blended',
      'hybrid',
      'on_the_job',
      'workshop',
      'conference',
      'exam',
      'elearning',
    ]);
  });

  it.each([
    ['a code with a space', { code: 'LEAD 101' }],
    ['a code too long', { code: 'X'.repeat(33) }],
    ['an invisible title', { titleAr: String.fromCharCode(0x200b) }],
    ['an unknown delivery type', { deliveryType: 'webinar' }],
    ['zero hours', { durationHours: 0 }],
    ['three decimals of hours', { durationHours: 1.255 }],
    ['more than 365 days', { durationDays: 366 }],
    ['a fractional participant', { maxParticipants: 2.5 }],
    ['zero participants', { minParticipants: 0 }],
    ['a negative cost', { estCostPerSession: -1 }],
    ['a cost with three decimals', { estCostPerParticipant: 1.001 }],
    ['an unknown field', { status: 'archived' }],
    [
      'an existing category that is not a uuid',
      { category: { kind: 'existing', id: "1' or 1=1" } },
    ],
    [
      'a new category without an Arabic name',
      { category: { kind: 'new', nameEn: 'Safety', nameAr: ' ' } },
    ],
  ])('rejects %s', (_label, over) => {
    expect(CourseValuesInput.safeParse({ ...VALUES, ...over }).success).toBe(false);
  });

  it('accepts a new category and optional costs left empty', () => {
    const parsed = CourseValuesInput.parse({
      ...VALUES,
      category: { kind: 'new', nameEn: ' Safety ', nameAr: 'السلامة' },
      estCostPerSession: null,
      durationDays: null,
    });
    expect(parsed.category).toEqual({ kind: 'new', nameEn: 'Safety', nameAr: 'السلامة' });
  });
});

describe('courseFieldProblems (rules across fields)', () => {
  it('needs the minimum at most the maximum and days that hold the hours', () => {
    expect(courseFieldProblems({ ...VALUES })).toEqual([]);
    expect(courseFieldProblems({ ...VALUES, minParticipants: 21 })).toEqual([
      { path: 'minParticipants', code: 'MIN_ABOVE_MAX' },
    ]);
    expect(courseFieldProblems({ ...VALUES, durationHours: 30, durationDays: 1 })).toEqual([
      { path: 'durationDays', code: 'HOURS_ABOVE_DAYS' },
    ]);
    expect(courseFieldProblems({ ...VALUES, durationHours: 30, durationDays: null })).toEqual([]);
  });
});

describe('courseMatches (search without a database, FR-CAT-10)', () => {
  it('finds «الإدارة الاستراتيجية» for «إدارة» and for «اداره» (BRD acceptance criterion)', () => {
    expect(courseMatches(course(), { q: 'إدارة' })).toBe(true);
    expect(courseMatches(course(), { q: 'اداره' })).toBe(true);
    expect(courseMatches(course(), { q: 'lead-١٠١' })).toBe(true);
    expect(courseMatches(course(), { q: 'STRATEGIC' })).toBe(true);
    expect(courseMatches(course(), { q: 'safety' })).toBe(false);
  });

  it('filters by category, delivery type and status', () => {
    const filed = course({ categoryId: 'c1' });
    expect(courseMatches(filed, { category: 'c1' })).toBe(true);
    expect(courseMatches(filed, { category: 'c2' })).toBe(false);
    expect(courseMatches(filed, { category: 'none' })).toBe(false);
    expect(courseMatches(course(), { category: 'none' })).toBe(true);
    expect(courseMatches(course(), { type: 'virtual' })).toBe(false);
    expect(courseMatches(course(), { status: 'archived' })).toBe(false);
    expect(courseMatches(course(), { q: '  ', type: 'classroom', status: 'active' })).toBe(true);
  });

  it('counts active and archived courses', () => {
    expect(countCourses([course(), course({ status: 'archived' })])).toEqual({
      total: 2,
      active: 1,
      archived: 1,
    });
  });
});
