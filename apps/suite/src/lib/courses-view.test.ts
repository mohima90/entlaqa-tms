import { courseMatches } from '@jadarat/tms/courses';
import { describe, expect, it } from 'vitest';
import {
  COURSE_SETTINGS_TABS,
  EMPTY_COURSE_FORM,
  EMPTY_COURSE_QUICK,
  PREVIEW_COURSES,
  courseFieldErrorKey,
  courseFieldTab,
  courseFormFieldOf,
  courseFormFrom,
  courseSettingsHref,
  courseSettingsPath,
  courseSettingsTab,
  coursesHref,
  coursesParams,
  coursesPath,
  isFiltered,
  parseCourseForm,
  parseCourseQuickForm,
  parseNumber,
  previewFilter,
} from './courses-view';

const filled = {
  ...EMPTY_COURSE_FORM,
  code: ' LEAD-١٠١ ',
  titleEn: 'Strategic management',
  titleAr: 'الإدارة الاستراتيجية',
  durationHours: '12',
  durationDays: '2',
  minParticipants: '8',
  maxParticipants: '20',
  estCostPerSession: '15,000',
  estCostPerParticipant: '٢٥٠٫٥',
};

describe('courses list parameters (T-M3-03)', () => {
  it('keeps the first value of each known parameter, trimmed and bounded', () => {
    expect(
      coursesParams({
        q: [' إدارة ', 'x'],
        type: 'virtual',
        status: '',
        page: '2',
        category: 'x'.repeat(200),
      }),
    ).toEqual({ q: 'إدارة', type: 'virtual', category: 'x'.repeat(120) });
  });

  it('builds the list links with the filters', () => {
    expect(coursesPath({})).toBe('/suite/courses');
    expect(coursesHref('ar', { q: 'إدارة', status: 'active' })).toBe(
      `/ar/suite/courses?q=${encodeURIComponent('إدارة')}&status=active`,
    );
    expect(isFiltered({})).toBe(false);
    expect(isFiltered({ type: 'exam' })).toBe(true);
  });

  it('filters the preview with well-formed values only (as the query would)', () => {
    expect(previewFilter({ type: 'webinar', status: 'gone', category: 'x' })).toEqual({
      q: undefined,
      category: undefined,
      type: undefined,
      status: undefined,
    });
    const found = PREVIEW_COURSES.filter((c) => courseMatches(c, previewFilter({ q: 'اداره' })));
    expect(found.map((c) => c.code)).toEqual(['LEAD-101']);
    const archived = PREVIEW_COURSES.filter((c) =>
      courseMatches(c, previewFilter({ status: 'archived' })),
    );
    expect(archived.map((c) => c.code)).toEqual(['OLD-001']);
  });
});

describe('parseNumber', () => {
  it('reads digits in any script, the Arabic decimal separator and thousands separators', () => {
    expect(parseNumber('')).toBeNull();
    expect(parseNumber(' 15,000 ')).toBe(15000);
    expect(parseNumber('١٥٬٠٠٠٫٥')).toBe(15000.5);
    expect(parseNumber('12.25')).toBe(12.25);
    expect(parseNumber('-3')).toBeNaN();
    expect(parseNumber('1e3')).toBeNaN();
  });
});

describe('parseCourseForm (the same rules as the server)', () => {
  it('turns a filled form into the action values', () => {
    const parsed = parseCourseForm(filled, 'en');
    expect(parsed.errors).toBeNull();
    expect(parsed.values).toMatchObject({
      code: 'LEAD-101',
      category: { kind: 'none' },
      deliveryType: 'classroom',
      durationHours: 12,
      durationDays: 2,
      minParticipants: 8,
      maxParticipants: 20,
      estCostPerSession: 15000,
      estCostPerParticipant: 250.5,
    });
  });

  it('marks required fields, formats and ranges', () => {
    // The title in the organization's default language is required; the other one is optional.
    expect(parseCourseForm(EMPTY_COURSE_FORM, 'en').errors).toEqual({
      code: 'REQUIRED',
      titleEn: 'REQUIRED',
      durationHours: 'REQUIRED',
      maxParticipants: 'REQUIRED',
    });
    expect(parseCourseForm(EMPTY_COURSE_FORM, 'ar').errors).toMatchObject({ titleAr: 'REQUIRED' });
    expect(parseCourseForm(EMPTY_COURSE_FORM, 'ar').errors).not.toHaveProperty('titleEn');
    expect(
      parseCourseForm(
        {
          ...filled,
          code: 'LEAD 101',
          durationHours: 'abc',
          durationDays: '400',
          minParticipants: '1.5',
          estCostPerSession: '1.234',
          deliveryType: 'webinar',
        },
        'en',
      ).errors,
    ).toEqual({
      code: 'CODE_FORMAT',
      deliveryType: 'REQUIRED',
      durationHours: 'NUMBER',
      durationDays: 'OUT_OF_RANGE',
      minParticipants: 'WHOLE',
      estCostPerSession: 'DECIMALS',
    });
  });

  it('checks the rules across fields and a new category’s names', () => {
    expect(parseCourseForm({ ...filled, minParticipants: '30' }, 'en').errors).toEqual({
      minParticipants: 'MIN_ABOVE_MAX',
    });
    expect(parseCourseForm({ ...filled, durationHours: '50' }, 'en').errors).toEqual({
      durationDays: 'HOURS_ABOVE_DAYS',
    });
    // A new category is named in the default language; the other language is optional.
    const newCategory = { ...filled, category: 'new', newCategoryEn: 'Safety' };
    expect(parseCourseForm(newCategory, 'ar').errors).toEqual({ newCategoryAr: 'REQUIRED' });
    expect(parseCourseForm(newCategory, 'en').values?.category).toEqual({
      kind: 'new',
      nameEn: 'Safety',
      nameAr: '',
    });
    const existing = parseCourseForm(
      { ...filled, category: '00000000-0000-4000-8000-00000000ca01' },
      'en',
    );
    expect(existing.values?.category).toEqual({
      kind: 'existing',
      id: '00000000-0000-4000-8000-00000000ca01',
    });
    expect(parseCourseForm({ ...filled, titleEn: 'x'.repeat(201) }, 'en').errors).toEqual({
      titleEn: 'TOO_LONG',
    });
    // The optional title keeps its length limit.
    expect(parseCourseForm({ ...filled, titleAr: 'x'.repeat(201) }, 'en').errors).toEqual({
      titleAr: 'TOO_LONG',
    });
  });

  it('a title in one language: sent as it is; titles left as stored pass the default-language rule', () => {
    const englishOnly = { ...filled, titleAr: '  ' };
    expect(parseCourseForm(englishOnly, 'en').values).toMatchObject({
      titleEn: 'Strategic management',
      titleAr: '',
    });
    expect(parseCourseForm(englishOnly, 'ar').errors).toEqual({ titleAr: 'REQUIRED' });
    // The course was titled in English only before Arabic became the default language: its other
    // settings can still change…
    const stored = { titleEn: 'Strategic management', titleAr: null };
    expect(parseCourseForm({ ...englishOnly, durationHours: '6' }, 'ar', stored).errors).toBeNull();
    // …and a changed title asks for the Arabic one.
    expect(parseCourseForm({ ...englishOnly, titleEn: 'Strategy' }, 'ar', stored).errors).toEqual({
      titleAr: 'REQUIRED',
    });
    const [first] = PREVIEW_COURSES;
    if (!first) throw new Error('fixture');
    expect(courseFormFrom({ ...first, titleAr: null }).titleAr).toBe('');
  });

  it('fills the edit form from a course and maps server field errors back', () => {
    const course = PREVIEW_COURSES[0];
    if (!course) throw new Error('fixture');
    const form = courseFormFrom(course);
    expect(form).toMatchObject({
      code: 'LEAD-101',
      durationDays: '2',
      estCostPerParticipant: '250',
    });
    expect(parseCourseForm(form, 'ar').errors).toBeNull();
    expect(courseFormFieldOf('category.nameAr')).toBe('newCategoryAr');
    expect(courseFormFieldOf('category.id')).toBe('category');
    expect(courseFormFieldOf('code')).toBe('code');
    expect(courseFormFieldOf('id')).toBeNull();
    expect(courseFieldErrorKey('CODE_TAKEN')).toBe('CODE_TAKEN');
    expect(courseFieldErrorKey('TOO_BIG')).toBe('INVALID');
  });
});

describe('«Add course»: the popup (WP-UX-01 c)', () => {
  const quick = { ...EMPTY_COURSE_QUICK, titleEn: ' Negotiation skills ', durationHours: '٦' };

  it('asks the titles, the delivery type and the hours, and fills in the rest', () => {
    const parsed = parseCourseQuickForm(quick, 'en');
    expect(parsed.errors).toBeNull();
    expect(parsed.values).toEqual({
      titleEn: 'Negotiation skills',
      titleAr: '',
      descriptionEn: '',
      descriptionAr: '',
      category: { kind: 'none' },
      deliveryType: 'classroom',
      durationHours: 6,
      durationDays: null,
      minParticipants: 1,
      maxParticipants: 20,
      estCostPerSession: null,
      estCostPerParticipant: null,
    });
    // No code is sent: the library gives the next free one.
    expect(parsed.values).not.toHaveProperty('code');
  });

  it('marks only its own fields: the default language’s title and the hours', () => {
    expect(parseCourseQuickForm(EMPTY_COURSE_QUICK, 'en').errors).toEqual({
      titleEn: 'REQUIRED',
      durationHours: 'REQUIRED',
    });
    expect(parseCourseQuickForm(quick, 'ar').errors).toEqual({ titleAr: 'REQUIRED' });
    expect(
      parseCourseQuickForm({ ...quick, durationHours: '0', deliveryType: 'webinar' }, 'en').errors,
    ).toEqual({ durationHours: 'OUT_OF_RANGE', deliveryType: 'REQUIRED' });
  });
});

describe('a course’s settings page (WP-UX-01 c)', () => {
  it('has three sections, each its own address', () => {
    expect(COURSE_SETTINGS_TABS).toEqual(['about', 'delivery', 'capacity']);
    expect(courseSettingsTab('capacity')).toBe('capacity');
    expect(courseSettingsTab(undefined)).toBe('about');
    expect(courseSettingsTab(['delivery'])).toBe('about');
    expect(courseSettingsTab("x' or 1=1")).toBe('about');
    expect(courseSettingsPath('c1')).toBe('/suite/courses/c1/settings');
    expect(courseSettingsPath('c1', 'about')).toBe('/suite/courses/c1/settings');
    expect(courseSettingsHref('ar', 'c1', 'delivery')).toBe(
      '/ar/suite/courses/c1/settings?tab=delivery',
    );
  });

  it('knows the section of every field (a refused field elsewhere is said in words)', () => {
    expect(courseFieldTab('code')).toBe('about');
    expect(courseFieldTab('newCategoryAr')).toBe('about');
    expect(courseFieldTab('durationDays')).toBe('delivery');
    expect(courseFieldTab('deliveryType')).toBe('delivery');
    expect(courseFieldTab('maxParticipants')).toBe('capacity');
    expect(courseFieldTab('estCostPerSession')).toBe('capacity');
  });
});
