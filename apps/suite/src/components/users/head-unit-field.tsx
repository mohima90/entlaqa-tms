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
  readonly texts: HeadUnitTexts;
  readonly marker?: string | undefined;
  readonly error?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly locale: 'ar' | 'en';
}

/**
 * «Head of which department?» under the Department Head role (WP-FIX-03; PO, 12 Nov 2026): one department
 * of the structure; the person becomes its head when the role is saved. Someone who already heads
 * departments may leave it empty (they keep them). A department with another head says who, before the
 * replacement is confirmed.
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
  const hint =
    units.length === 0
      ? text('none')
      : optional
        ? text('keep', { units: headed.map((h) => labelOf(h.unitId)).join(text('listSeparator')) })
        : text('hint');
  return (
    <div className="flex flex-col gap-2" data-testid="head-unit-field">
      <SelectField
        id={props.id}
        label={text('label')}
        marker={optional ? undefined : props.marker}
        hint={hint}
        error={props.error}
        value={props.value}
        required={!optional}
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
      closeLabel={cancel}
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
