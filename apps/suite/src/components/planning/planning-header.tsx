import type { AppLocale } from '@jadarat/platform-i18n';
import { PageHeader } from '@jadarat/ui';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { PLANNING_PATHS, type SetupStep, SETUP_STEPS, cycleHref } from '../../lib/planning-view';

/** Page header of the planning pages with the breadcrumb Planning / Planning cycles / <page>. */
export async function PlanningHeader({
  locale,
  title,
  description,
  actions,
  withCycles = true,
}: {
  locale: AppLocale;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** The breadcrumb links back to the cycles list (not on the list itself). */
  withCycles?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'planning' });
  return (
    <PageHeader
      eyebrow={
        <nav aria-label={t('breadcrumb.label')}>
          <ol className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            <li>{t('breadcrumb.planning')}</li>
            <li aria-hidden="true">/</li>
            {withCycles ? (
              <>
                <li>
                  <a href={`/${locale}${PLANNING_PATHS.cycles}`}>{t('breadcrumb.cycles')}</a>
                </li>
                <li aria-hidden="true">/</li>
              </>
            ) : null}
            <li aria-current="page">{title}</li>
          </ol>
        </nav>
      }
      title={title}
      description={description}
      actions={actions}
    />
  );
}

/**
 * The set-up steps of a draft (business flow B4) as links (every step can be opened; the current one is
 * marked `aria-current="step"`); on phones one line «Step 2 of 5 · Scope».
 */
export async function SetupStepper({
  locale,
  cycleId,
  current,
}: {
  locale: AppLocale;
  cycleId: string;
  current: SetupStep;
}) {
  const t = await getTranslations({ locale, namespace: 'planning.setup' });
  const index = SETUP_STEPS.indexOf(current);
  return (
    <nav aria-label={t('stepsLabel')} className="mb-6" data-testid="setup-stepper">
      <p className="m-0 font-medium sm:hidden">
        {t('stepShort', {
          current: index + 1,
          total: SETUP_STEPS.length,
          name: t(`steps.${current}`),
        })}
      </p>
      <ol className="m-0 hidden list-none flex-wrap gap-2 p-0 sm:flex">
        {SETUP_STEPS.map((step, i) => {
          const isCurrent = step === current;
          return (
            <li key={step}>
              <a
                href={cycleHref(locale, cycleId, step)}
                aria-current={isCurrent ? 'step' : undefined}
                className={`flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm no-underline ${
                  isCurrent
                    ? 'border-primary bg-surface-selected font-semibold text-primary-text'
                    : 'border-border text-text hover:bg-surface-hover'
                }`}
                data-testid={`setup-step-${step}`}
              >
                <span
                  aria-hidden="true"
                  className="flex size-6 items-center justify-center rounded-full border border-current text-xs"
                >
                  {String(i + 1)}
                </span>
                <span>{t(`steps.${step}`)}</span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
