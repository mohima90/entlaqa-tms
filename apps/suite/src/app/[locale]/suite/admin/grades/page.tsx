import { toClientError } from '@jadarat/platform-core';
import { routing } from '@jadarat/platform-i18n/routing';
import { Alert, type Breadcrumb, Icon, PageHeader, buttonClasses } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { GradesTable } from '../../../../../components/grades/grades-table';
import { SuiteShell } from '../../../../../components/suite-shell';
import type { GradeRowView } from '../../../../../lib/grades-view';
import { profileErrorTexts } from '../../../../../lib/profile-texts';
import { getSuiteContext } from '../../../../../lib/suite-context';
import { gradesPageQuery } from '../../../../../lib/users-queries';

const PATH = '/suite/admin/grades';

/**
 * Organization → Grades (WP-ADM-04, FR-IAM-01; business flow EP-PEOPLE-photo-hr-fields, PO answers 21 and 23
 * Oct 2026): the organization's list of grade codes (7, G7, #7, G-7 …), unique in the organization, kept by the
 * HR Manager and the Organization Admin (`platform.user.update` organization-wide). Anyone else is told they
 * may not open it. A grade people still hold cannot be deleted. Every change is audited.
 */
export default async function GradesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'peopleRecord' });
  const common = await getTranslations({ locale, namespace: 'common' });
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const header = {
    title: t('grades.title'),
    description: t('grades.desc'),
    breadcrumbs: [
      { label: shell('groupOrganization') },
      { label: t('grades.title') },
    ] as Breadcrumb[],
    breadcrumbsLabel: common('breadcrumbLabel'),
  };
  const plainHeader = <PageHeader {...header} />;

  let content: ReactNode;
  if (!context.live) {
    content = await table(
      locale,
      [],
      false,
      header,
      <Alert tone="info" data-testid="grades-not-configured">
        {(await getTranslations({ locale, namespace: 'users' }))('notConfigured')}
      </Alert>,
    );
  } else {
    const result = await gradesPageQuery({});
    if (!result.ok) {
      const error = toClientError(result.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      if (error.code === 'FORBIDDEN') {
        const errors = await getTranslations({ locale, namespace: 'errors' });
        content = (
          <>
            {plainHeader}
            <Alert tone="warning">{errors('forbidden')}</Alert>
          </>
        );
      } else {
        content = (
          <>
            {plainHeader}
            <Alert
              tone="danger"
              data-testid="grades-load-failed"
              action={
                <a
                  href={`/${locale}${PATH}`}
                  className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                >
                  <Icon name="sync" />
                  {common('tryAgain')}
                </a>
              }
            >
              {t('grades.loadFailed', { correlationId: error.correlationId ?? '' })}
            </Alert>
          </>
        );
      }
    } else {
      content = await table(locale, result.value.grades, true, header, null);
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="grades" path={PATH}>
      {content}
    </SuiteShell>
  );
}

async function table(
  locale: 'ar' | 'en',
  grades: readonly { readonly id: string; readonly code: string; readonly people: number }[],
  live: boolean,
  header: Parameters<typeof GradesTable>[0]['header'],
  notice: ReactNode,
) {
  const t = await getTranslations({ locale, namespace: 'peopleRecord' });
  const rows: GradeRowView[] = grades.map((grade) => ({
    id: grade.id,
    code: grade.code,
    people: grade.people,
    peopleText: t('grades.people', { count: grade.people }),
    renameLabel: t('grades.rename', { code: grade.code }),
    deleteLabel: t('grades.deleteAria', { code: grade.code }),
    editNote: grade.people > 0 ? t('grades.editNote', { count: grade.people }) : null,
    editTitle: t('grades.editTitle', { code: grade.code }),
    deleteTitle: t('grades.deleteTitle', { code: grade.code }),
    blockedTitle: t('grades.deleteBlockedTitle', { code: grade.code }),
    blockedText: t('grades.deleteBlockedText', { count: grade.people }),
  }));
  return (
    <GradesTable
      rows={rows}
      live={live}
      header={header}
      notice={notice}
      errors={await profileErrorTexts(locale)}
      texts={{
        title: t('grades.title'),
        add: t('grades.add'),
        addTitle: t('grades.addTitle'),
        colCode: t('grades.colCode'),
        colPeople: t('grades.colPeople'),
        colActions: t('grades.colActions'),
        caption: t('grades.caption'),
        countText: t('grades.count', { count: grades.length }),
        emptyTitle: t('grades.emptyTitle'),
        emptyBody: t('grades.emptyBody'),
        codeLabel: t('grades.codeLabel'),
        codeHint: t('grades.codeHint'),
        errFormat: t('grades.errFormat'),
        errTaken: t('grades.errTaken', { code: '{code}' }),
        errRequired: t('grades.errRequired'),
        deleteText: t('grades.deleteText'),
        addConfirm: t('grades.addConfirm'),
        saveConfirm: t('grades.saveConfirm'),
        deleteConfirm: t('grades.deleteConfirm'),
        understood: t('grades.understood'),
        added: t('grades.added', { code: '{code}' }),
        renamed: t('grades.renamed', { code: '{code}' }),
        deleted: t('grades.deleted', { code: '{code}' }),
        audit: t('grades.audit'),
        cancel: t('grades.cancel'),
        close: t('grades.close'),
      }}
    />
  );
}
