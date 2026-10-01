import { hasTenant } from '@jadarat/platform-core';
import { routing } from '@jadarat/platform-i18n/routing';
import { getVerifiedClaims } from '@jadarat/platform-identity/next';
import { Card } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { SignInForm } from '../../../components/auth/sign-in-form';
import { LanguageToggle } from '../../../components/language-toggle';
import { authErrorTexts } from '../../../lib/auth-texts';
import { getConfigStatus } from '../../../lib/config-status';

/** Sign-in (T-M1-D03): e-mail + password; MFA off by default for now (PO decision, 1 Oct 2026). */
export default async function SignInPage({ params }: { params: Promise<{ locale: string }> }) {
  await connection();
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const status = getConfigStatus();

  if (status.auth) {
    const claims = await getVerifiedClaims();
    if (claims.ok) {
      redirect(`/${locale}${hasTenant(claims.value) ? '/suite' : '/select-organization'}`);
    }
  }

  const t = await getTranslations({ locale, namespace: 'auth' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-4 py-3">
        <span className="text-lg font-semibold">{common('productName')}</span>
        <LanguageToggle locale={locale} path="/sign-in" />
      </header>
      <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-10">
        <h1 className="m-0 text-2xl font-bold">{t('signInTitle')}</h1>
        <Card>
          {status.auth ? (
            <p className="mb-4 mt-0 text-text-muted">{t('signInIntro')}</p>
          ) : (
            <p className="mb-4 mt-0 text-text-muted" data-testid="auth-not-configured">
              {t('notConfigured')}
            </p>
          )}
          <SignInForm
            locale={locale}
            disabled={!status.auth}
            labels={{
              email: t('emailLabel'),
              password: t('passwordLabel'),
              submit: t('submit'),
              submitting: t('submitting'),
            }}
            errors={await authErrorTexts(locale)}
          />
        </Card>
      </main>
    </div>
  );
}
