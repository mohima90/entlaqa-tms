import type { AppLocale } from '@jadarat/platform-i18n';
import { Icon, type IconName } from '@jadarat/ui';
import { usersListHref } from '../../lib/users-list-href';
import type { TeamCounts } from '../../lib/users-view';

/**
 * The team's four figures on the Organization Admin home as one brand-gradient band (redesign package 6,
 * PO 21 Oct 2026; Jadarat slate → steel, or the organization's colours, FR-ADM-07): total, active, pending
 * invites, deactivated — each a link to Team members on its tab (`?tab=`), told apart by icon and label.
 * Same reads, permissions and counts as the Team members page; shown only when that page may be listed.
 */
export function TeamStats({
  locale,
  label,
  counts,
  texts,
  format,
  className,
  'data-testid': testId,
}: {
  readonly locale: AppLocale;
  readonly label: string;
  readonly counts: TeamCounts;
  readonly texts: {
    readonly total: string;
    readonly active: string;
    readonly pending: string;
    readonly deactivated: string;
  };
  /** Numbers in the page's locale. */
  readonly format: (value: number) => string;
  readonly className?: string;
  readonly 'data-testid'?: string;
}) {
  const items: readonly {
    readonly key: string;
    readonly label: string;
    readonly value: number;
    readonly icon: IconName;
    readonly tab: string;
  }[] = [
    { key: 'total', label: texts.total, value: counts.all, icon: 'people', tab: 'all' },
    { key: 'active', label: texts.active, value: counts.active, icon: 'success', tab: 'active' },
    { key: 'pending', label: texts.pending, value: counts.invited, icon: 'mail', tab: 'invited' },
    {
      key: 'deactivated',
      label: texts.deactivated,
      value: counts.deactivated,
      icon: 'ban',
      tab: 'deactivated',
    },
  ];
  return (
    <nav
      aria-label={label}
      data-testid={testId}
      className={`relative overflow-hidden rounded-2xl bg-brand-gradient text-on-brand shadow-brand-glow ${className ?? ''}`}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -end-16 -top-24 size-64 rounded-full border-[34px] border-on-brand/10"
      />
      <ul className="relative m-0 grid list-none grid-cols-2 p-0 md:grid-cols-4">
        {items.map((item, index) => (
          <li
            key={item.key}
            className={`min-w-0 border-on-brand/20 ${index % 2 === 1 ? 'border-s' : ''} ${index >= 2 ? 'border-t' : ''} md:border-t-0 ${index > 0 ? 'md:border-s' : 'md:border-s-0'}`}
          >
            <a
              href={usersListHref(locale, {}, { tab: item.tab })}
              data-testid={`home-stat-${item.key}`}
              className="flex h-full flex-col gap-1.5 px-4.5 py-4 text-on-brand no-underline hover:bg-on-brand/10 focus-visible:outline-on-brand md:px-6 md:py-5.5"
            >
              <span className="text-sm font-medium">{item.label}</span>
              <span className="flex items-center gap-2.5 text-[28px] font-bold leading-[1.1] tabular-nums md:text-[34px]">
                {format(item.value)}
                <Icon name={item.icon} className="size-5 opacity-90" />
              </span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
