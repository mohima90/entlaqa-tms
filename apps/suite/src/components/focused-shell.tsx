import type { AppLocale } from '@jadarat/platform-i18n';
import { Icon, Toaster } from '@jadarat/ui';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import type { SuiteContext } from '../lib/suite-context';
import { BrandStyle } from './branding/brand-style';
import { IdleWarning } from './idle-warning';
import { LanguageToggle } from './language-toggle';

/**
 * A focused full-screen frame for a task with steps (redesign package 3 — Remote's full-screen flows): no
 * side menu, a white top bar with «✕» back to where the task started, the task's name and what it works on,
 * the step bar in the middle and the language switch; the page's own actions sit in a bar at the bottom of
 * its content. Used by the user import (T-M2-12). The organization's colours, the toasts and the idle
 * warning work as in the suite frame.
 */
export async function FocusedShell({
  locale,
  context,
  path,
  closeHref,
  title,
  subtitle,
  steps,
  children,
}: {
  readonly locale: AppLocale;
  readonly context: SuiteContext;
  /** The locale-less path of the page (for the language switch). */
  readonly path: string;
  /** «✕»: where the task started (Team members). */
  readonly closeHref: string;
  readonly title: string;
  readonly subtitle?: ReactNode;
  readonly steps?: ReactNode;
  readonly children: ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: 'shell' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-text">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[2000] focus:rounded-full focus:bg-surface focus:px-4 focus:py-2"
      >
        {common('skipToContent')}
      </a>
      <BrandStyle colors={context.brand} />
      <header className="sticky top-0 z-30 border-b border-border bg-surface">
        <div className="flex min-h-18 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 md:px-6">
          <a
            href={closeHref}
            aria-label={t('close')}
            className="grid size-11 shrink-0 place-items-center rounded-full border border-border text-text-muted no-underline hover:bg-surface-hover hover:text-text"
            data-testid="focused-close"
          >
            <Icon name="close" />
          </a>
          <div className="flex min-w-0 flex-1 flex-col md:flex-none">
            <span className="truncate font-bold">{title}</span>
            {subtitle ? <span className="truncate text-sm text-text-muted">{subtitle}</span> : null}
          </div>
          <div className="order-last w-full md:order-none md:flex md:flex-1 md:justify-center">
            {steps}
          </div>
          <LanguageToggle locale={locale} path={path} topBar />
        </div>
      </header>
      <main id="main" tabIndex={-1} className="flex flex-1 flex-col outline-none">
        <div className="mx-auto flex w-full max-w-[1100px] flex-1 flex-col gap-6 px-4 py-7 md:px-6">
          {children}
        </div>
      </main>
      <Toaster label={t('statusMessages')} closeLabel={t('close')} />
      {context.live && context.idleMinutes !== null ? (
        <IdleWarning
          locale={locale}
          idleMinutes={context.idleMinutes}
          texts={{
            title: t('idleTitle'),
            text: t('idleText'),
            stay: t('idleContinue'),
            signOut: t('idleSignOut'),
          }}
        />
      ) : null}
    </div>
  );
}

export { FocusedActions } from './focused-actions';
