import { toClientError } from '@jadarat/platform-core';
import { routing } from '@jadarat/platform-i18n/routing';
import { Alert, Badge, Icon, PageHeader } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { NeedsPage } from '../../../../../../../components/needs/needs-page';
import { SuiteShell } from '../../../../../../../components/suite-shell';
import { needsFormsTexts } from '../../../../../../../lib/needs-forms-texts';
import {
  departmentNeedsQuery,
  needsErrorTexts,
  needsTexts,
} from '../../../../../../../lib/needs-queries';
import { NEEDS_PATHS, NEEDS_TONE } from '../../../../../../../lib/needs-view';
import { dayFormatter } from '../../../../../../../lib/planning-format';
import { localName } from '../../../../../../../lib/planning-view';
import { showsUnitLevels, unitNameWithLevel } from '../../../../../../../lib/structure-view';
import { getSuiteContext } from '../../../../../../../lib/suite-context';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The Department Head's needs page for one department in a cycle (WP-LD-01; design screens 2–4): the
 * deadline and the instructions, the figures, the needs, «Add a need», «Submit» and «Recall». Only the
 * department's effective head opens it (anything else is 404, as the query decides).
 */
export default async function DepartmentNeedsPage({
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
  const path = `${NEEDS_PATHS.mine}/${cycleId}/${departmentId}`;

  let title = t('title');
  let description: ReactNode;
  let content: ReactNode;
  if (!context.live) {
    content = (
      <Alert tone="info" data-testid="needs-not-configured">
        {t('notConfigured')}
      </Alert>
    );
  } else {
    const result = await departmentNeedsQuery({ cycleId, departmentId });
    if (!result.ok) {
      const error = toClientError(result.error);
      if (error.code === 'UNAUTHENTICATED') redirect(`/${locale}/sign-in`);
      if (error.code === 'NOT_FOUND') notFound();
      const errors = await getTranslations({ locale, namespace: 'errors' });
      content =
        error.code === 'FORBIDDEN' ? (
          <Alert tone="warning" data-testid="needs-forbidden">
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
      const statusLabel = planning(`cycle.formStatus.${view.status}`);
      description = (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[14.5px]">
          <span>{localName(locale, view.cycle.name)}</span>
          <Badge tone={NEEDS_TONE[view.status]} dot data-testid="needs-header-status">
            {statusLabel}
          </Badge>
          <span className="inline-flex items-center gap-1.5">
            <Icon name="calendar" className="size-4" />
            {t('page.deadline')}: <b className="text-text">{day(view.deadline)}</b>
          </span>
          {view.entryOpen ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-subtle px-2.5 py-0.5 text-[13.5px] font-semibold text-primary-text">
              <Icon name="clock" className="size-3.5" />
              {t('task.dueIn', { count: Math.max(view.daysLeft, 0) })}
            </span>
          ) : null}
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
    <SuiteShell locale={locale} context={context} current="myNeeds" path={path}>
      <PageHeader
        breadcrumbsLabel={planning('breadcrumb.label')}
        breadcrumbs={[
          { label: t('breadcrumb'), href: `/${locale}${NEEDS_PATHS.mine}` },
          { label: title },
        ]}
        title={title}
        description={description}
      />
      {content}
    </SuiteShell>
  );
}
