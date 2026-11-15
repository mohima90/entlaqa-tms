import 'server-only';
import type {
  CalendarDraftView,
  CourseBriefView,
  DraftProposalView,
  DraftSessionDetailView,
  PlanDeliveryView,
  PlanLineDeliveryView,
  PlanView,
  TrainingCalendarView,
} from '@jadarat/tms';
import {
  type LineSessionState,
  draftCost,
  lineSessionState,
  proposeSessions,
  quarterMonths,
} from '@jadarat/tms/session-rules';
import { DEPT, planFixture } from '../components/training-plan/plan-fixture';

/**
 * Example data of «Courses and sessions» and the training calendar without a database (local development and the
 * default CI run, WP-LD-04): the Plan tab's example plan, approved, with one line drafted (Excel: 3 sessions, Jan –
 * Mar), one with its course and no drafts, two without a course and one left out. Fake names; never stored.
 */

const BRANCH = {
  riyadh: '60000000-0000-4000-8000-000000000001',
  jeddah: '60000000-0000-4000-8000-000000000002',
} as const;
const BRANCHES = [
  { id: BRANCH.riyadh, name: { ar: 'الرياض', en: 'Riyadh' } },
  { id: BRANCH.jeddah, name: { ar: 'جدة', en: 'Jeddah' } },
];
const BRANCH_OF: Record<string, string> = {
  [DEPT.sales]: BRANCH.jeddah,
  [DEPT.hr]: BRANCH.riyadh,
  [DEPT.finance]: BRANCH.riyadh,
  [DEPT.it]: BRANCH.riyadh,
};

const COURSES: Record<string, CourseBriefView> = {
  excel: {
    id: '30000000-0000-4000-8000-000000000001',
    code: 'CRS-014',
    titleEn: 'Excel – advanced formulas',
    titleAr: 'إكسل – الصيغ المتقدمة',
    deliveryType: 'classroom',
    durationHours: 12,
    status: 'active',
  },
  security: {
    id: '30000000-0000-4000-8000-000000000003',
    code: 'CRS-002',
    titleEn: 'Information security basics',
    titleAr: 'أساسيات أمن المعلومات',
    deliveryType: 'virtual',
    durationHours: 3,
    status: 'active',
  },
};

const FIRST = ['Reem', 'Majed', 'Noura', 'Turki', 'Hessa', 'Fahad', 'Lama', 'Saad', 'Dana', 'Omar'];
const FIRST_AR = ['ريم', 'ماجد', 'نورة', 'تركي', 'حصة', 'فهد', 'لمى', 'سعد', 'دانة', 'عمر'];
const LAST = ['Khalid', 'Fahad', 'Saad', 'Hassan', 'Ali'];
const LAST_AR = ['خالد', 'فهد', 'سعد', 'حسن', 'علي'];

/** The named people of a department in a line: synthetic ids and names (preview only). */
function people(lineIndex: number, departmentIndex: number, count: number) {
  return Array.from({ length: count }, (_, i) => {
    const n = lineIndex * 1000 + departmentIndex * 100 + i;
    return {
      personId: `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      needId: `80000000-0000-4000-8000-${String(lineIndex * 10 + departmentIndex).padStart(12, '0')}`,
      name: {
        en: `${FIRST[i % FIRST.length] ?? ''} ${LAST[(i + departmentIndex) % LAST.length] ?? ''}`,
        ar: `${FIRST_AR[i % FIRST_AR.length] ?? ''} ${LAST_AR[(i + departmentIndex) % LAST_AR.length] ?? ''}`,
      },
    };
  });
}

/** The approved example plan (the Plan tab's fixture, approved). */
export function previewPlan(): PlanView {
  const plan = planFixture({ manage: false });
  return {
    ...plan,
    plan: plan.plan ? { ...plan.plan, status: 'approved' } : null,
    branches: BRANCHES,
    departments: plan.departments.map((d) => ({ ...d, branchId: BRANCH_OF[d.id] ?? null })),
  };
}

interface PreviewLine {
  readonly line: PlanView['lines'][number];
  readonly index: number;
  readonly course: CourseBriefView | null;
  readonly drafts: readonly { id: string; month: string; branchId: string | null; seats: number }[];
}

function previewLines(): PreviewLine[] {
  const plan = previewPlan();
  const [excel, cyber, security, firstAid, speaking] = plan.lines;
  const lines: PreviewLine[] = [];
  if (excel) {
    lines.push({
      line: excel,
      index: 0,
      course: COURSES.excel ?? null,
      drafts: [
        {
          id: '90000000-0000-4000-8000-000000000001',
          month: '2027-01',
          branchId: BRANCH.riyadh,
          seats: 16,
        },
        {
          id: '90000000-0000-4000-8000-000000000002',
          month: '2027-02',
          branchId: BRANCH.riyadh,
          seats: 16,
        },
        {
          id: '90000000-0000-4000-8000-000000000003',
          month: '2027-03',
          branchId: BRANCH.jeddah,
          seats: 15,
        },
      ],
    });
  }
  if (cyber) lines.push({ line: cyber, index: 1, course: null, drafts: [] });
  if (security)
    lines.push({ line: security, index: 2, course: COURSES.security ?? null, drafts: [] });
  if (firstAid) lines.push({ line: firstAid, index: 3, course: null, drafts: [] });
  if (speaking) lines.push({ line: speaking, index: 4, course: null, drafts: [] });
  return lines;
}

const stateOf = (l: PreviewLine): LineSessionState =>
  lineSessionState({
    status: l.line.status,
    hasCourse: l.course !== null,
    planned: l.line.sessions?.sessions ?? null,
    drafted: l.drafts.length,
  });

export function previewDelivery(): { plan: PlanView; delivery: PlanDeliveryView } {
  const plan = previewPlan();
  const lines: PlanLineDeliveryView[] = previewLines().map((l) => {
    const inPlan = l.line.status === 'in_plan';
    const planned = l.line.sessions?.sessions ?? null;
    return {
      lineId: l.line.id,
      version: l.line.version,
      title: l.line.title,
      status: l.line.status,
      quarter: l.line.quarter,
      quarterMonths: quarterMonths(plan.cycle.periodStart, l.line.quarter),
      deliveryType: l.line.deliveryType,
      durationHours: l.line.durationHours,
      minPerSession: l.line.minPerSession,
      maxPerSession: l.line.maxPerSession,
      costPerSession: l.line.costPerSession,
      costPerPerson: l.line.costPerPerson,
      people: l.line.people,
      named: l.line.named,
      plannedSessions: planned,
      sizes: l.line.sessions?.sizes ?? [],
      course: l.course ? { ...l.course, origin: l.index === 0 ? 'created' : 'linked' } : null,
      drafts: {
        count: l.drafts.length,
        months: l.drafts.map((d) => d.month),
        outsideQuarter: 0,
        seats: l.drafts.reduce((n, d) => n + d.seats, 0),
      },
      state: stateOf(l),
      courseDraft:
        inPlan && l.course === null
          ? {
              titleEn: l.line.title,
              titleAr: null,
              deliveryType: l.line.deliveryType,
              durationHours: l.line.durationHours,
              minParticipants: l.line.minPerSession ?? 1,
              maxParticipants: l.line.maxPerSession ?? 20,
              estCostPerSession:
                l.line.costPerSession === null ? null : Number(l.line.costPerSession),
              estCostPerParticipant: null,
              currency: plan.currency,
            }
          : null,
      can: {
        createCourse: inPlan && l.drafts.length === 0,
        linkCourse: inPlan && l.drafts.length === 0,
        createSessions:
          inPlan && l.course !== null && planned !== null && l.drafts.length < planned,
      },
    };
  });
  const inPlan = lines.filter((l) => l.status === 'in_plan');
  const done = (l: PlanLineDeliveryView) => l.state === 'drafted' || l.state === 'over_drafted';
  return {
    plan,
    delivery: {
      plan: { id: plan.plan?.id ?? '', status: 'approved', planVersion: 1 },
      cycle: {
        id: plan.cycle.id,
        name: plan.cycle.name,
        periodStart: plan.cycle.periodStart,
        periodEnd: plan.cycle.periodEnd,
        currency: plan.currency,
      },
      scope: 'organization',
      lines,
      summary: {
        linesInPlan: inPlan.length,
        leftOut: lines.length - inPlan.length,
        linesWithCourse: inPlan.filter((l) => l.course !== null).length,
        linesWithSessions: inPlan.filter(done).length,
        sessionsPlanned: inPlan.reduce((n, l) => n + (l.plannedSessions ?? 0), 0),
        sessionsDrafted: lines.reduce((n, l) => n + l.drafts.count, 0),
      },
      counts: {
        needsCourse: inPlan.filter((l) => l.course === null).length,
        needsSessions: inPlan.filter(
          (l) => l.state === 'needs_sessions' || l.state === 'partly_drafted',
        ).length,
        sessionsCreated: inPlan.filter(done).length,
      },
    },
  };
}

/** The preview library (Link an existing course). */
export const PREVIEW_LIBRARY = Object.values(COURSES);

/** «Create draft sessions» of a preview line (null: unknown line). */
export function previewProposal(lineId: string): DraftProposalView | null {
  const plan = previewPlan();
  const found = previewLines().find((l) => l.line.id === lineId);
  if (!found) return null;
  const { line, index } = found;
  const months = quarterMonths(plan.cycle.periodStart, line.quarter);
  const departments = line.departments.map((d, i) => ({
    departmentId: d.departmentId,
    branchId: BRANCH_OF[d.departmentId] ?? null,
    seats: d.seats,
    people: people(index, i, d.named),
  }));
  const proposal = proposeSessions({
    count: line.sessions?.sessions ?? 0,
    maxPerSession: line.maxPerSession ?? 1,
    deliveryType: line.deliveryType,
    quarterMonths: months,
    departments,
  });
  const sessions = proposal.sessions.map((s) => ({
    month: s.month,
    branchId: s.branchId,
    seats: s.seats,
    departments: s.departments,
    personIds: s.people.map((p) => p.personId),
    estimatedCost: draftCost(s.seats, line.costPerSession, line.costPerPerson),
    outsideQuarter: false,
  }));
  const seats = sessions.reduce((n, s) => n + s.seats, 0);
  const canCreate = found.course !== null && line.status === 'in_plan' && found.drafts.length === 0;
  return {
    line: {
      id: line.id,
      title: line.title,
      status: line.status,
      quarter: line.quarter,
      quarterMonths: months,
      deliveryType: line.deliveryType,
      minPerSession: line.minPerSession,
      maxPerSession: line.maxPerSession,
      costPerSession: line.costPerSession,
      costPerPerson: line.costPerPerson,
      people: line.people,
      named: line.named,
      plannedSessions: line.sessions?.sessions ?? null,
      sizes: line.sessions?.sizes ?? [],
      cost: line.cost,
      course: found.course,
    },
    plan: { id: plan.plan?.id ?? '', status: 'approved', planVersion: 1 },
    cycle: {
      id: plan.cycle.id,
      name: plan.cycle.name,
      periodStart: plan.cycle.periodStart,
      periodEnd: plan.cycle.periodEnd,
      currency: plan.currency,
    },
    departments: departments.map((d) => ({
      departmentId: d.departmentId,
      name: plan.departments.find((x) => x.id === d.departmentId)?.name ?? { ar: null, en: null },
      branchId: d.branchId,
      seats: d.seats,
      named: d.people.length,
    })),
    branches: BRANCHES,
    people: departments.flatMap((d) =>
      d.people.map((p) => ({
        personId: p.personId,
        name: p.name,
        departmentId: d.departmentId,
        needId: p.needId,
        sessionId: null,
      })),
    ),
    existing: { count: 0, months: [] },
    remaining: canCreate ? sessions.length : 0,
    proposal: {
      sessions,
      branchToCheck: proposal.branchToCheck,
      branchSeats: proposal.branches,
    },
    check: {
      seats,
      people: line.people,
      allPlaced: seats >= line.people,
      cost: line.cost,
      matchesPlan: true,
    },
    problem:
      found.course === null
        ? 'SESSION_LINE_NEEDS_COURSE'
        : canCreate
          ? null
          : 'SESSION_LINE_ALL_DRAFTED',
    canCreate,
  };
}

function previewDrafts(): CalendarDraftView[] {
  const plan = previewPlan();
  return previewLines().flatMap((l) =>
    l.drafts.map((d, i) => ({
      id: d.id,
      version: 1,
      status: 'draft' as const,
      month: d.month,
      course: l.course,
      lineId: l.line.id,
      lineTitle: l.line.title,
      planId: plan.plan?.id ?? '',
      seats: d.seats,
      participants: Math.min(d.seats, 12),
      branchId: d.branchId,
      deliveryType: l.course?.deliveryType ?? 'classroom',
      estimatedCost: draftCost(d.seats, l.line.costPerSession, l.line.costPerPerson),
      currency: plan.currency,
      ordinal: i + 1,
      planned: l.line.sessions?.sessions ?? null,
      outsideQuarter: false,
      canEdit: true,
    })),
  );
}

/** The preview calendar of a year (the example plan is for 2027; other years are empty). */
export function previewCalendar(input: {
  readonly year: number;
  readonly quarter: number | null;
  readonly branch: string | null;
  readonly course: string | null;
}): TrainingCalendarView {
  const plan = previewPlan();
  const ofYear = input.year === 2027;
  const drafts = previewDrafts().filter(
    (d) =>
      ofYear &&
      (input.branch === null ||
        (input.branch === 'none' ? d.branchId === null : d.branchId === input.branch)) &&
      (input.course === null || d.course?.id === input.course),
  );
  const lines = ofYear
    ? previewLines().filter(
        (l) =>
          l.line.status === 'in_plan' && (input.course === null || l.course?.id === input.course),
      )
    : [];
  const quarters = [1, 2, 3, 4]
    .filter((q) => input.quarter === null || q === input.quarter)
    .map((quarter) => {
      const months = quarterMonths(`${String(input.year)}-01-01`, quarter).map((month) => {
        const inMonth = drafts.filter((d) => d.month === month);
        return {
          month,
          sessions: inMonth.length,
          seats: inMonth.reduce((n, d) => n + d.seats, 0),
          drafts: inMonth,
        };
      });
      const notDrafted = lines
        .filter((l) => l.line.quarter === quarter)
        .map((l) => ({ l, state: stateOf(l) }))
        .filter(({ state }) => ['needs_course', 'needs_sessions', 'partly_drafted'].includes(state))
        .map(({ l, state }) => ({
          lineId: l.line.id,
          planId: plan.plan?.id ?? '',
          cycleId: plan.cycle.id,
          title: l.line.title,
          state,
          course: l.course,
          missing: Math.max(0, (l.line.sessions?.sessions ?? 0) - l.drafts.length),
        }));
      return { quarter, months, notDrafted };
    });
  const shown = quarters.flatMap((q) => q.months.flatMap((m) => m.drafts));
  const shownLines = lines.filter((l) => quarters.some((q) => q.quarter === l.line.quarter));
  return {
    year: input.year,
    plans: ofYear
      ? [
          {
            planId: plan.plan?.id ?? '',
            cycleId: plan.cycle.id,
            name: plan.cycle.name,
            status: 'approved',
            planVersion: 1,
            periodStart: plan.cycle.periodStart,
            periodEnd: plan.cycle.periodEnd,
          },
        ]
      : [],
    summary: {
      drafts: shown.length,
      planned: shownLines.reduce((n, l) => n + (l.line.sessions?.sessions ?? 0), 0),
      seats: shown.reduce((n, d) => n + d.seats, 0),
      estimatedCost:
        shown.length === 0
          ? []
          : [
              {
                currency: plan.currency,
                amount: String(shown.reduce((n, d) => n + Number(d.estimatedCost ?? 0), 0)),
              },
            ],
      linesInPlan: shownLines.length,
      linesWithSessions: shownLines.filter((l) => stateOf(l) === 'drafted').length,
    },
    quarters,
    filters: { branches: BRANCHES, courses: ofYear ? Object.values(COURSES) : [] },
  };
}

/** A preview draft opened from the calendar (null: not one of the example drafts). */
export function previewDraft(sessionId: string): DraftSessionDetailView | null {
  const plan = previewPlan();
  const found = previewLines().find((l) => l.drafts.some((d) => d.id === sessionId));
  const draft = found?.drafts.find((d) => d.id === sessionId);
  if (!found || !draft) return null;
  const { line, index } = found;
  const named = line.departments.flatMap((d, i) =>
    people(index, i, d.named).map((p) => ({ ...p, departmentId: d.departmentId })),
  );
  const ordinal = found.drafts.indexOf(draft) + 1;
  const own = named
    .filter((p) => BRANCH_OF[p.departmentId] === draft.branchId)
    .slice(0, draft.seats);
  const ownIds = new Set(own.map((p) => p.personId));
  const nameOf = (id: string) =>
    plan.departments.find((d) => d.id === id)?.name ?? { ar: null, en: null };
  return {
    session: {
      id: draft.id,
      version: 1,
      status: 'draft',
      month: draft.month,
      branchId: draft.branchId,
      seats: draft.seats,
      deliveryType: found.course?.deliveryType ?? 'classroom',
      estimatedCost: draftCost(draft.seats, line.costPerSession, line.costPerPerson),
      currency: plan.currency,
      ordinal,
      planned: line.sessions?.sessions ?? null,
      drafted: found.drafts.length,
      outsideQuarter: false,
      planVersion: 1,
    },
    course: found.course,
    line: {
      id: line.id,
      title: line.title,
      quarter: line.quarter,
      quarterMonths: quarterMonths(plan.cycle.periodStart, line.quarter),
      status: line.status,
    },
    plan: {
      id: plan.plan?.id ?? '',
      cycleId: plan.cycle.id,
      cycleName: plan.cycle.name,
      status: 'approved',
      planVersion: 1,
      periodStart: plan.cycle.periodStart,
      periodEnd: plan.cycle.periodEnd,
    },
    participants: own.map((p) => ({
      personId: p.personId,
      name: p.name,
      departmentId: p.departmentId,
      departmentName: nameOf(p.departmentId),
      branchId: BRANCH_OF[p.departmentId] ?? null,
      needId: p.needId,
    })),
    candidates: named
      .filter((p) => !ownIds.has(p.personId))
      .map((p) => ({
        personId: p.personId,
        name: p.name,
        departmentId: p.departmentId,
        needId: p.needId,
        sessionId: found.drafts.find((d) => d.branchId === BRANCH_OF[p.departmentId])?.id ?? null,
      })),
    otherSessions: found.drafts.flatMap((d, i) =>
      d.id === draft.id
        ? []
        : [
            {
              id: d.id,
              ordinal: i + 1,
              month: d.month,
              seats: d.seats,
              participants: named.filter((p) => BRANCH_OF[p.departmentId] === d.branchId).length,
            },
          ],
    ),
    unnamedSeats: line.departments
      .filter((d) => d.seats > d.named)
      .map((d) => ({ departmentId: d.departmentId, seats: d.seats - d.named })),
    branches: BRANCHES,
    canEdit: true,
  };
}
