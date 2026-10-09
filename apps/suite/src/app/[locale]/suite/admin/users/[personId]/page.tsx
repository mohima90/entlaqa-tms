import { toClientError } from '@jadarat/platform-core';
import type { UserProfile } from '@jadarat/platform-db';
import type { LifecycleOffer } from '@jadarat/platform-rbac';
import {
  type AppLocale,
  DEFAULT_CALENDAR,
  DEFAULT_NUMBERING_SYSTEM,
  formatHijriDate,
} from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import { Alert, Badge, type BadgeTone, Card, buttonClasses } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { SuiteShell } from '../../../../../../components/suite-shell';
import { ReactivateMemberButton } from '../../../../../../components/users/reactivate-member-button';
import { REACTIVATED_FLASH_PARAM } from '../../../../../../lib/deactivate-form';
import { reactivateLabels } from '../../../../../../lib/deactivation-texts';
import { profileErrorTexts } from '../../../../../../lib/profile-texts';
import { getSuiteContext } from '../../../../../../lib/suite-context';
import { userProfileQuery } from '../../../../../../lib/users-queries';
import { localizedName, roleName } from '../../../../../../lib/users-view';
import { NotSet } from '../../../../../../components/not-set';

type AccountStatus = NonNullable<UserProfile['membershipStatus']> | 'none';
const ACCOUNT_TONE: Record<AccountStatus, BadgeTone> = {
  active: 'success',
  invited: 'info',
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
]);

/**
 * User profile (T-M2-04, screen 3 — FR-IAM-01/07): authorized against the person (out of scope or
 * another organization → 404, no existence leak). Roles need role.read, the activity audit.read.
 * "Edit details" (T-M2-13) when the member may change this record; «تعطيل المستخدم» / «إعادة تفعيل
 * المستخدم» (T-M2-09, FR-IAM-05) for HR / the Organization Admin; sign-in sessions, MFA and lockout
 * (FR-IAM-12/13) join with T-M2-10.
 */
export default async function UserProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; personId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, personId } = await params;
  const reactivated = (await searchParams)[REACTIVATED_FLASH_PARAM] === '1';
  if (!hasLocale(routing.locales, locale)) notFound();
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'userProfile' });
  const users = await getTranslations({ locale, namespace: 'users' });
  const path = `/suite/admin/users/${encodeURIComponent(personId)}`;

  let content: ReactNode;
  let title = users('title');
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
      if (error.code === 'FORBIDDEN') {
        const errors = await getTranslations({ locale, namespace: 'errors' });
        content = <Alert tone="warning">{errors('forbidden')}</Alert>;
      } else {
        content = (
          <Alert tone="danger">
            {users('loadFailed', { correlationId: error.correlationId ?? '' })}
          </Alert>
        );
      }
    } else {
      const { profile, canOpenManager, canEdit, canEditRoles, lifecycle } = result.value;
      title = localizedName(locale, profile.displayNameAr, profile.displayNameEn);
      content = (
        <>
          {reactivated && profile.membershipStatus === 'active' ? (
            <Alert tone="success" className="mb-4" data-testid="reactivated">
              {(await getTranslations({ locale, namespace: 'deactivation' }))('reactivate.done')}
            </Alert>
          ) : null}
          <Profile
            locale={locale}
            profile={profile}
            canOpenManager={canOpenManager}
            canEdit={canEdit}
            canEditRoles={canEditRoles}
            lifecycle={lifecycle}
          />
        </>
      );
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="users" path={path}>
      <nav aria-label={t('breadcrumbLabel')} className="mb-2 text-sm">
        <a href={`/${locale}/suite/admin/users`}>{t('breadcrumb')}</a>
      </nav>
      <h1 className="mb-4 mt-0 text-2xl font-bold">{title}</h1>
      {content}
    </SuiteShell>
  );
}

async function Profile({
  locale,
  profile,
  canOpenManager,
  canEdit,
  canEditRoles,
  lifecycle,
}: {
  locale: AppLocale;
  profile: UserProfile;
  canOpenManager: boolean;
  canEdit: boolean;
  canEditRoles: boolean;
  lifecycle: LifecycleOffer;
}) {
  const t = await getTranslations({ locale, namespace: 'userProfile' });
  const deactivation = await getTranslations({ locale, namespace: 'deactivation' });
  const name = localizedName(locale, profile.displayNameAr, profile.displayNameEn);
  const profileHref = `/${locale}/suite/admin/users/${profile.personId}`;
  const users = await getTranslations({ locale, namespace: 'users' });
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
  const accountStatus: AccountStatus = profile.membershipStatus ?? 'none';
  const subtitle = [jobTitle, department, branch].filter(Boolean).join(' · ');
  const now = new Date();
  // Role days in the organization's time zone, as on the edit-roles page (T-M2-14).
  const roleDay = (value: Date) =>
    format.dateTime(value, {
      dateStyle: 'medium',
      timeZone: profile.timeZone,
      calendar: DEFAULT_CALENDAR,
      numberingSystem: DEFAULT_NUMBERING_SYSTEM,
    });

  const fields: { key: string; label: string; value: ReactNode }[] = [
    {
      key: 'email',
      label: t('fields.email'),
      value: profile.email ? <bdi dir="ltr">{profile.email}</bdi> : none,
    },
    {
      key: 'mobile',
      label: t('fields.mobile'),
      value: profile.mobileE164 ? <bdi dir="ltr">{profile.mobileE164}</bdi> : none,
    },
    {
      key: 'employeeNumber',
      label: t('fields.employeeNumber'),
      value: profile.employeeNumber ? <bdi dir="ltr">{profile.employeeNumber}</bdi> : none,
    },
    { key: 'jobTitle', label: t('fields.jobTitle'), value: jobTitle ?? none },
    { key: 'department', label: t('fields.department'), value: department ?? none },
    { key: 'branch', label: t('fields.branch'), value: branch ?? none },
    {
      key: 'manager',
      label: t('fields.manager'),
      value: profile.manager ? (
        canOpenManager ? (
          <a href={`/${locale}/suite/admin/users/${profile.manager.personId}`}>
            {localizedName(locale, profile.manager.displayNameAr, profile.manager.displayNameEn)}
          </a>
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
          <span className="text-text-muted">
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
          value: <bdi dir="rtl">{profile.displayNameAr}</bdi>,
        }
      : {
          key: 'nameEn',
          label: t('fields.nameEn'),
          value: profile.displayNameEn ? <bdi dir="ltr">{profile.displayNameEn}</bdi> : none,
        },
  ];

  return (
    <div className="flex flex-col gap-6" data-testid="user-profile">
      <div className="flex flex-wrap items-center gap-3">
        {subtitle ? <p className="m-0 text-text-muted">{subtitle}</p> : null}
        <Badge tone={ACCOUNT_TONE[accountStatus]}>{t(`accountStatuses.${accountStatus}`)}</Badge>
        {canEdit || lifecycle.canDeactivate ? (
          <div className="ms-auto flex flex-wrap gap-2">
            {canEdit ? (
              <a
                href={`/${locale}/suite/admin/users/${profile.personId}/edit`}
                className={buttonClasses({ variant: 'secondary' })}
                data-testid="edit-user-link"
              >
                {t('editDetails')}
              </a>
            ) : null}
            {lifecycle.canDeactivate ? (
              <a
                href={`${profileHref}/deactivate`}
                // Screen 3's danger-outline button (destructive, but only opens screen 4).
                className={buttonClasses({ variant: 'danger-outline' })}
                data-testid="deactivate-user-link"
              >
                {t('deactivate')}
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
      {lifecycle.reactivate === 'allowed' ? (
        <ReactivateMemberButton
          personId={profile.personId}
          name={name}
          privileged={lifecycle.privileged}
          labels={await reactivateLabels(locale)}
          errors={await profileErrorTexts(locale)}
          successHref={`${profileHref}?${REACTIVATED_FLASH_PARAM}=1`}
        />
      ) : lifecycle.reactivate === 'step_up_required' ? (
        <Alert tone="info" data-testid="reactivate-step-up">
          {deactivation('reactivate.stepUp')}
        </Alert>
      ) : null}

      <Card title={t('basicData')}>
        <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          {fields.map((field) => (
            <div key={field.key} className="flex flex-col gap-1">
              <dt className="text-sm text-text-muted">{field.label}</dt>
              <dd className="m-0">{field.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {profile.roles ? (
        <Card title={t('roles')}>
          {profile.roles.length === 0 ? (
            <p className="m-0 text-text-muted">{t('noRoles')}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0" data-testid="user-roles">
              {profile.roles.map((role) => {
                const ended = role.validUntil !== null && role.validUntil <= now;
                return (
                  <li key={role.roleCode} className="flex flex-wrap items-center gap-2">
                    <span className={ended ? 'text-text-muted line-through' : 'font-medium'}>
                      {roleName(locale, role.roleCode)}
                    </span>
                    <Badge tone={role.isPrimary ? 'info' : 'neutral'}>
                      {role.isPrimary ? t('primaryRole') : t('additionalRole')}
                    </Badge>
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
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mb-0 mt-4 text-sm text-text-muted">{t('rolesAudited')}</p>
          {canEditRoles ? (
            <a
              href={`/${locale}/suite/admin/users/${profile.personId}/roles`}
              className={buttonClasses({ variant: 'secondary', className: 'mt-4' })}
              data-testid="edit-roles-link"
            >
              {t('editRoles')}
            </a>
          ) : null}
        </Card>
      ) : null}

      <Card title={t('account')}>
        <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="text-sm text-text-muted">{t('accountStatus')}</dt>
            <dd className="m-0">{t(`accountStatuses.${accountStatus}`)}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-sm text-text-muted">{t('lastSignIn')}</dt>
            <dd className="m-0">
              {profile.lastSignInAt
                ? format.dateTime(profile.lastSignInAt, 'dateTime')
                : t('never')}
            </dd>
          </div>
        </dl>
      </Card>

      {profile.activity ? (
        <Card title={t('activity')}>
          {profile.activity.length === 0 ? (
            <p className="m-0 text-text-muted">{t('noActivity')}</p>
          ) : (
            <ol className="m-0 flex list-none flex-col gap-3 p-0" data-testid="user-activity">
              {profile.activity.map((event, index) => {
                const actor = event.actorNameAr
                  ? t('by', { name: localizedName(locale, event.actorNameAr, event.actorNameEn) })
                  : t('bySystem');
                return (
                  <li
                    key={`${event.occurredAt.toISOString()}-${index}`}
                    className="flex flex-col gap-1"
                  >
                    <span className="font-medium">
                      {KNOWN_ACTIONS.has(event.action)
                        ? t(`actions.${event.action.replaceAll('.', '_')}` as 'actions.other')
                        : t('actions.other', { action: event.action })}
                    </span>
                    <span className="text-sm text-text-muted">
                      {format.dateTime(event.occurredAt, 'dateTime')} · {actor}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      ) : null}
    </div>
  );
}
