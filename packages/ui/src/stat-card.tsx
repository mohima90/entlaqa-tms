import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './icons';

export type StatTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

/**
 * The vivid gradients of Kawadir's KPI cards. `brand` is the brand gradient (an organization's colours
 * replace it, FR-ADM-07); the four hues are fixed (`stat-*` tokens, white text ≥ 4.5 : 1 on both ends).
 */
export type StatAccent = 'brand' | 'violet' | 'green' | 'orange' | 'blue';

export type StatVariant = 'plain' | 'gradient' | 'target';

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
const accentFill: Record<StatAccent, string> = {
  brand: 'bg-stat-gradient-brand text-on-nav-item-current',
  violet: 'bg-stat-gradient-violet text-on-stat',
  green: 'bg-stat-gradient-green text-on-stat',
  orange: 'bg-stat-gradient-orange text-on-stat',
  blue: 'bg-stat-gradient-blue text-on-stat',
};
const trendIcon = { up: 'trend-up', down: 'trend-down', flat: 'trend-flat' } as const;

export interface StatGridProps extends HTMLAttributes<HTMLDListElement> {
  /** Names the group of figures for assistive technology (e.g. "Summary"). */
  readonly label: string;
  /** Cards per row on a wide screen (Kawadir: 4 KPI cards, 3 target cards). */
  readonly columns?: 3 | 4 | undefined;
}

/** The row of summary cards at the top of an overview page (a description list: label → figure). */
export function StatGrid({ label, columns = 4, className, children, ...props }: StatGridProps) {
  return (
    <dl
      aria-label={label}
      className={cn(
        'm-0 grid grid-cols-1 gap-4 sm:grid-cols-2',
        columns === 3 ? 'xl:grid-cols-3' : 'xl:grid-cols-4',
        className,
      )}
      {...props}
    >
      {children}
    </dl>
  );
}

export interface StatTrend {
  readonly direction: 'up' | 'down' | 'flat';
  /** The whole comparison in words, e.g. "12% vs previous" (the arrow is decorative). */
  readonly label: ReactNode;
}

export interface StatCardProps extends HTMLAttributes<HTMLDivElement> {
  readonly label: ReactNode;
  /** The figure, already formatted for the locale. */
  readonly value: ReactNode;
  /**
   * `plain` (default): Kawadir's small white summary card (Candidates, Jobs). `gradient`: the vivid KPI
   * card (Analytics: white text, icon in a translucent tile, trend line, sparkline). `target`: the white
   * goal card (Analytics: «Monthly Hires 2 / 10», a progress bar and "20% complete").
   */
  readonly variant?: StatVariant | undefined;
  /** `plain`: the colour of the figure and its icon tile. */
  readonly tone?: StatTone | undefined;
  /** `gradient`: the card's gradient (default `brand`). */
  readonly accent?: StatAccent | undefined;
  readonly icon?: IconName | undefined;
  /** A short line under the figure. */
  readonly hint?: ReactNode;
  /** The comparison line ("↗ 12% vs previous"). */
  readonly trend?: StatTrend | undefined;
  /** `gradient`: a decorative mini line chart of recent values (the trend line says it in words). */
  readonly sparkline?: readonly number[] | undefined;
  /** `target`: the goal after the figure, e.g. "/ 10". */
  readonly target?: ReactNode;
  /** `target`: progress towards the goal, 0–100. */
  readonly progress?: number | undefined;
  /** `target`: the progress in words, e.g. "20% complete" (also the progress bar's text). */
  readonly progressLabel?: string | undefined;
}

/** A small decorative line chart (Kawadir KPI card): 80 × 32, in the text colour at 60 %. */
function Sparkline({ values }: { readonly values: readonly number[] }) {
  if (values.length < 2) return null;
  const width = 80;
  const height = 32;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={width}
      height={height}
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      className="shrink-0 opacity-60 rtl:-scale-x-100"
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

function TrendLine({ trend, className }: { trend: StatTrend; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm', className)}>
      <Icon name={trendIcon[trend.direction]} className="size-3.5" />
      <span>{trend.label}</span>
    </span>
  );
}

/**
 * A summary card (Kawadir), in three variants — see `variant`. Use inside `StatGrid`: each card is a
 * `<div>` holding only `<dt>` / `<dd>` (valid HTML, axe "dlitem"); icons, the sparkline and the progress
 * bar's track are decorative, the words carry the meaning.
 */
export function StatCard({
  label,
  value,
  variant = 'plain',
  tone = 'neutral',
  accent = 'brand',
  icon,
  hint,
  trend,
  sparkline,
  target,
  progress,
  progressLabel,
  className,
  ...props
}: StatCardProps) {
  if (variant === 'gradient') {
    return (
      <div
        className={cn(
          'relative flex flex-col overflow-hidden rounded-xl p-6',
          accentFill[accent],
          className,
        )}
        data-variant="gradient"
        {...props}
      >
        <dt className={cn('text-sm font-medium leading-snug', icon && 'pe-16')}>
          {label}
          {icon ? (
            <span
              aria-hidden="true"
              className="absolute end-6 top-6 grid size-12 place-items-center rounded-xl bg-current/20"
            >
              <Icon name={icon} className="size-6" />
            </span>
          ) : null}
        </dt>
        <dd className="m-0 mt-2 text-4xl font-bold leading-none tracking-tight tabular-nums">
          {value}
        </dd>
        {trend || sparkline ? (
          <dd className="m-0 mt-4 flex items-end justify-between gap-3">
            {trend ? <TrendLine trend={trend} /> : <span />}
            {sparkline ? <Sparkline values={sparkline} /> : null}
          </dd>
        ) : null}
        {hint ? <dd className="m-0 mt-3 text-sm">{hint}</dd> : null}
      </div>
    );
  }

  if (variant === 'target') {
    const percent = Math.max(0, Math.min(100, progress ?? 0));
    return (
      <div
        className={cn(
          'flex flex-col rounded-xl border border-border bg-surface p-6 shadow-1',
          className,
        )}
        data-variant="target"
        {...props}
      >
        <dt className="flex items-center gap-2 text-[15px] font-medium text-text">
          <Icon name={icon ?? 'flag'} className="size-[18px] text-text-muted" />
          <span className="min-w-0">{label}</span>
        </dt>
        <dd className="m-0 mt-3 flex items-baseline justify-between gap-3">
          <span className="text-3xl font-bold leading-none tabular-nums">{value}</span>
          {target ? <span className="text-sm text-text-muted tabular-nums">{target}</span> : null}
        </dd>
        <dd className="m-0 mt-3">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
            aria-valuetext={progressLabel}
            aria-label={typeof label === 'string' ? label : undefined}
            className="h-2 overflow-hidden rounded-full bg-primary-subtle"
          >
            <div
              className="h-full rounded-full bg-brand-gradient transition-[width] duration-500 motion-reduce:transition-none"
              style={{ width: `${String(percent)}%` }}
            />
          </div>
        </dd>
        {progressLabel ? (
          <dd className="m-0 mt-3 text-xs text-text-muted">{progressLabel}</dd>
        ) : null}
        {hint ? <dd className="m-0 mt-1 text-xs text-text-muted">{hint}</dd> : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-xl border border-border bg-surface p-6 shadow-1',
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
      {trend ? (
        <dd className="m-0 text-text-muted">
          <TrendLine trend={trend} className="text-xs" />
        </dd>
      ) : null}
      {hint ? <dd className="m-0 text-xs text-text-muted">{hint}</dd> : null}
    </div>
  );
}
