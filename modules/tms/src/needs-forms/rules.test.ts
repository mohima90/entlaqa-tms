import { describe, expect, it } from 'vitest';
import { SaveFieldInput, SaveSectionInput } from './inputs';
import { localized, optionValueFor, systemFieldsOf } from './model';
import { type FormChange, applyFormChange, deleteRefusal, optionsFromInput } from './rules';
import { testForm } from './test-form';

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let counter = 0;
const newId = () => `new-${String((counter += 1))}`;

function apply(change: FormChange, form = testForm()) {
  return applyFormChange(form, change, newId);
}

function codes(change: FormChange, form = testForm()) {
  const result = apply(change, form);
  return result.ok ? [] : (result.error.fieldErrors ?? []).map((e) => `${e.path}:${e.code}`);
}

const fieldInput = (over: Record<string, unknown> = {}) =>
  SaveFieldInput.parse({
    formId: UUID(1),
    sectionId: UUID(2),
    type: 'text',
    labelEn: 'Budget owner',
    labelAr: 'مسؤول الميزانية',
    placeholderEn: '',
    placeholderAr: '',
    required: false,
    options: [],
    peopleMode: null,
    condition: null,
    ...over,
  });

/** The test form's section ids are readable strings; the builder input takes uuids. */
const inSection = (sectionId: string, input: ReturnType<typeof fieldInput>, fieldId?: string) => ({
  ...input,
  sectionId,
  ...(fieldId ? { fieldId } : {}),
});

describe('the builder rules (same as the database guards)', () => {
  it('adds a section at the end and edits it; a non-repeating section has one entry', () => {
    const input = SaveSectionInput.parse({
      formId: UUID(1),
      nameEn: ' Context ',
      nameAr: 'السياق',
      descriptionEn: '',
      descriptionAr: ' ',
      repeatable: false,
      minEntries: 0,
      maxEntries: 9,
    });
    expect(input).toMatchObject({ nameEn: 'Context', descriptionEn: null, descriptionAr: null, minEntries: 1, maxEntries: 1 });
    const added = apply({ kind: 'saveSection', input });
    expect(added.ok && added.value.sections.map((s) => s.id)).toEqual(['needs', 'extra', 'new-1']);
    expect(added.ok && added.value.sectionCount).toBe(3);
    const edited = apply({ kind: 'saveSection', input: { ...input, sectionId: 'extra', repeatable: true, minEntries: 0, maxEntries: 5 } });
    expect(edited.ok && edited.value.sections[1]).toMatchObject({ name: { en: 'Context' }, repeatable: true, maxEntries: 5 });
    expect(SaveSectionInput.safeParse({ ...input, repeatable: true, minEntries: 6, maxEntries: 5 }).success).toBe(false);
    expect(apply({ kind: 'saveSection', input: { ...input, sectionId: 'nope' } })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('adds fields with options in both languages; values stay stable when edited', () => {
    const input = inSection(
      'needs',
      fieldInput({
        type: 'select',
        options: [
          { labelEn: 'On site', labelAr: 'في الموقع' },
          { labelEn: 'On site', labelAr: 'في الموقع ٢' },
          { labelEn: '...', labelAr: 'أخرى' },
        ],
      }),
    );
    const added = apply({ kind: 'saveField', input });
    const field = added.ok ? added.value.sections[0]?.fields.at(-1) : undefined;
    expect(field?.options.map((o) => o.value)).toEqual(['on_site', 'on_site_2', 'option']);
    expect(field?.options[0]?.label).toEqual({ en: 'On site', ar: 'في الموقع' });
    // Editing keeps the values answers refer to.
    expect(
      optionsFromInput(
        [{ value: 'on_site', labelEn: 'At the office', labelAr: 'في المكتب' }, { labelEn: 'At the office', labelAr: 'جديد' }],
        field?.options ?? [],
      ).map((o) => o.value),
    ).toEqual(['on_site', 'at_the_office']);
    expect(codes({ kind: 'saveField', input: inSection('needs', fieldInput({ type: 'radio' })) })).toEqual([
      'options:OPTIONS_REQUIRED',
    ]);
    expect(
      codes({
        kind: 'saveField',
        input: inSection('needs', fieldInput({ type: 'radio', options: [{ value: 'a', labelEn: 'A', labelAr: 'أ' }, { value: 'a', labelEn: 'B', labelAr: 'ب' }] })),
      }),
    ).toEqual([]); // a repeated value of a NEW option is re-generated (values are the builder's own)
    expect(codes({ kind: 'saveField', input: inSection('needs', fieldInput({ type: 'people', peopleMode: 'count' })) })).toEqual([
      'type:SYSTEM_TYPE',
    ]);
    // Text fields carry no options even if sent.
    const text = apply({ kind: 'saveField', input: inSection('needs', fieldInput({ options: [{ labelEn: 'x', labelAr: 'س' }] })) });
    expect(text.ok && text.value.sections[0]?.fields.at(-1)?.options).toEqual([]);
  });

  it('keeps system fields required, shown, unconditional and of their type', () => {
    const topic = (over: Record<string, unknown>) =>
      ({ kind: 'saveField', input: inSection('needs', fieldInput(over), 'topic') }) as const;
    expect(codes(topic({ type: 'textarea', required: false, condition: { fieldId: UUID(9), value: 'basic' } }))).toEqual([
      'type:SYSTEM_FIELD',
      'condition:SYSTEM_FIELD',
      'condition:CONDITION_FIELD',
    ]);
    // `required` is forced on for a system field (the switch is not offered).
    const renamed = apply(topic({ labelEn: 'Topic of the training', labelAr: 'موضوع التدريب المطلوب' }));
    expect(renamed.ok && renamed.value.sections[0]?.fields[0]).toMatchObject({
      systemKey: 'training_topic',
      required: true,
      label: { en: 'Topic of the training' },
    });
    const people = apply({ kind: 'saveField', input: inSection('needs', fieldInput({ type: 'people', peopleMode: 'employees' }), 'people') });
    expect(people.ok && people.value.sections[0]?.fields[1]?.peopleMode).toBe('employees');
    expect(codes({ kind: 'deleteField', fieldId: 'topic' })).toEqual(['field:SYSTEM_FIELD']);
    expect(codes({ kind: 'setFieldVisible', fieldId: 'people', visible: false })).toEqual(['field:SYSTEM_FIELD']);
    expect(codes({ kind: 'setFieldRequired', fieldId: 'people', required: false })).toEqual(['field:SYSTEM_FIELD']);
    expect(codes({ kind: 'setFieldRequired', fieldId: 'people', required: true })).toEqual([]);
    expect(codes({ kind: 'setSectionVisible', sectionId: 'needs', visible: false })).toEqual(['section:SYSTEM_SECTION']);
    expect(codes({ kind: 'deleteSection', sectionId: 'needs' })).toEqual(['section:SYSTEM_SECTION']);
    const form = testForm();
    expect(systemFieldsOf(form).topic?.id).toBe('topic');
    expect(systemFieldsOf(form).people?.id).toBe('people');
  });

  it('checks conditions: a dropdown or single choice of the same section, one of its answers, no loop', () => {
    const conditioned = (fieldId: string, value: string, id?: string) =>
      ({ kind: 'saveField', input: inSection('needs', fieldInput({ condition: { fieldId: UUID(9), value } }), id) }) as FormChange;
    const withTrigger = (change: FormChange, triggerId: string): FormChange =>
      change.kind === 'saveField' && change.input.condition
        ? { ...change, input: { ...change.input, condition: { ...change.input.condition, fieldId: triggerId } } }
        : change;
    expect(codes(withTrigger(conditioned('', 'advanced'), 'level'))).toEqual([]);
    expect(codes(withTrigger(conditioned('', 'expert'), 'level'))).toEqual(['condition:CONDITION_VALUE']);
    expect(codes(withTrigger(conditioned('', 'x'), 'topic'))).toEqual(['condition:CONDITION_FIELD']);
    expect(codes(withTrigger(conditioned('', 'x'), 'email'))).toEqual(['condition:CONDITION_FIELD']);
    // Level shown on an answer of «track», which is shown on an answer of Level: a loop.
    const loop = {
      kind: 'saveField',
      input: inSection('needs', fieldInput({ type: 'select', options: [{ value: 'basic', labelEn: 'B', labelAr: 'ب' }, { value: 'advanced', labelEn: 'A', labelAr: 'أ' }], condition: { fieldId: UUID(9), value: 'a' } }), 'level'),
    } as FormChange;
    expect(codes(withTrigger(loop, 'track'))).toEqual(['condition:CONDITION_LOOP']);
    expect(codes(withTrigger(loop, 'level'))).toEqual(['condition:CONDITION_FIELD']);
  });

  it('keeps the answers dependants use', () => {
    const level = (over: Record<string, unknown>) =>
      ({ kind: 'saveField', input: inSection('needs', fieldInput(over), 'level') }) as FormChange;
    expect(codes(level({ type: 'select', options: [{ value: 'basic', labelEn: 'Basic', labelAr: 'أساسي' }] }))).toEqual([
      'options:CONDITION_IN_USE',
    ]);
    expect(codes(level({ type: 'multiselect', options: [{ value: 'basic', labelEn: 'B', labelAr: 'ب' }, { value: 'advanced', labelEn: 'A', labelAr: 'أ' }] }))).toEqual([
      'options:CONDITION_IN_USE',
    ]);
    // Deleting it frees the dependants (always shown).
    const deleted = apply({ kind: 'deleteField', fieldId: 'level' });
    expect(deleted.ok && deleted.value.sections[0]?.fields.map((f) => [f.id, f.condition])).toEqual([
      ['topic', null],
      ['people', null],
      ['details', null],
      ['track', null],
    ]);
  });

  it('moves sections and fields up and down, shows and hides, requires', () => {
    const moved = apply({ kind: 'moveSection', sectionId: 'extra', direction: 'up' });
    expect(moved.ok && moved.value.sections.map((s) => s.id)).toEqual(['extra', 'needs']);
    const edge = apply({ kind: 'moveSection', sectionId: 'needs', direction: 'up' });
    expect(edge.ok && edge.value.sections.map((s) => s.id)).toEqual(['needs', 'extra']);
    const field = apply({ kind: 'moveField', fieldId: 'level', direction: 'down' });
    expect(field.ok && field.value.sections[0]?.fields.map((f) => f.id)).toEqual(['topic', 'people', 'details', 'level', 'track']);
    const hidden = apply({ kind: 'setFieldVisible', fieldId: 'email', visible: false });
    expect(hidden.ok && hidden.value.sections[1]?.fields[0]?.visible).toBe(false);
    const required = apply({ kind: 'setFieldRequired', fieldId: 'email', required: true });
    expect(required.ok && required.value.sections[1]?.fields[0]?.required).toBe(true);
    const off = apply({ kind: 'setSectionVisible', sectionId: 'extra', visible: false });
    expect(off.ok && off.value.sections[1]?.visible).toBe(false);
    const gone = apply({ kind: 'deleteSection', sectionId: 'extra' });
    expect(gone.ok && [gone.value.sectionCount, gone.value.fieldCount]).toEqual([1, 5]);
    for (const change of [
      { kind: 'moveSection', sectionId: 'x', direction: 'up' },
      { kind: 'moveField', fieldId: 'x', direction: 'up' },
      { kind: 'deleteSection', sectionId: 'x' },
      { kind: 'deleteField', fieldId: 'x' },
      { kind: 'saveField', input: inSection('x', fieldInput()) },
      { kind: 'saveField', input: inSection('needs', fieldInput(), 'x') },
    ] as FormChange[]) {
      expect(apply(change)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    }
  });

  it('refuses every change of a locked form, and deleting the default or a locked form', () => {
    const locked = testForm({ lockedAt: '2026-11-01T00:00:00.000Z' });
    expect(codes({ kind: 'moveField', fieldId: 'level', direction: 'up' }, locked)).toEqual(['form:NEEDS_FORM_LOCKED']);
    expect(deleteRefusal({ isDefault: true, lockedAt: null })).toBe('DEFAULT_FORM');
    expect(deleteRefusal({ isDefault: false, lockedAt: locked.lockedAt })).toBe('NEEDS_FORM_LOCKED');
    expect(deleteRefusal({ isDefault: false, lockedAt: null })).toBeNull();
  });

  it('caps sections and fields', () => {
    const form = testForm();
    const many = { ...form, sections: Array.from({ length: 30 }, (_, i) => ({ ...form.sections[1], id: `s${String(i)}` })) } as typeof form;
    const section = SaveSectionInput.parse({ formId: UUID(1), nameEn: 'X', nameAr: 'س', descriptionEn: '', descriptionAr: '', repeatable: false, minEntries: 1, maxEntries: 1 });
    expect(codes({ kind: 'saveSection', input: section }, many)).toEqual(['form:TOO_MANY_SECTIONS']);
    const needs = form.sections[0];
    if (!needs) throw new Error('fixture');
    const full = { ...form, sections: [{ ...needs, fields: Array.from({ length: 60 }, (_, i) => ({ ...needs.fields[2], id: `f${String(i)}` })) }] } as typeof form;
    expect(codes({ kind: 'saveField', input: inSection('needs', fieldInput()) }, full)).toEqual(['section:TOO_MANY_FIELDS']);
  });
});

describe('model helpers', () => {
  it('shows the UI language, else the other one', () => {
    expect(localized({ en: 'Topic', ar: 'الموضوع' }, 'ar')).toBe('الموضوع');
    expect(localized({ en: 'Topic' }, 'ar')).toBe('Topic');
    expect(localized({ ar: 'الموضوع', en: '' }, 'en')).toBe('الموضوع');
    expect(localized({}, 'en')).toBe('');
  });

  it('makes option values from the English label', () => {
    expect(optionValueFor('Leadership & Management', [])).toBe('leadership_management');
    expect(optionValueFor('قيادة', [])).toBe('option');
    expect(optionValueFor('A', ['a', 'a_2'])).toBe('a_3');
  });
});
