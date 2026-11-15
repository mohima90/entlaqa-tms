import { describe, expect, it } from 'vitest';
import {
  addMonths,
  draftCost,
  evenSizes,
  lineSessionState,
  monthInPeriod,
  namedOnce,
  outsideQuarter,
  periodQuarterOf,
  proposeSessions,
  proposedMonths,
  quarterMonths,
  remainingProposal,
  repeatedNames,
} from './rules';

const RUH = 'branch-riyadh';
const JED = 'branch-jeddah';
const person = (id: string, needId = 'need') => ({ personId: id, needId });
const people = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => person(`${prefix}${String(i + 1)}`, `${prefix}-need`));

describe('months of the planning period (WP-LD-04)', () => {
  it('moves months across years', () => {
    expect(addMonths('2027-11', 3)).toBe('2028-02');
    expect(addMonths('2027-01', -1)).toBe('2026-12');
    expect(() => addMonths('2027-13', 1)).toThrow();
  });

  it('reads quarters from the period start, not the calendar', () => {
    expect(quarterMonths('2027-01-01', 1)).toEqual(['2027-01', '2027-02', '2027-03']);
    expect(quarterMonths('2027-07-15', 2)).toEqual(['2027-10', '2027-11', '2027-12']);
    expect(quarterMonths('2027-11-01', 1)).toEqual(['2027-11', '2027-12', '2028-01']);
    expect(periodQuarterOf('2027-07-01', '2028-01')).toBe(3);
  });

  it('keeps a draft in the period and marks it outside its quarter (Q3 = A)', () => {
    expect(monthInPeriod('2027-01', '2027-01-15', '2027-12-31')).toBe(true);
    expect(monthInPeriod('2026-12', '2027-01-15', '2027-12-31')).toBe(false);
    expect(monthInPeriod('2028-01', '2027-01-15', '2027-12-31')).toBe(false);
    expect(outsideQuarter('2027-02', '2027-01-01', 1)).toBe(false);
    expect(outsideQuarter('2027-04', '2027-01-01', 1)).toBe(true);
  });

  it('spreads sessions over the quarter (Q1 = A)', () => {
    const q = quarterMonths('2027-01-01', 1);
    expect(proposedMonths(0, q)).toEqual([]);
    expect(proposedMonths(1, q)).toEqual(['2027-02']);
    expect(proposedMonths(2, q)).toEqual(['2027-01', '2027-03']);
    expect(proposedMonths(3, q)).toEqual(['2027-01', '2027-02', '2027-03']);
    expect(proposedMonths(4, q)).toEqual(['2027-01', '2027-01', '2027-02', '2027-03']);
    expect(proposedMonths(5, q)).toEqual(['2027-01', '2027-01', '2027-02', '2027-02', '2027-03']);
    expect(proposedMonths(6, q)).toEqual([
      '2027-01',
      '2027-01',
      '2027-02',
      '2027-02',
      '2027-03',
      '2027-03',
    ]);
  });

  it('spreads seats evenly, the larger first', () => {
    expect(evenSizes(47, 3)).toEqual([16, 16, 15]);
    expect(evenSizes(32, 2)).toEqual([16, 16]);
    expect(evenSizes(5, 0)).toEqual([]);
  });
});

describe('proposeSessions (design screen 3)', () => {
  const q1 = quarterMonths('2027-01-01', 1);

  it('places the design example by branch: Riyadh 32 → 16 + 16, Jeddah 15 → 15 (Q2 = A)', () => {
    const proposal = proposeSessions({
      count: 3,
      maxPerSession: 20,
      deliveryType: 'classroom',
      quarterMonths: q1,
      departments: [
        { departmentId: 'finance', branchId: RUH, seats: 20, people: people('f', 20) },
        { departmentId: 'sales', branchId: JED, seats: 15, people: [] },
        { departmentId: 'hr', branchId: RUH, seats: 12, people: people('h', 12) },
      ],
    });
    expect(proposal.branchToCheck).toBe(false);
    expect(proposal.branches).toEqual([
      { branchId: RUH, seats: 32 },
      { branchId: JED, seats: 15 },
    ]);
    expect(
      proposal.sessions.map((s) => ({
        month: s.month,
        branchId: s.branchId,
        seats: s.seats,
        departments: s.departments,
      })),
    ).toEqual([
      {
        month: '2027-01',
        branchId: RUH,
        seats: 16,
        departments: [{ departmentId: 'finance', seats: 16, named: 16 }],
      },
      {
        month: '2027-02',
        branchId: RUH,
        seats: 16,
        departments: [
          { departmentId: 'finance', seats: 4, named: 4 },
          { departmentId: 'hr', seats: 12, named: 12 },
        ],
      },
      {
        month: '2027-03',
        branchId: JED,
        seats: 15,
        // Sales named nobody: its seats wait for names («names later»).
        departments: [{ departmentId: 'sales', seats: 15, named: 0 }],
      },
    ]);
    // Finance's people in the order named: the first 16 in session 1, the next 4 in session 2.
    expect(proposal.sessions[0]?.people.map((p) => p.personId)).toEqual(
      Array.from({ length: 16 }, (_, i) => `f${String(i + 1)}`),
    );
    expect(proposal.sessions[1]?.people.map((p) => p.personId)).toEqual([
      'f17',
      'f18',
      'f19',
      'f20',
      ...Array.from({ length: 12 }, (_, i) => `h${String(i + 1)}`),
    ]);
    expect(proposal.sessions[1]?.people[4]).toEqual({
      personId: 'h1',
      needId: 'h-need',
      departmentId: 'hr',
    });
  });

  it('places a person named by two departments once, with the first; the other keeps the seat (smoke bug)', () => {
    // One manager heads Finance and HR and is named in both departments' needs of the line.
    const proposal = proposeSessions({
      count: 2,
      maxPerSession: 3,
      deliveryType: 'classroom',
      quarterMonths: q1,
      departments: [
        {
          departmentId: 'finance',
          branchId: RUH,
          seats: 3,
          people: [person('manager', 'n-fin'), person('f1', 'n-fin')],
        },
        {
          departmentId: 'hr',
          branchId: RUH,
          seats: 3,
          people: [person('manager', 'n-hr'), person('h1', 'n-hr')],
        },
      ],
    });
    const placed = proposal.sessions.flatMap((s) => s.people.map((p) => p.personId));
    expect(placed).toEqual(['manager', 'f1', 'h1']);
    expect(new Set(placed).size).toBe(placed.length);
    expect(
      proposal.sessions.flatMap((s) => s.people).find((p) => p.personId === 'manager'),
    ).toEqual({ personId: 'manager', needId: 'n-fin', departmentId: 'finance' });
    // HR counts its one other name; the seat of the repeated one waits («names later»).
    expect(proposal.sessions.map((s) => s.departments)).toEqual([
      [{ departmentId: 'finance', seats: 3, named: 2 }],
      [{ departmentId: 'hr', seats: 3, named: 1 }],
    ]);
  });

  it('keeps one branch and the plan’s sizes when everyone is in the same branch', () => {
    const proposal = proposeSessions({
      count: 3,
      maxPerSession: 20,
      deliveryType: null,
      quarterMonths: q1,
      departments: [
        { departmentId: 'finance', branchId: RUH, seats: 20, people: people('f', 3) },
        { departmentId: 'hr', branchId: RUH, seats: 27, people: [] },
      ],
    });
    expect(proposal.sessions.map((s) => [s.branchId, s.seats])).toEqual([
      [RUH, 16],
      [RUH, 16],
      [RUH, 15],
    ]);
    // The larger department first: HR 16 + 11, then Finance 5 + 15 — Finance's three named people in session 2.
    expect(proposal.sessions.map((s) => s.departments)).toEqual([
      [{ departmentId: 'hr', seats: 16, named: 0 }],
      [
        { departmentId: 'hr', seats: 11, named: 0 },
        { departmentId: 'finance', seats: 5, named: 3 },
      ],
      [{ departmentId: 'finance', seats: 15, named: 0 }],
    ]);
  });

  it('proposes no branch for an online line (virtual, e-learning)', () => {
    const proposal = proposeSessions({
      count: 2,
      maxPerSession: 20,
      deliveryType: 'virtual',
      quarterMonths: q1,
      departments: [
        { departmentId: 'finance', branchId: RUH, seats: 20, people: [] },
        { departmentId: 'sales', branchId: JED, seats: 15, people: [] },
      ],
    });
    expect(proposal.sessions.map((s) => [s.month, s.branchId, s.seats])).toEqual([
      ['2027-01', null, 18],
      ['2027-03', null, 17],
    ]);
  });

  it('keeps the plan’s session count when the branches do not fit, and asks L&D to check the branches', () => {
    // 3 branches of 10 people, at most 15 a session: the plan says 2 sessions.
    const proposal = proposeSessions({
      count: 2,
      maxPerSession: 15,
      deliveryType: 'classroom',
      quarterMonths: q1,
      departments: [
        { departmentId: 'a', branchId: RUH, seats: 10, people: [] },
        { departmentId: 'b', branchId: JED, seats: 10, people: [] },
        { departmentId: 'c', branchId: 'branch-dammam', seats: 10, people: [] },
      ],
    });
    expect(proposal.branchToCheck).toBe(true);
    expect(proposal.sessions.map((s) => s.seats)).toEqual([15, 15]);
    expect(proposal.sessions.map((s) => s.departments)).toEqual([
      [
        { departmentId: 'a', seats: 10, named: 0 },
        { departmentId: 'b', seats: 5, named: 0 },
      ],
      [
        { departmentId: 'b', seats: 5, named: 0 },
        { departmentId: 'c', seats: 10, named: 0 },
      ],
    ]);
    // Each session gets the branch of most of its people.
    expect(proposal.sessions.map((s) => s.branchId)).toEqual([RUH, 'branch-dammam']);
  });

  it('gives sessions left over to the branch with the fullest sessions', () => {
    // Riyadh 30, Jeddah 6, at most 20 → plan 2 sessions, but say the plan has 3 (a revised size): Riyadh gets it.
    const proposal = proposeSessions({
      count: 3,
      maxPerSession: 20,
      deliveryType: 'classroom',
      quarterMonths: q1,
      departments: [
        { departmentId: 'a', branchId: RUH, seats: 30, people: [] },
        { departmentId: 'b', branchId: JED, seats: 6, people: [] },
      ],
    });
    expect(proposal.sessions.map((s) => [s.branchId, s.seats])).toEqual([
      [RUH, 15],
      [RUH, 15],
      [JED, 6],
    ]);
  });

  it('never proposes more sessions than people, nor any without people or a count', () => {
    expect(
      proposeSessions({
        count: 4,
        maxPerSession: 1,
        deliveryType: null,
        quarterMonths: q1,
        departments: [{ departmentId: 'a', branchId: null, seats: 2, people: [] }],
      }).sessions.map((s) => s.seats),
    ).toEqual([1, 1]);
    expect(
      proposeSessions({
        count: 0,
        maxPerSession: 10,
        deliveryType: null,
        quarterMonths: q1,
        departments: [{ departmentId: 'a', branchId: null, seats: 2, people: [] }],
      }).sessions,
    ).toEqual([]);
  });

  it('drafts what is left once some drafts exist, without the people already planned', () => {
    const proposal = proposeSessions({
      count: 3,
      maxPerSession: 20,
      deliveryType: 'classroom',
      quarterMonths: q1,
      departments: [
        { departmentId: 'finance', branchId: RUH, seats: 20, people: people('f', 20) },
        { departmentId: 'sales', branchId: JED, seats: 15, people: [] },
        { departmentId: 'hr', branchId: RUH, seats: 12, people: people('h', 12) },
      ],
    });
    // The February draft was deleted; January (Riyadh) and March (Jeddah) exist, f1…f16 planned in January.
    const left = remainingProposal(
      proposal,
      [
        { month: '2027-03', branchId: JED },
        { month: '2027-01', branchId: RUH },
      ],
      new Set(Array.from({ length: 16 }, (_, i) => `f${String(i + 1)}`)),
    );
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ month: '2027-02', branchId: RUH, seats: 16 });
    expect(left[0]?.people).toHaveLength(16);
    // A draft moved to another month takes the proposed session of its branch.
    const moved = remainingProposal(proposal, [{ month: '2027-05', branchId: JED }], new Set());
    expect(moved.map((s) => s.month)).toEqual(['2027-01', '2027-02']);
    // People already planned leave the proposal, the department's count follows.
    const without = remainingProposal(proposal, [], new Set(['f17', 'h1']));
    expect(without[1]?.departments).toEqual([
      { departmentId: 'finance', seats: 4, named: 3 },
      { departmentId: 'hr', seats: 12, named: 11 },
    ]);
  });
});

describe('each person once per line', () => {
  const named = [
    { personId: 'manager', needId: 'n-fin', departmentId: 'finance' },
    { personId: 'f1', needId: 'n-fin', departmentId: 'finance' },
    { personId: 'MANAGER', needId: 'n-hr', departmentId: 'hr' },
    { personId: 'h1', needId: 'n-hr', departmentId: 'hr' },
    { personId: 'h1', needId: 'n-hr2', departmentId: 'hr' },
  ];

  it('keeps the first need that names a person, in the order named', () => {
    expect(namedOnce(named)).toEqual([named[0], named[1], named[3]]);
    expect(namedOnce([])).toEqual([]);
  });

  it('counts per department the names that repeat a person already named', () => {
    expect(repeatedNames(named)).toEqual(new Map([['hr', 2]]));
    expect(repeatedNames(named.slice(0, 2))).toEqual(new Map());
  });
});

describe('a line’s drafts against the plan', () => {
  it('names each state of the Draft sessions column', () => {
    const state = (
      status: 'in_plan' | 'left_out',
      hasCourse: boolean,
      planned: number | null,
      drafted: number,
    ) => lineSessionState({ status, hasCourse, planned, drafted });
    expect(state('left_out', false, 2, 0)).toBe('left_out');
    expect(state('in_plan', false, 2, 0)).toBe('needs_course');
    expect(state('in_plan', true, null, 0)).toBe('needs_size');
    expect(state('in_plan', true, 3, 0)).toBe('needs_sessions');
    expect(state('in_plan', true, 3, 1)).toBe('partly_drafted');
    expect(state('in_plan', true, 3, 3)).toBe('drafted');
    // The plan was revised: «3 drafts, plan says 2» — nothing is deleted automatically.
    expect(state('in_plan', true, 2, 3)).toBe('over_drafted');
    expect(state('left_out', true, 2, 1)).toBe('over_drafted');
  });

  it('works out a draft’s estimate as the database does', () => {
    expect(draftCost(15, '3000', '100')).toBe('4500');
    expect(draftCost(16, '9000', null)).toBe('9000');
    expect(draftCost(3, '1000.5', '0.125')).toBe('1000.875');
    expect(draftCost(10, null, '100')).toBeNull();
  });
});
