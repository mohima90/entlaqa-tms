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
import { Alert, Button, Dialog, Icon, TextField } from '@jadarat/ui';
import { type SyntheticEvent, useState } from 'react';
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

export interface FieldDialogProps {
  readonly open: boolean;
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
}

/**
 * Add or edit a field (Kawadir's field dialog): English and Arabic labels, type (12 types), placeholders,
 * required, options in both languages for choice types, the people mode for the people field, and one
 * condition — show only when a dropdown or single-choice field of the same section has a given answer. A
 * system field keeps its type, stays required and is never conditional (those controls are not offered).
 */
export function FieldDialog(props: FieldDialogProps) {
  const { text, locale, section, field } = props;
  const [values, setValues] = useState<FieldDialogValues>(() => fieldDialogValues(field));
  const [newOption, setNewOption] = useState({ en: '', ar: '' });
  const [optionError, setOptionError] = useState<string | null>(null);
  const system = field?.systemKey ?? null;

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
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title={field ? text('editFieldTitle') : text('addFieldTitle')}
      description={system ? text('systemNote') : text('fieldDialogDesc')}
      closeLabel={text('close')}
      size="lg"
      data-testid="field-dialog"
    >
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        {props.message ? (
          <Alert tone="danger" data-testid="field-dialog-error">
            {props.message}
          </Alert>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
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
        {system ? null : (
          <SelectField
            id="field-type"
            label={text('type')}
            value={values.type}
            error={props.fieldErrors.type}
            onChange={(e) => {
              const type = e.target.value as FieldType;
              update({ type, options: hasOptions(type) ? values.options : [] });
            }}
          >
            {FIELD_TYPES.map((type) => (
              <option key={type} value={type}>
                {text(`types.${type}`)}
              </option>
            ))}
          </SelectField>
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
        <div className="grid gap-4 sm:grid-cols-2">
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
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              id="field-required"
              type="checkbox"
              checked={values.required}
              onChange={(e) => {
                update({ required: e.target.checked });
              }}
            />
            {text('requiredField')}
          </label>
        )}
        {!system && triggers.length > 0 ? (
          <fieldset
            className="m-0 flex flex-col gap-3 rounded-lg border border-border p-4"
            data-testid="field-condition"
          >
            <legend className="px-1 text-sm font-medium">{text('condition')}</legend>
            <p className="m-0 text-sm text-text-muted">{text('conditionHint')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
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
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="secondary"
            type="button"
            disabled={props.pending}
            onClick={props.onClose}
          >
            {text('cancel')}
          </Button>
          <Button type="submit" disabled={props.pending} data-testid="field-dialog-save">
            {props.pending ? text('saving') : field ? text('save') : text('addField')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
