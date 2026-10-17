/**
 * Training needs forms (T-M3-10; FR-PLN-02/03; PO, 17 Oct 2026 — business flow EP-PLN §12): the shape of a
 * form as the builder, the preview and the Department Head's needs page use it. Pure and client-safe. The
 * database (migration 20261020180200) is the source of truth and repeats every rule (designer only, system
 * fields, lock, default form, conditions).
 */

/** The 12 field types of the builder (Kawadir's application-form types) and the system `people` type. */
export const FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'date',
  'email',
  'phone',
  'url',
  'select',
  'multiselect',
  'radio',
  'checkbox',
  'file',
] as const;
export type BuilderFieldType = (typeof FIELD_TYPES)[number];
export type FieldType = BuilderFieldType | 'people';

/** Types that carry options (English and Arabic labels). */
export const CHOICE_TYPES: readonly FieldType[] = ['select', 'multiselect', 'radio'];
/** Types a condition can point at: one answer at a time. */
export const CONDITION_TYPES: readonly FieldType[] = ['select', 'radio'];

export function hasOptions(type: FieldType): boolean {
  return CHOICE_TYPES.includes(type);
}

/** The two fields every form keeps: consolidation merges needs by topic and counts sessions by people. */
export const SYSTEM_KEYS = ['training_topic', 'people'] as const;
export type SystemKey = (typeof SYSTEM_KEYS)[number];

/** How the people field is answered: a number, named employees of the head's team, or either. */
export const PEOPLE_MODES = ['count', 'employees', 'count_or_employees'] as const;
export type PeopleMode = (typeof PEOPLE_MODES)[number];

/** Limits (the database checks the same). */
export const NEEDS_FORM_LIMITS = {
  nameLength: 120,
  descriptionLength: 500,
  labelLength: 200,
  placeholderLength: 200,
  optionLabelLength: 120,
  options: 100,
  sections: 30,
  fieldsPerSection: 60,
  maxEntries: 50,
} as const;

export const OPTION_VALUE_RE = /^[a-z0-9_]{1,40}$/;

export interface Localized {
  readonly en: string;
  readonly ar: string;
}

export interface FieldOption {
  /** Stable key stored in the answers (never shown). */
  readonly value: string;
  readonly label: Localized;
}

export interface FieldCondition {
  /** A select or radio field of the same section. */
  readonly fieldId: string;
  /** One of its option values. */
  readonly value: string;
}

export interface NeedsFormField {
  readonly id: string;
  readonly systemKey: SystemKey | null;
  readonly type: FieldType;
  readonly label: Localized;
  readonly placeholder: Partial<Localized>;
  readonly required: boolean;
  readonly visible: boolean;
  readonly options: readonly FieldOption[];
  readonly peopleMode: PeopleMode | null;
  readonly condition: FieldCondition | null;
}

export interface NeedsFormSection {
  readonly id: string;
  readonly name: Localized;
  readonly description: Partial<Localized>;
  readonly repeatable: boolean;
  readonly minEntries: number;
  readonly maxEntries: number;
  readonly visible: boolean;
  /** In display order. */
  readonly fields: readonly NeedsFormField[];
}

export interface NeedsFormSummary {
  readonly id: string;
  readonly name: Localized;
  readonly isDefault: boolean;
  readonly isActive: boolean;
  /** ISO time the form was locked by a launched cycle, or null. */
  readonly lockedAt: string | null;
  readonly version: number;
  readonly sectionCount: number;
  readonly fieldCount: number;
}

export interface NeedsFormDefinition extends NeedsFormSummary {
  /** In display order. */
  readonly sections: readonly NeedsFormSection[];
}

/** The text of a bilingual value in the UI language (the other language when it is missing). */
export function localized(text: Partial<Localized>, locale: 'ar' | 'en'): string {
  const own = text[locale];
  if (own !== undefined && own !== '') return own;
  return (locale === 'ar' ? text.en : text.ar) ?? '';
}

/**
 * A stable option value from its English label: lower-case words joined by `_` (Kawadir), else `option_N`;
 * never one of `taken`.
 */
export function optionValueFor(labelEn: string, taken: readonly string[]): string {
  const base =
    labelEn
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32) || 'option';
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}_${String(n)}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

/** Does the form keep both system fields (a well-formed form always does)? */
export function systemFieldsOf(form: Pick<NeedsFormDefinition, 'sections'>): {
  readonly topic: NeedsFormField | undefined;
  readonly people: NeedsFormField | undefined;
} {
  const fields = form.sections.flatMap((s) => s.fields);
  return {
    topic: fields.find((f) => f.systemKey === 'training_topic'),
    people: fields.find((f) => f.systemKey === 'people'),
  };
}
