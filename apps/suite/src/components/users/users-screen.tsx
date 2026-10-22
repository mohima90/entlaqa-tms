import 'server-only';
import { type AppError, toClientError } from '@jadarat/platform-core';
import type { InvitationRow } from '@jadarat/platform-db';
import type { AppLocale, DisplayDateFormatter } from '@jadarat/platform-i18n';
import type { UserImportBannersView } from '@jadarat/platform-import';
import {
  type InviteFormView,
  type UsersListView,
  invitationGivesPrivilegedRole,
} from '@jadarat/platform-rbac';
import {
  Alert,
  AttentionItem,
  AttentionStrip,
  Card,
  EmptyState,
  Icon,
  PageHeader,
  Pagination,
  ViewCards,
  buttonClasses,
} from '@jadarat/ui';
import { getFormatter, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ReturnedFocus } from '../../lib/focus-return';
import { reactivateLabels } from '../../lib/deactivation-texts';
import { canResend } from '../../lib/invite-form';
import { inviteCopyTexts } from '../../lib/invite-copy-texts';
import { expiryFrom, filterInvitations } from '../../lib/invitations-view';
import { pageDates } from '../../lib/page-dates';
import { profileErrorTexts } from '../../lib/profile-texts';
import { roleOptions } from '../../lib/role-choice';
import { editRoleLabels, roleSelectTexts, scopeUnitTexts } from '../../lib/role-texts';
import {
  orgShowsUnitLevels,
  orgUnitsLabel,
  scopeUnitChoices,
  showsUnitLevels,
  unitNameWithLevel,
  unitsLabel,
} from '../../lib/structure-view';
import { type SuiteContext, getSuiteContext } from '../../lib/suite-context';
import { userImportBannersQuery } from '../../lib/user-import-queries';
import { count, isolate } from '../../lib/user-import-view';
import { invitationsListQuery, inviteFormQuery, usersListQuery } from '../../lib/users-queries';
import { usersInviteHref } from '../../lib/users-list-href';
import {
  type UsersListParams,
  localizedName,
  roleName,
  teamCounts,
  usersListHref,
  usersListParams,
  usersListPath,
  usersPaging,
} from '../../lib/users-view';
import { SuiteShell } from '../suite-shell';
import { SendInvitationsButton } from '../user-import/send-invitations-button';
import { type InvitationRowView, InvitationsTable, ResendExpiredButton } from './invitations-table';
import { InviteUserPanel } from './invite-user-form';
import { type MemberRowView, MembersTable } from './members-table';
import { UsersFilters } from './users-filters';

const TABS = ['all', 'active', 'invited', 'deactivated'] as const;

/** Text keys of the invitations table (namespace `invitations.list`). */
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
/** The invited view shows at most this many invitations (newest first); search reaches the others. */
const INVITATIONS_SHOWN = 500;

/** Text keys of the invite panel (namespace `invitations.form`). */
const INVITE_LABEL_KEYS = [
  'person',
  'email',
  'emailHint',
  'firstNameAr',
  'familyNameAr',
  'addArabicName',
  'addEnglishName',
  'firstNameEn',
  'familyNameEn',
  'department',
  'noDepartment',
  'branch',
  'noBranch',
  'manager',
  'noManager',
  'managerHint',
  'managerHintAll',
  'allDepartmentsManagers',
  'departmentManagersOnly',
  'employeeNumber',
  'employeeNumberHint',
  'role',
  'roleHint',
  'departmentsHint',
  'rolesHelp',
  'language',
  'submit',
  'submitting',
] as const;
const INVITE_FIELD_ERROR_KEYS = [
  'required',
  'name',
  'email',
  'emailTaken',
  'employeeNumber',
  'employeeNumberTaken',
  'roleRequired',
  'roleNotAllowed',
  'roleUnknown',
  'unit',
  'manager',
] as const;

/**
 * Team members (T-M2-04 screen 1, FR-IAM-01; redesign package 3 — Asana, Mercury, Attio, Deputy, Plain):
 * the view cards (All · Active · Pending invites · Deactivated), one «Needs your attention» strip (an import
 * running, people added without invitations, invitations expired), the search and filter pills that apply
 * at once (the address keeps them), and the members — a table, or one card per person on phones — with a
 * quick look and a ⋯ menu per person. Only the people the member may see (ADR 0003 §4.2); invitations,
 * import lines and actions with their own permissions, as before (T-M2-07, T-M2-09, T-M2-12, EP-ROLES).
 * `invite`: the address `/users/invite` — the same list with the invite panel open.
 */
export async function UsersScreen({
  locale,
  searchParams,
  invite,
}: {
  readonly locale: AppLocale;
  readonly searchParams: Record<string, string | string[] | undefined>;
  readonly invite: boolean;
}) {
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'users' });
  const invitationTexts = await getTranslations({ locale, namespace: 'invitations' });
  const importTexts = await getTranslations({ locale, namespace: 'userImport' });

  let body: ReactNode;
  let canInvite = false;
  let current: UsersListParams = {};
  let languagePath = invite ? '/suite/admin/users/invite' : '/suite/admin/users';
  let panel: ReactNode = null;
  if (!context.live) {
    body = (
      <Alert tone="info" data-testid="users-not-configured">
        {t('notConfigured')}
      </Alert>
    );
  } else {
    const requested = usersListParams(searchParams);
    current = requested;
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
      if (paging.beyondLastPage && !invite) {
        redirect(usersListHref(locale, current, { page: String(paging.lastPage) }));
      }
      const listPath = usersListPath(current);
      languagePath = invite ? listPath.replace('/users', '/users/invite') : listPath;
      canInvite = result.value.canInvite;
      // Invitations (T-M2-07) come from platform.invitations, not from the memberships list.
      const invitations = canInvite ? await invitationsListQuery({}) : null;
      const invitationsError =
        invitations !== null && !invitations.ok ? toClientError(invitations.error) : null;
      // The import lines (T-M2-12) share the invite permission; a failure only hides them.
      const banners = canInvite ? await userImportBannersQuery({}) : null;
      body = (
        <>
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
      if (invite) {
        const form = await inviteFormQuery({});
        if (!form.ok) {
          if (form.error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
          body = (
            <>
              {await failure(locale, form.error)}
              {body}
            </>
          );
        } else {
          panel = await invitePanel(locale, form.value, current, context);
        }
      }
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="users" path={languagePath}>
      <ReturnedFocus />
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canInvite ? (
            <>
              <Link
                href={`/${locale}/suite/admin/users/import`}
                className={buttonClasses({ variant: 'secondary', size: 'md' })}
                data-testid="import-users-link"
              >
                <Icon name="upload" className="size-4" />
                {importTexts('entry')}
              </Link>
              <Link
                id="invite-user-link"
                href={usersInviteHref(locale, current)}
                scroll={false}
                className={buttonClasses({ variant: 'primary', size: 'md' })}
                data-testid="invite-user-link"
              >
                <Icon name="user-plus" />
                {invitationTexts('inviteUser')}
              </Link>
            </>
          ) : null
        }
      />
      <div className="flex flex-col gap-5">{body}</div>
      {panel}
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

/** The texts the members table and its panels use (formatted on the server). */
async function memberTexts(locale: AppLocale): Promise<Record<string, string>> {
  const t = await getTranslations({ locale, namespace: 'users' });
  const profile = await getTranslations({ locale, namespace: 'userProfile' });
  const editRoles = await getTranslations({ locale, namespace: 'editRoles' });
  const copy = await inviteCopyTexts(locale);
  const texts: Record<string, string> = {
    tableCaption: t('tableCaption'),
    noneLabel: t('noneLabel'),
    openProfile: t('openProfile'),
    undo: t('undo'),
    moreActions: String(t.raw('moreActions')),
    copyField: String(t.raw('copyField')),
    copied: String(t.raw('copied')),
    copyFailed: copy.copyFailed,
    close: editRoles('close'),
    editDetails: profile('editDetails'),
    changeRole: profile('editRoles'),
    deactivate: profile('deactivate'),
    'fields.email': profile('fields.email'),
  };
  for (const key of [
    'name',
    'employeeNumber',
    'primaryRole',
    'department',
    'status',
    'lastSignIn',
    'actions',
  ] as const) {
    texts[`columns.${key}`] = t(`columns.${key}`);
  }
  return texts;
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
  const format = await getFormatter({ locale });
  const { list, canReadRoles, orgUnits } = view;
  const activeTab = (TABS as readonly string[]).includes(params.tab ?? '')
    ? (params.tab as (typeof TABS)[number])
    : 'all';
  const filtered = Boolean(params.q ?? params.role ?? params.department ?? params.branch);
  const { from, to } = usersPaging(view.page, view.pageSize, list.rows.length, list.total);
  // The invited view counts invited memberships (before T-M2-07) and open invitations.
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
  const nothingToShow = list.rows.length === 0 && invitationRows.length === 0;
  const levels = view.levels;
  // The organization's own level names (guided-test feedback #3), decided for the organization.
  const withLevels = orgShowsUnitLevels(levels, view.unitsBelowFirstLevel);
  const filterOrdinals = (orgUnits?.departments ?? []).map((d) => d.levelOrdinal);
  const filterWithLevels = showsUnitLevels(levels, filterOrdinals);
  const limitedToUnit = (code: string) =>
    view.roles?.some(
      (r) => r.code === code && r.kind === 'custom' && r.dataScope === 'departments',
    ) ?? false;
  const roleMenu =
    view.canAssignRoles && view.roles && activeTab !== 'deactivated'
      ? {
          options: roleOptions(view.roles, locale),
          selectTexts: await roleSelectTexts(locale),
          labels: await editRoleLabels(locale),
          // The unit picker of department-limited custom roles (EP-ORG, T-M3-09).
          scopeUnits: scopeUnitChoices(view.scopeUnits.units, view.scopeUnits.levels, locale),
          unitTexts: await scopeUnitTexts(locale, view.scopeUnits.structureVisible),
        }
      : null;
  const base = `/${locale}/suite/admin/users`;
  const rows: MemberRowView[] = list.rows.map((row) => {
    const name = localizedName(locale, row.displayNameAr, row.displayNameEn);
    const self = row.personId === view.selfPersonId;
    // «تعديل الدور» (EP-ROLES): with role.assign, people the member may manage, never their own role; a
    // privileged person only for the Organization Admin.
    const mayEditRole =
      roleMenu !== null &&
      row.rolesVisible &&
      row.mayManage &&
      row.status !== 'suspended' &&
      !self &&
      (!row.privileged || view.canAssignPrivileged);
    const unit = row.roleScopeUnit;
    const unitName = unit
      ? unitNameWithLevel(
          localizedName(locale, unit.nameAr, unit.nameEn),
          unit.levelOrdinal ?? null,
          levels,
          locale,
          withLevels,
        )
      : null;
    return {
      personId: row.personId,
      name,
      email: row.email,
      employeeNumber: row.employeeNumber,
      roleName:
        row.rolesVisible && row.primaryRole
          ? roleName(locale, row.primaryRole, row.primaryRoleName)
          : null,
      roleNote: row.rolesVisible ? t('noneLabel') : t('rolesNotVisible'),
      roleUnit:
        row.primaryRole && row.rolesVisible && limitedToUnit(row.primaryRole)
          ? unitName === null
            ? { text: t('unitMissing'), warning: true }
            : unit?.active
              ? { text: t('roleUnit', { unit: unitName }), warning: false }
              : { text: `${unitName} · ${t('unitInactive')}`, warning: true }
          : null,
      unitName: row.departmentNameAr
        ? unitNameWithLevel(
            localizedName(locale, row.departmentNameAr, row.departmentNameEn),
            row.departmentLevelOrdinal,
            levels,
            locale,
            withLevels,
          )
        : null,
      status: row.status,
      statusText: t(`status.${row.status}`),
      lastSignIn: row.lastSignInAt ? dates.dateTime(row.lastSignInAt) : t('never'),
      profileHref: `${base}/${row.personId}`,
      // «تعديل البيانات» (T-M2-13): a privileged person's record by the Organization Admin only (the server
      // refuses it too).
      editHref:
        view.canEditDetails && row.mayManage && (!row.privileged || view.canAssignPrivileged)
          ? `${base}/${row.personId}/edit`
          : null,
      // «تعطيل المستخدم» (T-M2-09): an active member the member may manage, not themself; privileged
      // people by the Organization Admin only (the dialog checks again).
      deactivateHref:
        view.canDeactivate &&
        row.mayManage &&
        row.status === 'active' &&
        !self &&
        (!row.privileged || view.canAssignPrivileged)
          ? `${base}/${row.personId}/deactivate`
          : null,
      role: mayEditRole
        ? {
            version: row.roleVersion,
            currentRole: row.primaryRole,
            currentUnit: row.roleScopeUnit?.id ?? null,
          }
        : null,
      // «إعادة التفعيل» (T-M2-09): privileged members only with role.assign_privileged.
      reactivate:
        activeTab === 'deactivated' &&
        view.canDeactivate &&
        row.status === 'suspended' &&
        row.mayManage &&
        (!row.privileged || view.privilegedReactivation === 'allowed')
          ? { privileged: row.privileged }
          : null,
    };
  });

  const attention = await attentionLines(locale, banners, expired);
  const firstUse =
    !filtered &&
    activeTab === 'all' &&
    view.canInvite &&
    list.counts.all <= 1 &&
    (invitations ?? []).length === 0;
  const invitationTexts = await getTranslations({ locale, namespace: 'invitations' });
  const importTexts = await getTranslations({ locale, namespace: 'userImport' });
  const filterChoice = (
    label: string,
    allLabel: string,
    options: { value: string; label: string; depth?: number }[],
  ) => ({ label, allLabel, options });

  return (
    <>
      {attention}

      {/* Saved-view cards with big numbers (direction C): the four status views, each its own address. */}
      <ViewCards
        label={t('viewsLabel')}
        current={activeTab}
        data-testid="users-views"
        items={TABS.map((tab) => ({
          key: tab,
          href: usersListHref(locale, params, { tab, page: undefined }),
          label: t(`tabs.${tab}`),
          count: format.number(counts[tab], 'integer'),
          testId: `users-view-${tab}`,
        }))}
      />

      {firstUse ? (
        <Card data-testid="users-first-use">
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="m-0 text-[22px] font-bold">{t('firstUseTitle')}</h2>
              <p className="m-0 mt-1 text-text-muted">{t('firstUseBody')}</p>
            </div>
            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
              <div className="flex flex-col items-start gap-3 rounded-lg border border-border p-5">
                <h3 className="m-0 flex items-center gap-2 text-lg font-bold">
                  <Icon name="user-plus" />
                  {invitationTexts('title')}
                </h3>
                <p className="m-0 text-sm text-text-muted">{invitationTexts('intro')}</p>
                <Link
                  href={usersInviteHref(locale, params)}
                  scroll={false}
                  className={buttonClasses({ variant: 'primary', size: 'md' })}
                >
                  <Icon name="user-plus" />
                  {invitationTexts('inviteUser')}
                </Link>
              </div>
              <div className="flex flex-col items-start gap-3 rounded-lg border border-border p-5">
                <h3 className="m-0 flex items-center gap-2 text-lg font-bold">
                  <Icon name="upload" />
                  {importTexts('title')}
                </h3>
                <p className="m-0 text-sm text-text-muted">{importTexts('intro')}</p>
                <Link
                  href={`/${locale}/suite/admin/users/import`}
                  className={buttonClasses({ variant: 'secondary', size: 'md' })}
                >
                  {importTexts('entry')}
                </Link>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      <UsersFilters
        locale={locale}
        params={params}
        searchLabel={t('search')}
        searchPlaceholder={t('searchHint')}
        role={
          canReadRoles
            ? filterChoice(
                t('role'),
                t('allRoles'),
                (view.roles ?? []).map((role) => ({ value: role.code, label: role.name[locale] })),
              )
            : null
        }
        unit={
          orgUnits
            ? filterChoice(
                unitsLabel(levels, filterOrdinals, locale, t('department')),
                t('allDepartments'),
                orgUnits.departments.map((d) => ({
                  value: d.id,
                  label: unitNameWithLevel(
                    localizedName(locale, d.nameAr, d.nameEn),
                    d.levelOrdinal,
                    levels,
                    locale,
                    filterWithLevels,
                  ),
                })),
              )
            : null
        }
        branch={
          orgUnits
            ? filterChoice(
                t('branch'),
                t('allBranches'),
                orgUnits.branches.map((b) => ({
                  value: b.id,
                  label: localizedName(locale, b.nameAr, b.nameEn),
                })),
              )
            : null
        }
        texts={{
          removeFilter: String(t.raw('removeFilter')),
          findInList: t('findInList'),
          noMatches: t('noMatches'),
        }}
        range={list.total > 0 ? t('pageRange', { from, to, total: list.total }) : null}
      />

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
      ) : rows.length === 0 ? null : (
        <Card flush>
          <MembersTable
            rows={rows}
            showRole={canReadRoles}
            unitHeader={orgUnitsLabel(
              levels,
              view.unitsBelowFirstLevel,
              locale,
              t('columns.department'),
            )}
            texts={await memberTexts(locale)}
            roleMenu={roleMenu}
            reactivateLabels={activeTab === 'deactivated' ? await reactivateLabels(locale) : null}
            errors={await profileErrorTexts(locale)}
            locale={locale}
          />
          {list.total > 0 ? (
            <Pagination
              label={t('paginationLabel')}
              range={t('pageRange', { from, to, total: list.total })}
              previous={{
                href:
                  view.page > 1
                    ? usersListHref(locale, params, { page: String(view.page - 1) })
                    : null,
                label: t('previous'),
              }}
              next={{
                href:
                  to < list.total
                    ? usersListHref(locale, params, { page: String(view.page + 1) })
                    : null,
                label: t('next'),
              }}
            />
          ) : null}
        </Card>
      )}
    </>
  );
}

async function invitationLabels(locale: AppLocale): Promise<Record<string, string>> {
  const t = await getTranslations({ locale, namespace: 'invitations' });
  const users = await getTranslations({ locale, namespace: 'users' });
  const labels: Record<string, string> = Object.fromEntries(
    INVITATION_LIST_KEYS.map((k) => [k, t(`list.${k}`)]),
  );
  for (const key of INVITATION_RAW_KEYS) labels[key] = String(t.raw(`list.${key}`));
  labels.moreActions = String(users.raw('moreActions'));
  labels.openProfile = users('openProfile');
  labels.close = (await getTranslations({ locale, namespace: 'editRoles' }))('close');
  labels.linkLabel = t('copy.linkLabel');
  return labels;
}

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

/**
 * Open invitations of the Pending invites view (T-M2-07, screen 1): pending, expired, and — from a bulk
 * import (T-M2-12) — held («لم تُرسل الدعوة») and scheduled. At most INVITATIONS_SHOWN rows (newest first).
 */
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
      fromImportText: row.importId
        ? t('list.fromImport', { date: dates.date(row.createdAt) })
        : null,
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
      <Card flush>
        <InvitationsTable
          rows={views}
          showRole={canReadRoles}
          copyTexts={await inviteCopyTexts(locale)}
          labels={await invitationLabels(locale)}
          errors={await profileErrorTexts(locale)}
        />
      </Card>
    </>
  );
}

/**
 * «Needs your attention» (redesign package 3 — Deputy's import banner): one strip instead of three
 * banners — an import running (or being undone) with «View progress»; people the latest import added
 * without invitations with «Send the invitations (N)» (T-M2-12); invitations expired before acceptance with
 * «Resend expired invitations (N)» (T-M2-07). Shown only when one of them applies.
 */
async function attentionLines(
  locale: AppLocale,
  banners: UserImportBannersView | null,
  expired: readonly InvitationRow[],
): Promise<ReactNode> {
  const running = banners?.running ?? null;
  const held = banners?.held.latest ?? null;
  if (!running && !held && expired.length === 0) return null;
  const t = await getTranslations({ locale, namespace: 'userImport' });
  const users = await getTranslations({ locale, namespace: 'users' });
  const invitations = await getTranslations({ locale, namespace: 'invitations' });
  const errors = await profileErrorTexts(locale);
  const planned = running
    ? count(running.reviewCounts, 'new') + count(running.reviewCounts, 'existing')
    : 0;
  const done = running ? Math.min(running.rowsDone, planned) : 0;
  const resendable = expired.filter((row) => canResend(row)).map((row) => row.id);
  const labels = await invitationLabels(locale);
  labels.resendExpired = invitations('list.resendExpired', { count: resendable.length });
  return (
    <AttentionStrip title={users('attentionTitle')} data-testid="users-attention">
      {running ? (
        <AttentionItem
          icon="sync"
          tone="info"
          data-testid="import-running-banner"
          extra={
            running.status === 'undoing' || planned === 0 ? null : (
              // The sentence says the numbers; the bar only shows them (no inline style: the CSP).
              <progress
                aria-hidden="true"
                value={done}
                max={planned}
                className="h-2 w-35 appearance-none overflow-hidden rounded-full bg-surface-sunken [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-surface-sunken [&::-webkit-progress-value]:bg-primary"
              />
            )
          }
          action={
            <Link
              href={`/${locale}/suite/admin/users/import/${running.id}`}
              className={buttonClasses({ variant: 'secondary', size: 'sm' })}
            >
              {t('banners.viewProgress')}
            </Link>
          }
        >
          {running.status === 'undoing'
            ? t('banners.runningUndo', { name: isolate(running.fileName) })
            : t('banners.running', {
                name: isolate(running.fileName),
                done,
                total: planned,
              })}
        </AttentionItem>
      ) : null}
      {held ? (
        <AttentionItem
          icon="mail"
          data-testid="import-held-banner"
          action={
            <SendInvitationsButton
              importId={held.importId}
              label={t('banners.sendAll', { count: held.held })}
              workingLabel={t('banners.sending')}
              doneText={t('banners.sent')}
              nothingText={invitations('list.nothingToSend')}
              notAllowedText={invitations('list.sendNotAllowed')}
              errors={errors}
              variant="secondary"
              testId="import-send-held"
            />
          }
        >
          {t('banners.held', { count: held.held, name: isolate(held.fileName) })}
        </AttentionItem>
      ) : null}
      {expired.length > 0 ? (
        <AttentionItem
          icon="clock"
          data-testid="expired-invitations"
          action={
            resendable.length > 0 ? (
              <ResendExpiredButton ids={resendable} labels={labels} errors={errors} />
            ) : undefined
          }
        >
          {invitations('list.expiredBanner', { count: expired.length })}
        </AttentionItem>
      ) : null}
    </AttentionStrip>
  );
}

/** The invite panel's props (namespace `invitations`), translated on the server. */
async function invitePanel(
  locale: AppLocale,
  view: InviteFormView,
  params: UsersListParams,
  context: SuiteContext,
): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: 'invitations' });
  const common = await getTranslations({ locale, namespace: 'common' });
  const editUser = await getTranslations({ locale, namespace: 'editUser' });
  const editRoles = await getTranslations({ locale, namespace: 'editRoles' });
  const labels: Record<string, string> = Object.fromEntries(
    INVITE_LABEL_KEYS.map((k) => [k, t(`form.${k}`)]),
  );
  labels.title = t('title');
  labels.intro = t('intro');
  labels.work = editUser('work');
  labels.close = editRoles('close');
  labels.cancel = editRoles('cancel');
  labels.done = t('done');
  labels.keptFromLast = t('keptFromLast');
  labels.linkLabel = t('copy.linkLabel');
  labels.required = common('required');
  labels.optional = common('optional');
  // The success view (Kawadir: copy the code or the link right away).
  labels['created.title'] = t('created.title');
  labels['created.text'] = String(t.raw('created.text'));
  labels['created.toList'] = t('created.toList');
  labels['created.inviteAnother'] = t('created.inviteAnother');
  labels['language.ar'] = t('form.languages.ar');
  labels['language.en'] = t('form.languages.en');
  labels.expiryNotice = t('form.expiryNotice', {
    date: pageDates(locale, context).long(expiryFrom(new Date())),
  });
  labels.privilegedLocked = t('form.privilegedAdminOnly');
  // «Discard your changes?» before the panel closes with something typed (as Edit details).
  const users = await getTranslations({ locale, namespace: 'users' });
  const discardTexts = {
    title: users('discardTitle'),
    body: users('discardBody'),
    keepEditing: users('keepEditing'),
    discard: users('discard'),
  };
  const fieldTexts: Record<string, string> = Object.fromEntries(
    INVITE_FIELD_ERROR_KEYS.map((k) => [k, t(`form.fieldErrors.${k}`)]),
  );
  // The unit of a department-limited custom role (EP-ORG, T-M3-09): the edit-role dialog's texts.
  fieldTexts.unitRequired = editRoles('unit.unitRequired');
  fieldTexts.unitNotAllowed = editRoles('unit.unitNotAllowed');
  const ordinals = view.orgUnits.departments.map((d) => d.levelOrdinal);
  const withLevels = showsUnitLevels(view.levels, ordinals);
  labels.department = unitsLabel(view.levels, ordinals, locale, t('form.department'));
  const usersHref = usersListHref(locale, params);
  return (
    <InviteUserPanel
      defaultLocale={context.regional.defaultLocale}
      departments={view.orgUnits.departments.map((u) => ({
        id: u.id,
        name: unitNameWithLevel(
          localizedName(locale, u.nameAr, u.nameEn),
          u.levelOrdinal,
          view.levels,
          locale,
          withLevels,
        ),
      }))}
      branches={view.orgUnits.branches.map((u) => ({
        id: u.id,
        name: localizedName(locale, u.nameAr, u.nameEn),
      }))}
      managers={view.managers.map((m) => ({
        personId: m.personId,
        name: localizedName(locale, m.nameAr, m.nameEn),
        active: m.active,
        departmentIds: m.departmentIds,
      }))}
      roles={roleOptions(view.roles, locale)}
      roleTexts={await roleSelectTexts(locale)}
      scopeUnits={scopeUnitChoices(view.scopeUnits.units, view.scopeUnits.levels, locale)}
      unitTexts={await scopeUnitTexts(locale, view.scopeUnits.structureVisible)}
      labels={labels}
      fieldTexts={fieldTexts}
      errors={await profileErrorTexts(locale)}
      usersHref={usersHref}
      invitedHref={usersListHref(locale, {}, { tab: 'invited' })}
      rolesHref={`/${locale}/suite/admin/roles`}
      copyTexts={await inviteCopyTexts(locale)}
      discardTexts={discardTexts}
      uiLocale={locale}
    />
  );
}
