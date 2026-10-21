import { toClientError } from '@jadarat/platform-core';
import { routing } from '@jadarat/platform-i18n/routing';
import { DEFAULT_CHAIN, DEFAULT_REMINDER_DAYS } from '@jadarat/tms/planning-model';
import { Alert, Card, Icon } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PlanningSettingsForm } from '../../../../../components/planning/cycle-chain-forms';
import { PlanningHeader } from '../../../../../components/planning/planning-header';
import { SuiteShell } from '../../../../../components/suite-shell';
import { toDrafts } from '../../../../../lib/planning-chain';
import {
  planningErrorTexts,
  planningSettingsQuery,
  planningTexts,
} from '../../../../../lib/planning-queries';
import { PLANNING_PATHS, localName } from '../../../../../lib/planning-view';
import { getSuiteContext } from '../../../../../lib/suite-context';

/**
 * Planning → Settings (EP-PLN step A3, screen 11): the default reminder days and the default approval chain
 * every new cycle copies. The L&D Manager edits them (tms.plan_cycle.manage); the Training Coordinator
 * reads them; everyone else is refused.
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
  const cycle = await getTranslations({ locale, namespace: 'planning.cycle' });
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
          initialSteps={toDrafts(DEFAULT_CHAIN)}
          names={{}}
          inactive={{}}
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
      const inactive = Object.fromEntries(
        view.steps
          .filter((s) => s.approverPersonId && !s.approverActive && s.approverName)
          .map((s) => [
            s.approverPersonId ?? '',
            localName(locale, s.approverName ?? { ar: '', en: null }),
          ]),
      );
      content = view.canManage ? (
        <PlanningSettingsForm
          locale={locale}
          texts={texts}
          errors={errors}
          initialDays={view.settings.reminderDays}
          initialSteps={toDrafts(view.settings.steps)}
          names={Object.fromEntries(
            view.steps
              .filter((s) => s.approverPersonId && s.approverActive && s.approverName)
              .map((s) => [
                s.approverPersonId ?? '',
                localName(locale, s.approverName ?? { ar: '', en: null }),
              ]),
          )}
          inactive={inactive}
        />
      ) : (
        <ReadOnlySettings
          readOnly={t('readOnly')}
          remindersTitle={t('remindersTitle')}
          remindersIntro={setup('reminders.intro')}
          chainTitle={t('chainTitle')}
          days={view.settings.reminderDays.map((days) => setup('reminders.chip', { days }))}
          none={setup('reminders.none')}
          steps={view.steps.map((s) => {
            const name = localName(locale, { ar: s.nameAr, en: s.nameEn });
            return {
              name,
              detail:
                s.kind === 'department_heads'
                  ? setup('approvals.headsHint')
                  : s.approverName
                    ? localName(locale, s.approverName)
                    : cycle('stepUnnamed', { step: name }),
            };
          })}
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

/** The settings for the Training Coordinator (read only): the chain as a numbered list, reminder chips. */
function ReadOnlySettings(props: {
  readOnly: string;
  remindersTitle: string;
  remindersIntro: string;
  chainTitle: string;
  /** The reminders as chip texts («7 days before»). */
  days: readonly string[];
  none: string;
  steps: readonly { name: string; detail: string }[];
}) {
  return (
    <div className="flex flex-col gap-4" data-testid="planning-settings-read-only">
      <Alert tone="info">{props.readOnly}</Alert>
      <div className="grid grid-cols-1 items-start gap-4 2xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <Card title={props.chainTitle}>
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {props.steps.map((step, index) => (
              <li key={`${String(index)}-${step.name}`} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-gradient text-sm font-bold text-on-brand"
                >
                  {index + 1}
                </span>
                <span className="flex min-w-0 flex-col rounded-2xl border border-border px-4 py-2.5">
                  <b>{step.name}</b>
                  <span className="text-sm text-text-muted">{step.detail}</span>
                </span>
              </li>
            ))}
          </ol>
        </Card>
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
    </div>
  );
}
