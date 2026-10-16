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
}

/**
 * The top of a page (Kawadir): title (24 px, bold, tight tracking), a muted description, and the
 * page's primary actions at the inline end.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        'mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between',
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow ? <div className="text-sm text-text-muted">{eyebrow}</div> : null}
        <h1 className="m-0 text-2xl font-bold tracking-tight">{title}</h1>
        {description ? <div className="m-0 max-w-3xl text-text-muted">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
