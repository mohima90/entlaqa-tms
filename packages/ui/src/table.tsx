import type {
  HTMLAttributes,
  ReactNode,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from 'react';
import { cn } from './cn';

/**
 * Data tables in the Kawadir style (shadcn Table, placed inside a `Card flush`): 14 px text, muted
 * 40 px header row, hairline row dividers, a hover tint. The wrapper scrolls a table wider than its box
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
  return <thead className={cn('bg-surface-sunken', className)} {...props} />;
}

export function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'border-b border-border transition-colors last:border-b-0 hover:bg-surface-hover',
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
        'h-10 border-b border-border px-4 text-start align-middle font-medium text-text-muted',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-4 py-3 align-middle', className)} {...props} />;
}

/** Class names of the parts, for tables written by hand (server pages with their own markup). */
export const tableClasses = {
  wrapper: 'w-full overflow-x-auto',
  table: 'w-full border-collapse text-start text-sm',
  header: 'bg-surface-sunken',
  head: 'h-10 border-b border-border px-4 text-start align-middle font-medium text-text-muted',
  row: 'border-b border-border transition-colors last:border-b-0 hover:bg-surface-hover',
  cell: 'px-4 py-3 align-middle',
} as const;
