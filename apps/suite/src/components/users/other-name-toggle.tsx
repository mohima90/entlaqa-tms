'use client';
import { Button } from '@jadarat/ui';

/**
 * «Add the name in Arabic (optional)» (guided-test feedback #2, PO 17 Oct 2026): the names of the
 * organization's default language come first and are required; the other language's fields stay hidden
 * behind this button until asked for (or already filled, or refused by the server). Shared by the invite,
 * edit-details and My profile forms. The button gives way to the fields; focus moves to the first of them
 * (`focusId`) so keyboard and screen-reader users land where they asked to type.
 */
export function OtherNameToggle({
  label,
  focusId,
  disabled,
  onOpen,
}: {
  readonly label: string;
  /** The id of the first field that appears. */
  readonly focusId: string;
  readonly disabled?: boolean | undefined;
  readonly onOpen: () => void;
}) {
  return (
    <div className="sm:col-span-2">
      <Button
        variant="ghost"
        onClick={() => {
          onOpen();
          requestAnimationFrame(() => {
            document.getElementById(focusId)?.focus();
          });
        }}
        disabled={disabled}
        data-testid="add-other-name"
      >
        {label}
      </Button>
    </div>
  );
}
