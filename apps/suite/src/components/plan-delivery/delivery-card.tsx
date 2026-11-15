import type { AppLocale } from '@jadarat/platform-i18n';
import type { PlanDeliveryView } from '@jadarat/tms';
import { Icon, ProgressBar, buttonClasses, cn } from '@jadarat/ui';
import { getTranslations } from 'next-intl/server';

/**
 * «From the plan to sessions» (WP-LD-04, design screen 1): how far the approved plan's lines are with their course
 * and their draft sessions — «5 of 10 lines have their draft sessions» with a meter, the lines with a course, the
 * sessions drafted, the lines left out — and the way on: the «Courses and sessions» page (from the Plan tab) and the
 * Training calendar. A server component: no client code on the cycle page (bundle budget, CI gate 9).
 */
export async function DeliveryCard({
  locale,
  summary,
  sessionsHref,
  calendarHref,
}: {
  readonly locale: AppLocale;
  readonly summary: PlanDeliveryView['summary'];
  /** The «Courses and sessions» page (omitted on that page itself). */
  readonly sessionsHref?: string | undefined;
  readonly calendarHref: string;
}) {
  const t = await getTranslations({ locale, namespace: 'planDelivery' });
  const title = t('card.title', { done: summary.linesWithSessions, count: summary.linesInPlan });
  return (
    <section
      aria-labelledby="delivery-card-title"
      className="flex flex-col gap-5 rounded-xl border border-border bg-surface p-5.5 shadow-1 lg:flex-row lg:items-center"
      data-testid="delivery-card"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <p className="m-0 inline-flex items-center gap-2 text-sm font-medium text-text-muted">
          <Icon name="calendar" className="size-4" />
          {t('card.label')}
        </p>
        <h2 id="delivery-card-title" className="m-0 text-xl font-bold tracking-tight">
          {title}
        </h2>
        <ProgressBar
          value={summary.linesWithSessions}
          max={summary.linesInPlan}
          label={title}
          className="max-w-2xl"
        />
        <p className="m-0 flex flex-wrap gap-x-5 gap-y-1 text-sm text-text-muted">
          <span data-testid="delivery-card-courses">
            {t('card.courses', { done: summary.linesWithCourse, count: summary.linesInPlan })}
          </span>
          <span data-testid="delivery-card-sessions">
            {t('card.sessions', {
              drafted: summary.sessionsDrafted,
              planned: summary.sessionsPlanned,
            })}
          </span>
          {summary.leftOut > 0 ? (
            <span>{t('card.leftOut', { count: summary.leftOut })}</span>
          ) : null}
        </p>
      </div>
      <div className="flex flex-col gap-2.5 sm:flex-row lg:flex-col xl:flex-row">
        {sessionsHref ? (
          <a
            href={sessionsHref}
            className={buttonClasses({ variant: 'primary' })}
            data-testid="delivery-card-open"
          >
            {t('card.open')}
          </a>
        ) : null}
        <a
          href={calendarHref}
          className={cn(buttonClasses({ variant: 'secondary' }), 'gap-2')}
          data-testid="delivery-card-calendar"
        >
          <Icon name="calendar" className="size-4" />
          {t('card.calendar')}
          <Icon name="arrow-end" className="size-4" />
        </a>
      </div>
    </section>
  );
}
