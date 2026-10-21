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
  /**
   * First use (direction C): numbered steps that guide the first actions (e.g. name the levels, then add
   * the first unit), shown as cards under the text.
   */
  readonly steps?:
    readonly { readonly title: ReactNode; readonly description?: ReactNode }[] | undefined;
}

/**
 * Nothing to show yet (direction C): a 72 px icon tile in the brand tint, a bold title, one line of text,
 * the primary action — and, for a first use, numbered steps. Also the «no results» state of a filtered
 * list (with «Clear filters» as its action).
 */
export function EmptyState({
  icon = 'inbox',
  title,
  description,
  action,
  headingLevel = 2,
  steps,
  className,
  ...props
}: EmptyStateProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div
      className={cn('flex flex-col items-center gap-2.5 px-6 py-11 text-center', className)}
      {...props}
    >
      <span
        aria-hidden="true"
        className="grid size-18 place-items-center rounded-[22px] bg-primary-subtle text-primary-text"
      >
        <Icon name={icon} className="size-8" />
      </span>
      <Heading className="m-0 mt-1.5 text-xl font-bold">{title}</Heading>
      {description ? <p className="m-0 max-w-[460px] text-text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
      {steps && steps.length > 0 ? (
        <ol className="m-0 mt-3.5 grid w-full max-w-[760px] list-none grid-cols-1 gap-3.5 p-0 text-start md:grid-cols-2">
          {steps.map((step, index) => (
            <li
              key={index}
              className="flex flex-col gap-2 rounded-[20px] border border-border bg-surface-sunken p-4.5"
            >
              <span
                aria-hidden="true"
                className="grid size-8 place-items-center rounded-full bg-brand-gradient font-bold text-on-brand"
              >
                {index + 1}
              </span>
              <span className="font-bold">{step.title}</span>
              {step.description ? (
                <span className="text-sm text-text-muted">{step.description}</span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
