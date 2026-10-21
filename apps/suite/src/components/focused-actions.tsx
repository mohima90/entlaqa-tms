import type { ReactNode } from 'react';

/** The bar of a focused page's actions, at the bottom of the screen (sticky): the next step last. */
export function FocusedActions({
  note,
  start,
  children,
}: {
  /** What the next step waits for, at the start («Available once the file is uploaded and scanned»). */
  readonly note?: ReactNode;
  /** A secondary action at the start (e.g. «Upload a corrected file»). */
  readonly start?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <div
      className="sticky bottom-0 z-20 -mx-4 mt-auto flex flex-wrap items-center gap-3 border-t border-border bg-surface px-4 py-3 md:-mx-6 md:px-6"
      data-testid="focused-actions"
    >
      {start}
      {note ? <p className="m-0 text-sm text-text-muted">{note}</p> : null}
      <div className="ms-auto flex flex-wrap items-center gap-2.5">{children}</div>
    </div>
  );
}
