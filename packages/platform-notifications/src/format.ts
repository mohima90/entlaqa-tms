import type { AppLocale } from '@jadarat/platform-i18n';

/** Western digits and the Gregorian calendar, pinned (ADR 0007 §1); English dates in day-month order. */
const DATE_LOCALES: Readonly<Record<AppLocale, string>> = {
  ar: 'ar-u-nu-latn-ca-gregory',
  en: 'en-GB-u-nu-latn-ca-gregory',
};

/** «الأحد، 11 أكتوبر 2026» / "Sunday, 11 October 2026", as a calendar day in `timeZone`. */
export function formatEmailDate(
  instant: string | Date,
  locale: AppLocale,
  timeZone: string,
): string {
  return new Intl.DateTimeFormat(DATE_LOCALES[locale], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone,
  }).format(typeof instant === 'string' ? new Date(instant) : instant);
}

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
