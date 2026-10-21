import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './icons';

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  readonly title?: ReactNode;
  /** Heading level for the title (keeps the document outline correct). */
  readonly headingLevel?: 2 | 3;
  /** The title's id (for `aria-labelledby`). */
  readonly titleId?: string | undefined;
  /** A decorative icon before the title, in the brand text colour (Kawadir «Company Information»). */
  readonly icon?: IconName | undefined;
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
 * padding; optional header — a coloured icon, the bold title and a muted line under it (Kawadir
 * Branding: «Company Information» / "Basic information about your organization") — and header actions.
 * Settings pages use one card per section.
 */
export function Card({
  title,
  headingLevel = 2,
  titleId,
  icon,
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
        'rounded-xl border border-border bg-surface text-text shadow-2',
        flush ? 'overflow-hidden' : 'p-6',
        className,
      )}
      {...props}
    >
      {hasHeader ? (
        <div
          className={cn(
            'flex flex-wrap items-start justify-between gap-3',
            flush ? 'border-b border-border px-5.5 py-4' : 'mb-4',
          )}
        >
          <div className="flex min-w-0 flex-col gap-1">
            {title ? (
              <Heading
                id={titleId}
                className="m-0 flex items-center gap-2 text-lg font-bold leading-tight tracking-tight"
              >
                {icon ? <Icon name={icon} className="size-5 text-primary-text" /> : null}
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
