import { hasVisibleText } from '@jadarat/platform-i18n';
import { z } from 'zod';
import { type ImportField, type NameLanguage, isImportField, requiredFields } from './fields';
import { type ImportIssue, issue } from './issues';
import { isPrivilegedRole, roleForName, splitRoles } from './roles';
import { asciiDigits, cleanText, excerpt, matchKey } from './text';

/**
 * One data row of the file, checked for format (T-M2-12; design README §3 and §6): the same rules as
 * the invite and edit forms. What the organization's data says (duplicates, existing people,
 * departments, managers, loops) is the database's dry run (private.user_import_classify).
 *
 *   cells   the mapped columns' text as read (the error report repeats it) — empty cells left out;
 *   data    the values normalized and accepted: e-mail lower-cased, digits, E.164 mobile, ISO date, role
 *           codes, language; a value with a problem is absent here;
 *   issues  what is wrong (format errors, warnings for optional values left empty, information).
 */
export type ImportMapping = Readonly<Record<string, ImportField>>;

/** A stored mapping with the fields we know only (the database allows nothing else anyway). */
export function toImportMapping(mapping: Readonly<Record<string, string>>): ImportMapping {
  const out: Record<string, ImportField> = {};
  for (const [index, field] of Object.entries(mapping)) {
    if (isImportField(field)) out[index] = field;
  }
  return out;
}

export interface NormalizedRow {
  readonly rowNumber: number;
  readonly cells: Readonly<Partial<Record<ImportField, string>>>;
  readonly data: Readonly<Record<string, unknown>>;
  readonly issues: readonly ImportIssue[];
}

/** Text a cell may hold for any field before it is refused outright (the database stores the cell). */
const CELL_LIMIT = 500;

const emailSchema = z.email();

export function isEmail(value: string): boolean {
  return value.length <= 254 && emailSchema.safeParse(value).success;
}

/** Mobile digits as typed: any script, spaces, dashes, brackets and dots; `00` → `+`. */
export function compactMobile(value: string): string {
  const compact = asciiDigits(value).replace(/[\s\-().]/g, '');
  return compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
}

/** `YYYY-MM-DD` (also with `/`, any digits) when it is a real date from 1900 to 2100; else null. */
export function isoDate(value: string): string | null {
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(asciiDigits(value));
  if (!match) return null;
  const [, y, m, d] = match;
  const iso = `${y ?? ''}-${(m ?? '').padStart(2, '0')}-${(d ?? '').padStart(2, '0')}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) return null;
  return iso >= '1900-01-01' && iso <= '2100-12-31' ? iso : null;
}

const LANGUAGES: ReadonlyMap<string, 'ar' | 'en'> = new Map(
  (
    [
      ['العربية', 'ar'],
      ['عربي', 'ar'],
      ['عربية', 'ar'],
      ['arabic', 'ar'],
      ['ar', 'ar'],
      ['English', 'en'],
      ['الإنجليزية', 'en'],
      ['الانجليزية', 'en'],
      ['إنجليزي', 'en'],
      ['انجليزي', 'en'],
      ['الإنكليزية', 'en'],
      ['en', 'en'],
    ] as const
  ).map(([name, code]) => [matchKey(name), code]),
);

export function languageFor(value: string): 'ar' | 'en' | null {
  return LANGUAGES.get(matchKey(value)) ?? null;
}

/**
 * The names an existing active member has now, by import field (null: not given) — for the update of such a
 * member's row (normalizeRow `stored`).
 */
export type StoredNames = Readonly<Partial<Record<ImportField, string | null>>>;

const NAME_FIELDS = {
  ar: ['first_name_ar', 'father_name_ar', 'grandfather_name_ar', 'family_name_ar'],
  en: ['first_name_en', 'father_name_en', 'grandfather_name_en', 'family_name_en'],
} as const;

/**
 * Checks one data row under the confirmed mapping ({column index: field}); the first and family names of
 * `nameLanguage` (the organization's default language, PO 17 Oct 2026) are required — for an existing
 * member (`stored`) only when the row changes a name.
 */
export function normalizeRow(
  rowNumber: number,
  rowCells: readonly string[],
  mapping: ImportMapping,
  nameLanguage: NameLanguage,
  stored?: StoredNames,
): NormalizedRow {
  const cells: Partial<Record<ImportField, string>> = {};
  const values: Partial<Record<ImportField, string>> = {};
  for (const [index, field] of Object.entries(mapping)) {
    const raw = rowCells[Number(index)] ?? '';
    if (raw.trim() === '') continue;
    // Cut before cleaning: a 32,767-character cell is never worked on whole (security review H1); the
    // cut cell is still reported as too long below.
    const cut = raw.slice(0, CELL_LIMIT);
    cells[field] = cut;
    const value = cleanText(cut);
    if (value !== '' && hasVisibleText(value)) values[field] = value;
  }

  const data: Record<string, unknown> = {};
  const issues: ImportIssue[] = [];
  const tooLong = (field: ImportField) => (cells[field]?.length ?? 0) >= CELL_LIMIT;

  // E-mail: required, the key.
  const email = values.email?.toLowerCase();
  if (email === undefined) issues.push(issue('EMAIL_REQUIRED', 'email'));
  else if (!isEmail(email)) issues.push(issue('EMAIL_INVALID', 'email'));
  else data.email = email;

  // Names: the first and family name of the organization's default language required; the other
  // language's all or nothing (any part given → its first and family name required too, WP-FIX-01 review);
  // each part at most 60, all parts at most 200. An update of an existing member (`stored`: their names
  // now) is checked only when the file changes a name, and then on the record as it will be — an empty
  // cell never clears a value — so people entered before the rule (e.g. Arabic names only in an
  // English-default organization) can still be updated (PO decision 17 Oct 2026).
  const requiredNames = new Set(requiredFields(nameLanguage));
  const allNameFields = [...NAME_FIELDS.ar, ...NAME_FIELDS.en] as readonly ImportField[];
  const storedName = (field: ImportField) => stored?.[field] ?? undefined;
  const changesNames =
    stored === undefined ||
    allNameFields.some(
      (field) => values[field] !== undefined && values[field] !== storedName(field),
    );
  const nameAfter = (field: ImportField) => values[field] ?? storedName(field);
  for (const fields of [NAME_FIELDS.ar, NAME_FIELDS.en] as readonly (readonly ImportField[])[]) {
    let total = 0;
    let parts = 0;
    let valid = true;
    const started = fields.some((field) => nameAfter(field) !== undefined);
    const firstAndFamily = new Set([fields[0], fields[3]]);
    for (const field of fields) {
      const value = values[field];
      if (value === undefined) {
        if (
          changesNames &&
          nameAfter(field) === undefined &&
          (requiredNames.has(field) || (started && firstAndFamily.has(field)))
        ) {
          issues.push(
            issue(field.endsWith('_ar') ? 'NAME_AR_REQUIRED' : 'NAME_EN_REQUIRED', field),
          );
          valid = false;
        }
        continue;
      }
      if (value.length > 60) {
        issues.push(issue('NAME_TOO_LONG', field));
        valid = false;
        continue;
      }
      data[field] = value;
      total += value.length;
      parts += 1;
    }
    if (valid && total + Math.max(0, parts - 1) > 200) {
      issues.push(issue('FULL_NAME_TOO_LONG', fields[0]));
    }
  }

  // Mobile: E.164; without a country code or otherwise wrong, the person is added without it.
  if (values.mobile !== undefined) {
    const compact = compactMobile(values.mobile);
    if (/^\+[1-9][0-9]{6,14}$/.test(compact)) data.mobile = compact;
    else if (/^[0-9]{6,15}$/.test(compact)) {
      issues.push(issue('MOBILE_NO_COUNTRY_CODE', 'mobile', { value: excerpt(values.mobile, 32) }));
    } else {
      issues.push(issue('MOBILE_INVALID', 'mobile', { value: excerpt(values.mobile, 32) }));
    }
  }

  // Employee number: digits in any script, at most 40 characters (unique: the dry run checks).
  if (values.employee_number !== undefined) {
    const number = asciiDigits(values.employee_number);
    if (number.length > 40) issues.push(issue('EMPLOYEE_NUMBER_INVALID', 'employee_number'));
    else data.employee_number = number;
  }

  for (const field of ['job_title_ar', 'job_title_en'] as const) {
    const value = values[field];
    if (value === undefined) continue;
    if (value.length > 150) issues.push(issue('JOB_TITLE_TOO_LONG', field));
    else data[field] = value;
  }

  // Department, branch and cost centre: matched by code or name by the dry run.
  for (const field of ['department', 'branch', 'cost_centre'] as const) {
    const value = values[field];
    if (value === undefined) continue;
    if (value.length > 200 || tooLong(field)) issues.push(issue('TEXT_TOO_LONG', field));
    else data[field] = value;
  }

  if (values.manager_email !== undefined) {
    const manager = values.manager_email.toLowerCase();
    if (isEmail(manager)) data.manager_email = manager;
    else issues.push(issue('MANAGER_EMAIL_INVALID', 'manager_email'));
  }

  if (values.hire_date !== undefined) {
    const date = isoDate(values.hire_date);
    if (date === null) issues.push(issue('HIRE_DATE_INVALID', 'hire_date'));
    else data.hire_date = date;
  }

  // Roles: non-privileged ones only, never the Organization Admin (PO decision 3, BR-IAM-4).
  const roleProblem = (name: string, field: ImportField): string | null => {
    const code = roleForName(name);
    if (code === null) {
      issues.push(issue('ROLE_UNKNOWN', field, { name: excerpt(name) }));
      return null;
    }
    if (code === 'tenant_admin') {
      issues.push(issue('ROLE_ORG_ADMIN', field));
      return null;
    }
    if (isPrivilegedRole(code)) {
      issues.push(issue('ROLE_PRIVILEGED', field, { role: code }));
      return null;
    }
    return code;
  };
  let primary: string | null = null;
  if (values.primary_role !== undefined) {
    data.roles_given = true;
    primary = roleProblem(values.primary_role, 'primary_role');
    if (primary !== null) data.primary_role = primary;
  }
  if (values.additional_roles !== undefined) {
    data.roles_given = true;
    const codes: string[] = [];
    for (const name of splitRoles(values.additional_roles).slice(0, 20)) {
      const code = roleProblem(name, 'additional_roles');
      if (code === null) continue;
      if (code === primary || codes.includes(code)) {
        issues.push(issue('ROLE_REPEATED', 'additional_roles', { name: excerpt(name) }));
        continue;
      }
      codes.push(code);
    }
    // One role per person (EP-ROLES, PO 17 Oct 2026): additional roles are checked (never a privileged
    // one) but not given; the review says so.
    if (codes.length > 0) issues.push(issue('ROLES_ONE_PER_PERSON', 'additional_roles'));
  }

  if (values.language !== undefined) {
    const language = languageFor(values.language);
    if (language === null) {
      issues.push(issue('LANGUAGE_UNKNOWN', 'language', { value: excerpt(values.language, 30) }));
    } else {
      data.language = language;
    }
  }

  return { rowNumber, cells, data, issues };
}
