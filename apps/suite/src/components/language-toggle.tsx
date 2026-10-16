import { type AppLocale, otherLocale } from '@jadarat/platform-i18n';
import { Icon, cn } from '@jadarat/ui';
import { getTranslations } from 'next-intl/server';

/**
 * Switches the UI language, keeping the current path. `path` is locale-less, e.g. "/suite". In the suite
 * top bar (`topBar`) it is Kawadir's globe icon button (36 px; 44 px on touch screens): its accessible
 * name says what it does («Switch to Arabic»), the tooltip shows the target language's name.
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
      title={topBar ? t('switchLanguage') : undefined}
      className={cn(
        'inline-flex items-center gap-2 text-sm font-medium text-text-muted no-underline hover:bg-surface-hover hover:text-text',
        topBar
          ? 'size-9 shrink-0 justify-center rounded-xl pointer-coarse:size-11'
          : 'min-h-11 rounded-md px-3',
      )}
      data-testid="language-toggle"
    >
      <Icon name="globe" className={topBar ? 'size-5' : undefined} />
      {topBar ? null : t('switchLanguage')}
    </a>
  );
}
