import type { PlanView } from '@jadarat/tms';
import {
  type BudgetLine,
  type GroupableLine,
  type PlanDeliveryType,
  type Quarter,
  budgetCheck,
  groupLines,
  lineFigures,
} from '@jadarat/tms/consolidation-rules';

/**
 * A training plan as the query returns it, for the unit and component tests of the Plan tab (the design's
 * example, made smaller: Sales, Human Resources, Finance and IT). Figures come from the module's own rules.
 */
export const DEPT = {
  sales: '10000000-0000-4000-8000-000000000001',
  hr: '10000000-0000-4000-8000-000000000002',
  finance: '10000000-0000-4000-8000-000000000003',
  it: '10000000-0000-4000-8000-000000000004',
} as const;

const NAMES: Record<string, { ar: string; en: string; head: string }> = {
  [DEPT.sales]: { ar: 'المبيعات', en: 'Sales', head: 'Faisal Hamad' },
  [DEPT.hr]: { ar: 'الموارد البشرية', en: 'Human Resources', head: 'Sara Ali' },
  [DEPT.finance]: { ar: 'المالية', en: 'Finance', head: 'Omar Nasser' },
  [DEPT.it]: { ar: 'تقنية المعلومات', en: 'IT', head: 'Yousef Kareem' },
};

interface LineSpec {
  readonly id: string;
  readonly title: string;
  readonly quarter: Quarter;
  readonly deliveryType: PlanDeliveryType | null;
  readonly category: string | null;
  readonly min: number | null;
  readonly max: number | null;
  readonly costPerSession: string | null;
  readonly status?: 'in_plan' | 'left_out';
  readonly leftOutReason?: string;
  readonly courseId?: string | null;
  readonly canEdit?: boolean;
  readonly needs: readonly {
    readonly id: string;
    readonly departmentId: string;
    readonly seats: number;
    readonly named: number;
    readonly quarter: Quarter | null;
    readonly priority: 'critical' | 'high' | 'medium' | 'low' | null;
  }[];
}

const LINES: readonly LineSpec[] = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    title: 'Excel – advanced formulas',
    quarter: 1,
    deliveryType: 'classroom',
    category: 'digital',
    min: 8,
    max: 20,
    costPerSession: '5000',
    courseId: '30000000-0000-4000-8000-000000000001',
    needs: [
      { id: 'n1', departmentId: DEPT.sales, seats: 20, named: 12, quarter: 1, priority: 'high' },
      { id: 'n2', departmentId: DEPT.hr, seats: 15, named: 15, quarter: 1, priority: 'medium' },
      { id: 'n3', departmentId: DEPT.finance, seats: 12, named: 0, quarter: 2, priority: 'high' },
    ],
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    title: 'Cyber security awareness',
    quarter: 1,
    deliveryType: 'virtual',
    category: 'digital',
    min: 10,
    max: 55,
    costPerSession: '2500',
    needs: [
      { id: 'n4', departmentId: DEPT.sales, seats: 40, named: 0, quarter: 1, priority: null },
      { id: 'n5', departmentId: DEPT.hr, seats: 25, named: 0, quarter: 1, priority: null },
    ],
  },
  {
    id: '20000000-0000-4000-8000-000000000003',
    title: 'Information security basics',
    quarter: 1,
    deliveryType: 'virtual',
    category: 'digital',
    min: 6,
    max: 12,
    costPerSession: '2500',
    needs: [{ id: 'n6', departmentId: DEPT.it, seats: 12, named: 12, quarter: 1, priority: 'low' }],
  },
  {
    id: '20000000-0000-4000-8000-000000000004',
    title: 'First aid at work',
    quarter: 2,
    deliveryType: 'classroom',
    category: 'safety',
    min: 6,
    max: 12,
    costPerSession: null,
    needs: [{ id: 'n7', departmentId: DEPT.it, seats: 12, named: 0, quarter: 2, priority: null }],
  },
  {
    id: '20000000-0000-4000-8000-000000000005',
    title: 'Public speaking',
    quarter: 3,
    deliveryType: null,
    category: null,
    min: null,
    max: null,
    costPerSession: null,
    status: 'left_out',
    leftOutReason: 'Not a priority this year.',
    needs: [{ id: 'n8', departmentId: DEPT.sales, seats: 8, named: 0, quarter: 3, priority: null }],
  },
];

const ENVELOPES: Record<string, string | null> = {
  [DEPT.sales]: '20000',
  [DEPT.hr]: '6000',
  [DEPT.finance]: '3800',
  [DEPT.it]: null,
};

export function planFixture(overrides: { readonly manage?: boolean } = {}): PlanView {
  const manage = overrides.manage ?? true;
  const lines = LINES.map((spec) => {
    const perDepartment = [...new Set(spec.needs.map((n) => n.departmentId))].map(
      (departmentId) => ({
        departmentId,
        seats: spec.needs
          .filter((n) => n.departmentId === departmentId)
          .reduce((s, n) => s + n.seats, 0),
        named: spec.needs
          .filter((n) => n.departmentId === departmentId)
          .reduce((s, n) => s + n.named, 0),
      }),
    );
    const figures = lineFigures(
      {
        minPerSession: spec.min,
        maxPerSession: spec.max,
        costPerSession: spec.costPerSession,
        costPerPerson: null,
        departments: perDepartment,
      },
      2,
    );
    return {
      id: spec.id,
      version: 1,
      title: spec.title,
      courseId: spec.courseId ?? null,
      deliveryType: spec.deliveryType,
      category: spec.category,
      quarter: spec.quarter,
      minPerSession: spec.min,
      maxPerSession: spec.max,
      costPerSession: spec.costPerSession,
      costPerPerson: null,
      durationHours: null,
      status: spec.status ?? ('in_plan' as const),
      leftOutReason: spec.leftOutReason ?? null,
      edited: false,
      people: figures.people,
      named: figures.named,
      sessions: figures.plan,
      cost: figures.cost,
      departments: [...perDepartment]
        .sort((a, b) => b.seats - a.seats)
        .map((d) => ({ ...d, share: figures.shares.get(d.departmentId) ?? null })),
      needs: spec.needs.map((n) => ({
        needId: n.id,
        departmentId: n.departmentId,
        topic: spec.title,
        courseId: spec.courseId ?? null,
        seats: n.seats,
        named: n.named,
        priority: n.priority,
        quarter: n.quarter,
      })),
      priorities: { critical: 0, high: 0, medium: 0, low: 0, none: 0 },
      canEdit: spec.canEdit ?? true,
    };
  });
  const budgetLines: BudgetLine[] = lines.map((l) => ({
    lineId: l.id,
    status: l.status,
    cost: l.cost,
    shares: new Map(
      l.departments.flatMap((d) => (d.share === null ? [] : [[d.departmentId, d.share] as const])),
    ),
    departments: l.departments,
  }));
  const check = budgetCheck(
    Object.values(DEPT).map((id) => ({ departmentId: id, envelope: ENVELOPES[id] ?? null })),
    budgetLines,
  );
  const groupable: GroupableLine[] = lines.map((l) => ({
    id: l.id,
    status: l.status,
    quarter: l.quarter,
    deliveryType: l.deliveryType,
    category: l.category,
    cost: l.cost,
    sessions: l.sessions?.sessions ?? null,
    shares: new Map(
      l.departments.flatMap((d) => (d.share === null ? [] : [[d.departmentId, d.share] as const])),
    ),
    departments: l.departments,
  }));
  const inPlan = lines.filter((l) => l.status === 'in_plan');
  const rows = check.departments.map((row) => ({
    ...row,
    name: { ar: NAMES[row.departmentId]?.ar ?? '', en: NAMES[row.departmentId]?.en ?? null },
    reason: row.departmentId === DEPT.finance ? 'Required by the auditor.' : null,
    needsReason: row.state.kind === 'over' && row.departmentId !== DEPT.finance,
  }));
  return {
    today: '2026-11-15',
    currency: 'SAR',
    fractionDigits: 2,
    cycle: {
      id: '40000000-0000-4000-8000-000000000001',
      name: { ar: 'خطة 2027', en: 'Training plan 2027' },
      periodStart: '2027-01-01',
      periodEnd: '2027-12-31',
      deadline: '2026-11-30',
      latestDeadline: '2026-11-30',
      status: 'closed',
    },
    scope: 'organization',
    plan: {
      id: '50000000-0000-4000-8000-000000000001',
      status: 'draft',
      planVersion: 1,
      openedAt: '2026-11-15T08:00:00.000Z',
      needsClosedEarly: true,
    },
    readiness: null,
    departments: Object.values(DEPT).map((id) => ({
      id,
      name: { ar: NAMES[id]?.ar ?? '', en: NAMES[id]?.en ?? null },
      levelOrdinal: 1,
      branchId: null,
      head: { ar: null, en: NAMES[id]?.head ?? null },
      formStatus: 'submitted' as const,
      ownDeadline: null,
      version: 2,
    })),
    lines,
    groups: {
      topic: groupLines(groupable, 'topic'),
      branch: groupLines(groupable, 'branch'),
      delivery_type: groupLines(groupable, 'delivery_type'),
      quarter: groupLines(groupable, 'quarter'),
    },
    budget: { departments: rows, total: check.total },
    summary: {
      lines: inPlan.length,
      leftOut: lines.length - inPlan.length,
      people: inPlan.reduce((n, l) => n + l.people, 0),
      sessions: inPlan.reduce((n, l) => n + (l.sessions?.sessions ?? 0), 0),
      cost: check.total.cost,
      envelope: check.total.envelope,
    },
    attention: {
      uncostedLineIds: inPlan.filter((l) => l.cost === null).map((l) => l.id),
      belowMinimumLineIds: [],
      lookAlikes: [[LINES[1]?.id ?? '', LINES[2]?.id ?? '']],
      overBudgetWithoutReason: rows.filter((r) => r.needsReason).map((r) => r.departmentId),
      pending: { needs: 1, changed: 0, departmentIds: [DEPT.hr] },
    },
    branches: [],
    categories: [
      { value: 'digital', label: { ar: 'المهارات الرقمية', en: 'Digital skills' } },
      { value: 'safety', label: { ar: 'الصحة والسلامة', en: 'Health and safety' } },
    ],
    levels: [],
    can: { open: false, manage, addPending: manage },
  };
}
