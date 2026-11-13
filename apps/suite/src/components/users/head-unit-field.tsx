'use client';
import { Alert, Button, Dialog } from '@jadarat/ui';
import { fillText } from '../../lib/fill-text';
import { type HeadOfUnit, unitLabel } from '../../lib/head-unit';
import type { ScopeUnitChoice } from '../../lib/structure-view';
import { SelectField } from '../select-field';

/** Texts of namespace `editRoles.head` (raw: `{name}`, `{unit}`, `{units}`, `{head}` are filled here). */
export type HeadUnitTexts = Readonly<Record<string, string>>;

export interface HeadUnitFieldProps {
  readonly id: string;
  readonly value: string;
  readonly onChange: (unitId: string) => void;
  readonly units: readonly ScopeUnitChoice[];
  readonly heads: readonly HeadOfUnit[];
  /** The person who gets the role (null: someone being invited). */
  readonly personId: string | null;
  /**
   * The person's own department, when the value is that default (PO, 12 Nov 2026): the field then states
   * «Becomes the head of {department}» instead of asking.
   */
  readonly ownUnitId?: string | null | undefined;
  readonly texts: HeadUnitTexts;
  readonly marker?: string | undefined;
  readonly error?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly locale: 'ar' | 'en';
}

/**
 * The department under the Department Head role (WP-FIX-03; PO, 12 Nov 2026): the person becomes the head
 * of THEIR OWN department when the role is saved — the field opens on it and says so; another department
 * can be chosen (a person may head a department above their own). Only a person without a department is
 * asked «Head of which department?». Someone who already heads departments may leave it empty (they keep
 * them). A department with another head says who, before the replacement is confirmed.
 */
export function HeadUnitField(props: HeadUnitFieldProps) {
  const { texts, units, heads, personId } = props;
  const text = (key: string, values: Record<string, string> = {}) =>
    fillText(texts[key] ?? key, values, props.locale);
  const labelOf = (unitId: string) => unitLabel(units.find((u) => u.id === unitId)?.label ?? '');
  const headed = personId === null ? [] : heads.filter((h) => h.personId === personId);
  const optional = headed.length > 0;
  const takenBy =
    props.value === ''
      ? null
      : (heads.find((h) => h.unitId === props.value && h.personId !== personId) ?? null);
  // Their own department is the answer already: a statement, not a question (and no «required» mark).
  const own =
    !optional && props.ownUnitId != null && props.value === props.ownUnitId
      ? props.ownUnitId
      : null;
  const hint =
    units.length === 0
      ? text('none')
      : optional
        ? text('keep', { units: headed.map((h) => labelOf(h.unitId)).join(text('listSeparator')) })
        : own
          ? text('ownHint')
          : text('hint');
  return (
    <div className="flex flex-col gap-2" data-testid="head-unit-field">
      {own ? (
        <p className="m-0 font-semibold" data-testid={`${props.id}-becomes`}>
          {text('becomes', { unit: labelOf(own) })}
        </p>
      ) : null}
      <SelectField
        id={props.id}
        label={own ? text('ownLabel') : text('label')}
        marker={optional || own ? undefined : props.marker}
        hint={hint}
        error={props.error}
        value={props.value}
        // Their own department is the answer already: nothing is asked, so nothing is marked required.
        required={!optional && !own}
        disabled={props.disabled === true || units.length === 0}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
        data-testid={`${props.id}-select`}
      >
        <option value="" disabled={!optional}>
          {text('placeholder')}
        </option>
        {units.map((unit) => (
          <option
            key={unit.id}
            value={unit.id}
            disabled={!unit.active || headed.some((h) => h.unitId === unit.id)}
          >
            {unit.active ? unit.label : `${unit.label} · ${text('inactive')}`}
          </option>
        ))}
      </SelectField>
      {takenBy ? (
        <Alert tone="warning" data-testid={`${props.id}-taken`}>
          {takenBy.name === ''
            ? text('takenUnnamed', { unit: labelOf(takenBy.unitId) })
            : text('takenBy', { unit: labelOf(takenBy.unitId), head: takenBy.name })}
        </Alert>
      ) : null}
    </div>
  );
}

/** The small question before a head is replaced or departments are left without one (Kawadir's popup). */
export function HeadConfirmDialog({
  open,
  title,
  body,
  confirm,
  cancel,
  close,
  busy,
  onConfirm,
  onCancel,
  testId,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly body: string;
  readonly confirm: string;
  readonly cancel: string;
  /** «Close»: the ✕ in the corner — its own name, not «Cancel» again. */
  readonly close: string;
  readonly busy?: boolean | undefined;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly testId: string;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      tone="warning"
      title={title}
      description={body}
      closeLabel={close}
      size="sm"
      data-testid={testId}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {cancel}
          </Button>
          <Button onClick={onConfirm} busy={busy} data-testid={`${testId}-confirm`}>
            {confirm}
          </Button>
        </>
      }
    />
  );
}
