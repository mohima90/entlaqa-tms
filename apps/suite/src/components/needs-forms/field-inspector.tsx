'use client';
import {
  CONDITION_TYPES,
  FIELD_TYPES,
  type FieldType,
  type NeedsFormField,
  type NeedsFormSection,
  PEOPLE_MODES,
  type PeopleMode,
  hasOptions,
  localized,
} from '@jadarat/tms/needs-forms';
import { Alert, Button, Icon, type IconName, TextField, cn } from '@jadarat/ui';
import { type SyntheticEvent, useId, useState } from 'react';
import { SelectField } from '../select-field';

export interface FieldDialogValues {
  readonly type: FieldType;
  readonly labelEn: string;
  readonly labelAr: string;
  readonly placeholderEn: string;
  readonly placeholderAr: string;
  readonly required: boolean;
  readonly options: readonly { value?: string; labelEn: string; labelAr: string }[];
  readonly peopleMode: PeopleMode | null;
  readonly condition: { fieldId: string; value: string } | null;
}

export function fieldDialogValues(field: NeedsFormField | null): FieldDialogValues {
  if (!field) {
    return {
      type: 'text',
      labelEn: '',
      labelAr: '',
      placeholderEn: '',
      placeholderAr: '',
      required: false,
      options: [],
      peopleMode: null,
      condition: null,
    };
  }
  return {
    type: field.type,
    labelEn: field.label.en,
    labelAr: field.label.ar,
    placeholderEn: field.placeholder.en ?? '',
    placeholderAr: field.placeholder.ar ?? '',
    required: field.required,
    options: field.options.map((o) => ({
      value: o.value,
      labelEn: o.label.en,
      labelAr: o.label.ar,
    })),
    peopleMode: field.peopleMode,
    condition: field.condition,
  };
}

/** An icon per field type (the outline rows and the type palette). */
export const FIELD_TYPE_ICON: Readonly<Record<FieldType, IconName>> = {
  text: 'fields',
  textarea: 'form',
  number: 'billing',
  date: 'calendar',
  email: 'mail',
  phone: 'user',
  url: 'globe',
  select: 'chevron-down',
  multiselect: 'check',
  radio: 'success',
  checkbox: 'check',
  file: 'upload',
  people: 'people',
};

export interface FieldDialogProps {
  readonly locale: 'ar' | 'en';
  readonly section: NeedsFormSection | null;
  /** The field being edited, or null to add one. */
  readonly field: NeedsFormField | null;
  readonly pending: boolean;
  readonly message: string | null;
  readonly fieldErrors: Readonly<Record<string, string>>;
  readonly text: (key: string, values?: Record<string, string | number>) => string;
  readonly onClose: () => void;
  readonly onSave: (values: FieldDialogValues) => void;
  /** Delete this field (asks first); none for a new or a fixed field. */
  readonly onDelete?: (() => void) | undefined;
  /** «You have unsaved changes.» (shown next to Save field while the inputs differ from the field). */
  readonly unsavedText: string;
}

/**
 * The field settings of the form builder (redesign package 4: an inspector pane instead of the field
 * dialog): English and Arabic labels side by side, the type from a palette (12 types), placeholders, a
 * Required switch, options in both languages for choice types, the people mode for the people field, and one
 * condition — show only when a dropdown or single-choice field of the same section has a given answer. A
 * system field keeps its type, stays required and is never conditional (those controls are not offered).
 * Saved with «Save field», as the dialog was.
 */
export function FieldInspector(props: FieldDialogProps) {
  const { text, locale, section, field } = props;
  const [values, setValues] = useState<FieldDialogValues>(() => fieldDialogValues(field));
  const [newOption, setNewOption] = useState({ en: '', ar: '' });
  const [optionError, setOptionError] = useState<string | null>(null);
  const [choosingType, setChoosingType] = useState(field === null);
  const system = field?.systemKey ?? null;
  const unsaved = JSON.stringify(values) !== JSON.stringify(fieldDialogValues(field));
  const headingId = useId();

  const update = (next: Partial<FieldDialogValues>) => {
    setValues((current) => ({ ...current, ...next }));
  };
  const triggers = (section?.fields ?? []).filter(
    (f) => f.id !== field?.id && CONDITION_TYPES.includes(f.type) && f.options.length > 0,
  );
  const trigger = triggers.find((f) => f.id === values.condition?.fieldId);

  function addOption() {
    if (newOption.en.trim() === '' || newOption.ar.trim() === '') {
      setOptionError(text('optionsHint'));
      return;
    }
    setOptionError(null);
    update({
      options: [...values.options, { labelEn: newOption.en.trim(), labelAr: newOption.ar.trim() }],
    });
    setNewOption({ en: '', ar: '' });
  }

  function submit(event: SyntheticEvent) {
    event.preventDefault();
    props.onSave({
      ...values,
      options: hasOptions(values.type) ? values.options : [],
      peopleMode: values.type === 'people' ? (values.peopleMode ?? 'count_or_employees') : null,
      required: system ? true : values.required,
      condition: system || !values.condition?.value ? null : values.condition,
    });
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col rounded-[22px] border border-border bg-surface shadow-2"
      data-testid="field-inspector"
    >
      <div className="flex items-start gap-3 px-4.5 pb-2 pt-4">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[12.5px] font-semibold uppercase tracking-[var(--letter-spacing-caps)] text-text-muted">
            {text('fieldSettings')}
          </p>
          <h2 id={headingId} className="m-0 text-lg font-bold [overflow-wrap:anywhere]">
            {field ? localized(field.label, locale) : text('addFieldTitle')}
          </h2>
          <p className="m-0 mt-1 text-sm text-text-muted">
            {system ? text('systemNote') : text('fieldDialogDesc')}
          </p>
        </div>
        <button
          type="button"
          onClick={props.onClose}
          aria-label={text('close')}
          className="grid size-10 shrink-0 place-items-center rounded-full text-text-muted hover:bg-surface-hover hover:text-text"
          data-testid="field-inspector-close"
        >
          <Icon name="close" />
        </button>
      </div>
      <form className="flex flex-col gap-4 px-4.5 pb-4.5 pt-2" onSubmit={submit} noValidate>
        {props.message ? (
          <Alert tone="danger" data-testid="field-dialog-error">
            {props.message}
          </Alert>
        ) : null}
        <div className="grid gap-4">
          <TextField
            id="field-label-en"
            label={text('labelEn')}
            marker={text('markerRequired')}
            dir="ltr"
            maxLength={200}
            value={values.labelEn}
            error={props.fieldErrors.labelEn}
            onChange={(e) => {
              update({ labelEn: e.target.value });
            }}
          />
          <TextField
            id="field-label-ar"
            label={text('labelAr')}
            marker={text('markerRequired')}
            dir="rtl"
            lang="ar"
            maxLength={200}
            value={values.labelAr}
            error={props.fieldErrors.labelAr}
            onChange={(e) => {
              update({ labelAr: e.target.value });
            }}
          />
        </div>
        {system ? null : choosingType ? (
          <fieldset
            className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0"
            data-testid="field-types"
          >
            <legend className="mb-2 p-0 text-sm font-semibold">{text('type')}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {FIELD_TYPES.map((type) => (
                <label
                  key={type}
                  className={cn(
                    'flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border-[1.5px] px-3 text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus-ring',
                    values.type === type
                      ? 'border-primary bg-primary-subtle text-primary-text'
                      : 'border-border hover:bg-surface-hover',
                  )}
                >
                  <input
                    type="radio"
                    name="field-type"
                    value={type}
                    checked={values.type === type}
                    onChange={() => {
                      update({ type, options: hasOptions(type) ? values.options : [] });
                      if (field) setChoosingType(false);
                    }}
                    className="sr-only"
                    data-testid={`field-type-${type}`}
                  />
                  <Icon name={FIELD_TYPE_ICON[type]} className="size-4" />
                  {text(`types.${type}`)}
                </label>
              ))}
            </div>
            {props.fieldErrors.type ? (
              <p className="m-0 text-sm font-medium text-danger">{props.fieldErrors.type}</p>
            ) : null}
          </fieldset>
        ) : (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold" id={`${headingId}-type`}>
              {text('type')}
            </span>
            <div className="flex items-center gap-2.5 rounded-[14px] border-[1.5px] border-border-strong px-3 py-2">
              <span className="grid size-8 place-items-center rounded-lg bg-primary-subtle text-primary-text">
                <Icon name={FIELD_TYPE_ICON[values.type]} className="size-4" />
              </span>
              <b className="flex-1">{text(`types.${values.type}`)}</b>
              <Button
                variant="ghost"
                size="sm"
                aria-describedby={`${headingId}-type`}
                onClick={() => {
                  setChoosingType(true);
                }}
                data-testid="field-type-change"
              >
                {text('edit')}
              </Button>
            </div>
          </div>
        )}
        {values.type === 'people' ? (
          <SelectField
            id="field-people-mode"
            label={text('peopleMode')}
            value={values.peopleMode ?? 'count_or_employees'}
            onChange={(e) => {
              update({ peopleMode: e.target.value as PeopleMode });
            }}
          >
            {PEOPLE_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {text(`peopleModes.${mode}`)}
              </option>
            ))}
          </SelectField>
        ) : null}
        {hasOptions(values.type) ? (
          <fieldset
            className="m-0 flex flex-col gap-3 rounded-lg border border-border p-4"
            data-testid="field-options"
          >
            <legend className="px-1 text-sm font-medium">{text('options')}</legend>
            <p className="m-0 text-sm text-text-muted">{text('optionsHint')}</p>
            {values.options.length > 0 ? (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {values.options.map((option, index) => (
                  <li
                    key={`${option.value ?? 'new'}-${String(index)}`}
                    className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5"
                    data-testid="field-option"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm" dir="ltr">
                      {option.labelEn}
                    </span>
                    <span
                      className="min-w-0 flex-1 truncate text-sm text-text-muted"
                      dir="rtl"
                      lang="ar"
                    >
                      {option.labelAr}
                    </span>
                    <button
                      type="button"
                      className="grid size-8 place-items-center rounded-md text-text-muted hover:bg-surface-hover hover:text-danger pointer-coarse:size-11"
                      aria-label={text('removeOption', {
                        name: locale === 'ar' ? option.labelAr : option.labelEn,
                      })}
                      onClick={() => {
                        update({ options: values.options.filter((_, i) => i !== index) });
                      }}
                    >
                      <Icon name="close" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <TextField
                id="field-option-en"
                label={text('optionEn')}
                dir="ltr"
                maxLength={120}
                value={newOption.en}
                onChange={(e) => {
                  setNewOption({ ...newOption, en: e.target.value });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addOption();
                  }
                }}
              />
              <TextField
                id="field-option-ar"
                label={text('optionAr')}
                dir="rtl"
                lang="ar"
                maxLength={120}
                value={newOption.ar}
                onChange={(e) => {
                  setNewOption({ ...newOption, ar: e.target.value });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addOption();
                  }
                }}
              />
              <Button
                variant="secondary"
                type="button"
                onClick={addOption}
                data-testid="field-option-add"
              >
                <Icon name="plus" />
                {text('addOption')}
              </Button>
            </div>
            {(optionError ?? props.fieldErrors.options) ? (
              <p className="m-0 text-sm font-medium text-danger" role="alert">
                {optionError ?? props.fieldErrors.options}
              </p>
            ) : null}
          </fieldset>
        ) : null}
        <div className="grid gap-4">
          <TextField
            id="field-placeholder-en"
            label={text('placeholderEn')}
            marker={text('markerOptional')}
            dir="ltr"
            maxLength={200}
            value={values.placeholderEn}
            onChange={(e) => {
              update({ placeholderEn: e.target.value });
            }}
          />
          <TextField
            id="field-placeholder-ar"
            label={text('placeholderAr')}
            marker={text('markerOptional')}
            dir="rtl"
            lang="ar"
            maxLength={200}
            value={values.placeholderAr}
            onChange={(e) => {
              update({ placeholderAr: e.target.value });
            }}
          />
        </div>
        {system ? null : (
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-semibold">
            {text('requiredField')}
            <input
              id="field-required"
              type="checkbox"
              role="switch"
              checked={values.required}
              onChange={(e) => {
                update({ required: e.target.checked });
              }}
              className="relative h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-full bg-border-strong transition-colors before:absolute before:start-0.5 before:top-0.5 before:size-5 before:rounded-full before:bg-surface before:transition-transform checked:bg-primary checked:before:translate-x-5 rtl:checked:before:-translate-x-5"
            />
          </label>
        )}
        {!system && triggers.length > 0 ? (
          <fieldset
            className="m-0 flex flex-col gap-3 rounded-lg border border-border p-4"
            data-testid="field-condition"
          >
            <legend className="px-1 text-sm font-medium">{text('condition')}</legend>
            <p className="m-0 text-sm text-text-muted">{text('conditionHint')}</p>
            <div className="grid gap-3">
              <SelectField
                id="field-condition-field"
                label={text('condition')}
                value={values.condition?.fieldId ?? ''}
                error={props.fieldErrors.condition}
                onChange={(e) => {
                  update({
                    condition: e.target.value ? { fieldId: e.target.value, value: '' } : null,
                  });
                }}
              >
                <option value="">{text('alwaysShown')}</option>
                {triggers.map((f) => (
                  <option key={f.id} value={f.id}>
                    {localized(f.label, locale)}
                  </option>
                ))}
              </SelectField>
              {trigger ? (
                <SelectField
                  id="field-condition-value"
                  label={text('conditionValue')}
                  value={values.condition?.value ?? ''}
                  onChange={(e) => {
                    update({ condition: { fieldId: trigger.id, value: e.target.value } });
                  }}
                >
                  <option value="">{text('chooseValue')}</option>
                  {trigger.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {localized(o.label, locale)}
                    </option>
                  ))}
                </SelectField>
              ) : null}
            </div>
          </fieldset>
        ) : null}
        <div className="-mx-4.5 mt-1 flex flex-wrap items-center gap-2.5 border-t border-border px-4.5 pt-4">
          {props.onDelete ? (
            <Button
              variant="ghost"
              className="text-danger hover:bg-danger-subtle"
              disabled={props.pending}
              onClick={props.onDelete}
              data-testid="field-inspector-delete"
            >
              <Icon name="trash" />
              {text('delete')}
            </Button>
          ) : null}
          {unsaved ? (
            <p className="m-0 text-sm text-text-muted" data-testid="field-unsaved">
              {props.unsavedText}
            </p>
          ) : null}
          <Button
            type="submit"
            className="ms-auto"
            disabled={props.pending}
            busy={props.pending}
            data-testid="field-save"
          >
            {props.pending ? text('saving') : field ? text('saveField') : text('addField')}
          </Button>
        </div>
      </form>
    </section>
  );
}
