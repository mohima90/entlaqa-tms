import { type AppLocale, otherLocale } from '@jadarat/platform-i18n';
import { buttonClasses } from '@jadarat/ui';
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
      className={buttonClasses({ variant: 'secondary', size: 'sm' })}
      data-testid="language-toggle"
    >
      {t('switchLanguage')}
    </a>
  );
}
