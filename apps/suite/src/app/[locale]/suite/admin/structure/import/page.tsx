import { toClientError } from '@jadarat/platform-core';
import { getMessages } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import { Alert, type Breadcrumb, PageHeader } from '@jadarat/ui';
import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { UnitImport } from '../../../../../../components/structure/unit-import';
import { SuiteShell } from '../../../../../../components/suite-shell';
import { flattenTexts } from '../../../../../../lib/flatten-texts';
import { profileErrorTexts } from '../../../../../../lib/profile-texts';
import { unitImportTemplateQuery } from '../../../../../../lib/structure-queries';
import { getSuiteContext } from '../../../../../../lib/suite-context';

const PATH = '/suite/admin/structure';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: 'structure' });
  return { title: t('import.title') };
}

/**
 * Structure → Import units (WP-HR-01; FR-ADM-05; business flow EP-ORG-structure-completion.md §3 D; design
 * screen 7, approved by the PO 24 Oct 2026; Mobbin refs Rippling, Deel, Attio): the template, the file, the
 * check of every row (nothing written, nothing stored), then «Import» of the good rows. New codes create units,
 * existing codes update them; the import never moves, deactivates or deletes a unit. The HR Manager
 * (`platform.org.manage`).
 */
export default async function UnitImportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'structure' });
  const common = await getTranslations({ locale, namespace: 'common' });
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const structureHref = `/${locale}${PATH}`;

  let body: ReactNode;
  if (!context.live) {
    body = (
      <Alert tone="info" data-testid="structure-not-configured">
        {t('notConfigured')}
      </Alert>
    );
  } else {
    const allowed = await unitImportTemplateQuery({});
    if (!allowed.ok) {
      const error = toClientError(allowed.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      const errors = await getTranslations({ locale, namespace: 'errors' });
      body = (
        <Alert tone="warning" data-testid="unit-import-forbidden">
          {error.code === 'FORBIDDEN' ? errors('forbidden') : t('loadFailed', { correlationId: error.correlationId ?? '' })}
        </Alert>
      );
    } else {
      body = (
        <UnitImport
          texts={{
            ...flattenTexts(getMessages(locale).structure),
            required: common('required'),
            optional: common('optional'),
          }}
          errors={await profileErrorTexts(locale)}
          locale={locale}
          templateHref={`${structureHref}/import/template`}
          structureHref={structureHref}
        />
      );
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="structure" path={`${PATH}/import`}>
      <PageHeader
        title={t('import.title')}
        description={t('import.intro')}
        breadcrumbs={
          [
            { label: shell('groupOrganization') },
            { label: shell('structure'), href: structureHref },
            { label: t('import.title') },
          ] as Breadcrumb[]
        }
        breadcrumbsLabel={common('breadcrumbLabel')}
      />
      {body}
    </SuiteShell>
  );
}
