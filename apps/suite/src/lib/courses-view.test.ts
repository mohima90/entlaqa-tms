import { courseMatches } from '@jadarat/tms/courses';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_COURSE_FORM,
  PREVIEW_COURSES,
  courseFieldErrorKey,
  courseFormFieldOf,
  courseFormFrom,
  coursesHref,
  coursesParams,
  coursesPath,
  isFiltered,
  parseCourseForm,
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
    const parsed = parseCourseForm(filled);
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
    expect(parseCourseForm(EMPTY_COURSE_FORM).errors).toEqual({
      code: 'REQUIRED',
      titleEn: 'REQUIRED',
      titleAr: 'REQUIRED',
      durationHours: 'REQUIRED',
      maxParticipants: 'REQUIRED',
    });
    expect(
      parseCourseForm({
        ...filled,
        code: 'LEAD 101',
        durationHours: 'abc',
        durationDays: '400',
        minParticipants: '1.5',
        estCostPerSession: '1.234',
        deliveryType: 'webinar',
      }).errors,
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
    expect(parseCourseForm({ ...filled, minParticipants: '30' }).errors).toEqual({
      minParticipants: 'MIN_ABOVE_MAX',
    });
    expect(parseCourseForm({ ...filled, durationHours: '50' }).errors).toEqual({
      durationDays: 'HOURS_ABOVE_DAYS',
    });
    expect(parseCourseForm({ ...filled, category: 'new', newCategoryEn: 'Safety' }).errors).toEqual(
      {
        newCategoryAr: 'REQUIRED',
      },
    );
    const existing = parseCourseForm({
      ...filled,
      category: '00000000-0000-4000-8000-00000000ca01',
    });
    expect(existing.values?.category).toEqual({
      kind: 'existing',
      id: '00000000-0000-4000-8000-00000000ca01',
    });
    expect(parseCourseForm({ ...filled, titleEn: 'x'.repeat(201) }).errors).toEqual({
      titleEn: 'TOO_LONG',
    });
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
    expect(parseCourseForm(form).errors).toBeNull();
    expect(courseFormFieldOf('category.nameAr')).toBe('newCategoryAr');
    expect(courseFormFieldOf('category.id')).toBe('category');
    expect(courseFormFieldOf('code')).toBe('code');
    expect(courseFormFieldOf('id')).toBeNull();
    expect(courseFieldErrorKey('CODE_TAKEN')).toBe('CODE_TAKEN');
    expect(courseFieldErrorKey('TOO_BIG')).toBe('INVALID');
  });
});
