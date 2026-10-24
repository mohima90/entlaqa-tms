import { routing } from '@jadarat/platform-i18n/routing';
import { Alert } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { AuthCard, AuthLanguageSwitch, AuthShell } from '../../../components/auth/auth-shell';
import { SignOutButton } from '../../../components/auth/sign-out-button';
import { PlanOverview } from '../../../components/plan/plan-overview';
import { authLanguageSwitch, authShellTexts } from '../../../lib/auth-shell-texts';
import { pausedOrganizationPlan } from '../../../lib/plan-queries';
import { requestSessionState } from '../../../lib/request-session';
import { redirectFor } from '../../../lib/session-state';
import { authBrandOf } from '../../../lib/sign-in-brand';

/**
 * «الوصول متوقف» / Access paused for a suspended organization's Organization Admin (WP-ADM-06; PO 24 Oct 2026:
 * "the Org Admin signs in to the Subscription page only — status, plan, contact ENTLAQA"): what happened, the
 * plan with its status, and Sign out. Nothing else of the organization opens while it is suspended (the
 * database serves no other page). Every other session goes where it belongs.
 */
export default async function PausedPage({ params }: { params: Promise<{ locale: string }> }) {
  await connection();
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const session = await requestSessionState();
  const elsewhere = redirectFor(locale, session, 'paused');
  if (elsewhere) redirect(elsewhere);
  const plan = await pausedOrganizationPlan();
  if (!plan) redirect(`/${locale}/sign-in`);

  const t = await getTranslations({ locale, namespace: 'plans' });
  const auth = await getTranslations({ locale, namespace: 'auth' });
  return (
    <AuthShell
      variant="focus"
      brand={authBrandOf(null)}
      texts={await authShellTexts(locale)}
      languageSwitch={<AuthLanguageSwitch {...await authLanguageSwitch(locale, '/paused')} />}
      headerEnd={
        <SignOutButton locale={locale} label={auth('signOut')} pendingLabel={auth('signingOut')} />
      }
      icon="alert"
      size="md"
      title={t('paused.adminTitle')}
      subtitle={<p>{t('paused.adminText')}</p>}
    >
      <AuthCard>
        <div className="flex flex-col gap-4" data-testid="paused-admin">
          <PlanOverview locale={locale} plan={plan} compact />
          <Alert tone="info">{t('paused.contact')}</Alert>
        </div>
      </AuthCard>
    </AuthShell>
  );
}
