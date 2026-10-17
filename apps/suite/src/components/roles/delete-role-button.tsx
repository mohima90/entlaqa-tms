'use client';
import { Alert, Button, Dialog, Icon } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteCustomRoleAction } from '../../actions/roles';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { fieldErrorCodes } from '../profile/field-errors';

export interface DeleteRoleButtonProps {
  readonly id: string;
  readonly version: number;
  /** Texts (namespace `roleBuilder`): delete, deleteTitle (name filled in), deleteText, deleteConfirm,
   * keep, deleting, inUseShort, conflict, notFound, close. */
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  /** Where to go once deleted (the roles list with its confirmation). */
  readonly deletedHref: string;
  /** Compact: an icon button in the roles table. */
  readonly compact?: boolean;
  readonly label?: string;
}

/**
 * «حذف الدور» (EP-ROLES): asks first, then deletes a custom role nobody holds. The database refuses while
 * people or pending invitations still have it; the page shows how many (the counts are formatted there).
 */
export function DeleteRoleButton(props: DeleteRoleButtonProps) {
  const text = (key: string) => props.texts[key] ?? key;
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function onDelete() {
    setMessage(null);
    startTransition(async () => {
      const result = await deleteCustomRoleAction({ id: props.id, version: props.version });
      if (result.ok) {
        setOpen(false);
        router.push(props.deletedHref);
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      if (Object.values(fieldErrorCodes(result.error)).includes('ROLE_IN_USE')) {
        setMessage(text('inUseShort'));
        router.refresh();
        return;
      }
      if (result.error.code === 'CONFLICT_VERSION') setMessage(text('conflict'));
      else if (result.error.code === 'NOT_FOUND') setMessage(text('notFound'));
      else setMessage(errorText(result.error, props.errors));
    });
  }

  return (
    <>
      {props.compact ? (
        <button
          type="button"
          className="grid size-9 place-items-center rounded-md text-text-muted hover:bg-surface-hover hover:text-danger pointer-coarse:size-11"
          aria-label={props.label ?? text('delete')}
          onClick={() => {
            setOpen(true);
          }}
          data-testid="role-delete"
        >
          <Icon name="trash" />
        </button>
      ) : (
        <Button
          variant="danger-outline"
          onClick={() => {
            setOpen(true);
          }}
          data-testid="role-delete"
        >
          <Icon name="trash" />
          {text('delete')}
        </Button>
      )}
      <Dialog
        open={open}
        onClose={() => {
          if (!pending) setOpen(false);
        }}
        title={text('deleteTitle')}
        description={text('deleteText')}
        closeLabel={text('close')}
        size="sm"
        data-testid="role-delete-dialog"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
              disabled={pending}
            >
              {text('keep')}
            </Button>
            <Button
              variant="danger"
              onClick={onDelete}
              disabled={pending}
              data-testid="role-delete-confirm"
            >
              {pending ? text('deleting') : text('deleteConfirm')}
            </Button>
          </>
        }
      >
        {message ? (
          <Alert tone="danger" data-testid="role-delete-message">
            {message}
          </Alert>
        ) : null}
      </Dialog>
    </>
  );
}
