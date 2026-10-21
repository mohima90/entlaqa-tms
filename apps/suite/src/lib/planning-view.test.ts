import type { CycleListItem } from '@jadarat/tms';
import { DEFAULT_CHAIN } from '@jadarat/tms/planning-model';
import { describe, expect, it } from 'vitest';
import { fromDrafts, parseReminderDays, stepKey, stepNameErrors, toDrafts } from './planning-chain';
import { dayFormatter, formatAmount } from './planning-format';
import {
  CYCLE_TONE,
  FORM_TONE,
  PROBLEM_STEP,
  cycleHref,
  daysLeft,
  fieldErrorKey,
  groupCycles,
  localName,
  nextStep,
  previousStep,
  progressCounts,
  setupStep,
  statusCounts,
  stepMarks,
  sumAmounts,
} from './planning-view';

describe('set-up steps (EP-PLN B4)', () => {
  it('reads the step from the query string, Basics by default', () => {
    expect(setupStep('budget')).toBe('budget');
    expect(setupStep('nope')).toBe('basics');
    expect(setupStep(['scope'])).toBe('basics');
    expect(nextStep('basics')).toBe('scope');
    // Reminders now continues to «Review & launch» (redesign package 4), the last step.
    expect(nextStep('reminders')).toBe('review');
    expect(nextStep('review')).toBeNull();
    expect(setupStep('review')).toBe('review');
    expect(previousStep('scope')).toBe('basics');
    expect(previousStep('basics')).toBeNull();
  });

  it('links a cycle and one of its steps', () => {
    expect(cycleHref('ar', 'c1')).toBe('/ar/suite/planning/cycles/c1');
    expect(cycleHref('en', 'c1', 'approvals')).toBe('/en/suite/planning/cycles/c1?step=approvals');
  });
});

describe('list helpers', () => {
  const item = (status: CycleListItem['status']): CycleListItem => ({
    id: status,
    name: { ar: 'خطة', en: 'Plan' },
    periodStart: '2027-01-01',
    periodEnd: '2027-12-31',
    deadline: '2026-11-30',
    status,
    departmentCount: 1,
    submittedCount: 0,
  });

  it('groups the cycles by status: open, drafts, then everything closed', () => {
    const cycles = [item('draft'), item('open'), item('closed'), item('consolidated')];
    const groups = groupCycles(cycles);
    expect(groups.open.map((c) => c.id)).toEqual(['open']);
    expect(groups.drafts.map((c) => c.id)).toEqual(['draft']);
    expect(groups.closed.map((c) => c.id)).toEqual(['closed', 'consolidated']);
    expect(groupCycles([])).toEqual({ open: [], drafts: [], closed: [] });
  });

  it('counts the days left to a deadline from the organization’s today', () => {
    expect(daysLeft('2026-10-21', '2026-11-20')).toBe(30);
    expect(daysLeft('2026-10-21', '2026-10-21')).toBe(0);
    expect(daysLeft('2026-10-21', '2026-10-20')).toBe(-1);
  });

  it('counts the units per status for the progress chips', () => {
    expect(statusCounts(['not_started', 'late', 'submitted', 'late', 'returned'])).toEqual({
      all: 5,
      not_started: 1,
      draft: 0,
      submitted: 1,
      returned: 1,
      late: 2,
    });
  });

  it('marks the set-up steps from the launch problems (Review & launch)', () => {
    expect(stepMarks([])).toEqual({
      basics: 'done',
      scope: 'done',
      budget: 'todo',
      approvals: 'done',
      reminders: 'todo',
      review: 'todo',
    });
    const marks = stepMarks(['deadline_past', 'approver_missing', 'another_open']);
    expect(marks.basics).toBe('problem');
    expect(marks.approvals).toBe('problem');
    expect(marks.scope).toBe('done');
    expect(stepMarks(['no_departments']).scope).toBe('problem');
    expect(PROBLEM_STEP.another_open).toBeNull();
    expect(PROBLEM_STEP.no_needs_form).toBe('basics');
  });

  it('names in the page language, else the other one', () => {
    expect(localName('en', { ar: 'خطة', en: 'Plan' })).toBe('Plan');
    expect(localName('en', { ar: 'خطة', en: null })).toBe('خطة');
    expect(localName('en', { ar: 'خطة', en: '' })).toBe('خطة');
    expect(localName('ar', { ar: 'خطة', en: 'Plan' })).toBe('خطة');
    expect(localName('ar', { ar: '', en: 'Plan' })).toBe('Plan');
  });

  it('gives every status a badge tone; Late is a danger', () => {
    expect(CYCLE_TONE.open).toBe('success');
    expect(FORM_TONE.late).toBe('danger');
    expect(FORM_TONE.submitted).toBe('success');
  });

  it('counts the progress per form status (C9)', () => {
    expect(progressCounts(['not_started', 'late', 'submitted', 'late', 'draft'])).toEqual({
      departments: 5,
      notStarted: 1,
      submitted: 1,
      late: 2,
    });
  });
});

describe('formatting', () => {
  it('shows calendar days as the organization does, without a time-zone shift', () => {
    expect(dayFormatter('en', 'gregorian')('2027-01-01')).toBe('Jan 1, 2027');
    expect(dayFormatter('en', 'dual')('2027-01-01')).toContain(' · ');
    expect(dayFormatter('en', 'gregorian')('not a day')).toBe('not a day');
  });

  it('shows amounts in the organization’s currency with Western digits', () => {
    expect(formatAmount('en', '1200.5', 'SAR')).toContain('1,200.5');
    expect(formatAmount('ar', 50000, 'SAR')).toMatch(/50[,٬]000/);
    expect(formatAmount('en', 'x', 'SAR')).toBe('x');
    expect(formatAmount('en', '5', 'NOPE!')).toBe('5 NOPE!');
  });

  it('sums typed envelopes, ignoring empty ones', () => {
    expect(sumAmounts(['1,000', '', null, '250.5', 'abc'])).toBe(1250.5);
  });

  it('maps field error codes to texts', () => {
    expect(fieldErrorKey('DUPLICATE_APPROVER')).toBe('setup.fieldErrors.duplicateApprover');
    expect(fieldErrorKey('TOO_SMALL')).toBe('setup.fieldErrors.required');
    expect(fieldErrorKey('SOMETHING')).toBe('setup.fieldErrors.invalid');
  });
});

describe('approval chain drafts (A3/B4)', () => {
  it('round-trips the chain; the heads step never names a person', () => {
    const drafts = toDrafts(DEFAULT_CHAIN);
    expect(drafts.map((d) => d.approverPersonId)).toEqual(['', '', '']);
    expect(fromDrafts(drafts)).toEqual(DEFAULT_CHAIN);
    expect(
      fromDrafts([
        { key: 'k', kind: 'department_heads', nameAr: 'ر', nameEn: 'H', approverPersonId: 'p1' },
      ]),
    ).toEqual([{ kind: 'department_heads', nameAr: 'ر', nameEn: 'H', approverPersonId: null }]);
    expect(stepKey()).not.toBe(stepKey());
  });

  it('requires step names', () => {
    expect(
      stepNameErrors(
        [{ key: 'k', kind: 'person', nameAr: ' ', nameEn: 'F', approverPersonId: '' }],
        'required',
      ),
    ).toEqual({ 'steps.0.nameAr': 'required' });
  });

  it('reads reminder days: whole days 1–90, each once', () => {
    expect(parseReminderDays(['7', ' 2 '])).toEqual({ ok: true, days: [7, 2] });
    expect(parseReminderDays([])).toEqual({ ok: true, days: [] });
    expect(parseReminderDays([''])).toEqual({ ok: false, key: 'setup.fieldErrors.dayRange' });
    expect(parseReminderDays(['0'])).toEqual({ ok: false, key: 'setup.fieldErrors.dayRange' });
    expect(parseReminderDays(['1.5'])).toEqual({ ok: false, key: 'setup.fieldErrors.dayRange' });
    expect(parseReminderDays(['3', '3'])).toEqual({
      ok: false,
      key: 'setup.fieldErrors.duplicateDay',
    });
  });
});
