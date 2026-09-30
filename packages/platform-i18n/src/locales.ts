/** Supported locales. Arabic is the product default (CLAUDE.md non-negotiable: Arabic-first). */
export const locales = ['ar', 'en'] as const;
export type AppLocale = (typeof locales)[number];
export const defaultLocale: AppLocale = 'ar';

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
