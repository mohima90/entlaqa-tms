import type { HTMLAttributes, InputHTMLAttributes, ReactNode, ThHTMLAttributes } from 'react';
import { buttonClasses } from './button';
import { cn } from './cn';
import { Icon } from './icons';

/*
 * List and table patterns of direction C «Bold product» (redesign package 1): the search pill, filter
 * pills, a sortable column header, pagination with the range, the loading skeleton and the phone card
 * list. Server-friendly (no client state): filters and pages are links or GET forms, so every view of a
 * list has its own address and works without JavaScript. Every list adopts them in its own package.
 */

export interface ListSearchProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'id' | 'type'
> {
  readonly id: string;
  /** The field's name for screen readers («بحث» / "Search"); the placeholder is not a label. */
  readonly label: string;
}

/** The search pill above a list: a magnifier, a 44 px round field with a visible boundary. */
export function ListSearch({ id, label, className, ...props }: ListSearchProps) {
  return (
    <div
      className={cn(
        'flex min-h-11 w-full items-center gap-2.5 rounded-full border-[1.5px] border-border-strong bg-surface px-4 text-text-subtle focus-within:border-primary md:w-95',
        className,
      )}
    >
      <Icon name="search" className="size-4" />
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        type="search"
        className="min-w-0 flex-1 border-0 bg-transparent text-[15px] text-text outline-none placeholder:text-text-subtle"
        {...props}
      />
    </div>
  );
}

export interface FilterPillProps {
  /** The filter's name, e.g. «الوحدة» / "Unit". */
  readonly label: ReactNode;
  /** The chosen value; without one the pill is an «add a filter» pill (dashed). */
  readonly value?: ReactNode;
  /** Where the pill leads: the filter's chooser (unset), or the list without this filter (set). */
  readonly href: string;
  /** Set: the accessible name of the remove link, e.g. "Remove the filter Role: Training Coordinator". */
  readonly removeLabel?: string | undefined;
}

/**
 * A filter as a pill: dashed with «+» until used; solid in the brand tint with «×» once set (a link that
 * removes it). The text says the filter and its value; the colour only supports it.
 */
export function FilterPill({ label, value, href, removeLabel }: FilterPillProps) {
  const set = value !== undefined && value !== null && value !== '';
  return (
    <a
      href={href}
      aria-label={set ? removeLabel : undefined}
      className={cn(
        'inline-flex min-h-10 items-center gap-1.5 rounded-full border-[1.5px] px-3.5 text-[14.5px] font-medium no-underline transition-colors pointer-coarse:min-h-11',
        set
          ? 'border-solid border-primary bg-primary-subtle text-primary-text'
          : 'border-dashed border-border-strong text-text-muted hover:bg-surface-hover hover:text-text',
      )}
    >
      {set ? null : <Icon name="plus" className="size-3.5" />}
      <span>
        {label}
        {set ? <>: {value}</> : null}
      </span>
      {set ? <Icon name="close" className="size-3.5" /> : null}
    </a>
  );
}

/** The row of search and filter pills above a list; wraps on narrow screens. */
export function FilterBar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-wrap items-center gap-2.5', className)} {...props} />;
}

export interface SortHeaderProps extends Omit<ThHTMLAttributes<HTMLTableCellElement>, 'children'> {
  readonly label: ReactNode;
  /** The column's current order, or none. */
  readonly sort?: 'ascending' | 'descending' | undefined;
  /** The address of the list sorted by this column (the other way round when already sorted). */
  readonly href: string;
}

/**
 * A sortable column header: the header cell carries `aria-sort`, its content is a link to the list
 * sorted by it, with an arrow for the current order.
 */
export function SortHeader({ label, sort, href, className, ...props }: SortHeaderProps) {
  return (
    <th scope="col" aria-sort={sort ?? 'none'} className={className} {...props}>
      <a
        href={href}
        className="inline-flex min-h-6 items-center gap-1 text-inherit no-underline hover:text-text"
      >
        {label}
        {sort ? (
          <Icon name={sort === 'ascending' ? 'arrow-up' : 'arrow-down'} className="size-3.5" />
        ) : (
          <Icon name="sort" className="size-3.5 opacity-60" />
        )}
      </a>
    </th>
  );
}

export interface PaginationProps extends HTMLAttributes<HTMLElement> {
  /** Names the navigation («ترقيم الصفحات» / "Pagination"). */
  readonly label: string;
  /** The range shown, e.g. "Showing 1–8 of 42" (already translated and formatted). */
  readonly range: ReactNode;
  readonly previous?: { readonly href: string | null; readonly label: string } | undefined;
  readonly next?: { readonly href: string | null; readonly label: string } | undefined;
}

/**
 * The bottom of a list: the range in words and Previous / Next as pill links (a missing page is shown
 * as an unavailable link, `aria-disabled`, never as nothing — people keep their bearings).
 */
export function Pagination({ label, range, previous, next, className, ...props }: PaginationProps) {
  const link = (
    item: NonNullable<PaginationProps['previous']>,
    icon: 'chevron-start' | 'chevron-end',
  ) => {
    const content =
      icon === 'chevron-start' ? (
        <>
          <Icon name={icon} />
          {item.label}
        </>
      ) : (
        <>
          {item.label}
          <Icon name={icon} />
        </>
      );
    return item.href ? (
      <a href={item.href} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
        {content}
      </a>
    ) : (
      <a aria-disabled="true" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
        {content}
      </a>
    );
  };
  return (
    <nav
      aria-label={label}
      className={cn(
        'flex flex-wrap items-center gap-3 border-t border-border px-5.5 py-3.5 text-sm text-text-muted',
        className,
      )}
      {...props}
    >
      <p className="m-0">{range}</p>
      <div className="ms-auto flex gap-2">
        {previous ? link(previous, 'chevron-start') : null}
        {next ? link(next, 'chevron-end') : null}
      </div>
    </nav>
  );
}

/**
 * Rows that are loading: shimmering placeholders (still without reduced motion) and one status line
 * for screen readers («جارٍ التحميل…» / "Loading…").
 */
export function TableSkeleton({
  rows = 5,
  label,
  className,
}: {
  readonly rows?: number | undefined;
  readonly label: string;
  readonly className?: string | undefined;
}) {
  return (
    <div role="status" className={className}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="flex items-center gap-3.5 border-b border-border px-5.5 py-4 last:border-b-0"
        >
          <span className="skeleton size-10 shrink-0 rounded-full" />
          <span className="flex flex-1 flex-col gap-2">
            <span className="skeleton h-3 w-2/5 rounded-full" />
            <span className="skeleton h-3 w-3/5 rounded-full" />
          </span>
          <span className="skeleton hidden h-3 w-24 rounded-full md:block" />
        </div>
      ))}
    </div>
  );
}

/**
 * The phone layout of a table (direction C): one card per row in a list, shown below the `md` width
 * while the table (wrap it in `hidden md:block`) shows above. Each card holds the row's main line, a
 * secondary line, its status and its row menu.
 */
export function ListCards({ className, ...props }: HTMLAttributes<HTMLUListElement>) {
  return <ul className={cn('m-0 flex list-none flex-col p-0 md:hidden', className)} {...props} />;
}

export function ListCard({
  leading,
  title,
  detail,
  status,
  action,
  className,
}: {
  readonly leading?: ReactNode;
  readonly title: ReactNode;
  readonly detail?: ReactNode;
  readonly status?: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <li
      className={cn(
        'flex items-center gap-3 border-b border-border px-4 py-3.5 last:border-b-0',
        className,
      )}
    >
      {leading}
      <div className="min-w-0 flex-1">
        <div className="font-semibold [overflow-wrap:anywhere]">{title}</div>
        {detail ? <div className="text-[13px] text-text-muted">{detail}</div> : null}
        {status ? <div className="mt-1.5">{status}</div> : null}
      </div>
      {action}
    </li>
  );
}
