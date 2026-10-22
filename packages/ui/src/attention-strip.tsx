import { type ReactNode, useId } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './icons';

export interface AttentionStripProps {
  /** «يحتاج إلى انتباهك» / "Needs your attention". */
  readonly title: string;
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly 'data-testid'?: string | undefined;
}

/**
 * One card above a list for what needs the reader now (direction C, redesign package 3 — Deputy's import
 * banner with its action): a small heading and one line per matter, each with its own action. It replaces a
 * stack of banners; shown only when it has lines.
 */
export function AttentionStrip({
  title,
  children,
  className,
  'data-testid': testId,
}: AttentionStripProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn('overflow-hidden rounded-xl border border-border bg-surface', className)}
      data-testid={testId}
    >
      <h2
        id={headingId}
        className="m-0 flex items-center gap-2 border-b border-border px-5 py-3 text-xs font-bold uppercase tracking-[0.06em] text-text-muted"
      >
        <Icon name="bell" className="size-4" />
        {title}
      </h2>
      <ul className="m-0 flex list-none flex-col p-0">{children}</ul>
    </section>
  );
}

export interface AttentionItemProps {
  readonly icon: IconName;
  /** The tile's colour: `info` (in progress), `warning` (waits for the reader). */
  readonly tone?: 'info' | 'warning' | undefined;
  readonly children: ReactNode;
  /** E.g. a progress bar between the text and the action. */
  readonly extra?: ReactNode;
  /** The line's button or link. */
  readonly action?: ReactNode;
  readonly 'data-testid'?: string | undefined;
}

export function AttentionItem({
  icon,
  tone = 'warning',
  children,
  extra,
  action,
  'data-testid': testId,
}: AttentionItemProps) {
  return (
    <li
      className="flex flex-wrap items-center gap-x-4 gap-y-2.5 border-b border-border px-5 py-3.5 last:border-b-0"
      data-testid={testId}
    >
      <span
        aria-hidden="true"
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-md',
          tone === 'info' ? 'bg-info-subtle text-info' : 'bg-warning-subtle text-warning-strong',
        )}
      >
        <Icon name={icon} className="size-4.5" />
      </span>
      <div className="min-w-0 flex-1 basis-64 text-[15px]">{children}</div>
      {extra}
      {action ? <div className="flex shrink-0 flex-col items-start gap-1.5">{action}</div> : null}
    </li>
  );
}
