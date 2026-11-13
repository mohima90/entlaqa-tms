import type { FieldError } from '@jadarat/platform-core';
import { personDisplayName } from '@jadarat/platform-i18n/names';
import { searchKey } from '@jadarat/platform-i18n/text';

/**
 * Course library basics (T-M3-03; FR-CAT-01, FR-CAT-10) without the input schemas — the client entry
 * (`@jadarat/tms/courses`): delivery types, limits, the rules across fields, the row types and the search
 * used without a database. The zod schemas are in model.ts (server actions).
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

/**
 * The delivery types offered when adding or editing a course (PO, 27 Oct 2026, role-play feedback #8): the
 * four of the positioning statement. The others stay valid for stored courses and come back to the list
 * when a customer asks.
 */
export const OFFERED_DELIVERY_TYPES = ['classroom', 'virtual', 'blended', 'on_the_job'] as const;

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

/**
 * What «Add course» fills in by itself (WP-UX-01 c; forms standard rules 1 and 9: the popup asks for the
 * titles, the delivery type and the hours — the rest is worked out and changed on the course's settings):
 * one to twenty participants, and the next free code `CRS-0001`, `CRS-0002`… when none is sent.
 */
export const COURSE_DEFAULTS = {
  minParticipants: 1,
  maxParticipants: 20,
  codePrefix: 'CRS-',
} as const;

/** The code a course added without one gets: `CRS-` and a number of at least four digits. */
export function generatedCourseCode(n: number): string {
  return `${COURSE_DEFAULTS.codePrefix}${String(n).padStart(4, '0')}`;
}

/**
 * The title (or category name) the organization's default language requires (PO, 12 Nov 2026 — the rule of
 * people, planning cycles and the organization's structure): with English as the default language the
 * English one is required and the Arabic one optional, and the other way round. Field errors (code
 * REQUIRED), none when it is there. With `before` (the stored texts): a save that leaves both as they are
 * passes whatever they are — a course titled before the rule, or before the organization changed its default
 * language, can still be changed otherwise (as units and branches: platform-rbac default-language-name).
 */
export function requiredNameProblems(
  defaultLocale: 'ar' | 'en',
  value: { readonly ar: string | null; readonly en: string | null },
  paths: { readonly ar: string; readonly en: string },
  before?: { readonly ar: string | null; readonly en: string | null } | null,
): FieldError[] {
  if (value[defaultLocale] !== null) return [];
  if (before?.ar === value.ar && before.en === value.en) return [];
  return [{ path: paths[defaultLocale], code: 'REQUIRED' }];
}

/**
 * Rules across fields (the database repeats them): the minimum is not above the maximum, and the days can
 * hold the hours (a day has at most 24).
 */
export function courseFieldProblems(values: {
  readonly minParticipants: number;
  readonly maxParticipants: number;
  readonly durationHours: number;
  readonly durationDays: number | null;
}): FieldError[] {
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
  /** One of the two may be missing: the organization's default language's title is required. */
  readonly titleEn: string | null;
  readonly titleAr: string | null;
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
  /** One of the two may be missing (the organization's default language's name is required). */
  readonly nameEn: string | null;
  readonly nameAr: string | null;
}

/** A course's title in the page's language — the other language's when that one is missing. */
export function courseTitle(
  course: Pick<CourseRow, 'titleEn' | 'titleAr'>,
  locale: 'ar' | 'en',
): string {
  return personDisplayName(locale, course.titleAr, course.titleEn);
}

/** A category's name in the page's language — the other language's when that one is missing. */
export function courseCategoryName(
  category: Pick<CourseCategoryRow, 'nameEn' | 'nameAr'>,
  locale: 'ar' | 'en',
): string {
  return personDisplayName(locale, category.nameAr, category.nameEn);
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
    ![course.code, course.titleEn ?? '', course.titleAr ?? ''].some((text) =>
      searchKey(text).includes(q),
    )
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
