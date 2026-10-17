import type { FieldError } from '@jadarat/platform-core';
import { hasVisibleText, normalizeDigits, searchKey } from '@jadarat/platform-i18n';
import { z } from 'zod';

/**
 * Course library model (T-M3-03; FR-CAT-01, FR-CAT-10 minimal) — client-safe: the values of a course,
 * their validation (the same rules as the tms.courses constraints) and the search used without a database.
 * The server action, the service and the form all use these definitions.
 */

/** FR-CAT-01 delivery types (glossary #42–46); same list as courses_delivery_type_check. */
export const DELIVERY_TYPES = [
  'classroom',
  'virtual',
  'blended',
  'hybrid',
  'on_the_job',
  'workshop',
  'conference',
  'exam',
  'elearning',
] as const;
export type DeliveryType = (typeof DELIVERY_TYPES)[number];

export const COURSE_STATUSES = ['active', 'archived'] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

/** Limits shared with the database constraints. */
export const COURSE_LIMITS = {
  codeLength: 32,
  titleLength: 200,
  descriptionLength: 2000,
  categoryNameLength: 100,
  maxHours: 9999.99,
  maxDays: 365,
  maxParticipants: 10_000,
  maxCost: 9_999_999_999.99,
} as const;

/** Letters, digits, dot, dash, underscore; starts with a letter or digit (courses_code_check). */
export const COURSE_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

const decimals = (places: number) => (value: number) =>
  Math.abs(Math.round(value * 10 ** places) - value * 10 ** places) < 1e-6;

const requiredText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => hasVisibleText(value), { message: 'invisible' });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' || !hasVisibleText(value) ? null : value));

const money = z
  .number()
  .min(0)
  .max(COURSE_LIMITS.maxCost)
  .refine(decimals(2), { message: 'decimals' })
  .nullable();

/** Where the course is filed: no category, one of the organization's, or a new one created with it. */
export const CourseCategoryChoice = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('existing'), id: z.uuid() }),
  z.strictObject({
    kind: z.literal('new'),
    nameEn: requiredText(COURSE_LIMITS.categoryNameLength),
    nameAr: requiredText(COURSE_LIMITS.categoryNameLength),
  }),
]);
export type CourseCategoryChoice = z.output<typeof CourseCategoryChoice>;

/**
 * The values of a course (untrusted input). Also what a later caller fills from another source — e.g. an
 * approved plan line (EP-PLN F21, T-M3-08: title, category, delivery type, duration, participants,
 * estimated costs) — before calling the create service.
 */
export const CourseValuesInput = z.strictObject({
  code: z
    .string()
    .transform((value) => normalizeDigits(value).trim())
    .pipe(z.string().min(1).max(COURSE_LIMITS.codeLength).regex(COURSE_CODE_RE)),
  titleEn: requiredText(COURSE_LIMITS.titleLength),
  titleAr: requiredText(COURSE_LIMITS.titleLength),
  descriptionEn: optionalText(COURSE_LIMITS.descriptionLength),
  descriptionAr: optionalText(COURSE_LIMITS.descriptionLength),
  category: CourseCategoryChoice,
  deliveryType: z.enum(DELIVERY_TYPES),
  durationHours: z.number().positive().max(COURSE_LIMITS.maxHours).refine(decimals(2), {
    message: 'decimals',
  }),
  durationDays: z
    .number()
    .positive()
    .max(COURSE_LIMITS.maxDays)
    .refine(decimals(1), { message: 'decimals' })
    .nullable(),
  minParticipants: z.number().int().min(1).max(COURSE_LIMITS.maxParticipants),
  maxParticipants: z.number().int().min(1).max(COURSE_LIMITS.maxParticipants),
  estCostPerSession: money,
  estCostPerParticipant: money,
});
export type CourseValues = z.output<typeof CourseValuesInput>;

/**
 * Rules across fields (the database repeats them): the minimum is not above the maximum, and the days can
 * hold the hours (a day has at most 24).
 */
export function courseFieldProblems(
  values: Pick<
    CourseValues,
    'minParticipants' | 'maxParticipants' | 'durationHours' | 'durationDays'
  >,
): FieldError[] {
  const problems: FieldError[] = [];
  if (values.minParticipants > values.maxParticipants) {
    problems.push({ path: 'minParticipants', code: 'MIN_ABOVE_MAX' });
  }
  if (values.durationDays !== null && values.durationHours > values.durationDays * 24) {
    problems.push({ path: 'durationDays', code: 'HOURS_ABOVE_DAYS' });
  }
  return problems;
}

/** A course as the library shows it. Costs are null when absent — or hidden from the reader. */
export interface CourseRow {
  readonly id: string;
  readonly code: string;
  readonly titleEn: string;
  readonly titleAr: string;
  readonly descriptionEn: string | null;
  readonly descriptionAr: string | null;
  readonly categoryId: string | null;
  readonly deliveryType: DeliveryType;
  readonly durationHours: number;
  readonly durationDays: number | null;
  readonly minParticipants: number;
  readonly maxParticipants: number;
  readonly estCostPerSession: number | null;
  readonly estCostPerParticipant: number | null;
  /** The currency the costs are in (the organization's default when they were entered). */
  readonly costCurrency: string | null;
  readonly status: CourseStatus;
  /** Optimistic concurrency token. */
  readonly version: number;
}

export interface CourseCategoryRow {
  readonly id: string;
  readonly nameEn: string;
  readonly nameAr: string;
}

/** The list's filters (all optional). `category: 'none'` = courses without a category. */
export interface CourseFilter {
  readonly q?: string | undefined;
  readonly category?: string | undefined;
  readonly type?: DeliveryType | undefined;
  readonly status?: CourseStatus | undefined;
}

export interface CourseCounts {
  readonly total: number;
  readonly active: number;
  readonly archived: number;
}

/** Search text as the database matches it (private.search_key): Arabic-aware, case-insensitive. */
export function courseSearchKey(text: string): string {
  return searchKey(text.trim());
}

/**
 * Does a course match the filters? The same rules as the database query (code or either title contains
 * the search text, Arabic letter variants and diacritics ignored) — for lists without a database.
 */
export function courseMatches(course: CourseRow, filter: CourseFilter): boolean {
  const q = filter.q ? courseSearchKey(filter.q) : '';
  if (
    q !== '' &&
    ![course.code, course.titleEn, course.titleAr].some((text) => searchKey(text).includes(q))
  ) {
    return false;
  }
  if (filter.category === 'none' && course.categoryId !== null) return false;
  if (filter.category && filter.category !== 'none' && course.categoryId !== filter.category)
    return false;
  if (filter.type && course.deliveryType !== filter.type) return false;
  if (filter.status && course.status !== filter.status) return false;
  return true;
}

export function countCourses(courses: readonly CourseRow[]): CourseCounts {
  const active = courses.filter((c) => c.status === 'active').length;
  return { total: courses.length, active, archived: courses.length - active };
}
