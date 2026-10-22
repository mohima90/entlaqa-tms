'use client';
import { NEEDS_FORM_LIMITS, type NeedsFormSection, localized } from '@jadarat/tms/needs-forms';
import { Alert, Button, Icon, TextField } from '@jadarat/ui';
import { type SyntheticEvent, useId, useState } from 'react';

export interface SectionDialogValues {
  readonly nameEn: string;
  readonly nameAr: string;
  readonly descriptionEn: string;
  readonly descriptionAr: string;
  readonly repeatable: boolean;
  readonly minEntries: number;
  readonly maxEntries: number;
}

export interface SectionDialogProps {
  readonly locale: 'ar' | 'en';
  readonly section: NeedsFormSection | null;
  /** Delete this section (asks first); none for a new section or the fixed one. */
  readonly onDelete?: (() => void) | undefined;
  readonly pending: boolean;
  readonly message: string | null;
  readonly fieldErrors: Readonly<Record<string, string>>;
  readonly text: (key: string, values?: Record<string, string | number>) => string;
  readonly onClose: () => void;
  readonly onSave: (values: SectionDialogValues) => void;
}

/**
 * The section settings of the form builder (redesign package 4: an inspector pane instead of the section
 * dialog): names and descriptions in English and Arabic, and whether unit heads can fill it in more than
 * once («repeatable», with minimum and maximum entries). Saved with «Save section».
 */
export function SectionInspector(props: SectionDialogProps) {
  const { text, section, locale } = props;
  const headingId = useId();
  const [values, setValues] = useState<SectionDialogValues>(() => ({
    nameEn: section?.name.en ?? '',
    nameAr: section?.name.ar ?? '',
    descriptionEn: section?.description.en ?? '',
    descriptionAr: section?.description.ar ?? '',
    repeatable: section?.repeatable ?? false,
    minEntries: section?.repeatable ? section.minEntries : 1,
    maxEntries: section?.repeatable ? section.maxEntries : 10,
  }));
  const update = (next: Partial<SectionDialogValues>) => {
    setValues((current) => ({ ...current, ...next }));
  };
  const number = (raw: string, fallback: number) => {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
  };

  function submit(event: SyntheticEvent) {
    event.preventDefault();
    props.onSave(values);
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col rounded-[22px] border border-border bg-surface shadow-2"
      data-testid="section-inspector"
    >
      <div className="flex items-start gap-3 px-4.5 pb-2 pt-4">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[12.5px] font-semibold uppercase tracking-[var(--letter-spacing-caps)] text-text-muted">
            {text('sectionSettings')}
          </p>
          <h2 id={headingId} className="m-0 text-lg font-bold [overflow-wrap:anywhere]">
            {section ? localized(section.name, locale) : text('addSectionTitle')}
          </h2>
          <p className="m-0 mt-1 text-sm text-text-muted">{text('sectionDialogDesc')}</p>
        </div>
        <button
          type="button"
          onClick={props.onClose}
          aria-label={text('close')}
          className="grid size-10 shrink-0 place-items-center rounded-full text-text-muted hover:bg-surface-hover hover:text-text"
          data-testid="section-inspector-close"
        >
          <Icon name="close" />
        </button>
      </div>
      <form className="flex flex-col gap-4 px-4.5 pb-4.5 pt-2" onSubmit={submit} noValidate>
        {props.message ? (
          <Alert tone="danger" data-testid="section-dialog-error">
            {props.message}
          </Alert>
        ) : null}
        <TextField
          id="section-name-en"
          label={text('sectionNameEn')}
          marker={text('markerRequired')}
          dir="ltr"
          maxLength={NEEDS_FORM_LIMITS.nameLength}
          value={values.nameEn}
          error={props.fieldErrors.nameEn}
          onChange={(e) => {
            update({ nameEn: e.target.value });
          }}
        />
        <TextField
          id="section-name-ar"
          label={text('sectionNameAr')}
          marker={text('markerRequired')}
          dir="rtl"
          lang="ar"
          maxLength={NEEDS_FORM_LIMITS.nameLength}
          value={values.nameAr}
          error={props.fieldErrors.nameAr}
          onChange={(e) => {
            update({ nameAr: e.target.value });
          }}
        />
        <TextField
          id="section-description-en"
          label={text('descriptionEn')}
          marker={text('markerOptional')}
          dir="ltr"
          maxLength={NEEDS_FORM_LIMITS.descriptionLength}
          value={values.descriptionEn}
          onChange={(e) => {
            update({ descriptionEn: e.target.value });
          }}
        />
        <TextField
          id="section-description-ar"
          label={text('descriptionAr')}
          marker={text('markerOptional')}
          dir="rtl"
          lang="ar"
          maxLength={NEEDS_FORM_LIMITS.descriptionLength}
          value={values.descriptionAr}
          onChange={(e) => {
            update({ descriptionAr: e.target.value });
          }}
        />
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-sunken p-4">
          <div className="flex items-start gap-2">
            <input
              id="section-repeatable"
              type="checkbox"
              className="mt-1"
              checked={values.repeatable}
              aria-describedby="section-repeatable-hint"
              onChange={(e) => {
                update({ repeatable: e.target.checked });
              }}
            />
            <span className="flex flex-col gap-0.5">
              <label htmlFor="section-repeatable" className="text-sm font-medium">
                {text('repeatable')}
              </label>
              <span id="section-repeatable-hint" className="text-sm text-text-muted">
                {text('repeatableHint')}
              </span>
            </span>
          </div>
          {values.repeatable ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                id="section-min-entries"
                label={text('minEntries')}
                type="number"
                inputMode="numeric"
                min={0}
                max={NEEDS_FORM_LIMITS.maxEntries}
                value={String(values.minEntries)}
                error={props.fieldErrors.minEntries}
                onChange={(e) => {
                  update({ minEntries: number(e.target.value, 0) });
                }}
              />
              <TextField
                id="section-max-entries"
                label={text('maxEntries')}
                type="number"
                inputMode="numeric"
                min={1}
                max={NEEDS_FORM_LIMITS.maxEntries}
                value={String(values.maxEntries)}
                error={props.fieldErrors.maxEntries}
                onChange={(e) => {
                  update({ maxEntries: number(e.target.value, 1) });
                }}
              />
            </div>
          ) : null}
        </div>
        <div className="-mx-4.5 mt-1 flex flex-wrap items-center gap-2.5 border-t border-border px-4.5 pt-4">
          {props.onDelete ? (
            <Button
              variant="ghost"
              className="text-danger hover:bg-danger-subtle"
              disabled={props.pending}
              onClick={props.onDelete}
              data-testid="section-inspector-delete"
            >
              <Icon name="trash" />
              {text('delete')}
            </Button>
          ) : null}
          <Button
            type="submit"
            className="ms-auto"
            disabled={props.pending}
            busy={props.pending}
            data-testid="section-save"
          >
            {props.pending ? text('saving') : section ? text('saveSection') : text('addSection')}
          </Button>
        </div>
      </form>
    </section>
  );
}
