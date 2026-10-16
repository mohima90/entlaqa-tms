import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './icons';

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  readonly icon?: IconName | undefined;
  readonly title: ReactNode;
  /** One line of text. */
  readonly description?: ReactNode;
  /** The primary call to action (a `Button` or a link styled with `buttonClasses`). */
  readonly action?: ReactNode;
  /** Heading level of the title (keeps the outline correct where the empty state sits). */
  readonly headingLevel?: 2 | 3;
}

/** Nothing to show yet (Kawadir): a muted icon, a title, one line of text, the primary action. */
export function EmptyState({
  icon = 'inbox',
  title,
  description,
  action,
  headingLevel = 2,
  className,
  ...props
}: EmptyStateProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div
      className={cn('flex flex-col items-center gap-2 px-6 py-12 text-center', className)}
      {...props}
    >
      <span
        aria-hidden="true"
        className="mb-2 grid size-14 place-items-center rounded-xl bg-surface-hover text-text-muted"
      >
        <Icon name={icon} className="size-7" />
      </span>
      <Heading className="m-0 text-base font-semibold">{title}</Heading>
      {description ? <p className="m-0 max-w-md text-sm text-text-muted">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
