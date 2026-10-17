import { toClientError } from '@jadarat/platform-core';
import { routing } from '@jadarat/platform-i18n/routing';
import { DEFAULT_CHAIN, DEFAULT_REMINDER_DAYS } from '@jadarat/tms/planning-model';
import { Alert } from '@jadarat/ui';
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
          chainTitle={t('chainTitle')}
          days={view.settings.reminderDays}
          steps={view.steps.map((s) => ({
            name: localName(locale, { ar: s.nameAr, en: s.nameEn }),
            approver: s.approverName ? localName(locale, s.approverName) : null,
          }))}
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

function ReadOnlySettings(props: {
  readOnly: string;
  remindersTitle: string;
  chainTitle: string;
  days: readonly number[];
  steps: readonly { name: string; approver: string | null }[];
}) {
  return (
    <div className="flex flex-col gap-4" data-testid="planning-settings-read-only">
      <Alert tone="info">{props.readOnly}</Alert>
      <section className="rounded-2xl border border-border bg-surface p-5 shadow-1">
        <h2 className="m-0 mb-2 text-base font-semibold">{props.remindersTitle}</h2>
        <p className="m-0">{props.days.join(' · ') || '—'}</p>
      </section>
      <section className="rounded-2xl border border-border bg-surface p-5 shadow-1">
        <h2 className="m-0 mb-2 text-base font-semibold">{props.chainTitle}</h2>
        <ol className="m-0 flex flex-col gap-1 ps-6">
          {props.steps.map((step, index) => (
            <li key={`${String(index)}-${step.name}`}>
              {step.name}
              {step.approver ? ` — ${step.approver}` : ''}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
