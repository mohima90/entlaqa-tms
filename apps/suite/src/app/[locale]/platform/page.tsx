import { getSystemRole } from '@jadarat/platform-rbac';
import { routing } from '@jadarat/platform-i18n/routing';
import { loadPlatformOrganizationsForRequest } from '@jadarat/platform-identity/auth';
import {
  Badge,
  type BadgeTone,
  EmptyState,
  ListCard,
  ListCards,
  PageHeader,
  ViewCards,
  buttonClasses,
  initialsOf,
  tableClasses,
} from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import {
  CreateOrganization,
  OrganizationAdminInvite,
} from '../../../components/platform/organizations-console';
import { OrganizationsSearch } from '../../../components/platform/organizations-search';
import { PlatformShell } from '../../../components/platform/platform-shell';
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
  // The issuer is no longer a Super Admin: the link no longer works (review M1).
  issuer_revoked: 'danger',
  pending: 'warning',
  expired: 'danger',
  none: 'neutral',
};

const VIEWS = ['all', 'active', 'pending'] as const;
type View = (typeof VIEWS)[number];

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? '';

/**
 * The Platform Super Admin console «مشرف المنصة» — Organizations (FR-ADM-17; Kawadir ATS's
 * (admin)/organizations), redesign package 5 (direction C): the three figures are saved-view cards
 * (Organizations · Active · Organization Admin pending) that filter the list, a search by name or short
 * name, the organizations table (cards on phones), «إنشاء منظمة» / Create organization in a side panel and
 * the pending Organization Admin's invitation link. Both filters work on the rows already read. Deny by
 * default, on the server, before anything renders: a verified session (getClaims) of a user the DATABASE
 * says is a Super Admin — everyone else (signed out, any organization's member, any other account) gets 404.
 */
export default async function PlatformOrganizationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  if (!getConfigStatus().auth || !getConfigStatus().database) notFound();
  const organizations = await loadPlatformOrganizationsForRequest();
  if (!organizations.ok) notFound();

  const query = await searchParams;
  const requestedView = first(query.view);
  const view: View = (VIEWS as readonly string[]).includes(requestedView)
    ? (requestedView as View)
    : 'all';
  const q = first(query.q).trim().slice(0, 100);

  const t = await getTranslations({ locale, namespace: 'platform' });
  const common = await getTranslations({ locale, namespace: 'common' });
  const texts = flattenTexts((await getTranslations({ locale })).raw('platform'));
  const shared = {
    locale,
    texts,
    copyTexts: await inviteCopyTexts(locale),
    errors: { ...(await authErrorTexts(locale)), ...(await platformErrorTexts(locale)) },
    closeLabel: common('close'),
  };
  const rows = organizations.value;
  const dates = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB', {
    dateStyle: 'medium',
    timeZone: 'Asia/Riyadh',
  });
  const numbers = new Intl.NumberFormat(`${locale}-u-nu-latn`);
  const orgAdmin = getSystemRole('tenant_admin').name[locale];
  const isPending = (r: (typeof rows)[number]) =>
    r.adminState === 'pending' || r.adminState === 'expired' || r.adminState === 'issuer_revoked';
  const counts: Record<View, number> = {
    all: rows.length,
    active: rows.filter((r) => r.status === 'active').length,
    pending: rows.filter(isPending).length,
  };
  const nameOf = (org: (typeof rows)[number]) =>
    locale === 'en' ? (org.nameEn ?? org.nameAr) : org.nameAr;

  const needle = q.toLowerCase();
  const shown = rows
    .filter((r) =>
      view === 'active' ? r.status === 'active' : view === 'pending' ? isPending(r) : true,
    )
    .filter(
      (r) =>
        needle === '' ||
        [r.nameAr, r.nameEn ?? '', r.slug].some((value) => value.toLowerCase().includes(needle)),
    );

  const path = `/${locale}/platform`;
  const viewHref = (key: View) => {
    const parts = [
      key === 'all' ? '' : `view=${key}`,
      q === '' ? '' : `q=${encodeURIComponent(q)}`,
    ];
    const search = parts.filter(Boolean).join('&');
    return search === '' ? path : `${path}?${search}`;
  };
  const searchBase = view === 'all' ? path : `${path}?view=${view}`;

  const invite = (org: (typeof rows)[number]) =>
    org.adminState === 'pending' ||
    org.adminState === 'expired' ||
    org.adminState === 'issuer_revoked' ? (
      <OrganizationAdminInvite
        {...shared}
        tenantId={org.tenantId}
        organizationName={nameOf(org)}
        adminState={org.adminState}
      />
    ) : null;

  const adminPill = (org: (typeof rows)[number]) => (
    <Badge tone={ADMIN_TONE[org.adminState]} dot data-testid="org-admin-state">
      {t(`adminStates.${org.adminState}`)}
    </Badge>
  );

  return (
    <PlatformShell locale={locale} path="/platform">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={<CreateOrganization {...shared} />}
      />

      <div className="flex flex-col gap-4">
        <ViewCards
          label={t('title')}
          current={view}
          data-testid="platform-stats"
          items={VIEWS.map((key) => ({
            key,
            href: viewHref(key),
            label: t(
              `stats.${key === 'all' ? 'total' : key === 'active' ? 'active' : 'pendingAdmin'}`,
            ),
            count: (
              <span
                data-testid={`platform-stat-${key === 'all' ? 'total' : key === 'active' ? 'active' : 'pendingAdmin'}`}
              >
                {numbers.format(counts[key])}
              </span>
            ),
          }))}
        />

        {rows.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface">
            <EmptyState icon="building" title={t('table.empty')} description={t('create.intro')} />
          </div>
        ) : (
          <>
            <OrganizationsSearch
              q={q}
              base={searchBase}
              label={t('search')}
              placeholder={t('search')}
              resultText={t('resultCount', { count: shown.length })}
            />
            {shown.length === 0 ? (
              <div className="rounded-xl border border-border bg-surface" data-testid="no-match">
                <EmptyState
                  icon="search"
                  title={t('noMatch.title')}
                  description={t('noMatch.body')}
                  action={
                    <a
                      href={view === 'all' ? path : `${path}?view=${view}`}
                      className={buttonClasses({ variant: 'secondary' })}
                    >
                      {t('noMatch.clear')}
                    </a>
                  }
                />
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border bg-surface">
                <div className="hidden md:block">
                  <div className={tableClasses.wrapper}>
                    <table className={tableClasses.table} data-testid="organizations-table">
                      <caption className="sr-only">{t('table.caption')}</caption>
                      <thead className={tableClasses.header}>
                        <tr>
                          <th scope="col" className={tableClasses.head}>
                            {t('table.name')}
                          </th>
                          <th scope="col" className={tableClasses.head}>
                            {t('table.status')}
                          </th>
                          <th scope="col" className={tableClasses.head}>
                            {orgAdmin}
                          </th>
                          <th scope="col" className={tableClasses.head}>
                            {t('table.members')}
                          </th>
                          <th scope="col" className={tableClasses.head}>
                            {t('table.created')}
                          </th>
                          <th scope="col" className={tableClasses.head}>
                            <span className="sr-only">{t('table.actions')}</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((org) => (
                          <tr
                            key={org.tenantId}
                            className={tableClasses.row}
                            data-testid="organization-row"
                            data-slug={org.slug}
                          >
                            <th
                              scope="row"
                              className={`${tableClasses.cell} text-start font-normal`}
                            >
                              <div className="flex items-center gap-3">
                                <span
                                  aria-hidden="true"
                                  className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-primary-subtle text-sm font-bold text-primary-text"
                                >
                                  {initialsOf(nameOf(org))}
                                </span>
                                <span className="min-w-0">
                                  <span className="block font-semibold">{nameOf(org)}</span>
                                  <code dir="ltr" className="font-mono text-sm text-text-muted">
                                    {org.slug}
                                  </code>
                                </span>
                              </div>
                            </th>
                            <td className={tableClasses.cell}>
                              <Badge tone={STATUS_TONE[org.status]} dot>
                                {t(`statuses.${org.status}`)}
                              </Badge>
                            </td>
                            <td className={tableClasses.cell}>{adminPill(org)}</td>
                            <td className={`${tableClasses.cell} tabular-nums`}>
                              {numbers.format(org.memberCount)}
                            </td>
                            <td
                              className={`${tableClasses.cell} whitespace-nowrap text-text-muted`}
                            >
                              {dates.format(org.createdAt)}
                            </td>
                            <td className={`${tableClasses.cell} text-end`}>{invite(org)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <ListCards aria-label={t('table.caption')} data-testid="organizations-cards">
                  {shown.map((org) => (
                    <ListCard
                      key={org.tenantId}
                      data-testid="organization-card"
                      data-slug={org.slug}
                      leading={
                        <span
                          aria-hidden="true"
                          className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-primary-subtle text-sm font-bold text-primary-text"
                        >
                          {initialsOf(nameOf(org))}
                        </span>
                      }
                      title={nameOf(org)}
                      detail={
                        <>
                          <code dir="ltr" className="font-mono">
                            {org.slug}
                          </code>
                          {` · ${t('table.members')}: ${numbers.format(org.memberCount)} · ${dates.format(org.createdAt)}`}
                        </>
                      }
                      status={
                        <span className="flex flex-col items-start gap-2">
                          <span className="flex flex-wrap gap-1.5">
                            <Badge tone={STATUS_TONE[org.status]} dot>
                              {t(`statuses.${org.status}`)}
                            </Badge>
                            {adminPill(org)}
                          </span>
                          {invite(org)}
                        </span>
                      }
                    />
                  ))}
                </ListCards>
              </div>
            )}
          </>
        )}
      </div>
    </PlatformShell>
  );
}
