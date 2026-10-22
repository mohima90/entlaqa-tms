import type { AppLocale, DateDisplay } from '@jadarat/platform-i18n';
import { displayDateFormatter } from '@jadarat/platform-i18n/dates';

/** Formatting of the planning pages (EP-PLN, T-M3-04): days and amounts — server and client (no catalogs). */

/**
 * A calendar day (YYYY-MM-DD) as the organization shows dates (Gregorian, Hijri or both — FR-SCH-07). Read
 * at midnight UTC and formatted in UTC: a calendar day has no time zone to shift it.
 */
export function dayFormatter(locale: AppLocale, display: DateDisplay): (day: string) => string {
  const formatter = displayDateFormatter(locale, display, 'UTC');
  return (day) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
    return formatter.date(`${day}T00:00:00Z`);
  };
}

/** An amount in the organization's currency (BR-PLN-i), Western digits (ADR 0007 §1). */
export function formatAmount(locale: AppLocale, amount: string | number, currency: string): string {
  const value = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(value)) return String(amount);
  try {
    return new Intl.NumberFormat(`${locale}-u-nu-latn`, {
      style: 'currency',
      currency,
      maximumFractionDigits: 3,
    }).format(value);
  } catch {
    return `${String(value)} ${currency}`;
  }
}
