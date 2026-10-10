import 'server-only';
import { otherLocale } from '@jadarat/platform-i18n';
import { routing } from '@jadarat/platform-i18n/routing';
import { Card } from '@jadarat/ui';
import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { mfaErrorTexts } from '../../lib/auth-texts';
import { getConfigStatus } from '../../lib/config-status';
import { type MfaLinkKind, mfaLinkPath } from '../../lib/mfa-link';
import { LanguageToggle } from '../language-toggle';
import { MfaLinkView } from './mfa-link-view';

/**
 * The pages of the authenticator set-up e-mail's links (FR-IAM-12, T-M2-10; review H1): `/[locale]/mfa/
 * confirm` and `/[locale]/mfa/remove`. Public (the link proves the mailbox; no session needed). The server
 * renders the shell and its texts only; the client view reads the token from the URL fragment. No
 * referrer (metadata + `Referrer-Policy: no-referrer`, next.config.ts), not indexed.
 */
export async function mfaLinkMetadata(
  params: Promise<{ locale: string }>,
  kind: MfaLinkKind,
): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: `mfaLink.${kind}` });
  return {
    title: t('pageTitle'),
    referrer: 'no-referrer',
    robots: { index: false, follow: false },
  };
}

export async function MfaLinkPage({
  params,
  kind,
}: {
  readonly params: Promise<{ locale: string }>;
  readonly kind: MfaLinkKind;
}) {
  await connection();
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const status = getConfigStatus();
  const t = await getTranslations({ locale, namespace: `mfaLink.${kind}` });
  const shared = await getTranslations({ locale, namespace: 'mfaLink' });
  const common = await getTranslations({ locale, namespace: 'common' });

  if (!(status.auth && status.database)) {
    const errorsT = await getTranslations({ locale, namespace: 'errors' });
    return (
      <div className="flex min-h-dvh flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-4 py-3">
          <span className="text-lg font-semibold">{common('productName')}</span>
          <LanguageToggle locale={locale} path={`/mfa/${kind}`} />
        </header>
        <main id="main" className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 py-10">
          <h1 className="m-0 text-2xl font-bold">{t('pageTitle')}</h1>
          <Card>
            <p className="m-0 text-text-muted" data-testid="mfa-link-not-configured">
              {errorsT('notConfigured')}
            </p>
          </Card>
        </main>
      </div>
    );
  }

  const target = otherLocale(locale);
  return (
    <MfaLinkView
      locale={locale}
      kind={kind}
      productName={common('productName')}
      toggle={{
        href: mfaLinkPath(target, kind),
        lang: target,
        label: common('switchLanguage'),
        ariaLabel: common('switchLanguageAria'),
      }}
      texts={{
        pageTitle: t('pageTitle'),
        opening: shared('opening'),
        intro: t('intro'),
        warning: kind === 'remove' ? t('warning') : null,
        submit: t('submit'),
        submitting: t('submitting'),
        doneTitle: t('doneTitle'),
        doneText: t('doneText'),
        expiredTitle: shared('expiredTitle'),
        expiredText: t('expiredText'),
        invalidTitle: shared('invalidTitle'),
        invalidText: t('invalidText'),
        continue: shared('continue'),
        newPassword: shared('newPassword'),
        signIn: shared('signIn'),
      }}
      errors={await mfaErrorTexts(locale)}
    />
  );
}
