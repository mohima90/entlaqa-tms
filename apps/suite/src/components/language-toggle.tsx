import { type AppLocale, otherLocale } from '@jadarat/platform-i18n';
import { Icon, cn } from '@jadarat/ui';
import { getTranslations } from 'next-intl/server';

/**
 * Switches the UI language, keeping the current path. `path` is locale-less, e.g. "/suite". Direction C
 * (redesign package 1): a labelled pill — the globe and the other language's name in that language
 * («العربية» / «English») — in the top bar (`topBar`: outlined, 44 px) and on the focused pages. Its
 * visible text is its name (WCAG 2.5.3), marked with its language.
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
      className={cn(
        'inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-border bg-surface text-[14.5px] font-medium text-text no-underline hover:bg-surface-hover',
        topBar ? 'min-h-10 px-2.5 md:min-h-11 md:px-4' : 'px-3 sm:px-4',
      )}
      data-testid="language-toggle"
    >
      <Icon name="globe" className="size-[18px] text-text-muted" />
      {t('switchLanguage')}
    </a>
  );
}
