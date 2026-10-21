import type { AppLocale } from '@jadarat/platform-i18n';
import { PageHeader } from '@jadarat/ui';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { PLANNING_PATHS } from '../../lib/planning-view';

/** Page header of the planning pages with the breadcrumb Planning / Planning cycles / <page>. */
export async function PlanningHeader({
  locale,
  title,
  description,
  actions,
  withCycles = true,
}: {
  locale: AppLocale;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** The breadcrumb links back to the cycles list (not on the list itself). */
  withCycles?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'planning' });
  return (
    <PageHeader
      breadcrumbsLabel={t('breadcrumb.label')}
      breadcrumbs={[
        { label: t('breadcrumb.planning') },
        ...(withCycles
          ? [{ label: t('breadcrumb.cycles'), href: `/${locale}${PLANNING_PATHS.cycles}` }]
          : []),
        { label: title },
      ]}
      title={title}
      description={description}
      actions={actions}
    />
  );
}
