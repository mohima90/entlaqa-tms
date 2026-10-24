import { routing } from '@jadarat/platform-i18n/routing';
import { loadPlatformPlansForRequest } from '@jadarat/platform-identity/auth';
import { EmptyState, ListCard, ListCards, PageHeader, tableClasses } from '@jadarat/ui';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { PlanEditor } from '../../../../components/platform/plan-editor';
import { PlatformShell } from '../../../../components/platform/platform-shell';
import { authErrorTexts } from '../../../../lib/auth-texts';
import { getConfigStatus } from '../../../../lib/config-status';
import { flattenTexts } from '../../../../lib/flatten-texts';
import { PLAN_FEATURE_CODES } from '../../../../lib/platform-plans-input';

/**
 * Platform → Plans «الخطط» (WP-ADM-06; FR-ADM-13, FR-SUB-01; design approved by the PO 24 Oct 2026): the
 * plans the Super Admin created — name and description, the people and storage limits, how many of the
 * product's features each includes and how many organizations are on it — with «خطة جديدة» / New plan and
 * «تعديل» / Edit in a side panel. A table on a desktop, cards on a phone. Deny by default, on the server,
 * before anything renders: only a Super Admin (the database decides); everyone else gets 404.
 */
export default async function PlatformPlansPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  await connection();
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  if (!getConfigStatus().auth || !getConfigStatus().database) notFound();
  const plans = await loadPlatformPlansForRequest();
  if (!plans.ok) notFound();

  const t = await getTranslations({ locale, namespace: 'platform' });
  const common = await getTranslations({ locale, namespace: 'common' });
  const all = await getTranslations({ locale });
  const shared = {
    texts: flattenTexts(all.raw('platform')),
    planTexts: flattenTexts(all.raw('plans')),
    errors: await authErrorTexts(locale),
    closeLabel: common('close'),
  };
  const numbers = new Intl.NumberFormat(`${locale}-u-nu-latn`);
  const rows = plans.value;
  const people = (n: number | null) =>
    n === null ? t('plans.noLimit') : t('plans.peopleCount', { count: numbers.format(n) });
  const storage = (n: number | null) =>
    n === null ? t('plans.noLimit') : t('plans.storageGb', { count: numbers.format(n) });
  const features = (n: number) =>
    t('plans.featuresCount', {
      count: numbers.format(n),
      total: numbers.format(PLAN_FEATURE_CODES.length),
    });
  const editor = (plan: (typeof rows)[number]) => <PlanEditor {...shared} plan={plan} />;

  return (
    <PlatformShell locale={locale} path="/platform/plans">
      <PageHeader
        title={t('plans.title')}
        description={t('plans.subtitle')}
        actions={<PlanEditor {...shared} plan={null} />}
      />
      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface" data-testid="plans-empty">
          <EmptyState icon="billing" title={t('plans.empty')} description={t('plans.emptyText')} />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="hidden md:block">
            <div className={tableClasses.wrapper}>
              <table className={tableClasses.table} data-testid="plans-table">
                <caption className="sr-only">{t('plans.caption')}</caption>
                <thead className={tableClasses.header}>
                  <tr>
                    <th scope="col" className={tableClasses.head}>
                      {t('plans.plan')}
                    </th>
                    <th scope="col" className={tableClasses.head}>
                      {t('plans.people')}
                    </th>
                    <th scope="col" className={tableClasses.head}>
                      {t('plans.storage')}
                    </th>
                    <th scope="col" className={tableClasses.head}>
                      {t('plans.featuresColumn')}
                    </th>
                    <th scope="col" className={tableClasses.head}>
                      {t('plans.organizations')}
                    </th>
                    <th scope="col" className={tableClasses.head}>
                      <span className="sr-only">{t('table.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((plan) => (
                    <tr key={plan.planId} className={tableClasses.row} data-testid="plan-row">
                      <th scope="row" className={`${tableClasses.cell} text-start font-normal`}>
                        <span className="block font-semibold">{plan.name}</span>
                        {plan.description ? (
                          <span className="block text-sm text-text-muted">{plan.description}</span>
                        ) : null}
                      </th>
                      <td className={tableClasses.cell}>{people(plan.maxPeople)}</td>
                      <td className={tableClasses.cell}>{storage(plan.maxStorageGb)}</td>
                      <td className={`${tableClasses.cell} tabular-nums`}>
                        {features(plan.features.length)}
                      </td>
                      <td className={`${tableClasses.cell} tabular-nums`}>
                        {numbers.format(plan.tenantCount)}
                      </td>
                      <td className={`${tableClasses.cell} text-end`}>{editor(plan)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <ListCards aria-label={t('plans.caption')} data-testid="plans-cards">
            {rows.map((plan) => (
              <ListCard
                key={plan.planId}
                data-testid="plan-card"
                title={plan.name}
                detail={`${people(plan.maxPeople)} · ${storage(plan.maxStorageGb)} · ${features(plan.features.length)} · ${t('plans.organizations')}: ${numbers.format(plan.tenantCount)}`}
                status={editor(plan)}
              />
            ))}
          </ListCards>
        </div>
      )}
    </PlatformShell>
  );
}
