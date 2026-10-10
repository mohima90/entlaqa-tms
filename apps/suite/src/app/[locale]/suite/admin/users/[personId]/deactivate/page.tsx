import { toClientError } from '@jadarat/platform-core';
import type { AppLocale } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import { DEACTIVATION_REASONS, type DeactivationView } from '@jadarat/platform-rbac';
import { Alert, Card } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { SuiteShell } from '../../../../../../../components/suite-shell';
import {
  type DeactivationKindRow,
  DeactivateMemberForm,
} from '../../../../../../../components/users/deactivate-member-form';
import { DEACTIVATED_FLASH_PARAM, itemNames } from '../../../../../../../lib/deactivate-form';
import { profileErrorTexts } from '../../../../../../../lib/profile-texts';
import { getSuiteContext } from '../../../../../../../lib/suite-context';
import { deactivationQuery } from '../../../../../../../lib/users-queries';
import { localizedName } from '../../../../../../../lib/users-view';

/** Text keys of the form (namespace `deactivation`). */
const LABEL_KEYS = [
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

/**
 * Deactivate a member (T-M2-09, FR-IAM-05; approved screen 4, built as a page — like «تعديل الأدوار» —
 * rather than a dialog over the profile): what it does, what the person is responsible for and its new
 * owner, an optional reason. `platform.user.deactivate` (HR Manager for members without a privileged role,
 * Organization Admin); a member who holds a privileged role only by the Organization Admin after an
 * authenticator code (the page says so first, as for reactivation); out of scope or another organization
 * → 404.
 */
export default async function DeactivatePage({
  params,
}: {
  params: Promise<{ locale: string; personId: string }>;
}) {
  const { locale, personId } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'deactivation' });
  const users = await getTranslations({ locale, namespace: 'users' });
  const profileHref = `/${locale}/suite/admin/users/${encodeURIComponent(personId)}`;

  let content: ReactNode;
  let name: string | null = null;
  if (!context.live) {
    content = (
      <Alert tone="info" data-testid="users-not-configured">
        {users('notConfigured')}
      </Alert>
    );
  } else {
    const result = await deactivationQuery({ personId });
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
      const { target } = result.value;
      name = localizedName(locale, target.displayNameAr, target.displayNameEn);
      content = await deactivation(locale, result.value, profileHref);
    }
  }

  return (
    <SuiteShell
      locale={locale}
      context={context}
      current="users"
      path={`/suite/admin/users/${encodeURIComponent(personId)}/deactivate`}
    >
      <nav aria-label={t('breadcrumbLabel')} className="mb-2 text-sm">
        <a href={`/${locale}/suite/admin/users`}>{t('breadcrumb')}</a>
        {name ? (
          <>
            {' / '}
            <a href={profileHref}>{name}</a>
          </>
        ) : null}
      </nav>
      <h1 className="mb-6 mt-0 text-2xl font-bold">
        {name ? t('titleFor', { name }) : t('title')}
      </h1>
      {content}
    </SuiteShell>
  );
}

async function deactivation(
  locale: AppLocale,
  view: DeactivationView,
  profileHref: string,
): Promise<ReactNode> {
  const t = await getTranslations({ locale, namespace: 'deactivation' });
  if (view.blocked) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="info" data-testid="deactivation-blocked">
          {t(`blocked.${view.blocked}`)}
        </Alert>
        <a href={profileHref}>{t('backToProfile')}</a>
      </div>
    );
  }
  const labels: Record<string, string> = Object.fromEntries(LABEL_KEYS.map((k) => [k, t(k)]));
  const separator = locale === 'ar' ? '، ' : ', ';
  const kinds: DeactivationKindRow[] = view.responsibilities.map((r) => {
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
  });
  return (
    <Card className="flex flex-col gap-6">
      <ul className="m-0 flex flex-col gap-1 ps-5" data-testid="deactivation-effects">
        <li>{t('effects.signIn')}</li>
        <li>{t('effects.records')}</li>
        <li>{t('effects.roles')}</li>
        <li>{t('effects.reactivate')}</li>
      </ul>
      <DeactivateMemberForm
        personId={view.target.personId}
        privileged={view.privileged}
        kinds={kinds}
        candidates={view.candidates.map((c) => ({
          personId: c.personId,
          name: localizedName(locale, c.nameAr, c.nameEn),
        }))}
        reasons={DEACTIVATION_REASONS.map((value) => ({
          value,
          label: t(`reasons.${value}`),
        }))}
        labels={labels}
        errors={await profileErrorTexts(locale)}
        cancelHref={profileHref}
        successHref={`/${locale}/suite/admin/users?tab=deactivated&${DEACTIVATED_FLASH_PARAM}=1`}
      />
    </Card>
  );
}
