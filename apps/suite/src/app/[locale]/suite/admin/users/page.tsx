import { type AppError, toClientError } from '@jadarat/platform-core';
import type { AppLocale, DisplayDateFormatter } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import type { InvitationRow } from '@jadarat/platform-db';
import type { UserImportBannersView } from '@jadarat/platform-import';
import { SYSTEM_ROLES, type UsersListView } from '@jadarat/platform-rbac';
import { Alert, Badge, type BadgeTone, buttonClasses } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { SuiteShell } from '../../../../../components/suite-shell';
import { ReactivateMemberButton } from '../../../../../components/users/reactivate-member-button';
import {
  ExpiredInvitationsBanner,
  type InvitationRowView,
  InvitationsTable,
} from '../../../../../components/users/invitations-table';
import {
  DEACTIVATED_FLASH_PARAM,
  REACTIVATED_FLASH_PARAM,
} from '../../../../../lib/deactivate-form';
import { reactivateLabels } from '../../../../../lib/deactivation-texts';
import { INVITED_FLASH_PARAM, canResend } from '../../../../../lib/invite-form';
import { filterInvitations } from '../../../../../lib/invitations-view';
import { profileErrorTexts } from '../../../../../lib/profile-texts';
import { getSuiteContext } from '../../../../../lib/suite-context';
import { pageDates } from '../../../../../lib/page-dates';
import { invitationsListQuery, usersListQuery } from '../../../../../lib/users-queries';
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
import { SendInvitationsButton } from '../../../../../components/user-import/send-invitations-button';
import { userImportBannersQuery } from '../../../../../lib/user-import-queries';
import { count, isolate } from '../../../../../lib/user-import-view';

const TABS = ['all', 'active', 'invited', 'deactivated'] as const;
const STATUS_TONE: Record<'active' | 'invited' | 'suspended', BadgeTone> = {
  active: 'success',
  invited: 'info',
  suspended: 'neutral',
};
const fieldClass =
  'min-h-11 w-full rounded-md border border-border-strong bg-surface px-3 text-text';

/** Text keys of the invitations table and banner (namespace `invitations.list`). */
const INVITATION_LIST_KEYS = [
  'tableCaption',
  'columns.name',
  'columns.primaryRole',
  'columns.status',
  'columns.sent',
  'columns.actions',
  'status.pending',
  'status.expired',
  'status.held',
  'status.scheduled',
  'sendHeld',
  'sentHeld',
  'nothingToSend',
  'sendNotAllowed',
  'resend',
  'resent',
  'resendLimit',
  'resendLimitShort',
  'revoke',
  'revoked',
  'revokeConfirmButton',
  'keep',
  'working',
  'notPending',
  'roleNotAllowed',
] as const;
/** Keys whose `{name}` / `{count}` the client fills in (read raw). */
const INVITATION_RAW_KEYS = ['revokeConfirm', 'resentExpired'] as const;
/** The invited tab shows at most this many invitations (newest first); search reaches the others. */
const INVITATIONS_SHOWN = 500;

/**
 * Users list (T-M2-04, screen 1 — FR-IAM-01): only the people the member may see (ADR 0003 §4.2).
 * Holders of `platform.user.invite` also see «دعوة مستخدم» and, on the `invited` tab, the pending and
 * expired invitations with resend and revoke (T-M2-07, FR-IAM-03). Holders of `platform.user.deactivate`
 * reactivate members from the `deactivated` tab (T-M2-09, FR-IAM-05). Bulk import (T-M2-12, FR-IAM-04;
 * approved import screen 1): «استيراد من ملف», a banner while an import runs, and a banner with
 * «إرسال الدعوات (N)» for people an import added without their invitations («لم تُرسل الدعوة»).
 */
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
  const invitationTexts = await getTranslations({ locale, namespace: 'invitations' });
  const deactivationTexts = await getTranslations({ locale, namespace: 'deactivation' });
  const importTexts = await getTranslations({ locale, namespace: 'userImport' });

  let body;
  let canInvite = false;
  let languagePath = '/suite/admin/users';
  if (!context.live) {
    body = (
      <Alert tone="info" data-testid="users-not-configured">
        {t('notConfigured')}
      </Alert>
    );
  } else {
    const raw = await searchParams;
    const requested = usersListParams(raw);
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
      canInvite = result.value.canInvite;
      // Invitations (T-M2-07) come from platform.invitations, not from the memberships list.
      const invitations = canInvite ? await invitationsListQuery({}) : null;
      const invitationsError =
        invitations !== null && !invitations.ok ? toClientError(invitations.error) : null;
      // The import banners (T-M2-12) share the invite permission; a failure only hides them.
      const banners = canInvite ? await userImportBannersQuery({}) : null;
      body = (
        <>
          {raw[INVITED_FLASH_PARAM] === '1' && canInvite ? (
            <Alert tone="success" data-testid="invitation-created">
              {invitationTexts('list.created')}
            </Alert>
          ) : null}
          {raw[DEACTIVATED_FLASH_PARAM] === '1' && result.value.canDeactivate ? (
            <Alert tone="success" data-testid="member-deactivated">
              {deactivationTexts('deactivated')}
            </Alert>
          ) : null}
          {raw[REACTIVATED_FLASH_PARAM] === '1' && result.value.canDeactivate ? (
            <Alert tone="success" data-testid="member-reactivated">
              {deactivationTexts('reactivate.done')}
            </Alert>
          ) : null}
          {invalidFilters ? <Alert tone="warning">{t('invalidFilters')}</Alert> : null}
          {invitationsError ? (
            <Alert tone="danger">
              {t('loadFailed', { correlationId: invitationsError.correlationId ?? '' })}
            </Alert>
          ) : null}
          <UsersList
            locale={locale}
            view={result.value}
            params={current}
            invitations={invitations?.ok ? invitations.value.invitations : null}
            banners={banners?.ok ? banners.value : null}
            dates={pageDates(locale, context)}
          />
        </>
      );
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="users" path={languagePath}>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-4">
        <h1 className="m-0 text-2xl font-bold">{t('title')}</h1>
        {canInvite ? (
          <div className="flex flex-wrap gap-2">
            <a
              href={`/${locale}/suite/admin/users/import`}
              className={buttonClasses({ variant: 'secondary', size: 'md' })}
              data-testid="import-users-link"
            >
              {importTexts('entry')}
            </a>
            <a
              href={`/${locale}/suite/admin/users/invite`}
              className={buttonClasses({ variant: 'primary', size: 'md' })}
              data-testid="invite-user-link"
            >
              {invitationTexts('inviteUser')}
            </a>
          </div>
        ) : null}
      </div>
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
  invitations,
  banners,
  dates,
}: {
  locale: AppLocale;
  /** Dates as the organization shows them (T-M2-22: Gregorian / Hijri / both, its time zone). */
  dates: DisplayDateFormatter;
  view: UsersListView;
  params: UsersListParams;
  /** Open invitations (null: the member may not invite, or they did not load). */
  invitations: readonly InvitationRow[] | null;
  /** A running import; people added without invitations (null: not shown). */
  banners: UserImportBannersView | null;
}) {
  const t = await getTranslations({ locale, namespace: 'users' });
  const importTexts = await getTranslations({ locale, namespace: 'userImport' });
  const format = await getFormatter({ locale });
  const { list, canReadRoles, orgUnits } = view;
  const activeTab = (TABS as readonly string[]).includes(params.tab ?? '')
    ? (params.tab as (typeof TABS)[number])
    : 'all';
  const filtered = Boolean(params.q ?? params.role ?? params.department ?? params.branch);
  const { from, to } = usersPaging(view.page, view.pageSize, list.rows.length, list.total);
  // The invited tab counts invited memberships (before T-M2-07) and open invitations.
  const counts = { ...list.counts, invited: list.counts.invited + (invitations?.length ?? 0) };
  const invitationRows =
    activeTab === 'invited' && invitations
      ? filterInvitations(invitations, {
          q: params.q,
          role: canReadRoles ? params.role : undefined,
          department: orgUnits ? params.department : undefined,
          branch: orgUnits ? params.branch : undefined,
        })
      : [];
  const expired = (invitations ?? []).filter((row) => row.state === 'expired');
  const held = (invitations ?? []).filter((row) => row.state === 'held').length;
  const nothingToShow = list.rows.length === 0 && invitationRows.length === 0;
  // «إعادة التفعيل» on the deactivated tab (T-M2-09): rows the member may manage; privileged members only
  // with role.assign_privileged (the Organization Admin; no authenticator code since 14 Oct 2026).
  const showActions = activeTab === 'deactivated' && view.canDeactivate;
  const reactivation = showActions
    ? {
        labels: await reactivateLabels(locale),
        errors: await profileErrorTexts(locale),
        successHref: withFlash(usersListHref(locale, params), REACTIVATED_FLASH_PARAM),
      }
    : null;

  return (
    <>
      <p className="m-0 text-text-muted" data-testid="users-summary">
        {t('summary', { count: list.counts.all })}
        {counts.invited - held > 0
          ? ` · ${t('pendingInvitations', { count: counts.invited - held })}`
          : ''}
        {held > 0 ? ` · ${importTexts('heldSummary', { count: held })}` : ''}
      </p>

      {banners ? await importBanners(locale, banners) : null}
      {expired.length > 0 ? await expiredBanner(locale, expired) : null}

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
                <Badge>{format.number(counts[tab], 'integer')}</Badge>
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

      {invitationRows.length > 0
        ? await invitationsTable(locale, invitationRows, canReadRoles, dates)
        : null}

      {nothingToShow ? (
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
      ) : list.rows.length === 0 ? null : (
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
                {reactivation ? (
                  <th scope="col" className="px-4 py-3 text-start font-semibold">
                    {t('columns.actions')}
                  </th>
                ) : null}
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
                      {!row.rolesVisible ? (
                        <NotSet label={t('rolesNotVisible')} />
                      ) : row.primaryRole ? (
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
                  <td className="px-4 py-3 text-sm" data-testid="user-last-sign-in">
                    {row.lastSignInAt ? dates.dateTime(row.lastSignInAt) : t('never')}
                  </td>
                  {reactivation ? (
                    <td className="px-4 py-3">
                      {row.status !== 'suspended' || !row.mayManage ? (
                        <NotSet label={t('noneLabel')} />
                      ) : row.privileged && view.privilegedReactivation !== 'allowed' ? (
                        <NotSet label={t('noneLabel')} />
                      ) : (
                        <ReactivateMemberButton
                          personId={row.personId}
                          name={localizedName(locale, row.displayNameAr, row.displayNameEn)}
                          privileged={row.privileged}
                          labels={reactivation.labels}
                          errors={reactivation.errors}
                          successHref={reactivation.successHref}
                          compact
                        />
                      )}
                    </td>
                  ) : null}
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

/** `href` with a flash parameter (`…?x=1` or `…&x=1`). */
function withFlash(href: string, param: string): string {
  return `${href}${href.includes('?') ? '&' : '?'}${param}=1`;
}

async function invitationLabels(locale: AppLocale): Promise<Record<string, string>> {
  const t = await getTranslations({ locale, namespace: 'invitations' });
  const labels: Record<string, string> = Object.fromEntries(
    INVITATION_LIST_KEYS.map((k) => [k, t(`list.${k}`)]),
  );
  for (const key of INVITATION_RAW_KEYS) labels[key] = String(t.raw(`list.${key}`));
  return labels;
}

/**
 * Open invitations of the `invited` tab (T-M2-07, screen 1): pending, expired, and — from a bulk import
 * (T-M2-12) — held («لم تُرسل الدعوة») and scheduled. At most INVITATIONS_SHOWN rows (newest first).
 */
async function invitationsTable(
  locale: AppLocale,
  rows: readonly InvitationRow[],
  canReadRoles: boolean,
  dates: DisplayDateFormatter,
) {
  const t = await getTranslations({ locale, namespace: 'invitations' });
  const shown = rows.slice(0, INVITATIONS_SHOWN);
  const views: InvitationRowView[] = [];
  for (const row of shown) {
    if (row.state === 'accepted' || row.state === 'revoked') continue;
    const date = dates.date(row.expiresAt);
    const fromImport = row.importId
      ? t('list.fromImport', { date: dates.date(row.createdAt) })
      : null;
    views.push({
      id: row.id,
      name: localizedName(locale, row.displayNameAr, row.displayNameEn),
      email: row.email,
      profileHref: `/${locale}/suite/admin/users/${row.personId}`,
      roleName: canReadRoles ? roleName(locale, row.primaryRole) : null,
      sentText: t('list.sentCount', { count: row.sendCount }),
      expiryText:
        row.state === 'held'
          ? ''
          : row.state === 'scheduled'
            ? t('list.scheduledHint')
            : row.state === 'expired'
              ? t('list.expiredOn', { date })
              : t('list.expiresOn', { date }),
      state: row.state,
      fromImportText: fromImport,
      canResend: canResend(row),
    });
  }
  return (
    <>
      {rows.length > shown.length ? (
        <Alert tone="info" data-testid="invitations-capped">
          {t('list.capped', { shown: shown.length, total: rows.length })}
        </Alert>
      ) : null}
      <InvitationsTable
        rows={views}
        showRole={canReadRoles}
        labels={await invitationLabels(locale)}
        errors={await profileErrorTexts(locale)}
      />
    </>
  );
}

/**
 * Import banners of screen 1 (T-M2-12, approved import screen 1): an import running (or being undone),
 * with «عرض التقدم»; people the latest import added without invitations, with «إرسال الدعوات (N)».
 */
async function importBanners(locale: AppLocale, banners: UserImportBannersView) {
  const t = await getTranslations({ locale, namespace: 'userImport' });
  const { running, held } = banners;
  const planned = running
    ? count(running.reviewCounts, 'new') + count(running.reviewCounts, 'existing')
    : 0;
  return (
    <>
      {running ? (
        <Alert tone="info" data-testid="import-running-banner">
          <div className="flex flex-wrap items-center gap-3">
            <span className="min-w-0 flex-1 basis-80">
              {running.status === 'undoing'
                ? t('banners.runningUndo', { name: isolate(running.fileName) })
                : t('banners.running', {
                    name: isolate(running.fileName),
                    done: Math.min(running.rowsDone, planned),
                    total: planned,
                  })}
            </span>
            <a
              href={`/${locale}/suite/admin/users/import/${running.id}`}
              className={buttonClasses({ variant: 'secondary', size: 'md' })}
            >
              {t('banners.viewProgress')}
            </a>
          </div>
        </Alert>
      ) : null}
      {held.latest ? (
        <Alert tone="warning" data-testid="import-held-banner">
          <div className="flex flex-wrap items-center gap-3">
            <span className="min-w-0 flex-1 basis-80">
              {t('banners.held', { count: held.latest.held, name: isolate(held.latest.fileName) })}
            </span>
            <SendInvitationsButton
              importId={held.latest.importId}
              label={t('banners.sendAll', { count: held.latest.held })}
              workingLabel={t('banners.sending')}
              doneText={t('banners.sent')}
              nothingText={(await getTranslations({ locale, namespace: 'invitations' }))(
                'list.nothingToSend',
              )}
              notAllowedText={(await getTranslations({ locale, namespace: 'invitations' }))(
                'list.sendNotAllowed',
              )}
              errors={await profileErrorTexts(locale)}
              variant="secondary"
              testId="import-send-held"
            />
          </div>
        </Alert>
      ) : null}
    </>
  );
}

/** Screen 1 banner: invitations that expired before acceptance, with a bulk resend. */
async function expiredBanner(locale: AppLocale, expired: readonly InvitationRow[]) {
  const t = await getTranslations({ locale, namespace: 'invitations' });
  const ids = expired.filter((row) => canResend(row)).map((row) => row.id);
  const labels = await invitationLabels(locale);
  labels.resendExpired = t('list.resendExpired', { count: ids.length });
  return (
    <ExpiredInvitationsBanner
      ids={ids}
      message={t('list.expiredBanner', { count: expired.length })}
      labels={labels}
      errors={await profileErrorTexts(locale)}
    />
  );
}
