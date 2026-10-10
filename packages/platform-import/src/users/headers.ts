import { z } from 'zod';
import {
  FIELD_DEFINITIONS,
  type ImportField,
  NEVER_IMPORTED,
  type NeverImportedReason,
  REQUIRED_FIELDS,
  isImportField,
} from './fields';
import { asciiDigits, cleanText, matchKey } from './text';

/**
 * Column recognition for the mapping step (T-M2-12, approved screen 5): known Arabic and English headers
 * and common synonyms, ignoring letter case, spaces, punctuation, diacritics and Arabic letter variants;
 * an unknown header whose sample values clearly are e-mails, dates or phone numbers gets a suggestion
 * the importer must confirm. Two columns never map to the same field (the first one keeps it).
 */
const FIELD_BY_KEY = new Map<string, ImportField>();
for (const definition of FIELD_DEFINITIONS) {
  for (const header of [definition.header.ar, definition.header.en, ...definition.synonyms]) {
    const key = matchKey(header);
    const known = FIELD_BY_KEY.get(key);
    if (known !== undefined && known !== definition.field) {
      throw new Error(`header "${header}" names two fields`);
    }
    FIELD_BY_KEY.set(key, definition.field);
  }
}

const NEVER_BY_KEY = new Map<string, NeverImportedReason>();
for (const [reason, headers] of Object.entries(NEVER_IMPORTED) as [
  NeverImportedReason,
  readonly string[],
][]) {
  for (const header of headers) {
    const key = matchKey(header);
    if (FIELD_BY_KEY.has(key)) throw new Error(`header "${header}" is both imported and not`);
    NEVER_BY_KEY.set(key, reason);
  }
}

/** The field a header names, or null. */
export function fieldForHeader(header: string): ImportField | null {
  return FIELD_BY_KEY.get(matchKey(header)) ?? null;
}

/** Why a header's column is never imported, or null. */
export function neverImportedReason(header: string): NeverImportedReason | null {
  return NEVER_BY_KEY.get(matchKey(header)) ?? null;
}

export type ColumnRecognition =
  | { readonly kind: 'recognized'; readonly field: ImportField }
  | {
      readonly kind: 'suggested';
      readonly field: ImportField;
      readonly because: 'emails' | 'dates' | 'phones';
    }
  | { readonly kind: 'never'; readonly reason: NeverImportedReason }
  | { readonly kind: 'unknown' };

export interface ColumnInput {
  readonly index: number;
  readonly header: string;
  readonly samples: readonly string[];
}

const looksLikeEmail = (value: string) =>
  z.email().safeParse(cleanText(value).toLowerCase()).success;
const looksLikeDate = (value: string) =>
  /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$|^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(asciiDigits(cleanText(value)));
const looksLikePhone = (value: string) => {
  const compact = asciiDigits(cleanText(value)).replace(/[\s\-().]/g, '');
  return /^(\+|00)?[0-9]{8,15}$/.test(compact);
};

/** All samples (at least two) are of the kind. */
function allSamples(samples: readonly string[], test: (value: string) => boolean): boolean {
  return samples.length >= 2 && samples.every(test);
}

/**
 * Recognizes every column of a sheet: headers first (in column order; a field already taken leaves the
 * later column unknown), then suggestions by values for the fields still free.
 */
export function recognizeColumns(columns: readonly ColumnInput[]): ColumnRecognition[] {
  const taken = new Set<ImportField>();
  const result: ColumnRecognition[] = columns.map((column) => {
    const reason = neverImportedReason(column.header);
    if (reason !== null) return { kind: 'never', reason };
    const field = fieldForHeader(column.header);
    if (field === null || taken.has(field)) return { kind: 'unknown' };
    taken.add(field);
    return { kind: 'recognized', field };
  });
  columns.forEach((column, i) => {
    if (result[i]?.kind !== 'unknown') return;
    let suggestion: ColumnRecognition | null = null;
    if (allSamples(column.samples, looksLikeEmail)) {
      const field: ImportField = taken.has('email') ? 'manager_email' : 'email';
      if (!taken.has(field)) suggestion = { kind: 'suggested', field, because: 'emails' };
    } else if (allSamples(column.samples, looksLikeDate)) {
      if (!taken.has('hire_date'))
        suggestion = { kind: 'suggested', field: 'hire_date', because: 'dates' };
    } else if (allSamples(column.samples, looksLikePhone)) {
      if (!taken.has('mobile'))
        suggestion = { kind: 'suggested', field: 'mobile', because: 'phones' };
    }
    if (suggestion?.kind === 'suggested') {
      taken.add(suggestion.field);
      result[i] = suggestion;
    }
  });
  return result;
}

/** The mapping the recognition proposes (recognized columns only: suggestions need a confirmation). */
export function proposedMapping(
  recognitions: readonly ColumnRecognition[],
): Record<string, ImportField> {
  const mapping: Record<string, ImportField> = {};
  recognitions.forEach((recognition, index) => {
    if (recognition.kind === 'recognized') mapping[String(index)] = recognition.field;
  });
  return mapping;
}

export type MappingProblem =
  | { readonly kind: 'missing'; readonly field: ImportField }
  | { readonly kind: 'twice'; readonly field: ImportField }
  | { readonly kind: 'not_importable'; readonly column: number }
  | { readonly kind: 'no_column'; readonly column: number };

/**
 * Checks a chosen mapping ({column index: field}) against the sheet's columns: every field known, at
 * most once, the required ones present, never a column that is not imported. Empty: valid.
 */
export function mappingProblems(
  mapping: Readonly<Record<string, string>>,
  columns: readonly ColumnInput[],
): MappingProblem[] {
  const problems: MappingProblem[] = [];
  const seen = new Set<string>();
  for (const [key, field] of Object.entries(mapping)) {
    const index = Number(key);
    const column = columns.find((c) => c.index === index);
    if (!/^(0|[1-9][0-9]{0,2})$/.test(key) || column === undefined) {
      problems.push({ kind: 'no_column', column: index });
      continue;
    }
    if (neverImportedReason(column.header) !== null || !isImportField(field)) {
      problems.push({ kind: 'not_importable', column: index });
      continue;
    }
    if (seen.has(field)) problems.push({ kind: 'twice', field });
    seen.add(field);
  }
  for (const field of REQUIRED_FIELDS) {
    if (!seen.has(field)) problems.push({ kind: 'missing', field });
  }
  return problems;
}
