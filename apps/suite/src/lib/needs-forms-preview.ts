import { type AppError, type Result, appError, err, ok } from '@jadarat/platform-core';
import {
  DEFAULT_FORM_NAME,
  type FormChange,
  type NeedsFormDefinition,
  type NeedsFormSummary,
  applyFormChange,
  deleteRefusal,
  templateForm,
} from '@jadarat/tms/needs-forms';

/**
 * The needs forms without a database (T-M3-10): the environment is not connected (local development, the
 * default CI run), so the library and the builder work on a copy kept in this browser tab
 * (sessionStorage), starting from the default form — the same rules as the server (applyFormChange), so
 * every screen can be tried and tested end to end. Nothing leaves the browser.
 */
export const PREVIEW_STORAGE_KEY = 'jadarat.needs-forms.preview';

export interface PreviewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const newId = (): string => globalThis.crypto.randomUUID();
const validation = (path: string, code: string) =>
  appError('VALIDATION_FAILED', { fieldErrors: [{ path, code }] });

export function summaryOf(form: NeedsFormDefinition): NeedsFormSummary {
  return {
    id: form.id,
    name: form.name,
    isDefault: form.isDefault,
    isActive: form.isActive,
    lockedAt: form.lockedAt,
    version: form.version,
    sectionCount: form.sections.length,
    fieldCount: form.sections.reduce((n, s) => n + s.fields.length, 0),
  };
}

/** Default first, then by English name (as the server lists them). */
function sorted(forms: readonly NeedsFormDefinition[]): NeedsFormSummary[] {
  return [...forms]
    .sort(
      (a, b) =>
        Number(b.isDefault) - Number(a.isDefault) ||
        a.name.en.toLowerCase().localeCompare(b.name.en.toLowerCase()),
    )
    .map(summaryOf);
}

export interface Names {
  readonly nameEn: string;
  readonly nameAr: string;
}

export class NeedsFormsPreview {
  constructor(private readonly storage: PreviewStorage | null) {}

  private read(): NeedsFormDefinition[] {
    try {
      const raw = this.storage?.getItem(PREVIEW_STORAGE_KEY);
      if (raw) return JSON.parse(raw) as NeedsFormDefinition[];
    } catch {
      // Storage blocked or damaged: start again from the default form.
    }
    return [templateForm({ newId, name: DEFAULT_FORM_NAME, isDefault: true, full: true })];
  }

  private write(forms: readonly NeedsFormDefinition[]): void {
    try {
      this.storage?.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(forms));
    } catch {
      // Not kept (private window): the screen still shows the change.
    }
  }

  list(): NeedsFormSummary[] {
    const forms = this.read();
    this.write(forms);
    return sorted(forms);
  }

  get(formId: string): NeedsFormDefinition | null {
    return this.read().find((f) => f.id === formId) ?? null;
  }

  private nameProblem(
    forms: readonly NeedsFormDefinition[],
    names: Names,
    except?: string,
  ): AppError | null {
    const clash = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
    const others = forms.filter((f) => f.id !== except);
    if (others.some((f) => clash(f.name.en, names.nameEn)))
      return validation('nameEn', 'NAME_TAKEN');
    if (others.some((f) => clash(f.name.ar, names.nameAr)))
      return validation('nameAr', 'NAME_TAKEN');
    return null;
  }

  private library(
    formId: string,
    change: (forms: NeedsFormDefinition[]) => Result<NeedsFormDefinition[], AppError>,
  ): Result<{ formId: string; forms: NeedsFormSummary[] }, AppError> {
    const result = change(this.read());
    if (!result.ok) return result;
    this.write(result.value);
    return ok({ formId, forms: sorted(result.value) });
  }

  create(names: Names) {
    const form = templateForm({
      newId,
      name: { en: names.nameEn, ar: names.nameAr },
      isDefault: false,
      full: false,
    });
    return this.library(form.id, (forms) => {
      const problem = this.nameProblem(forms, names);
      return problem ? err(problem) : ok([...forms, form]);
    });
  }

  duplicate(formId: string, names: Names) {
    const id = newId();
    return this.library(id, (forms) => {
      const source = forms.find((f) => f.id === formId);
      if (!source) return err(appError('NOT_FOUND'));
      const problem = this.nameProblem(forms, names);
      if (problem) return err(problem);
      // New ids everywhere; conditions re-pointed at the copies.
      const ids = new Map<string, string>();
      const sections = source.sections.map((s) => ({
        ...s,
        id: newId(),
        fields: s.fields.map((f) => {
          const copy = newId();
          ids.set(f.id, copy);
          return { ...f, id: copy };
        }),
      }));
      const copy: NeedsFormDefinition = {
        ...source,
        id,
        name: { en: names.nameEn, ar: names.nameAr },
        isDefault: false,
        isActive: true,
        lockedAt: null,
        version: 1,
        sections: sections.map((s) => ({
          ...s,
          fields: s.fields.map((f) =>
            f.condition
              ? {
                  ...f,
                  condition: {
                    ...f.condition,
                    fieldId: ids.get(f.condition.fieldId) ?? f.condition.fieldId,
                  },
                }
              : f,
          ),
        })),
      };
      return ok([...forms, copy]);
    });
  }

  rename(formId: string, version: number, names: Names) {
    return this.library(formId, (forms) => {
      const form = forms.find((f) => f.id === formId);
      if (!form) return err(appError('NOT_FOUND'));
      if (form.version !== version) return err(appError('CONFLICT_VERSION'));
      const problem = this.nameProblem(forms, names, formId);
      if (problem) return err(problem);
      return ok(
        forms.map((f) =>
          f.id === formId
            ? { ...f, name: { en: names.nameEn, ar: names.nameAr }, version: f.version + 1 }
            : f,
        ),
      );
    });
  }

  setDefault(formId: string) {
    return this.library(formId, (forms) =>
      forms.some((f) => f.id === formId)
        ? ok(
            forms.map((f) => ({
              ...f,
              isDefault: f.id === formId,
              isActive: f.id === formId ? true : f.isActive,
            })),
          )
        : err(appError('NOT_FOUND')),
    );
  }

  setActive(formId: string, active: boolean) {
    return this.library(formId, (forms) => {
      const form = forms.find((f) => f.id === formId);
      if (!form) return err(appError('NOT_FOUND'));
      if (form.isDefault && !active) return err(validation('form', 'DEFAULT_FORM'));
      return ok(forms.map((f) => (f.id === formId ? { ...f, isActive: active } : f)));
    });
  }

  remove(formId: string) {
    return this.library(formId, (forms) => {
      const form = forms.find((f) => f.id === formId);
      if (!form) return err(appError('NOT_FOUND'));
      const refusal = deleteRefusal(form);
      return refusal ? err(validation('form', refusal)) : ok(forms.filter((f) => f.id !== formId));
    });
  }

  change(formId: string, change: FormChange): Result<{ form: NeedsFormDefinition }, AppError> {
    const forms = this.read();
    const form = forms.find((f) => f.id === formId);
    if (!form) return err(appError('NOT_FOUND'));
    const result = applyFormChange(form, change, newId);
    if (!result.ok) return result;
    this.write(forms.map((f) => (f.id === formId ? result.value : f)));
    return ok({ form: result.value });
  }
}

/** The tab's preview store (sessionStorage when the browser allows it). */
export function browserPreview(): NeedsFormsPreview {
  return new NeedsFormsPreview(sessionStorageOrNull());
}

function sessionStorageOrNull(): PreviewStorage | null {
  try {
    return typeof globalThis.sessionStorage === 'undefined' ? null : globalThis.sessionStorage;
  } catch {
    return null; // blocked by the browser
  }
}

/** The tab's preview copy as stored (seeded with the default form on first read); null on the server. */
export function previewSnapshot(): string | null {
  const storage = sessionStorageOrNull();
  if (!storage) return null;
  try {
    const stored = storage.getItem(PREVIEW_STORAGE_KEY);
    if (stored) return stored;
    new NeedsFormsPreview(storage).list();
    return storage.getItem(PREVIEW_STORAGE_KEY) ?? '[]';
  } catch {
    return null;
  }
}

/** The forms of a snapshot (previewSnapshot), as the library lists them. */
export function previewSummaries(snapshot: string): NeedsFormSummary[] {
  try {
    return sorted(JSON.parse(snapshot) as NeedsFormDefinition[]);
  } catch {
    return [];
  }
}

/** One form of a snapshot, or null. */
export function previewForm(snapshot: string, formId: string): NeedsFormDefinition | null {
  try {
    return (JSON.parse(snapshot) as NeedsFormDefinition[]).find((f) => f.id === formId) ?? null;
  } catch {
    return null;
  }
}
