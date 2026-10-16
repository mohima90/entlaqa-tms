import { getSystemRole } from '@jadarat/platform-rbac';
import { routing } from '@jadarat/platform-i18n/routing';
import { loadPlatformOrganizationsForRequest } from '@jadarat/platform-identity/auth';
import { Badge, type BadgeTone, Card } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import {
  CreateOrganization,
  OrganizationAdminInvite,
} from '../../../components/platform/organizations-console';
import { PlatformShell } from '../../../components/platform/platform-shell';
import { appBaseUrlForRequest } from '../../../lib/app-base-url-request';
import { authErrorTexts } from '../../../lib/auth-texts';
import { getConfigStatus } from '../../../lib/config-status';
import { flattenTexts } from '../../../lib/flatten-texts';
import { inviteCopyTexts } from '../../../lib/invite-copy-texts';
import { platformErrorTexts } from '../../../lib/platform-texts';

const STATUS_TONE: Record<string, BadgeTone> = {
  active: 'success',
  trial: 'info',
  suspended: 'danger',
  cancelled: 'neutral',
};
const ADMIN_TONE: Record<string, BadgeTone> = {
  active: 'success',
  pending: 'warning',
  expired: 'danger',
  none: 'neutral',
};

/**
 * The Platform Super Admin console «مشرف المنصة» — Organizations (FR-ADM-17; Kawadir ATS's
 * (admin)/organizations): stat cards, the organizations table, «إنشاء منظمة» / Create organization and the
 * pending Organization Admin's invitation link. Deny by default, on the server, before anything renders:
 * a verified session (getClaims) of a user the DATABASE says is a Super Admin — everyone else (signed out,
 * any organization's member, any other account) gets 404.
 */
export default async function PlatformOrganizationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  await connection();
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  if (!getConfigStatus().auth || !getConfigStatus().database) notFound();
  const organizations = await loadPlatformOrganizationsForRequest();
  if (!organizations.ok) notFound();

  const t = await getTranslations({ locale, namespace: 'platform' });
  const texts = flattenTexts((await getTranslations({ locale })).raw('platform'));
  const shared = {
    locale,
    texts,
    copyTexts: await inviteCopyTexts(locale),
    errors: { ...(await authErrorTexts(locale)), ...(await platformErrorTexts(locale)) },
    baseUrl: await appBaseUrlForRequest(),
  };
  const rows = organizations.value;
  const dates = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB', {
    dateStyle: 'medium',
    timeZone: 'Asia/Riyadh',
  });
  const orgAdmin = getSystemRole('tenant_admin').name[locale];
  const stats = [
    { key: 'total', value: rows.length },
    { key: 'active', value: rows.filter((r) => r.status === 'active').length },
    {
      key: 'pendingAdmin',
      value: rows.filter((r) => r.adminState === 'pending' || r.adminState === 'expired').length,
    },
  ];

  return (
    <PlatformShell locale={locale} path="/platform">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="mb-1 mt-0 text-2xl font-bold">{t('title')}</h1>
            <p className="m-0 text-text-muted">{t('subtitle')}</p>
          </div>
          <div>
            <CreateOrganization {...shared} />
          </div>
        </div>

        <ul
          className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-3"
          data-testid="platform-stats"
        >
          {stats.map((stat) => (
            <li key={stat.key} className="rounded-lg border border-border bg-surface p-4 shadow-1">
              <p className="m-0 text-sm font-medium text-text-muted">{t(`stats.${stat.key}`)}</p>
              <p className="m-0 mt-1 text-2xl font-bold" data-testid={`platform-stat-${stat.key}`}>
                {stat.value}
              </p>
            </li>
          ))}
        </ul>

        <Card className="overflow-x-auto p-0">
          {rows.length === 0 ? (
            <p className="m-0 p-6 text-text-muted">{t('table.empty')}</p>
          ) : (
            <table className="w-full border-collapse text-start" data-testid="organizations-table">
              <caption className="sr-only">{t('table.caption')}</caption>
              <thead className="bg-surface-sunken text-sm">
                <tr>
                  {['name', 'shortName', 'status', 'created', 'members'].map((key) => (
                    <th
                      key={key}
                      scope="col"
                      className="whitespace-nowrap px-4 py-3 text-start font-semibold"
                    >
                      {t(`table.${key}`)}
                    </th>
                  ))}
                  <th scope="col" className="whitespace-nowrap px-4 py-3 text-start font-semibold">
                    {orgAdmin}
                  </th>
                  <th scope="col" className="whitespace-nowrap px-4 py-3 text-start font-semibold">
                    {t('table.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((org) => {
                  const name = locale === 'en' ? (org.nameEn ?? org.nameAr) : org.nameAr;
                  return (
                    <tr
                      key={org.tenantId}
                      className="border-t border-border align-middle"
                      data-testid="organization-row"
                      data-slug={org.slug}
                    >
                      <th scope="row" className="min-w-40 px-4 py-3 text-start font-medium">
                        {name}
                      </th>
                      <td className="px-4 py-3">
                        <code dir="ltr" className="font-mono text-sm">
                          {org.slug}
                        </code>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={STATUS_TONE[org.status]}>{t(`statuses.${org.status}`)}</Badge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm">
                        {dates.format(org.createdAt)}
                      </td>
                      <td className="px-4 py-3 tabular-nums">{org.memberCount}</td>
                      <td className="px-4 py-3">
                        <Badge tone={ADMIN_TONE[org.adminState]} data-testid="org-admin-state">
                          {t(`adminStates.${org.adminState}`)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {org.adminState === 'pending' || org.adminState === 'expired' ? (
                          <OrganizationAdminInvite
                            {...shared}
                            tenantId={org.tenantId}
                            organizationName={name}
                          />
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </PlatformShell>
  );
}
