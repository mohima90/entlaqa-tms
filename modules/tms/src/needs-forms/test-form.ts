import type { NeedsFormDefinition, NeedsFormField, NeedsFormSection } from './model';

/** Test helpers: a small form with readable ids (not shipped: imported by tests only). */
export function testField(id: string, over: Partial<NeedsFormField> = {}): NeedsFormField {
  return {
    id,
    systemKey: null,
    type: 'text',
    label: { en: id, ar: id },
    placeholder: {},
    required: false,
    visible: true,
    options: [],
    peopleMode: null,
    condition: null,
    ...over,
  };
}

export const opts = (...values: string[]) =>
  values.map((value) => ({ value, label: { en: value.toUpperCase(), ar: `ع-${value}` } }));

export function testSection(
  id: string,
  fields: NeedsFormField[],
  over: Partial<NeedsFormSection> = {},
) {
  return {
    id,
    name: { en: id, ar: id },
    description: {},
    repeatable: false,
    minEntries: 1,
    maxEntries: 1,
    visible: true,
    fields,
    ...over,
  } satisfies NeedsFormSection;
}

/**
 * Section `needs` (repeatable 1–3): topic* (system), people* (system, count_or_employees), level (select
 * basic/advanced), details (textarea, shown when level = advanced), track (radio a/b, shown when level =
 * basic). Section `extra` (one entry): email, start (date), cost (number), agree (checkbox, required),
 * tags (multiselect x/y), site (url), phone, attachment (file).
 */
export function testForm(over: Partial<NeedsFormDefinition> = {}): NeedsFormDefinition {
  const needs = testSection(
    'needs',
    [
      testField('topic', { systemKey: 'training_topic', required: true }),
      testField('people', {
        systemKey: 'people',
        type: 'people',
        required: true,
        peopleMode: 'count_or_employees',
      }),
      testField('level', { type: 'select', options: opts('basic', 'advanced') }),
      testField('details', {
        type: 'textarea',
        required: true,
        condition: { fieldId: 'level', value: 'advanced' },
      }),
      testField('track', {
        type: 'radio',
        options: opts('a', 'b'),
        condition: { fieldId: 'level', value: 'basic' },
      }),
    ],
    { repeatable: true, minEntries: 1, maxEntries: 3 },
  );
  const extra = testSection('extra', [
    testField('email', { type: 'email' }),
    testField('start', { type: 'date' }),
    testField('cost', { type: 'number' }),
    testField('agree', { type: 'checkbox', required: true }),
    testField('tags', { type: 'multiselect', options: opts('x', 'y') }),
    testField('site', { type: 'url' }),
    testField('phone', { type: 'phone' }),
    testField('attachment', { type: 'file' }),
  ]);
  return {
    id: 'form',
    name: { en: 'Form', ar: 'نموذج' },
    isDefault: false,
    isActive: true,
    lockedAt: null,
    version: 1,
    sectionCount: 2,
    fieldCount: 13,
    sections: [needs, extra],
    ...over,
  };
}
