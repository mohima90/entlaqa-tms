import { type AppError, type FieldError, type Result, appError, err, ok } from '@jadarat/platform-core';
import { conditionMakesLoop, dependantsOf } from './conditions';
import type { SaveFieldValues, SaveSectionValues } from './inputs';
import {
  CONDITION_TYPES,
  type FieldOption,
  NEEDS_FORM_LIMITS,
  type NeedsFormDefinition,
  type NeedsFormField,
  type NeedsFormSection,
  hasOptions,
  optionValueFor,
} from './model';

/**
 * The builder's rules on one form (T-M3-10) — the same rules as the database guards (migration
 * 20261020180200), checked first so the builder can say what is wrong in words, field by field:
 *   locked forms do not change (NEEDS_FORM_LOCKED); system fields keep their type, stay required and shown
 *   and are never conditional or deleted (SYSTEM_FIELD); the section holding them is never hidden or
 *   deleted (SYSTEM_SECTION); a condition points at a dropdown or single-choice field of the same section,
 *   with one of its answers, without a loop (CONDITION_*); a field others depend on keeps those answers
 *   (CONDITION_IN_USE); option values are distinct (OPTION_TWICE); limits (TOO_MANY_*).
 * `applyFormChange` returns the changed form: the server uses it to check before writing, the preview mode
 * (no database) to show the result.
 */
export type FormChange =
  | { readonly kind: 'saveSection'; readonly input: SaveSectionValues }
  | { readonly kind: 'setSectionVisible'; readonly sectionId: string; readonly visible: boolean }
  | { readonly kind: 'moveSection'; readonly sectionId: string; readonly direction: 'up' | 'down' }
  | { readonly kind: 'deleteSection'; readonly sectionId: string }
  | { readonly kind: 'saveField'; readonly input: SaveFieldValues }
  | { readonly kind: 'setFieldVisible'; readonly fieldId: string; readonly visible: boolean }
  | { readonly kind: 'setFieldRequired'; readonly fieldId: string; readonly required: boolean }
  | { readonly kind: 'moveField'; readonly fieldId: string; readonly direction: 'up' | 'down' }
  | { readonly kind: 'deleteField'; readonly fieldId: string };

const invalid = (fieldErrors: FieldError[]): AppError => appError('VALIDATION_FAILED', { fieldErrors });
const refuse = (path: string, code: string, params?: FieldError['params']) =>
  err(invalid([{ path, code, ...(params ? { params } : {}) }]));

function move<T>(items: readonly T[], index: number, direction: 'up' | 'down'): T[] {
  const target = direction === 'up' ? index - 1 : index + 1;
  const copy = [...items];
  if (index < 0 || target < 0 || target >= copy.length) return copy;
  const [item] = copy.splice(index, 1);
  if (item !== undefined) copy.splice(target, 0, item);
  return copy;
}

function locate(form: NeedsFormDefinition, fieldId: string) {
  for (const section of form.sections) {
    const field = section.fields.find((f) => f.id === fieldId);
    if (field) return { section, field };
  }
  return null;
}

const hasSystemField = (section: NeedsFormSection) => section.fields.some((f) => f.systemKey !== null);

function withSection(form: NeedsFormDefinition, section: NeedsFormSection): NeedsFormDefinition {
  return { ...form, sections: form.sections.map((s) => (s.id === section.id ? section : s)) };
}

function counted(form: NeedsFormDefinition): NeedsFormDefinition {
  return {
    ...form,
    sectionCount: form.sections.length,
    fieldCount: form.sections.reduce((n, s) => n + s.fields.length, 0),
  };
}

/** Options from the input: existing values kept, new ones generated from the English label. */
export function optionsFromInput(
  input: SaveFieldValues['options'],
  previous: readonly FieldOption[],
): FieldOption[] {
  const taken: string[] = input.flatMap((o) => (o.value ? [o.value] : []));
  return input.map((o) => {
    const keep = o.value !== undefined && previous.some((p) => p.value === o.value);
    const value = keep && o.value ? o.value : optionValueFor(o.labelEn, taken);
    if (!keep) taken.push(value);
    return { value, label: { en: o.labelEn, ar: o.labelAr } };
  });
}

function checkField(
  section: NeedsFormSection,
  existing: NeedsFormField | undefined,
  field: NeedsFormField,
): FieldError[] {
  const errors: FieldError[] = [];
  if (existing?.systemKey) {
    if (field.type !== existing.type) errors.push({ path: 'type', code: 'SYSTEM_FIELD' });
    if (!field.required) errors.push({ path: 'required', code: 'SYSTEM_FIELD' });
    if (field.condition) errors.push({ path: 'condition', code: 'SYSTEM_FIELD' });
  } else if (field.type === 'people') {
    errors.push({ path: 'type', code: 'SYSTEM_TYPE' });
  }
  if (hasOptions(field.type)) {
    if (field.options.length === 0) errors.push({ path: 'options', code: 'OPTIONS_REQUIRED' });
    if (new Set(field.options.map((o) => o.value)).size !== field.options.length) {
      errors.push({ path: 'options', code: 'OPTION_TWICE' });
    }
  }
  if (field.condition) {
    const trigger = section.fields.find((f) => f.id === field.condition?.fieldId);
    if (!trigger || trigger.id === field.id || !CONDITION_TYPES.includes(trigger.type)) {
      errors.push({ path: 'condition', code: 'CONDITION_FIELD' });
    } else if (!trigger.options.some((o) => o.value === field.condition?.value)) {
      errors.push({ path: 'condition', code: 'CONDITION_VALUE' });
    } else if (conditionMakesLoop(section, field.id, trigger.id)) {
      errors.push({ path: 'condition', code: 'CONDITION_LOOP' });
    }
  }
  if (existing) {
    const broken = dependantsOf(section, existing.id).some(
      (d) =>
        !CONDITION_TYPES.includes(field.type) ||
        !field.options.some((o) => o.value === d.condition?.value),
    );
    if (broken) errors.push({ path: 'options', code: 'CONDITION_IN_USE' });
  }
  return errors;
}

function saveField(
  form: NeedsFormDefinition,
  input: SaveFieldValues,
  newId: () => string,
): Result<NeedsFormDefinition, AppError> {
  const section = form.sections.find((s) => s.id === input.sectionId);
  if (!section) return err(appError('NOT_FOUND'));
  const existing = input.fieldId ? section.fields.find((f) => f.id === input.fieldId) : undefined;
  if (input.fieldId && !existing) return err(appError('NOT_FOUND'));
  if (!existing && section.fields.length >= NEEDS_FORM_LIMITS.fieldsPerSection) {
    return refuse('section', 'TOO_MANY_FIELDS', { max: NEEDS_FORM_LIMITS.fieldsPerSection });
  }
  const type = existing?.systemKey ? existing.type : input.type;
  const field: NeedsFormField = {
    id: existing?.id ?? newId(),
    systemKey: existing?.systemKey ?? null,
    type,
    label: { en: input.labelEn, ar: input.labelAr },
    placeholder: {
      ...(input.placeholderEn ? { en: input.placeholderEn } : {}),
      ...(input.placeholderAr ? { ar: input.placeholderAr } : {}),
    },
    required: existing?.systemKey ? true : input.required,
    visible: existing?.visible ?? true,
    options: hasOptions(type) ? optionsFromInput(input.options, existing?.options ?? []) : [],
    peopleMode: type === 'people' ? (input.peopleMode ?? 'count_or_employees') : null,
    condition: input.condition,
  };
  const errors = checkField(section, existing, { ...field, type: existing?.systemKey ? input.type : type });
  if (errors.length > 0) return err(invalid(errors));
  const fields = existing
    ? section.fields.map((f) => (f.id === field.id ? field : f))
    : [...section.fields, field];
  return ok(withSection(form, { ...section, fields }));
}

function saveSection(
  form: NeedsFormDefinition,
  input: SaveSectionValues,
  newId: () => string,
): Result<NeedsFormDefinition, AppError> {
  const existing = input.sectionId ? form.sections.find((s) => s.id === input.sectionId) : undefined;
  if (input.sectionId && !existing) return err(appError('NOT_FOUND'));
  if (!existing && form.sections.length >= NEEDS_FORM_LIMITS.sections) {
    return refuse('form', 'TOO_MANY_SECTIONS', { max: NEEDS_FORM_LIMITS.sections });
  }
  const section: NeedsFormSection = {
    id: existing?.id ?? newId(),
    name: { en: input.nameEn, ar: input.nameAr },
    description: {
      ...(input.descriptionEn ? { en: input.descriptionEn } : {}),
      ...(input.descriptionAr ? { ar: input.descriptionAr } : {}),
    },
    repeatable: input.repeatable,
    minEntries: input.minEntries,
    maxEntries: input.maxEntries,
    visible: existing?.visible ?? true,
    fields: existing?.fields ?? [],
  };
  return ok(
    existing ? withSection(form, section) : { ...form, sections: [...form.sections, section] },
  );
}

export function applyFormChange(
  form: NeedsFormDefinition,
  change: FormChange,
  newId: () => string,
): Result<NeedsFormDefinition, AppError> {
  if (form.lockedAt !== null) return refuse('form', 'NEEDS_FORM_LOCKED');
  const result = applyUnlocked(form, change, newId);
  return result.ok ? ok(counted(result.value)) : result;
}

function applyUnlocked(
  form: NeedsFormDefinition,
  change: FormChange,
  newId: () => string,
): Result<NeedsFormDefinition, AppError> {
  switch (change.kind) {
    case 'saveSection':
      return saveSection(form, change.input, newId);
    case 'saveField':
      return saveField(form, change.input, newId);
    case 'setSectionVisible':
    case 'deleteSection': {
      const section = form.sections.find((s) => s.id === change.sectionId);
      if (!section) return err(appError('NOT_FOUND'));
      if (hasSystemField(section) && (change.kind === 'deleteSection' || !change.visible)) {
        return refuse('section', 'SYSTEM_SECTION');
      }
      return ok(
        change.kind === 'deleteSection'
          ? { ...form, sections: form.sections.filter((s) => s.id !== section.id) }
          : withSection(form, { ...section, visible: change.visible }),
      );
    }
    case 'moveSection': {
      const index = form.sections.findIndex((s) => s.id === change.sectionId);
      if (index < 0) return err(appError('NOT_FOUND'));
      return ok({ ...form, sections: move(form.sections, index, change.direction) });
    }
    case 'setFieldVisible':
    case 'setFieldRequired':
    case 'deleteField':
    case 'moveField': {
      const found = locate(form, change.fieldId);
      if (!found) return err(appError('NOT_FOUND'));
      const { section, field } = found;
      if (change.kind === 'moveField') {
        const index = section.fields.findIndex((f) => f.id === field.id);
        return ok(withSection(form, { ...section, fields: move(section.fields, index, change.direction) }));
      }
      if (field.systemKey !== null) {
        const harmless =
          (change.kind === 'setFieldVisible' && change.visible) ||
          (change.kind === 'setFieldRequired' && change.required);
        if (!harmless) return refuse('field', 'SYSTEM_FIELD');
      }
      if (change.kind === 'deleteField') {
        // Fields that depended on it become always shown (the database clears their condition).
        const fields = section.fields
          .filter((f) => f.id !== field.id)
          .map((f) => (f.condition?.fieldId === field.id ? { ...f, condition: null } : f));
        return ok(withSection(form, { ...section, fields }));
      }
      const changed: NeedsFormField =
        change.kind === 'setFieldVisible'
          ? { ...field, visible: change.visible }
          : { ...field, required: change.required };
      return ok(
        withSection(form, {
          ...section,
          fields: section.fields.map((f) => (f.id === field.id ? changed : f)),
        }),
      );
    }
  }
}

/** Can the form be deleted? Not the default one, not a locked one (the database says the same). */
export function deleteRefusal(form: Pick<NeedsFormDefinition, 'isDefault' | 'lockedAt'>): string | null {
  if (form.isDefault) return 'DEFAULT_FORM';
  if (form.lockedAt !== null) return 'NEEDS_FORM_LOCKED';
  return null;
}
