import { routing } from '@jadarat/platform-i18n/routing';
import { Card, buttonClasses } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { LanguageToggle } from '../../components/language-toggle';
import { getConfigStatus } from '../../lib/config-status';

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  // Dynamic rendering: every response carries a fresh CSP nonce.
  await connection();
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const t = await getTranslations({ locale, namespace: 'landing' });
  const common = await getTranslations({ locale, namespace: 'common' });
  const status = getConfigStatus();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-4 py-3">
        <span className="text-lg font-semibold">{common('productName')}</span>
        <LanguageToggle locale={locale} path="/" />
      </header>
      <main id="main" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
        <div>
          <h1 className="mb-2 mt-0 text-3xl font-bold">{t('title')}</h1>
          <p className="m-0 text-text-muted">{t('subtitle')}</p>
        </div>
        <div>
          <a href={`/${locale}/suite`} className={buttonClasses({ variant: 'primary' })}>
            {t('openSuite')}
          </a>
        </div>
        <Card title={t('statusTitle')}>
          <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="config-status">
            <li data-configured={status.auth}>
              {status.auth ? t('authConfigured') : t('authNotConfigured')}
            </li>
            <li data-configured={status.database}>
              {status.database ? t('databaseConfigured') : t('databaseNotConfigured')}
            </li>
          </ul>
        </Card>
      </main>
    </div>
  );
}
