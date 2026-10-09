import { toClientError } from '@jadarat/platform-core';
import type { UserProfile } from '@jadarat/platform-db';
import { type AppLocale, formatHijriDate } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import { Alert, Card } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { NotSet } from '../../../../components/not-set';
import { AuthenticatorCard } from '../../../../components/profile/authenticator-card';
import { ChangePasswordForm } from '../../../../components/profile/change-password-form';
import { PersonalDetailsForm } from '../../../../components/profile/personal-details-form';
import { SessionsTable } from '../../../../components/sessions/sessions-table';
import { SuiteShell } from '../../../../components/suite-shell';
import { mfaErrorTexts } from '../../../../lib/auth-texts';
import { stepUpHref } from '../../../../lib/mfa-view';
import { formStateFrom } from '../../../../lib/profile-form';
import { profileErrorTexts } from '../../../../lib/profile-texts';
import { sessionLabels, sessionRows } from '../../../../lib/sessions-view';
import { getSuiteContext } from '../../../../lib/suite-context';
import { myProfileQuery, mySecurityQuery } from '../../../../lib/users-queries';
import { localizedName } from '../../../../lib/users-view';

/**
 * My profile (FR-IAM-16, T-M2-15a; PO decision 5 Oct 2026): the member changes their own personal
 * details and password; e-mail and job data are read-only (changed by HR). Opened from the header.
 */
export default async function MyProfilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
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
          security={security.ok ? security.value : null}
        />
      );
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="profile" path="/suite/profile">
      <h1 className="mb-6 mt-0 text-2xl font-bold">{t('title')}</h1>
      {content}
    </SuiteShell>
  );
}

async function MyProfile({
  locale,
  details,
  profile,
  security,
}: {
  locale: AppLocale;
  details: Parameters<typeof formStateFrom>[0];
  profile: UserProfile;
  security: Extract<Awaited<ReturnType<typeof mySecurityQuery>>, { ok: true }>['value'] | null;
}) {
  const reset = await getTranslations({ locale, namespace: 'passwordReset.reset' });
  const t = await getTranslations({ locale, namespace: 'profile' });
  const common = await getTranslations({ locale, namespace: 'common' });
  const fields = await getTranslations({ locale, namespace: 'userProfile' });
  const users = await getTranslations({ locale, namespace: 'users' });
  const format = await getFormatter({ locale });
  const errors = await profileErrorTexts(locale);
  const none = <NotSet label={users('noneLabel')} />;
  const named = (ar: string | null, en: string | null) =>
    ar ? localizedName(locale, ar, en) : null;
  const jobTitle =
    locale === 'en' ? (profile.jobTitleEn ?? profile.jobTitleAr) : profile.jobTitleAr;

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
    {
      key: 'department',
      label: fields('fields.department'),
      value: named(profile.departmentNameAr, profile.departmentNameEn) ?? none,
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

  return (
    <div className="flex flex-col gap-6" data-testid="my-profile">
      <Card title={t('personal')}>
        <p className="mb-4 mt-0 text-text-muted">{t('personalIntro')}</p>
        <PersonalDetailsForm
          locale={locale}
          initial={formStateFrom(details)}
          labels={{
            arabicName: t('arabicName'),
            englishName: t('englishName'),
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
        />
      </Card>

      <Card title={t('work')}>
        <p className="mb-4 mt-0 text-text-muted">{t('workIntro')}</p>
        <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          {work.map((field) => (
            <div key={field.key} className="flex flex-col gap-1">
              <dt className="text-sm text-text-muted">{field.label}</dt>
              <dd className="m-0">{field.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title={t('password')}>
        <p className="mb-4 mt-0 text-text-muted">{t('passwordIntro')}</p>
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
            current: t('currentPassword'),
            next: t('newPassword'),
            nextHint: t('newPasswordHint', { min: '{min}' }),
            confirm: t('confirmPassword'),
            required: common('required'),
            submit: t('changePassword'),
            submitting: t('changing'),
            changed: t('passwordChanged'),
          }}
          fieldTexts={{
            tooShort: t('fieldErrors.tooShort', { min: '{min}' }),
            tooLong: t('fieldErrors.tooLong'),
            mismatch: t('fieldErrors.mismatch'),
            currentRequired: t('fieldErrors.currentRequired'),
          }}
          errors={errors}
        />
      </Card>

      {security ? (
        <>
          <Card title={t('mfa.title')}>
            <p className="mb-4 mt-0 text-text-muted">{t('mfa.intro')}</p>
            <AuthenticatorCard
              usesApp={security.usesApp === true}
              setUpHref={stepUpHref(locale, `/${locale}/suite/profile`)}
              labels={{
                on: t('mfa.on'),
                off: t('mfa.off'),
                setUp: t('mfa.setUp'),
                remove: t('mfa.remove'),
                removing: t('mfa.removing'),
                removed: t('mfa.removed'),
                removeNeedsCode: t('mfa.removeNeedsCode'),
                verifyFirst: t('mfa.verifyFirst'),
                removeWarning: t('mfa.removeWarning'),
              }}
              errors={await mfaErrorTexts(locale)}
            />
          </Card>
          <Card title={t('sessions.title')}>
            <p className="mb-4 mt-0 text-text-muted">{t('sessions.intro')}</p>
            <SessionsTable
              target={{ kind: 'own' }}
              sessions={await sessionRows(locale, security.sessions)}
              labels={sessionLabels(locale)}
              errors={errors}
            />
          </Card>
        </>
      ) : null}
    </div>
  );
}
