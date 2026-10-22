import { Icon, type IconName } from '@jadarat/ui';
import type { ReactNode } from 'react';

/** One page of the home: where it leads and, in a small line, what it is for (or its menu group). */
export interface HomeTile {
  readonly key: string;
  readonly href: string;
  readonly title: string;
  readonly icon: IconName;
  readonly description?: string | undefined;
}

export interface HomeTileGroup {
  readonly key: string;
  /** Heading of the group (the menu's group name); none for an ungrouped list. */
  readonly heading?: string | undefined;
  readonly tiles: readonly HomeTile[];
}

/**
 * The home's page tiles (redesign package 6, PO 21 Oct 2026): a card with a title and what it is for,
 * then the pages as tiles — grouped like the menu — each an icon, the page's name, one small line and an
 * arrow. Built from the same source as the menu (`suiteNavigation`, deny by default), so nobody sees a link
 * they cannot open. No ticks and no progress: that would be a new feature (parked).
 */
export function HomeTiles({
  title,
  description,
  icon,
  groups,
  footer,
  className,
  'data-testid': testId,
  headingId,
}: {
  readonly title: string;
  readonly description: string;
  readonly icon: IconName;
  readonly groups: readonly HomeTileGroup[];
  readonly footer?: ReactNode;
  readonly className?: string | undefined;
  readonly 'data-testid'?: string | undefined;
  /** Unique id of the card's heading. */
  readonly headingId: string;
}) {
  return (
    <section
      aria-labelledby={headingId}
      data-testid={testId}
      className={`rounded-2xl border border-border bg-surface px-5 py-5.5 shadow-2 md:px-7 md:py-6.5 ${className ?? ''}`}
    >
      <header className="mb-5 flex items-start gap-4">
        <span
          aria-hidden="true"
          className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-primary-subtle text-primary-text"
        >
          <Icon name={icon} className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id={headingId} className="m-0 text-[22px] font-bold">
            {title}
          </h2>
          <p className="m-0 mt-1.5 max-w-3xl text-text-muted">{description}</p>
        </div>
      </header>
      <div className="flex flex-col gap-5.5">
        {groups.map((group) => {
          const groupId = `${headingId}-${group.key}`;
          return (
            <div key={group.key}>
              {group.heading ? (
                <h3
                  id={groupId}
                  className="m-0 mb-2.5 text-[12.5px] font-bold uppercase tracking-[var(--letter-spacing-caps)] text-text-muted"
                >
                  {group.heading}
                </h3>
              ) : null}
              <ul
                aria-labelledby={group.heading ? groupId : undefined}
                className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2 xl:grid-cols-3"
              >
                {group.tiles.map((tile) => (
                  <li key={tile.key} className="min-w-0">
                    <a
                      href={tile.href}
                      className="group flex min-h-19 items-center gap-3.5 rounded-xl border border-border bg-surface px-4 py-3.5 text-text no-underline transition-colors hover:border-primary hover:bg-primary-subtle"
                    >
                      <span
                        aria-hidden="true"
                        className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-primary-subtle text-primary-text group-hover:bg-brand-gradient group-hover:text-on-brand"
                      >
                        <Icon name={tile.icon} className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{tile.title}</span>
                        {tile.description ? (
                          <span className="mt-0.5 block text-[13.5px] text-text-muted">
                            {tile.description}
                          </span>
                        ) : null}
                      </span>
                      <Icon name="chevron-end" className="shrink-0 text-text-subtle" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {footer}
    </section>
  );
}
