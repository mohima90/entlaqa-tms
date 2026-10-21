'use client';
import { Alert, Avatar, Button, Dialog, Icon, SidePanel, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useState } from 'react';
import { reactivateMemberAction, reactivatePrivilegedMemberAction } from '../../actions/users';
import { reactivationErrorKey } from '../../lib/deactivate-form';
import { returnFocusTo } from '../../lib/focus-return';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { ChangeRolePanel, type ChangeRolePanelProps } from './change-role-panel';
import { DeactivateMemberForm, type DeactivateMemberFormProps } from './deactivate-member-form';
import { EditUserForm, type EditUserFormProps } from './edit-user-form';

/*
 * The panels of one person (redesign package 3 — «one person, one place»): Edit details and Change role are
 * side panels over the profile, Deactivate is a dialog. Each has its own address (`/users/[id]/edit`,
 * `/roles`, `/deactivate`, so bookmarks keep working); closing one returns to the profile (the same tab)
 * and focus goes back to the button that opened it.
 */

/** Where a panel returns to: the profile's address and the id of the element that opened the panel. */
export interface PanelReturn {
  readonly href: string;
  readonly focusId: string;
}

function useClose(back: PanelReturn) {
  const router = useRouter();
  return useCallback(() => {
    returnFocusTo(back.focusId);
    router.push(back.href, { scroll: false });
  }, [router, back.href, back.focusId]);
}

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

export interface EditUserPanelProps {
  readonly title: string;
  readonly back: PanelReturn;
  /** The form (null with `failure`: the details could not be opened here). */
  readonly form: Omit<EditUserFormProps, 'panel'> | null;
  readonly failure?: ReactNode;
  /** Texts: close, cancel, save, saving, saved, noChanges, audited (namespace `editUser`). */
  readonly texts: Readonly<Record<string, string>>;
  readonly discardTexts: DiscardTexts;
}

/**
 * «تعديل البيانات» in a wide side panel (T-M2-13, FR-IAM-01; redesign package 3 — Melio's drawer): today's
 * form, rules and audit; saved → the panel closes, a toast says so and the profile shows the new values.
 * Closing with unsaved changes asks first.
 */
export function EditUserPanel(props: EditUserPanelProps) {
  const text = (key: string) => props.texts[key] ?? key;
  const close = useClose(props.back);
  const [open, setOpen] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [asking, setAsking] = useState(false);
  const formId = 'edit-user-form';

  const canClose = useCallback(() => {
    if (pending) return false;
    if (!dirty) return true;
    setAsking(true);
    return false;
  }, [dirty, pending]);

  const panel = {
    formId,
    onDirty: () => {
      setDirty(true);
    },
    onPending: setPending,
    onSaved: (changed: boolean) => {
      toast.success(changed ? text('saved') : text('noChanges'));
      setDirty(false);
      setOpen(false);
    },
  };

  return (
    <>
      <SidePanel
        open={open}
        onClose={close}
        canClose={canClose}
        title={props.title}
        closeLabel={text('close')}
        size="lg"
        data-testid="edit-user-panel"
        footer={
          props.form ? (
            <>
              <p className="m-0 basis-full text-sm text-text-muted">{text('audited')}</p>
              <div className="ms-auto flex flex-wrap gap-2.5">
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={() => {
                    if (canClose()) setOpen(false);
                  }}
                >
                  {text('cancel')}
                </Button>
                <Button type="submit" form={formId} busy={pending} data-testid="edit-user-save">
                  {pending ? text('saving') : text('save')}
                </Button>
              </div>
            </>
          ) : null
        }
      >
        {props.form ? <EditUserForm {...props.form} panel={panel} /> : props.failure}
      </SidePanel>
      <DiscardDialog
        open={asking}
        texts={props.discardTexts}
        onKeep={() => {
          setAsking(false);
        }}
        onDiscard={() => {
          setAsking(false);
          setDirty(false);
          setOpen(false);
        }}
      />
    </>
  );
}

export interface RolePanelRouteProps extends Omit<
  ChangeRolePanelProps,
  'open' | 'onClose' | 'target' | 'blocked'
> {
  readonly back: PanelReturn;
  /** The role as stored (null with `blocked` or `failure`). */
  readonly target: ChangeRolePanelProps['target'] | null;
  readonly blocked?: string | null | undefined;
  readonly failure?: ReactNode;
  readonly closeLabel: string;
  readonly title: string;
}

/** «تغيير الدور» opened by its own address (`/users/[id]/roles`): the same panel as on Team members. */
export function RolePanelRoute(props: RolePanelRouteProps) {
  const close = useClose(props.back);
  if (!props.target) {
    return (
      <SidePanel
        open
        onClose={close}
        title={props.title}
        closeLabel={props.closeLabel}
        data-testid="change-role-panel"
      >
        {props.failure}
      </SidePanel>
    );
  }
  const { back: _back, failure: _failure, closeLabel: _close, title: _title, ...panel } = props;
  return <ChangeRolePanel {...panel} target={props.target} open onClose={close} />;
}

export interface DeactivateDialogProps {
  readonly title: string;
  readonly back: PanelReturn;
  /** The person (avatar, name, role · unit). */
  readonly person: { readonly name: string; readonly detail: string | null };
  /** What deactivating does (four lines). */
  readonly effects: readonly string[];
  /** The form (null with `blocked` or `failure`). */
  readonly form: Omit<DeactivateMemberFormProps, 'onDone' | 'formId' | 'onPending'> | null;
  readonly blocked?: string | null | undefined;
  readonly failure?: ReactNode;
  /** Texts: close, cancel, submit, submitMove, working, doneToast (raw `{name}`), reactivate.* */
  readonly texts: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
}

const EFFECT_ICONS = ['log-in', 'form', 'key', 'sync'] as const;

/**
 * «تعطيل المستخدم» as a dialog over the profile (T-M2-09, FR-IAM-05; redesign package 3 — Qatalog, Grain):
 * the person, what deactivating does, then — only when needed — who takes over what they are responsible
 * for, and the optional reason. The confirmation is kept (it ends sessions). Done → the profile shows the
 * deactivated account and a toast offers «Reactivate» (today's reactivation, same rules).
 */
export function DeactivateDialog(props: DeactivateDialogProps) {
  const text = (key: string) => props.texts[key] ?? key;
  const router = useRouter();
  const close = useClose(props.back);
  const [open, setOpen] = useState(true);
  const [pending, setPending] = useState(false);
  const canClose = useCallback(() => !pending, [pending]);
  const formId = 'deactivate-form';
  const form = props.form;
  // Nothing can be sent while a kind cannot be moved by this member or nobody can take it over.
  const stuck =
    form !== null &&
    (form.kinds.some((k) => k.blockedText !== null) ||
      (form.kinds.length > 0 && form.candidates.length === 0));

  const reactivate = (personId: string, privileged: boolean) => {
    void (privileged ? reactivatePrivilegedMemberAction : reactivateMemberAction)({
      personId,
    }).then((result) => {
      if (result.ok) {
        toast.success(text('reactivate.done'));
        router.refresh();
        return;
      }
      const key = reactivationErrorKey(result.error);
      toast.error(key ? text(key) : errorText(result.error, props.errors));
    });
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      // Escape, ✕ and the backdrop wait while the deactivation is working.
      canClose={canClose}
      title={props.title}
      closeLabel={text('close')}
      size="lg"
      data-testid="deactivate-dialog"
      className="max-h-[calc(100dvh-2rem)] overflow-auto"
      footer={
        form && !props.blocked ? (
          <>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setOpen(false);
              }}
            >
              {text('cancel')}
            </Button>
            <Button
              type="submit"
              form={formId}
              variant="danger"
              busy={pending}
              disabled={stuck}
              data-testid="deactivate-submit"
            >
              {pending
                ? text('working')
                : form.kinds.length > 0
                  ? text('submitMove')
                  : text('submit')}
            </Button>
          </>
        ) : (
          <Button
            variant="secondary"
            onClick={() => {
              setOpen(false);
            }}
          >
            {text('close')}
          </Button>
        )
      }
    >
      <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-sunken px-4 py-3">
        <Avatar name={props.person.name} size="md" />
        <div className="min-w-0">
          <div className="font-semibold">{props.person.name}</div>
          {props.person.detail ? (
            <div className="text-sm text-text-muted">{props.person.detail}</div>
          ) : null}
        </div>
      </div>
      {props.blocked ? (
        <Alert tone="info" data-testid="deactivation-blocked">
          {props.blocked}
        </Alert>
      ) : form ? (
        <>
          <ul
            className="m-0 flex list-none flex-col gap-2.5 p-0"
            data-testid="deactivation-effects"
          >
            {props.effects.map((effect, index) => (
              <li key={effect} className="flex items-start gap-3">
                <Icon
                  name={EFFECT_ICONS[index] ?? 'info'}
                  className="mt-0.5 size-4.5 shrink-0 text-text-muted"
                />
                <span>{effect}</span>
              </li>
            ))}
          </ul>
          <DeactivateMemberForm
            {...form}
            formId={formId}
            onPending={setPending}
            onDone={() => {
              // Stays until closed (an action: WCAG 2.2.1, the toast's own rule).
              toast.success(text('doneToast').replace('{name}', props.person.name), {
                action: {
                  label: text('reactivate.rowButton'),
                  onClick: () => {
                    reactivate(form.personId, form.privileged);
                  },
                },
              });
              setOpen(false);
            }}
          />
        </>
      ) : (
        props.failure
      )}
    </Dialog>
  );
}
