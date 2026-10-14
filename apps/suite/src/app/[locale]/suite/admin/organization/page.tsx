import { toClientError } from '@jadarat/platform-core';
import { type AppLocale, INDUSTRIES, getMessages } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import { Alert, buttonClasses } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { OrganizationProfileForm } from '../../../../../components/organization/organization-profile-form';
import { SuiteShell } from '../../../../../components/suite-shell';
import { flattenTexts } from '../../../../../lib/flatten-texts';
import { stepUpHref } from '../../../../../lib/mfa-view';
import { organizationChoices } from '../../../../../lib/organization-options';
import { pageDates } from '../../../../../lib/page-dates';
import { profileErrorTexts } from '../../../../../lib/profile-texts';
import { type SuiteContext, getSuiteContext } from '../../../../../lib/suite-context';
import { organizationProfileQuery } from '../../../../../lib/users-queries';
import { localizedName } from '../../../../../lib/users-view';

const PATH = '/suite/admin/organization';

/**
 * Organization profile and regional settings (approved screen «بيانات المنشأة» / "Organization profile",
 * PO 14 Oct 2026; FR-ADM-02, FR-SCH-07, BR-ADM-3; T-M2-22). The Organization Admin edits it
 * (organization-wide platform.tenant.manage); the Auditor reads it (platform.tenant.read, BRD Appendix B;
 * PO decision 14 Oct 2026); everyone else — HR Manager, Learner… — is refused.
 * Saving needs an authenticator code (AAL2, as the security policy): at AAL1 the page says so, links to
 * the code and shows the profile read-only. The database enforces who may change it and every rule.
 */
export default async function OrganizationProfilePage({
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
        content = (
          <Alert tone="danger">
            {users('loadFailed', { correlationId: error.correlationId ?? '' })}
          </Alert>
        );
      }
    } else {
      content = <Profile locale={locale} view={result.value} context={context} />;
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="organization" path={PATH}>
      <nav aria-label={t('breadcrumbLabel')} className="mb-1 text-sm text-text-muted">
        <ol className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          <li>{t('breadcrumbSection')}</li>
          <li aria-hidden="true">/</li>
          <li aria-current="page">{t('title')}</li>
        </ol>
      </nav>
      <h1 className="mb-1 mt-0 text-2xl font-bold">{t('title')}</h1>
      <p className="mb-6 mt-0 max-w-3xl text-text-muted">{t('intro')}</p>
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
  const here = stepUpHref(locale, `/${locale}${PATH}`);
  const choices = organizationChoices(locale, new Date(), profile);
  return (
    <div className="flex flex-col gap-5">
      {editAccess === 'step_up_required' ? (
        <Alert tone="warning" data-testid="organization-step-up">
          <span className="flex flex-wrap items-center gap-3">
            <span>{t('stepUp')}</span>
            <a
              href={here}
              className={buttonClasses({ variant: 'secondary', size: 'sm' })}
              data-testid="organization-step-up-link"
            >
              {t('stepUpLink')}
            </a>
          </span>
        </Alert>
      ) : null}
      {editAccess === 'denied' ? (
        <Alert tone="info" data-testid="organization-read-only">
          {t('readOnly')}
        </Alert>
      ) : null}
      <OrganizationProfileForm
        locale={locale}
        initial={{
          nameEn: profile.nameEn ?? '',
          nameAr: profile.nameAr,
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
        lastChanged={lastChanged}
        errors={await profileErrorTexts(locale)}
        stepUpHref={here}
      />
    </div>
  );
}
