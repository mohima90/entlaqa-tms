import { hasVisibleText } from '@jadarat/platform-i18n/text';
import { z } from 'zod';
import { FIELD_TYPES, NEEDS_FORM_LIMITS, OPTION_VALUE_RE, PEOPLE_MODES } from './model';

/**
 * Inputs of the needs-form builder's actions (T-M3-10): untrusted, validated with zod before anything
 * else (defineAction → 422 VALIDATION_FAILED with field errors). Bilingual texts are required in both
 * languages (the glossary's rule for organization-defined names), trimmed, without invisible-only text.
 */

const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => hasVisibleText(value), { message: 'invisible' });

/** Optional text: empty becomes null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' || !hasVisibleText(value) ? null : value));

const id = z.uuid();
const formRef = { formId: id };

export const FormNamesInput = z.strictObject({
  nameEn: text(NEEDS_FORM_LIMITS.nameLength),
  nameAr: text(NEEDS_FORM_LIMITS.nameLength),
});

export const CreateNeedsFormInput = FormNamesInput;

export const RenameNeedsFormInput = FormNamesInput.extend({
  ...formRef,
  version: z.number().int().min(1),
});

export const DuplicateNeedsFormInput = FormNamesInput.extend(formRef);

export const NeedsFormRefInput = z.strictObject(formRef);

export const SetNeedsFormActiveInput = z.strictObject({ ...formRef, active: z.boolean() });

export const SaveSectionInput = z
  .strictObject({
    ...formRef,
    sectionId: id.optional(),
    nameEn: text(NEEDS_FORM_LIMITS.nameLength),
    nameAr: text(NEEDS_FORM_LIMITS.nameLength),
    descriptionEn: optionalText(NEEDS_FORM_LIMITS.descriptionLength),
    descriptionAr: optionalText(NEEDS_FORM_LIMITS.descriptionLength),
    repeatable: z.boolean(),
    minEntries: z.number().int().min(0).max(NEEDS_FORM_LIMITS.maxEntries),
    maxEntries: z.number().int().min(1).max(NEEDS_FORM_LIMITS.maxEntries),
  })
  .transform((input) => (input.repeatable ? input : { ...input, minEntries: 1, maxEntries: 1 }))
  .refine((input) => input.minEntries <= input.maxEntries, {
    path: ['minEntries'],
    message: 'above_max',
  });

export const SectionRefInput = z.strictObject({ ...formRef, sectionId: id });
export const FieldRefInput = z.strictObject({ ...formRef, fieldId: id });

export const SetSectionVisibleInput = SectionRefInput.extend({ visible: z.boolean() });
export const SetFieldVisibleInput = FieldRefInput.extend({ visible: z.boolean() });
export const SetFieldRequiredInput = FieldRefInput.extend({ required: z.boolean() });

const direction = z.enum(['up', 'down']);
export const MoveSectionInput = SectionRefInput.extend({ direction });
export const MoveFieldInput = FieldRefInput.extend({ direction });

export const OptionInput = z.strictObject({
  /** Kept when editing an existing option (answers refer to it); generated for a new one. */
  value: z.string().regex(OPTION_VALUE_RE).optional(),
  labelEn: text(NEEDS_FORM_LIMITS.optionLabelLength),
  labelAr: text(NEEDS_FORM_LIMITS.optionLabelLength),
});

export const SaveFieldInput = z.strictObject({
  ...formRef,
  sectionId: id,
  fieldId: id.optional(),
  /** The 12 builder types; the system `people` type keeps its type (sent as `people`). */
  type: z.enum([...FIELD_TYPES, 'people']),
  labelEn: text(NEEDS_FORM_LIMITS.labelLength),
  labelAr: text(NEEDS_FORM_LIMITS.labelLength),
  placeholderEn: optionalText(NEEDS_FORM_LIMITS.placeholderLength),
  placeholderAr: optionalText(NEEDS_FORM_LIMITS.placeholderLength),
  required: z.boolean(),
  options: z.array(OptionInput).max(NEEDS_FORM_LIMITS.options),
  peopleMode: z.enum(PEOPLE_MODES).nullable(),
  condition: z.strictObject({ fieldId: id, value: z.string().regex(OPTION_VALUE_RE) }).nullable(),
});

export type SaveSectionValues = z.output<typeof SaveSectionInput>;
export type SaveFieldValues = z.output<typeof SaveFieldInput>;
