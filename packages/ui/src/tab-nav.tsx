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
  /** `pills`: Kawadir TabsList (muted track, white current tab); `segmented`: a smaller filter row. */
  readonly variant?: 'pills' | 'segmented' | undefined;
}

/**
 * Views of a page as links (Kawadir TabsList look): each view is its own address (server-rendered,
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
  return (
    <nav aria-label={label} className={cn('max-w-full overflow-x-auto', className)} {...props}>
      <ul
        className={cn(
          'm-0 inline-flex list-none items-center gap-1 rounded-lg p-1',
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
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-md px-3 font-medium no-underline transition-colors pointer-coarse:min-h-11',
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
