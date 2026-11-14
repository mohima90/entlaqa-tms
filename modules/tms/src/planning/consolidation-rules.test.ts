import { describe, expect, it } from 'vitest';
import {
  type ConsolidationNeed,
  attachNeeds,
  budgetCheck,
  budgetState,
  buildLines,
  consolidationReadiness,
  currencyFractionDigits,
  fromMilli,
  groupKeyOf,
  groupLines,
  lineCost,
  lineFigures,
  looksAlike,
  lookAlikePairs,
  needAnswers,
  planFormFields,
  preselectedQuarter,
  sessionPlan,
  splitBySeats,
  toMilli,
  topicKey,
} from './consolidation-rules';

const need = (over: Partial<ConsolidationNeed> & { id: string }): ConsolidationNeed => ({
  departmentId: 'sales',
  topic: 'Excel',
  courseId: null,
  peopleCount: 1,
  quarter: null,
  deliveryType: null,
  category: null,
  ...over,
});

describe('amounts (exact thousandths)', () => {
  it('reads and writes canonical amounts', () => {
    expect(toMilli('1200.5')).toBe(1_200_500n);
    expect(toMilli('0')).toBe(0n);
    expect(toMilli('15000.0000')).toBe(15_000_000n);
    expect(toMilli(null)).toBeNull();
    expect(() => toMilli('1,000')).toThrow();
    expect(fromMilli(1_200_500n)).toBe('1200.5');
    expect(fromMilli(15_000_000n)).toBe('15000');
    expect(fromMilli(1n)).toBe('0.001');
    expect(fromMilli(-4_473_000n)).toBe('-4473');
  });

  it('knows the three-decimal currencies of the region', () => {
    expect(currencyFractionDigits('SAR')).toBe(2);
    expect(currencyFractionDigits('kwd')).toBe(3);
    expect(currencyFractionDigits('XYZ')).toBe(2);
  });
});

describe('topicKey: the same training whatever the spelling (D11)', () => {
  it('ignores case, spaces and punctuation', () => {
    expect(topicKey('  Excel – Advanced   formulas! ')).toBe('excel advanced formulas');
    expect(topicKey('EXCEL: advanced, formulas')).toBe(topicKey('excel advanced formulas'));
    expect(topicKey('Project-management (basics)')).toBe('project management basics');
  });

  it('is Arabic-aware: alef and hamza forms, taa marbuta, yaa / alef maqsura, diacritics, tatweel', () => {
    // «الإدارة» typed four ways.
    expect(topicKey('الإدارة')).toBe(topicKey('الاداره'));
    expect(topicKey('الأدارة')).toBe(topicKey('الادارة'));
    expect(topicKey('الْإِدَارَةُ')).toBe(topicKey('الادارة'));
    expect(topicKey('الإدارــــة')).toBe(topicKey('الادارة'));
    // Alef maqsura / yaa, hamza on yaa and waw, a lone hamza.
    expect(topicKey('مستوى')).toBe(topicKey('مستوي'));
    expect(topicKey('مسئول')).toBe(topicKey('مسيول'));
    expect(topicKey('مؤتمر')).toBe(topicKey('موتمر'));
    expect(topicKey('أداء')).toBe(topicKey('اداء'));
    expect(topicKey('آمن')).toBe(topicKey('امن'));
    // Arabic punctuation and digits, invisible marks.
    expect(topicKey('إكسل، المستوى ٢')).toBe(topicKey('اكسل المستوي 2'));
    expect(topicKey('Excel‏ 2')).toBe('excel 2');
  });

  it('builds a line key from the course, else the topic', () => {
    expect(groupKeyOf({ courseId: 'c1', topic: 'Anything' })).toBe('course:c1');
    expect(groupKeyOf({ courseId: null, topic: 'Excel!' })).toBe('topic:excel');
  });
});

describe('preselectedQuarter: what most departments asked, the earliest on a tie', () => {
  it('counts departments, not needs', () => {
    expect(
      preselectedQuarter([
        { departmentId: 'a', quarter: 3 },
        { departmentId: 'a', quarter: 3 },
        { departmentId: 'b', quarter: 2 },
        { departmentId: 'c', quarter: 2 },
      ]),
    ).toBe(2);
  });

  it('takes the earliest on a tie and Q1 when nobody said', () => {
    expect(
      preselectedQuarter([
        { departmentId: 'a', quarter: 4 },
        { departmentId: 'b', quarter: 2 },
      ]),
    ).toBe(2);
    expect(preselectedQuarter([{ departmentId: 'a', quarter: null }])).toBe(1);
    expect(preselectedQuarter([])).toBe(1);
  });
});

describe('buildLines (D11)', () => {
  it('puts the same course in one line, else the same topic', () => {
    const lines = buildLines([
      need({ id: 'n1', departmentId: 'sales', topic: 'Excel – advanced formulas', quarter: 2 }),
      need({ id: 'n2', departmentId: 'hr', topic: 'excel advanced formulas', quarter: 2 }),
      need({ id: 'n3', departmentId: 'fin', topic: 'EXCEL: Advanced formulas', quarter: 3 }),
      need({ id: 'n4', departmentId: 'sales', topic: 'Leadership', courseId: 'lead' }),
      need({ id: 'n5', departmentId: 'ops', topic: 'Leading teams', courseId: 'lead' }),
      need({ id: 'n6', departmentId: 'it', topic: 'الأمن السيبراني' }),
      need({ id: 'n7', departmentId: 'fin', topic: 'الامن السيبرانى' }),
    ]);
    expect(lines.map((l) => [l.groupKey, l.needIds])).toEqual([
      ['topic:excel advanced formulas', ['n1', 'n2', 'n3']],
      ['course:lead', ['n4', 'n5']],
      ['topic:الامن السيبراني', ['n6', 'n7']],
    ]);
    expect(lines[0]).toMatchObject({ quarter: 2, courseId: null });
    expect(lines[1]).toMatchObject({ courseId: 'lead', title: 'Leadership' });
  });

  it('joins a typed topic to the course line whose needs read the same', () => {
    const lines = buildLines([
      need({ id: 'n1', topic: 'Customer service', departmentId: 'hr' }),
      need({ id: 'n2', topic: 'Customer Service', courseId: 'cs', departmentId: 'sales' }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      groupKey: 'course:cs',
      courseId: 'cs',
      needIds: ['n1', 'n2'],
    });
  });

  it('takes the title, delivery type and category most needs used', () => {
    const [line] = buildLines([
      need({ id: 'a', topic: 'excel', deliveryType: 'virtual', category: 'digital' }),
      need({ id: 'b', topic: 'Excel', deliveryType: 'classroom', category: 'digital' }),
      need({ id: 'c', topic: 'Excel', deliveryType: 'classroom', category: null }),
    ]);
    expect(line).toMatchObject({ title: 'Excel', deliveryType: 'classroom', category: 'digital' });
  });

  it('builds nothing from nothing', () => {
    expect(buildLines([])).toEqual([]);
  });
});

describe('attachNeeds: a resubmitted department (D14)', () => {
  const lines = [
    {
      id: 'L1',
      groupKey: 'topic:excel',
      edited: false,
      status: 'in_plan' as const,
      topicKeys: ['excel'],
    },
    {
      id: 'L2',
      groupKey: 'topic:leadership',
      edited: true,
      status: 'in_plan' as const,
      topicKeys: [],
    },
    {
      id: 'L3',
      groupKey: 'course:cs',
      edited: false,
      status: 'in_plan' as const,
      topicKeys: ['customer service'],
    },
    {
      id: 'L4',
      groupKey: 'topic:safety',
      edited: false,
      status: 'left_out' as const,
      topicKeys: [],
    },
  ];

  it('joins a line L&D has not touched, never an edited or left-out one', () => {
    const result = attachNeeds(lines, [
      need({ id: 'n1', topic: 'EXCEL' }),
      need({ id: 'n2', topic: 'Leadership' }),
      need({ id: 'n3', topic: 'customer service!' }),
      need({ id: 'n4', topic: 'Safety' }),
      need({ id: 'n5', topic: 'Leadership' }),
    ]);
    expect(result.joins).toEqual([
      { needId: 'n1', lineId: 'L1' },
      { needId: 'n3', lineId: 'L3' },
    ]);
    expect(result.newLines.map((l) => [l.groupKey, l.needIds])).toEqual([
      ['topic:leadership', ['n2', 'n5']],
      ['topic:safety', ['n4']],
    ]);
  });
});

describe('sessions and cost (D12)', () => {
  it('spreads people evenly: 47 people, 8–20 → 3 sessions of 16, 16 and 15', () => {
    expect(sessionPlan(47, 8, 20)).toEqual({
      sessions: 3,
      sizes: [16, 16, 15],
      belowMinimum: false,
    });
    expect(sessionPlan(40, null, 20)).toEqual({
      sessions: 2,
      sizes: [20, 20],
      belowMinimum: false,
    });
    expect(sessionPlan(1, 1, 1)).toEqual({ sessions: 1, sizes: [1], belowMinimum: false });
  });

  it('flags fewer people than the minimum', () => {
    expect(sessionPlan(5, 8, 20)).toEqual({ sessions: 1, sizes: [5], belowMinimum: true });
    // 21 people, 15–20: two sessions of 11 and 10, each under the minimum.
    expect(sessionPlan(21, 15, 20)?.belowMinimum).toBe(true);
  });

  it('needs a maximum; no people, no session', () => {
    expect(sessionPlan(47, 8, null)).toBeNull();
    expect(sessionPlan(0, 8, 20)).toEqual({ sessions: 0, sizes: [], belowMinimum: false });
  });

  it('costs sessions × cost per session + people × cost per person', () => {
    expect(lineCost(3, 47, '5000', null)).toBe('15000');
    expect(lineCost(3, 47, '5000', '100.5')).toBe('19723.5');
    expect(lineCost(3, 47, '0', null)).toBe('0');
    expect(lineCost(null, 47, '5000', null)).toBeNull();
    expect(lineCost(3, 47, null, '100')).toBeNull();
    // Large amounts stay exact.
    expect(lineCost(10_000, 100_000, '999999999999', '999999999999.999')).toBe(
      '109999999999989900',
    );
  });
});

describe('splitBySeats: a shared line, shares that add up exactly', () => {
  const sum = (shares: Map<string, string>) =>
    fromMilli([...shares.values()].reduce((n, v) => n + (toMilli(v) ?? 0n), 0n));

  it('splits by seats in the currency’s smallest unit', () => {
    const shares = splitBySeats('15000', [
      { key: 'sales', seats: 20 },
      { key: 'hr', seats: 15 },
      { key: 'fin', seats: 12 },
    ]);
    expect(Object.fromEntries(shares)).toEqual({ sales: '6382.98', hr: '4787.23', fin: '3829.79' });
    expect(sum(shares)).toBe('15000');
  });

  it('gives the leftover cents to the largest remainders, then more seats, then the earlier', () => {
    const shares = splitBySeats('100', [
      { key: 'a', seats: 1 },
      { key: 'b', seats: 1 },
      { key: 'c', seats: 1 },
    ]);
    expect(Object.fromEntries(shares)).toEqual({ a: '33.34', b: '33.33', c: '33.33' });
    expect(sum(shares)).toBe('100');
  });

  it('keeps a finer total exact and splits three-decimal currencies in fils', () => {
    const fine = splitBySeats('10.005', [
      { key: 'a', seats: 2 },
      { key: 'b', seats: 1 },
    ]);
    expect(sum(fine)).toBe('10.005');
    expect(
      Object.fromEntries(
        splitBySeats(
          '1',
          [
            { key: 'a', seats: 1 },
            { key: 'b', seats: 2 },
          ],
          3,
        ),
      ),
    ).toEqual({
      a: '0.333',
      b: '0.667',
    });
  });

  it('handles one department, no seats and no departments', () => {
    expect(Object.fromEntries(splitBySeats('7', [{ key: 'a', seats: 3 }]))).toEqual({ a: '7' });
    expect(
      Object.fromEntries(
        splitBySeats('7', [
          { key: 'a', seats: 0 },
          { key: 'b', seats: 0 },
        ]),
      ),
    ).toEqual({
      a: '7',
      b: '0',
    });
    expect(splitBySeats('7', []).size).toBe(0);
  });
});

describe('lineFigures', () => {
  it('works out people, named, sessions, cost and shares', () => {
    const figures = lineFigures({
      minPerSession: 8,
      maxPerSession: 20,
      costPerSession: '5000',
      costPerPerson: null,
      departments: [
        { departmentId: 'sales', seats: 20, named: 25 },
        { departmentId: 'hr', seats: 15, named: 3 },
        { departmentId: 'fin', seats: 12, named: 0 },
      ],
    });
    expect(figures.people).toBe(47);
    expect(figures.named).toBe(23);
    expect(figures.plan?.sizes).toEqual([16, 16, 15]);
    expect(figures.cost).toBe('15000');
    expect(figures.shares.get('fin')).toBe('3829.79');
  });

  it('has no cost and no shares without a cost per session', () => {
    const figures = lineFigures({
      minPerSession: null,
      maxPerSession: 20,
      costPerSession: null,
      costPerPerson: null,
      departments: [{ departmentId: 'a', seats: 3, named: 0 }],
    });
    expect(figures.cost).toBeNull();
    expect(figures.shares.size).toBe(0);
    expect(figures.plan?.sessions).toBe(1);
  });
});

describe('budget check (D13, BR-PLN-f)', () => {
  it('says within with what is left, or over by X and how far (amber under 10 %, red from 10 %)', () => {
    expect(budgetState('30000', '35000')).toEqual({ kind: 'within', left: '5000' });
    expect(budgetState('35000', '35000')).toEqual({ kind: 'within', left: '0' });
    expect(budgetState('39473', '35000')).toEqual({
      kind: 'over',
      overBy: '4473',
      percentOver: 12.8,
      severity: 'red',
    });
    expect(budgetState('20181', '20000')).toEqual({
      kind: 'over',
      overBy: '181',
      percentOver: 0.9,
      severity: 'amber',
    });
    expect(budgetState('22000', '20000')).toMatchObject({ percentOver: 10, severity: 'red' });
    expect(budgetState('1', '0')).toEqual({
      kind: 'over',
      overBy: '1',
      percentOver: null,
      severity: 'red',
    });
    expect(budgetState('100', null)).toEqual({ kind: 'none' });
  });

  it('sums each department’s shares of costed lines in the plan; left-out and uncosted lines do not count', () => {
    const result = budgetCheck(
      [
        { departmentId: 'sales', envelope: '10000' },
        { departmentId: 'hr', envelope: '5000' },
        { departmentId: 'it', envelope: null },
      ],
      [
        {
          lineId: 'L1',
          status: 'in_plan',
          cost: '15000',
          shares: new Map([
            ['sales', '10000'],
            ['hr', '5000'],
          ]),
          departments: [
            { departmentId: 'sales', seats: 20 },
            { departmentId: 'hr', seats: 10 },
          ],
        },
        {
          lineId: 'L2',
          status: 'in_plan',
          cost: null,
          shares: new Map(),
          departments: [{ departmentId: 'sales', seats: 4 }],
        },
        {
          lineId: 'L3',
          status: 'left_out',
          cost: '9000',
          shares: new Map([['hr', '9000']]),
          departments: [{ departmentId: 'hr', seats: 9 }],
        },
        {
          lineId: 'L4',
          status: 'in_plan',
          cost: '2500',
          shares: new Map([['sales', '2500']]),
          departments: [{ departmentId: 'sales', seats: 2 }],
        },
      ],
    );
    expect(result.departments).toEqual([
      {
        departmentId: 'sales',
        lines: 3,
        people: 26,
        cost: '12500',
        uncostedLines: 1,
        envelope: '10000',
        state: { kind: 'over', overBy: '2500', percentOver: 25, severity: 'red' },
      },
      {
        departmentId: 'hr',
        lines: 1,
        people: 10,
        cost: '5000',
        uncostedLines: 0,
        envelope: '5000',
        state: { kind: 'within', left: '0' },
      },
      {
        departmentId: 'it',
        lines: 0,
        people: 0,
        cost: '0',
        uncostedLines: 0,
        envelope: null,
        state: { kind: 'none' },
      },
    ]);
    expect(result.total).toEqual({
      people: 36,
      cost: '17500',
      envelope: '15000',
      state: { kind: 'over', overBy: '2500', percentOver: 16.7, severity: 'red' },
    });
  });

  it('has no total envelope when no department has one', () => {
    expect(budgetCheck([{ departmentId: 'a', envelope: null }], []).total.state).toEqual({
      kind: 'none',
    });
  });
});

describe('look alike (attention hint)', () => {
  it('finds titles that are the same, contained or one typo apart', () => {
    expect(
      looksAlike({ title: 'Excel', courseId: null }, { title: 'excel!', courseId: null }),
    ).toBe(true);
    expect(
      looksAlike(
        { title: 'Excel', courseId: null },
        { title: 'Excel advanced formulas', courseId: null },
      ),
    ).toBe(true);
    expect(
      looksAlike(
        { title: 'Leadreship skills', courseId: null },
        { title: 'Leadership skills', courseId: null },
      ),
    ).toBe(true);
    expect(
      looksAlike(
        { title: 'Project management basics', courseId: null },
        { title: 'Basics of project management', courseId: null },
      ),
    ).toBe(true);
    expect(
      looksAlike(
        { title: 'مهارات القيادة', courseId: null },
        { title: 'مهارات القياده', courseId: null },
      ),
    ).toBe(true);
  });

  it('keeps different trainings apart, and two different courses always', () => {
    expect(
      looksAlike({ title: 'Excel', courseId: null }, { title: 'Leadership', courseId: null }),
    ).toBe(false);
    expect(
      looksAlike(
        { title: 'Fire safety', courseId: null },
        { title: 'Food safety', courseId: null },
      ),
    ).toBe(false);
    expect(looksAlike({ title: 'Excel', courseId: 'a' }, { title: 'Excel', courseId: 'b' })).toBe(
      false,
    );
    expect(looksAlike({ title: 'Excel', courseId: 'a' }, { title: 'Other', courseId: 'a' })).toBe(
      true,
    );
    expect(looksAlike({ title: 'IT', courseId: null }, { title: '...', courseId: null })).toBe(
      false,
    );
  });

  it('pairs lines in the plan only', () => {
    expect(
      lookAlikePairs([
        { id: 'a', title: 'Excel', courseId: null, status: 'in_plan' },
        { id: 'b', title: 'Excel basics', courseId: null, status: 'in_plan' },
        { id: 'c', title: 'excel', courseId: null, status: 'left_out' },
        { id: 'd', title: 'Leadership', courseId: null, status: 'in_plan' },
      ]),
    ).toEqual([['a', 'b']]);
  });
});

describe('groupLines (Group by)', () => {
  const line = (
    id: string,
    over: Partial<Parameters<typeof groupLines>[0][number]> = {},
  ): Parameters<typeof groupLines>[0][number] => ({
    id,
    status: 'in_plan',
    quarter: 1,
    deliveryType: null,
    category: null,
    cost: '1000',
    sessions: 1,
    shares: new Map([['sales', '1000']]),
    departments: [{ departmentId: 'sales', seats: 10 }],
    ...over,
  });

  it('groups by quarter in order with subtotals of the lines in the plan', () => {
    const groups = groupLines(
      [
        line('a', { quarter: 3 }),
        line('b', { quarter: 1, cost: null }),
        line('c', { quarter: 3, status: 'left_out' }),
        line('d', { quarter: 1 }),
      ],
      'quarter',
    );
    expect(groups).toEqual([
      { key: '1', lineIds: ['b', 'd'], people: 20, sessions: 2, cost: '1000', uncosted: 1 },
      { key: '3', lineIds: ['a', 'c'], people: 10, sessions: 1, cost: '1000', uncosted: 0 },
    ]);
  });

  it('groups by delivery type and topic, «none» last', () => {
    expect(
      groupLines(
        [line('a'), line('b', { deliveryType: 'virtual' }), line('c', { deliveryType: 'virtual' })],
        'delivery_type',
      ).map((g) => [g.key, g.lineIds]),
    ).toEqual([
      ['virtual', ['b', 'c']],
      [null, ['a']],
    ]);
    expect(groupLines([line('a', { category: 'digital' })], 'topic').map((g) => g.key)).toEqual([
      'digital',
    ]);
  });

  it('shows a line shared across branches in each, with that branch’s seats and share', () => {
    const groups = groupLines(
      [
        line('a', {
          cost: '1500',
          shares: new Map([
            ['sales', '1000'],
            ['ops', '500'],
          ]),
          departments: [
            { departmentId: 'sales', seats: 20 },
            { departmentId: 'ops', seats: 10 },
          ],
        }),
      ],
      'branch',
      (d) => (d === 'sales' ? 'riyadh' : 'jeddah'),
    );
    expect(groups).toEqual([
      { key: 'riyadh', lineIds: ['a'], people: 20, sessions: 1, cost: '1000', uncosted: 0 },
      { key: 'jeddah', lineIds: ['a'], people: 10, sessions: 1, cost: '500', uncosted: 0 },
    ]);
  });
});

describe('the needs form’s answers', () => {
  const fields = [
    { id: 'topic', type: 'text', options: [] },
    {
      id: 'cat',
      type: 'select',
      options: [{ value: 'technical' }, { value: 'digital' }],
    },
    {
      id: 'del',
      type: 'select',
      options: [{ value: 'classroom' }, { value: 'virtual' }, { value: 'on_the_job' }],
    },
    { id: 'pri', type: 'select', options: [{ value: 'critical' }, { value: 'low' }] },
    {
      id: 'qtr',
      type: 'select',
      options: [{ value: 'q1' }, { value: 'q2' }, { value: 'q3' }, { value: 'q4' }],
    },
  ];

  it('finds the fields by their option values', () => {
    expect(planFormFields(fields, ['technical', 'digital', 'leadership'])).toEqual({
      quarter: 'qtr',
      priority: 'pri',
      deliveryType: 'del',
      category: 'cat',
    });
    expect(planFormFields([], [])).toEqual({
      quarter: null,
      priority: null,
      deliveryType: null,
      category: null,
    });
  });

  it('reads a need’s answers, ignoring unknown values', () => {
    const map = planFormFields(fields, ['technical', 'digital']);
    expect(
      needAnswers({ qtr: 'q3', pri: 'critical', del: 'virtual', cat: 'digital' }, map),
    ).toEqual({
      quarter: 3,
      priority: 'critical',
      deliveryType: 'virtual',
      category: 'digital',
    });
    expect(needAnswers({ qtr: 'q9', pri: 42, del: 'boat', cat: 'no spaces allowed' }, map)).toEqual(
      {
        quarter: null,
        priority: null,
        deliveryType: null,
        category: null,
      },
    );
  });
});

describe('consolidationReadiness (Q1 = A)', () => {
  const base = {
    cycleStatus: 'open',
    latestDeadline: '2026-12-01',
    today: '2026-11-15',
    planExists: false,
    departments: 3,
    submitted: 3,
  };

  it('opens after the deadline whatever was submitted', () => {
    expect(consolidationReadiness({ ...base, today: '2026-12-02', submitted: 1 })).toEqual({
      ready: true,
      closeEarly: false,
    });
    expect(consolidationReadiness({ ...base, cycleStatus: 'closed', submitted: 0 })).toEqual({
      ready: true,
      closeEarly: false,
    });
  });

  it('opens early only once every department has submitted', () => {
    expect(consolidationReadiness(base)).toEqual({ ready: true, closeEarly: true });
    expect(consolidationReadiness({ ...base, submitted: 2 })).toEqual({
      ready: false,
      reason: 'waiting_for_departments',
      waiting: 1,
    });
    expect(consolidationReadiness({ ...base, departments: 0, submitted: 0 })).toMatchObject({
      ready: false,
      reason: 'no_departments',
    });
  });

  it('refuses a draft cycle and a plan already open', () => {
    expect(consolidationReadiness({ ...base, cycleStatus: 'draft' })).toMatchObject({
      reason: 'not_launched',
    });
    expect(consolidationReadiness({ ...base, planExists: true })).toMatchObject({
      reason: 'already_open',
    });
  });
});
