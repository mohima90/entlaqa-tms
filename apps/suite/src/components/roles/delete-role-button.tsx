'use client';
import {
  Alert,
  Button,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Icon,
  toast,
} from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteCustomRoleAction } from '../../actions/roles';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { useLatestVersion } from '../latest-version';
import { fieldErrorCodes } from '../profile/field-errors';
import { useCreateRole } from './create-role';

export interface DeleteRoleProps {
  readonly id: string;
  readonly version: number;
  /** Texts (namespace `roleBuilder`): delete, deleteTitle (name filled in), deleteText, deleteConfirm,
   * keep, deleting, inUseShort, conflict, notFound, close, deleted. */
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  /** The roles list (where to go once deleted; a toast says so). */
  readonly rolesHref: string;
}

/**
 * «حذف الدور» (EP-ROLES): asks first (red: it cannot be undone), then deletes a custom role nobody holds.
 * The database refuses while people or pending invitations still have it. Deleted → the roles list with a
 * toast (redesign package 3; no `?deleted=1` in the address any more).
 */
function DeleteRoleDialog(
  props: DeleteRoleProps & { readonly open: boolean; readonly onClose: () => void },
) {
  const text = (key: string) => props.texts[key] ?? key;
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const latestVersion = useLatestVersion();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function onDelete() {
    setMessage(null);
    startTransition(async () => {
      const result = await deleteCustomRoleAction({ id: props.id, version: props.version });
      if (result.ok) {
        props.onClose();
        toast.success(text('deleted'));
        router.push(props.rolesHref);
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      if (Object.values(fieldErrorCodes(result.error)).includes('ROLE_IN_USE')) {
        setMessage(text('inUseShort'));
        router.refresh();
        return;
      }
      // An older copy of the role (WP-FIX-03): the latest version is loaded here, by itself.
      const latest = latestVersion.refresh(result.error, text('conflict'));
      if (latest !== null) setMessage(latest);
      else if (result.error.code === 'NOT_FOUND') setMessage(text('notFound'));
      else setMessage(errorText(result.error, props.errors));
    });
  }

  return (
    <Dialog
      open={props.open}
      onClose={() => {
        if (!pending) props.onClose();
      }}
      tone="danger"
      title={text('deleteTitle')}
      description={text('deleteText')}
      closeLabel={text('close')}
      size="sm"
      data-testid="role-delete-dialog"
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose} disabled={pending}>
            {text('keep')}
          </Button>
          <Button
            variant="danger"
            onClick={onDelete}
            busy={pending}
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
  );
}

/** «حذف الدور» as a button (the edit page's delete card). */
export function DeleteRoleButton(props: DeleteRoleProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="danger-outline"
        onClick={() => {
          setOpen(true);
        }}
        data-testid="role-delete"
      >
        <Icon name="trash" />
        {props.texts.delete}
      </Button>
      <DeleteRoleDialog
        {...props}
        open={open}
        onClose={() => {
          setOpen(false);
        }}
      />
    </>
  );
}

/**
 * The ⋯ menu of a role on Roles & permissions (redesign package 3 — OpenAI Platform, WorkOS): a standard
 * role offers «Create a role from it» (the Organization Admin) — the «Create role» popup, started from that
 * role; a custom role «Delete role» — shown unavailable with the reason while someone holds it, instead of
 * a button that fails.
 */
export function RoleRowMenu({
  label,
  code,
  createFrom,
  remove,
  inUse,
}: {
  /** «إجراءات أخرى لـ{name}» / "More actions for {name}" (filled). */
  readonly label: string;
  /** The role's code: names the menu button, so focus returns to it after the popup. */
  readonly code: string;
  /** «Create a role from it»: its label and the start the popup opens on (`standard:<code>`). */
  readonly createFrom: { readonly label: string; readonly start: string } | null;
  readonly remove: DeleteRoleProps | null;
  /** The role is held: «Delete role» is unavailable and says why. */
  readonly inUse: boolean;
}) {
  const [deleting, setDeleting] = useState(false);
  const create = useCreateRole();
  const menuId = `role-menu-${code}`;
  const copy = create ? createFrom : null;
  if (!copy && !remove) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          id={menuId}
          className="grid size-9 place-items-center rounded-full text-text-muted hover:bg-surface-hover hover:text-text pointer-coarse:size-11"
          aria-label={label}
          data-testid="role-menu"
        >
          <Icon name="more" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-w-80">
          {copy ? (
            <DropdownMenuItem
              onSelect={() => {
                create?.open(copy.start, menuId);
              }}
              data-testid="role-copy"
            >
              <Icon name="plus" />
              {copy.label}
            </DropdownMenuItem>
          ) : null}
          {remove ? (
            <DropdownMenuItem
              tone="danger"
              disabled={inUse}
              onSelect={() => {
                setDeleting(true);
              }}
              data-testid="role-delete"
              className="flex-wrap"
            >
              <Icon name="trash" />
              {remove.texts.delete}
              {inUse ? (
                <span className="basis-full ps-6.5 text-[13px] text-text-muted">
                  {remove.texts.inUseShort}
                </span>
              ) : null}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {remove ? (
        <DeleteRoleDialog
          {...remove}
          open={deleting}
          onClose={() => {
            setDeleting(false);
          }}
        />
      ) : null}
    </>
  );
}
