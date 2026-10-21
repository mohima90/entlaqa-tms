import type {
  HTMLAttributes,
  ReactNode,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from 'react';
import { cn } from './cn';

/**
 * Data tables in direction C (inside a `Card flush`): a 48 px header row with small semibold caps
 * (Arabic: no caps, `--letter-spacing-caps` is 0), 64 px rows with hairline dividers, a soft hover tint.
 * On phones a list shows `ListCards` instead (list-patterns.tsx). The wrapper scrolls a table wider than its box
 * (cells never break inside a word, `styles.css`); give every table a caption (visible or `sr-only`).
 */
export interface DataTableProps extends TableHTMLAttributes<HTMLTableElement> {
  /** Names the table (`<caption>`); `captionHidden` keeps it for screen readers only. */
  readonly caption: ReactNode;
  readonly captionHidden?: boolean | undefined;
}

export function DataTable({
  caption,
  captionHidden = true,
  className,
  children,
  ...props
}: DataTableProps) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-start text-sm', className)} {...props}>
        <caption
          className={
            captionHidden ? 'sr-only' : 'px-6 pb-2 pt-4 text-start text-sm text-text-muted'
          }
        >
          {caption}
        </caption>
        {children}
      </table>
    </div>
  );
}

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('bg-surface', className)} {...props} />;
}

export function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'border-b border-border transition-colors last:border-b-0 hover:bg-surface-sunken',
        className,
      )}
      {...props}
    />
  );
}

/** A column header (`scope="col"`). */
export function TableHead({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        'h-12 whitespace-nowrap border-b border-border px-3 text-start align-middle text-[12.5px] font-semibold uppercase tracking-[var(--letter-spacing-caps)] text-text-muted first:ps-5 last:pe-3',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn('h-16 px-3 py-2 align-middle text-[14.5px] first:ps-5 last:pe-3', className)}
      {...props}
    />
  );
}

/** Class names of the parts, for tables written by hand (server pages with their own markup). */
export const tableClasses = {
  wrapper: 'w-full overflow-x-auto',
  table: 'w-full border-collapse text-start text-sm',
  header: 'bg-surface',
  head: 'h-12 whitespace-nowrap border-b border-border px-3 text-start align-middle text-[12.5px] font-semibold uppercase tracking-[var(--letter-spacing-caps)] text-text-muted first:ps-5 last:pe-3',
  row: 'border-b border-border transition-colors last:border-b-0 hover:bg-surface-sunken',
  cell: 'h-16 px-3 py-2 align-middle text-[14.5px] first:ps-5 last:pe-3',
} as const;
