import { type AppLocale, otherLocale } from '@jadarat/platform-i18n';
import { Icon, cn } from '@jadarat/ui';
import { getTranslations } from 'next-intl/server';

/**
 * Switches the UI language, keeping the current path. `path` is locale-less, e.g. "/suite". In the suite
 * top bar (`topBar`) it takes the Kawadir icon-button look (globe, 36 px; 44 px on touch screens) and
 * keeps the target language's name as its visible text.
 */
export async function LanguageToggle({
  locale,
  path,
  topBar = false,
}: {
  locale: AppLocale;
  path: string;
  topBar?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'common' });
  const target = otherLocale(locale);
  return (
    <a
      href={`/${target}${path === '/' ? '' : path}`}
      hrefLang={target}
      lang={target}
      aria-label={t('switchLanguageAria')}
      className={cn(
        'inline-flex items-center gap-2 text-sm font-medium text-text-muted no-underline hover:bg-surface-hover hover:text-text',
        topBar ? 'min-h-9 rounded-xl px-2.5 pointer-coarse:min-h-11' : 'min-h-11 rounded-md px-3',
      )}
      data-testid="language-toggle"
    >
      <Icon name="globe" className={topBar ? 'size-5' : undefined} />
      {topBar ? (
        <span className="hidden md:inline">{t('switchLanguage')}</span>
      ) : (
        t('switchLanguage')
      )}
    </a>
  );
}
