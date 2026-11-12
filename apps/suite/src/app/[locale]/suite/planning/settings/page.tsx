import { toClientError } from '@jadarat/platform-core';
import { routing } from '@jadarat/platform-i18n/routing';
import { DEFAULT_REMINDER_DAYS } from '@jadarat/tms/planning-model';
import { Alert, Card, Icon } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PlanningSettingsForm } from '../../../../../components/planning/planning-settings-form';
import { PlanningHeader } from '../../../../../components/planning/planning-header';
import { SuiteShell } from '../../../../../components/suite-shell';
import {
  planningErrorTexts,
  planningSettingsQuery,
  planningTexts,
} from '../../../../../lib/planning-queries';
import { PLANNING_PATHS } from '../../../../../lib/planning-view';
import { getSuiteContext } from '../../../../../lib/suite-context';

/**
 * Planning → Settings (EP-PLN step A3, screen 11): the default reminder days every new cycle starts with.
 * The L&D Manager edits them (tms.plan_cycle.manage); the Training Coordinator reads them; everyone else is
 * refused. The default approval chain left this page (EP-PLN §13; PO, 12 Nov 2026): approval is by role and
 * the same for every cycle.
 */
export default async function PlanningSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'planning.settings' });
  const setup = await getTranslations({ locale, namespace: 'planning.setup' });
  const texts = planningTexts(locale);
  const errors = await planningErrorTexts(locale);

  let content: ReactNode;
  if (!context.live) {
    content = (
      <>
        <Alert tone="info" data-testid="planning-not-configured">
          {t('notConfigured')}
        </Alert>
        <PlanningSettingsForm
          locale={locale}
          texts={texts}
          errors={errors}
          initialDays={DEFAULT_REMINDER_DAYS}
        />
      </>
    );
  } else {
    const result = await planningSettingsQuery({});
    if (!result.ok) {
      const error = toClientError(result.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      const messages = await getTranslations({ locale, namespace: 'errors' });
      content =
        error.code === 'FORBIDDEN' ? (
          <Alert tone="warning" data-testid="planning-forbidden">
            {messages('forbidden')}
          </Alert>
        ) : (
          <Alert tone="danger">
            {messages('internalError', { correlationId: error.correlationId ?? '' })}
          </Alert>
        );
    } else {
      const view = result.value;
      content = view.canManage ? (
        <PlanningSettingsForm
          locale={locale}
          texts={texts}
          errors={errors}
          initialDays={view.reminderDays}
        />
      ) : (
        <ReadOnlySettings
          readOnly={t('readOnly')}
          remindersTitle={t('remindersTitle')}
          remindersIntro={setup('reminders.intro')}
          days={view.reminderDays.map((days) => setup('reminders.chip', { days }))}
          none={setup('reminders.none')}
        />
      );
    }
  }

  return (
    <SuiteShell
      locale={locale}
      context={context}
      current="planningSettings"
      path={PLANNING_PATHS.settings}
    >
      <PlanningHeader
        locale={locale}
        title={t('title')}
        description={t('intro')}
        withCycles={false}
      />
      <div className="flex flex-col gap-6">{content}</div>
    </SuiteShell>
  );
}

/** The settings for the Training Coordinator (read only): the default reminders as chips. */
function ReadOnlySettings(props: {
  readOnly: string;
  remindersTitle: string;
  remindersIntro: string;
  /** The reminders as chip texts («7 days before»). */
  days: readonly string[];
  none: string;
}) {
  return (
    <div className="flex flex-col gap-4" data-testid="planning-settings-read-only">
      <Alert tone="info">{props.readOnly}</Alert>
      <Card title={props.remindersTitle} description={props.remindersIntro}>
        {props.days.length > 0 ? (
          <ul className="m-0 flex list-none flex-wrap gap-2.5 p-0">
            {props.days.map((day) => (
              <li
                key={day}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-primary/30 bg-primary-subtle px-3.5 font-semibold text-primary-text"
              >
                <Icon name="bell" className="size-3.5" />
                {day}
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-text-muted">{props.none}</p>
        )}
      </Card>
    </div>
  );
}
