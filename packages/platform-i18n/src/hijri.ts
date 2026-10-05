import type { AppLocale } from './locales';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Hijri (Umm al-Qura) display of a calendar date (ADR 0007 §6: formatting with `islamic-umalqura`;
 * Western digits pinned like every other format). Takes date-only values (`YYYY-MM-DD`, Gregorian in
 * storage), read as UTC midnight, so the Hijri day always matches the Gregorian date shown next to it.
 * Instants (timestamps) need the viewer's time zone first — not supported here on purpose.
 * Conversion tables for Hijri input (date pickers, holidays) are a separate, later piece.
 */
export function formatHijriDate(value: string, locale: AppLocale): string {
  if (!DATE_ONLY.test(value)) throw new RangeError('formatHijriDate expects YYYY-MM-DD');
  const date = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat(`${locale}-u-ca-islamic-umalqura-nu-latn`, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}
