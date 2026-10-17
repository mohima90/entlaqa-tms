import { describe, expect, it } from 'vitest';
import {
  conditionMakesLoop,
  dependantsOf,
  isFieldShown,
  keepShownAnswers,
  shownFields,
} from './conditions';
import { testField, testForm, testSection } from './test-form';

const needs = () => {
  const section = testForm().sections[0];
  if (!section) throw new Error('fixture');
  return section;
};

describe('show-if conditions (Kawadir conditional-fields, keyed by field id)', () => {
  it('shows a field on the chosen answer of its dropdown only', () => {
    const section = needs();
    const ids = (entry: Record<string, unknown> | undefined) =>
      shownFields(section, entry).map((f) => f.id);
    expect(ids(undefined)).toEqual(['topic', 'people', 'level']);
    expect(ids({ level: 'advanced' })).toEqual(['topic', 'people', 'level', 'details']);
    expect(ids({ level: 'basic' })).toEqual(['topic', 'people', 'level', 'track']);
    // Answers are matched by field id, never by label or name.
    expect(ids({ Level: 'advanced' })).toEqual(['topic', 'people', 'level']);
  });

  it('hides a field whose trigger is hidden (switched off or not shown itself)', () => {
    const level = testField('level', { type: 'select', visible: false });
    const details = testField('details', { condition: { fieldId: 'level', value: 'x' } });
    expect(isFieldShown(details, [level, details], { level: 'x' })).toBe(false);
    const a = testField('a', { type: 'select' });
    const b = testField('b', { type: 'select', condition: { fieldId: 'a', value: 'on' } });
    const c = testField('c', { condition: { fieldId: 'b', value: 'yes' } });
    expect(isFieldShown(c, [a, b, c], { a: 'off', b: 'yes' })).toBe(false);
    expect(isFieldShown(c, [a, b, c], { a: 'on', b: 'yes' })).toBe(true);
  });

  it('shows a field whose condition points at a deleted field; never one in a loop', () => {
    const orphan = testField('orphan', { condition: { fieldId: 'gone', value: 'x' } });
    expect(isFieldShown(orphan, [orphan], {})).toBe(true);
    const a = testField('a', { condition: { fieldId: 'b', value: 'x' } });
    const b = testField('b', { condition: { fieldId: 'a', value: 'x' } });
    expect(isFieldShown(a, [a, b], { a: 'x', b: 'x' })).toBe(false);
  });

  it('drops the answers of fields that are not shown (stale answers never reach storage)', () => {
    expect(
      keepShownAnswers(needs(), { topic: 'Excel', level: 'basic', details: 'stale', track: 'a' }),
    ).toEqual({ topic: 'Excel', level: 'basic', track: 'a' });
  });

  it('finds dependants and loops for the builder', () => {
    const section = needs();
    expect(dependantsOf(section, 'level').map((f) => f.id)).toEqual(['details', 'track']);
    expect(conditionMakesLoop(section, 'level', 'details')).toBe(true);
    expect(conditionMakesLoop(section, 'track', 'level')).toBe(false);
    const looped = testSection('s', [
      testField('a', { condition: { fieldId: 'b', value: 'x' } }),
      testField('b', { condition: { fieldId: 'a', value: 'x' } }),
    ]);
    expect(conditionMakesLoop(looped, 'c', 'a')).toBe(true);
  });
});
