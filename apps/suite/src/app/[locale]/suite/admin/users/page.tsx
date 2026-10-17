import { type AppError, toClientError } from '@jadarat/platform-core';
import type { AppLocale, DisplayDateFormatter } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import type { InvitationRow } from '@jadarat/platform-db';
import type { UserImportBannersView } from '@jadarat/platform-import';
import { type UsersListView, invitationGivesPrivilegedRole } from '@jadarat/platform-rbac';
import {
  Alert,
  Avatar,
  Badge,
  type BadgeTone,
  Card,
  EmptyState,
  Icon,
  PageHeader,
  TabNav,
  buttonClasses,
  tableClasses,
  toolbarFieldClasses,
} from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { SuiteShell } from '../../../../../components/suite-shell';
import { TeamStats } from '../../../../../components/users/team-stats';
import { MemberRoleMenu } from '../../../../../components/users/member-role-menu';
import { ReactivateMemberButton } from '../../../../../components/users/reactivate-member-button';
import { roleOptions } from '../../../../../lib/role-choice';
import { editRoleLabels, roleSelectTexts, scopeUnitTexts } from '../../../../../lib/role-texts';
import {
  orgShowsUnitLevels,
  orgUnitsLabel,
  scopeUnitChoices,
  showsUnitLevels,
  unitNameWithLevel,
  unitsLabel,
} from '../../../../../lib/structure-view';
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
import { inviteCopyTexts } from '../../../../../lib/invite-copy-texts';
import { filterInvitations } from '../../../../../lib/invitations-view';
import { profileErrorTexts } from '../../../../../lib/profile-texts';
import { getSuiteContext } from '../../../../../lib/suite-context';
import { pageDates } from '../../../../../lib/page-dates';
import { invitationsListQuery, usersListQuery } from '../../../../../lib/users-queries';
import {
  type UsersListParams,
  localizedName,
  roleName,
  teamCounts,
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
const fieldClass = toolbarFieldClasses;
const selectClass = `${toolbarFieldClasses} select-chevron pe-10`;
/** Views of the Members tab (Kawadir team page): the status filter under it. */
const MEMBER_TABS = ['all', 'active', 'deactivated'] as const;

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
  'noCode',
  'noCodePrivileged',
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
 * Team members (Kawadir team page, T-M2-43: summary cards, then the tabs «الأعضاء» / Members and
 * «الدعوات المعلّقة» / Pending invites; the list is a table in a card under its toolbar). Users list
 * (T-M2-04, screen 1 — FR-IAM-01): only the people the member may see (ADR 0003 §4.2).
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
            canCopyPrivileged={invitations?.ok ? invitations.value.canCopyPrivileged : false}
            banners={banners?.ok ? banners.value : null}
            dates={pageDates(locale, context)}
          />
        </>
      );
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="users" path={languagePath}>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canInvite ? (
            <>
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
                <Icon name="user-plus" />
                {invitationTexts('inviteUser')}
              </a>
            </>
          ) : null
        }
      />
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
  canCopyPrivileged,
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
  /** The member may copy the codes of invitations with a privileged role (the Organization Admin). */
  canCopyPrivileged: boolean;
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
  const counts = teamCounts(list.counts, invitations?.length);
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
  // «تعديل الدور» in the ⋯ menu (EP-ROLES, Kawadir team page): with role.assign, on rows of people the
  // member may manage (not themself; a privileged person only for the Organization Admin).
  const roleMenu =
    view.canAssignRoles && view.roles && activeTab !== 'deactivated'
      ? {
          options: roleOptions(view.roles, locale),
          selectTexts: await roleSelectTexts(locale),
          labels: await editRoleLabels(locale),
          errors: await profileErrorTexts(locale),
          // The unit picker of department-limited custom roles (EP-ORG, T-M3-09).
          scopeUnits: scopeUnitChoices(view.scopeUnits.units, view.scopeUnits.levels, locale),
          unitTexts: await scopeUnitTexts(locale, view.scopeUnits.structureVisible),
        }
      : null;
  const mayEditRole = (row: UsersListView['list']['rows'][number]) =>
    roleMenu !== null &&
    row.rolesVisible &&
    row.mayManage &&
    row.status !== 'suspended' &&
    row.personId !== view.selfPersonId &&
    (!row.privileged || view.canAssignPrivileged);
  const roleText = (code: string, names: { ar: string; en: string } | null) =>
    roleName(locale, code, names);
  // The unit of a department-limited custom role (EP-ORG, T-M3-09) under the role; the giver is told when
  // it was deactivated (or never picked): the role then gives no access through it.
  const limitedToUnit = (code: string) =>
    view.roles?.some(
      (r) => r.code === code && r.kind === 'custom' && r.dataScope === 'departments',
    ) ?? false;
  // The organization's own level names (guided-test feedback #3): unit columns and fields are named after
  // the first level, or «Unit» with each unit's level when the organization has deeper units — decided for
  // the organization, not for the rows of this page, so the column stays the same from page to page.
  const levels = view.levels;
  const withLevels = orgShowsUnitLevels(levels, view.unitsBelowFirstLevel);
  const filterOrdinals = (orgUnits?.departments ?? []).map((d) => d.levelOrdinal);
  const filterWithLevels = showsUnitLevels(levels, filterOrdinals);
  const roleUnit = (row: UsersListView['list']['rows'][number]) => {
    if (!row.primaryRole || !limitedToUnit(row.primaryRole)) return null;
    const unit = row.roleScopeUnit;
    if (!unit) {
      return (
        <Badge tone="warning" data-testid="role-unit-missing">
          {t('unitMissing')}
        </Badge>
      );
    }
    const name = unitNameWithLevel(
      localizedName(locale, unit.nameAr, unit.nameEn),
      unit.levelOrdinal ?? null,
      levels,
      locale,
      withLevels,
    );
    return unit.active ? (
      <span className="text-xs text-text-muted" data-testid="role-unit">
        {t('roleUnit', { unit: name })}
      </span>
    ) : (
      <Badge tone="warning" data-testid="role-unit-inactive">
        {`${name} · ${t('unitInactive')}`}
      </Badge>
    );
  };
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

      <TeamStats
        label={t('statsLabel')}
        counts={counts}
        texts={{
          total: t('stats.total'),
          active: t('stats.active'),
          pending: t('stats.pending'),
          deactivated: t('stats.deactivated'),
        }}
        format={(n) => format.number(n, 'integer')}
        data-testid="users-stats"
      />

      <TabNav
        label={t('viewsLabel')}
        current={activeTab === 'invited' ? 'invited' : 'members'}
        items={[
          {
            key: 'members',
            href: usersListHref(locale, params, { tab: undefined, page: undefined }),
            icon: 'people',
            label: t('tabs.members'),
            count: format.number(counts.all, 'integer'),
          },
          {
            key: 'invited',
            href: usersListHref(locale, params, { tab: 'invited', page: undefined }),
            icon: 'mail',
            label: t('tabs.invited'),
            count: format.number(counts.invited, 'integer'),
          },
        ]}
      />
      {activeTab === 'invited' ? null : (
        <TabNav
          label={t('statusFilterLabel')}
          variant="segmented"
          current={activeTab}
          items={MEMBER_TABS.map((tab) => ({
            key: tab,
            href: usersListHref(locale, params, { tab, page: undefined }),
            label: t(`tabs.${tab}`),
            count: format.number(counts[tab], 'integer'),
          }))}
        />
      )}

      <form
        method="get"
        action={`/${locale}/suite/admin/users`}
        aria-label={t('filtersLabel')}
        className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5 xl:items-end"
      >
        {activeTab !== 'all' ? <input type="hidden" name="tab" value={activeTab} /> : null}
        <div className="flex flex-col gap-1 xl:col-span-2">
          <label htmlFor="users-q" className="text-sm font-medium">
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
          <p id="users-q-hint" className="m-0 text-xs text-text-muted">
            {t('searchHint')}
          </p>
        </div>
        {canReadRoles ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="users-role" className="text-sm font-medium">
              {t('role')}
            </label>
            <select
              id="users-role"
              name="role"
              defaultValue={params.role ?? ''}
              className={selectClass}
            >
              <option value="">{t('allRoles')}</option>
              {(view.roles ?? []).map((role) => (
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
              <label htmlFor="users-department" className="text-sm font-medium">
                {unitsLabel(levels, filterOrdinals, locale, t('department'))}
              </label>
              <select
                id="users-department"
                name="department"
                defaultValue={params.department ?? ''}
                className={selectClass}
              >
                <option value="">{t('allDepartments')}</option>
                {orgUnits.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {unitNameWithLevel(
                      localizedName(locale, d.nameAr, d.nameEn),
                      d.levelOrdinal,
                      levels,
                      locale,
                      filterWithLevels,
                    )}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="users-branch" className="text-sm font-medium">
                {t('branch')}
              </label>
              <select
                id="users-branch"
                name="branch"
                defaultValue={params.branch ?? ''}
                className={selectClass}
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
          <button type="submit" className={buttonClasses({ variant: 'secondary', size: 'md' })}>
            <Icon name="search" />
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
        ? await invitationsTable(locale, invitationRows, canReadRoles, canCopyPrivileged, dates)
        : null}

      {nothingToShow ? (
        <Card data-testid="users-empty">
          <EmptyState
            icon={activeTab === 'invited' ? 'mail' : 'people'}
            title={filtered ? t('emptyFilteredTitle') : t('emptyTitle')}
            description={filtered ? t('emptyFilteredBody') : t('emptyBody')}
          />
        </Card>
      ) : list.rows.length === 0 ? null : (
        <Card flush>
          <div className={tableClasses.wrapper}>
            <table className={tableClasses.table} data-testid="users-table">
              <caption className="sr-only">{t('tableCaption')}</caption>
              <thead className={tableClasses.header}>
                <tr>
                  <th scope="col" className={tableClasses.head}>
                    {t('columns.name')}
                  </th>
                  <th scope="col" className={tableClasses.head}>
                    {t('columns.employeeNumber')}
                  </th>
                  {canReadRoles ? (
                    <th scope="col" className={tableClasses.head}>
                      {t('columns.primaryRole')}
                    </th>
                  ) : null}
                  <th scope="col" className={tableClasses.head} data-testid="users-unit-column">
                    {orgUnitsLabel(
                      levels,
                      view.unitsBelowFirstLevel,
                      locale,
                      t('columns.department'),
                    )}
                  </th>
                  <th scope="col" className={tableClasses.head}>
                    {t('columns.status')}
                  </th>
                  <th scope="col" className={tableClasses.head}>
                    {t('columns.lastSignIn')}
                  </th>
                  {reactivation || roleMenu ? (
                    <th scope="col" className={tableClasses.head}>
                      {reactivation ? (
                        t('columns.actions')
                      ) : (
                        <span className="sr-only">{t('columns.actions')}</span>
                      )}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {list.rows.map((row) => (
                  <tr key={row.personId} className={tableClasses.row}>
                    <td className={tableClasses.cell}>
                      {/* Kawadir Candidates: the person's initials in a soft circle beside the name. */}
                      <div className="flex items-center gap-3">
                        <Avatar
                          name={localizedName(locale, row.displayNameAr, row.displayNameEn)}
                          tone="soft"
                          size="md"
                        />
                        <div className="min-w-0">
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
                        </div>
                      </div>
                    </td>
                    <td className={tableClasses.cell}>
                      {row.employeeNumber ? (
                        <bdi dir="ltr">{row.employeeNumber}</bdi>
                      ) : (
                        <NotSet label={t('noneLabel')} />
                      )}
                    </td>
                    {canReadRoles ? (
                      <td className={tableClasses.cell}>
                        {!row.rolesVisible ? (
                          <NotSet label={t('rolesNotVisible')} />
                        ) : row.primaryRole ? (
                          <div className="flex flex-col items-start gap-1">
                            <span>{roleText(row.primaryRole, row.primaryRoleName)}</span>
                            {roleUnit(row)}
                          </div>
                        ) : (
                          <NotSet label={t('noneLabel')} />
                        )}
                      </td>
                    ) : null}
                    <td className={tableClasses.cell}>
                      {row.departmentNameAr ? (
                        unitNameWithLevel(
                          localizedName(locale, row.departmentNameAr, row.departmentNameEn),
                          row.departmentLevelOrdinal,
                          levels,
                          locale,
                          withLevels,
                        )
                      ) : (
                        <NotSet label={t('noneLabel')} />
                      )}
                    </td>
                    <td className={tableClasses.cell}>
                      <Badge tone={STATUS_TONE[row.status]}>{t(`status.${row.status}`)}</Badge>
                    </td>
                    <td className={tableClasses.cell} data-testid="user-last-sign-in">
                      {row.lastSignInAt ? dates.dateTime(row.lastSignInAt) : t('never')}
                    </td>
                    {reactivation ? (
                      <td className={tableClasses.cell}>
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
                    ) : roleMenu ? (
                      <td className={`${tableClasses.cell} text-end`}>
                        {mayEditRole(row) ? (
                          <MemberRoleMenu
                            personId={row.personId}
                            name={localizedName(locale, row.displayNameAr, row.displayNameEn)}
                            version={row.roleVersion}
                            currentRole={row.primaryRole}
                            currentUnit={row.roleScopeUnit?.id ?? null}
                            options={roleMenu.options}
                            selectTexts={roleMenu.selectTexts}
                            scopeUnits={roleMenu.scopeUnits}
                            unitTexts={roleMenu.unitTexts}
                            labels={roleMenu.labels}
                            errors={roleMenu.errors}
                          />
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
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
/**
 * How a row's code may be copied (security review M2): never in the page — read when copied, through the
 * ordinary or (privileged role) the privileged action; or why there is nothing to copy.
 */
function codeAccess(
  row: InvitationRow,
  canCopyPrivileged: boolean,
): InvitationRowView['codeAccess'] {
  const privileged = invitationGivesPrivilegedRole(row);
  if (row.hasCode) return privileged ? 'copyPrivileged' : 'copy';
  return privileged && !canCopyPrivileged ? 'notAllowed' : 'none';
}

async function invitationsTable(
  locale: AppLocale,
  rows: readonly InvitationRow[],
  canReadRoles: boolean,
  canCopyPrivileged: boolean,
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
      roleName: canReadRoles ? roleName(locale, row.primaryRole, row.primaryRoleName) : null,
      // T-M2-20: a code the mailer did not e-mail is «لم تُرسل الدعوة» / "Not sent", never "Sent once".
      sentText: row.mailNotSent
        ? t('list.mailNotSent')
        : t('list.sentCount', { count: row.sendCount }),
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
      codeAccess: codeAccess(row, canCopyPrivileged),
      sendCount: row.sendCount,
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
        copyTexts={await inviteCopyTexts(locale)}
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
