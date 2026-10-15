import { DEFAULT_CALENDAR, DEFAULT_NUMBERING_SYSTEM } from './formats';
import type { AppLocale } from './locales';
import { DEFAULT_TIME_ZONE, type DateDisplay, isTimeZone } from './regional';

/**
 * The one formatter of instants for display (FR-SCH-07, ADR 0007 §6; T-M2-22): Gregorian, Hijri
 * (Umm al-Qura) or both, in the organization's time zone, with Western digits pinned (ADR 0007 §1/§5).
 * Pure: the same input gives the same text on the server and in the browser (given the same ICU data).
 *
 *   style `date`          Oct 14, 2026                      · Jumada I 3, 1448 AH
 *   style `dateTime`      Oct 14, 2026, 2:05 PM             · Jumada I 3, 1448 AH at 2:05 PM
 *   style `long`          October 14, 2026                  (long Gregorian date)
 *   style `longDateTime`  October 14, 2026 at 2:05 PM       (long Gregorian date and time)
 *   style `full`          Wednesday, October 14, 2026       (the date preview of the profile page)
 *
 * `dual` shows the Gregorian text first and the Hijri date after « · » (the weekday and the time once,
 * in the Gregorian part). Date-only values (hire dates) keep using formatHijriDate, which reads them as
 * calendar days without a time zone. Intl formatters are cached per locale, calendar, zone and style.
 */
export type DateStyle = 'date' | 'dateTime' | 'long' | 'longDateTime' | 'full';

export interface DisplayDateOptions {
  readonly locale: AppLocale;
  readonly display: DateDisplay;
  /** IANA zone; an unknown zone falls back to the platform default rather than failing the page. */
  readonly timeZone: string;
  readonly style?: DateStyle;
}

export const DUAL_SEPARATOR = ' · ';

const HIJRI_CALENDAR = 'islamic-umalqura';

const withTime = (style: DateStyle) => style === 'dateTime' || style === 'longDateTime';

function gregorianOptions(style: DateStyle): Intl.DateTimeFormatOptions {
  switch (style) {
    case 'date':
      return { dateStyle: 'medium' };
    case 'dateTime':
      return { dateStyle: 'medium', timeStyle: 'short' };
    case 'long':
      return { dateStyle: 'long' };
    case 'longDateTime':
      return { dateStyle: 'long', timeStyle: 'short' };
    case 'full':
      return { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  }
}

function hijriOptions(weekday: boolean, time: boolean): Intl.DateTimeFormatOptions {
  return {
    ...(weekday ? { weekday: 'long' } : {}),
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...(time ? { hour: 'numeric', minute: '2-digit' } : {}),
  };
}

const cache = new Map<string, Intl.DateTimeFormat>();
const zoneValid = new Map<string, boolean>();

function formatter(
  locale: AppLocale,
  calendar: string,
  timeZone: string,
  key: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const id = `${locale}|${calendar}|${timeZone}|${key}`;
  let found = cache.get(id);
  if (!found) {
    found = new Intl.DateTimeFormat(locale, {
      ...options,
      calendar,
      timeZone,
      numberingSystem: DEFAULT_NUMBERING_SYSTEM,
    });
    cache.set(id, found);
  }
  return found;
}

function knownZone(zone: string): string {
  let valid = zoneValid.get(zone);
  if (valid === undefined) {
    valid = isTimeZone(zone);
    zoneValid.set(zone, valid);
  }
  return valid ? zone : DEFAULT_TIME_ZONE;
}

function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatDisplayDate(
  value: Date | string | number,
  options: DisplayDateOptions,
): string {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) throw new RangeError('formatDisplayDate: invalid date');
  const style = options.style ?? 'dateTime';
  const timeZone = knownZone(options.timeZone);
  const gregorian = () =>
    formatter(
      options.locale,
      DEFAULT_CALENDAR,
      timeZone,
      `g:${style}`,
      gregorianOptions(style),
    ).format(date);
  const hijri = (weekday: boolean, time: boolean) =>
    formatter(
      options.locale,
      HIJRI_CALENDAR,
      timeZone,
      `h:${String(weekday)}:${String(time)}`,
      hijriOptions(weekday, time),
    ).format(date);
  switch (options.display) {
    case 'gregorian':
      return gregorian();
    case 'hijri':
      return hijri(style === 'full', withTime(style));
    case 'dual':
      return `${gregorian()}${DUAL_SEPARATOR}${hijri(false, false)}`;
  }
}

/** Every date text of a page, bound to the organization's display and time zone. */
export interface DisplayDateFormatter {
  readonly date: (value: Date | string | number) => string;
  readonly dateTime: (value: Date | string | number) => string;
  readonly long: (value: Date | string | number) => string;
  readonly longDateTime: (value: Date | string | number) => string;
  readonly full: (value: Date | string | number) => string;
}

export function displayDateFormatter(
  locale: AppLocale,
  display: DateDisplay,
  timeZone: string,
): DisplayDateFormatter {
  const format = (style: DateStyle) => (value: Date | string | number) =>
    formatDisplayDate(value, { locale, display, timeZone, style });
  return {
    date: format('date'),
    dateTime: format('dateTime'),
    long: format('long'),
    longDateTime: format('longDateTime'),
    full: format('full'),
  };
}
