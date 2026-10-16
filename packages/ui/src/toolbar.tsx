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

/** Class names of a compact search or filter control in a toolbar (36 px, 44 px on touch screens). */
export const toolbarFieldClasses =
  'min-h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-text shadow-1 pointer-coarse:min-h-11';
