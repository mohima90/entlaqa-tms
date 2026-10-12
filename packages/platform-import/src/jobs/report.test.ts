import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportColumns, reportLine } from './report';

const db = vi.hoisted(() => ({
  loadUserImportHeaders: vi.fn(),
  loadUserImportReportRows: vi.fn(),
}));
vi.mock('@jadarat/platform-db/jobs', () => db);

const row = (fields: Record<string, unknown>) => ({
  rowNumber: 2,
  cells: {},
  kind: null,
  result: null,
  issues: [],
  resultIssues: [],
  ...fields,
});
const e = { c: 'EMAIL_INVALID', s: 'e' };
const w = { c: 'DEPARTMENT_NOT_FOUND', s: 'w' };
const k = { c: 'OWN_ROW', s: 'k' };

afterEach(() => {
  vi.clearAllMocks();
});

describe('report lines', () => {
  it('review: errors, skipped rows and rows with warnings, each with its own reasons', () => {
    expect(reportLine(row({ kind: 'error', issues: [e, w] }), 'review')).toEqual({
      outcome: 'will_not_import',
      issues: [e],
    });
    expect(reportLine(row({ kind: 'skip', issues: [k, w] }), 'review')).toEqual({
      outcome: 'will_skip',
      issues: [k],
    });
    expect(reportLine(row({ kind: 'new', issues: [w] }), 'review')).toEqual({
      outcome: 'will_import_with_warning',
      issues: [w],
    });
    expect(
      reportLine(row({ kind: 'existing', issues: [{ c: 'ROLE_REPEATED', s: 'i' }] }), 'review'),
    ).toBeNull();
  });

  it('result: not imported, skipped, added or updated with warnings', () => {
    expect(reportLine(row({ result: 'failed', resultIssues: [e] }), 'result')?.outcome).toBe(
      'not_imported',
    );
    expect(
      reportLine(
        row({ result: 'not_processed', resultIssues: [{ c: 'NOT_PROCESSED', s: 'e' }] }),
        'result',
      )?.outcome,
    ).toBe('not_imported');
    expect(reportLine(row({ result: 'skipped', resultIssues: [k, w] }), 'result')).toEqual({
      outcome: 'skipped',
      issues: [k],
    });
    expect(reportLine(row({ result: 'added', resultIssues: [w] }), 'result')?.outcome).toBe(
      'added_with_warning',
    );
    expect(reportLine(row({ result: 'updated', resultIssues: [w] }), 'result')?.outcome).toBe(
      'updated_with_warning',
    );
    expect(reportLine(row({ result: 'added', resultIssues: [] }), 'result')).toBeNull();
  });

  it('columns: the mapped ones in file order with the file’s headers (or ours when blank)', async () => {
    db.loadUserImportHeaders.mockResolvedValue(
      new Map([
        [0, 'Email'],
        [3, '  '],
      ]),
    );
    expect(
      await reportColumns(
        {} as never,
        'i1',
        0,
        { '3': 'family_name_ar', '0': 'email', '5': 'nonsense' },
        'en',
      ),
    ).toEqual([
      { field: 'email', header: 'Email' },
      { field: 'family_name_ar', header: 'Family name (Arabic)' },
    ]);
  });
});
