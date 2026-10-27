import { describe, expect, it } from 'vitest';
import {
  AddNeedInput,
  BudgetAmount,
  CreateCycleInput,
  DEFAULT_CHAIN,
  ReminderDays,
  ReturnNeedsInput,
  SaveScopeInput,
  SaveStepsInput,
  type StructureUnit,
  addDays,
  basicsIssues,
  canExtendDeadline,
  canRecallNeeds,
  canSubmitNeeds,
  canonicalAmount,
  chainIssues,
  dayInZone,
  daysBetween,
  defaultDeadline,
  defaultPeriod,
  departmentDeadline,
  departmentsInScope,
  earliestExtension,
  effectiveCycleStatus,
  effectiveHead,
  entryOpen,
  envelopeState,
  formStatus,
  isCalendarDay,
  latestDeadline,
  launchProblems,
  needsTotals,
  toFieldErrors,
  treeOrder,
} from './model';

const u = (
  id: string,
  parentId: string | null,
  extra: Partial<StructureUnit> = {},
): StructureUnit => ({
  id,
  parentId,
  branchId: null,
  active: true,
  sortOrder: 0,
  nameAr: id,
  headPersonId: null,
  ...extra,
});

// Sales (head h1) → Sales-East (no head) → East-Retail (head h2); HR (inactive) → HR-Ops; Ops (branch JED).
const tree: StructureUnit[] = [
  u('sales', null, { headPersonId: 'h1', sortOrder: 1 }),
  u('east', 'sales'),
  u('retail', 'east', { headPersonId: 'h2' }),
  u('hr', null, { active: false, sortOrder: 2 }),
  u('hr-ops', 'hr'),
  u('ops', null, { branchId: 'jed', sortOrder: 3 }),
];

describe('calendar days', () => {
  it('accepts only real days', () => {
    expect(isCalendarDay('2027-02-28')).toBe(true);
    expect(isCalendarDay('2027-02-29')).toBe(false);
    expect(isCalendarDay('2028-02-29')).toBe(true);
    expect(isCalendarDay('27-01-01')).toBe(false);
  });

  it('adds and counts days across months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2027-01-01', '2027-12-31')).toBe(364);
  });

  it('reads today in the organization’s time zone', () => {
    const lateEvening = new Date('2026-10-17T22:30:00Z');
    expect(dayInZone(lateEvening, 'Asia/Riyadh')).toBe('2026-10-18');
    expect(dayInZone(lateEvening, 'UTC')).toBe('2026-10-17');
    expect(dayInZone(lateEvening, 'Not/AZone')).toBe('2026-10-17');
  });
});

describe('defaults (business flow B4)', () => {
  it('proposes the next fiscal year', () => {
    expect(defaultPeriod('2026-10-17', 1)).toEqual({ start: '2027-01-01', end: '2027-12-31' });
    expect(defaultPeriod('2026-10-17', 7)).toEqual({ start: '2027-07-01', end: '2028-06-30' });
    expect(defaultPeriod('2026-03-02', 4)).toEqual({ start: '2026-04-01', end: '2027-03-31' });
    expect(defaultPeriod('2026-04-01', 4)).toEqual({ start: '2027-04-01', end: '2028-03-31' });
    expect(defaultPeriod('2026-04-01', 99).start).toBe('2026-12-01');
  });

  it('proposes a deadline 30 days ahead, within the period', () => {
    expect(defaultDeadline('2026-10-17', '2027-12-31')).toBe('2026-11-16');
    expect(defaultDeadline('2026-10-17', '2026-11-01')).toBe('2026-11-01');
  });

  it('starts from the built-in chain Department Heads → Finance → Management', () => {
    expect(DEFAULT_CHAIN.map((s) => s.kind)).toEqual(['department_heads', 'person', 'person']);
    expect(chainIssues(DEFAULT_CHAIN, false)).toEqual([]);
    expect(chainIssues(DEFAULT_CHAIN, true).map((i) => i.message)).toEqual([
      'required',
      'required',
    ]);
  });
});

describe('statuses', () => {
  it('shows an open cycle past its deadline as Closed (D10)', () => {
    expect(effectiveCycleStatus('open', '2026-10-16', '2026-10-17')).toBe('closed');
    expect(effectiveCycleStatus('open', '2026-10-17', '2026-10-17')).toBe('open');
    expect(effectiveCycleStatus('draft', '2026-10-01', '2026-10-17')).toBe('draft');
  });

  it('marks forms Late once the deadline has passed without a submission (C9)', () => {
    expect(formStatus('not_started', '2026-10-16', '2026-10-17')).toBe('late');
    expect(formStatus('draft', '2026-10-16', '2026-10-17')).toBe('late');
    expect(formStatus('submitted', '2026-10-16', '2026-10-17')).toBe('submitted');
    expect(formStatus('not_started', '2026-10-17', '2026-10-17')).toBe('not_started');
  });

  it('extends only an open cycle whose deadline has not passed', () => {
    expect(canExtendDeadline('open')).toBe(true);
    // C-7: shown as Closed by date but still open in the database — extendable.
    expect(canExtendDeadline('draft')).toBe(false);
    expect(canExtendDeadline('closed')).toBe(false);
    expect(earliestExtension('2026-10-17', '2026-10-10')).toBe('2026-10-18');
    expect(earliestExtension('2026-10-10', '2026-10-17')).toBe('2026-10-17');
    expect(earliestExtension('2026-10-16', '2026-10-17')).toBe('2026-10-17');
  });
});

describe('scope → departments (one form per department, BR-PLN-a)', () => {
  it('includes everything under a picked unit, in tree order', () => {
    expect(departmentsInScope(tree, { departmentIds: ['sales'], branchIds: [] })).toEqual([
      'sales',
      'east',
      'retail',
    ]);
    expect(departmentsInScope(tree, { departmentIds: ['east'], branchIds: [] })).toEqual([
      'east',
      'retail',
    ]);
  });

  it('gives inactive units no form but keeps their active sub-units', () => {
    expect(departmentsInScope(tree, { departmentIds: ['hr'], branchIds: [] })).toEqual(['hr-ops']);
  });

  it('adds the departments of a picked branch; unknown ids are ignored', () => {
    expect(departmentsInScope(tree, { departmentIds: ['nope'], branchIds: ['jed'] })).toEqual([
      'ops',
    ]);
    expect(
      departmentsInScope(tree, { departmentIds: ['retail', 'sales'], branchIds: ['jed'] }),
    ).toEqual(['sales', 'east', 'retail', 'ops']);
  });

  it('lists the whole tree with depths', () => {
    expect(treeOrder(tree)).toEqual([
      { id: 'sales', depth: 0 },
      { id: 'east', depth: 1 },
      { id: 'retail', depth: 2 },
      { id: 'hr', depth: 0 },
      { id: 'hr-ops', depth: 1 },
      { id: 'ops', depth: 0 },
    ]);
  });

  it('sends a unit without a head to the nearest head above (EP-ORG); warns when there is none', () => {
    expect(effectiveHead(tree, 'east')).toEqual({ personId: 'h1', fromDepartmentId: 'sales' });
    expect(effectiveHead(tree, 'retail')).toEqual({ personId: 'h2', fromDepartmentId: 'retail' });
    expect(effectiveHead(tree, 'ops')).toBeNull();
    expect(effectiveHead(tree, 'missing')).toBeNull();
  });
});

describe('launch readiness (B5)', () => {
  const ready = {
    status: 'draft' as const,
    deadline: '2026-11-01',
    today: '2026-10-17',
    needsFormId: 'f1' as string | null,
    departmentCount: 3,
    steps: [
      DEFAULT_CHAIN[0] ?? DEFAULT_CHAIN[1]!,
      { kind: 'person' as const, nameAr: 'م', nameEn: 'F', approverPersonId: 'p1' },
    ],
    activeMemberIds: new Set(['p1']),
    anotherOpen: false,
  };

  it('is ready with a future deadline, departments and named active approvers', () => {
    expect(launchProblems(ready)).toEqual([]);
  });

  it('lists every problem', () => {
    expect(
      launchProblems({
        ...ready,
        deadline: '2026-10-16',
        needsFormId: null,
        departmentCount: 0,
        steps: [
          { kind: 'person', nameAr: 'م', nameEn: 'F', approverPersonId: null },
          { kind: 'person', nameAr: 'م', nameEn: 'M', approverPersonId: 'gone' },
        ],
        anotherOpen: true,
      }),
    ).toEqual([
      'deadline_past',
      'no_needs_form',
      'no_departments',
      'approver_missing',
      'approver_inactive',
      'another_open',
    ]);
    expect(launchProblems({ ...ready, steps: [DEFAULT_CHAIN[0]!] })).toEqual(['no_approver_step']);
  });
});

describe('input rules', () => {
  const basics = {
    nameAr: 'خطة ٢٠٢٧',
    nameEn: 'Plan 2027',
    periodStart: '2027-01-01',
    periodEnd: '2027-12-31',
    deadline: '2026-11-30',
  };

  it('validates the basics and normalises empty instructions', () => {
    const parsed = CreateCycleInput.parse({
      ...basics,
      instructionsAr: '  ',
      instructionsEn: 'Hi',
    });
    expect(parsed.instructionsAr).toBeNull();
    expect(parsed.instructionsEn).toBe('Hi');
    expect(CreateCycleInput.parse(basics).instructionsEn).toBeNull();
    expect(CreateCycleInput.safeParse({ ...basics, nameEn: ' ' }).success).toBe(false);
    expect(CreateCycleInput.safeParse({ ...basics, nameEn: 'a‮b' }).success).toBe(false);
    expect(CreateCycleInput.safeParse({ ...basics, nameAr: 'خ'.repeat(121) }).success).toBe(false);
    expect(CreateCycleInput.safeParse({ ...basics, periodStart: '2027-02-30' }).success).toBe(
      false,
    );
    expect(CreateCycleInput.safeParse({ ...basics, extra: 1 }).success).toBe(false);
  });

  it('checks the period and the deadline like the database', () => {
    expect(basicsIssues(basics)).toEqual([]);
    expect(toFieldErrors(basicsIssues({ ...basics, periodEnd: '2026-12-31' }))).toEqual([
      { path: 'periodEnd', code: 'BEFORE_START' },
    ]);
    expect(toFieldErrors(basicsIssues({ ...basics, deadline: '2028-01-01' }))).toEqual([
      { path: 'deadline', code: 'AFTER_PERIOD' },
    ]);
    expect(basicsIssues({ ...basics, periodEnd: '2029-01-03' })).toEqual([
      { path: 'periodEnd', message: 'too_long' },
    ]);
    expect(basicsIssues({ ...basics, periodStart: 'x' })).toEqual([]);
  });

  it('checks the chain: one Department Heads step, named people once each (BR-PLN-g)', () => {
    const person = (approverPersonId: string | null) => ({
      kind: 'person' as const,
      nameAr: 'م',
      nameEn: 'S',
      approverPersonId,
    });
    const heads = { ...DEFAULT_CHAIN[0]!, approverPersonId: null };
    expect(
      toFieldErrors(
        chainIssues(
          [heads, { ...heads, approverPersonId: 'p9' }, person('p1'), person('p1'), person(null)],
          true,
        ),
      ),
    ).toEqual([
      { path: 'steps.1.kind', code: 'SECOND_HEADS_STEP' },
      { path: 'steps.1.approverPersonId', code: 'HEADS_STEP_NAMED' },
      { path: 'steps.3.approverPersonId', code: 'DUPLICATE_APPROVER' },
      { path: 'steps.4.approverPersonId', code: 'REQUIRED' },
    ]);
    const ids = { id: '11111111-1111-4111-8111-111111111111', version: 1 };
    expect(SaveStepsInput.safeParse({ ...ids, steps: [] }).success).toBe(false);
    expect(
      SaveStepsInput.safeParse({ ...ids, steps: Array.from({ length: 11 }, () => person(null)) })
        .success,
    ).toBe(false);
  });

  it('accepts reminder days 1–90, distinct, at most five — sorted from the earliest', () => {
    expect(ReminderDays.parse([2, 7])).toEqual([7, 2]);
    expect(ReminderDays.parse([])).toEqual([]);
    expect(ReminderDays.safeParse([7, 7]).success).toBe(false);
    expect(ReminderDays.safeParse([0]).success).toBe(false);
    expect(ReminderDays.safeParse([91]).success).toBe(false);
    expect(ReminderDays.safeParse([1, 2, 3, 4, 5, 6]).success).toBe(false);
  });

  it('reads envelope amounts as typed; empty means no envelope (Q2)', () => {
    expect(BudgetAmount.parse(' 50,000.5 ')).toBe('50000.5');
    expect(BudgetAmount.parse('')).toBeNull();
    expect(BudgetAmount.safeParse('-1').success).toBe(false);
    expect(BudgetAmount.safeParse('1.2345').success).toBe(false);
    expect(BudgetAmount.safeParse('1e5').success).toBe(false);
    expect(canonicalAmount('0012.500')).toBe('12.5');
    expect(canonicalAmount('50000.0000')).toBe('50000');
    expect(canonicalAmount('0')).toBe('0');
    expect(canonicalAmount(null)).toBeNull();
  });

  it('removes repeated scope ids and refuses malformed ones', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(
      SaveScopeInput.parse({ id, version: 2, departmentIds: [id, id], branchIds: [] })
        .departmentIds,
    ).toEqual([id]);
    expect(
      SaveScopeInput.safeParse({ id, version: 2, departmentIds: ['1 or 1=1'], branchIds: [] })
        .success,
    ).toBe(false);
  });
});

describe('department needs (WP-LD-01; PO decisions Q1–Q3, 27 Oct 2026)', () => {
  it('takes the later of the cycle deadline and a department extension; the latest decides Open', () => {
    expect(departmentDeadline('2026-11-30', null)).toBe('2026-11-30');
    expect(departmentDeadline('2026-11-30', '2026-12-05')).toBe('2026-12-05');
    expect(departmentDeadline('2026-11-30', '2026-11-01')).toBe('2026-11-30');
    expect(latestDeadline('2026-11-30', [null, '2026-12-05', '2026-12-01'])).toBe('2026-12-05');
    expect(
      effectiveCycleStatus('open', latestDeadline('2026-11-30', ['2026-12-05']), '2026-12-03'),
    ).toBe('open');
  });

  it('opens entry while the cycle is open and the effective deadline has not passed', () => {
    expect(entryOpen('open', '2026-11-30', '2026-11-30')).toBe(true);
    expect(entryOpen('open', '2026-11-30', '2026-12-01')).toBe(false);
    expect(entryOpen('closed', '2026-11-30', '2026-11-01')).toBe(false);
    expect(entryOpen('draft', '2026-11-30', '2026-11-01')).toBe(false);
  });

  it('submits with at least one need and recalls only a submitted set', () => {
    expect(canSubmitNeeds('not_started', 0)).toBe(false);
    expect(canSubmitNeeds('draft', 2)).toBe(true);
    expect(canSubmitNeeds('returned', 1)).toBe(true);
    expect(canSubmitNeeds('submitted', 3)).toBe(false);
    expect(canRecallNeeds('submitted')).toBe(true);
    expect(canRecallNeeds('draft')).toBe(false);
  });

  it('sums seats, named seats and costs (Q1: seats are the unit; names never exceed the seats)', () => {
    expect(
      needsTotals([
        { peopleCount: 5, namedCount: 2, estimatedCost: '1200.5' },
        { peopleCount: 3, namedCount: 4, estimatedCost: null },
        { peopleCount: 10, namedCount: 0, estimatedCost: '800' },
      ]),
    ).toEqual({ needs: 3, seats: 18, named: 5, unnamed: 13, cost: '2000.5', costed: 2 });
    expect(needsTotals([])).toEqual({
      needs: 0,
      seats: 0,
      named: 0,
      unnamed: 0,
      cost: null,
      costed: 0,
    });
  });

  it('shows the envelope and never blocks (Q2): what is left, or by how much it is exceeded', () => {
    expect(envelopeState('2000.5', null)).toEqual({ kind: 'none' });
    expect(envelopeState(null, '50000')).toEqual({ kind: 'within', left: '50000' });
    expect(envelopeState('2000.5', '50000')).toEqual({ kind: 'within', left: '47999.5' });
    expect(envelopeState('60000', '50000')).toEqual({ kind: 'over', overBy: '10000' });
    expect(envelopeState('50000', '50000')).toEqual({ kind: 'within', left: '0' });
  });

  it('validates a need: topic, seats, names, cost and the «More» answers', () => {
    const base = {
      cycleId: '55555555-5555-4555-8555-555555555555',
      departmentId: '66666666-6666-4666-8666-666666666661',
      topic: '  Excel  ',
      courseId: null,
      peopleCount: 5,
      personIds: [],
      estimatedCost: '1,200.50',
      answers: {},
    };
    const parsed = AddNeedInput.safeParse(base);
    expect(parsed.success && parsed.data.topic).toBe('Excel');
    expect(parsed.success && parsed.data.estimatedCost).toBe('1200.50');
    expect(AddNeedInput.safeParse({ ...base, peopleCount: 0 }).success).toBe(false);
    expect(AddNeedInput.safeParse({ ...base, topic: '‮x' }).success).toBe(false);
    expect(AddNeedInput.safeParse({ ...base, estimatedCost: 'abc' }).success).toBe(false);
    expect(AddNeedInput.safeParse({ ...base, estimatedCost: '' }).success).toBe(true);
    expect(AddNeedInput.safeParse({ ...base, personIds: ['not-a-uuid'] }).success).toBe(false);
    expect(ReturnNeedsInput.safeParse({ ...base, version: 1, note: '   ' }).success).toBe(false);
  });
});
