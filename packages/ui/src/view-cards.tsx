import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export interface ViewCard {
  readonly key: string;
  readonly href: string;
  /** The view's status, e.g. «نشط» / "Active". */
  readonly label: ReactNode;
  /** How many items the view holds, already formatted for the locale. */
  readonly count: ReactNode;
  /** Optional data-testid of the card's link. */
  readonly testId?: string | undefined;
}

export interface ViewCardsProps extends HTMLAttributes<HTMLElement> {
  /** Names the navigation landmark (e.g. "Team members views"). */
  readonly label: string;
  readonly items: readonly ViewCard[];
  /** The `key` of the view shown now (`aria-current="page"`). */
  readonly current: string;
}

/**
 * Saved-view cards with big numbers (direction C «Bold product», redesign package 1): the status views
 * of a list as cards — the status and its count in large type — that replace the summary cards and tabs
 * above a list. Each view is its own address (server-rendered, bookmarkable, works without JavaScript),
 * so the cards are a `<nav>` of links with `aria-current`; the current one carries the brand gradient
 * (the organization's colours replace it, FR-ADM-07). Four in a row on a desktop, two on a phone.
 */
export function ViewCards({ label, items, current, className, ...props }: ViewCardsProps) {
  return (
    <nav aria-label={label} className={className} {...props}>
      <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 md:gap-3.5 xl:grid-cols-4">
        {items.map((item) => {
          const isCurrent = item.key === current;
          return (
            <li key={item.key} className="min-w-0">
              <a
                href={item.href}
                aria-current={isCurrent ? 'page' : undefined}
                data-testid={item.testId}
                className={cn(
                  'flex h-full min-h-22 flex-col gap-1 rounded-lg border px-4.5 py-4 no-underline transition-[border-color,box-shadow,background-color] duration-[var(--duration-base)] motion-reduce:transition-none',
                  isCurrent
                    ? 'border-transparent bg-stat-gradient text-on-brand'
                    : 'border-border bg-surface text-text hover:border-border-strong',
                )}
              >
                <span
                  className={cn(
                    'text-sm font-medium [overflow-wrap:anywhere]',
                    isCurrent ? 'text-on-brand' : 'text-text-muted',
                  )}
                >
                  {item.label}
                </span>{' '}
                <span className="text-[28px] font-bold leading-[1.1] tabular-nums">
                  {item.count}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
