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

/**
 * «الجمعة، 9 أكتوبر 2026 الساعة 11:05 غرينتش+3» / "Friday, 9 October 2026 at 11:05 GMT+3": local time in
 * `timeZone`, with its offset (the reader may be elsewhere).
 */
export function formatEmailDateTime(
  instant: string | Date,
  locale: AppLocale,
  timeZone: string,
): string {
  const at = typeof instant === 'string' ? new Date(instant) : instant;
  const time = new Intl.DateTimeFormat(DATE_LOCALES[locale], {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'shortOffset',
    timeZone,
  }).format(at);
  return locale === 'ar'
    ? `${formatEmailDate(at, locale, timeZone)} الساعة ${time}`
    : `${formatEmailDate(at, locale, timeZone)} at ${time}`;
}

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
