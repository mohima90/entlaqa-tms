import {
  type ReportSourceRow,
  type SystemTx,
  loadUserImportHeaders,
  loadUserImportReportRows,
} from '@jadarat/platform-db/jobs';
import { fieldDefinition, isImportField } from '../users/fields';
import {
  type ImportIssue,
  type Locale,
  type Phase,
  type Severity,
  parseIssues,
} from '../users/issues';
import { type ReportColumn, ReportBuilder, type ReportOutcome } from '../users/report';

/**
 * The review's list of problems and the error report from the staged rows (T-M2-12, screen 11): the
 * file's imported columns in their order, with the file's headers.
 */
export async function reportColumns(
  tx: SystemTx,
  importId: string,
  sheetIndex: number,
  mapping: Readonly<Record<string, string>>,
  locale: Locale,
): Promise<ReportColumn[]> {
  const headers = await loadUserImportHeaders(tx, importId, sheetIndex);
  return Object.entries(mapping)
    .map(([index, field]) => ({ index: Number(index), field }))
    .filter((entry) => isImportField(entry.field))
    .sort((a, b) => a.index - b.index)
    .map((entry) => {
      const field = entry.field as ReportColumn['field'];
      const header = headers.get(entry.index)?.trim() ?? '';
      return { field, header: header === '' ? fieldDefinition(field).header[locale] : header };
    });
}

const only = (issues: readonly ImportIssue[], ...severities: Severity[]) =>
  issues.filter((issue) => severities.includes(issue.s));

/** The outcome and the reasons a row shows in the report, or null when it does not belong there. */
export function reportLine(
  row: ReportSourceRow,
  phase: Phase,
): { readonly outcome: ReportOutcome; readonly issues: ImportIssue[] } | null {
  if (phase === 'review') {
    const issues = parseIssues(row.issues);
    if (row.kind === 'error') return { outcome: 'will_not_import', issues: only(issues, 'e') };
    if (row.kind === 'skip') return { outcome: 'will_skip', issues: only(issues, 'k') };
    const warnings = only(issues, 'w');
    return warnings.length > 0 ? { outcome: 'will_import_with_warning', issues: warnings } : null;
  }
  const issues = parseIssues(row.resultIssues);
  if (row.result === 'failed' || row.result === 'not_processed') {
    return { outcome: 'not_imported', issues: only(issues, 'e') };
  }
  if (row.result === 'skipped') return { outcome: 'skipped', issues: only(issues, 'k') };
  const warnings = only(issues, 'w');
  if (warnings.length === 0) return null;
  return {
    outcome: row.result === 'updated' ? 'updated_with_warning' : 'added_with_warning',
    issues: warnings,
  };
}

const PAGE = 1000;

export async function buildReport(
  tx: SystemTx,
  importId: string,
  phase: Phase,
  locale: Locale,
  columns: readonly ReportColumn[],
): Promise<{ readonly bytes: Uint8Array<ArrayBuffer>; readonly rows: number }> {
  const builder = new ReportBuilder(locale, columns, phase);
  let after = 0;
  for (;;) {
    const page = await loadUserImportReportRows(tx, importId, phase, after, PAGE);
    for (const row of page) {
      const line = reportLine(row, phase);
      if (line) builder.add({ rowNumber: row.rowNumber, ...line, cells: row.cells });
    }
    if (page.length < PAGE) break;
    after = page.at(-1)?.rowNumber ?? after;
  }
  return { bytes: builder.bytes(), rows: builder.rows };
}
