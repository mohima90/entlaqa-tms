import { toClientError } from '@jadarat/platform-core';
import type { AppLocale, DisplayDateFormatter } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import {
  type NameLanguage,
  type UserImportStartView,
  fieldDefinitionsFor,
} from '@jadarat/platform-import';
import { Alert, Badge, Card, buttonClasses } from '@jadarat/ui';
import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { FocusedActions } from '../../../../../../components/focused-actions';
import { FocusedShell } from '../../../../../../components/focused-shell';
import { CancelDraftButton } from '../../../../../../components/user-import/cancel-draft-button';
import { Stepper } from '../../../../../../components/user-import/stepper';
import { UploadPanel } from '../../../../../../components/user-import/upload-panel';
import { fileActionErrorTexts } from '../../../../../../lib/profile-texts';
import { getSuiteContext } from '../../../../../../lib/suite-context';
import { pageDates } from '../../../../../../lib/page-dates';
import { userImportStartQuery } from '../../../../../../lib/user-import-queries';
import { count, isDraft } from '../../../../../../lib/user-import-view';
import { localizedName } from '../../../../../../lib/users-view';
import { importForbidden, stepperProps } from '../../../../../../components/user-import/page-parts';

/** Step 1 texts the upload panel uses (namespace `userImport.upload`; raw: placeholders filled there). */
const UPLOAD_KEYS = [
  'dropHint',
  'choose',
  'limits',
  'rowsHint',
  'scanHint',
  'retentionHint',
  'uploading',
  'uploaded',
  'percent',
  'cancelUpload',
  'announceStart',
  'announceDone',
  'progressLabel',
  'mbUnit',
] as const;

/**
 * Bulk user import, step 1 «الملف» (T-M2-12, FR-IAM-04; approved screens 2–4): the template (XLSX or CSV,
 * Arabic or English headers) and its column guide, the upload (scanned before it is read), the
 * organization's recent imports. Organization Admin and HR Manager (`platform.user.invite`).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: 'userImport.steps' });
  // The page title names the step (design README §13).
  return { title: t('pageTitle', { name: t('file') }) };
}

export default async function UserImportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'userImport' });
  const users = await getTranslations({ locale, namespace: 'users' });

  let body: ReactNode;
  if (!context.live) {
    body = (
      <Alert tone="info" data-testid="users-not-configured">
        {users('notConfigured')}
      </Alert>
    );
  } else {
    const result = await userImportStartQuery({});
    if (!result.ok) {
      const error = toClientError(result.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      body =
        error.code === 'FORBIDDEN' ? (
          await importForbidden(locale)
        ) : (
          <Alert tone="danger">
            {t('loadFailed', { correlationId: error.correlationId ?? '' })}
          </Alert>
        );
    } else {
      body = await stepOne(
        locale,
        result.value,
        context.organizationName ?? '',
        pageDates(locale, context),
      );
    }
  }

  return (
    <FocusedShell
      locale={locale}
      context={context}
      path="/suite/admin/users/import"
      closeHref={`/${locale}/suite/admin/users`}
      title={t('title')}
      subtitle={context.organizationName}
      steps={<Stepper {...await stepperProps(locale, 'file')} />}
    >
      <h1 className="m-0 text-[28px] font-bold md:text-5xl">{t('title')}</h1>
      {body}
    </FocusedShell>
  );
}

async function stepOne(
  locale: AppLocale,
  view: UserImportStartView,
  organization: string,
  dates: DisplayDateFormatter,
) {
  const t = await getTranslations({ locale, namespace: 'userImport' });
  const base = `/${locale}/suite/admin/users/import`;
  const labels: Record<string, string> = Object.fromEntries(
    UPLOAD_KEYS.map((key) => [key, String(t.raw(`upload.${key}`))]),
  );
  labels.cutTitle = t('fileStates.uploadCut.title');
  labels.cutBody = t('fileStates.uploadCut.body');
  labels.cutRetry = t('fileStates.uploadCut.retry');
  labels.emptyFile = t('fileStates.refused.FILE_EMPTY.title');
  // The import's own refusals (confirm.errors: IMPORT_STATE_CHANGED, …) with the upload's own wording.
  const codes = {
    ...(t.raw('confirm.errors') as Record<string, string>),
    ...(t.raw('fileStates.uploadErrors') as Record<string, string>),
  };
  const running = view.running;

  return (
    <>
      <p className="m-0 max-w-3xl text-text-muted">{t('intro')}</p>
      <Card title={t('upload.uploadHeading')}>
        {running ? (
          <Alert tone="warning" title={t('upload.otherRunning')} data-testid="import-other-running">
            <a href={`${base}/${running.id}`} className="underline">
              {t('banners.viewProgress')}
            </a>
          </Alert>
        ) : (
          <UploadPanel
            importBase={base}
            labels={labels}
            codes={codes}
            errors={await fileActionErrorTexts(locale)}
            locale={locale}
          />
        )}
      </Card>

      <Card title={t('upload.templateHeading')} data-testid="import-template">
        <p className="mt-0">{t('upload.templateIntro', { organization })}</p>
        <form
          method="get"
          action={`${base}/template`}
          className="flex flex-col gap-3"
          aria-label={t('upload.templateHeading')}
        >
          <fieldset className="m-0 flex flex-wrap items-center gap-4 border-0 p-0">
            <legend className="mb-1 font-medium">{t('upload.templateLanguage')}</legend>
            {(['ar', 'en'] as const).map((lang) => (
              <label key={lang} className="flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="lang"
                  value={lang}
                  defaultChecked={lang === locale}
                  className="size-5"
                />
                {/* Each language's name in itself (WCAG 3.1.2, language of parts). */}
                <span lang={lang}>{lang === 'ar' ? 'العربية' : 'English'}</span>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              name="format"
              value="xlsx"
              className={buttonClasses({ variant: 'secondary', size: 'md' })}
              data-testid="template-xlsx"
            >
              {t('upload.templateXlsx')}
            </button>
            <button
              type="submit"
              name="format"
              value="csv"
              className={buttonClasses({ variant: 'secondary', size: 'md' })}
              data-testid="template-csv"
            >
              {t('upload.templateCsv')}
            </button>
          </div>
        </form>
        <p className="mb-0 mt-3 text-sm text-text-muted">{t('upload.hrSystemHint')}</p>
        {await templateGuide(locale, view.nameLanguage)}
      </Card>

      {await recentImports(locale, view, organization, dates)}

      <FocusedActions note={t('upload.nextDisabled')}>
        <a
          href={`/${locale}/suite/admin/users`}
          className={buttonClasses({ variant: 'secondary', size: 'md' })}
        >
          {t('upload.back')}
        </a>
      </FocusedActions>
    </>
  );
}

/**
 * Screen 3 «أعمدة قالب الاستيراد», built as a disclosure on step 1 (not a dialog). The names of the
 * organization's default language come first and are the required ones (PO 17 Oct 2026).
 */
async function templateGuide(locale: AppLocale, nameLanguage: NameLanguage) {
  const t = await getTranslations({ locale, namespace: 'userImport' });
  const other = locale === 'ar' ? 'en' : 'ar';
  const groups = ['identity', 'work', 'roles'] as const;
  return (
    <details className="mt-4 rounded-lg border border-border p-4" data-testid="template-guide">
      <summary className="min-h-11 cursor-pointer font-medium">{t('guide.toggle')}</summary>
      <h3 className="mb-2 mt-4 text-base font-semibold">{t('guide.title')}</h3>
      <p className="mt-0">{t('guide.intro')}</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-start text-sm">
          <caption className="sr-only">{t('guide.caption')}</caption>
          <thead className="bg-surface-sunken">
            <tr>
              <th scope="col" className="px-3 py-2 text-start">
                {t('guide.columns.column')}
              </th>
              <th scope="col" className="px-3 py-2 text-start">
                {t('guide.columns.required')}
              </th>
              <th scope="col" className="px-3 py-2 text-start">
                {t('guide.columns.description')}
              </th>
              <th scope="col" className="px-3 py-2 text-start">
                {t('guide.columns.example')}
              </th>
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody key={group}>
              <tr className="border-t border-border bg-surface-sunken">
                <th scope="colgroup" colSpan={4} className="px-3 py-2 text-start font-semibold">
                  {t(`guide.groups.${group}`)}
                </th>
              </tr>
              {fieldDefinitionsFor(nameLanguage)
                .filter((d) => d.group === group)
                .map((d) => (
                  <tr key={d.field} className="border-t border-border align-top">
                    <th scope="row" className="px-3 py-2 text-start font-medium">
                      {d.header[locale]}
                      <div className="font-normal text-text-muted">
                        <bdi>{d.header[other]}</bdi>
                      </div>
                    </th>
                    <td className="px-3 py-2">
                      {d.required ? (
                        <Badge tone="warning">{t('guide.required')}</Badge>
                      ) : (
                        t('guide.optional')
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {d.description[locale]}
                      <div className="text-text-muted">
                        <bdi>{d.description[other]}</bdi>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <bdi>{d.example}</bdi>
                    </td>
                  </tr>
                ))}
            </tbody>
          ))}
        </table>
      </div>
      <h3 className="mb-2 mt-4 text-base font-semibold">{t('guide.inTemplateHeading')}</h3>
      <ul className="m-0 flex flex-col gap-1 ps-5">
        <li>{t('guide.inTemplateXlsx')}</li>
        <li>{t('guide.inTemplateCsv')}</li>
        <li>{t('guide.noExamples')}</li>
      </ul>
      <h3 className="mb-2 mt-4 text-base font-semibold">{t('guide.neverHeading')}</h3>
      <ul className="m-0 flex flex-col gap-1 ps-5">
        <li>{t('guide.neverStatus')}</li>
        <li>{t('guide.neverPrivileged')}</li>
        <li>{t('guide.neverRestricted')}</li>
      </ul>
    </details>
  );
}

async function recentImports(
  locale: AppLocale,
  view: UserImportStartView,
  organization: string,
  dates: DisplayDateFormatter,
) {
  const t = await getTranslations({ locale, namespace: 'userImport' });
  const base = `/${locale}/suite/admin/users/import`;
  // The importer's own imports that have not run can be cancelled here (integration review M1).
  const codes = t.raw('confirm.errors') as Record<string, string>;
  const errors = await fileActionErrorTexts(locale);
  return (
    <section aria-labelledby="recent-imports" data-testid="recent-imports">
      <h2 id="recent-imports" className="mb-1 mt-0 text-lg font-semibold">
        {t('recent.heading')}
      </h2>
      <p className="mt-0 text-sm text-text-muted">{t('recent.intro', { organization })}</p>
      {view.recent.length === 0 ? (
        <p className="m-0">{t('recent.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full border-collapse text-start">
            <caption className="sr-only">{t('recent.caption')}</caption>
            <thead className="bg-surface-sunken text-sm">
              <tr>
                {(['file', 'by', 'date', 'result', 'action'] as const).map((key) => (
                  <th
                    key={key}
                    scope="col"
                    className="whitespace-nowrap px-4 py-3 text-start font-semibold"
                  >
                    {t(`recent.columns.${key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.recent.map((record) => (
                <tr key={record.id} className="border-t border-border">
                  <th scope="row" className="min-w-40 px-4 py-3 text-start font-medium">
                    <bdi>{record.fileName}</bdi>
                  </th>
                  <td className="min-w-32 px-4 py-3">
                    {record.mine
                      ? t('recent.you')
                      : (record.importerName.ar ?? record.importerName.en)
                        ? localizedName(locale, record.importerName.ar, record.importerName.en)
                        : '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm">
                    {dates.dateTime(record.createdAt)}
                  </td>
                  <td className="min-w-48 px-4 py-3 text-sm">
                    <Badge>
                      {record.status === 'expired' && record.failureCode === 'UPLOAD_NOT_FINISHED'
                        ? t('status.uploadNotFinished')
                        : t(`status.${record.status}`)}
                    </Badge>
                    {record.resultCounts ? (
                      <div className="mt-1 text-text-muted">
                        {t('resultSummary', {
                          added: count(record.resultCounts, 'added'),
                          updated: count(record.resultCounts, 'updated'),
                          skipped: count(record.resultCounts, 'skipped'),
                          failed: count(record.resultCounts, 'failed'),
                        })}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-start gap-2">
                      <a href={`${base}/${record.id}`} className="whitespace-nowrap underline">
                        {t('recent.view')}
                        <span className="sr-only">{` (${record.fileName})`}</span>
                      </a>
                      {record.mine && isDraft(record.status) && record.dataPurgedAt === null ? (
                        <CancelDraftButton
                          importId={record.id}
                          label={t('confirm.cancel')}
                          srDetail={record.fileName}
                          workingLabel={t('progress.working')}
                          confirm={{
                            question: t('confirm.cancelConfirm'),
                            confirmButton: t('confirm.cancelConfirmButton'),
                            keep: t('confirm.keep'),
                          }}
                          variant="ghost"
                          codes={codes}
                          errors={errors}
                          testId="recent-cancel"
                        />
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
