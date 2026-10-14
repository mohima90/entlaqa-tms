import { type AppLocale, otherLocale } from '@jadarat/platform-i18n';
import { Icon } from '@jadarat/ui';
import { getTranslations } from 'next-intl/server';

/** Switches the UI language, keeping the current path. `path` is locale-less, e.g. "/suite". */
export async function LanguageToggle({ locale, path }: { locale: AppLocale; path: string }) {
  const t = await getTranslations({ locale, namespace: 'common' });
  const target = otherLocale(locale);
  return (
    <a
      href={`/${target}${path === '/' ? '' : path}`}
      hrefLang={target}
      lang={target}
      aria-label={t('switchLanguageAria')}
      className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium text-text-muted no-underline hover:bg-surface-hover hover:text-text"
      data-testid="language-toggle"
    >
      <Icon name="globe" />
      {t('switchLanguage')}
    </a>
  );
}
