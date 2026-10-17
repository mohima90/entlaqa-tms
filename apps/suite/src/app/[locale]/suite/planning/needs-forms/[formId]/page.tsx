import { toClientError } from '@jadarat/platform-core';
import { routing } from '@jadarat/platform-i18n/routing';
import { Alert } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { NeedsFormBuilder } from '../../../../../../components/needs-forms/needs-form-builder';
import { SuiteShell } from '../../../../../../components/suite-shell';
import { needsFormQuery } from '../../../../../../lib/needs-forms-queries';
import { needsFormsTexts } from '../../../../../../lib/needs-forms-texts';
import { profileErrorTexts } from '../../../../../../lib/profile-texts';
import { getSuiteContext } from '../../../../../../lib/suite-context';

const FORM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The needs-form builder (T-M3-10; Kawadir's application-form builder): sections and fields of one form,
 * with a live preview. The L&D Manager edits (not a locked form); the Training Coordinator views.
 */
export default async function NeedsFormBuilderPage({
  params,
}: {
  params: Promise<{ locale: string; formId: string }>;
}) {
  const { locale, formId } = await params;
  if (!hasLocale(routing.locales, locale) || !FORM_ID.test(formId)) notFound();
  const context = await getSuiteContext(locale);
  const texts = needsFormsTexts(locale);
  const errors = await profileErrorTexts(locale);
  const libraryHref = `/${locale}/suite/planning/needs-forms`;

  let content;
  if (!context.live) {
    content = (
      <NeedsFormBuilder
        mode="preview"
        locale={locale}
        formId={formId}
        initialForm={null}
        canManage
        texts={texts}
        errors={errors}
        libraryHref={libraryHref}
      />
    );
  } else {
    const result = await needsFormQuery({ formId });
    if (!result.ok) {
      const error = toClientError(result.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      if (error.code === 'NOT_FOUND' || error.code === 'VALIDATION_FAILED') notFound();
      const t = await getTranslations({ locale, namespace: 'needsForms' });
      const errorsT = await getTranslations({ locale, namespace: 'errors' });
      content =
        error.code === 'FORBIDDEN' ? (
          <Alert tone="warning">{errorsT('forbidden')}</Alert>
        ) : (
          <Alert tone="danger">
            {t('loadFailed', { correlationId: error.correlationId ?? '' })}
          </Alert>
        );
    } else {
      content = (
        <NeedsFormBuilder
          mode="live"
          locale={locale}
          formId={formId}
          initialForm={result.value.form}
          canManage={result.value.canManage}
          texts={texts}
          errors={errors}
          libraryHref={libraryHref}
        />
      );
    }
  }

  return (
    <SuiteShell
      locale={locale}
      context={context}
      current="needsForms"
      path={`/suite/planning/needs-forms/${formId}`}
    >
      {content}
    </SuiteShell>
  );
}
