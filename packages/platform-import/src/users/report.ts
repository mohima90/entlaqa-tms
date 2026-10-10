import { CSV_BOM, csvLine } from '../spreadsheet/csv';
import type { ImportField } from './fields';
import { type ImportIssue, type Locale, type Phase, issueMessage } from './issues';

/**
 * The error report and the review's list of problems (T-M2-12; approved screen 11, PO decision 9): CSV,
 * UTF-8 with BOM, five columns of ours first — row in the file, outcome, the reason in Arabic and in
 * English, the reason code — then the file's own imported columns with their headers and the values as
 * they were read, so the report itself can be corrected and uploaded again (our five columns are then
 * recognized and ignored). Only what the file contained, minus the columns that are not imported. Every
 * cell that a spreadsheet could run as a formula is written as text (TM-0003 T-IAM-19).
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

/** Builds the CSV row by row (a few megabytes at most: 10,000 rows). */
export class ReportBuilder {
  private readonly lines: string[] = [];
  private count = 0;

  constructor(
    private readonly locale: Locale,
    private readonly columns: readonly ReportColumn[],
    private readonly phase: Phase,
  ) {
    this.lines.push(CSV_BOM + csvLine([...HEADERS[locale], ...columns.map((c) => c.header)]));
  }

  add(row: ReportRow): void {
    const issues = row.issues.length > 0 ? row.issues : [];
    const message = (locale: Locale) =>
      issues.map((issue) => issueMessage(issue, locale, this.phase)).join(' · ');
    this.lines.push(
      csvLine([
        String(row.rowNumber),
        OUTCOMES[row.outcome][this.locale],
        message('ar'),
        message('en'),
        issues.map((issue) => issue.c).join(' '),
        ...this.columns.map((column) => row.cells[column.field] ?? ''),
      ]),
    );
    this.count += 1;
  }

  get rows(): number {
    return this.count;
  }

  bytes(): Uint8Array<ArrayBuffer> {
    return new TextEncoder().encode(this.lines.join(''));
  }
}

/** The report's file name: «تقرير-الأخطاء-<file name without extension>.csv». */
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
  return `${prefix}-${base}.csv`;
}
