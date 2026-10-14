import type { AnchorHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

/**
 * Side-navigation entries of the suite shell (approved design, T-M2-21), coloured by the shell roles
 * (`nav*`) so they stay readable on the navigation gradient, the Jadarat one or an organization's
 * (FR-ADM-07): light text, a lighter hover fill, and a white pill for the current page. Entries are 36 px
 * high on a desktop and at least 44 px in the phone drawer and on touch screens (SC 2.5.8; NFR-UX-02).
 */
const entryBase =
  'flex min-h-11 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium no-underline lg:min-h-9 pointer-coarse:min-h-11';

export function navItemClasses({ current }: { readonly current: boolean }): string {
  return cn(
    entryBase,
    current
      ? 'bg-nav-item-current text-on-nav-item-current shadow-1'
      : 'text-on-nav hover:bg-nav-item-hover',
  );
}

/** A section heading inside the navigation (e.g. «الأشخاص» / "People"). */
export const navHeadingClasses =
  'm-0 px-2.5 pb-1.5 pt-4 text-xs font-medium tracking-[var(--letter-spacing-caps)] text-on-nav-muted';

/** An entry that is not available yet: the label and a note such as «قريبًا» / "Coming soon". */
export const navUnavailableClasses = cn(entryBase, 'cursor-default text-on-nav-muted');

export interface NavItemProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  readonly href: string;
  readonly current?: boolean | undefined;
  /** A decorative icon (`Icon`) before the label. */
  readonly icon?: ReactNode;
  /** A count after the label (e.g. pending items); include it in the label's meaning, not only here. */
  readonly count?: ReactNode;
}

/** A navigation link; the current page is marked with `aria-current="page"`. */
export function NavItem({
  current = false,
  icon,
  count,
  className,
  children,
  ...props
}: NavItemProps) {
  return (
    <a
      aria-current={current ? 'page' : undefined}
      className={cn(navItemClasses({ current }), className)}
      {...props}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count !== undefined && count !== null ? (
        <span className="text-xs tabular-nums">{count}</span>
      ) : null}
    </a>
  );
}

export interface NavUnavailableProps extends HTMLAttributes<HTMLSpanElement> {
  readonly label: ReactNode;
  /** «قريبًا» / "Coming soon". */
  readonly note: ReactNode;
  readonly icon?: ReactNode;
}

/** A navigation entry shown but not usable yet (rendered as text, `aria-disabled`). */
export function NavUnavailable({ label, note, icon, className, ...props }: NavUnavailableProps) {
  return (
    <span aria-disabled="true" className={cn(navUnavailableClasses, className)} {...props}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-xs font-normal">{note}</span>
    </span>
  );
}

export interface NavGroupProps {
  /** Unique id for the heading (labels the list). Omit for the first group without a heading. */
  readonly id?: string | undefined;
  readonly heading?: ReactNode;
  readonly children: ReactNode;
}

/** A group of navigation entries (`<li>` children), optionally under a heading that labels the list. */
export function NavGroup({ id, heading, children }: NavGroupProps) {
  return (
    <div>
      {heading && id ? (
        <h2 id={id} className={navHeadingClasses}>
          {heading}
        </h2>
      ) : null}
      <ul
        aria-labelledby={heading && id ? id : undefined}
        className="m-0 flex list-none flex-col gap-px p-0"
      >
        {children}
      </ul>
    </div>
  );
}
