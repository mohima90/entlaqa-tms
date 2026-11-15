import type { AppLocale, DateDisplay } from '@jadarat/platform-i18n';

/**
 * Months of draft sessions (`YYYY-MM`, WP-LD-04; FR-SCH-07) as the organization shows dates: Gregorian
 * («January 2027»), Hijri (the Hijri months the Gregorian month spans, «Rajab – Shaban 1448 AH») or both. Pure and
 * client-safe (Intl only, Western digits — ADR 0007 §1); a month is read at midnight UTC, it has no time zone.
 *
 *   long   January 2027                   (the month's heading, the Month field's choices)
 *   name   January                        (the month column of a quarter, which names the year above)
 *   short  Jan                            (a line's draft months: «Jan · Feb · Mar»)
 */
export type MonthStyle = 'long' | 'name' | 'short';

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const cache = new Map<string, Intl.DateTimeFormat>();

function format(locale: AppLocale, calendar: string, options: Intl.DateTimeFormatOptions) {
  const key = `${locale}|${calendar}|${JSON.stringify(options)}`;
  let found = cache.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(`${locale}-u-nu-latn`, {
      ...options,
      calendar,
      timeZone: 'UTC',
    });
    cache.set(key, found);
  }
  return found;
}

const GREGORIAN: Record<MonthStyle, Intl.DateTimeFormatOptions> = {
  long: { month: 'long', year: 'numeric' },
  name: { month: 'long' },
  short: { month: 'short' },
};

/** The Hijri months a Gregorian month spans: its first and its last day. */
function hijri(locale: AppLocale, first: Date, last: Date, style: MonthStyle): string {
  const name = format(locale, 'islamic-umalqura', { month: style === 'short' ? 'short' : 'long' });
  const withYear = format(locale, 'islamic-umalqura', { month: 'long', year: 'numeric' });
  const year = format(locale, 'islamic-umalqura', { year: 'numeric' });
  if (style !== 'long') return `${name.format(first)} – ${name.format(last)}`;
  return year.format(first) === year.format(last)
    ? `${name.format(first)} – ${withYear.format(last)}`
    : `${withYear.format(first)} – ${withYear.format(last)}`;
}

export function formatMonth(
  month: string,
  locale: AppLocale,
  display: DateDisplay,
  style: MonthStyle = 'long',
): string {
  const match = MONTH_RE.exec(month);
  if (!match) return month;
  const year = Number(match[1]);
  const index = Number(match[2]) - 1;
  const first = new Date(Date.UTC(year, index, 1));
  const last = new Date(Date.UTC(year, index + 1, 0));
  const gregorian = format(locale, 'gregory', GREGORIAN[style]).format(first);
  if (display === 'gregorian') return gregorian;
  if (display === 'hijri') return hijri(locale, first, last, style);
  // Both: the Gregorian month, then the Hijri months it spans (the long form only; short forms stay Gregorian).
  return style === 'long' ? `${gregorian} · ${hijri(locale, first, last, style)}` : gregorian;
}

/** A month formatter bound to the organization's display. */
export function monthFormatter(locale: AppLocale, display: DateDisplay) {
  return (month: string, style: MonthStyle = 'long') => formatMonth(month, locale, display, style);
}

/** Every month from the month of `start` to the month of `end` (`YYYY-MM-DD` or `YYYY-MM`), in order. */
export function monthsBetween(start: string, end: string): string[] {
  const from = MONTH_RE.exec(start.slice(0, 7));
  const to = MONTH_RE.exec(end.slice(0, 7));
  if (!from || !to) return [];
  const first = Number(from[1]) * 12 + Number(from[2]) - 1;
  const last = Number(to[1]) * 12 + Number(to[2]) - 1;
  const months: string[] = [];
  for (let i = first; i <= last && months.length < 120; i += 1) {
    months.push(`${String(Math.floor(i / 12))}-${String((i % 12) + 1).padStart(2, '0')}`);
  }
  return months;
}
