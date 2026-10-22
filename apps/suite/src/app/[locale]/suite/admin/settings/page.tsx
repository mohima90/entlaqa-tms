import { toClientError } from '@jadarat/platform-core';
import { type AppLocale, INDUSTRIES, getMessages } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import { Alert, Icon, PageHeader, buttonClasses } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { OrganizationProfileForm } from '../../../../../components/organization/organization-profile-form';
import { SuiteShell } from '../../../../../components/suite-shell';
import { flattenTexts } from '../../../../../lib/flatten-texts';
import { organizationChoices } from '../../../../../lib/organization-options';
import { pageDates } from '../../../../../lib/page-dates';
import { pageStepUp, settingsCommonTexts } from '../../../../../lib/settings-page';
import { profileErrorTexts } from '../../../../../lib/profile-texts';
import { type SuiteContext, getSuiteContext } from '../../../../../lib/suite-context';
import { organizationProfileQuery } from '../../../../../lib/users-queries';
import { SUITE_PATHS } from '../../../../../lib/suite-navigation';
import { localizedName } from '../../../../../lib/users-view';

const PATH = SUITE_PATHS.general;

/**
 * Settings → General (Kawadir layout, T-M2-43; docs/design/kawadir-alignment.md §6): the organization
 * profile and regional settings (approved screen «بيانات المنشأة», PO 14 Oct 2026; FR-ADM-02, FR-SCH-07,
 * BR-ADM-3; T-M2-22), one card per section. The former address /suite/admin/organization redirects here. The Organization Admin edits it
 * (organization-wide platform.tenant.manage); the Auditor reads it (platform.tenant.read, BRD Appendix B;
 * PO decision 14 Oct 2026); everyone else — HR Manager, Learner… — is refused.
 * Direction C (redesign package 2, PO 21 Oct 2026): breadcrumbs, two-column sections, the floating
 * save bar, a toast on save, the leave guard; when saving needs a fresh authenticator code the page asks
 * first (Q2-1 — no organization setting needs one today, PO decision 14 Oct 2026). The database enforces
 * who may change it and every rule.
 */
export default async function GeneralSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'organizationProfile' });
  const users = await getTranslations({ locale, namespace: 'users' });

  let content: ReactNode;
  if (!context.live) {
    content = (
      <Alert tone="info" data-testid="organization-not-configured">
        {t('notConfigured')}
      </Alert>
    );
  } else {
    const result = await organizationProfileQuery({});
    if (!result.ok) {
      const error = toClientError(result.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      if (error.code === 'FORBIDDEN' || error.code === 'NOT_FOUND') {
        const errors = await getTranslations({ locale, namespace: 'errors' });
        content = (
          <Alert tone="warning" data-testid="organization-forbidden">
            {errors('forbidden')}
          </Alert>
        );
      } else {
        const common = await getTranslations({ locale, namespace: 'common' });
        content = (
          <Alert
            tone="danger"
            data-testid="organization-load-failed"
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
      content = <Profile locale={locale} view={result.value} context={context} />;
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="general" path={PATH}>
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

async function Profile({
  locale,
  view,
  context,
}: {
  locale: AppLocale;
  view: Extract<Awaited<ReturnType<typeof organizationProfileQuery>>, { ok: true }>['value'];
  context: SuiteContext;
}) {
  const t = await getTranslations({ locale, namespace: 'organizationProfile' });
  const { profile, editAccess } = view;
  const dates = pageDates(locale, context);
  const lastChanged = profile.updatedBy
    ? t('lastChanged', {
        name: localizedName(locale, profile.updatedBy.nameAr, profile.updatedBy.nameEn),
        date: dates.dateTime(profile.updatedAt),
      })
    : t('lastChangedDefault');
  const choices = organizationChoices(locale, new Date(), profile);
  return (
    <div className="flex flex-col gap-5">
      {editAccess === 'denied' ? (
        <Alert tone="info" data-testid="organization-read-only">
          {t('readOnly')}
        </Alert>
      ) : null}
      <OrganizationProfileForm
        locale={locale}
        initial={{
          industry: profile.industry ?? '',
          countryCode: profile.countryCode ?? '',
          currencyCode: profile.currencyCode,
          timeZone: profile.timeZone,
          fiscalYearStartMonth: profile.fiscalYearStartMonth,
          defaultLocale: profile.defaultLocale,
          dateDisplay: profile.dateDisplay,
          workingDays: profile.workingDays,
          workStartsAt: profile.workStartsAt,
          workEndsAt: profile.workEndsAt,
        }}
        version={profile.version}
        editable={editAccess === 'allowed'}
        choices={choices}
        industries={INDUSTRIES.map((code) => ({ value: code, label: t(`industries.${code}`) }))}
        texts={flattenTexts(getMessages(locale).organizationProfile)}
        common={await settingsCommonTexts(locale)}
        lastChanged={lastChanged}
        errors={await profileErrorTexts(locale)}
        stepUp={await pageStepUp(locale, PATH, 'platform.tenant.manage')}
      />
    </div>
  );
}
