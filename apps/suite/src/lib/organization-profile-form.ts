import { normalizeDigits } from '@jadarat/platform-i18n/text';

/**
 * Organization profile form helpers (T-M2-22) — shared by the page (server) and the form (client). The
 * server validates again (platform-rbac OrganizationProfileInput) and the database once more; these rules
 * give the admin the field-level message before anything is sent, and never drop what was typed.
 */
export const ORGANIZATION_NAME_MAX = 80;

/**
 * The profile and regional settings as the General page edits them. The organization's display names moved
 * to Branding (WP-ADM-02, FR-ADM-02): they are validated there with validateOrganizationName.
 */
export interface ProfileFormValues {
  /** '' until chosen. */
  readonly industry: string;
  /** '' until chosen. */
  readonly countryCode: string;
  readonly currencyCode: string;
  readonly timeZone: string;
  readonly fiscalYearStartMonth: number;
  readonly defaultLocale: 'ar' | 'en';
  readonly dateDisplay: 'gregorian' | 'hijri' | 'dual';
  /** 0 = Sunday … 6 = Saturday, sorted. */
  readonly workingDays: readonly number[];
  readonly workStartsAt: string;
  readonly workEndsAt: string;
}

export type ProfileField = keyof ProfileFormValues;

/** Message keys under organizationProfile.fieldErrors. */
export type ProfileFieldError =
  | 'nameRequired'
  | 'nameTooLong'
  | 'nameInvalid'
  | 'industryRequired'
  | 'countryRequired'
  | 'daysRequired'
  | 'timeInvalid'
  | 'endBeforeStart'
  | 'invalid';

/**
 * "8:00", "08:00" or «٠٨:٠٠» → "08:00"; anything else is returned trimmed (and fails validation). Hours
 * 00–23, minutes 00–59 (24-hour clock, as the screen says).
 */
export function normalizeClock(value: string): string {
  const text = normalizeDigits(value).trim().replace('：', ':');
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return text;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return text;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Control characters and bidirectional override/isolate marks (joiners are allowed) — as the server. */
const NAME_FORBIDDEN = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u;

/** A display name as it is saved: Unicode NFC, trimmed. */
export function cleanName(value: string): string {
  return value.normalize('NFC').trim();
}

/** The fields in the order of the page (the first one with an error gets the focus). */
export const PROFILE_FIELD_ORDER: readonly ProfileField[] = [
  'industry',
  'countryCode',
  'currencyCode',
  'timeZone',
  'fiscalYearStartMonth',
  'defaultLocale',
  'dateDisplay',
  'workingDays',
  'workStartsAt',
  'workEndsAt',
];

/** The first field (in page order) that has an error, or null. */
export function firstInvalidField(
  errors: Partial<Record<ProfileField, ProfileFieldError>>,
): ProfileField | null {
  return PROFILE_FIELD_ORDER.find((field) => errors[field] !== undefined) ?? null;
}

/**
 * An organization display name as typed (Branding page, WP-ADM-02): required, at most 80 characters, no
 * control characters or bidirectional overrides — the server's rules. Null: fine.
 */
export function validateOrganizationName(
  value: string,
): Extract<ProfileFieldError, 'nameRequired' | 'nameTooLong' | 'nameInvalid'> | null {
  const name = cleanName(value);
  if (name === '') return 'nameRequired';
  if (Array.from(name).length > ORGANIZATION_NAME_MAX) return 'nameTooLong';
  if (NAME_FORBIDDEN.test(name)) return 'nameInvalid';
  return null;
}

/** Field errors of the values as the admin typed them (empty: ready to send). */
export function validateProfile(
  values: ProfileFormValues,
): Partial<Record<ProfileField, ProfileFieldError>> {
  const errors: Partial<Record<ProfileField, ProfileFieldError>> = {};
  if (values.industry === '') errors.industry = 'industryRequired';
  if (values.countryCode === '') errors.countryCode = 'countryRequired';
  if (values.workingDays.length === 0) errors.workingDays = 'daysRequired';
  const start = normalizeClock(values.workStartsAt);
  const end = normalizeClock(values.workEndsAt);
  if (!CLOCK.test(start)) errors.workStartsAt = 'timeInvalid';
  if (!CLOCK.test(end)) errors.workEndsAt = 'timeInvalid';
  else if (CLOCK.test(start) && end <= start) errors.workEndsAt = 'endBeforeStart';
  return errors;
}

/** A field error the server returned (VALIDATION_FAILED path + code) → the form's message key. */
export function serverFieldError(path: string, values: ProfileFormValues): ProfileFieldError {
  const field = path.split('.')[0] as ProfileField;
  const local = validateProfile(values)[field];
  if (local) return local;
  if (field === 'workEndsAt') return 'endBeforeStart';
  return 'invalid';
}

/** Turns a day on or off; the week stays sorted. */
export function toggleDay(days: readonly number[], day: number): number[] {
  return days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b);
}

/** The values as the action takes them (times normalized; the names stay as stored — Branding). */
export function profileInput(values: ProfileFormValues) {
  return {
    ...values,
    workingDays: [...values.workingDays],
    workStartsAt: normalizeClock(values.workStartsAt),
    workEndsAt: normalizeClock(values.workEndsAt),
  };
}
