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
 * Side-navigation entries in direction C «Bold product» (redesign package 1), coloured by the shell
 * roles (`nav*`): white entries on the brand-gradient panel with a 20 px line icon, a translucent hover
 * fill, and the current page as a white pill with the brand colour as text (the brand gradient in dark
 * mode). Entries are at least 44 px high (SC 2.5.8; NFR-UX-02). When the navigation is collapsed (desktop,
 * 84 px rail) only the icons show, centred in 48 px squares; the label stays for screen readers and
 * appears as a tooltip on hover and keyboard focus.
 */
const entryBase =
  'group relative flex min-h-11 items-center gap-3 rounded-[12px] px-3 py-2 text-[15px] font-medium leading-snug no-underline transition-colors duration-[var(--duration-base)] motion-reduce:transition-none pointer-coarse:min-h-11 nav-collapsed:mx-auto nav-collapsed:w-12 nav-collapsed:justify-center nav-collapsed:px-0';
/** Labels wrap rather than truncate: a cut-off label would hide words (and «Coming soon» takes room). */
const labelClasses = 'min-w-0 flex-1 [overflow-wrap:anywhere] nav-collapsed:sr-only';
const iconBase = 'grid shrink-0 place-items-center [&>svg]:size-5';

export function navItemClasses({ current }: { readonly current: boolean }): string {
  return cn(
    entryBase,
    current
      ? 'bg-nav-current font-semibold text-on-nav-item-current shadow-[0_10px_24px_-12px_rgb(0_0_0/0.45)]'
      : 'text-on-nav hover:bg-nav-item-hover',
  );
}

/** A section heading inside the navigation (e.g. «الإعدادات» / "Settings"): 11.5 px bold caps. */
export const navHeadingClasses =
  'flex min-h-9 w-full items-center justify-between gap-2 rounded-[10px] px-3 py-1.5 text-start text-[11.5px] font-bold uppercase tracking-[0.08em] text-on-nav-muted transition-colors hover:bg-nav-item-hover [:lang(ar)_&]:text-[12.5px] [:lang(ar)_&]:tracking-normal';

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
      {icon ? (
        <span aria-hidden="true" className={iconBase}>
          {icon}
        </span>
      ) : null}
      <span className={labelClasses}>{children}</span>
      {count !== undefined && count !== null ? (
        <span className="text-xs tabular-nums nav-collapsed:sr-only">{count}</span>
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
        <span aria-hidden="true" className={iconBase}>
          {icon}
        </span>
      ) : null}
      {/* The note as a small pill at the end; it wraps under the label when the menu is narrow, so a
          word is never broken. */}
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 nav-collapsed:sr-only">
        <span className="[overflow-wrap:anywhere]">{label}</span>
        <span className="ms-auto whitespace-nowrap rounded-full border border-nav-border px-2 text-[11px] font-medium leading-5">
          {note}
        </span>
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
    <div className="mt-3 first:mt-0">
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
            className="mx-auto my-2.5 hidden h-px w-12 bg-nav-border nav-collapsed:block"
          />
        </>
      ) : null}
      <ul
        id={listId}
        aria-labelledby={labelled ? id : undefined}
        className={cn(
          'm-0 flex list-none flex-col gap-0.5 p-0 nav-collapsed:items-center',
          labelled && !open ? 'hidden nav-collapsed:flex' : undefined,
        )}
      >
        {children}
      </ul>
    </div>
  );
}
