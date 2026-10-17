import { hasVisibleText, normalizeDigits } from '@jadarat/platform-i18n';
import { z } from 'zod';
import { COURSE_CODE_RE, COURSE_LIMITS, DELIVERY_TYPES } from './shared';

/**
 * Course library model (T-M3-03; FR-CAT-01, FR-CAT-10 minimal): the input schemas of a course's values
 * (the same rules as the tms.courses constraints), used by the server actions and the service, plus the
 * zod-free basics of shared.ts (the client entry `@jadarat/tms/courses`, kept small for the page budget).
 */

export * from './shared';

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
