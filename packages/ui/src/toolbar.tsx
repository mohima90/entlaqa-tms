import type { HTMLAttributes } from 'react';
import { cn } from './cn';

/**
 * The row above a list (Kawadir): search and filters at the start, actions at the end; wraps on
 * narrow screens. Put a `<form method="get">` inside for server-side filtering.
 */
export function Toolbar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end', className)}
      {...props}
    />
  );
}

/**
 * Class names of a compact search or filter control in a toolbar (Kawadir Candidates: 36 px, rounded-xl,
 * soft shadow; 44 px on touch screens). On a `<select>` add `select-chevron pe-10` for Kawadir's chevron.
 */
export const toolbarFieldClasses =
  'min-h-9 w-full rounded-xl border border-border-strong bg-surface px-3.5 text-sm text-text shadow-1 placeholder:text-text-subtle pointer-coarse:min-h-11';
