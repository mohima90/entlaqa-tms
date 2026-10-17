import { type AppError, type Result, appError, err } from '@jadarat/platform-core';
import {
  type NeedsFormDefinition,
  type NeedsFormSummary,
  SaveFieldInput,
  SaveSectionInput,
} from '@jadarat/tms/needs-forms';
import type { z } from 'zod';
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

export interface NeedsFormsApi {
  create(names: Names): Promise<LibraryResult>;
  duplicate(formId: string, names: Names): Promise<LibraryResult>;
  rename(formId: string, version: number, names: Names): Promise<LibraryResult>;
  setDefault(formId: string): Promise<LibraryResult>;
  setActive(formId: string, active: boolean): Promise<LibraryResult>;
  remove(formId: string): Promise<LibraryResult>;
  saveSection(input: z.input<typeof SaveSectionInput>): Promise<FormResult>;
  setSectionVisible(formId: string, sectionId: string, visible: boolean): Promise<FormResult>;
  moveSection(formId: string, sectionId: string, direction: Direction): Promise<FormResult>;
  deleteSection(formId: string, sectionId: string): Promise<FormResult>;
  saveField(input: z.input<typeof SaveFieldInput>): Promise<FormResult>;
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
  saveField: (input) => saveFieldAction(input),
  setFieldVisible: (formId, fieldId, visible) =>
    setFieldVisibleAction({ formId, fieldId, visible }),
  setFieldRequired: (formId, fieldId, required) =>
    setFieldRequiredAction({ formId, fieldId, required }),
  moveField: (formId, fieldId, direction) => moveFieldAction({ formId, fieldId, direction }),
  deleteField: (formId, fieldId) => deleteFieldAction({ formId, fieldId }),
};

/** zod issues as the server's field errors (path of the first segment, code VALIDATION). */
function invalidInput(error: z.ZodError): AppError {
  return appError('VALIDATION_FAILED', {
    fieldErrors: error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      code: 'INVALID',
    })),
  });
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
      const parsed = SaveSectionInput.safeParse(input);
      return Promise.resolve(
        parsed.success
          ? store.change(parsed.data.formId, { kind: 'saveSection', input: parsed.data })
          : err(invalidInput(parsed.error)),
      );
    },
    setSectionVisible: (formId, sectionId, visible) =>
      Promise.resolve(store.change(formId, { kind: 'setSectionVisible', sectionId, visible })),
    moveSection: (formId, sectionId, direction) =>
      Promise.resolve(store.change(formId, { kind: 'moveSection', sectionId, direction })),
    deleteSection: (formId, sectionId) =>
      Promise.resolve(store.change(formId, { kind: 'deleteSection', sectionId })),
    saveField: (input) => {
      const parsed = SaveFieldInput.safeParse(input);
      return Promise.resolve(
        parsed.success
          ? store.change(parsed.data.formId, { kind: 'saveField', input: parsed.data })
          : err(invalidInput(parsed.error)),
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
