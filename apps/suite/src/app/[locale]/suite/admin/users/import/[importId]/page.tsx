import { toClientError } from '@jadarat/platform-core';
import type { AppLocale, DisplayDateFormatter } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import { type UserImportView, userImportVersion } from '@jadarat/platform-import';
import { Alert, Card, buttonClasses } from '@jadarat/ui';
import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { NotInPlan } from '../../../../../../../components/plan/not-in-plan';
import { FocusedShell } from '../../../../../../../components/focused-shell';
import { ImportPoller } from '../../../../../../../components/user-import/import-poller';
import {
  importForbidden,
  stepperProps,
} from '../../../../../../../components/user-import/page-parts';
import { Stepper } from '../../../../../../../components/user-import/stepper';
import {
  confirmStep,
  fileState,
  mappingStep,
  progressView,
  resultView,
  reviewStep,
} from '../../../../../../../components/user-import/steps';
import { getSuiteContext } from '../../../../../../../lib/suite-context';
import { pageDates } from '../../../../../../../lib/page-dates';
import { userImportQuery } from '../../../../../../../lib/user-import-queries';
import {
  IMPORT_STEPS,
  draftStep,
  isDraft,
  isRunning,
  refreshSeconds,
} from '../../../../../../../lib/user-import-view';

type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: 'userImport' });
  const raw = (await searchParams).step;
  const step = (IMPORT_STEPS as readonly string[]).find(
    (s) => s === (Array.isArray(raw) ? raw[0] : raw),
  );
  // The page title names the step (design README §13); the import's own state is read by the page.
  return {
    title: step ? t('steps.pageTitle', { name: t(`steps.${step as 'file'}`) }) : t('title'),
  };
}

/**
 * One bulk user import (T-M2-12, FR-IAM-04; approved screens 4–13): the step its status calls for —
 * the scan and the reading, the mapping, the review (dry run), the options and the confirmation, the
 * progress of the run, the result with the error report and the undo — and the other states (refused
 * file, cancelled, expired). While the worker works the page polls a passive status read and refreshes
 * itself when something changed (integration review L1: never keeping an idle session alive). Only the importer follows
 * the steps before the run (the file holds employees' data); other user managers see the progress and
 * the result's counts.
 */
export default async function UserImportStatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; importId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale, importId } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'userImport' });
  const users = await getTranslations({ locale, namespace: 'users' });
  const query = await searchParams;
  const path = `/suite/admin/users/import/${encodeURIComponent(importId)}`;

  let body: ReactNode;
  let steps: ReactNode = null;
  let subtitle: ReactNode = context.organizationName ?? null;
  let poll: {
    seconds: number;
    statusUrl: string;
    version: string;
    announcement: string;
  } | null = null;
  if (!context.live) {
    body = (
      <Alert tone="info" data-testid="users-not-configured">
        {users('notConfigured')}
      </Alert>
    );
  } else if (!context.navigation.bulkImport) {
    // Not in the organization's plan (WP-ADM-06): nothing to show or change.
    body = <NotInPlan locale={locale} />;
  } else {
    const result = await userImportQuery({ importId });
    if (!result.ok) {
      const error = toClientError(result.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      if (error.code === 'NOT_FOUND' || error.code === 'VALIDATION_FAILED') notFound();
      body =
        error.code === 'FORBIDDEN' ? (
          await importForbidden(locale)
        ) : (
          <Alert tone="danger">
            {t('loadFailed', { correlationId: error.correlationId ?? '' })}
          </Alert>
        );
    } else {
      const view = result.value;
      // The file's name only to whoever may see the import (another member's draft is «not yours»).
      if (view.record.mine || !isDraft(view.record.status)) {
        subtitle = <bdi>{view.record.fileName}</bdi>;
      }
      if (isDraft(view.record.status) && view.record.mine) {
        steps = (
          <Stepper
            {...await stepperProps(locale, draftStep(view.record.status, one(query, 'step')))}
          />
        );
      }
      body = await content(
        locale,
        view,
        query,
        context.organizationName ?? '',
        pageDates(locale, context),
      );
      const seconds = refreshSeconds(view.record.status, view.record.fileStatus);
      if (seconds !== null && (view.record.mine || !isDraft(view.record.status))) {
        poll = {
          seconds,
          statusUrl: `/${locale}/suite/admin/users/import/${view.record.id}/status`,
          version: userImportVersion(view.record),
          announcement: await announcement(locale, view),
        };
      }
    }
  }

  return (
    <FocusedShell
      locale={locale}
      context={context}
      path={path}
      closeHref={`/${locale}/suite/admin/users`}
      title={t('title')}
      subtitle={subtitle}
      steps={steps}
    >
      {body}
      {poll ? (
        <ImportPoller
          seconds={poll.seconds}
          statusUrl={poll.statusUrl}
          version={poll.version}
          announcement={poll.announcement}
        />
      ) : null}
    </FocusedShell>
  );
}

/** One value of the query string. */
function one(query: SearchParams, key: string): string | undefined {
  const raw = query[key];
  return Array.isArray(raw) ? raw[0] : raw;
}

/** The sentence announced when the phase changes (never every number). */
async function announcement(locale: AppLocale, view: UserImportView): Promise<string> {
  const t = await getTranslations({ locale, namespace: 'userImport' });
  const { status, fileStatus } = view.record;
  if (status === 'uploaded') {
    return fileStatus === 'clean' ? t('fileStates.announceReading') : t('fileStates.scanning');
  }
  if (status === 'validating') return t('fileStates.validating');
  if (status === 'undoing') return t('progress.announce.undoing');
  if (status === 'queued' || status === 'checking') return t('progress.announce.checking');
  if (status === 'importing') return t('progress.announce.importing');
  return t('progress.announce.inviting');
}

async function content(
  locale: AppLocale,
  view: UserImportView,
  query: SearchParams,
  organization: string,
  dates: DisplayDateFormatter,
): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: 'userImport' });
  const { record } = view;
  const one = (key: string) => {
    const raw = query[key];
    return Array.isArray(raw) ? raw[0] : raw;
  };

  if (isDraft(record.status)) {
    if (!record.mine) {
      return (
        <>
          <h1 className="m-0 text-[28px] font-bold md:text-5xl">{t('title')}</h1>
          <Card title={t('notYours.title')} headingLevel={2} data-testid="import-not-yours">
            <p className="mt-0">{t('notYours.body')}</p>
            <a
              href={`/${locale}/suite/admin/users`}
              className={buttonClasses({ variant: 'secondary', size: 'md' })}
            >
              {t('progress.backToUsers')}
            </a>
          </Card>
        </>
      );
    }
    const step = draftStep(record.status, one('step'));
    let main: ReactNode;
    if (record.status === 'uploaded' || record.status === 'validating') {
      main = (
        <>
          <h1 className="m-0 text-[28px] font-bold md:text-5xl">{t('title')}</h1>
          {await fileState(locale, view, dates)}
        </>
      );
    } else if (step === 'mapping') {
      main = await mappingStep(locale, view);
    } else if (step === 'confirm') {
      main = await confirmStep(locale, view, query, organization);
    } else {
      main = await reviewStep(locale, view, query, dates);
    }
    return main;
  }
  if (isRunning(record.status) || record.status === 'undoing') {
    return progressView(locale, view, dates);
  }
  return resultView(locale, view, dates);
}
