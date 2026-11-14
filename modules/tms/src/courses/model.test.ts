import { describe, expect, it } from 'vitest';
import {
  COURSE_CODE_RE,
  COURSE_DEFAULTS,
  type CourseRow,
  CourseValuesInput,
  CreateCourseInput,
  DELIVERY_TYPES,
  countCourses,
  courseCategoryName,
  courseFieldProblems,
  courseMatches,
  courseTitle,
  generatedCourseCode,
  requiredNameProblems,
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
      'a new category with an invisible name',
      { category: { kind: 'new', nameEn: 'Safety', nameAr: String.fromCharCode(0x200b) } },
    ],
    ['a title too long', { titleEn: 'x'.repeat(201) }],
  ])('rejects %s', (_label, over) => {
    expect(CourseValuesInput.safeParse({ ...VALUES, ...over }).success).toBe(false);
  });

  it('takes a title and a category name in one language (which one is required is the service’s rule)', () => {
    const parsed = CourseValuesInput.parse({
      ...VALUES,
      titleAr: '  ',
      category: { kind: 'new', nameEn: 'Safety', nameAr: '' },
    });
    expect(parsed.titleAr).toBeNull();
    expect(parsed.titleEn).toBe('Strategic management');
    expect(parsed.category).toEqual({ kind: 'new', nameEn: 'Safety', nameAr: null });
  });

  it('a new course may come without a code; a changed one may not', () => {
    const { code: _code, ...withoutCode } = VALUES;
    expect(CreateCourseInput.parse(withoutCode).code).toBeNull();
    expect(CreateCourseInput.parse({ ...VALUES, code: ' ' }).code).toBeNull();
    expect(CreateCourseInput.parse(VALUES).code).toBe('LEAD-101');
    expect(CreateCourseInput.safeParse({ ...VALUES, code: 'LEAD 101' }).success).toBe(false);
    expect(CourseValuesInput.safeParse(withoutCode).success).toBe(false);
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

describe('the name rule and what «Add course» fills in', () => {
  it('requires the default language’s text; texts left as stored pass', () => {
    const paths = { ar: 'titleAr', en: 'titleEn' };
    expect(requiredNameProblems('en', { ar: null, en: 'Title' }, paths)).toEqual([]);
    expect(requiredNameProblems('en', { ar: 'عنوان', en: null }, paths)).toEqual([
      { path: 'titleEn', code: 'REQUIRED' },
    ]);
    expect(requiredNameProblems('ar', { ar: null, en: 'Title' }, paths)).toEqual([
      { path: 'titleAr', code: 'REQUIRED' },
    ]);
    const stored = { ar: null, en: 'Title' };
    expect(requiredNameProblems('ar', { ar: null, en: 'Title' }, paths, stored)).toEqual([]);
    expect(requiredNameProblems('ar', { ar: null, en: 'Other' }, paths, stored)).toHaveLength(1);
  });

  it('shows the title and the category name that exist', () => {
    expect(courseTitle({ titleEn: 'Title', titleAr: null }, 'ar')).toBe('Title');
    expect(courseTitle({ titleEn: null, titleAr: 'عنوان' }, 'en')).toBe('عنوان');
    expect(courseTitle({ titleEn: 'Title', titleAr: 'عنوان' }, 'ar')).toBe('عنوان');
    expect(courseCategoryName({ nameEn: null, nameAr: 'السلامة' }, 'en')).toBe('السلامة');
    expect(courseCategoryName({ nameEn: 'Safety', nameAr: null }, 'ar')).toBe('Safety');
  });

  it('numbers the generated codes CRS-0001, CRS-0002… within the code’s rule', () => {
    expect(generatedCourseCode(1)).toBe('CRS-0001');
    expect(generatedCourseCode(12345)).toBe('CRS-12345');
    expect(COURSE_CODE_RE.test(generatedCourseCode(42))).toBe(true);
    expect(COURSE_DEFAULTS).toMatchObject({ minParticipants: 1, maxParticipants: 20 });
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
