import { routing } from '@jadarat/platform-i18n/routing';
import { loadPlatformOrganizationDetailForRequest } from '@jadarat/platform-identity/auth';
import { Badge, type BadgeTone, PageHeader } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { OrganizationPlanForm } from '../../../../../components/platform/organization-plan-form';
import { PlatformShell } from '../../../../../components/platform/platform-shell';
import { authErrorTexts } from '../../../../../lib/auth-texts';
import { getConfigStatus } from '../../../../../lib/config-status';
import { flattenTexts } from '../../../../../lib/flatten-texts';
import { gigabytes } from '../../../../../lib/storage-size';
import { trialDaysLeft } from '../../../../../lib/trial-days';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_TONE: Record<string, BadgeTone> = {
  active: 'success',
  trial: 'warning',
  suspended: 'danger',
  cancelled: 'neutral',
};

/**
 * Platform → Organizations → an organization (WP-ADM-06; FR-ADM-17, FR-SUB-01; design approved by the PO 24
 * Oct 2026): the organization's name with its status (and the days left of a trial), and «الخطة والحالة» /
 * Plan and status — plan, status, trial end date and special limits with what is used. Deny by default, on
 * the server: only a Super Admin (the database decides); everyone else, and an unknown organization, 404.
 */
export default async function PlatformOrganizationPage({
  params,
}: {
  params: Promise<{ locale: string; tenantId: string }>;
}) {
  await connection();
  const { locale, tenantId } = await params;
  if (!hasLocale(routing.locales, locale) || !UUID_RE.test(tenantId)) notFound();
  if (!getConfigStatus().auth || !getConfigStatus().database) notFound();
  const detail = await loadPlatformOrganizationDetailForRequest(tenantId);
  if (!detail.ok) notFound();
  const { organization, plan, plans } = detail.value;

  const t = await getTranslations({ locale, namespace: 'platform' });
  const all = await getTranslations({ locale });
  const name = locale === 'en' ? (organization.nameEn ?? organization.nameAr) : organization.nameAr;
  const daysLeft = plan.status === 'trial' ? trialDaysLeft(plan.trialEndsAt) : null;
  const trialEndsOn = plan.trialEndsAt
    ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(plan.trialEndsAt)
    : null;

  return (
    <PlatformShell locale={locale} path="/platform">
      <PageHeader
        breadcrumbs={[
          { label: t('organizationsNav'), href: `/${locale}/platform` },
          { label: name },
        ]}
        breadcrumbsLabel={t('organizationPlan.breadcrumbLabel')}
        title={name}
        description={
          <Badge tone={STATUS_TONE[plan.status]} dot data-testid="organization-status">
            {daysLeft === null
              ? t(`statuses.${plan.status}`)
              : t('organizationPlan.trialDaysLeft', { days: daysLeft })}
          </Badge>
        }
      />
      <OrganizationPlanForm
        value={{
          tenantId,
          planId: plan.planId,
          status: plan.status,
          trialEndsOn,
          maxPeopleOverride: plan.maxPeopleOverride,
          maxStorageGbOverride: plan.maxStorageGbOverride,
          peopleUsed: plan.peopleUsed,
          storageUsed: t('plans.storageGb', { count: gigabytes(plan.storageUsedBytes, locale) }),
        }}
        plans={plans.map((p) => ({
          planId: p.planId,
          name: p.name,
          maxPeople: p.maxPeople,
          maxStorageGb: p.maxStorageGb,
        }))}
        texts={flattenTexts(all.raw('platform'))}
        errors={await authErrorTexts(locale)}
        numbersLocale={`${locale}-u-nu-latn`}
      />
    </PlatformShell>
  );
}
