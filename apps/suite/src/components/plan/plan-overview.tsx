import type { OrganizationPlan } from '@jadarat/platform-db';
import type { AppLocale } from '@jadarat/platform-i18n';
import { Alert, Badge, type BadgeTone, Icon, ProgressBar } from '@jadarat/ui';
import { getTranslations } from 'next-intl/server';
import { PLAN_FEATURE_CODES } from '../../lib/platform-plans-input';
import { gigabytes } from '../../lib/storage-size';
import { trialDaysLeft } from '../../lib/trial-days';

const STATUS_TONE: Record<OrganizationPlan['status'], BadgeTone> = {
  active: 'success',
  trial: 'warning',
  suspended: 'danger',
  cancelled: 'neutral',
};

/**
 * The organization's plan as its Organization Admin sees it (WP-ADM-06; FR-ADM-13; design approved by the PO
 * 24 Oct 2026): during a trial a banner with the days left and the end date; «Your plan» with its status,
 * people and storage used of their limits (a bar each, the numbers always in words too); and the product's
 * features, each included or «Not in your plan». Read-only: the plan is changed by ENTLAQA. `compact`: the
 * plan card only (the paused page).
 */
export async function PlanOverview({
  locale,
  plan,
  compact = false,
}: {
  readonly locale: AppLocale;
  readonly plan: OrganizationPlan;
  readonly compact?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'plans' });
  const numbers = new Intl.NumberFormat(`${locale}-u-nu-latn`);
  const date = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB', {
    dateStyle: 'medium',
    timeZone: 'Asia/Riyadh',
  });
  const days = plan.status === 'trial' ? trialDaysLeft(plan.trialEndsAt) : null;
  const usedGb = gigabytes(plan.storageUsedBytes, locale);

  const card = (
    <section
      aria-labelledby="plan-name"
      className="flex flex-col gap-5 rounded-xl border border-border bg-surface p-5 md:p-6"
      data-testid="plan-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm text-text-muted">{t('page.yourPlan')}</span>
          <h2 id="plan-name" className="m-0 text-2xl font-bold" data-testid="plan-name">
            {plan.hasPlan ? plan.planName : t('page.noPlanName')}
          </h2>
          {plan.planDescription ? (
            <span className="text-sm text-text-muted">{plan.planDescription}</span>
          ) : null}
        </div>
        <Badge tone={STATUS_TONE[plan.status]} dot data-testid="plan-status">
          {t(`statuses.${plan.status}`)}
        </Badge>
      </div>
      {compact ? null : (
        <div className="grid gap-5 md:grid-cols-2">
          <div className="flex flex-col gap-2" data-testid="plan-people">
            <span className="font-semibold">{t('page.people')}</span>
            <p className="m-0">
              <span className="text-2xl font-bold tabular-nums">
                {numbers.format(plan.peopleUsed)}
              </span>{' '}
              <span className="text-text-muted">
                {plan.maxPeople === null
                  ? t('page.noLimit')
                  : t('page.of', { limit: numbers.format(plan.maxPeople) })}
              </span>
            </p>
            {plan.maxPeople === null ? null : (
              <ProgressBar
                value={Math.min(plan.peopleUsed, plan.maxPeople)}
                max={plan.maxPeople}
                label={t('page.peopleUsed', {
                  used: numbers.format(plan.peopleUsed),
                  limit: numbers.format(plan.maxPeople),
                })}
              />
            )}
            <span className="text-sm text-text-muted">{t('page.peopleHint')}</span>
          </div>
          <div className="flex flex-col gap-2" data-testid="plan-storage">
            <span className="font-semibold">{t('page.storage')}</span>
            <p className="m-0">
              <span className="text-2xl font-bold tabular-nums">{usedGb}</span>{' '}
              <span className="text-text-muted">
                {plan.maxStorageGb === null
                  ? t('page.gbNoLimit')
                  : t('page.ofGb', { limit: numbers.format(plan.maxStorageGb) })}
              </span>
            </p>
            {plan.maxStorageGb === null ? null : (
              <ProgressBar
                value={Math.min(plan.storageUsedBytes, plan.maxStorageGb * 1024 ** 3)}
                max={plan.maxStorageGb * 1024 ** 3}
                label={t('page.storageUsed', {
                  used: usedGb,
                  limit: numbers.format(plan.maxStorageGb),
                })}
              />
            )}
          </div>
        </div>
      )}
    </section>
  );

  if (compact) return card;

  return (
    <div className="flex flex-col gap-5">
      {days !== null && plan.trialEndsAt ? (
        <Alert tone="warning" data-testid="plan-trial">
          <strong>{t('page.trialDays', { days })}</strong>{' '}
          {t('page.trialEnds', { date: date.format(plan.trialEndsAt) })}
        </Alert>
      ) : null}
      {card}
      <section
        aria-labelledby="plan-features"
        className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 md:p-6"
        data-testid="plan-features"
      >
        <h2 id="plan-features" className="m-0 text-xl font-bold">
          {t('page.featuresTitle')}
        </h2>
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {PLAN_FEATURE_CODES.map((code) => {
            const included = plan.features.includes(code);
            return (
              <li
                key={code}
                className="flex items-start gap-3 rounded-lg border border-border p-3.5"
                data-testid={`plan-feature-${code}`}
                data-included={included}
              >
                <span
                  aria-hidden="true"
                  className={
                    included
                      ? 'grid size-7 shrink-0 place-items-center rounded-full bg-success-subtle text-success'
                      : 'grid size-7 shrink-0 place-items-center rounded-full bg-surface-sunken text-text-muted'
                  }
                >
                  <Icon name={included ? 'check' : 'ban'} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-semibold">{t(`features.${code}.name`)}</span>
                  <span className="text-sm text-text-muted">
                    {t(`features.${code}.description`)}
                  </span>
                </span>
                <span className="text-sm text-text-muted">
                  {included ? (
                    <span className="sr-only">{t('page.included')}</span>
                  ) : (
                    t('page.notInPlan')
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="m-0 text-sm text-text-muted">{t('alwaysIncluded')}</p>
      </section>
    </div>
  );
}
