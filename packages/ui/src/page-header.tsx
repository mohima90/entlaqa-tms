import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** The page's only `<h1>`. */
  readonly title: ReactNode;
  /** One line under the title (Kawadir: muted text). */
  readonly description?: ReactNode;
  /** Above the title: a breadcrumb or the section name. */
  readonly eyebrow?: ReactNode;
  /** The page's main actions at the inline end (stacks under the title on phones). */
  readonly actions?: ReactNode;
  /**
   * The dashboard title in the brand gradient, one size up (Kawadir «Analytics Dashboard»). Home and
   * overview pages only.
   */
  readonly gradient?: boolean | undefined;
}

/**
 * The top of a page (Kawadir): title (24 px, bold, tight tracking; 30 px in the brand gradient on a
 * dashboard), a muted 16 px description, and the page's primary actions at the inline end.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  gradient = false,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        'mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between',
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow ? <div className="text-sm text-text-muted">{eyebrow}</div> : null}
        <h1
          className={cn(
            'm-0',
            gradient
              ? 'text-brand-gradient w-fit text-3xl font-bold leading-tight tracking-tight'
              : 'text-2xl font-bold tracking-tight',
          )}
        >
          {title}
        </h1>
        {description ? (
          <div className="m-0 max-w-3xl text-base text-text-muted">{description}</div>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
