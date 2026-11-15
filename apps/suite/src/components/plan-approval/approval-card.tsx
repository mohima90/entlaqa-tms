import type { AppLocale } from '@jadarat/platform-i18n';
import type { ApprovalItem } from '@jadarat/tms';
import { Badge, type BadgeTone, Icon, buttonClasses } from '@jadarat/ui';
import { getTranslations } from 'next-intl/server';
import { approvalReviewHref, personLabel } from '../../lib/plan-approval-view';
import { localName } from '../../lib/planning-view';
import { planAmount, planNumber } from '../../lib/training-plan-view';

/** The state of a plan for the approvers (design 5a): waiting for the viewer, for a step, or decided. */
export function approvalStatus(
  item: Pick<ApprovalItem, 'status' | 'approvalStep' | 'waitingForMe'>,
): {
  readonly key: 'waitingForYou' | 'hr' | 'finance' | 'approved' | 'sent_back' | 'draft';
  readonly tone: BadgeTone;
} {
  if (item.waitingForMe) return { key: 'waitingForYou', tone: 'warning' };
  if (item.status === 'in_approval') return { key: item.approvalStep ?? 'hr', tone: 'info' };
  if (item.status === 'approved') return { key: 'approved', tone: 'success' };
  if (item.status === 'sent_back') return { key: 'sent_back', tone: 'neutral' };
  return { key: 'draft', tone: 'neutral' };
}

/**
 * One training plan for its approvers (WP-LD-03; design 5a «Waiting for you»): its name, state and version, who
 * submitted it and when, its figures against the budget, the departments over their budget, and «Review the
 * plan». On Home and on the Approvals page.
 */
export async function ApprovalCard({
  locale,
  item,
  moment,
}: {
  locale: AppLocale;
  item: ApprovalItem;
  moment: (iso: string) => string;
}) {
  const t = await getTranslations({ locale, namespace: 'planApproval' });
  const status = approvalStatus(item);
  const name = localName(locale, item.cycleName);
  const summary = item.summary;
  const amount = (value: string) =>
    summary ? planAmount(locale, value, summary.currency, summary.fractionDigits) : value;
  return (
    <article
      className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 shadow-2 md:flex-row md:items-center md:p-6"
      aria-labelledby={`approval-${item.planId}`}
      data-testid="approval-card"
    >
      <span
        aria-hidden="true"
        className="hidden size-14 shrink-0 place-items-center rounded-[14px] bg-primary-subtle text-primary-text md:grid"
      >
        <Icon name="plan" className="size-6" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={`approval-${item.planId}`} className="m-0 text-xl font-bold">
            {name}
          </h3>
          <Badge tone={status.tone} dot data-testid="approval-status">
            {t(`status.${status.key}`)}
          </Badge>
          <Badge tone="neutral">{t('version', { version: item.planVersion })}</Badge>
        </div>
        {item.submittedAt ? (
          <p className="m-0 text-text-muted">
            {t('submittedBy', {
              name: personLabel(locale, item.submittedBy, t('history.someone')),
              date: moment(item.submittedAt),
            })}
            {item.status === 'in_approval'
              ? ` · ${item.approvalStep === 'finance' ? t('anyFinance') : t('anyHr')}`
              : ''}
          </p>
        ) : null}
        {summary ? (
          <dl className="m-0 flex flex-wrap gap-x-6 gap-y-1">
            <div className="flex gap-1.5">
              <dt className="text-text-muted">{t('tiles.lines')}</dt>
              <dd className="m-0 font-bold tabular-nums">{planNumber(locale, summary.lines)}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-text-muted">{t('tiles.people')}</dt>
              <dd className="m-0 font-bold tabular-nums">{planNumber(locale, summary.people)}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-text-muted">{t('tiles.sessions')}</dt>
              <dd className="m-0 font-bold tabular-nums">{planNumber(locale, summary.sessions)}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-text-muted">{t('tiles.cost')}</dt>
              <dd className="m-0 tabular-nums">
                <b>{amount(summary.cost)}</b>{' '}
                {summary.envelope === null
                  ? null
                  : t('tiles.ofBudget', { amount: amount(summary.envelope) })}
              </dd>
            </div>
          </dl>
        ) : null}
        {summary && summary.overBudget > 0 ? (
          <p className="m-0 flex items-center gap-1.5 font-semibold text-warning-strong">
            <Icon name="warning" className="size-4" />
            {t('overWithReasons', { count: summary.overBudget })}
          </p>
        ) : null}
      </div>
      <a
        href={approvalReviewHref(locale, item.cycleId)}
        className={buttonClasses({ variant: item.waitingForMe ? 'primary' : 'secondary' })}
        data-testid="approval-review"
      >
        {item.waitingForMe ? t('page.review') : t('page.open')}
        <span className="sr-only">: {name}</span>
      </a>
    </article>
  );
}
