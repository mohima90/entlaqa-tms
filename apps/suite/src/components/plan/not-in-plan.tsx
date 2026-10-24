import type { AppLocale } from '@jadarat/platform-i18n';
import { Alert } from '@jadarat/ui';
import { getTranslations } from 'next-intl/server';

/**
 * A page of a feature the organization's plan does not include (WP-ADM-06, BR-PLAN-3): nothing is shown or
 * changed (the database refuses it too); what was saved before is kept for when the plan includes it again.
 */
export async function NotInPlan({ locale }: { readonly locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: 'plans' });
  return (
    <Alert tone="info" title={t('notInPlan.title')} data-testid="feature-not-in-plan">
      {t('notInPlan.body')}
    </Alert>
  );
}
