import { toClientError } from '@jadarat/platform-core';
import { routing } from '@jadarat/platform-i18n/routing';
import { Alert, Badge, Icon, PageHeader } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { NeedsPage } from '../../../../../../../../components/needs/needs-page';
import { SuiteShell } from '../../../../../../../../components/suite-shell';
import { needsFormsTexts } from '../../../../../../../../lib/needs-forms-texts';
import {
  cycleDepartmentNeedsQuery,
  needsErrorTexts,
  needsTexts,
} from '../../../../../../../../lib/needs-queries';
import { NEEDS_TONE } from '../../../../../../../../lib/needs-view';
import { dayFormatter } from '../../../../../../../../lib/planning-format';
import { PLANNING_PATHS, localName } from '../../../../../../../../lib/planning-view';
import { showsUnitLevels, unitNameWithLevel } from '../../../../../../../../lib/structure-view';
import { getSuiteContext } from '../../../../../../../../lib/suite-context';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A department's needs as the L&D Manager or Training Coordinator sees them («View» on the cycle's
 * progress; WP-LD-01, design screen 5): read-only, with «Return for changes» and «Extend for this
 * department» for the manager.
 */
export default async function CycleDepartmentNeedsPage({
  params,
}: {
  params: Promise<{ locale: string; cycleId: string; departmentId: string }>;
}) {
  const { locale, cycleId, departmentId } = await params;
  if (
    !hasLocale(routing.locales, locale) ||
    !UUID_RE.test(cycleId) ||
    !UUID_RE.test(departmentId)
  ) {
    notFound();
  }
  const context = await getSuiteContext(locale);
  const t = await getTranslations({ locale, namespace: 'needsEntry' });
  const planning = await getTranslations({ locale, namespace: 'planning' });
  const path = `${PLANNING_PATHS.cycles}/${cycleId}/departments/${departmentId}`;

  let title = planning('list.title');
  let cycleCrumb: { readonly label: string; readonly href: string } | null = null;
  let description: ReactNode;
  let content: ReactNode;
  if (!context.live) {
    content = (
      <Alert tone="info" data-testid="planning-not-configured">
        {planning('list.notConfigured')}
      </Alert>
    );
  } else {
    const result = await cycleDepartmentNeedsQuery({ cycleId, departmentId });
    if (!result.ok) {
      const error = toClientError(result.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      if (error.code === 'NOT_FOUND') notFound();
      const errors = await getTranslations({ locale, namespace: 'errors' });
      content =
        error.code === 'FORBIDDEN' ? (
          <Alert tone="warning" data-testid="planning-forbidden">
            {errors('forbidden')}
          </Alert>
        ) : (
          <Alert tone="danger">
            {t('loadFailed', { correlationId: error.correlationId ?? '' })}
          </Alert>
        );
    } else {
      const view = result.value;
      const day = dayFormatter(locale, context.regional.dateDisplay);
      const departmentLabel = unitNameWithLevel(
        localName(locale, view.department.name),
        view.department.levelOrdinal,
        view.levels,
        locale,
        showsUnitLevels(view.levels, [view.department.levelOrdinal]),
      );
      title = departmentLabel;
      cycleCrumb = {
        label: localName(locale, view.cycle.name),
        href: `/${locale}${PLANNING_PATHS.cycles}/${view.cycle.id}`,
      };
      const statusLabel = planning(`cycle.formStatus.${view.status}`);
      description = (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[14.5px]">
          <Badge tone={NEEDS_TONE[view.status]} dot data-testid="needs-header-status">
            {statusLabel}
          </Badge>
          <span className="inline-flex items-center gap-1.5">
            <Icon name="calendar" className="size-4" />
            {t('page.deadline')}: <b className="text-text">{day(view.deadline)}</b>
          </span>
          <span>
            {view.department.head
              ? t('manager.headLine', { name: localName(locale, view.department.head) })
              : t('manager.noHead')}
          </span>
        </div>
      );
      content = (
        <NeedsPage
          locale={locale}
          view={view}
          departmentLabel={departmentLabel}
          statusLabel={statusLabel}
          display={context.regional.dateDisplay}
          timeZone={context.regional.timeZone}
          texts={needsTexts(locale)}
          formTexts={needsFormsTexts(locale)}
          errors={await needsErrorTexts(locale)}
        />
      );
    }
  }

  return (
    <SuiteShell locale={locale} context={context} current="planningCycles" path={path}>
      <PageHeader
        breadcrumbsLabel={planning('breadcrumb.label')}
        breadcrumbs={[
          { label: planning('breadcrumb.planning') },
          { label: planning('breadcrumb.cycles'), href: `/${locale}${PLANNING_PATHS.cycles}` },
          ...(cycleCrumb ? [cycleCrumb] : []),
          { label: title },
        ]}
        title={title}
        description={description}
      />
      {content}
    </SuiteShell>
  );
}
