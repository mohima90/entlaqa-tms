import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FIELDS,
  DEFAULT_FORM_NAME,
  NEEDS_SECTION,
  PEOPLE_FIELD,
  TOPIC_FIELD,
  templateForm,
} from './default-form';
import { validateNeedsAnswers } from './validate-answers';

const migrationsDir = new URL('../../../../supabase/migrations/', import.meta.url).pathname;
const seed = () => {
  const file = readdirSync(migrationsDir).find((f) => f.endsWith('_tms__seed_needs_forms_for_new_organizations.sql'));
  if (!file) throw new Error('seed migration not found');
  return readFileSync(join(migrationsDir, file), 'utf8');
};
const sqlText = (text: string) => `'${text.replace(/'/g, "''")}'`;

describe('the default needs form (business flow EP-PLN §12)', () => {
  it('has the agreed fields in order; topic and people are the required system fields', () => {
    expect(DEFAULT_FIELDS.map((f) => [f.label.en, f.type, f.required, f.systemKey])).toEqual([
      ['Training topic', 'text', true, 'training_topic'],
      ['Description', 'textarea', false, null],
      ['Category', 'select', false, null],
      ['Preferred delivery type', 'select', false, null],
      ['People', 'people', true, 'people'],
      ['Priority', 'select', false, null],
      ['Reason type', 'select', false, null],
      ['Reason', 'textarea', false, null],
      ['Preferred quarter', 'select', false, null],
      ['Estimated cost', 'number', false, null],
    ]);
    for (const field of DEFAULT_FIELDS) {
      expect(field.label.ar.trim(), field.label.en).not.toBe('');
      for (const option of field.options) expect(option.label.ar.trim()).not.toBe('');
    }
  });

  it('matches the database seed text for text (drift check)', () => {
    const text = seed();
    const expected = [
      DEFAULT_FORM_NAME.en,
      DEFAULT_FORM_NAME.ar,
      NEEDS_SECTION.name.en,
      NEEDS_SECTION.name.ar,
      NEEDS_SECTION.description.en,
      NEEDS_SECTION.description.ar,
    ];
    for (const field of DEFAULT_FIELDS) {
      expected.push(field.label.en, field.label.ar);
      if (field.placeholder.en) expected.push(field.placeholder.en);
      if (field.placeholder.ar) expected.push(field.placeholder.ar);
    }
    for (const value of expected) expect(text, value).toContain(sqlText(value));
    for (const field of DEFAULT_FIELDS) {
      for (const option of field.options) {
        expect(text, option.value).toContain(
          `{"value": "${option.value}", "label_en": "${option.label.en}", "label_ar": "${option.label.ar}"}`,
        );
      }
    }
    expect(text).toContain(`true, 1, ${String(NEEDS_SECTION.maxEntries)}, true, 1`);
  });

  it('builds the full and the blank form; a need answered with the defaults validates', () => {
    let n = 0;
    const newId = () => `id-${String((n += 1))}`;
    const full = templateForm({ newId, name: DEFAULT_FORM_NAME, isDefault: true, full: true });
    const blank = templateForm({ newId, name: { en: 'Blank', ar: 'فارغ' }, isDefault: false, full: false });
    expect(full.fieldCount).toBe(10);
    expect(blank.sections[0]?.fields.map((f) => f.label.en)).toEqual([TOPIC_FIELD.label.en, PEOPLE_FIELD.label.en]);
    const section = full.sections[0];
    const topic = section?.fields[0];
    const people = section?.fields[4];
    if (!section || !topic || !people) throw new Error('fixture');
    expect(validateNeedsAnswers(full, { [section.id]: [{ [topic.id]: 'Excel', [people.id]: { count: 3 } }] }).ok).toBe(true);
    expect(validateNeedsAnswers(full, { [section.id]: [] }).ok).toBe(false);
  });
});
