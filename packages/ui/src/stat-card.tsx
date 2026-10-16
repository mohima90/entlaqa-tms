import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './icons';

export type StatTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

/* Value colours of Kawadir's summary cards, from the roles that pass 4.5 : 1 on a card. */
const valueTone: Record<StatTone, string> = {
  neutral: 'text-text',
  primary: 'text-primary-text',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};
const iconTone: Record<StatTone, string> = {
  neutral: 'bg-surface-hover text-text-muted',
  primary: 'bg-primary-subtle text-primary-text',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  danger: 'bg-danger-subtle text-danger',
};

export interface StatGridProps extends HTMLAttributes<HTMLDListElement> {
  /** Names the group of figures for assistive technology (e.g. "Summary"). */
  readonly label: string;
}

/** The row of summary cards at the top of an overview page (a description list: label → figure). */
export function StatGrid({ label, className, children, ...props }: StatGridProps) {
  return (
    <dl
      aria-label={label}
      className={cn('m-0 grid grid-cols-2 gap-4 md:grid-cols-4', className)}
      {...props}
    >
      {children}
    </dl>
  );
}

export interface StatCardProps extends HTMLAttributes<HTMLDivElement> {
  readonly label: ReactNode;
  /** The figure, already formatted for the locale. */
  readonly value: ReactNode;
  readonly tone?: StatTone | undefined;
  readonly icon?: IconName | undefined;
  /** A short line under the figure. */
  readonly hint?: ReactNode;
}

/**
 * A small stat card (Kawadir Team members: "Total members", "Active", …): muted label, a large figure
 * in the tone's colour, an optional icon tile. Use inside `StatGrid`.
 */
export function StatCard({
  label,
  value,
  tone = 'neutral',
  icon,
  hint,
  className,
  ...props
}: StatCardProps) {
  // A `<div>` directly in the `<dl>` holds only `<dt>` / `<dd>` (valid HTML, axe "dlitem").
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-xl border border-border bg-surface p-5 shadow-1',
        className,
      )}
      {...props}
    >
      <dt className="flex items-start justify-between gap-3 text-sm font-medium text-text-muted">
        <span className="min-w-0">{label}</span>
        {icon ? (
          <span
            aria-hidden="true"
            className={cn(
              '-my-1 grid size-9 shrink-0 place-items-center rounded-xl',
              iconTone[tone],
            )}
          >
            <Icon name={icon} className="size-[18px]" />
          </span>
        ) : null}
      </dt>
      <dd className={cn('m-0 text-2xl font-bold tabular-nums', valueTone[tone])}>{value}</dd>
      {hint ? <dd className="m-0 text-xs text-text-muted">{hint}</dd> : null}
    </div>
  );
}
