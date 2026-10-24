import 'server-only';

/**
 * Bulk user import (T-M2-12, FR-IAM-04; approved screens docs/design/screens/m2-user-import/;
 * docs/engineering/user-import.md). Request path: the actions and queries the app binds with
 * defineAction / defineQuery, the template, the column recognition and the messages. Worker: ./jobs.
 */
export * from './actions';
export * from './units/actions';
export {
  UNIT_COLUMNS,
  UNIT_IMPORT_MAX_BYTES,
  UNIT_IMPORT_MAX_ROWS,
  type UnitRowIssue,
  type UnitRowResult,
  checkUnitRows,
  readUnitFile,
  unitTemplateFileName,
  unitTemplateXlsx,
} from './units/units';
export {
  CSV_TYPE,
  XLSX_TYPE,
  type SheetRow,
  SpreadsheetError,
  type SpreadsheetErrorCode,
  kindOfType,
} from './spreadsheet/index';
export {
  FIELD_DEFINITIONS,
  type FieldDefinition,
  type FieldGroup,
  IMPORT_FIELDS,
  type ImportField,
  NEVER_IMPORTED,
  type NameLanguage,
  type NeverImportedReason,
  fieldDefinition,
  fieldDefinitionsFor,
  isImportField,
  requiredFields,
} from './users/fields';
export {
  type ColumnInput,
  type ColumnRecognition,
  type MappingProblem,
  fieldForHeader,
  mappingProblems,
  neverImportedReason,
  proposedMapping,
  recognizeColumns,
} from './users/headers';
export {
  ISSUES,
  ISSUE_CODES,
  type ImportIssue,
  type Locale,
  type Phase,
  type Severity,
  issueMessage,
  parseIssues,
  severityOf,
} from './users/issues';
export { IMPORTABLE_ROLES, isPrivilegedRole, roleForName, roleName } from './users/roles';
export {
  type TemplateLists,
  type TemplateLocale,
  type TemplateUnit,
  csvTemplate,
  templateFileName,
  templateHeaders,
  xlsxTemplate,
} from './users/template';
export { MAX_IMPORT_FILE_BYTES, MAX_IMPORT_ROWS } from './users/limits';
