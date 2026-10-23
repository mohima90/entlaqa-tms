import { toClientError } from '@jadarat/platform-core';
import type { UserProfile } from '@jadarat/platform-db';
import type { PersonRecordView } from '@jadarat/platform-rbac';
import { type AppLocale, type DisplayDateFormatter, formatHijriDate } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import { Alert, Avatar, Badge, FormSection, Icon, PageHeader, TabNav } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { NotSet } from '../../../../components/not-set';
import {
  AuthenticatorBanner,
  type AuthenticatorCardApp,
  AuthenticatorProvider,
  AuthenticatorRow,
} from '../../../../components/profile/authenticator-card';
import { ChangePasswordForm } from '../../../../components/profile/change-password-form';
import { PersonalDetailsForm } from '../../../../components/profile/personal-details-form';
import { ProfilePhotoCard } from '../../../../components/profile/profile-photo-card';
import { SessionsTable } from '../../../../components/sessions/sessions-table';
import { HrDetailsCard } from '../../../../components/users/hr-details-card';
import { SuiteShell } from '../../../../components/suite-shell';
import { mfaErrorTexts } from '../../../../lib/auth-texts';
import { personPhotoHref } from '../../../../lib/person-photo';
import { stepUpHref } from '../../../../lib/mfa-view';
import { formStateFrom } from '../../../../lib/profile-form';
import { profileErrorTexts } from '../../../../lib/profile-texts';
import { sessionLabels, sessionRows } from '../../../../lib/sessions-view';
import { getSuiteContext } from '../../../../lib/suite-context';
import { settingsCommonTexts } from '../../../../lib/settings-page';
import { pageDates } from '../../../../lib/page-dates';
import { myProfileQuery, mySecurityQuery } from '../../../../lib/users-queries';
import { describeUserAgent } from '../../../../lib/user-agent';
import { type LevelLabel, unitFieldLabel } from '../../../../lib/structure-view';
import { localizedName, roleName } from '../../../../lib/users-view';

/**
 * My profile (FR-IAM-16, T-M2-15a; PO decision 5 Oct 2026): the member changes their own personal
 * details and password; e-mail and job data are read-only (changed by HR). Opened from the header.
 */
export default async function MyProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const rawTab = (await searchParams).tab;
  // Two views of the page, each its own address (`?tab=security`): the step-up and the authenticator
  // set-up return to the right tab (redesign package 6).
  const tab = (Array.isArray(rawTab) ? rawTab[0] : rawTab) === 'security' ? 'security' : 'profile';
  if (!hasLocale(routing.locales, locale)) notFound();
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'profile' });
  const users = await getTranslations({ locale, namespace: 'users' });

  let content: ReactNode;
  if (!context.live) {
    content = (
      <Alert tone="info" data-testid="profile-not-configured">
        {users('notConfigured')}
      </Alert>
    );
  } else {
    const result = await myProfileQuery({});
    if (!result.ok) {
      const error = toClientError(result.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      content =
        error.code === 'NOT_FOUND' ? (
          <Alert tone="info">{t('noProfile')}</Alert>
        ) : (
          <Alert tone="danger">
            {users('loadFailed', { correlationId: error.correlationId ?? '' })}
          </Alert>
        );
    } else {
      // Own sign-in sessions, password rule and authenticator app (T-M2-10).
      const security = await mySecurityQuery({});
      content = (
        <MyProfile
          locale={locale}
          details={result.value.details}
          profile={result.value.profile}
          levels={result.value.levels}
          record={result.value.record}
          live
          security={security.ok ? security.value : null}
          dates={pageDates(locale, context)}
          nameLanguage={context.regional.defaultLocale}
          tab={tab}
          primaryRole={
            context.me?.primaryRole
              ? roleName(locale, context.me.primaryRole.code, context.me.primaryRole.customName)
              : null
          }
          organizationName={context.organizationName}
        />
      );
    }
  }

  return (
    <SuiteShell
      locale={locale}
      context={context}
      current="profile"
      path={tab === 'security' ? '/suite/profile?tab=security' : '/suite/profile'}
    >
      <PageHeader title={t('title')} />
      {content}
    </SuiteShell>
  );
}

async function MyProfile({
  locale,
  details,
  profile,
  security,
  dates,
  nameLanguage,
  levels,
  record,
  live,
  tab,
  primaryRole,
  organizationName,
}: {
  /** The member's own grade and HR-only fields, read-only (WP-ADM-04). */
  record: PersonRecordView;
  /** Sign-in and database configured: the photo buttons work. */
  live: boolean;
  /** The organization's own level names: the unit field says its level (guided-test feedback #3). */
  levels: readonly LevelLabel[];
  locale: AppLocale;
  /** The organization's default language: its names are required and shown first (PO 17 Oct 2026). */
  nameLanguage: 'ar' | 'en';
  /** Dates as the organization shows them (T-M2-22). */
  dates: DisplayDateFormatter;
  details: Parameters<typeof formStateFrom>[0];
  profile: UserProfile;
  security: Extract<Awaited<ReturnType<typeof mySecurityQuery>>, { ok: true }>['value'] | null;
  tab: 'profile' | 'security';
  /** The member's role name, display only. */
  primaryRole: string | null;
  organizationName: string | null;
}) {
  const reset = await getTranslations({ locale, namespace: 'passwordReset.reset' });
  const t = await getTranslations({ locale, namespace: 'profile' });
  const mfa = await getTranslations({ locale, namespace: 'mfa' });
  const common = await getTranslations({ locale, namespace: 'common' });
  const fields = await getTranslations({ locale, namespace: 'userProfile' });
  const users = await getTranslations({ locale, namespace: 'users' });
  const people = await getTranslations({ locale, namespace: 'peopleRecord' });
  const format = await getFormatter({ locale });
  const errors = await profileErrorTexts(locale);
  const none = <NotSet label={users('noneLabel')} />;
  const named = (ar: string | null, en: string | null) =>
    ar ? localizedName(locale, ar, en) : null;
  const jobTitle =
    locale === 'en' ? (profile.jobTitleEn ?? profile.jobTitleAr) : profile.jobTitleAr;
  const unitName = named(profile.departmentNameAr, profile.departmentNameEn);
  const fullName = localizedName(locale, details.displayNameAr, details.displayNameEn);
  const photoHref = personPhotoHref(profile.personId, profile.photoVersion);

  const work: { key: string; label: string; value: ReactNode }[] = [
    {
      key: 'email',
      label: fields('fields.email'),
      value: profile.email ? (
        <>
          <bdi dir="ltr">{profile.email}</bdi>
          <span className="block text-sm text-text-muted">{t('emailLocked')}</span>
        </>
      ) : (
        none
      ),
    },
    {
      key: 'employeeNumber',
      label: fields('fields.employeeNumber'),
      value: profile.employeeNumber ? <bdi dir="ltr">{profile.employeeNumber}</bdi> : none,
    },
    { key: 'jobTitle', label: fields('fields.jobTitle'), value: jobTitle ?? none },
    ...(record.grade
      ? [
          {
            key: 'grade',
            label: people('grade.label'),
            value: record.grade.code ? <bdi dir="ltr">{record.grade.code}</bdi> : none,
          },
        ]
      : []),
    {
      key: 'department',
      label: unitFieldLabel(
        levels,
        profile.departmentLevelOrdinal,
        locale,
        fields('fields.department'),
      ),
      value: unitName ?? none,
    },
    {
      key: 'branch',
      label: fields('fields.branch'),
      value: named(profile.branchNameAr, profile.branchNameEn) ?? none,
    },
    {
      key: 'manager',
      label: fields('fields.manager'),
      value: profile.manager
        ? localizedName(locale, profile.manager.displayNameAr, profile.manager.displayNameEn)
        : none,
    },
    {
      key: 'hireDate',
      label: fields('fields.hireDate'),
      value: profile.hireOn ? (
        <>
          {format.dateTime(new Date(`${profile.hireOn}T00:00:00Z`), {
            dateStyle: 'long',
            timeZone: 'UTC',
            numberingSystem: 'latn',
            calendar: 'gregory',
          })}{' '}
          <span className="text-text-muted">
            {fields('hijri', { date: formatHijriDate(profile.hireOn, locale) })}
          </span>
        </>
      ) : (
        none
      ),
    },
  ];

  // The address of each tab (a link, so a step-up and the set-up come back to the right one).
  const profileHref = `/${locale}/suite/profile`;
  const securityHref = `${profileHref}?tab=security`;

  const identity = (
    <section
      aria-labelledby="profile-identity-name"
      className="mb-5 flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-surface p-4.5 shadow-2 md:gap-5 md:px-6 md:py-5.5"
      data-testid="profile-identity"
    >
      <Avatar
        name={fullName || (profile.email ?? '')}
        size="xl"
        src={photoHref ?? undefined}
        alt={people('photo.alt', { name: fullName || (profile.email ?? '') })}
      />
      <div className="min-w-56 flex-1">
        <h2 id="profile-identity-name" className="m-0 text-2xl font-bold">
          {fullName}
        </h2>
        {jobTitle || unitName ? (
          <p className="m-0 mt-1 text-text-muted">
            {[jobTitle, unitName].filter(Boolean).join(' · ')}
          </p>
        ) : null}
        <p className="m-0 mt-2.5 flex flex-wrap gap-2">
          {primaryRole ? <Badge tone="brand">{primaryRole}</Badge> : null}
          {organizationName ? (
            <Badge>
              <Icon name="building" className="size-3.5" />
              {organizationName}
            </Badge>
          ) : null}
          {profile.email ? (
            <Badge>
              <bdi dir="ltr">{profile.email}</bdi>
            </Badge>
          ) : null}
        </p>
      </div>
    </section>
  );

  const tabs = (
    <TabNav
      variant="underline"
      label={t('tabs.label')}
      current={tab}
      className="mb-5"
      items={[
        { key: 'profile', href: profileHref, label: t('tabs.profile'), icon: 'user' },
        { key: 'security', href: securityHref, label: t('tabs.security'), icon: 'shield' },
      ]}
    />
  );

  const settingsCommon = await settingsCommonTexts(locale);

  const profileTab = (
    <>
      <ProfilePhotoCard
        name={fullName || (profile.email ?? '')}
        photoHref={photoHref}
        live={live}
        errors={errors}
        labels={{
          title: people('photo.title'),
          intro: people('photo.intro'),
          upload: people('photo.upload'),
          replace: people('photo.replace'),
          remove: people('photo.remove'),
          rules: people('photo.rules'),
          noPhoto: people('photo.noPhoto'),
          errType: people('photo.errType'),
          errSize: people('photo.errSize'),
          errNotUsable: people('photo.errNotUsable'),
          errUpload: people('photo.errUpload'),
          removeTitle: people('photo.removeTitle'),
          removeText: people('photo.removeText'),
          removeConfirm: people('photo.removeConfirm'),
          removed: people('photo.removed'),
          saved: people('photo.saved'),
          cancel: common('cancel'),
          close: common('close'),
        }}
        crop={{
          title: people('photo.cropTitle'),
          help: people('photo.cropHelp'),
          area: people('photo.cropArea'),
          zoom: people('photo.zoom'),
          shrunk: people('photo.shrunk'),
          save: people('photo.save'),
          saving: people('photo.saving'),
          cancel: common('cancel'),
          close: common('close'),
          errType: people('photo.errType'),
          errSize: people('photo.errSize'),
          errLoad: people('photo.errLoad'),
        }}
      />
      <PersonalDetailsForm
        locale={locale}
        initial={formStateFrom(details)}
        nameLanguage={nameLanguage}
        labels={{
          personal: t('personal'),
          personalIntro: t('personalIntro'),
          arabicName: t('arabicName'),
          englishName: t('englishName'),
          addArabicName: t('addArabicName'),
          addEnglishName: t('addEnglishName'),
          parts: {
            firstName: t('fields.firstName'),
            fatherName: t('fields.fatherName'),
            grandfatherName: t('fields.grandfatherName'),
            familyName: t('fields.familyName'),
          },
          mobile: t('fields.mobile'),
          mobileHint: t('mobileHint'),
          language: t('fields.language'),
          languages: { ar: t('languages.ar'), en: t('languages.en') },
          required: common('required'),
          optional: common('optional'),
          save: t('save'),
          saving: t('saving'),
          saved: t('saved'),
          cancel: common('cancel'),
          noChanges: t('noChanges'),
          prefilledName: t('prefilledName'),
          currentName: t('currentName'),
          currentNameKept: t('currentNameKept'),
        }}
        fieldTexts={{
          required: t('fieldErrors.required'),
          name: t('fieldErrors.name'),
          mobile: t('fieldErrors.mobile'),
          nameTooLong: t('fieldErrors.nameTooLong'),
        }}
        errors={errors}
        common={settingsCommon}
      >
        <FormSection title={t('work')} description={t('workIntro')} className="mt-5.5">
          <dl className="m-0 grid grid-cols-1 gap-x-7 gap-y-4.5 sm:grid-cols-2 md:col-span-2">
            {work.map((field) => (
              <div key={field.key} className="flex min-w-0 flex-col gap-1">
                <dt className="text-[13.5px] text-text-muted">{field.label}</dt>
                <dd className="m-0 font-medium [overflow-wrap:anywhere]">{field.value}</dd>
              </div>
            ))}
          </dl>
        </FormSection>
        {record.hr ? (
          <HrDetailsCard
            locale={locale}
            details={record.hr.details}
            own={record.hr.own}
            className="mt-5.5 grid grid-cols-1 gap-x-8 gap-y-6 rounded-xl border border-border bg-surface px-7 py-6.5 md:col-span-2 lg:grid-cols-[260px_minmax(0,1fr)]"
          />
        ) : null}
      </PersonalDetailsForm>
    </>
  );

  const securityTab = (
    <AuthenticatorProvider
      app={security ? await authenticatorApp(locale, security.apps, dates) : { state: 'off' }}
      setUpHref={stepUpHref(locale, securityHref)}
      forgotPasswordHref={`/${locale}/forgot-password`}
      labels={{
        title: t('mfa.title'),
        intro: t('mfa.intro'),
        on: t('mfa.on'),
        off: t('mfa.off'),
        setUp: t('mfa.setUp'),
        remove: t('mfa.remove'),
        removing: t('mfa.removing'),
        removed: t('mfa.removed'),
        removeConfirm: t('mfa.removeConfirm'),
        removeNeedsCode: t('mfa.removeNeedsCode'),
        verifyFirst: t('mfa.verifyFirst'),
        removeWarning: t('mfa.removeWarning'),
        pending: t('mfa.pending'),
        pendingText: t('mfa.pendingText'),
        enterCode: t('mfa.enterCode'),
        cancel: t('mfa.cancel'),
        cancelling: t('mfa.cancelling'),
        cancelled: t('mfa.cancelled'),
        dismiss: common('cancel'),
        close: common('close'),
        elsewhere: t('mfa.elsewhere'),
        removeElsewhere: mfa('elsewhere.remove'),
        removedElsewhere: mfa('elsewhere.removed'),
        newPassword: mfa('elsewhere.newPassword'),
        itWasMe: mfa('elsewhere.itWasMe'),
        itWasMeText: mfa('elsewhere.itWasMeText'),
      }}
      errors={await mfaErrorTexts(locale)}
    >
      <div className="flex flex-col gap-5">
        {security ? <AuthenticatorBanner /> : null}
        <div className="flex flex-col divide-y divide-border rounded-2xl border border-border bg-surface shadow-2 *:px-4.5 *:py-5 md:*:px-6.5">
          <ChangePasswordForm
            minLength={security?.passwordMinLength ?? 12}
            rules={{
              rulesLabel: reset('rulesLabel'),
              ruleMinLength: reset('rules.minLength', { min: '{min}' }),
              ruleMaxBytes: reset('rules.maxBytes'),
              ruleMatches: reset('rules.matches'),
              ruleMet: reset('rules.met'),
              ruleNotMet: reset('rules.notMet'),
            }}
            labels={{
              title: t('password'),
              intro: t('passwordIntro'),
              current: t('currentPassword'),
              next: t('newPassword'),
              nextHint: t('newPasswordHint', { min: '{min}' }),
              confirm: t('confirmPassword'),
              required: common('required'),
              submit: t('changePassword'),
              submitting: t('changing'),
              changed: t('passwordChanged'),
              cancel: common('cancel'),
            }}
            fieldTexts={{
              tooShort: t('fieldErrors.tooShort', { min: '{min}' }),
              tooLong: t('fieldErrors.tooLong'),
              mismatch: t('fieldErrors.mismatch'),
              currentRequired: t('fieldErrors.currentRequired'),
            }}
            errors={errors}
          />
          {security ? <AuthenticatorRow /> : null}
        </div>
        {security ? (
          <section
            aria-labelledby="sessions-title"
            className="rounded-2xl border border-border bg-surface px-4.5 py-5 shadow-2 md:px-6.5"
          >
            <div className="mb-4 flex items-start gap-4">
              <span
                aria-hidden="true"
                className="hidden size-11 shrink-0 place-items-center rounded-[14px] bg-primary-subtle text-primary-text md:grid"
              >
                <Icon name="monitor" className="size-5" />
              </span>
              <div>
                <h2 id="sessions-title" className="m-0 text-lg font-bold">
                  {t('sessions.title')}
                </h2>
                <p className="m-0 mt-1 text-text-muted">{t('sessions.intro')}</p>
              </div>
            </div>
            <SessionsTable
              target={{ kind: 'own' }}
              sessions={await sessionRows(locale, security.sessions, dates)}
              labels={sessionLabels(locale)}
              errors={errors}
            />
          </section>
        ) : null}
      </div>
    </AuthenticatorProvider>
  );

  return (
    <div className="max-w-4xl" data-testid="my-profile">
      {identity}
      {tabs}
      {tab === 'security' ? securityTab : profileTab}
    </div>
  );
}

/**
 * The account's authenticator app as this window sees it (re-review N1): an app added from another sign-in
 * first (a security warning, with when and which browser), then a confirmed app, then this window's set-up.
 */
async function authenticatorApp(
  locale: AppLocale,
  apps: Extract<Awaited<ReturnType<typeof mySecurityQuery>>, { ok: true }>['value']['apps'],
  dates: DisplayDateFormatter,
): Promise<AuthenticatorCardApp> {
  const elsewhere = apps.find((app) => !app.confirmed && !app.here);
  if (elsewhere) {
    const t = await getTranslations({ locale, namespace: 'profile.mfa' });
    const mfa = await getTranslations({ locale, namespace: 'mfa.elsewhere' });
    const device = describeUserAgent(elsewhere.userAgent);
    return {
      state: 'elsewhere',
      factorId: elsewhere.factorId,
      notice: t('elsewhereText', {
        date: dates.longDateTime(elsewhere.setUpAt),
        device:
          device.browser && device.system
            ? mfa('device', { browser: device.browser, system: device.system })
            : (device.browser ?? device.system ?? mfa('unknownDevice')),
      }),
    };
  }
  const confirmed = apps.find((app) => app.confirmed);
  if (confirmed) return { state: 'on', factorId: confirmed.factorId };
  const here = apps.find((app) => !app.confirmed && app.here);
  if (here) return { state: 'pending', factorId: here.factorId };
  return { state: 'off' };
}
