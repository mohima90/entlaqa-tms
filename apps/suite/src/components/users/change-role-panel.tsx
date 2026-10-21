'use client';
import { Alert, Avatar, Badge, Button, ChoiceCard, SidePanel, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useId, useState, useTransition } from 'react';
import { updateMemberPrivilegedRolesAction, updateMemberRolesAction } from '../../actions/users';
import { fillText } from '../../lib/fill-text';
import {
  type RoleOption,
  needsScopeUnit,
  readsHeadedDepartments,
  roleActionPath,
  roleErrorKey,
  scopeUnitErrorKey,
} from '../../lib/role-choice';
import type { ScopeUnitChoice } from '../../lib/structure-view';
import { type ErrorTexts, errorText } from '../auth/error-text';
import { useSessionRefusal } from '../auth/session-refusal';
import { fieldErrorCodes } from '../profile/field-errors';
import type { RoleSelectTexts } from './role-select';
import { ScopeUnitSelect, type ScopeUnitTexts } from './scope-unit-select';

/** The person whose role changes, and their role now. */
export interface RoleTarget {
  readonly personId: string;
  readonly name: string;
  /** Optimistic concurrency token of the stored role ('' without one). */
  readonly version: string;
  readonly currentRole: string | null;
  /** The unit of the current department-limited role (EP-ORG, T-M3-09), or null. */
  readonly currentUnit: string | null;
}

export interface ChangeRolePanelProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly target: RoleTarget;
  readonly options: readonly RoleOption[];
  readonly selectTexts: RoleSelectTexts;
  readonly scopeUnits: readonly ScopeUnitChoice[];
  readonly unitTexts: ScopeUnitTexts;
  /** Texts of namespace `editRoles` (translated on the server; `{name}` / `{role}` filled here). */
  readonly labels: Readonly<Record<string, string>>;
  readonly errors: ErrorTexts;
  /** Why the role cannot be changed here at all (own role, no account, revoked), already in words. */
  readonly blocked?: string | null | undefined;
  /** «تراجع» / "Undo" in the toast. */
  readonly undoLabel: string;
  readonly locale: 'ar' | 'en';
}

/**
 * Change a member's role in a side panel (redesign package 3 — one panel from Team members' ⋯ and from the
 * profile; Gusto's permission rows): every role as a card with what it does, standard then custom, the
 * current one marked; roles the member may not give are greyed with the reason (privileged roles: the
 * Organization Admin). A department-limited custom role asks for its unit inside its card. Same rules,
 * actions and audit as before (T-M2-14, FR-IAM-07/08; EP-ROLES; EP-ORG). Saved → the panel closes with a
 * toast offering «Undo» for about 10 seconds — only when the member may give the previous role back; Undo
 * is a normal role change back through the same action and checks, so it writes its own audit entry (PO,
 * 21 Oct 2026).
 */
export function ChangeRolePanel(props: ChangeRolePanelProps) {
  const { labels, options, target } = props;
  const text = (key: string, values: Record<string, string> = {}) =>
    fillText(labels[key] ?? key, values, props.locale);
  const router = useRouter();
  const sessionRefused = useSessionRefusal();
  const formId = useId();
  const [pending, startTransition] = useTransition();
  const [role, setRole] = useState(target.currentRole ?? '');
  const [unit, setUnit] = useState(target.currentUnit ?? '');
  const [message, setMessage] = useState<{ tone: 'info' | 'danger'; text: string } | null>(null);
  const [roleError, setRoleError] = useState<string | undefined>(undefined);
  const [unitError, setUnitError] = useState<string | undefined>(undefined);
  const withUnit = needsScopeUnit(options, role);
  const currentUnitInactive =
    target.currentUnit !== null &&
    role === target.currentRole &&
    unit === target.currentUnit &&
    props.scopeUnits.some((u) => u.id === target.currentUnit && !u.active);
  const nameOf = (code: string) => options.find((o) => o.code === code)?.name ?? code;

  const close = () => {
    if (!pending) props.onClose();
  };

  /** Puts the previous role (and unit) back: a role change like any other (same action, own audit entry). */
  const undo = (version: string, previous: string, previousUnit: string | null, next: string) => {
    const action =
      roleActionPath(options, previous, next) === 'privileged'
        ? updateMemberPrivilegedRolesAction
        : updateMemberRolesAction;
    void action({
      personId: target.personId,
      version,
      role: previous,
      scopeUnitId: previousUnit ?? '',
    }).then((result) => {
      if (result.ok) {
        toast.success(text('undone', { name: target.name, role: nameOf(previous) }));
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      const codes = Object.values(fieldErrorCodes(result.error));
      toast.error(
        codes[0] !== undefined
          ? text(roleErrorKey(codes[0]))
          : errorText(result.error, props.errors),
      );
    });
  };

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setRoleError(undefined);
    setUnitError(undefined);
    if (role === '') {
      setRoleError(text('roleRequired'));
      return;
    }
    if (withUnit && unit === '') {
      setUnitError(text('unit.unitRequired'));
      return;
    }
    const scopeUnitId = withUnit ? unit : '';
    if (role === target.currentRole && scopeUnitId === (target.currentUnit ?? '')) {
      setMessage({ tone: 'info', text: text('noChanges') });
      return;
    }
    const action =
      roleActionPath(options, role, target.currentRole) === 'privileged'
        ? updateMemberPrivilegedRolesAction
        : updateMemberRolesAction;
    startTransition(async () => {
      const result = await action({
        personId: target.personId,
        version: target.version,
        role,
        scopeUnitId,
      });
      if (result.ok) {
        // Undo only for someone allowed to give the previous role back (PO, 21 Oct 2026).
        const previous = target.currentRole;
        const undoTo =
          result.value.changed &&
          previous !== null &&
          options.some((o) => o.code === previous && o.assignable)
            ? previous
            : null;
        toast.success(text('saved'), {
          duration: 10_000,
          action:
            undoTo === null
              ? undefined
              : {
                  label: props.undoLabel,
                  onClick: () => {
                    undo(result.value.version, undoTo, result.value.beforeUnit, role);
                  },
                },
        });
        props.onClose();
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      const unitCode = fieldErrorCodes(result.error).scopeUnitId;
      if (unitCode !== undefined) {
        setUnitError(text(`unit.${scopeUnitErrorKey(unitCode)}`));
        return;
      }
      const codes = Object.values(fieldErrorCodes(result.error));
      const first = codes[0];
      if (first !== undefined) {
        const key = roleErrorKey(first);
        // The last Organization Admin is about the change, not the choice: a message in the panel.
        if (key === 'lastAdmin') setMessage({ tone: 'danger', text: text(key) });
        else setRoleError(text(key));
        return;
      }
      setMessage({ tone: 'danger', text: errorText(result.error, props.errors) });
    });
  }

  const card = (option: RoleOption) => (
    <ChoiceCard
      key={option.code}
      id={`${formId}-${option.code}`}
      name={`${formId}-role`}
      value={option.code}
      checked={role === option.code}
      disabled={pending || !option.assignable}
      onChange={(code) => {
        setRole(code);
        setRoleError(undefined);
        setUnitError(undefined);
        setMessage(null);
        // A unit goes only with a department-limited role (the server refuses it otherwise).
        if (!needsScopeUnit(options, code)) setUnit('');
      }}
      title={option.name}
      description={option.description}
      note={
        option.assignable
          ? undefined
          : `${props.selectTexts.notAllowed} · ${text('privilegedAdminOnly')}`
      }
      badges={
        <>
          {option.privileged ? <Badge tone="warning">{props.selectTexts.privileged}</Badge> : null}
          {option.code === target.currentRole ? (
            <Badge tone="brand">{text('current')}</Badge>
          ) : null}
        </>
      }
      data-testid={`role-choice-${option.code}`}
    >
      {needsScopeUnit(options, option.code) ? (
        <ScopeUnitSelect
          id={`${formId}-unit`}
          value={unit}
          onChange={(id) => {
            setUnit(id);
            setUnitError(undefined);
          }}
          choices={props.scopeUnits}
          texts={props.unitTexts}
          error={unitError}
          disabled={pending}
        />
      ) : null}
    </ChoiceCard>
  );

  const standard = options.filter((o) => o.kind === 'standard');
  const custom = options.filter((o) => o.kind === 'custom');
  const errorId = `${formId}-role-error`;

  return (
    <SidePanel
      open={props.open}
      onClose={close}
      title={
        <span className="flex items-center gap-3">
          <Avatar name={target.name} size="md" />
          <span>{text('titleFor', { name: target.name })}</span>
        </span>
      }
      description={text('dialogDescription', { name: target.name })}
      closeLabel={text('close')}
      data-testid="change-role-panel"
      footer={
        props.blocked ? (
          <Button variant="secondary" className="ms-auto" onClick={close}>
            {text('close')}
          </Button>
        ) : (
          <>
            <p className="m-0 flex basis-full items-start gap-2 text-sm text-text-muted">
              {text('audited')}
            </p>
            <div className="ms-auto flex flex-wrap gap-2.5">
              <Button variant="secondary" onClick={close} disabled={pending}>
                {text('cancel')}
              </Button>
              <Button type="submit" form={formId} busy={pending} data-testid="change-role-save">
                {pending ? text('saving') : text('save')}
              </Button>
            </div>
          </>
        )
      }
    >
      {props.blocked ? (
        <Alert tone="info" data-testid="roles-blocked">
          {props.blocked}
        </Alert>
      ) : (
        <form
          id={formId}
          onSubmit={onSubmit}
          noValidate
          className="flex flex-col gap-3"
          data-testid="edit-role-form"
        >
          <fieldset
            className="m-0 flex flex-col gap-2.5 border-0 p-0"
            aria-describedby={roleError ? errorId : undefined}
          >
            <legend className="sr-only">{props.selectTexts.label}</legend>
            <h3 className="m-0 text-xs font-bold uppercase tracking-[0.06em] text-text-muted">
              {props.selectTexts.standardGroup}
            </h3>
            {standard.map(card)}
            {custom.length > 0 ? (
              <>
                <h3 className="m-0 mt-2 text-xs font-bold uppercase tracking-[0.06em] text-text-muted">
                  {props.selectTexts.customGroup}
                </h3>
                {custom.map(card)}
              </>
            ) : null}
          </fieldset>
          {roleError ? (
            <p id={errorId} role="alert" className="m-0 text-sm font-medium text-danger">
              {roleError}
            </p>
          ) : null}
          {currentUnitInactive ? (
            <Alert tone="warning" data-testid="role-unit-inactive">
              {text('unit.currentInactive')}
            </Alert>
          ) : null}
          {readsHeadedDepartments(options, role) ? (
            <Alert tone="info" data-testid="role-departments-hint">
              {text('departmentsHint')}
            </Alert>
          ) : null}
          <div role="status" aria-live="polite">
            {message?.tone === 'info' ? (
              <Alert tone="info" role="none" data-testid="edit-role-message">
                {message.text}
              </Alert>
            ) : null}
          </div>
          {message?.tone === 'danger' ? (
            <Alert tone="danger" data-testid="edit-role-message">
              {message.text}
            </Alert>
          ) : null}
        </form>
      )}
    </SidePanel>
  );
}
