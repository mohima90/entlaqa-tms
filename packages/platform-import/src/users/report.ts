import { type WriterColumn, writeXlsx } from '../spreadsheet/xlsx-writer';
import type { ImportField } from './fields';
import { type ImportIssue, type Locale, type Phase, issueMessage } from './issues';

/**
 * The error report and the review's list of problems (T-M2-12; approved screen 11, PO decision 9): an
 * XLSX workbook of one sheet, five columns of ours first — row in the file, outcome, the reason in Arabic
 * and in English, the reason code — then the file's own imported columns with their headers and the
 * values as they were read, so the report itself can be corrected and uploaded again (our five columns
 * are then recognized and ignored). Only what the file contained, minus the columns that are not
 * imported. Every cell is an inline string in a text-formatted column (security review L2, TM-0003
 * T-IAM-19): a value such as `=HYPERLINK(…)` is shown and kept exactly, and no spreadsheet ever runs it
 * as a formula — unlike CSV, where it had to carry a leading quote.
 */
export type ReportOutcome =
  | 'not_imported'
  | 'skipped'
  | 'added_with_warning'
  | 'updated_with_warning'
  | 'will_not_import'
  | 'will_skip'
  | 'will_import_with_warning';

const OUTCOMES: Readonly<Record<ReportOutcome, { readonly ar: string; readonly en: string }>> = {
  not_imported: { ar: 'لم يُستورد', en: 'Not imported' },
  skipped: { ar: 'تُخطّي', en: 'Skipped' },
  added_with_warning: { ar: 'أُضيف مع تنبيه', en: 'Added with a warning' },
  updated_with_warning: { ar: 'حُدِّث مع تنبيه', en: 'Updated with a warning' },
  will_not_import: { ar: 'لا يُستورد', en: 'Won’t be imported' },
  will_skip: { ar: 'يُتخطى', en: 'Will be skipped' },
  will_import_with_warning: { ar: 'يُستورد مع تنبيه', en: 'Imported with a warning' },
};

const HEADERS: Readonly<Record<Locale, readonly string[]>> = {
  ar: ['الصف في الملف', 'النتيجة', 'السبب', 'Reason', 'رمز السبب'],
  en: ['Row in file', 'Result', 'السبب', 'Reason', 'Reason code'],
};

export interface ReportColumn {
  readonly field: ImportField;
  /** The column's header in the uploaded file. */
  readonly header: string;
}

export interface ReportRow {
  readonly rowNumber: number;
  readonly outcome: ReportOutcome;
  readonly issues: readonly ImportIssue[];
  readonly cells: Readonly<Partial<Record<string, string>>>;
}

/** The reports' type: XLSX (security review L2). */
export const REPORT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const SHEET_NAMES: Readonly<Record<Phase, Readonly<Record<Locale, string>>>> = {
  review: { ar: 'قائمة المشكلات', en: 'Problems' },
  result: { ar: 'تقرير الأخطاء', en: 'Error report' },
};

/** Collects the rows (10,000 at most), then writes the workbook. */
export class ReportBuilder {
  private readonly lines: string[][] = [];
  private count = 0;

  constructor(
    private readonly locale: Locale,
    private readonly columns: readonly ReportColumn[],
    private readonly phase: Phase,
  ) {
    this.lines.push([...HEADERS[locale], ...columns.map((c) => c.header)]);
  }

  add(row: ReportRow): void {
    const issues = row.issues.length > 0 ? row.issues : [];
    const message = (locale: Locale) =>
      issues.map((issue) => issueMessage(issue, locale, this.phase)).join(' · ');
    this.lines.push([
      String(row.rowNumber),
      OUTCOMES[row.outcome][this.locale],
      message('ar'),
      message('en'),
      issues.map((issue) => issue.c).join(' '),
      ...this.columns.map((column) => row.cells[column.field] ?? ''),
    ]);
    this.count += 1;
  }

  get rows(): number {
    return this.count;
  }

  bytes(): Uint8Array<ArrayBuffer> {
    const ours: WriterColumn[] = [
      { width: 12, format: 'text' },
      { width: 22, format: 'text' },
      { width: 48, format: 'wrap' },
      { width: 48, format: 'wrap' },
      { width: 28, format: 'text' },
    ];
    return writeXlsx([
      {
        name: SHEET_NAMES[this.phase][this.locale],
        rightToLeft: this.locale === 'ar',
        columns: [...ours, ...this.columns.map(() => ({ width: 24, format: 'text' as const }))],
        rows: this.lines,
        freezeHeader: true,
      },
    ]);
  }
}

/** The report's file name: «تقرير-الأخطاء-<file name without extension>.xlsx». */
export function reportFileName(fileName: string, locale: Locale, phase: Phase): string {
  const dot = fileName.lastIndexOf('.');
  const base = (dot > 0 ? fileName.slice(0, dot) : fileName).slice(0, 120);
  const prefix =
    phase === 'review'
      ? locale === 'ar'
        ? 'قائمة-المشكلات'
        : 'problems'
      : locale === 'ar'
        ? 'تقرير-الأخطاء'
        : 'error-report';
  return `${prefix}-${base}.xlsx`;
}
