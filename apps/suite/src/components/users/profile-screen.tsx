import 'server-only';
import { type AppError, toClientError } from '@jadarat/platform-core';
import type { CurrentUnit, InvitationRow, UserProfile } from '@jadarat/platform-db';
import {
  type AppLocale,
  type DisplayDateFormatter,
  displayDateFormatter,
  formatHijriDate,
} from '@jadarat/platform-i18n';
import {
  DEACTIVATION_REASONS,
  type DeactivationView,
  type EditRolesView,
  type EditUserView,
  invitationGivesPrivilegedRole,
} from '@jadarat/platform-rbac';
import {
  Alert,
  Avatar,
  Badge,
  type BadgeTone,
  Card,
  CopyButton,
  Icon,
  type IconName,
  PageHeader,
  TabNav,
  buttonClasses,
} from '@jadarat/ui';
import { getFormatter, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  viewInvitationCodeAction,
  viewPrivilegedInvitationCodeAction,
} from '../../actions/invitations';
import { authErrorTexts } from '../../lib/auth-texts';
import { itemNames } from '../../lib/deactivate-form';
import { reactivateLabels } from '../../lib/deactivation-texts';
import { inviteCopyTexts } from '../../lib/invite-copy-texts';
import { pageDates } from '../../lib/page-dates';
import { formStateFrom } from '../../lib/profile-form';
import { memberSecurityErrorTexts, profileErrorTexts } from '../../lib/profile-texts';
import { roleOptions } from '../../lib/role-choice';
import { editRoleLabels, roleSelectTexts, scopeUnitTexts } from '../../lib/role-texts';
import { sessionLabels, sessionRows } from '../../lib/sessions-view';
import {
  type LevelLabel,
  scopeUnitChoices,
  showsUnitLevels,
  unitFieldLabel,
  unitNameWithLevel,
  unitsLabel,
} from '../../lib/structure-view';
import { type SuiteContext, getSuiteContext } from '../../lib/suite-context';
import {
  deactivationQuery,
  editRolesQuery,
  editUserQuery,
  invitationsListQuery,
  memberSecurityQuery,
  userProfileQuery,
} from '../../lib/users-queries';
import { localizedName, roleName } from '../../lib/users-view';
import { NotSet } from '../not-set';
import { SessionsTable } from '../sessions/sessions-table';
import { SuiteShell } from '../suite-shell';
import { InviteCodeCopy } from './invite-code-copy';
import { DeactivateDialog, EditUserPanel, type PanelReturn, RolePanelRoute } from './person-panels';
import { ProfileActions, type ProfileActionLink } from './profile-actions';
import { ReactivateMemberButton } from './reactivate-member-button';
import { ResetAuthenticator } from './reset-authenticator';
import { UnlockSignIn } from './unlock-sign-in';

export type ProfileTab = 'overview' | 'security' | 'activity';
export type ProfilePanel = 'edit' | 'roles' | 'deactivate';

/** The tab of `?tab=` (unknown → the overview). */
export function profileTab(raw: string | string[] | undefined): ProfileTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === 'security' || value === 'activity' ? value : 'overview';
}

type AccountStatus = NonNullable<UserProfile['membershipStatus']> | 'none';
const ACCOUNT_TONE: Record<AccountStatus, BadgeTone> = {
  active: 'success',
  invited: 'warning',
  suspended: 'neutral',
  revoked: 'neutral',
  none: 'neutral',
};
/** Audit actions with their own wording; any other action is shown with its code. */
const KNOWN_ACTIONS = new Set([
  'platform.tenant.admin_provisioned',
  'platform.tenant.admin_role_restored',
  'platform.user.updated',
  'platform.user.roles_changed',
  'platform.user.deactivated',
  'platform.user.reactivated',
  // T-M2-10: force sign-out and the reset of a lost authenticator app.
  'platform.user.sessions_ended',
  'platform.user.mfa_reset',
  // T-M2-11: the Organization Admin ended a member's sign-in lock.
  'platform.user.sign_in_unlocked',
]);
const ACTION_ICONS: Record<string, IconName> = {
  'platform.user.updated': 'pencil',
  'platform.user.roles_changed': 'key',
  'platform.user.deactivated': 'power',
  'platform.user.reactivated': 'sync',
  'platform.user.sessions_ended': 'sign-out',
  'platform.user.mfa_reset': 'shield',
  'platform.user.sign_in_unlocked': 'lock',
};

/** Text keys of the edit form (namespace `editUser`). */
const EDIT_LABEL_KEYS = [
  'arabicName',
  'englishName',
  'addArabicName',
  'addEnglishName',
  'prefilledName',
  'currentName',
  'currentNameKept',
  'contact',
  'email',
  'emailHint',
  'emailIsLogin',
  'mobile',
  'mobileHint',
  'language',
  'work',
  'employeeNumber',
  'employeeNumberHint',
  'hireDate',
  'hireDateHijri',
  'jobTitleAr',
  'jobTitleEn',
  'department',
  'noDepartment',
  'branch',
  'noBranch',
  'manager',
  'managerHint',
  'managerHintAll',
  'noManager',
  'inactive',
  'allDepartmentsManagers',
  'departmentManagersOnly',
  'save',
  'saving',
  'saved',
  'noChanges',
  'backToProfile',
] as const;
const EDIT_FIELD_ERROR_KEYS = [
  'required',
  'name',
  'mobile',
  'email',
  'emailTaken',
  'employeeNumber',
  'employeeNumberTaken',
  'managerLoop',
  'managerInactive',
  'managerSelf',
  'unit',
  'unitDeleted',
  'jobTitle',
  'hireOn',
  'hireOnAfterEnd',
] as const;
/** Text keys of the deactivation form (namespace `deactivation`). */
const DEACTIVATION_KEYS = [
  'itemsHeading',
  'moveAllTo',
  'choosePerson',
  'noCandidates',
  'reason',
  'reasonHint',
  'reasonNone',
  'cancel',
  'submit',
  'submitMove',
  'working',
  'fieldErrors.ownerRequired',
  'fieldErrors.ownerInvalid',
  'fieldErrors.ownerReportsToPerson',
  'fieldErrors.changed',
  'fieldErrors.notActive',
  'blocked.last_admin',
  'itemsBlocked.item_not_allowed',
] as const;

interface UnitOption {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly levelOrdinal: number | null;
}

const profilePath = (personId: string) => `/suite/admin/users/${encodeURIComponent(personId)}`;

/**
 * A person's profile (T-M2-04 screen 3, FR-IAM-01/07; redesign package 3 — «one person, one place»):
 * the header (large avatar, name, job · unit · branch, status, «Edit details» and «Actions ▾»), the tabs
 * Overview · Sign-in and security · Recent activity (`?tab=`, so the MFA and sessions links keep working),
 * and — on the panel routes — Edit details or Change role in a side panel, Deactivate in a dialog. Each
 * section and action shows only with the permission it needs (deny by default), as before: authorized
 * against the person (out of scope or another organization → 404, no existence leak).
 */
export async function ProfileScreen({
  locale,
  personId,
  tab,
  panel,
}: {
  readonly locale: AppLocale;
  readonly personId: string;
  readonly tab: ProfileTab;
  readonly panel: ProfilePanel | null;
}) {
  const context = await getSuiteContext(locale);
  const users = await getTranslations({ locale, namespace: 'users' });
  const t = await getTranslations({ locale, namespace: 'userProfile' });
  const tabQuery = tab === 'overview' ? '' : `?tab=${tab}`;
  const path = `${profilePath(personId)}${panel ? `/${panel}` : ''}${tabQuery}`;
  const usersHref = `/${locale}/suite/admin/users`;

  let content: ReactNode;
  let title = users('title');
  let header: ReactNode = null;
  if (!context.live) {
    content = (
      <Alert tone="info" data-testid="users-not-configured">
        {users('notConfigured')}
      </Alert>
    );
  } else {
    const result = await userProfileQuery({ personId });
    if (!result.ok) {
      const error = toClientError(result.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      if (error.code === 'NOT_FOUND' || error.code === 'VALIDATION_FAILED') notFound();
      content = await loadFailure(locale, result.error);
    } else {
      const view = result.value;
      const { profile } = view;
      title = localizedName(locale, profile.displayNameAr, profile.displayNameEn);
      // Sign-in and security (screen 3, T-M2-10): user managers only (else the section is left out).
      const security = await memberSecurityQuery({ personId });
      const page = await profilePage(locale, {
        ...view,
        security: security.ok ? security.value : null,
        regional: context.regional,
        tab,
        panel,
      });
      header = page.header;
      content = (
        <>
          {page.body}
          {panel ? await panelFor(locale, panel, personId, title, view, tabQuery, context) : null}
        </>
      );
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="users" path={path}>
      {header ?? (
        <PageHeader
          title={title}
          breadcrumbs={[{ label: t('breadcrumb'), href: usersHref }, { label: title }]}
          breadcrumbsLabel={t('breadcrumbLabel')}
        />
      )}
      {content}
    </SuiteShell>
  );
}

async function loadFailure(locale: AppLocale, error: AppError): Promise<ReactNode> {
  const client = toClientError(error);
  if (client.code === 'FORBIDDEN') {
    const errors = await getTranslations({ locale, namespace: 'errors' });
    return <Alert tone="warning">{errors('forbidden')}</Alert>;
  }
  const users = await getTranslations({ locale, namespace: 'users' });
  return (
    <Alert tone="danger">
      {users('loadFailed', { correlationId: client.correlationId ?? '' })}
    </Alert>
  );
}

type ProfileView = Extract<Awaited<ReturnType<typeof userProfileQuery>>, { ok: true }>['value'];
type SecurityView = Extract<Awaited<ReturnType<typeof memberSecurityQuery>>, { ok: true }>['value'];

async function profilePage(
  locale: AppLocale,
  input: ProfileView & {
    readonly security: SecurityView | null;
    readonly regional: SuiteContext['regional'];
    readonly tab: ProfileTab;
    readonly panel: ProfilePanel | null;
  },
): Promise<{ header: ReactNode; body: ReactNode }> {
  const { profile, levels, canOpenManager, canEdit, canEditRoles, lifecycle, signInLock } = input;
  const { security, tab } = input;
  const t = await getTranslations({ locale, namespace: 'userProfile' });
  const name = localizedName(locale, profile.displayNameAr, profile.displayNameEn);
  const base = `/${locale}${profilePath(profile.personId)}`;
  const tabQuery = tab === 'overview' ? '' : `?tab=${tab}`;
  const dates = pageDates(locale, { regional: input.regional });
  const department = profile.departmentNameAr
    ? localizedName(locale, profile.departmentNameAr, profile.departmentNameEn)
    : null;
  const branch = profile.branchNameAr
    ? localizedName(locale, profile.branchNameAr, profile.branchNameEn)
    : null;
  const jobTitle =
    locale === 'en' ? (profile.jobTitleEn ?? profile.jobTitleAr) : profile.jobTitleAr;
  const accountStatus: AccountStatus = profile.membershipStatus ?? 'none';
  const subtitle = [jobTitle, department, branch].filter(Boolean).join(' · ');

  // «Actions ▾»: only what the member may do (redesign package 3).
  const actions: ProfileActionLink[] = [];
  if (canEditRoles) {
    actions.push({
      key: 'role',
      label: t('editRoles'),
      href: `${base}/roles${tabQuery}`,
      icon: 'key',
    });
  }
  if (security?.canResetApp && (security.usesApp === true || security.appPending)) {
    actions.push({
      key: 'reset-app',
      label: t('mfaResetAction'),
      href: `${base}?tab=security`,
      icon: 'shield',
    });
  }
  if (signInLock?.locked) {
    actions.push({
      key: 'unlock',
      label: t('signInLock.unlock'),
      href: `${base}?tab=security`,
      icon: 'lock',
    });
  }
  if (lifecycle.canDeactivate) {
    actions.push({
      key: 'deactivate',
      label: t('deactivate'),
      href: `${base}/deactivate${tabQuery}`,
      icon: 'power',
      danger: true,
    });
  }

  const header = (
    <PageHeader
      breadcrumbs={[
        { label: t('breadcrumb'), href: `/${locale}/suite/admin/users` },
        { label: name },
      ]}
      breadcrumbsLabel={t('breadcrumbLabel')}
      leading={<Avatar name={name} size="xl" className="shadow-brand-glow" />}
      title={name}
      description={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {subtitle ? <span>{subtitle}</span> : null}
          <Badge tone={ACCOUNT_TONE[accountStatus]} dot data-testid="profile-status">
            {t(`accountStatuses.${accountStatus}`)}
          </Badge>
        </span>
      }
      actions={
        <ProfileActions
          edit={canEdit ? { label: t('editDetails'), href: `${base}/edit${tabQuery}` } : null}
          menuLabel={t('actionsMenu')}
          items={actions}
        />
      }
    />
  );

  const tabs = [
    { key: 'overview', href: base, label: t('tabs.overview'), icon: 'user' as const },
    {
      key: 'security',
      href: `${base}?tab=security`,
      label: t('account'),
      icon: 'shield' as const,
    },
    ...(profile.activity
      ? [
          {
            key: 'activity',
            href: `${base}?tab=activity`,
            label: t('activity'),
            icon: 'audit' as const,
          },
        ]
      : []),
  ];

  const banners: ReactNode[] = [];
  if (accountStatus === 'suspended') {
    banners.push(
      <Alert
        key="deactivated"
        tone="warning"
        title={t('deactivatedTitle')}
        data-testid="profile-deactivated"
        action={
          lifecycle.reactivate === 'allowed' ? (
            <ReactivateMemberButton
              personId={profile.personId}
              name={name}
              privileged={lifecycle.privileged}
              labels={await reactivateLabels(locale)}
              errors={await profileErrorTexts(locale)}
            />
          ) : undefined
        }
      >
        {(await getTranslations({ locale, namespace: 'deactivation' }))('effects.reactivate')}
      </Alert>,
    );
  }
  if (accountStatus === 'invited' || accountStatus === 'none') {
    const invitation = await openInvitation(profile.personId);
    if (invitation) banners.push(await invitedBanner(locale, invitation, name, dates));
  }

  const roleCard = profile.roles ? (
    <Card title={t('roles')} data-testid="profile-role-card">
      <div className="flex flex-col gap-4">
        {profile.roles.length === 0 ? (
          <p className="m-0 text-text-muted">{t('noRoles')}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0" data-testid="user-roles">
            {profile.roles.map((role) => {
              const now = new Date();
              const ended = role.validUntil !== null && role.validUntil <= now;
              // Role days in the organization's time zone (T-M2-14), in its date display.
              const roleDay = displayDateFormatter(
                locale,
                input.regional.dateDisplay,
                profile.timeZone,
              ).date;
              return (
                <li
                  key={role.roleCode}
                  className="flex items-center gap-3 rounded-lg border border-border bg-surface-sunken px-3.5 py-3"
                >
                  <span
                    aria-hidden="true"
                    className="grid size-10 shrink-0 place-items-center rounded-md bg-brand-gradient text-on-brand"
                  >
                    <Icon name="key" />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className={ended ? 'text-text-muted line-through' : 'font-semibold'}>
                      {roleName(locale, role.roleCode, role.customName)}
                    </span>
                    {role.validFrom && role.validFrom > now ? (
                      <span className="text-sm text-text-muted">
                        {t('validFrom', { date: roleDay(role.validFrom) })}
                      </span>
                    ) : null}
                    {role.validUntil ? (
                      <span className="text-sm text-text-muted">
                        {t(ended ? 'ended' : 'validUntil', {
                          // The last day (a role ends at the start of the next day, T-M2-14).
                          date: roleDay(new Date(role.validUntil.getTime() - 1)),
                        })}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="m-0 text-sm text-text-muted">{t('rolesAudited')}</p>
        {canEditRoles ? (
          <div>
            <Link
              id="profile-change-role"
              href={`${base}/roles${tabQuery}`}
              scroll={false}
              className={buttonClasses({ variant: 'secondary', size: 'md' })}
              data-testid="edit-roles-link"
            >
              <Icon name="key" className="size-4" />
              {t('editRoles')}
            </Link>
          </div>
        ) : null}
      </div>
    </Card>
  ) : null;

  const mfaText =
    security && security.usesApp !== null
      ? security.usesApp && security.appSince
        ? t('mfaOn', { date: dates.date(security.appSince) })
        : security.appPending
          ? t('mfaPending')
          : t('mfaOff')
      : null;
  const signInFacts: { key: string; label: string; value: ReactNode; testId?: string }[] = [
    { key: 'status', label: t('accountStatus'), value: t(`accountStatuses.${accountStatus}`) },
    {
      key: 'lastSignIn',
      label: t('lastSignIn'),
      value: profile.lastSignInAt ? dates.dateTime(profile.lastSignInAt) : t('never'),
    },
    ...(mfaText
      ? [{ key: 'mfa', label: t('mfa'), value: mfaText, testId: 'user-mfa-status' }]
      : []),
  ];

  let main: ReactNode;
  let side: ReactNode = roleCard;
  if (tab === 'security') {
    const securityErrors = security ? await memberSecurityErrorTexts(locale) : {};
    const sessionsT = await getTranslations({ locale, namespace: 'sessions' });
    main = (
      <>
        <Card title={t('account')} data-testid="profile-security">
          <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            {signInFacts.map((fact) => (
              <div key={fact.key} className="flex flex-col gap-1">
                <dt className="text-sm text-text-muted">{fact.label}</dt>
                <dd className="m-0 font-medium" data-testid={fact.testId}>
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>
          {/* Lost authenticator app (PO answer, 9 Oct 2026): the Organization Admin resets it here;
              ENTLAQA support for logins in several organizations and the last Organization Admin. */}
          {security ? (
            <ResetAuthenticator
              personId={profile.personId}
              personName={name}
              hasApp={security.usesApp === true || security.appPending}
              canReset={security.canResetApp}
              labels={{
                title: t('mfaResetTitle'),
                hint: t('mfaResetHint'),
                support: t('mfaResetSupport'),
                action: t('mfaResetAction'),
                confirmTitle: t('mfaResetConfirmTitle'),
                confirmText: t('mfaResetConfirmText', { name: '{name}' }),
                confirm: t('mfaResetConfirm'),
                resetting: t('mfaResetting'),
                cancel: t('mfaResetCancel'),
                done: t('mfaResetDone', { name: '{name}' }),
              }}
              errors={securityErrors}
            />
          ) : null}
          {signInLock?.locked ? (
            <div className="mt-4">
              <UnlockSignIn
                personId={profile.personId}
                labels={{
                  title: t('signInLock.title'),
                  body: t('signInLock.body', {
                    minutes: Math.max(1, Math.ceil(signInLock.retryAfterSeconds / 60)),
                  }),
                  unlock: t('signInLock.unlock'),
                  unlocking: t('signInLock.unlocking'),
                  unlocked: t('signInLock.unlocked'),
                  notLocked: t('signInLock.notLocked'),
                  limited: t('signInLock.limited'),
                  audited: t('signInLock.audited'),
                }}
                errors={await authErrorTexts(locale)}
              />
            </div>
          ) : null}
        </Card>
        {security ? (
          <Card
            title={
              security.maxDevices === null
                ? t('sessionsTitle')
                : `${t('sessionsTitle')} ${sessionsT('allowed', {
                    count: security.sessions.length,
                    max: security.maxDevices,
                  })}`
            }
          >
            <SessionsTable
              target={{ kind: 'member', personId: profile.personId }}
              sessions={await sessionRows(locale, security.sessions, dates)}
              labels={sessionLabels(locale)}
              errors={securityErrors}
            />
          </Card>
        ) : null}
      </>
    );
  } else if (tab === 'activity' && profile.activity) {
    main = (
      <Card title={t('activity')}>
        {profile.activity.length === 0 ? (
          <p className="m-0 text-text-muted">{t('noActivity')}</p>
        ) : (
          <ol className="m-0 flex list-none flex-col p-0" data-testid="user-activity">
            {profile.activity.map((event, index) => {
              // A person may have an English name only (PO 17 Oct 2026).
              const actor =
                (event.actorNameAr ?? event.actorNameEn)
                  ? t('by', { name: localizedName(locale, event.actorNameAr, event.actorNameEn) })
                  : t('bySystem');
              return (
                <li
                  key={`${event.occurredAt.toISOString()}-${String(index)}`}
                  className="relative flex gap-3.5 pb-5 last:pb-0"
                >
                  <span
                    aria-hidden="true"
                    className="z-[1] grid size-9 shrink-0 place-items-center rounded-full bg-primary-subtle text-primary-text"
                  >
                    <Icon name={ACTION_ICONS[event.action] ?? 'audit'} className="size-4" />
                  </span>
                  <span className="flex flex-col gap-0.5 pt-1.5">
                    <span className="font-medium">
                      {KNOWN_ACTIONS.has(event.action)
                        ? t(`actions.${event.action.replaceAll('.', '_')}` as 'actions.other')
                        : t('actions.other', { action: event.action })}
                    </span>
                    <span className="text-sm text-text-muted">
                      {dates.dateTime(event.occurredAt)} · {actor}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    );
  } else {
    main = await basicInformation(locale, profile, levels, canOpenManager);
    side = (
      <>
        {roleCard}
        <Card title={t('account')} data-testid="profile-sign-in-summary">
          <dl className="m-0 flex flex-col">
            {signInFacts.map((fact) => (
              <div
                key={fact.key}
                className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b border-border py-3 first:pt-0 last:border-b-0"
              >
                <dt className="text-sm text-text-muted">{fact.label}</dt>
                <dd className="m-0 text-end font-semibold" data-testid={fact.testId}>
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>
          <Link
            href={`${base}?tab=security`}
            className="mt-2 inline-flex min-h-11 items-center gap-1.5 font-semibold"
            data-testid="open-security"
          >
            {t('openSecurity')}
            <Icon name="chevron-end" className="size-4" />
          </Link>
        </Card>
      </>
    );
  }

  const body = (
    <div className="flex flex-col gap-5" data-testid="user-profile">
      {banners}
      <TabNav variant="underline" label={t('tabsLabel')} items={tabs} current={tab} />
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-5">{main}</div>
        {side ? <div className="flex min-w-0 flex-col gap-5">{side}</div> : null}
      </div>
    </div>
  );
  return { header, body };
}

/** «Basic information»: the person's details, e-mail, mobile and employee number with copy buttons. */
async function basicInformation(
  locale: AppLocale,
  profile: UserProfile,
  levels: readonly LevelLabel[],
  canOpenManager: boolean,
): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: 'userProfile' });
  const users = await getTranslations({ locale, namespace: 'users' });
  const copyTexts = await inviteCopyTexts(locale);
  const format = await getFormatter({ locale });
  const none = <NotSet label={users('noneLabel')} />;
  const department = profile.departmentNameAr
    ? localizedName(locale, profile.departmentNameAr, profile.departmentNameEn)
    : null;
  const branch = profile.branchNameAr
    ? localizedName(locale, profile.branchNameAr, profile.branchNameEn)
    : null;
  const jobTitle =
    locale === 'en' ? (profile.jobTitleEn ?? profile.jobTitleAr) : profile.jobTitleAr;
  const copyable = (label: string, value: string | null) =>
    value ? (
      <span className="flex items-center gap-1.5">
        <bdi dir="ltr" className="min-w-0 [overflow-wrap:anywhere]">
          {value}
        </bdi>
        <CopyButton
          value={value}
          label={users('copyField', { field: label })}
          copiedText={users('copied', { field: label })}
          failedText={copyTexts.copyFailed}
        />
      </span>
    ) : (
      none
    );
  const fields: { key: string; label: string; value: ReactNode }[] = [
    { key: 'email', label: t('fields.email'), value: copyable(t('fields.email'), profile.email) },
    {
      key: 'mobile',
      label: t('fields.mobile'),
      value: copyable(t('fields.mobile'), profile.mobileE164),
    },
    {
      key: 'employeeNumber',
      label: t('fields.employeeNumber'),
      value: copyable(t('fields.employeeNumber'), profile.employeeNumber),
    },
    { key: 'jobTitle', label: t('fields.jobTitle'), value: jobTitle ?? none },
    {
      key: 'department',
      label: unitFieldLabel(levels, profile.departmentLevelOrdinal, locale, t('fields.department')),
      value: department ?? none,
    },
    { key: 'branch', label: t('fields.branch'), value: branch ?? none },
    {
      key: 'manager',
      label: t('fields.manager'),
      value: profile.manager ? (
        canOpenManager ? (
          <Link href={`/${locale}/suite/admin/users/${profile.manager.personId}`}>
            {localizedName(locale, profile.manager.displayNameAr, profile.manager.displayNameEn)}
          </Link>
        ) : (
          localizedName(locale, profile.manager.displayNameAr, profile.manager.displayNameEn)
        )
      ) : (
        none
      ),
    },
    {
      key: 'hireDate',
      label: t('fields.hireDate'),
      value: profile.hireOn ? (
        <>
          {format.dateTime(new Date(`${profile.hireOn}T00:00:00Z`), {
            dateStyle: 'long',
            timeZone: 'UTC',
            numberingSystem: 'latn',
            calendar: 'gregory',
          })}{' '}
          <span className="font-normal text-text-muted">
            {t('hijri', { date: formatHijriDate(profile.hireOn, locale) })}
          </span>
        </>
      ) : (
        none
      ),
    },
    {
      key: 'language',
      label: t('fields.language'),
      value: t(`languages.${profile.preferredLocale}`),
    },
    locale === 'en'
      ? {
          key: 'nameAr',
          label: t('fields.nameAr'),
          // A person may have an English name only (PO 17 Oct 2026).
          value: profile.displayNameAr ? <bdi dir="rtl">{profile.displayNameAr}</bdi> : none,
        }
      : {
          key: 'nameEn',
          label: t('fields.nameEn'),
          value: profile.displayNameEn ? <bdi dir="ltr">{profile.displayNameEn}</bdi> : none,
        },
  ];
  return (
    <Card title={t('basicData')} data-testid="profile-basic">
      <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-4.5 sm:grid-cols-2">
        {fields.map((field) => (
          <div key={field.key} className="flex min-w-0 flex-col gap-1">
            <dt className="text-sm text-text-muted">{field.label}</dt>
            <dd className="m-0 font-semibold">{field.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** The person's open invitation, when the member may see invitations (else none). */
async function openInvitation(personId: string): Promise<InvitationRow | null> {
  const invitations = await invitationsListQuery({});
  if (!invitations.ok) return null;
  return (
    invitations.value.invitations.find(
      (row) => row.personId === personId && (row.state === 'pending' || row.state === 'expired'),
    ) ?? null
  );
}

/** Invited, not accepted yet: the expiry and the code or link to copy (moved from the list, same rules). */
async function invitedBanner(
  locale: AppLocale,
  invitation: InvitationRow,
  name: string,
  dates: DisplayDateFormatter,
): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: 'userProfile' });
  const invitations = await getTranslations({ locale, namespace: 'invitations' });
  const privileged = invitationGivesPrivilegedRole(invitation);
  const expiry =
    invitation.state === 'expired'
      ? invitations('list.expiredOn', { date: dates.date(invitation.expiresAt) })
      : invitations('list.expiresOn', { date: dates.date(invitation.expiresAt) });
  return (
    <Alert key="invited" tone="info" title={t('invitedBanner')} data-testid="profile-invited">
      <div className="flex flex-col gap-2">
        <span>{expiry}</span>
        {invitation.state === 'pending' && invitation.hasCode ? (
          <InviteCodeCopy
            // A bound server action: the code is read (and audited) only when copied (review M2).
            load={(privileged ? viewPrivilegedInvitationCodeAction : viewInvitationCodeAction).bind(
              null,
              { invitationId: invitation.id },
            )}
            texts={await inviteCopyTexts(locale)}
            name={name}
          />
        ) : null}
      </div>
    </Alert>
  );
}

/** The panel or dialog of a panel route, with what it needs (read with its own authorization). */
async function panelFor(
  locale: AppLocale,
  panel: ProfilePanel,
  personId: string,
  name: string,
  view: ProfileView,
  tabQuery: string,
  context: SuiteContext,
): Promise<ReactNode> {
  const base = `/${locale}${profilePath(personId)}`;
  const back = (focusId: string): PanelReturn => ({ href: `${base}${tabQuery}`, focusId });
  if (panel === 'edit') return editPanel(locale, personId, name, back('profile-edit'), context);
  if (panel === 'roles') return rolePanel(locale, personId, name, back('profile-actions'));
  return deactivateDialog(locale, personId, name, view, back('profile-actions'));
}

async function editPanel(
  locale: AppLocale,
  personId: string,
  name: string,
  back: PanelReturn,
  context: SuiteContext,
): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: 'editUser' });
  const users = await getTranslations({ locale, namespace: 'users' });
  const editRoles = await getTranslations({ locale, namespace: 'editRoles' });
  const texts = {
    close: editRoles('close'),
    cancel: editRoles('cancel'),
    save: t('save'),
    saving: t('saving'),
    saved: t('saved'),
    noChanges: t('noChanges'),
    audited: t('intro'),
  };
  const discardTexts = {
    title: users('discardTitle'),
    body: users('discardBody'),
    keepEditing: users('keepEditing'),
    discard: users('discard'),
  };
  const result = await editUserQuery({ personId });
  if (!result.ok) {
    const error = toClientError(result.error);
    if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
    if (error.code === 'NOT_FOUND' || error.code === 'VALIDATION_FAILED') notFound();
    return (
      <EditUserPanel
        title={t('titleFor', { name })}
        back={back}
        form={null}
        failure={await loadFailure(locale, result.error)}
        texts={texts}
        discardTexts={discardTexts}
      />
    );
  }
  return (
    <EditUserPanel
      title={t('titleFor', { name })}
      back={back}
      form={await editFormProps(locale, result.value, back.href, context.regional.defaultLocale)}
      texts={texts}
      discardTexts={discardTexts}
    />
  );
}

async function editFormProps(
  locale: AppLocale,
  view: EditUserView,
  profileHref: string,
  nameLanguage: 'ar' | 'en',
) {
  const t = await getTranslations({ locale, namespace: 'editUser' });
  const profile = await getTranslations({ locale, namespace: 'profile' });
  const common = await getTranslations({ locale, namespace: 'common' });
  const { user } = view;
  const labels: Record<string, string> = Object.fromEntries(EDIT_LABEL_KEYS.map((k) => [k, t(k)]));
  labels.required = common('required');
  labels.optional = common('optional');
  labels['part.firstName'] = profile('fields.firstName');
  labels['part.fatherName'] = profile('fields.fatherName');
  labels['part.grandfatherName'] = profile('fields.grandfatherName');
  labels['part.familyName'] = profile('fields.familyName');
  labels['language.ar'] = profile('languages.ar');
  labels['language.en'] = profile('languages.en');
  const fieldTexts: Record<string, string> = Object.fromEntries(
    EDIT_FIELD_ERROR_KEYS.map((k) => [k, t(`fieldErrors.${k}`)]),
  );
  // The organization's own level names (guided-test feedback #3): the field is named after the first
  // level, or «Unit» with each choice's level when levels mix.
  const ordinals = view.orgUnits.departments.map((d) => d.levelOrdinal);
  const withLevels = showsUnitLevels(view.levels, ordinals);
  labels.department = unitsLabel(view.levels, ordinals, locale, t('department'));
  const unit = (u: UnitOption) => ({
    id: u.id,
    name: unitNameWithLevel(
      localizedName(locale, u.nameAr, u.nameEn),
      u.levelOrdinal,
      view.levels,
      locale,
      withLevels,
    ),
  });
  // The current unit stays selectable even when deleted since (a save keeps it, never clears it).
  const withCurrent = (
    options: readonly UnitOption[],
    id: string | null,
    current: CurrentUnit | null,
  ) => {
    const list = options.map(unit);
    if (id === null || current === null || options.some((o) => o.id === id)) return list;
    const currentName = localizedName(locale, current.nameAr, current.nameEn);
    return [
      { id, name: current.deleted ? `${currentName} ${t('deleted')}` : currentName },
      ...list,
    ];
  };
  return {
    locale,
    personId: user.personId,
    version: user.version,
    names: formStateFrom(user),
    nameLanguage,
    values: {
      email: user.email ?? '',
      hasLogin: user.hasLogin,
      employeeNumber: user.employeeNumber ?? '',
      departmentId: user.departmentId ?? '',
      branchId: user.branchId ?? '',
      managerPersonId: user.managerPersonId ?? '',
      jobTitleAr: user.jobTitleAr ?? '',
      jobTitleEn: user.jobTitleEn ?? '',
      hireOn: user.hireOn ?? '',
    },
    departments: withCurrent(view.orgUnits.departments, user.departmentId, user.department),
    branches: withCurrent(view.orgUnits.branches, user.branchId, user.branch),
    managers: view.managers.map((m) => ({
      personId: m.personId,
      name: localizedName(locale, m.nameAr, m.nameEn),
      active: m.active,
      departmentIds: m.departmentIds,
    })),
    labels,
    fieldTexts,
    errors: await profileErrorTexts(locale),
    profileHref,
    hireOnHijri: user.hireOn
      ? t('hireDateHijri', { date: formatHijriDate(user.hireOn, locale) })
      : undefined,
  };
}

async function rolePanel(
  locale: AppLocale,
  personId: string,
  name: string,
  back: PanelReturn,
): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: 'editRoles' });
  const users = await getTranslations({ locale, namespace: 'users' });
  const result = await editRolesQuery({ personId });
  const common = {
    back,
    title: t('titleFor', { name }),
    closeLabel: t('close'),
    selectTexts: await roleSelectTexts(locale),
    labels: await editRoleLabels(locale),
    errors: await profileErrorTexts(locale),
    undoLabel: users('undo'),
    locale,
  };
  if (!result.ok) {
    const error = toClientError(result.error);
    if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
    if (error.code === 'NOT_FOUND' || error.code === 'VALIDATION_FAILED') notFound();
    return (
      <RolePanelRoute
        {...common}
        target={null}
        options={[]}
        scopeUnits={[]}
        unitTexts={await scopeUnitTexts(locale)}
        failure={await loadFailure(locale, result.error)}
      />
    );
  }
  const view: EditRolesView = result.value;
  return (
    <RolePanelRoute
      {...common}
      target={{
        personId: view.role.personId,
        name,
        version: view.role.version,
        currentRole: view.role.roleCode,
        currentUnit: view.role.scopeUnitId,
      }}
      blocked={view.blocked ? t(`blocked.${view.blocked}`) : null}
      options={roleOptions(view.choices, locale)}
      scopeUnits={scopeUnitChoices(view.scopeUnits.units, view.scopeUnits.levels, locale)}
      unitTexts={await scopeUnitTexts(locale, view.scopeUnits.structureVisible)}
    />
  );
}

async function deactivateDialog(
  locale: AppLocale,
  personId: string,
  name: string,
  profileView: ProfileView,
  back: PanelReturn,
): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: 'deactivation' });
  const editRoles = await getTranslations({ locale, namespace: 'editRoles' });
  const reactivate = await reactivateLabels(locale);
  const { profile } = profileView;
  const roleText = profile.roles?.[0]
    ? roleName(locale, profile.roles[0].roleCode, profile.roles[0].customName)
    : null;
  const unitText = profile.departmentNameAr
    ? localizedName(locale, profile.departmentNameAr, profile.departmentNameEn)
    : null;
  const texts: Record<string, string> = {
    close: editRoles('close'),
    cancel: t('cancel'),
    submit: t('submit'),
    submitMove: t('submitMove'),
    working: t('working'),
    doneToast: t('doneToast', { name: '{name}' }),
  };
  for (const [key, value] of Object.entries(reactivate)) texts[`reactivate.${key}`] = value;
  const common = {
    title: t('titleFor', { name }),
    back,
    person: { name, detail: [roleText, unitText].filter(Boolean).join(' · ') || null },
    effects: [
      t('effects.signIn'),
      t('effects.records'),
      t('effects.roles'),
      t('effects.reactivate'),
    ],
    texts,
    errors: await profileErrorTexts(locale),
  };
  const result = await deactivationQuery({ personId });
  if (!result.ok) {
    const error = toClientError(result.error);
    if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
    if (error.code === 'NOT_FOUND' || error.code === 'VALIDATION_FAILED') notFound();
    return (
      <DeactivateDialog {...common} form={null} failure={await loadFailure(locale, result.error)} />
    );
  }
  const view: DeactivationView = result.value;
  if (view.blocked) {
    return <DeactivateDialog {...common} form={null} blocked={t(`blocked.${view.blocked}`)} />;
  }
  const labels: Record<string, string> = Object.fromEntries(
    DEACTIVATION_KEYS.map((k) => [k, t(k)]),
  );
  const separator = locale === 'ar' ? '، ' : ', ';
  return (
    <DeactivateDialog
      {...common}
      form={{
        personId: view.target.personId,
        privileged: view.privileged,
        kinds: view.responsibilities.map((r) => {
          // Message keys per kind: `items.<code with "." → "_">` (the reassignment hook's contract).
          const key = r.code.replaceAll('.', '_');
          return {
            code: r.code,
            title: t(`items.${key}.title` as 'items.platform_direct_reports.title', {
              count: r.items.length,
            }),
            names: itemNames(
              r.items.map((item) => localizedName(locale, item.nameAr, item.nameEn)),
              (count) => t('moreItems', { count }),
              separator,
            ),
            picker: t(`items.${key}.picker` as 'items.platform_direct_reports.picker'),
            blockedText: r.blocked ? t(`itemsBlocked.${r.blocked}`) : null,
          };
        }),
        candidates: view.candidates.map((c) => ({
          personId: c.personId,
          name: localizedName(locale, c.nameAr, c.nameEn),
        })),
        reasons: DEACTIVATION_REASONS.map((value) => ({ value, label: t(`reasons.${value}`) })),
        labels,
        errors: await profileErrorTexts(locale),
      }}
    />
  );
}
