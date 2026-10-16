import { StatCard, StatGrid } from '@jadarat/ui';
import type { TeamCounts } from '../../lib/users-view';

/**
 * The team's four figures as Kawadir's vivid KPI cards (T-M2-43): total (violet), active (green), pending
 * invites (orange), deactivated (blue). On the Team members page and the Organization Admin home.
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
      <StatCard
        variant="gradient"
        accent="violet"
        label={texts.total}
        value={format(counts.all)}
        icon="people"
      />
      <StatCard
        variant="gradient"
        accent="green"
        label={texts.active}
        value={format(counts.active)}
        icon="success"
      />
      <StatCard
        variant="gradient"
        accent="orange"
        label={texts.pending}
        value={format(counts.invited)}
        icon="mail"
      />
      <StatCard
        variant="gradient"
        accent="blue"
        label={texts.deactivated}
        value={format(counts.deactivated)}
        icon="user"
      />
    </StatGrid>
  );
}
