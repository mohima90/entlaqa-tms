'use client';
import { Alert, Avatar, Badge, Button, ChoiceCard, Dialog, toast } from '@jadarat/ui';
import { useRouter } from 'next/navigation';
import { type SyntheticEvent, useCallback, useId, useState, useTransition } from 'react';
import { updateMemberPrivilegedRolesAction, updateMemberRolesAction } from '../../actions/users';
import { fillText } from '../../lib/fill-text';
import {
  DEPARTMENT_HEAD_ROLE,
  EMPLOYEE_ROLE,
  headUnitDefault,
  type HeadUnitView,
  NO_HEAD_UNIT_VIEW,
  headUnitErrorKey,
  unitLabel,
} from '../../lib/head-unit';
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
import { HeadConfirmDialog, HeadUnitField, type HeadUnitTexts } from './head-unit-field';
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
  /**
   * Called once the popup has closed (Escape, ✕, Cancel, saved) — always through the native dialog, so its
   * focus return runs first; the caller then removes it and may move focus to a known element.
   */
  readonly onClose: () => void;
  readonly target: RoleTarget;
  readonly options: readonly RoleOption[];
  readonly selectTexts: RoleSelectTexts;
  readonly scopeUnits: readonly ScopeUnitChoice[];
  readonly unitTexts: ScopeUnitTexts;
  /** «Head of which department?» for the Department Head role (WP-FIX-03); absent: never asked. */
  readonly headUnits?: HeadUnitView | undefined;
  readonly headTexts?: HeadUnitTexts | undefined;
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
 * Change a member's role in one centred popup (672 px; forms standard rule 9 — the Kawadir pattern, PO
 * 12 Nov 2026; before: a side panel) — the same popup from Team members' ⋯ and from the profile: every role
 * as a card with what it does, standard then custom, the
 * current one marked; roles the member may not give are greyed with the reason (privileged roles: the
 * Organization Admin). A department-limited custom role asks for its unit inside its card. Same rules,
 * actions and audit as before (T-M2-14, FR-IAM-07/08; EP-ROLES; EP-ORG). Saved → the panel closes with a
 * toast offering «Undo» — only when the member may give the previous role back; Undo is a normal role
 * change back through the same action and checks, so it writes its own audit entry (PO, 21 Oct 2026). The
 * PO asked for about 10 seconds; the review of 21 Oct 2026 keeps a toast with an action until it is closed
 * (WCAG 2.2.1 / 2.1.1: keyboard and screen-reader users must be able to reach it).
 *
 * «Either door does both» (WP-FIX-03; PO, 12 Nov 2026): the Department Head role makes the person the
 * head of THEIR OWN department — the panel says «Becomes the head of {department}» and lets another one be
 * chosen; only a person without a department is asked «Head of which department?». Whoever gives the role
 * sets the head with it (HR Manager or Organization Admin). A department that has another head asks before
 * replacing; making a head an Employee warns which departments are left without one.
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
  // «Head of which department?» (WP-FIX-03).
  const headUnits = props.headUnits ?? NO_HEAD_UNIT_VIEW;
  const headTexts = props.headTexts ?? {};
  const headText = (key: string, values: Record<string, string> = {}) =>
    fillText(headTexts[key] ?? key, values, props.locale);
  const [pickedHeadUnit, setHeadUnit] = useState('');
  const [headError, setHeadError] = useState<string | undefined>(undefined);
  const [asking, setAsking] = useState<'replace' | 'clear' | null>(null);
  const picksHead = headUnits.canPick && role === DEPARTMENT_HEAD_ROLE;
  const headed = headUnits.heads.filter((h) => h.personId === target.personId);
  // Their own department unless another one is picked (PO, 12 Nov 2026).
  const headUnit = headUnitDefault({
    picked: pickedHeadUnit,
    ownUnitId: headUnits.ownUnitId,
    headsSomething: headed.length > 0,
    units: props.scopeUnits,
  });
  const unitName = (unitId: string) =>
    unitLabel(props.scopeUnits.find((u) => u.id === unitId)?.label ?? '');
  const headedNames = headed.map((h) => unitName(h.unitId)).join(headText('listSeparator'));
  const replaced =
    picksHead && headUnit !== ''
      ? (headUnits.heads.find((h) => h.unitId === headUnit && h.personId !== target.personId) ??
        null)
      : null;
  // A head keeps their departments with any role but Employee (PO, 12 Nov 2026); see edit-roles.ts.
  const leavesUnits = headUnits.canPick && role === EMPLOYEE_ROLE && headed.length > 0;
  const currentUnitInactive =
    target.currentUnit !== null &&
    role === target.currentRole &&
    unit === target.currentUnit &&
    props.scopeUnits.some((u) => u.id === target.currentUnit && !u.active);
  const nameOf = (code: string) => options.find((o) => o.code === code)?.name ?? code;

  // Closing goes through the dialog (`open` false → native close → focus return → `onClose`), never by
  // removing an open dialog (focus would be lost; review, 21 Oct 2026).
  const [shown, setShown] = useState(true);
  const close = () => {
    if (!pending) setShown(false);
  };
  // Escape, ✕ and the backdrop wait while the change is being saved.
  const canClose = useCallback(() => !pending, [pending]);

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
    setHeadError(undefined);
    if (role === '') {
      setRoleError(text('roleRequired'));
      return;
    }
    if (withUnit && unit === '') {
      setUnitError(text('unit.unitRequired'));
      return;
    }
    if (picksHead && headUnit === '' && headed.length === 0) {
      setHeadError(headText('required'));
      return;
    }
    const scopeUnitId = withUnit ? unit : '';
    if (
      role === target.currentRole &&
      scopeUnitId === (target.currentUnit ?? '') &&
      !(picksHead && headUnit !== '')
    ) {
      setMessage({ tone: 'info', text: text('noChanges') });
      return;
    }
    // A department with another head, or departments left without one: ask first (a small popup).
    if (replaced) {
      setAsking('replace');
      return;
    }
    if (leavesUnits) {
      setAsking('clear');
      return;
    }
    send({ replaceHead: false, clearHeads: false });
  }

  function send(confirmed: { readonly replaceHead: boolean; readonly clearHeads: boolean }) {
    const scopeUnitId = withUnit ? unit : '';
    const headUnitId = picksHead ? headUnit : '';
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
        headUnitId,
        replaceHead: confirmed.replaceHead,
        clearHeads: confirmed.clearHeads,
      });
      setAsking(null);
      if (result.ok) {
        const { headSet, headsCleared } = result.value;
        if (headSet !== null || headsCleared.length > 0) {
          // A head changed with the role: said in the toast; no Undo (the role alone would not undo it).
          toast.success(
            headSet !== null
              ? headText('savedHead', { name: target.name, unit: unitName(headSet.unitId) })
              : headText('savedCleared', {
                  units: headsCleared.map(unitName).join(headText('listSeparator')),
                }),
          );
          setShown(false);
          router.refresh();
          return;
        }
        // A Department Head who heads nothing yet, given by a member who does not see the structure (a
        // custom role that gives roles without the Organization pages — the HR Manager and the
        // Organization Admin set the head with the role): say who picks the department.
        if (
          role === DEPARTMENT_HEAD_ROLE &&
          !headUnits.canPick &&
          headed.length === 0 &&
          headTexts.savedNoUnit !== undefined
        ) {
          toast.info(headText('savedNoUnit', { name: target.name }));
          setShown(false);
          router.refresh();
          return;
        }
        // Undo only for someone allowed to give the previous role back (PO, 21 Oct 2026) — and never back
        // to Department Head: that role asks «Head of which department?», which one click cannot answer
        // (review L2: the server refused the Undo with a message about a missing department).
        const previous = target.currentRole;
        const undoTo =
          result.value.changed &&
          previous !== null &&
          previous !== DEPARTMENT_HEAD_ROLE &&
          options.some((o) => o.code === previous && o.assignable)
            ? previous
            : null;
        toast.success(text('saved'), {
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
        setShown(false);
        router.refresh();
        return;
      }
      if (sessionRefused(result.error)) return;
      const unitCode = fieldErrorCodes(result.error).scopeUnitId;
      if (unitCode !== undefined) {
        setUnitError(text(`unit.${scopeUnitErrorKey(unitCode)}`));
        return;
      }
      // The head changed since the page was loaded: the same questions, from the server's answer.
      const headCode = fieldErrorCodes(result.error).headUnitId;
      if (headCode !== undefined) {
        setHeadError(headText(headUnitErrorKey(headCode)));
        router.refresh();
        return;
      }
      if (fieldErrorCodes(result.error).role === 'HEADS_LEFT') {
        router.refresh();
        setAsking('clear');
        return;
      }
      const codes = Object.values(fieldErrorCodes(result.error));
      const first = codes[0];
      if (first !== undefined) {
        const key = roleErrorKey(first);
        // The last Organization Admin, or a head whose departments this member cannot leave without one,
        // is about the change, not the choice: a message in the panel.
        if (key === 'lastAdmin' || key === 'headsNotYours') {
          setMessage({ tone: 'danger', text: text(key) });
        } else setRoleError(text(key));
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
        setHeadError(undefined);
        setMessage(null);
        // A unit goes only with a department-limited role (the server refuses it otherwise).
        if (!needsScopeUnit(options, code)) setUnit('');
        if (code !== DEPARTMENT_HEAD_ROLE) setHeadUnit('');
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
      {headUnits.canPick && option.code === DEPARTMENT_HEAD_ROLE && role === option.code ? (
        <HeadUnitField
          id={`${formId}-head-unit`}
          value={headUnit}
          onChange={(id) => {
            setHeadUnit(id);
            setHeadError(undefined);
            setMessage(null);
          }}
          units={props.scopeUnits}
          heads={headUnits.heads}
          personId={target.personId}
          ownUnitId={headUnits.ownUnitId}
          texts={headTexts}
          error={headError}
          disabled={pending}
          locale={props.locale}
        />
      ) : null}
    </ChoiceCard>
  );

  const standard = options.filter((o) => o.kind === 'standard');
  const custom = options.filter((o) => o.kind === 'custom');
  const errorId = `${formId}-role-error`;

  return (
    <Dialog
      open={props.open && shown}
      onClose={props.onClose}
      canClose={canClose}
      size="rich"
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
          <Button variant="secondary" onClick={close}>
            {text('close')}
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close} disabled={pending}>
              {text('cancel')}
            </Button>
            <Button type="submit" form={formId} busy={pending} data-testid="change-role-save">
              {pending ? text('saving') : text('save')}
            </Button>
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
          {readsHeadedDepartments(options, role) && !picksHead ? (
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
          <p className="m-0 text-[13px] text-text-muted">{text('audited')}</p>
        </form>
      )}
      <HeadConfirmDialog
        open={asking === 'replace' && replaced !== null}
        title={headText('replaceTitle', { unit: unitName(headUnit) })}
        body={
          replaced && replaced.name !== ''
            ? headText('replaceBody', {
                unit: unitName(headUnit),
                head: replaced.name,
                name: target.name,
              })
            : headText('replaceBodyUnnamed', { unit: unitName(headUnit), name: target.name })
        }
        confirm={headText('replaceConfirm')}
        cancel={headText('cancel')}
        busy={pending}
        onConfirm={() => {
          send({ replaceHead: true, clearHeads: false });
        }}
        onCancel={() => {
          if (!pending) setAsking(null);
        }}
        testId="head-replace-dialog"
      />
      <HeadConfirmDialog
        open={asking === 'clear'}
        title={headText('clearTitle', { units: headedNames })}
        body={headText('clearBody', { name: target.name, units: headedNames })}
        confirm={headText('clearConfirm')}
        cancel={headText('cancel')}
        busy={pending}
        onConfirm={() => {
          send({ replaceHead: false, clearHeads: true });
        }}
        onCancel={() => {
          if (!pending) setAsking(null);
        }}
        testId="head-clear-dialog"
      />
    </Dialog>
  );
}
