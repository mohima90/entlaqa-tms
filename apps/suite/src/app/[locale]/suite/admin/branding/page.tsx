import { toClientError } from '@jadarat/platform-core';
import type { BrandingRecord } from '@jadarat/platform-db';
import { BRAND_IMAGE_MAX_SIDE, brandImageMaxBytes } from '@jadarat/platform-files';
import { type AppLocale, getMessages } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import { Alert, Icon, PageHeader, buttonClasses } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  type BrandImageInitial,
  BrandingForm,
  type BrandingFormProps,
} from '../../../../../components/branding/branding-form';
import { SuiteShell } from '../../../../../components/suite-shell';
import { brandingQuery } from '../../../../../lib/branding-queries';
import { JADARAT_BRAND, brandAssetPath } from '../../../../../lib/branding-view';
import { flattenTexts } from '../../../../../lib/flatten-texts';
import { pageDates } from '../../../../../lib/page-dates';
import { pageStepUp, settingsCommonTexts } from '../../../../../lib/settings-page';
import { fileActionErrorTexts } from '../../../../../lib/profile-texts';
import { type SuiteContext, getSuiteContext } from '../../../../../lib/suite-context';
import { SUITE_PATHS } from '../../../../../lib/suite-navigation';
import { localizedName } from '../../../../../lib/users-view';

const PATH = SUITE_PATHS.branding;

const LIMITS: BrandingFormProps['limits'] = {
  logo: brandImageMaxBytes('logo'),
  favicon: brandImageMaxBytes('favicon'),
  sign_in_image: brandImageMaxBytes('sign_in_image'),
};

/**
 * Organization → Branding (WP-ADM-02, FR-ADM-07, FR-ADM-02 names; business flow EP-BRAND, agreed 20 Oct
 * 2026; Kawadir /org/branding). The Organization Admin edits it (organization-wide platform.tenant.manage);
 * a reader of the organization's settings (platform.tenant.read, e.g. an Auditor) sees it read-only; everyone
 * else is refused. Without a configured environment the page is a preview: the colours, presets, gradient,
 * contrast check and live preview work; nothing is uploaded or saved.
 */
export default async function BrandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'branding' });
  const users = await getTranslations({ locale, namespace: 'users' });

  let content: ReactNode;
  if (!context.live) {
    content = (
      <div className="flex flex-col gap-5">
        <Alert tone="info" data-testid="branding-not-configured">
          {t('notConfigured')}
        </Alert>
        <Form locale={locale} context={context} record={null} editAccess="allowed" live={false} />
      </div>
    );
  } else {
    const result = await brandingQuery({});
    if (!result.ok) {
      const error = toClientError(result.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      if (error.code === 'FORBIDDEN' || error.code === 'NOT_FOUND') {
        const errors = await getTranslations({ locale, namespace: 'errors' });
        content = (
          <Alert tone="warning" data-testid="branding-forbidden">
            {errors('forbidden')}
          </Alert>
        );
      } else if (error.code === 'NOT_CONFIGURED') {
        content = (
          <Alert tone="info" data-testid="branding-not-configured">
            {t('notConfigured')}
          </Alert>
        );
      } else {
        const common = await getTranslations({ locale, namespace: 'common' });
        content = (
          <Alert
            tone="danger"
            data-testid="branding-load-failed"
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
            {users('loadFailed', { correlationId: error.correlationId ?? '' })}
          </Alert>
        );
      }
    } else {
      content = (
        <div className="flex flex-col gap-5">
          {result.value.editAccess === 'denied' ? (
            <Alert tone="info" data-testid="branding-read-only">
              {t('readOnly')}
            </Alert>
          ) : null}
          <Form
            locale={locale}
            context={context}
            record={result.value.branding}
            editAccess={result.value.editAccess}
            live
          />
        </div>
      );
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="branding" path={PATH}>
      <PageHeader
        breadcrumbs={[{ label: t('breadcrumbSection') }, { label: t('title') }]}
        breadcrumbsLabel={t('breadcrumbLabel')}
        title={t('title')}
        description={t('intro')}
      />
      {content}
    </SuiteShell>
  );
}

function imageOf(
  record: BrandingRecord,
  slot: 'logo' | 'favicon' | 'sign_in_image',
): BrandImageInitial | null {
  const image = record.images[slot];
  if (!image) return null;
  return {
    fileId: image.fileId,
    src: brandAssetPath(image.assetId),
    status: image.status,
    name: image.name,
    failed: image.failed,
  };
}

async function Form({
  locale,
  context,
  record,
  editAccess,
  live,
}: {
  locale: AppLocale;
  context: SuiteContext;
  record: BrandingRecord | null;
  editAccess: 'allowed' | 'denied';
  live: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'branding' });
  const dates = pageDates(locale, context);
  const lastChanged =
    record?.updatedBy && record.updatedAt
      ? t('lastChanged', {
          name: localizedName(locale, record.updatedBy.nameAr, record.updatedBy.nameEn),
          date: dates.dateTime(record.updatedAt),
        })
      : t('lastChangedDefault');
  return (
    <BrandingForm
      locale={locale}
      live={live}
      editable={editAccess === 'allowed'}
      version={record?.version ?? 0}
      initial={{
        nameEn: record?.nameEn ?? '',
        nameAr: record?.nameAr ?? '',
        primaryColor: record?.primaryColor ?? JADARAT_BRAND.primary,
        secondaryColor: record?.secondaryColor ?? JADARAT_BRAND.secondary,
        useGradient: record?.useGradient ?? true,
        websiteUrl: record?.websiteUrl ?? '',
      }}
      images={{
        logo: record ? imageOf(record, 'logo') : null,
        favicon: record ? imageOf(record, 'favicon') : null,
        sign_in_image: record ? imageOf(record, 'sign_in_image') : null,
      }}
      limits={LIMITS}
      maxSides={BRAND_IMAGE_MAX_SIDE}
      texts={flattenTexts(getMessages(locale).branding)}
      errors={await fileActionErrorTexts(locale)}
      lastChanged={lastChanged}
      common={await settingsCommonTexts(locale)}
      stepUp={await pageStepUp(locale, PATH, 'platform.tenant.manage')}
    />
  );
}
