import { type AppError, toClientError } from '@jadarat/platform-core';
import type { AppLocale } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import { SYSTEM_ROLES, type UsersListView } from '@jadarat/platform-rbac';
import { Alert, Badge, type BadgeTone, buttonClasses } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { SuiteShell } from '../../../../../components/suite-shell';
import { getSuiteContext } from '../../../../../lib/suite-context';
import { usersListQuery } from '../../../../../lib/users-queries';
import {
  type UsersListParams,
  localizedName,
  roleName,
  usersListHref,
  usersListParams,
  usersListPath,
  usersPaging,
} from '../../../../../lib/users-view';
import { NotSet } from '../../../../../components/not-set';

const TABS = ['all', 'active', 'invited', 'deactivated'] as const;
const STATUS_TONE: Record<'active' | 'invited' | 'suspended', BadgeTone> = {
  active: 'success',
  invited: 'info',
  suspended: 'neutral',
};
const fieldClass =
  'min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 text-text';

/** Users list (T-M2-04, screen 1 — FR-IAM-01): only the people the member may see (ADR 0003 §4.2). */
export default async function UsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'users' });

  let body;
  let languagePath = '/suite/admin/users';
  if (!context.live) {
    body = (
      <Alert tone="info" data-testid="users-not-configured">
        {t('notConfigured')}
      </Alert>
    );
  } else {
    const requested = usersListParams(await searchParams);
    let current: UsersListParams = requested;
    // Untrusted query-string values: the query's zod schema validates them (bad values → VALIDATION_FAILED).
    let result = await usersListQuery(requested as Parameters<typeof usersListQuery>[0]);
    let invalidFilters = false;
    if (!result.ok && result.error.code === 'VALIDATION_FAILED') {
      invalidFilters = true;
      current = {};
      result = await usersListQuery({});
    }
    if (!result.ok) {
      if (result.error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      body = await failure(locale, result.error);
    } else {
      const { page, pageSize, list } = result.value;
      const paging = usersPaging(page, pageSize, list.rows.length, list.total);
      // A page past the end (bookmarked, or people left the list): go to the last page instead.
      if (paging.beyondLastPage) {
        redirect(usersListHref(locale, current, { page: String(paging.lastPage) }));
      }
      languagePath = usersListPath(current);
      body = (
        <>
          {invalidFilters ? <Alert tone="warning">{t('invalidFilters')}</Alert> : null}
          <UsersList locale={locale} view={result.value} params={current} />
        </>
      );
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="users" path={languagePath}>
      <h1 className="mb-2 mt-0 text-2xl font-bold">{t('title')}</h1>
      <div className="flex flex-col gap-6">{body}</div>
    </SuiteShell>
  );
}

async function failure(locale: AppLocale, error: AppError) {
  const errors = await getTranslations({ locale, namespace: 'errors' });
  const t = await getTranslations({ locale, namespace: 'users' });
  const client = toClientError(error);
  if (client.code === 'FORBIDDEN') return <Alert tone="warning">{errors('forbidden')}</Alert>;
  return (
    <Alert tone="danger">{t('loadFailed', { correlationId: client.correlationId ?? '' })}</Alert>
  );
}

async function UsersList({
  locale,
  view,
  params,
}: {
  locale: AppLocale;
  view: UsersListView;
  params: UsersListParams;
}) {
  const t = await getTranslations({ locale, namespace: 'users' });
  const format = await getFormatter({ locale });
  const { list, canReadRoles, orgUnits } = view;
  const activeTab = (TABS as readonly string[]).includes(params.tab ?? '')
    ? (params.tab as (typeof TABS)[number])
    : 'all';
  const filtered = Boolean(params.q ?? params.role ?? params.department ?? params.branch);
  const { from, to } = usersPaging(view.page, view.pageSize, list.rows.length, list.total);

  return (
    <>
      <p className="m-0 text-text-muted" data-testid="users-summary">
        {t('summary', { count: list.counts.all })}
        {list.counts.invited > 0
          ? ` · ${t('pendingInvitations', { count: list.counts.invited })}`
          : ''}
      </p>

      <nav aria-label={t('tabsLabel')}>
        <ul className="m-0 flex list-none flex-wrap gap-2 border-b border-border p-0">
          {TABS.map((tab) => (
            <li key={tab}>
              <a
                href={usersListHref(locale, params, { tab, page: undefined })}
                aria-current={tab === activeTab ? 'page' : undefined}
                className={`-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3 no-underline ${
                  tab === activeTab
                    ? 'border-primary font-semibold text-primary-text'
                    : 'border-transparent text-text-muted hover:text-text'
                }`}
              >
                {t(`tabs.${tab}`)}
                <Badge>{format.number(list.counts[tab], 'integer')}</Badge>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <form
        method="get"
        action={`/${locale}/suite/admin/users`}
        aria-label={t('filtersLabel')}
        className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5 xl:items-end"
      >
        {activeTab !== 'all' ? <input type="hidden" name="tab" value={activeTab} /> : null}
        <div className="flex flex-col gap-1 xl:col-span-2">
          <label htmlFor="users-q" className="font-medium">
            {t('search')}
          </label>
          <input
            id="users-q"
            name="q"
            type="search"
            maxLength={100}
            defaultValue={params.q ?? ''}
            aria-describedby="users-q-hint"
            className={fieldClass}
          />
          <p id="users-q-hint" className="m-0 text-sm text-text-muted">
            {t('searchHint')}
          </p>
        </div>
        {canReadRoles ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="users-role" className="font-medium">
              {t('role')}
            </label>
            <select
              id="users-role"
              name="role"
              defaultValue={params.role ?? ''}
              className={fieldClass}
            >
              <option value="">{t('allRoles')}</option>
              {SYSTEM_ROLES.map((role) => (
                <option key={role.code} value={role.code}>
                  {role.name[locale]}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {orgUnits ? (
          <>
            <div className="flex flex-col gap-1">
              <label htmlFor="users-department" className="font-medium">
                {t('department')}
              </label>
              <select
                id="users-department"
                name="department"
                defaultValue={params.department ?? ''}
                className={fieldClass}
              >
                <option value="">{t('allDepartments')}</option>
                {orgUnits.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {localizedName(locale, d.nameAr, d.nameEn)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="users-branch" className="font-medium">
                {t('branch')}
              </label>
              <select
                id="users-branch"
                name="branch"
                defaultValue={params.branch ?? ''}
                className={fieldClass}
              >
                <option value="">{t('allBranches')}</option>
                {orgUnits.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {localizedName(locale, b.nameAr, b.nameEn)}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : null}
        <div className="flex flex-wrap gap-2 xl:col-span-5">
          <button type="submit" className={buttonClasses({ variant: 'primary', size: 'md' })}>
            {t('apply')}
          </button>
          {filtered ? (
            <a
              href={usersListHref(locale, params.tab ? { tab: params.tab } : {})}
              className={buttonClasses({ variant: 'ghost', size: 'md' })}
            >
              {t('clearFilters')}
            </a>
          ) : null}
        </div>
      </form>

      {list.rows.length === 0 ? (
        <div
          className="rounded-lg border border-border bg-surface p-6 text-center"
          data-testid="users-empty"
        >
          <h2 className="m-0 text-lg font-semibold">
            {filtered ? t('emptyFilteredTitle') : t('emptyTitle')}
          </h2>
          <p className="mb-0 mt-2 text-text-muted">
            {filtered ? t('emptyFilteredBody') : t('emptyBody')}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full border-collapse text-start" data-testid="users-table">
            <caption className="sr-only">{t('tableCaption')}</caption>
            <thead className="bg-surface-sunken text-sm">
              <tr>
                <th scope="col" className="px-4 py-3 text-start font-semibold">
                  {t('columns.name')}
                </th>
                <th scope="col" className="px-4 py-3 text-start font-semibold">
                  {t('columns.employeeNumber')}
                </th>
                {canReadRoles ? (
                  <th scope="col" className="px-4 py-3 text-start font-semibold">
                    {t('columns.primaryRole')}
                  </th>
                ) : null}
                <th scope="col" className="px-4 py-3 text-start font-semibold">
                  {t('columns.department')}
                </th>
                <th scope="col" className="px-4 py-3 text-start font-semibold">
                  {t('columns.status')}
                </th>
                <th scope="col" className="px-4 py-3 text-start font-semibold">
                  {t('columns.lastSignIn')}
                </th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((row) => (
                <tr key={row.personId} className="border-t border-border">
                  <td className="px-4 py-3">
                    <a
                      href={`/${locale}/suite/admin/users/${row.personId}`}
                      className="font-medium"
                    >
                      {localizedName(locale, row.displayNameAr, row.displayNameEn)}
                    </a>
                    {row.email ? (
                      <div className="text-sm text-text-muted">
                        <bdi dir="ltr">{row.email}</bdi>
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    {row.employeeNumber ? (
                      <bdi dir="ltr">{row.employeeNumber}</bdi>
                    ) : (
                      <NotSet label={t('noneLabel')} />
                    )}
                  </td>
                  {canReadRoles ? (
                    <td className="px-4 py-3">
                      {row.primaryRole ? (
                        roleName(locale, row.primaryRole)
                      ) : (
                        <NotSet label={t('noneLabel')} />
                      )}
                      {row.otherRoles.length > 0 ? (
                        <div className="text-sm text-text-muted">
                          {t('otherRoles', { count: row.otherRoles.length })}
                        </div>
                      ) : null}
                    </td>
                  ) : null}
                  <td className="px-4 py-3">
                    {row.departmentNameAr ? (
                      localizedName(locale, row.departmentNameAr, row.departmentNameEn)
                    ) : (
                      <NotSet label={t('noneLabel')} />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[row.status]}>{t(`status.${row.status}`)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {row.lastSignInAt ? format.dateTime(row.lastSignInAt, 'dateTime') : t('never')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {list.total > 0 ? (
        <nav
          aria-label={t('paginationLabel')}
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <p className="m-0 text-sm text-text-muted">
            {t('pageRange', { from, to, total: list.total })}
          </p>
          <div className="flex gap-2">
            {view.page > 1 ? (
              <a
                href={usersListHref(locale, params, { page: String(view.page - 1) })}
                rel="prev"
                className={buttonClasses({ variant: 'secondary', size: 'md' })}
              >
                {t('previous')}
              </a>
            ) : null}
            {to < list.total ? (
              <a
                href={usersListHref(locale, params, { page: String(view.page + 1) })}
                rel="next"
                className={buttonClasses({ variant: 'secondary', size: 'md' })}
              >
                {t('next')}
              </a>
            ) : null}
          </div>
        </nav>
      ) : null}
    </>
  );
}
