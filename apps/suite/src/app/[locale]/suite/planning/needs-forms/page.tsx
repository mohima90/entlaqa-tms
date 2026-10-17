import { toClientError } from '@jadarat/platform-core';
import { routing } from '@jadarat/platform-i18n/routing';
import { Alert } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { NeedsFormsLibrary } from '../../../../../components/needs-forms/needs-forms-library';
import { SuiteShell } from '../../../../../components/suite-shell';
import { needsFormsLibraryQuery } from '../../../../../lib/needs-forms-queries';
import { needsFormsTexts } from '../../../../../lib/needs-forms-texts';
import { profileErrorTexts } from '../../../../../lib/profile-texts';
import { getSuiteContext } from '../../../../../lib/suite-context';

/**
 * Planning → Needs forms (T-M3-10; FR-PLN-02/03; business flow EP-PLN §12): the organization's needs forms
 * library — the L&D Manager designs, the Training Coordinator views (tms.needs_form.read). Without a database
 * the page works on a preview copy in the browser tab.
 */
export default async function NeedsFormsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const context = await getSuiteContext(locale);
  const texts = needsFormsTexts(locale);
  const errors = await profileErrorTexts(locale);
  const builderHref = `/${locale}/suite/planning/needs-forms`;

  let content;
  if (!context.live) {
    content = (
      <NeedsFormsLibrary
        mode="preview"
        locale={locale}
        initialForms={[]}
        canManage
        texts={texts}
        errors={errors}
        builderHref={builderHref}
      />
    );
  } else {
    const result = await needsFormsLibraryQuery({});
    if (!result.ok) {
      const error = toClientError(result.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      const t = await getTranslations({ locale, namespace: 'needsForms' });
      const errorsT = await getTranslations({ locale, namespace: 'errors' });
      content =
        error.code === 'FORBIDDEN' ? (
          <Alert tone="warning" data-testid="needs-forms-forbidden">
            {errorsT('forbidden')}
          </Alert>
        ) : (
          <Alert tone="danger">
            {t('loadFailed', { correlationId: error.correlationId ?? '' })}
          </Alert>
        );
    } else {
      content = (
        <NeedsFormsLibrary
          mode="live"
          locale={locale}
          initialForms={result.value.forms}
          canManage={result.value.canManage}
          texts={texts}
          errors={errors}
          builderHref={builderHref}
        />
      );
    }
  }

  return (
    <SuiteShell
      locale={locale}
      context={context}
      current="needsForms"
      path="/suite/planning/needs-forms"
    >
      {content}
    </SuiteShell>
  );
}
