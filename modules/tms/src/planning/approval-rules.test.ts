/** Plan approval rules (WP-LD-03): the steps' states, who decides now, a department's result, the input. */
import { describe, expect, it } from 'vitest';
import {
  DecidePlanInput,
  type VersionLine,
  decidableStep,
  departmentResult,
  planFigures,
  stepStates,
  submitProblemOf,
} from './approval-model';

const facts = (over: Partial<Parameters<typeof stepStates>[0]> = {}) => ({
  status: 'draft' as const,
  approvalStep: null,
  financeStep: false,
  financeSwitch: false,
  hrDecided: false,
  ...over,
});

describe('steps', () => {
  it('before submission: the switch says whether Finance will be asked', () => {
    expect(stepStates(facts())).toEqual({ hr: 'not_started', finance: 'off' });
    expect(stepStates(facts({ financeSwitch: true }))).toEqual({
      hr: 'not_started',
      finance: 'not_started',
    });
    expect(stepStates(facts({ status: 'sent_back', financeSwitch: true }))).toEqual({
      hr: 'not_started',
      finance: 'not_started',
    });
  });

  it('in approval and approved: the steps the plan was submitted with', () => {
    expect(
      stepStates(facts({ status: 'in_approval', approvalStep: 'hr', financeSwitch: true })),
    ).toEqual({
      hr: 'waiting',
      finance: 'off',
    });
    expect(
      stepStates(facts({ status: 'in_approval', approvalStep: 'hr', financeStep: true })),
    ).toEqual({
      hr: 'waiting',
      finance: 'later',
    });
    expect(
      stepStates(facts({ status: 'in_approval', approvalStep: 'finance', financeStep: true })),
    ).toEqual({
      hr: 'done',
      finance: 'waiting',
    });
    expect(stepStates(facts({ status: 'approved', financeStep: true }))).toEqual({
      hr: 'done',
      finance: 'done',
    });
    expect(stepStates(facts({ status: 'approved' }))).toEqual({ hr: 'done', finance: 'off' });
  });

  it('who decides now: the step’s role, never the submitter, never twice', () => {
    const plan = {
      status: 'in_approval' as const,
      approvalStep: 'hr' as const,
      submittedBy: 'l',
      hrDecidedBy: null,
    };
    const hr = { personId: 'h', approve: true, confirm: false };
    const finance = { personId: 'f', approve: false, confirm: true };
    expect(decidableStep(plan, hr)).toBe('hr');
    expect(decidableStep(plan, finance)).toBeNull();
    expect(decidableStep(plan, { ...hr, personId: 'l' })).toBeNull();
    expect(decidableStep(plan, { ...hr, personId: null })).toBeNull();
    const next = { ...plan, approvalStep: 'finance' as const, hrDecidedBy: 'h' };
    expect(decidableStep(next, finance)).toBe('finance');
    expect(decidableStep(next, hr)).toBeNull();
    expect(decidableStep(next, { personId: 'h', approve: true, confirm: true })).toBeNull();
    expect(decidableStep({ ...plan, status: 'approved', approvalStep: null }, hr)).toBeNull();
  });

  it('reads the reason of a refused submission', () => {
    expect(submitProblemOf('the training plan cannot be submitted: needs_open')).toBe('needs_open');
    expect(submitProblemOf('uncosted')).toBe('uncosted');
    expect(submitProblemOf('other')).toBeNull();
    expect(submitProblemOf(null)).toBeNull();
  });
});

describe('a department’s result', () => {
  const line = (over: Partial<VersionLine>): VersionLine => ({
    id: 'l',
    title: 'Line',
    courseId: null,
    deliveryType: null,
    category: null,
    quarter: 1,
    minPerSession: null,
    maxPerSession: 20,
    costPerSession: '1000',
    costPerPerson: null,
    durationHours: null,
    status: 'in_plan',
    leftOutReason: null,
    sortOrder: 0,
    departments: [],
    ...over,
  });

  it('its approved lines with its share against its envelope; its left-out lines', () => {
    const result = departmentResult(
      'a',
      [
        line({
          id: 'x',
          departments: [
            { departmentId: 'a', seats: 2, named: 0 },
            { departmentId: 'b', seats: 1, named: 0 },
          ],
        }),
        line({
          id: 'y',
          status: 'left_out',
          leftOutReason: 'No',
          departments: [{ departmentId: 'a', seats: 5, named: 0 }],
        }),
        line({ id: 'z', departments: [{ departmentId: 'b', seats: 5, named: 0 }] }),
      ],
      '500',
      2,
    );
    expect(result.approved).toMatchObject([{ seats: 2, share: '666.67', sharedWith: ['b'] }]);
    expect(result.leftOut).toMatchObject([{ seats: 5 }]);
    expect(result.seats).toBe(2);
    expect(result.cost).toBe('666.67');
    expect(result.state).toMatchObject({ kind: 'over' });
    expect(departmentResult('c', [], null, 2)).toMatchObject({
      approved: [],
      cost: '0',
      state: { kind: 'none' },
    });
  });
});

describe('the decision input', () => {
  it('sending back needs a visible comment; approving takes none', () => {
    const base = { planId: '77777777-7777-4777-8777-777777777777', version: 1, step: 'hr' };
    expect(
      DecidePlanInput.safeParse({ ...base, decision: 'send_back', comment: ' ' }).success,
    ).toBe(false);
    expect(DecidePlanInput.safeParse({ ...base, decision: 'send_back' }).success).toBe(false);
    expect(
      DecidePlanInput.safeParse({ ...base, decision: 'send_back', comment: 'a‮b' }).success,
    ).toBe(false);
    expect(
      DecidePlanInput.safeParse({ ...base, decision: 'send_back', comment: 'x'.repeat(2001) })
        .success,
    ).toBe(false);
    const ok = DecidePlanInput.safeParse({ ...base, decision: 'send_back', comment: ' Fix it ' });
    expect(ok.success && ok.data.comment).toBe('Fix it');
    expect(DecidePlanInput.safeParse({ ...base, decision: 'approve' }).success).toBe(true);
    expect(DecidePlanInput.safeParse({ ...base, step: 'ceo', decision: 'approve' }).success).toBe(
      false,
    );
  });
});

describe('a plan’s figures on the Approvals list (review L7)', () => {
  const line = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    status: 'in_plan' as const,
    minPerSession: null,
    maxPerSession: 10,
    costPerSession: '1000',
    costPerPerson: null,
    ...over,
  });

  it('works out the lines, people, sessions, cost and departments over their envelope as the Plan tab does', () => {
    const figures = planFigures(
      [line('a'), line('b', { status: 'left_out' }), line('c', { costPerSession: null })],
      [
        { lineId: 'a', departmentId: 'd1', seats: 7, named: 0 },
        { lineId: 'a', departmentId: 'd2', seats: 5, named: 2 },
        { lineId: 'b', departmentId: 'd1', seats: 3, named: 0 },
        { lineId: 'c', departmentId: 'd2', seats: 4, named: 0 },
      ],
      [
        { departmentId: 'd1', envelope: '1000' },
        { departmentId: 'd2', envelope: null },
      ],
      'KWD',
    );
    // a: 12 people, 2 sessions, 2,000 (d1 7/12 → 1,166.667 > 1,000); c: 4 people, 1 session, no cost.
    expect(figures).toEqual({
      lines: 2,
      leftOut: 1,
      people: 16,
      sessions: 3,
      cost: '2000',
      envelope: '1000',
      overBudget: 1,
      currency: 'KWD',
      fractionDigits: 3,
    });
  });

  it('an empty plan has nothing to count', () => {
    expect(planFigures([], [], [], 'SAR')).toMatchObject({
      lines: 0,
      people: 0,
      cost: '0',
      envelope: null,
    });
  });
});
