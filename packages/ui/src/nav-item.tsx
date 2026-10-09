import type { AnchorHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

/**
 * Side-navigation entries of the suite shell, coloured by the shell roles (`nav*`) so they stay
 * readable whatever colour a theme gives the navigation. With the shipped theme they look exactly like
 * the entries the app draws today (same surface/text colours).
 */
export function navItemClasses({ current }: { readonly current: boolean }): string {
  return cn(
    'block rounded-md px-3 py-2 no-underline',
    current
      ? 'bg-nav-item-current font-medium text-on-nav-item-current'
      : 'text-on-nav hover:bg-nav-item-hover',
  );
}

/** A section heading inside the navigation (e.g. «إدارة المنشأة» / "Organization admin"). */
export const navHeadingClasses = 'm-0 px-3 pb-2 text-sm font-semibold text-on-nav-muted';

/** An entry that is not available yet: the label and a note such as «قريبًا» / "Coming soon". */
export const navUnavailableClasses = 'flex justify-between gap-2 px-3 py-2 text-on-nav-muted';

export interface NavItemProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  readonly href: string;
  readonly current?: boolean | undefined;
}

/** A navigation link; the current page is marked with `aria-current="page"`. */
export function NavItem({ current = false, className, children, ...props }: NavItemProps) {
  return (
    <a
      aria-current={current ? 'page' : undefined}
      className={cn(navItemClasses({ current }), className)}
      {...props}
    >
      {children}
    </a>
  );
}

export interface NavUnavailableProps extends HTMLAttributes<HTMLSpanElement> {
  readonly label: ReactNode;
  /** «قريبًا» / "Coming soon". */
  readonly note: ReactNode;
}

/** A navigation entry shown but not usable yet (rendered as text, `aria-disabled`). */
export function NavUnavailable({ label, note, className, ...props }: NavUnavailableProps) {
  return (
    <span aria-disabled="true" className={cn(navUnavailableClasses, className)} {...props}>
      <span>{label}</span>
      <span className="text-sm">{note}</span>
    </span>
  );
}
