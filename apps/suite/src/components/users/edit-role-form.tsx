'use client';
import { Alert, Button } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useState, useTransition } from 'react';
import { updateMemberPrivilegedRolesAction, updateMemberRolesAction } from '../../actions/users';
import {
  type RoleOption,
  readsHeadedDepartments,
  roleActionPath,
  roleErrorKey,
} from '../../lib/role-choice';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { fieldErrorCodes } from '../profile/field-errors';
import { RoleSelect, type RoleSelectTexts } from './role-select';

export interface EditRoleFormProps {
  readonly personId: string;
  /** Optimistic concurrency token of the stored role ('' without one). */
  readonly version: string;
  readonly currentRole: string | null;
  readonly options: readonly RoleOption[];
  readonly selectTexts: RoleSelectTexts;
  /** Texts by key (namespace `editRoles`, translated on the server). */
  readonly labels: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  /** Inside the dialog: closes it (the list refreshes). */
  readonly onCancel?: () => void;
  readonly onSaved?: () => void;
  /** The page: «رجوع إلى الملف». */
  readonly backHref?: string;
  readonly idPrefix: string;
}

/**
 * Change a member's role (T-M2-14; EP-ROLES, PO 17 Oct 2026 — Kawadir's «تعديل الدور»: one role per person,
 * standard or custom). Privileged roles (and roles with permissions the member does not hold) are listed
 * but disabled for anyone but the Organization Admin; a change touching a privileged role goes through
 * the privileged action. Department Head (or a custom role limited to «their departments») sees the
 * departments the person heads in the structure (set by HR).
 */
export function EditRoleForm(props: EditRoleFormProps) {
  const { labels, options } = props;
  const text = (key: string) => labels[key] ?? key;
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const [pending, startTransition] = useTransition();
  const [role, setRole] = useState(props.currentRole ?? '');
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const lockedSome = options.some((o) => !o.assignable);

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setFieldError(undefined);
    if (role === '') {
      setFieldError(text('roleRequired'));
      return;
    }
    if (role === props.currentRole) {
      setMessage({ tone: 'success', text: text('noChanges') });
      return;
    }
    const action =
      roleActionPath(options, role, props.currentRole) === 'privileged'
        ? updateMemberPrivilegedRolesAction
        : updateMemberRolesAction;
    startTransition(async () => {
      const result = await action({ personId: props.personId, version: props.version, role });
      if (result.ok) {
        setMessage({ tone: 'success', text: text('saved') });
        router.refresh();
        props.onSaved?.();
        return;
      }
      if (sessionRefused(result.error)) return;
      const codes = Object.values(fieldErrorCodes(result.error));
      const first = codes[0];
      if (first !== undefined) {
        const key = roleErrorKey(first);
        setFieldError(text(key));
        setMessage({ tone: 'danger', text: text(key) });
        return;
      }
      setMessage({ tone: 'danger', text: errorText(result.error, props.errors) });
    });
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={onSubmit}
      noValidate
      data-testid="edit-role-form"
    >
      <RoleSelect
        id={`${props.idPrefix}-role`}
        value={role}
        onChange={(code) => {
          setRole(code);
          setFieldError(undefined);
        }}
        options={options}
        texts={props.selectTexts}
        hint={text('roleHint')}
        error={fieldError}
        disabled={pending}
      />
      {readsHeadedDepartments(options, role) ? (
        <Alert tone="info" data-testid="role-departments-hint">
          {text('departmentsHint')}
        </Alert>
      ) : null}
      {lockedSome ? (
        <p className="m-0 text-sm text-text-muted" data-testid="role-locked-hint">
          {text('privilegedAdminOnly')}
        </p>
      ) : null}
      <p className="m-0 text-sm text-text-muted">{text('audited')}</p>
      {message ? (
        <Alert tone={message.tone} data-testid="edit-role-message">
          {message.text}
        </Alert>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {props.onCancel ? (
          <Button variant="secondary" onClick={props.onCancel} disabled={pending}>
            {text('cancel')}
          </Button>
        ) : null}
        {props.backHref ? (
          <a href={props.backHref} className="inline-flex min-h-11 items-center px-2 text-sm">
            {text('backToProfile')}
          </a>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? text('saving') : text('save')}
        </Button>
      </div>
    </form>
  );
}
