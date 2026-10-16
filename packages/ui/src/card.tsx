import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  readonly title?: ReactNode;
  /** Heading level for the title (keeps the document outline correct). */
  readonly headingLevel?: 2 | 3;
  /** One line under the title (Kawadir CardDescription). */
  readonly description?: ReactNode;
  /** Controls at the inline end of the title row (e.g. a section's save or "View all"). */
  readonly actions?: ReactNode;
  /**
   * No inner padding below the header: for a table that runs edge to edge (Kawadir "Table inside a
   * Card"). The header keeps its padding.
   */
  readonly flush?: boolean | undefined;
}

/**
 * A white card on the muted page (Kawadir): rounded-xl (16 px), hairline border, soft shadow, 24 px
 * padding; optional title, description and header actions. Settings pages use one card per section.
 */
export function Card({
  title,
  headingLevel = 2,
  description,
  actions,
  flush = false,
  className,
  children,
  ...props
}: CardProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const hasHeader = Boolean(title ?? description ?? actions);
  return (
    <section
      className={cn(
        'rounded-xl border border-border bg-surface text-text shadow-1',
        flush ? 'overflow-hidden' : 'p-6',
        className,
      )}
      {...props}
    >
      {hasHeader ? (
        <div
          className={cn(
            'flex flex-wrap items-start justify-between gap-3',
            flush ? 'border-b border-border px-6 py-4' : 'mb-4',
          )}
        >
          <div className="flex min-w-0 flex-col gap-1">
            {title ? (
              <Heading className="m-0 text-lg font-semibold leading-tight tracking-tight">
                {title}
              </Heading>
            ) : null}
            {description ? <p className="m-0 text-sm text-text-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
