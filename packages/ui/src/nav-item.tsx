'use client';

import {
  type AnchorHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  useContext,
  useId,
  useState,
} from 'react';
import { cn } from './cn';
import { Icon } from './icons';
import { NavStateContext } from './nav-state';
import { Tooltip } from './tooltip';

/**
 * Side-navigation entries in the Kawadir layout (T-M2-43), coloured by the shell roles (`nav*`): muted
 * entries on the white panel with an icon tile, a light hover fill with a brand bar at the inline start,
 * and the current page filled with the brand gradient (white text). Entries are 52 px high (Kawadir), at
 * least 44 px everywhere (SC 2.5.8; NFR-UX-02). When the navigation is collapsed (desktop, 72 px) only
 * the icons show; the label stays for screen readers and appears as a tooltip on hover and keyboard
 * focus.
 */
const entryBase =
  'group relative flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium leading-snug no-underline transition-colors pointer-coarse:min-h-11 nav-collapsed:justify-center nav-collapsed:px-0';
/** Labels wrap rather than truncate: a cut-off label would hide words (and «Coming soon» takes room). */
const labelClasses = 'min-w-0 flex-1 [overflow-wrap:anywhere] nav-collapsed:sr-only';
const tileBase =
  'grid size-8 shrink-0 place-items-center rounded-lg transition-colors [&>svg]:size-[18px]';

export function navItemClasses({ current }: { readonly current: boolean }): string {
  return cn(
    entryBase,
    current
      ? 'bg-brand-gradient text-on-nav-item-current shadow-[0_4px_12px_-2px_var(--color-nav-item-current)]'
      : 'text-on-nav hover:bg-nav-item-hover',
  );
}

/** A section heading inside the navigation (e.g. «الإعدادات» / "Settings"); Kawadir: 11 px caps. */
export const navHeadingClasses =
  'flex min-h-9 w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-start text-[11px] font-semibold uppercase tracking-[var(--letter-spacing-caps)] text-on-nav-muted transition-colors hover:bg-nav-item-hover';

/** An entry that is not available yet: the label and a note such as «قريبًا» / "Coming soon". */
export const navUnavailableClasses = cn(entryBase, 'cursor-default text-on-nav-muted');

export interface NavItemProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  readonly href: string;
  readonly current?: boolean | undefined;
  /** A decorative icon (`Icon`) in the entry's tile. */
  readonly icon?: ReactNode;
  /** A count after the label (e.g. pending items); include it in the label's meaning, not only here. */
  readonly count?: ReactNode;
  /** The label as plain text, for the tooltip of the collapsed navigation. */
  readonly tooltip?: string | undefined;
}

/** A navigation link; the current page is marked with `aria-current="page"`. */
export function NavItem({
  current = false,
  icon,
  count,
  tooltip,
  className,
  children,
  ...props
}: NavItemProps) {
  const { collapsed } = useContext(NavStateContext);
  const link = (
    <a
      aria-current={current ? 'page' : undefined}
      className={cn(navItemClasses({ current }), className)}
      {...props}
    >
      {current ? null : (
        <span
          aria-hidden="true"
          className="absolute inset-y-2 start-0 w-0.5 rounded-full bg-nav-item-current opacity-0 transition-opacity group-hover:opacity-100"
        />
      )}
      {icon ? (
        <span
          aria-hidden="true"
          className={cn(
            tileBase,
            current
              ? 'bg-on-nav-item-current/20'
              : 'bg-nav-item-hover/60 text-on-nav group-hover:bg-nav-item-hover [&>svg]:transition-transform group-hover:[&>svg]:scale-110',
          )}
        >
          {icon}
        </span>
      ) : null}
      <span className={labelClasses}>{children}</span>
      {count !== undefined && count !== null ? (
        <span className="text-xs tabular-nums nav-collapsed:sr-only">{count}</span>
      ) : null}
      {current ? (
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full bg-on-nav-item-current/80 nav-collapsed:hidden"
        />
      ) : null}
    </a>
  );
  return (
    <Tooltip content={tooltip} side="end" enabled={collapsed && Boolean(tooltip)}>
      {link}
    </Tooltip>
  );
}

export interface NavUnavailableProps extends HTMLAttributes<HTMLSpanElement> {
  readonly label: ReactNode;
  /** «قريبًا» / "Coming soon". */
  readonly note: ReactNode;
  readonly icon?: ReactNode;
  /** "Branding · Coming soon" as plain text, for the tooltip of the collapsed navigation. */
  readonly tooltip?: string | undefined;
}

/** A navigation entry shown but not usable yet (text with a «Coming soon» badge, `aria-disabled`). */
export function NavUnavailable({
  label,
  note,
  icon,
  tooltip,
  className,
  ...props
}: NavUnavailableProps) {
  const { collapsed } = useContext(NavStateContext);
  const entry = (
    <span aria-disabled="true" className={cn(navUnavailableClasses, className)} {...props}>
      {icon ? (
        <span aria-hidden="true" className={cn(tileBase, 'bg-nav-item-hover/60')}>
          {icon}
        </span>
      ) : null}
      {/* The note under the label (not beside it): a narrow menu never breaks a word. */}
      <span className="flex min-w-0 flex-1 flex-col nav-collapsed:sr-only">
        <span className="[overflow-wrap:anywhere]">{label}</span>
        <span className="text-[11px] font-normal leading-tight">{note}</span>
      </span>
    </span>
  );
  return (
    <Tooltip content={tooltip} side="end" enabled={collapsed && Boolean(tooltip)}>
      {entry}
    </Tooltip>
  );
}

export interface NavGroupProps {
  /** Unique id for the heading (labels the list). Omit for the first group without a heading. */
  readonly id?: string | undefined;
  readonly heading?: ReactNode;
  readonly children: ReactNode;
}

/**
 * A group of navigation entries (`<li>` children) under a heading that labels the list. The heading is
 * a disclosure button (Kawadir: collapsible sections, `aria-expanded`); collapsed to icons, the
 * navigation shows every entry with a divider instead of the heading (the heading text stays for
 * screen readers; the button is removed, so nothing invisible takes focus).
 */
export function NavGroup({ id, heading, children }: NavGroupProps) {
  const [open, setOpen] = useState(true);
  const listId = useId();
  const labelled = Boolean(heading && id);
  return (
    <div className="mt-4 first:mt-0">
      {labelled ? (
        <>
          <h2 id={id} className="m-0">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={listId}
              onClick={() => {
                setOpen((o) => !o);
              }}
              className={cn(navHeadingClasses, 'nav-collapsed:hidden')}
            >
              <span className="min-w-0">{heading}</span>
              <Icon
                name="chevron-down"
                className={cn(
                  'size-3.5 transition-transform',
                  open ? '' : '-rotate-90 rtl:rotate-90',
                )}
              />
            </button>
            <span className="hidden nav-collapsed:block nav-collapsed:sr-only">{heading}</span>
          </h2>
          <div
            aria-hidden="true"
            className="mx-2 my-3 hidden h-px bg-nav-border nav-collapsed:block"
          />
        </>
      ) : null}
      <ul
        id={listId}
        aria-labelledby={labelled ? id : undefined}
        className={cn(
          'm-0 flex list-none flex-col gap-0.5 p-0',
          labelled && !open ? 'hidden nav-collapsed:flex' : undefined,
        )}
      >
        {children}
      </ul>
    </div>
  );
}
