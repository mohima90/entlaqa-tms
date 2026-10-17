'use client';
import { Alert, Button, Dialog } from '@jadarat/ui';
import { type ReactNode, useState, useTransition } from 'react';

export interface ConfirmDialogProps {
  readonly title: string;
  readonly description: string;
  /** More to say before confirming (e.g. what keeps a unit from being deleted). */
  readonly children?: ReactNode;
  readonly confirmLabel: string;
  readonly workingLabel: string;
  readonly keepLabel: string;
  readonly closeLabel: string;
  readonly danger?: boolean;
  /** False: only «keep» is offered (e.g. a unit still in use cannot be deleted). */
  readonly canConfirm?: boolean;
  /** Runs the change: null when done (the dialog closes), else the message to show. */
  readonly onConfirm: () => Promise<string | null>;
  readonly onClose: () => void;
  readonly 'data-testid'?: string;
}

/**
 * A short confirmation (Kawadir's delete dialog) for the structure and branches pages: asks first, runs the
 * change, says why it was refused, and closes through the native dialog so focus returns to the menu button.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const [open, setOpen] = useState(true);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const canConfirm = props.canConfirm ?? true;

  return (
    <Dialog
      open={open}
      onClose={props.onClose}
      title={props.title}
      description={props.description}
      closeLabel={props.closeLabel}
      size="sm"
      data-testid={props['data-testid']}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => {
              setOpen(false);
            }}
            disabled={pending}
          >
            {props.keepLabel}
          </Button>
          {canConfirm ? (
            <Button
              variant={props.danger ? 'danger' : 'primary'}
              disabled={pending}
              data-testid="confirm-dialog-confirm"
              onClick={() => {
                setMessage(null);
                startTransition(async () => {
                  const refused = await props.onConfirm();
                  if (refused === null) setOpen(false);
                  else setMessage(refused);
                });
              }}
            >
              {pending ? props.workingLabel : props.confirmLabel}
            </Button>
          ) : null}
        </>
      }
    >
      {props.children}
      {message ? (
        <Alert tone="danger" data-testid="confirm-dialog-message">
          {message}
        </Alert>
      ) : null}
    </Dialog>
  );
}
