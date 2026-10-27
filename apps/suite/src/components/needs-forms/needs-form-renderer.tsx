'use client';
import { Button, Icon, TextField } from '@jadarat/ui';
import {
  type Entry,
  type NeedsFormDefinition,
  type NeedsFormField,
  type NeedsFormSection,
  localized,
  shownFields,
} from '@jadarat/tms/needs-forms';
import type { ReactNode } from 'react';
import { fillText } from '../../lib/fill-text';
import { SelectField } from '../select-field';

/** Answers as the server validates them: `{ [sectionId]: [{ [fieldId]: answer }, …] }` (field ids, T-M3-10). */
export type NeedsFormAnswers = Readonly<Record<string, readonly Entry[]>>;

export interface NeedsFormRendererProps {
  readonly form: Pick<NeedsFormDefinition, 'id' | 'sections'>;
  readonly locale: 'ar' | 'en';
  readonly answers: NeedsFormAnswers;
  readonly onChange: (answers: NeedsFormAnswers) => void;
  /** Texts of the `needsForms` namespace (raw; `renderer.*`, `fieldErrors.*`, `markerRequired`, `markerOptional`). */
  readonly texts: Readonly<Record<string, string>>;
  /** Field errors by path `sections.<sectionId>.<entry>.<fieldId>` → code (from validateNeedsAnswers). */
  readonly errors?: Readonly<Record<string, string>>;
  /** Prefix of the element ids (two renderers on one page). */
  readonly idPrefix?: string;
  /** A field to outline (the form builder's preview: the field being edited). */
  readonly highlight?: string | undefined;
}

/**
 * Renders a needs form for filling in (T-M3-10; reused by the Department Head's needs page, T-M3-05): the
 * shown sections, repeatable ones with «Add another» / «Remove entry» within their limits, and in each entry
 * only the fields shown now (conditions evaluated live: a field appears on its trigger's answer and its stale
 * answer is dropped by the server). Labels, placeholders and options in the page's language (fix (b) over
 * Kawadir). Every control is labelled; required fields say so in words; errors are tied to their field.
 */
export function NeedsFormRenderer(props: NeedsFormRendererProps) {
  const { form, locale, answers, texts } = props;
  const text = (key: string, values: Record<string, string | number> = {}) =>
    fillText(texts[key] ?? key, values, locale);
  // A field error's message; an unknown code falls back to the generic one, never the raw key (S-L2).
  const errorMessage = (code: string) =>
    fillText(texts[`fieldErrors.${code}`] ?? texts['fieldErrors.INVALID'] ?? '', {}, locale);
  const prefix = props.idPrefix ?? `nf-${form.id.slice(0, 8)}`;

  const entriesOf = (section: NeedsFormSection): readonly Entry[] => {
    const given = answers[section.id];
    if (given && given.length > 0) return given;
    return Array.from({ length: Math.max(1, section.minEntries) }, () => ({}));
  };
  const setEntries = (section: NeedsFormSection, entries: readonly Entry[]) => {
    props.onChange({ ...answers, [section.id]: entries });
  };
  const setAnswer = (section: NeedsFormSection, index: number, fieldId: string, value: unknown) => {
    const entries = [...entriesOf(section)];
    const others = Object.entries(entries[index] ?? {}).filter(([key]) => key !== fieldId);
    entries[index] = Object.fromEntries(
      value === undefined || value === '' ? others : [...others, [fieldId, value]],
    );
    setEntries(section, entries);
  };

  return (
    <div className="flex flex-col gap-6" data-testid="needs-form-renderer">
      {form.sections
        .filter((section) => section.visible)
        .map((section) => {
          const entries = entriesOf(section);
          const description = localized(section.description, locale);
          return (
            <fieldset
              key={section.id}
              className="m-0 flex min-w-0 flex-col gap-4 rounded-lg border border-border p-4"
              data-testid={`render-section-${section.id}`}
            >
              <legend className="px-1 text-base font-semibold">
                {localized(section.name, locale)}
              </legend>
              {description ? <p className="m-0 text-sm text-text-muted">{description}</p> : null}
              {section.repeatable ? (
                <p className="m-0 text-sm text-text-muted">
                  {text('renderer.entriesHint', {
                    min: section.minEntries,
                    max: section.maxEntries,
                  })}
                </p>
              ) : null}
              {entries.map((entry, index) => {
                const fields = shownFields(section, entry);
                const entryLabel = text('renderer.entry', { n: index + 1 });
                return (
                  <div
                    key={index}
                    className="flex flex-col gap-3 rounded-md bg-surface-sunken p-3"
                    role={section.repeatable ? 'group' : undefined}
                    aria-label={section.repeatable ? entryLabel : undefined}
                    data-testid={`render-entry-${String(index)}`}
                  >
                    {section.repeatable ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{entryLabel}</span>
                        {entries.length > Math.max(1, section.minEntries) ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEntries(
                                section,
                                entries.filter((_, i) => i !== index),
                              );
                            }}
                          >
                            <Icon name="trash" />
                            {text('renderer.removeEntry', { n: index + 1 })}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                    {fields.length === 0 ? (
                      <p className="m-0 text-sm text-text-muted">{text('renderer.nothingShown')}</p>
                    ) : null}
                    {fields.map((field) => (
                      <div
                        key={field.id}
                        className={
                          field.id === props.highlight
                            ? '-m-1.5 rounded-xl border-2 border-dashed border-primary p-1'
                            : undefined
                        }
                        data-highlighted={field.id === props.highlight ? true : undefined}
                      >
                        <FieldControl
                          field={field}
                          id={`${prefix}-${section.id.slice(0, 8)}-${String(index)}-${field.id.slice(0, 8)}`}
                          locale={locale}
                          value={entry[field.id]}
                          error={
                            props.errors?.[`sections.${section.id}.${String(index)}.${field.id}`]
                          }
                          text={text}
                          errorMessage={errorMessage}
                          onChange={(value) => {
                            setAnswer(section, index, field.id, value);
                          }}
                        />
                      </div>
                    ))}
                  </div>
                );
              })}
              {section.repeatable && entries.length < section.maxEntries ? (
                <div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setEntries(section, [...entries, {}]);
                    }}
                    data-testid={`render-add-entry-${section.id}`}
                  >
                    <Icon name="plus" />
                    {text('renderer.addEntry')}
                  </Button>
                </div>
              ) : null}
            </fieldset>
          );
        })}
    </div>
  );
}

export function FieldControl({
  field,
  id,
  locale,
  value,
  error,
  text,
  errorMessage,
  onChange,
}: {
  field: NeedsFormField;
  id: string;
  locale: 'ar' | 'en';
  value: unknown;
  error: string | undefined;
  text: (key: string, values?: Record<string, string | number>) => string;
  errorMessage: (code: string) => string;
  onChange: (value: unknown) => void;
}) {
  const label = localized(field.label, locale);
  const placeholder = localized(field.placeholder, locale) || undefined;
  const marker = field.required ? text('markerRequired') : text('markerOptional');
  const errorText = error ? errorMessage(error) || undefined : undefined;
  const options = field.options.map((o) => ({ value: o.value, label: localized(o.label, locale) }));
  const str = typeof value === 'string' ? value : '';
  const testId = `render-field-${field.id}`;

  const group = (children: ReactNode, hint?: string) => (
    <fieldset
      className="m-0 flex flex-col gap-2 border-0 p-0"
      data-testid={testId}
      aria-describedby={error ? `${id}-error` : undefined}
    >
      <legend className="p-0 text-sm font-medium">
        {label}
        <span className="ms-1 font-normal text-text-muted">{marker}</span>
      </legend>
      {hint ? <p className="m-0 text-sm text-text-muted">{hint}</p> : null}
      {children}
      {errorText ? (
        <p id={`${id}-error`} className="m-0 text-sm font-medium text-danger">
          {errorText}
        </p>
      ) : null}
    </fieldset>
  );

  switch (field.type) {
    case 'textarea':
      return (
        <div className="flex flex-col gap-1" data-testid={testId}>
          <label htmlFor={id} className="text-sm font-medium">
            {label}
            <span className="ms-1 font-normal text-text-muted">{marker}</span>
          </label>
          <textarea
            id={id}
            value={str}
            placeholder={placeholder}
            rows={3}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(e) => {
              onChange(e.target.value);
            }}
            className="w-full rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm text-text shadow-1"
          />
          {errorText ? (
            <p id={`${id}-error`} className="m-0 text-sm font-medium text-danger">
              {errorText}
            </p>
          ) : null}
        </div>
      );
    case 'select':
      return (
        <div data-testid={testId}>
          <SelectField
            id={id}
            label={label}
            marker={marker}
            error={errorText}
            value={str}
            onChange={(e) => {
              onChange(e.target.value);
            }}
          >
            <option value="">{text('renderer.choose')}</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </SelectField>
        </div>
      );
    case 'radio':
      return group(
        options.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={id}
              value={o.value}
              checked={str === o.value}
              onChange={() => {
                onChange(o.value);
              }}
            />
            {o.label}
          </label>
        )),
      );
    case 'multiselect': {
      const chosen = Array.isArray(value) ? (value as string[]) : [];
      return group(
        options.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={chosen.includes(o.value)}
              onChange={(e) => {
                const next = e.target.checked
                  ? [...chosen, o.value]
                  : chosen.filter((v) => v !== o.value);
                onChange(next.length > 0 ? next : undefined);
              }}
            />
            {o.label}
          </label>
        )),
      );
    }
    case 'checkbox':
      return group(
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => {
              onChange(e.target.checked);
            }}
          />
          {text('renderer.yes')}
        </label>,
      );
    case 'people': {
      const people = (typeof value === 'object' && value !== null ? value : {}) as {
        count?: number;
      };
      const mode = field.peopleMode ?? 'count_or_employees';
      return group(
        <>
          {mode !== 'employees' ? (
            <TextField
              id={`${id}-count`}
              label={text('renderer.peopleCount')}
              type="number"
              inputMode="numeric"
              min={1}
              value={people.count === undefined ? '' : String(people.count)}
              onChange={(e) => {
                const n = e.target.value === '' ? undefined : Number(e.target.value);
                onChange(n === undefined ? undefined : { count: n });
              }}
            />
          ) : null}
          {mode !== 'count' ? (
            <p className="m-0 text-sm text-text-muted">
              {text('renderer.peopleNamed')}: {text('renderer.peopleNamedHint')}
            </p>
          ) : null}
        </>,
      );
    }
    case 'file':
      return group(<p className="m-0 text-sm text-text-muted">{text('renderer.fileHint')}</p>);
    default: {
      const inputType: Record<string, string> = {
        text: 'text',
        number: 'number',
        date: 'date',
        email: 'email',
        phone: 'tel',
        url: 'url',
      };
      const latin = field.type === 'email' || field.type === 'url' || field.type === 'phone';
      return (
        <div data-testid={testId}>
          <TextField
            id={id}
            label={label}
            marker={marker}
            error={errorText}
            type={inputType[field.type] ?? 'text'}
            dir={latin ? 'ltr' : undefined}
            placeholder={placeholder}
            value={typeof value === 'number' ? String(value) : str}
            onChange={(e) => {
              const raw = e.target.value;
              onChange(field.type === 'number' && raw !== '' ? Number(raw) : raw);
            }}
          />
        </div>
      );
    }
  }
}
