import { toClientError } from '@jadarat/platform-core';
import { type AppLocale, countryName, getMessages, timeZoneLabel } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import type { BranchesPageView } from '@jadarat/platform-rbac';
import { Alert, type Breadcrumb, Icon, PageHeader, buttonClasses } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import type { BranchView } from '../../../../../components/structure/branch-panel';
import { BranchesTable } from '../../../../../components/structure/branches-table';
import { SuiteShell } from '../../../../../components/suite-shell';
import { type BranchFilter, branchFilterOf } from '../../../../../lib/branches-view';
import { flattenTexts } from '../../../../../lib/flatten-texts';
import { organizationChoices } from '../../../../../lib/organization-options';
import { profileErrorTexts } from '../../../../../lib/profile-texts';
import { branchesPageQuery } from '../../../../../lib/structure-queries';
import { type SuiteContext, getSuiteContext } from '../../../../../lib/suite-context';
import { localizedName } from '../../../../../lib/users-view';

const PATH = '/suite/admin/branches';

/**
 * Organization → Branches (FR-ADM-04 core fields that exist in platform.branches; T-M3-02, EP-ORG).
 * Everyone who reads the structure sees them; the HR Manager (`platform.org.manage`) adds, edits,
 * deactivates and deletes them. Direction C (redesign package 2, PO 21 Oct 2026): breadcrumbs, the
 * status pills (`?status=active|inactive`, each view its own address), sub-branches under their parent,
 * cards on phones, the side panel for the form and Undo after deactivating. GPS, working week and hours
 * come with the working calendars.
 */
export default async function BranchesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const filter = branchFilterOf((await searchParams).status);
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'branches' });
  const common = await getTranslations({ locale, namespace: 'common' });
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const header = {
    title: t('title'),
    description: t('intro'),
    breadcrumbs: [{ label: shell('groupOrganization') }, { label: t('title') }] as Breadcrumb[],
    breadcrumbsLabel: common('breadcrumbLabel'),
  };
  const plainHeader = <PageHeader {...header} />;

  let content: ReactNode;
  if (!context.live) {
    content = (
      <Branches
        locale={locale}
        view={{ branches: [], canManage: false }}
        context={context}
        header={header}
        filter={filter}
        notice={
          <Alert tone="info" data-testid="branches-not-configured">
            {t('notConfigured')}
          </Alert>
        }
      />
    );
  } else {
    const result = await branchesPageQuery({});
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
              data-testid="branches-load-failed"
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
              {t('loadFailed', { correlationId: error.correlationId ?? '' })}
            </Alert>
          </>
        );
      }
    } else {
      content = (
        <Branches
          locale={locale}
          view={result.value}
          context={context}
          header={header}
          filter={filter}
          notice={
            result.value.canManage ? null : (
              <Alert tone="info" data-testid="branches-view-only">
                {t('viewOnly')}
              </Alert>
            )
          }
        />
      );
    }
  }

  return (
    <SuiteShell
      locale={locale}
      context={context}
      current="branches"
      path={filter === 'all' ? PATH : `${PATH}?status=${filter}`}
    >
      {content}
    </SuiteShell>
  );
}

async function Branches({
  locale,
  view,
  context,
  header,
  filter,
  notice,
}: {
  locale: AppLocale;
  view: BranchesPageView;
  context: SuiteContext;
  header: Parameters<typeof BranchesTable>[0]['header'];
  filter: BranchFilter;
  notice: ReactNode;
}) {
  const common = await getTranslations({ locale, namespace: 'common' });
  const now = new Date();
  const choices = organizationChoices(locale, now, {
    countryCode: null,
    currencyCode: 'SAR',
    timeZone: context.regional.timeZone,
  });
  const branches: BranchView[] = view.branches.map((branch) => {
    const city =
      locale === 'en' ? (branch.cityEn ?? branch.cityAr) : (branch.cityAr ?? branch.cityEn);
    const country = branch.countryCode ? countryName(branch.countryCode, locale) : null;
    const location = [city, country].filter(Boolean).join(locale === 'ar' ? '، ' : ', ');
    return {
      id: branch.id,
      code: branch.code,
      nameAr: branch.nameAr,
      nameEn: branch.nameEn,
      name: localizedName(locale, branch.nameAr, branch.nameEn),
      parentBranchId: branch.parentBranchId,
      countryCode: branch.countryCode,
      cityAr: branch.cityAr,
      cityEn: branch.cityEn,
      location: location === '' ? null : location,
      timezone: branch.timezone,
      timezoneLabel: timeZoneLabel(branch.timezone, locale, now),
      isHeadquarters: branch.isHeadquarters,
      active: branch.status === 'active',
      version: branch.version,
      childCount: branch.childCount,
      unitCount: branch.unitCount,
      peopleCount: branch.peopleCount,
    };
  });
  // A zone saved earlier that this runtime no longer lists stays selectable.
  const zones = [...choices.timeZones];
  for (const branch of branches) {
    if (!zones.some((zone) => zone.value === branch.timezone)) {
      zones.push({ value: branch.timezone, label: branch.timezoneLabel });
    }
  }
  return (
    <BranchesTable
      branches={branches}
      canManage={view.canManage}
      countries={choices.countries}
      timeZones={zones}
      defaultTimeZone={context.regional.timeZone}
      texts={{
        ...flattenTexts(getMessages(locale).branches),
        required: common('required'),
        optional: common('optional'),
      }}
      undoLabel={common('undo')}
      errors={await profileErrorTexts(locale)}
      locale={locale}
      header={header}
      filter={filter}
      path={`/${locale}${PATH}`}
      notice={notice}
    />
  );
}
