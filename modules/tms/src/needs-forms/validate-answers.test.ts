import { describe, expect, it } from 'vitest';
import { testForm } from './test-form';
import { ANSWER_LIMITS, validateEntry, validateNeedsAnswers } from './validate-answers';

const PERSON_A = '0a000000-0000-4000-8000-000000000001';
const PERSON_B = '0a000000-0000-4000-8000-000000000002';
const FILE = '0f000000-0000-4000-8000-0000000000AA';

const extra = { agree: true };
const need = (over: Record<string, unknown> = {}) => ({ topic: ' Excel ', people: { count: 4 }, ...over });

function errorsOf(answers: unknown, context = {}) {
  const result = validateNeedsAnswers(testForm(), answers, context);
  if (result.ok) return [];
  expect(result.error.code).toBe('VALIDATION_FAILED');
  return (result.error.fieldErrors ?? []).map((e) =>
    e.params ? `${e.path}:${e.code}:${JSON.stringify(e.params)}` : `${e.path}:${e.code}`,
  );
}

describe('validateNeedsAnswers (server-side, keyed by field id)', () => {
  it('accepts valid answers, normalized, keeping only what is shown', () => {
    const result = validateNeedsAnswers(testForm(), {
      needs: [
        need({ level: 'basic', track: 'b', details: 'stale' }),
        need({ topic: 'SQL', people: { personIds: [PERSON_A.toUpperCase()] }, level: 'advanced', details: ' Joins ' }),
      ],
      extra: [
        {
          agree: true,
          email: ' a@b.test ',
          start: '2027-02-28',
          cost: '1500.50',
          tags: ['y', 'x'],
          site: 'https://example.test/x',
          phone: '+966 50 000 0001',
          attachment: FILE,
        },
      ],
    });
    expect(result).toEqual({
      ok: true,
      value: {
        needs: [
          { topic: 'Excel', people: { count: 4 }, level: 'basic', track: 'b' },
          { topic: 'SQL', people: { count: 1, personIds: [PERSON_A] }, level: 'advanced', details: 'Joins' },
        ],
        extra: [
          {
            agree: true,
            email: 'a@b.test',
            start: '2027-02-28',
            cost: 1500.5,
            tags: ['y', 'x'],
            site: 'https://example.test/x',
            phone: '+966 50 000 0001',
            attachment: FILE.toLowerCase(),
          },
        ],
      },
    });
  });

  it('requires the required fields that are shown, and only those', () => {
    expect(errorsOf({ needs: [{ level: 'advanced' }], extra: [{}] })).toEqual([
      'sections.needs.0.topic:REQUIRED',
      'sections.needs.0.people:REQUIRED',
      'sections.needs.0.details:REQUIRED',
      'sections.extra.0.agree:REQUIRED',
    ]);
    // `details` is required only when shown; a required checkbox must be ticked.
    expect(errorsOf({ needs: [need({ level: 'basic' })], extra: [{ agree: false }] })).toEqual([
      'sections.extra.0.agree:REQUIRED',
    ]);
    // A section that does not repeat may be left out: one empty entry.
    expect(errorsOf({ needs: [need()] })).toEqual(['sections.extra.0.agree:REQUIRED']);
  });

  it('checks every type', () => {
    expect(
      errorsOf({
        needs: [need({ topic: 'x'.repeat(ANSWER_LIMITS.text + 1), level: 'expert', details: 7 })],
        extra: [
          {
            agree: 'yes',
            email: 'not-an-email',
            start: '2027-02-30',
            cost: 'twelve',
            tags: ['x', 'x'],
            site: 'javascript:alert(1)',
            phone: '12',
            attachment: '../etc/passwd',
          },
        ],
      }),
    ).toEqual([
      `sections.needs.0.topic:TOO_LONG:{"max":${String(ANSWER_LIMITS.text)}}`,
      'sections.needs.0.level:NOT_AN_OPTION',
      'sections.extra.0.email:INVALID_EMAIL',
      'sections.extra.0.start:INVALID_DATE',
      'sections.extra.0.cost:INVALID_NUMBER',
      'sections.extra.0.agree:INVALID_TYPE',
      'sections.extra.0.tags:OPTION_TWICE',
      'sections.extra.0.site:INVALID_URL',
      'sections.extra.0.phone:INVALID_PHONE',
      'sections.extra.0.attachment:INVALID_FILE',
    ]);
    expect(
      errorsOf({
        needs: [need()],
        extra: [{ ...extra, tags: ['z'], cost: Number.POSITIVE_INFINITY, start: 20270101, site: 'not a url' }],
      }),
    ).toEqual([
      'sections.extra.0.start:INVALID_TYPE',
      'sections.extra.0.cost:INVALID_NUMBER',
      'sections.extra.0.tags:NOT_AN_OPTION',
      'sections.extra.0.site:INVALID_URL',
    ]);
    expect(errorsOf({ needs: [need()], extra: [{ ...extra, tags: 'x', cost: 2e12, start: '2027-1-1' }] })).toEqual([
      'sections.extra.0.start:INVALID_DATE',
      'sections.extra.0.cost:INVALID_NUMBER',
      'sections.extra.0.tags:INVALID_TYPE',
    ]);
  });

  it('checks the people field against its mode and the head’s team', () => {
    const people = (value: unknown, context = {}) =>
      errorsOf({ needs: [need({ people: value })], extra: [extra] }, context);
    expect(people({ count: 0 })).toEqual(['sections.needs.0.people:INVALID_COUNT']);
    expect(people({ count: 2.5 })).toEqual(['sections.needs.0.people:INVALID_COUNT']);
    expect(people({ count: ANSWER_LIMITS.maxPeople + 1 })).toEqual([
      `sections.needs.0.people:TOO_MANY_PEOPLE:{"max":${String(ANSWER_LIMITS.maxPeople)}}`,
    ]);
    expect(people(4)).toEqual(['sections.needs.0.people:INVALID_TYPE']);
    expect(people({ count: 1, extra: true })).toEqual(['sections.needs.0.people:INVALID_TYPE']);
    expect(people({ personIds: ['nope'] })).toEqual(['sections.needs.0.people:INVALID_PERSON']);
    expect(people({ personIds: [PERSON_A, PERSON_A] })).toEqual(['sections.needs.0.people:PERSON_TWICE']);
    expect(people({ count: 1, personIds: [PERSON_A, PERSON_B] })).toEqual([
      'sections.needs.0.people:COUNT_BELOW_NAMES:{"names":2}',
    ]);
    expect(people({ personIds: [] })).toEqual(['sections.needs.0.people:REQUIRED']);
    expect(people({ personIds: [PERSON_B] }, { allowedPersonIds: new Set([PERSON_A]) })).toEqual([
      'sections.needs.0.people:PERSON_NOT_ALLOWED',
    ]);
    expect(people({ count: 5, personIds: [PERSON_A] }, { allowedPersonIds: new Set([PERSON_A]) })).toEqual([]);
    expect(people({ personIds: Array.from({ length: 501 }, (_, i) => `0a000000-0000-4000-8000-${String(i).padStart(12, '0')}`) })).toEqual([
      `sections.needs.0.people:TOO_MANY_PEOPLE:{"max":${String(ANSWER_LIMITS.maxNamedPeople)}}`,
    ]);

    const byMode = (mode: 'count' | 'employees', value: unknown) => {
      const form = testForm();
      const section = form.sections[0];
      if (!section) throw new Error('fixture');
      const sec = {
        ...section,
        fields: section.fields.map((f) => (f.id === 'people' ? { ...f, peopleMode: mode } : f)),
      };
      return validateEntry(sec, { topic: 'x', people: value }, 'e').errors.map((e) => e.code);
    };
    expect(byMode('count', { personIds: [PERSON_A] })).toEqual(['NAMES_NOT_ALLOWED']);
    expect(byMode('employees', { count: 3 })).toEqual(['NAMES_REQUIRED']);
    expect(byMode('employees', { personIds: [PERSON_A] })).toEqual([]);
  });

  it('checks entries, sections and unknown keys', () => {
    expect(errorsOf({ needs: [], extra: [extra] })).toEqual(['sections.needs:TOO_FEW_ENTRIES:{"min":1}']);
    expect(errorsOf({ extra: [extra] })).toEqual(['sections.needs:TOO_FEW_ENTRIES:{"min":1}']);
    expect(errorsOf({ needs: [need(), need(), need(), need()], extra: [extra] })).toEqual([
      'sections.needs:TOO_MANY_ENTRIES:{"max":3}',
    ]);
    expect(errorsOf({ needs: need(), extra: [extra] })).toEqual(['sections.needs:INVALID_ENTRIES']);
    expect(errorsOf({ needs: ['x'], extra: [extra] })).toEqual(['sections.needs.0:INVALID_ENTRY']);
    expect(errorsOf({ needs: [need({ Topic: 'x' })], extra: [extra], other: [] })).toEqual([
      'sections.other:UNKNOWN_SECTION',
      'sections.needs.0.Topic:UNKNOWN_FIELD',
    ]);
    expect(errorsOf(null)).toEqual(['sections:INVALID_ANSWERS']);
    expect(errorsOf([])).toEqual(['sections:INVALID_ANSWERS']);
  });

  it('skips hidden sections and hidden fields with their answers', () => {
    const form = testForm();
    const [needs, extraSection] = form.sections;
    if (!needs || !extraSection) throw new Error('fixture');
    const hidden = {
      ...form,
      sections: [
        { ...needs, fields: needs.fields.map((f) => (f.id === 'level' ? { ...f, visible: false } : f)) },
        { ...extraSection, visible: false },
      ],
    };
    expect(
      validateNeedsAnswers(hidden, { needs: [need({ level: 'advanced', details: 'x' })], extra: [{}] }),
    ).toEqual({ ok: true, value: { needs: [{ topic: 'Excel', people: { count: 4 } }] } });
  });
});
