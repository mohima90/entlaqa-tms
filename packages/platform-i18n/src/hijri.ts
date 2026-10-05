import type { AppLocale } from './locales';

/**
 * Hijri (Umm al-Qura) display of a date (ADR 0007 §6: formatting with `islamic-umalqura`; Western
 * digits pinned like every other format). Date-only values (`YYYY-MM-DD`, Gregorian in storage) are
 * read as UTC midnight so the day never shifts with the server's time zone.
 * Conversion tables for Hijri input (date pickers, holidays) are a separate, later piece.
 */
export function formatHijriDate(value: Date | string, locale: AppLocale): string {
  const date = typeof value === 'string' ? new Date(`${value}T00:00:00Z`) : value;
  return new Intl.DateTimeFormat(`${locale}-u-ca-islamic-umalqura-nu-latn`, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}
