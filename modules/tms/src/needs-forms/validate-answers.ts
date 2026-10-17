import {
  type AppError,
  type FieldError,
  type Result,
  appError,
  err,
  ok,
} from '@jadarat/platform-core';
import { type Entry, isFieldShown } from './conditions';
import type { NeedsFormDefinition, NeedsFormField, NeedsFormSection } from './model';

/**
 * Server-side validation of needs-form answers against the form (T-M3-10 fix (a) over Kawadir, which
 * validated in the browser only). Pure: the Department Head's needs page (T-M3-05) calls it in its action
 * with the cycle's form before storing anything.
 *
 * Answers are keyed by section id, then by FIELD id (fix (d)): `{ [sectionId]: [{ [fieldId]: answer }, …] }`
 * — one entry per repetition (a section that does not repeat has exactly one). The result keeps only what
 * is shown (hidden sections and fields, and fields whose condition is not met, are dropped with their
 * answers), with normalized values (trimmed text, numbers, `{ count, personIds }` for people); every
 * problem is a field error `sections.<sectionId>.<entry>.<fieldId>` with a code (no answer values in it).
 *
 * Answer types: text/textarea/email/phone/url/date — string (date `YYYY-MM-DD`); number — number (or a
 * numeric string); select/radio — an option value; multiselect — option values; checkbox — boolean (a
 * required checkbox must be ticked); file — the id of a stored file (platform-files: the needs page checks
 * it belongs to the caller); people — `{ count?, personIds? }` as the field's mode allows.
 */
export type NeedsAnswers = Readonly<Record<string, unknown>>;
export type CleanAnswers = Record<string, Record<string, unknown>[]>;

export interface ValidationContext {
  /**
   * People the answering Department Head may name (their team, from the platform people service; lower-case
   * ids). Deny by default (security review S-L2): WITHOUT it nobody can be named — a people field that allows
   * names refuses every named employee (PERSON_NOT_ALLOWED). The needs page always passes it.
   */
  readonly allowedPersonIds?: ReadonlySet<string>;
}

/**
 * Every error code the validator returns (field errors `fieldErrors[].code`). Each has a message under
 * `needsForms.fieldErrors.<code>` in English and Arabic (unit test), so the renderer never shows a raw code.
 */
export const ANSWER_ERROR_CODES = [
  'REQUIRED',
  'INVALID_TYPE',
  'TOO_LONG',
  'INVALID_DATE',
  'INVALID_URL',
  'INVALID_NUMBER',
  'INVALID_EMAIL',
  'INVALID_PHONE',
  'NOT_AN_OPTION',
  'OPTION_TWICE',
  'INVALID_FILE',
  'NAMES_NOT_ALLOWED',
  'NAMES_REQUIRED',
  'INVALID_PERSON',
  'PERSON_TWICE',
  'PERSON_NOT_ALLOWED',
  'TOO_MANY_PEOPLE',
  'INVALID_COUNT',
  'COUNT_BELOW_NAMES',
  'INVALID_ENTRY',
  'UNKNOWN_FIELD',
  'INVALID_ANSWERS',
  'UNKNOWN_SECTION',
  'INVALID_ENTRIES',
  'TOO_FEW_ENTRIES',
  'TOO_MANY_ENTRIES',
  'TOO_MANY_ERRORS',
] as const;
export type AnswerErrorCode = (typeof ANSWER_ERROR_CODES)[number];

/**
 * Bounds on what a refusal sends back (S-L2): at most MAX_FIELD_ERRORS field errors (the last one then says
 * TOO_MANY_ERRORS), at most MAX_UNKNOWN_KEYS unknown keys reported per object, each key cut to
 * MAX_ECHOED_KEY characters — a client cannot make the server echo arbitrary amounts of its own input.
 */
export const ERROR_LIMITS = { maxFieldErrors: 50, maxUnknownKeys: 10, maxEchoedKey: 64 } as const;

export const ANSWER_LIMITS = {
  text: 500,
  textarea: 5000,
  email: 254,
  url: 2000,
  maxAbsNumber: 1_000_000_000_000,
  maxPeople: 100_000,
  maxNamedPeople: 500,
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9][0-9 ()-]{4,22}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

type Check = { readonly ok: true; readonly value: unknown } | FieldProblem;
interface FieldProblem {
  readonly ok: false;
  readonly code: AnswerErrorCode;
  readonly params?: Readonly<Record<string, string | number>>;
}

const problem = (
  code: AnswerErrorCode,
  params?: Readonly<Record<string, string | number>>,
): FieldProblem => (params ? { ok: false, code, params } : { ok: false, code });
const valid = (value: unknown): Check => ({ ok: true, value });

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkText(value: unknown, max: number): Check {
  if (typeof value !== 'string') return problem('INVALID_TYPE');
  const text = value.trim();
  return text.length > max ? problem('TOO_LONG', { max }) : valid(text);
}

function checkDate(value: unknown): Check {
  if (typeof value !== 'string') return problem('INVALID_TYPE');
  const m = DATE_RE.exec(value.trim());
  if (!m) return problem('INVALID_DATE');
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? valid(value.trim())
    : problem('INVALID_DATE');
}

function checkUrl(value: unknown): Check {
  const text = checkText(value, ANSWER_LIMITS.url);
  if (!text.ok) return text;
  try {
    const url = new URL(text.value as string);
    return url.protocol === 'https:' || url.protocol === 'http:' ? text : problem('INVALID_URL');
  } catch {
    return problem('INVALID_URL');
  }
}

function checkPeople(field: NeedsFormField, value: unknown, context: ValidationContext): Check {
  if (!isPlainObject(value)) return problem('INVALID_TYPE');
  const keys = Object.keys(value);
  if (keys.some((k) => k !== 'count' && k !== 'personIds')) return problem('INVALID_TYPE');
  const mode = field.peopleMode ?? 'count_or_employees';
  const { count, personIds } = value;
  let ids: string[] | undefined;
  if (personIds !== undefined) {
    if (mode === 'count') return problem('NAMES_NOT_ALLOWED');
    if (
      !Array.isArray(personIds) ||
      personIds.some((id) => typeof id !== 'string' || !UUID_RE.test(id))
    ) {
      return problem('INVALID_PERSON');
    }
    ids = (personIds as string[]).map((id) => id.toLowerCase());
    if (new Set(ids).size !== ids.length) return problem('PERSON_TWICE');
    if (ids.length > ANSWER_LIMITS.maxNamedPeople) {
      return problem('TOO_MANY_PEOPLE', { max: ANSWER_LIMITS.maxNamedPeople });
    }
    // Deny by default: without the answering head's team, nobody can be named (S-L2).
    const allowed = context.allowedPersonIds;
    if (ids.length > 0 && (!allowed || ids.some((id) => !allowed.has(id)))) {
      return problem('PERSON_NOT_ALLOWED');
    }
    if (ids.length === 0) ids = undefined;
  }
  if (count !== undefined && count !== null) {
    if (mode === 'employees') return problem('NAMES_REQUIRED');
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1)
      return problem('INVALID_COUNT');
    if (count > ANSWER_LIMITS.maxPeople)
      return problem('TOO_MANY_PEOPLE', { max: ANSWER_LIMITS.maxPeople });
    if (ids && count < ids.length) return problem('COUNT_BELOW_NAMES', { names: ids.length });
    return valid(ids ? { count, personIds: ids } : { count });
  }
  if (!ids) return problem('REQUIRED');
  return valid({ count: ids.length, personIds: ids });
}

/** One answer against its field (the answer is not empty). */
function checkAnswer(field: NeedsFormField, value: unknown, context: ValidationContext): Check {
  switch (field.type) {
    case 'text':
      return checkText(value, ANSWER_LIMITS.text);
    case 'textarea':
      return checkText(value, ANSWER_LIMITS.textarea);
    case 'number': {
      const n =
        typeof value === 'string' && NUMERIC_RE.test(value.trim()) ? Number(value.trim()) : value;
      if (typeof n !== 'number' || !Number.isFinite(n)) return problem('INVALID_NUMBER');
      return Math.abs(n) > ANSWER_LIMITS.maxAbsNumber ? problem('INVALID_NUMBER') : valid(n);
    }
    case 'date':
      return checkDate(value);
    case 'email': {
      const text = checkText(value, ANSWER_LIMITS.email);
      return text.ok && !EMAIL_RE.test(text.value as string) ? problem('INVALID_EMAIL') : text;
    }
    case 'phone': {
      const text = checkText(value, 30);
      if (!text.ok) return text;
      const digits = (text.value as string).replace(/\D/g, '').length;
      return PHONE_RE.test(text.value as string) && digits >= 6 && digits <= 15
        ? text
        : problem('INVALID_PHONE');
    }
    case 'url':
      return checkUrl(value);
    case 'select':
    case 'radio':
      return typeof value === 'string' && field.options.some((o) => o.value === value)
        ? valid(value)
        : problem('NOT_AN_OPTION');
    case 'multiselect': {
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string'))
        return problem('INVALID_TYPE');
      const values = value as string[];
      if (new Set(values).size !== values.length) return problem('OPTION_TWICE');
      return values.every((v) => field.options.some((o) => o.value === v))
        ? valid(values)
        : problem('NOT_AN_OPTION');
    }
    case 'checkbox':
      if (typeof value !== 'boolean') return problem('INVALID_TYPE');
      return field.required && !value ? problem('REQUIRED') : valid(value);
    case 'file':
      return typeof value === 'string' && UUID_RE.test(value)
        ? valid(value.toLowerCase())
        : problem('INVALID_FILE');
    case 'people':
      return checkPeople(field, value, context);
  }
}

/** Unknown keys of a client object, reported bounded: a few, each cut short (never the whole input back). */
function unknownKeyErrors(
  keys: readonly string[],
  known: readonly { readonly id: string }[],
  path: string,
  code: 'UNKNOWN_FIELD' | 'UNKNOWN_SECTION',
): FieldError[] {
  const ids = new Set(known.map((k) => k.id));
  return keys
    .filter((key) => !ids.has(key))
    .slice(0, ERROR_LIMITS.maxUnknownKeys)
    .map((key) => ({ path: `${path}.${key.slice(0, ERROR_LIMITS.maxEchoedKey)}`, code }));
}

/** At most ERROR_LIMITS.maxFieldErrors field errors; the last one says there were more. */
function capErrors(errors: readonly FieldError[]): FieldError[] {
  if (errors.length <= ERROR_LIMITS.maxFieldErrors) return [...errors];
  return [
    ...errors.slice(0, ERROR_LIMITS.maxFieldErrors - 1),
    { path: 'sections', code: 'TOO_MANY_ERRORS' },
  ];
}

/**
 * Checks one entry of a section; `path` prefixes the field errors (e.g. `sections.<id>.0`). Returns the
 * entry with only the shown fields' normalized answers.
 */
export function validateEntry(
  section: NeedsFormSection,
  entry: unknown,
  path: string,
  context: ValidationContext = {},
): { readonly value: Record<string, unknown>; readonly errors: FieldError[] } {
  const errors: FieldError[] = [];
  const value: Record<string, unknown> = {};
  if (!isPlainObject(entry)) {
    return { value, errors: [{ path, code: 'INVALID_ENTRY' }] };
  }
  errors.push(...unknownKeyErrors(Object.keys(entry), section.fields, path, 'UNKNOWN_FIELD'));
  const answers: Entry = entry;
  for (const field of section.fields) {
    if (!isFieldShown(field, section.fields, answers)) continue;
    const answer = answers[field.id];
    if (isEmpty(answer)) {
      if (field.required) errors.push({ path: `${path}.${field.id}`, code: 'REQUIRED' });
      continue;
    }
    const result = checkAnswer(field, answer, context);
    if (result.ok) value[field.id] = result.value;
    else {
      errors.push({
        path: `${path}.${field.id}`,
        code: result.code,
        ...(result.params ? { params: result.params } : {}),
      });
    }
  }
  return { value, errors };
}

/**
 * Checks a whole answer set against the form. VALIDATION_FAILED with every field error, or the cleaned
 * answers (shown sections only).
 */
export function validateNeedsAnswers(
  form: Pick<NeedsFormDefinition, 'sections'>,
  answers: unknown,
  context: ValidationContext = {},
): Result<CleanAnswers, AppError> {
  const errors: FieldError[] = [];
  const clean: CleanAnswers = {};
  if (!isPlainObject(answers)) {
    return err(
      appError('VALIDATION_FAILED', {
        fieldErrors: [{ path: 'sections', code: 'INVALID_ANSWERS' }],
      }),
    );
  }
  errors.push(
    ...unknownKeyErrors(Object.keys(answers), form.sections, 'sections', 'UNKNOWN_SECTION'),
  );
  for (const section of form.sections) {
    if (!section.visible) continue;
    const path = `sections.${section.id}`;
    const raw = answers[section.id];
    // A section that does not repeat answers as one entry; missing = one empty entry (required fields say so).
    const entries: unknown = raw === undefined && !section.repeatable ? [{}] : (raw ?? []);
    if (!Array.isArray(entries)) {
      errors.push({ path, code: 'INVALID_ENTRIES' });
      continue;
    }
    const list = entries as unknown[];
    if (list.length < section.minEntries) {
      errors.push({ path, code: 'TOO_FEW_ENTRIES', params: { min: section.minEntries } });
    }
    if (list.length > section.maxEntries) {
      errors.push({ path, code: 'TOO_MANY_ENTRIES', params: { max: section.maxEntries } });
      continue;
    }
    clean[section.id] = list.map((entry, index) => {
      const checked = validateEntry(section, entry, `${path}.${String(index)}`, context);
      errors.push(...checked.errors);
      return checked.value;
    });
  }
  return errors.length > 0
    ? err(appError('VALIDATION_FAILED', { fieldErrors: capErrors(errors) }))
    : ok(clean);
}
