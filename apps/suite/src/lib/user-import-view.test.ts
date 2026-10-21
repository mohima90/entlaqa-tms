import { ISSUE_CODES, NEVER_IMPORTED, IMPORT_FIELDS } from '@jadarat/platform-import';
import ar from '@jadarat/platform-i18n/messages/ar.json';
import en from '@jadarat/platform-i18n/messages/en.json';
import { describe, expect, it } from 'vitest';
import {
  attachmentDisposition,
  codeCounts,
  count,
  draftStep,
  isDraft,
  isRunning,
  isolate,
  largestSheet,
  mayUndo,
  megabytes,
  optionsFromParams,
  optionsQuery,
  refreshSeconds,
  runningPhase,
  undoDeadline,
  undoSummary,
} from './user-import-view';

describe('user import view', () => {
  it('shows the step of a draft import (and the one asked for during the review)', () => {
    expect(draftStep('uploaded', 'confirm')).toBe('file');
    expect(draftStep('rejected', undefined)).toBe('file');
    expect(draftStep('mapping', 'options')).toBe('mapping');
    expect(draftStep('validating', 'confirm')).toBe('review');
    expect(draftStep('review', undefined)).toBe('review');
    expect(draftStep('review', 'mapping')).toBe('mapping');
    // Redesign package 3: the options are part of the confirmation (older links still work).
    expect(draftStep('review', 'options')).toBe('confirm');
    expect(draftStep('review', 'confirm')).toBe('confirm');
    expect(draftStep('review', 'other')).toBe('review');
    expect(isDraft('review')).toBe(true);
    expect(isDraft('queued')).toBe(false);
    expect(isRunning('inviting')).toBe(true);
    expect(isRunning('undoing')).toBe(false);
  });

  it('refreshes while the worker works', () => {
    expect(refreshSeconds('uploaded')).toBe(2);
    expect(refreshSeconds('validating')).toBe(2);
    expect(refreshSeconds('importing')).toBe(3);
    expect(refreshSeconds('undoing')).toBe(3);
    expect(refreshSeconds('review')).toBeNull();
    expect(refreshSeconds('finished')).toBeNull();
    // A cut upload waits for nobody (integration review L1); a scanned file is waited for.
    expect(refreshSeconds('uploaded', 'pending_upload')).toBeNull();
    expect(refreshSeconds('uploaded', 'scanning')).toBe(2);
    expect(runningPhase('queued')).toBe('checking');
    expect(runningPhase('importing')).toBe('importing');
    expect(runningPhase('inviting')).toBe('inviting');
  });

  it('reads the options of step 4 from the URL, never a privileged default role', () => {
    const good = { existing: 'upsert', defaultRole: 'learner', invitations: 'hold' } as const;
    expect(optionsFromParams(good)).toEqual(good);
    expect(optionsFromParams({ ...good, existing: ['skip', 'upsert'] })).toEqual({
      ...good,
      existing: 'skip',
    });
    expect(optionsFromParams({ ...good, defaultRole: 'hr_manager' })).toBeNull();
    expect(optionsFromParams({ ...good, defaultRole: 'tenant_admin' })).toBeNull();
    expect(optionsFromParams({ ...good, existing: 'all' })).toBeNull();
    expect(optionsFromParams({ ...good, invitations: undefined })).toBeNull();
    expect(optionsFromParams({ existing: 'skip', invitations: 'send' })).toBeNull();
    expect(optionsQuery(good)).toBe('existing=upsert&defaultRole=learner&invitations=hold');
  });

  it('reads counts and codes from the JSON counts', () => {
    const counts = {
      total: 5,
      bad: 'x',
      errorCodes: { EMAIL_INVALID: 2, ROLE_UNKNOWN: 3, x: 1, ZERO: 0 },
    };
    expect(count(counts, 'total')).toBe(5);
    expect(count(counts, 'bad')).toBe(0);
    expect(count(null, 'total')).toBe(0);
    expect(codeCounts(counts, 'errorCodes')).toEqual([
      { code: 'ROLE_UNKNOWN', rows: 3 },
      { code: 'EMAIL_INVALID', rows: 2 },
    ]);
    expect(codeCounts(counts, 'missing')).toEqual([]);
    expect(codeCounts(null, 'errorCodes')).toEqual([]);
  });

  it('undo summary: rows by undo result, grouped as the result page says them', () => {
    expect(undoSummary(null)).toBeNull();
    expect(undoSummary({ added: 3 })).toBeNull();
    expect(
      undoSummary({
        undo: {
          removed: 4,
          kept_accepted: 1,
          kept_referenced: 2,
          restored: 3,
          kept_changed: 1,
          kept_privileged: 2,
          kept_error: 1,
        },
      }),
    ).toEqual({ removed: 4, kept: 3, restored: 3, changed: 1, privileged: 2, errors: 1 });
  });

  it('undo: its importer or an Organization Admin (mayUndo), after the run, within 7 days, while the data is kept', () => {
    const finishedAt = new Date('2026-10-10T10:00:00Z');
    const record = {
      status: 'finished',
      mayUndo: true,
      confirmedAt: finishedAt,
      finishedAt,
      dataPurgedAt: null,
    };
    expect(undoDeadline(finishedAt)).toEqual(new Date('2026-10-17T10:00:00Z'));
    expect(undoDeadline(null)).toBeNull();
    const day1 = new Date('2026-10-11T10:00:00Z');
    expect(mayUndo(record, day1)).toBe(true);
    expect(mayUndo(record, new Date('2026-10-17T10:00:01Z'))).toBe(false);
    expect(mayUndo({ ...record, mayUndo: false }, day1)).toBe(false);
    expect(mayUndo({ ...record, status: 'undone' }, day1)).toBe(false);
    expect(mayUndo({ ...record, confirmedAt: null }, day1)).toBe(false);
    expect(mayUndo({ ...record, dataPurgedAt: day1 }, day1)).toBe(false);
    expect(mayUndo({ ...record, finishedAt: null }, day1)).toBe(false);
  });

  it('isolates names inside sentences (FSI … PDI)', () => {
    expect(isolate('لقطات.csv')).toBe('\u2068لقطات.csv\u2069');
  });

  it('sizes, sheets and download names', () => {
    expect(largestSheet([{ rows: 3 }, { rows: 12_400 }])).toBe(12_400);
    expect(largestSheet([])).toBe(0);
    expect(megabytes(2.94 * 1024 * 1024)).toBe(2.9);
    expect(attachmentDisposition('قالب "x".xlsx')).toBe(
      `attachment; filename="____ _x_.xlsx"; filename*=UTF-8''${encodeURIComponent('قالب "x".xlsx')}`,
    );
  });

  it('every reason code and field has its texts in Arabic and English', () => {
    for (const messages of [ar, en]) {
      const ui = messages.userImport as unknown as Record<
        string,
        Record<string, unknown> | undefined
      >;
      for (const code of ISSUE_CODES) expect(ui.codes?.[code], code).toBeTruthy();
      for (const field of IMPORT_FIELDS) expect(ui.fields?.[field], field).toBeTruthy();
      const never = (ui.mapping?.neverReason ?? {}) as Record<string, unknown>;
      for (const reason of Object.keys(NEVER_IMPORTED)) expect(never[reason], reason).toBeTruthy();
    }
  });
});
