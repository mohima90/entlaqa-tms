import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export interface Breadcrumb {
  readonly label: ReactNode;
  /** A link to the level; the last crumb (the current page) has none. */
  readonly href?: string | undefined;
}

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** The page's only `<h1>`. */
  readonly title: ReactNode;
  /** One or two lines under the title (muted, 16 px). */
  readonly description?: ReactNode;
  /** Above the title: the section name, when there are no breadcrumbs. */
  readonly eyebrow?: ReactNode;
  /** The path to this page (the last crumb is the page itself, `aria-current="page"`). */
  readonly breadcrumbs?: readonly Breadcrumb[] | undefined;
  /** Names the breadcrumb landmark («مسار التنقل» / "Breadcrumb"); required with `breadcrumbs`. */
  readonly breadcrumbsLabel?: string | undefined;
  /** The page's actions at the inline end: secondary first, the primary last (stacks on phones). */
  readonly actions?: ReactNode;
  /** The dashboard title in the brand gradient (Home and overview pages only). */
  readonly gradient?: boolean | undefined;
  /** Before the title and description, e.g. the person's large avatar on a profile (redesign package 3). */
  readonly leading?: ReactNode;
}

/**
 * The top of a page in direction C «Bold product»: breadcrumbs, a 38 px bold title (28 px on phones),
 * a muted description, and the page's actions at the inline end, aligned with the description. Lists
 * follow it with view cards (`ViewCards`); views of one object with underline tabs (`TabNav`,
 * `variant="underline"`).
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  breadcrumbs,
  breadcrumbsLabel,
  actions,
  gradient = false,
  leading,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        'mb-5.5 flex flex-col gap-4 md:flex-row md:flex-wrap md:items-end md:justify-between',
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-col">
        {/* A breadcrumb landmark only when it has a name (an unnamed second «navigation» confuses). */}
        {breadcrumbs && breadcrumbs.length > 0 && breadcrumbsLabel ? (
          <nav aria-label={breadcrumbsLabel} className="mb-2.5">
            <ol className="m-0 flex list-none flex-wrap items-center gap-2 p-0 text-sm text-text-muted">
              {breadcrumbs.map((crumb, index) => {
                const last = index === breadcrumbs.length - 1;
                return (
                  <li key={index} className="flex items-center gap-2">
                    {index > 0 ? (
                      <span aria-hidden="true" className="text-text-subtle">
                        /
                      </span>
                    ) : null}
                    {crumb.href && !last ? (
                      <a href={crumb.href} className="text-text-muted underline-offset-3">
                        {crumb.label}
                      </a>
                    ) : (
                      <span
                        aria-current={last ? 'page' : undefined}
                        className={last ? 'font-semibold text-text' : undefined}
                      >
                        {crumb.label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
        ) : eyebrow ? (
          <div className="mb-1.5 text-sm text-text-muted">{eyebrow}</div>
        ) : null}
        <div className={cn(leading ? 'flex min-w-0 items-center gap-4.5' : 'contents')}>
          {leading}
          <div className={cn(leading ? 'flex min-w-0 flex-col' : 'contents')}>
            <h1
              className={cn(
                'm-0 text-[28px] font-bold leading-[1.15] tracking-[-0.02em] md:text-5xl',
                gradient && 'text-brand-gradient w-fit',
              )}
            >
              {title}
            </h1>
            {description ? (
              <div className="m-0 mt-2 max-w-[680px] text-base text-text-muted">{description}</div>
            ) : null}
          </div>
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
    </div>
  );
}
