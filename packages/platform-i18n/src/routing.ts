import { defineRouting } from 'next-intl/routing';
import { defaultLocale, locales } from './locales';

/**
 * Locale-prefixed routes: `/ar/...` (default) and `/en/...`. No Accept-Language detection and no
 * locale cookie: `/` always lands in Arabic; users switch explicitly (tenant/user preference later).
 */
export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: 'always',
  localeDetection: false,
  localeCookie: false,
});
