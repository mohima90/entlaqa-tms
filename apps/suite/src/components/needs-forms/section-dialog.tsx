'use client';
import { NEEDS_FORM_LIMITS, type NeedsFormSection } from '@jadarat/tms/needs-forms';
import { Alert, Button, Dialog, TextField } from '@jadarat/ui';
import { type SyntheticEvent, useState } from 'react';

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
  readonly open: boolean;
  readonly section: NeedsFormSection | null;
  readonly pending: boolean;
  readonly message: string | null;
  readonly fieldErrors: Readonly<Record<string, string>>;
  readonly text: (key: string, values?: Record<string, string | number>) => string;
  readonly onClose: () => void;
  readonly onSave: (values: SectionDialogValues) => void;
}

/**
 * Add or edit a section (Kawadir's section dialog): names and descriptions in English and Arabic, and
 * whether department heads can fill it in more than once («repeatable», with minimum and maximum entries).
 */
export function SectionDialog(props: SectionDialogProps) {
  const { text, section } = props;
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
    <Dialog
      open={props.open}
      onClose={props.onClose}
      title={section ? text('editSectionTitle') : text('addSectionTitle')}
      description={text('sectionDialogDesc')}
      closeLabel={text('close')}
      data-testid="section-dialog"
    >
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
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
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="secondary"
            type="button"
            disabled={props.pending}
            onClick={props.onClose}
          >
            {text('cancel')}
          </Button>
          <Button type="submit" disabled={props.pending} data-testid="section-dialog-save">
            {props.pending ? text('saving') : section ? text('save') : text('addSection')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
