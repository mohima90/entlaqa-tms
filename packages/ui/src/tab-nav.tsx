import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './icons';

export interface TabNavItem {
  readonly key: string;
  readonly href: string;
  readonly label: ReactNode;
  readonly icon?: IconName | undefined;
  /** A count after the label (e.g. "Members (12)"); part of the link's text. */
  readonly count?: ReactNode;
}

export interface TabNavProps extends HTMLAttributes<HTMLElement> {
  /** Names the navigation landmark (e.g. "Team members views"). */
  readonly label: string;
  readonly items: readonly TabNavItem[];
  /** The `key` of the current view (`aria-current="page"`). */
  readonly current: string;
  /**
   * `underline` (direction C): views of one object — 48 px tabs over a hairline, the current one with a
   * 3 px bar in the brand colour. `pills`: a muted track with a white current tab; `segmented`: a
   * smaller filter row.
   */
  readonly variant?: 'underline' | 'pills' | 'segmented' | undefined;
}

/**
 * Views of a page as links: each view is its own address (server-rendered,
 * bookmarkable, works without JavaScript), so they are a `<nav>` of links with `aria-current`, not
 * ARIA tabs. Targets are 36 px on a desktop and 44 px on touch screens.
 */
export function TabNav({
  label,
  items,
  current,
  variant = 'pills',
  className,
  ...props
}: TabNavProps) {
  const small = variant === 'segmented';
  if (variant === 'underline') {
    return (
      <nav aria-label={label} className={cn('max-w-full overflow-x-auto', className)} {...props}>
        <ul className="m-0 flex list-none items-stretch gap-1.5 border-b border-border p-0">
          {items.map((item) => {
            const isCurrent = item.key === current;
            return (
              <li key={item.key}>
                <a
                  href={item.href}
                  aria-current={isCurrent ? 'page' : undefined}
                  className={cn(
                    '-mb-px inline-flex min-h-12 items-center gap-2 whitespace-nowrap border-b-[3px] px-3.5 font-semibold no-underline transition-colors',
                    isCurrent
                      ? 'border-brand-end text-text'
                      : 'border-transparent text-text-muted hover:text-text',
                  )}
                >
                  {item.icon ? <Icon name={item.icon} /> : null}
                  {item.label}
                  {item.count !== undefined && item.count !== null ? (
                    <span className="tabular-nums">({item.count})</span>
                  ) : null}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }
  return (
    <nav aria-label={label} className={cn('max-w-full overflow-x-auto', className)} {...props}>
      <ul
        className={cn(
          'm-0 inline-flex list-none items-center gap-1 rounded-full p-1',
          small ? 'border border-border bg-surface' : 'bg-surface-hover',
        )}
      >
        {items.map((item) => {
          const isCurrent = item.key === current;
          return (
            <li key={item.key}>
              <a
                href={item.href}
                aria-current={isCurrent ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3.5 font-medium no-underline transition-colors pointer-coarse:min-h-11',
                  small ? 'min-h-8 text-xs' : 'min-h-9 text-sm',
                  isCurrent
                    ? 'bg-surface text-text shadow-1'
                    : 'text-text-muted hover:bg-surface hover:text-text',
                  isCurrent && small && 'bg-surface-selected text-primary-text shadow-none',
                )}
              >
                {item.icon ? <Icon name={item.icon} /> : null}
                {item.label}
                {item.count !== undefined && item.count !== null ? (
                  <span className="tabular-nums">({item.count})</span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
