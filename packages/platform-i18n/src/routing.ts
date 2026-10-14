import { defineRouting } from 'next-intl/routing';
import { defaultLocale, locales } from './locales';

/**
 * Locale-prefixed routes: `/en/...` (default, PO 14 Oct 2026) and `/ar/...`. No Accept-Language
 * detection and no locale cookie: `/` always lands in English; users switch explicitly (tenant/user
 * preference later).
 */
export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: 'always',
  localeDetection: false,
  localeCookie: false,
});
