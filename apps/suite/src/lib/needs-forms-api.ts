import { type AppError, type Result, appError, err } from '@jadarat/platform-core';
import type {
  FieldType,
  NeedsFormDefinition,
  NeedsFormSummary,
  PeopleMode,
  SaveFieldValues,
  SaveSectionValues,
} from '@jadarat/tms/needs-forms';
import {
  createNeedsFormAction,
  deleteFieldAction,
  deleteNeedsFormAction,
  deleteSectionAction,
  duplicateNeedsFormAction,
  moveFieldAction,
  moveSectionAction,
  renameNeedsFormAction,
  saveFieldAction,
  saveSectionAction,
  setDefaultNeedsFormAction,
  setFieldRequiredAction,
  setFieldVisibleAction,
  setNeedsFormActiveAction,
  setSectionVisibleAction,
} from '../actions/needs-forms';
import { type Names, browserPreview } from './needs-forms-preview';

/**
 * What the library and the builder call (T-M3-10): the server actions when the environment is connected,
 * or the tab's preview copy without a database (needs-forms-preview.ts) — same inputs, same answers.
 */
export type LibraryResult = Result<
  { formId: string; forms: readonly NeedsFormSummary[] },
  AppError
>;
export type FormResult = Result<{ form: NeedsFormDefinition }, AppError>;
type Direction = 'up' | 'down';

/** What the section dialog sends (the server validates it with zod: SaveSectionInput). */
export interface SectionInput {
  readonly formId: string;
  readonly sectionId?: string;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly descriptionEn: string;
  readonly descriptionAr: string;
  readonly repeatable: boolean;
  readonly minEntries: number;
  readonly maxEntries: number;
}

/** What the field dialog sends (the server validates it with zod: SaveFieldInput). */
export interface FieldInput {
  readonly formId: string;
  readonly sectionId: string;
  readonly fieldId?: string;
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

export interface NeedsFormsApi {
  create(names: Names): Promise<LibraryResult>;
  duplicate(formId: string, names: Names): Promise<LibraryResult>;
  rename(formId: string, version: number, names: Names): Promise<LibraryResult>;
  setDefault(formId: string): Promise<LibraryResult>;
  setActive(formId: string, active: boolean): Promise<LibraryResult>;
  remove(formId: string): Promise<LibraryResult>;
  saveSection(input: SectionInput): Promise<FormResult>;
  setSectionVisible(formId: string, sectionId: string, visible: boolean): Promise<FormResult>;
  moveSection(formId: string, sectionId: string, direction: Direction): Promise<FormResult>;
  deleteSection(formId: string, sectionId: string): Promise<FormResult>;
  saveField(input: FieldInput): Promise<FormResult>;
  setFieldVisible(formId: string, fieldId: string, visible: boolean): Promise<FormResult>;
  setFieldRequired(formId: string, fieldId: string, required: boolean): Promise<FormResult>;
  moveField(formId: string, fieldId: string, direction: Direction): Promise<FormResult>;
  deleteField(formId: string, fieldId: string): Promise<FormResult>;
}

export const liveApi: NeedsFormsApi = {
  create: (names) => createNeedsFormAction(names),
  duplicate: (formId, names) => duplicateNeedsFormAction({ formId, ...names }),
  rename: (formId, version, names) => renameNeedsFormAction({ formId, version, ...names }),
  setDefault: (formId) => setDefaultNeedsFormAction({ formId }),
  setActive: (formId, active) => setNeedsFormActiveAction({ formId, active }),
  remove: (formId) => deleteNeedsFormAction({ formId }),
  saveSection: (input) => saveSectionAction(input),
  setSectionVisible: (formId, sectionId, visible) =>
    setSectionVisibleAction({ formId, sectionId, visible }),
  moveSection: (formId, sectionId, direction) =>
    moveSectionAction({ formId, sectionId, direction }),
  deleteSection: (formId, sectionId) => deleteSectionAction({ formId, sectionId }),
  saveField: (input) => saveFieldAction({ ...input, options: [...input.options] }),
  setFieldVisible: (formId, fieldId, visible) =>
    setFieldVisibleAction({ formId, fieldId, visible }),
  setFieldRequired: (formId, fieldId, required) =>
    setFieldRequiredAction({ formId, fieldId, required }),
  moveField: (formId, fieldId, direction) => moveFieldAction({ formId, fieldId, direction }),
  deleteField: (formId, fieldId) => deleteFieldAction({ formId, fieldId }),
};

const required = (fieldErrors: { path: string; code: string }[]) =>
  appError('VALIDATION_FAILED', { fieldErrors });
const orNull = (text: string): string | null => (text.trim() === '' ? null : text.trim());

/** The preview's light version of the server's zod checks (no zod in the browser bundle). */
function sectionValues(input: SectionInput): Result<SaveSectionValues, AppError> {
  const missing = [
    ...(input.nameEn.trim() === '' ? [{ path: 'nameEn', code: 'REQUIRED' }] : []),
    ...(input.nameAr.trim() === '' ? [{ path: 'nameAr', code: 'REQUIRED' }] : []),
    ...(input.repeatable && input.minEntries > input.maxEntries
      ? [{ path: 'minEntries', code: 'INVALID' }]
      : []),
  ];
  if (missing.length > 0) return err(required(missing));
  return {
    ok: true,
    value: {
      formId: input.formId,
      ...(input.sectionId ? { sectionId: input.sectionId } : {}),
      nameEn: input.nameEn.trim(),
      nameAr: input.nameAr.trim(),
      descriptionEn: orNull(input.descriptionEn),
      descriptionAr: orNull(input.descriptionAr),
      repeatable: input.repeatable,
      minEntries: input.repeatable ? input.minEntries : 1,
      maxEntries: input.repeatable ? input.maxEntries : 1,
    },
  };
}

function fieldValues(input: FieldInput): Result<SaveFieldValues, AppError> {
  const missing = [
    ...(input.labelEn.trim() === '' ? [{ path: 'labelEn', code: 'REQUIRED' }] : []),
    ...(input.labelAr.trim() === '' ? [{ path: 'labelAr', code: 'REQUIRED' }] : []),
  ];
  if (missing.length > 0) return err(required(missing));
  return {
    ok: true,
    value: {
      ...input,
      labelEn: input.labelEn.trim(),
      labelAr: input.labelAr.trim(),
      placeholderEn: orNull(input.placeholderEn),
      placeholderAr: orNull(input.placeholderAr),
      options: input.options.map((o) => ({
        ...o,
        labelEn: o.labelEn.trim(),
        labelAr: o.labelAr.trim(),
      })),
    },
  };
}

const trimmed = (names: Names): Names => ({
  nameEn: names.nameEn.trim(),
  nameAr: names.nameAr.trim(),
});
const namesProblem = (names: Names): AppError | null => {
  const fieldErrors = [
    ...(names.nameEn.trim() === '' ? [{ path: 'nameEn', code: 'REQUIRED' }] : []),
    ...(names.nameAr.trim() === '' ? [{ path: 'nameAr', code: 'REQUIRED' }] : []),
  ];
  return fieldErrors.length > 0 ? appError('VALIDATION_FAILED', { fieldErrors }) : null;
};

export function previewApi(): NeedsFormsApi {
  const store = browserPreview();
  const named = (names: Names, run: (n: Names) => LibraryResult) => {
    const problem = namesProblem(names);
    return Promise.resolve(problem ? err(problem) : run(trimmed(names)));
  };
  return {
    create: (names) => named(names, (n) => store.create(n)),
    duplicate: (formId, names) => named(names, (n) => store.duplicate(formId, n)),
    rename: (formId, version, names) => named(names, (n) => store.rename(formId, version, n)),
    setDefault: (formId) => Promise.resolve(store.setDefault(formId)),
    setActive: (formId, active) => Promise.resolve(store.setActive(formId, active)),
    remove: (formId) => Promise.resolve(store.remove(formId)),
    saveSection: (input) => {
      const values = sectionValues(input);
      return Promise.resolve(
        values.ok
          ? store.change(input.formId, { kind: 'saveSection', input: values.value })
          : values,
      );
    },
    setSectionVisible: (formId, sectionId, visible) =>
      Promise.resolve(store.change(formId, { kind: 'setSectionVisible', sectionId, visible })),
    moveSection: (formId, sectionId, direction) =>
      Promise.resolve(store.change(formId, { kind: 'moveSection', sectionId, direction })),
    deleteSection: (formId, sectionId) =>
      Promise.resolve(store.change(formId, { kind: 'deleteSection', sectionId })),
    saveField: (input) => {
      const values = fieldValues(input);
      return Promise.resolve(
        values.ok ? store.change(input.formId, { kind: 'saveField', input: values.value }) : values,
      );
    },
    setFieldVisible: (formId, fieldId, visible) =>
      Promise.resolve(store.change(formId, { kind: 'setFieldVisible', fieldId, visible })),
    setFieldRequired: (formId, fieldId, required) =>
      Promise.resolve(store.change(formId, { kind: 'setFieldRequired', fieldId, required })),
    moveField: (formId, fieldId, direction) =>
      Promise.resolve(store.change(formId, { kind: 'moveField', fieldId, direction })),
    deleteField: (formId, fieldId) =>
      Promise.resolve(store.change(formId, { kind: 'deleteField', fieldId })),
  };
}
