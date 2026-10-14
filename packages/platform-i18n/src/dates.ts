import { DEFAULT_CALENDAR, DEFAULT_NUMBERING_SYSTEM } from './formats';
import type { AppLocale } from './locales';
import { DEFAULT_TIME_ZONE, type DateDisplay, isTimeZone } from './regional';

/**
 * The one formatter of instants for display (FR-SCH-07, ADR 0007 §6; T-M2-22): Gregorian, Hijri
 * (Umm al-Qura) or both, in the organization's time zone, with Western digits pinned (ADR 0007 §1/§5).
 * Pure: the same input gives the same text on the server and in the browser (given the same ICU data).
 *
 *   style `date`      Oct 14, 2026            · Jumada I 3, 1448 AH
 *   style `dateTime`  Oct 14, 2026, 2:05 PM   · Jumada I 3, 1448 AH, 2:05 PM
 *   style `full`      Wednesday, October 14, 2026 (the date preview of the profile page)
 *
 * `dual` shows the Gregorian text first and the Hijri date after « · » (the time once). Date-only values
 * (hire dates) keep using formatHijriDate, which reads them as calendar days without a time zone.
 */
export type DateStyle = 'date' | 'dateTime' | 'full';

export interface DisplayDateOptions {
  readonly locale: AppLocale;
  readonly display: DateDisplay;
  /** IANA zone; an unknown zone falls back to the platform default rather than failing the page. */
  readonly timeZone: string;
  readonly style?: DateStyle;
}

export const DUAL_SEPARATOR = ' · ';

const HIJRI_CALENDAR = 'islamic-umalqura';

function gregorianOptions(style: DateStyle): Intl.DateTimeFormatOptions {
  switch (style) {
    case 'date':
      return { dateStyle: 'medium' };
    case 'dateTime':
      return { dateStyle: 'medium', timeStyle: 'short' };
    case 'full':
      return { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  }
}

function hijriOptions(style: DateStyle, withTime: boolean): Intl.DateTimeFormatOptions {
  return {
    ...(style === 'full' ? { weekday: 'long' } : {}),
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  };
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
  const timeZone = isTimeZone(options.timeZone) ? options.timeZone : DEFAULT_TIME_ZONE;
  const common = { timeZone, numberingSystem: DEFAULT_NUMBERING_SYSTEM } as const;
  const gregorian = () =>
    new Intl.DateTimeFormat(options.locale, {
      ...common,
      calendar: DEFAULT_CALENDAR,
      ...gregorianOptions(style),
    }).format(date);
  const hijri = (withTime: boolean, weekday: boolean) =>
    new Intl.DateTimeFormat(options.locale, {
      ...common,
      calendar: HIJRI_CALENDAR,
      ...hijriOptions(weekday ? style : 'date', withTime),
    }).format(date);
  switch (options.display) {
    case 'gregorian':
      return gregorian();
    case 'hijri':
      return hijri(style === 'dateTime', style === 'full');
    case 'dual':
      // The weekday and the time once, in the Gregorian part.
      return `${gregorian()}${DUAL_SEPARATOR}${hijri(false, false)}`;
  }
}

/** Every date text of a page, bound to the organization's display and time zone. */
export interface DisplayDateFormatter {
  readonly date: (value: Date | string | number) => string;
  readonly dateTime: (value: Date | string | number) => string;
  readonly full: (value: Date | string | number) => string;
}

export function displayDateFormatter(
  locale: AppLocale,
  display: DateDisplay,
  timeZone: string,
): DisplayDateFormatter {
  const format = (style: DateStyle) => (value: Date | string | number) =>
    formatDisplayDate(value, { locale, display, timeZone, style });
  return { date: format('date'), dateTime: format('dateTime'), full: format('full') };
}
