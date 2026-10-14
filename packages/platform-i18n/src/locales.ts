/**
 * Supported locales. English is the default for now (PO decision, 14 Oct 2026; CLAUDE.md "Arabic-first
 * → English default for now"); Arabic stays fully supported with the same features at `/ar/...`.
 */
export const locales = ['ar', 'en'] as const;
export type AppLocale = (typeof locales)[number];
export const defaultLocale: AppLocale = 'en';

export type Direction = 'rtl' | 'ltr';

export function isLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

export function getDirection(locale: AppLocale): Direction {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

export function otherLocale(locale: AppLocale): AppLocale {
  return locale === 'ar' ? 'en' : 'ar';
}
