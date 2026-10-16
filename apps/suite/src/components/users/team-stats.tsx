import { StatCard, StatGrid } from '@jadarat/ui';
import type { TeamCounts } from '../../lib/users-view';

/**
 * The team's four figures as KPI cards in the Kawadir layout (T-M2-43): total, active, pending invites,
 * deactivated — all on the brand gradient (Jadarat slate → steel, or the organization's colours,
 * FR-ADM-07), told apart by their icon and label. On the Team members page and the Organization Admin home.
 */
export function TeamStats({
  label,
  counts,
  texts,
  format,
  className,
  'data-testid': testId,
}: {
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
  return (
    <StatGrid label={label} className={className} data-testid={testId}>
      <StatCard variant="gradient" label={texts.total} value={format(counts.all)} icon="people" />
      <StatCard
        variant="gradient"
        label={texts.active}
        value={format(counts.active)}
        icon="success"
      />
      <StatCard
        variant="gradient"
        label={texts.pending}
        value={format(counts.invited)}
        icon="mail"
      />
      <StatCard
        variant="gradient"
        label={texts.deactivated}
        value={format(counts.deactivated)}
        icon="user"
      />
    </StatGrid>
  );
}
