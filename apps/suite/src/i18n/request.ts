import { formats, getMessages } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { locale as rootLocale } from 'next/root-params';

export default getRequestConfig(async ({ locale: explicitLocale }) => {
  // An explicit locale (getTranslations({ locale })) wins; otherwise the [locale] root segment.
  const requested = explicitLocale ?? (await rootLocale());
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return {
    locale,
    messages: getMessages(locale),
    // ADR 0007 §1/§5: explicit numberingSystem ('latn') and calendar ('gregory') on every named format;
    // never the runtime's default for `ar` (differs between CLDR versions and regional variants).
    // Use `format.dateTime(d, 'medium')` / `format.number(n, 'decimal')` and named formats in messages.
    formats,
    // TODO(ADR 0007): tenant/user time zone, digits (NFR-L10N-03) and Hijri/Gregorian preferences.
    timeZone: 'Asia/Riyadh',
  };
});
