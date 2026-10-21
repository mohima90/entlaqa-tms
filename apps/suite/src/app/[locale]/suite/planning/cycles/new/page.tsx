import { toClientError } from '@jadarat/platform-core';
import { routing } from '@jadarat/platform-i18n/routing';
import { dayInZone, defaultDeadline, defaultPeriod } from '@jadarat/tms/planning-model';
import { Alert, StepList } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { CycleBasicsForm } from '../../../../../../components/planning/cycle-basics-form';
import { PlanningHeader } from '../../../../../../components/planning/planning-header';
import { SuiteShell } from '../../../../../../components/suite-shell';
import {
  newPlanCycleQuery,
  planningErrorTexts,
  planningTexts,
} from '../../../../../../lib/planning-queries';
import {
  OPTIONAL_STEPS,
  PLANNING_PATHS,
  SETUP_STEPS,
  localName,
} from '../../../../../../lib/planning-view';
import { getSuiteContext } from '../../../../../../lib/suite-context';

/**
 * New planning cycle (EP-PLN B4, step 1 «Basics»): the L&D Manager (tms.plan_cycle.manage) names the
 * cycle; the period starts as the next fiscal year and the deadline 30 days ahead. Saving creates a draft
 * with the organization's default reminders and approval chain, then the set-up continues with the scope.
 */
export default async function NewPlanCyclePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'planning' });
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const cyclesHref = `/${locale}${PLANNING_PATHS.cycles}`;
  const texts = planningTexts(locale);
  const errors = await planningErrorTexts(locale);

  let content: ReactNode;
  const form = (
    defaults: { periodStart: string; periodEnd: string; deadline: string },
    currency: string,
    needsForms: readonly {
      id: string;
      name: { ar: string; en: string | null };
      isDefault: boolean;
      active: boolean;
    }[],
  ) => (
    <CycleBasicsForm
      locale={locale}
      editing={null}
      initial={{
        nameAr: '',
        nameEn: '',
        ...defaults,
        instructionsAr: '',
        instructionsEn: '',
        // The organization's default form is preselected (T-M3-10); the launch locks the chosen form.
        needsFormId: needsForms.find((f) => f.isDefault)?.id ?? '',
      }}
      needsForms={needsForms.map((f) => ({
        id: f.id,
        name: localName(locale, f.name),
        active: f.active,
      }))}
      currency={currency}
      texts={texts}
      errors={errors}
      cancelHref={cyclesHref}
      display={context.regional.dateDisplay}
      needsFormsLabel={shell('needsForms')}
    />
  );
  // The whole journey is visible from the start (redesign package 4): only Basics is reachable until the
  // draft exists.
  const stepper = (
    <StepList
      label={t('setup.stepsLabel')}
      current="basics"
      short={t('setup.stepShort', {
        current: 1,
        total: SETUP_STEPS.length,
        name: t('setup.steps.basics'),
      })}
      items={SETUP_STEPS.map((key) => ({
        key,
        label: t(`setup.steps.${key}`),
        href: key === 'basics' ? `/${locale}${PLANNING_PATHS.newCycle}` : undefined,
        state: key === 'basics' ? 'todo' : 'locked',
        note: OPTIONAL_STEPS.includes(key) ? t('setup.optional').replace(/[()]/g, '') : undefined,
        icon: key === 'review' ? 'flag' : undefined,
      }))}
      data-testid="setup-stepper"
    />
  );
  const surface = (body: ReactNode) => (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[252px_minmax(0,1fr)] lg:gap-7">
      {stepper}
      <div className="flex min-w-0 flex-col gap-4">{body}</div>
    </div>
  );
  if (!context.live) {
    // Preview without data: the form with the platform defaults (saving needs the database).
    const today = dayInZone(new Date(), context.regional.timeZone);
    const period = defaultPeriod(today, 1);
    content = (
      <>
        <Alert tone="info" data-testid="planning-not-configured">
          {t('list.notConfigured')}
        </Alert>
        {surface(
          form(
            {
              periodStart: period.start,
              periodEnd: period.end,
              deadline: defaultDeadline(today, period.end),
            },
            'SAR',
            [],
          ),
        )}
      </>
    );
  } else {
    const result = await newPlanCycleQuery({});
    if (!result.ok) {
      const error = toClientError(result.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      if (error.code === 'FORBIDDEN') {
        const messages = await getTranslations({ locale, namespace: 'errors' });
        content = (
          <Alert tone="warning" data-testid="planning-forbidden">
            {messages('forbidden')}
          </Alert>
        );
      } else {
        content = surface(
          <Alert tone="danger">
            {t('list.loadFailed', { correlationId: error.correlationId ?? '' })}
          </Alert>,
        );
      }
    } else {
      content = surface(
        form(result.value.defaults, result.value.currency, result.value.needsForms),
      );
    }
  }

  return (
    <SuiteShell
      locale={locale}
      context={context}
      current="planningCycles"
      path={PLANNING_PATHS.newCycle}
    >
      <PlanningHeader locale={locale} title={t('new.title')} description={t('new.intro')} />
      <div className="flex flex-col gap-6">{content}</div>
    </SuiteShell>
  );
}
