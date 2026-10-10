import { toClientError } from '@jadarat/platform-core';
import type { AppLocale } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import type { UserImportView } from '@jadarat/platform-import';
import { Alert, Card, buttonClasses } from '@jadarat/ui';
import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { SuiteShell } from '../../../../../../../components/suite-shell';
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
  optionsStep,
  progressView,
  resultView,
  reviewStep,
} from '../../../../../../../components/user-import/steps';
import { getSuiteContext } from '../../../../../../../lib/suite-context';
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
 * file, cancelled, expired). The page refreshes itself while the worker works. Only the importer follows
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
  let poll: { seconds: number; announcement: string } | null = null;
  if (!context.live) {
    body = (
      <Alert tone="info" data-testid="users-not-configured">
        {users('notConfigured')}
      </Alert>
    );
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
      body = await content(locale, view, query, context.organizationName ?? '');
      const seconds = refreshSeconds(view.record.status);
      if (seconds !== null && (view.record.mine || !isDraft(view.record.status))) {
        poll = { seconds, announcement: await announcement(locale, view) };
      }
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="users" path={path}>
      <nav aria-label={t('breadcrumbLabel')} className="mb-2 text-sm">
        <a href={`/${locale}/suite/admin/users`} className="underline">
          {t('breadcrumb')}
        </a>
        {' / '}
        <a href={`/${locale}/suite/admin/users/import`} className="underline">
          {t('breadcrumbImport')}
        </a>
      </nav>
      <div className="flex flex-col gap-6">{body}</div>
      {poll ? <ImportPoller seconds={poll.seconds} announcement={poll.announcement} /> : null}
    </SuiteShell>
  );
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
        <Card title={t('notYours.title')} data-testid="import-not-yours">
          <p className="mt-0">{t('notYours.body')}</p>
          <a
            href={`/${locale}/suite/admin/users`}
            className={buttonClasses({ variant: 'secondary', size: 'md' })}
          >
            {t('progress.backToUsers')}
          </a>
        </Card>
      );
    }
    const step = draftStep(record.status, one('step'));
    const stepper = <Stepper {...await stepperProps(locale, step)} />;
    let main: ReactNode;
    if (record.status === 'uploaded' || record.status === 'validating') {
      main = await fileState(locale, view);
    } else if (step === 'mapping') {
      main = await mappingStep(locale, view);
    } else if (step === 'options') {
      main = await optionsStep(locale, view, query, organization);
    } else if (step === 'confirm') {
      main = await confirmStep(locale, view, query, organization);
    } else {
      main = await reviewStep(locale, view, query);
    }
    return (
      <>
        <h1 className="m-0 text-2xl font-bold">{t('title')}</h1>
        {stepper}
        {main}
      </>
    );
  }
  if (isRunning(record.status) || record.status === 'undoing') {
    return progressView(locale, view);
  }
  return resultView(locale, view);
}
