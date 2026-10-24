'use client';
import { Button, Dialog } from '@jadarat/ui';

/*
 * Its own module so the forms that ask it (invite, role builder) don't pull the person panels and their forms
 * into their pages (per-page bundle budget, gate 9).
 */

/** Texts of the unsaved-changes question (namespace `users`). */
export interface DiscardTexts {
  readonly title: string;
  readonly body: string;
  readonly keepEditing: string;
  readonly discard: string;
}

/** «Discard your changes?» before a panel with unsaved changes closes (Clerk's unsaved bar). */
export function DiscardDialog({
  open,
  texts,
  onKeep,
  onDiscard,
}: {
  readonly open: boolean;
  readonly texts: DiscardTexts;
  readonly onKeep: () => void;
  readonly onDiscard: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onKeep}
      tone="warning"
      title={texts.title}
      description={texts.body}
      closeLabel={texts.keepEditing}
      size="sm"
      data-testid="discard-dialog"
      footer={
        <>
          <Button variant="secondary" onClick={onKeep}>
            {texts.keepEditing}
          </Button>
          <Button variant="danger" onClick={onDiscard} data-testid="discard-confirm">
            {texts.discard}
          </Button>
        </>
      }
    />
  );
}
