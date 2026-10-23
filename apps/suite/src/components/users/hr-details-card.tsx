import type { HrDetails } from '@jadarat/platform-db';
import { type AppLocale, formatHijriDate } from '@jadarat/platform-i18n';
import { Badge, Icon } from '@jadarat/ui';
import { getFormatter, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { NotSet } from '../not-set';

/**
 * The HR-only card (WP-ADM-04, FR-IAM-02; design S04-1/S04-3): gender, date of birth (Gregorian, the Hijri date
 * next to it) and employment category, with a lock tag. It is rendered ONLY for a viewer entitled to it — the
 * person themself (read-only, «Ask HR to correct these») and members holding «View and edit HR-only fields»;
 * for anyone else the page does not render it and the server sends nothing (the view carries `null`).
 */
export async function HrDetailsCard({
  locale,
  details,
  own,
  headingLevel = 2,
  className,
}: {
  readonly locale: AppLocale;
  /** Null: HR has not filled them yet. */
  readonly details: HrDetails | null;
  /** The viewer is the person: read-only with a note. */
  readonly own: boolean;
  readonly headingLevel?: 2 | 3;
  readonly className?: string;
}) {
  const t = await getTranslations({ locale, namespace: 'peopleRecord' });
  const users = await getTranslations({ locale, namespace: 'users' });
  const format = await getFormatter({ locale });
  const none = <NotSet label={users('noneLabel')} />;
  const filled =
    details !== null &&
    (details.gender !== null || details.birthDate !== null || details.employmentCategory !== null);
  const rows: { key: string; label: string; value: ReactNode }[] = [
    {
      key: 'gender',
      label: t('hr.gender'),
      value: details?.gender ? t(`hr.${details.gender}`) : none,
    },
    {
      key: 'birthDate',
      label: t('hr.dob'),
      value: details?.birthDate ? (
        <>
          {format.dateTime(new Date(`${details.birthDate}T00:00:00Z`), {
            dateStyle: 'long',
            timeZone: 'UTC',
            numberingSystem: 'latn',
            calendar: 'gregory',
          })}{' '}
          <span className="text-text-muted">
            ({t('hr.dobHijri', { date: formatHijriDate(details.birthDate, locale) })})
          </span>
        </>
      ) : (
        none
      ),
    },
    {
      key: 'employmentCategory',
      label: t('hr.category'),
      value: details?.employmentCategory ? t(`hr.cat.${details.employmentCategory}`) : none,
    },
  ];
  return (
    <section
      aria-labelledby={`hr-details-title-${own ? 'own' : 'person'}`}
      className={
        className ??
        'grid grid-cols-1 gap-x-8 gap-y-6 rounded-xl border border-border bg-surface px-7 py-6.5 lg:grid-cols-[260px_minmax(0,1fr)]'
      }
      data-testid="hr-details"
    >
      <div>
        {headingLevel === 2 ? (
          <h2 id={`hr-details-title-${own ? 'own' : 'person'}`} className="m-0 text-lg font-bold">
            {t('hr.title')}
          </h2>
        ) : (
          <h3 id={`hr-details-title-${own ? 'own' : 'person'}`} className="m-0 text-lg font-bold">
            {t('hr.title')}
          </h3>
        )}
        <p className="m-0 mt-2">
          <Badge>
            <Icon name="lock" className="size-3.5" />
            {own ? t('hr.lockMe') : t('hr.lock')}
          </Badge>
        </p>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        {filled ? (
          <dl className="m-0 grid grid-cols-1 gap-x-7 gap-y-4.5 sm:grid-cols-2">
            {rows.map((row) => (
              <div key={row.key} className="flex min-w-0 flex-col gap-1">
                <dt className="text-[13.5px] text-text-muted">{row.label}</dt>
                <dd className="m-0 font-medium [overflow-wrap:anywhere]">{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="m-0 text-text-muted">{own ? t('hr.emptyMe') : t('hr.empty')}</p>
        )}
        {own ? <p className="m-0 text-[13.5px] text-text-muted">{t('hr.askHr')}</p> : null}
      </div>
    </section>
  );
}
