import {
  type BudgetState,
  type LineStatus,
  type PlanDeliveryType,
  type Quarter,
  type SessionPlan,
  amountMilli,
  budgetCheck,
  budgetState,
  currencyFractionDigits,
  fromMilli,
  lineFigures,
} from './consolidation-rules';

/**
 * Plan approval rules (WP-LD-03, T-M3-07; FR-PLN-08, FR-WFL-01/02 R1 part; business flow
 * docs/business-flows/EP-PLN-planning-cycle.md §13 and §3 F; proposal
 * docs/product/proposals/wp-ld-02-03-consolidation-approval.md §2 B and §3, its questions answered «A»; approved
 * screens docs/design/screens/m3-consolidation-approval/README.md 4–6b). Pure: shared by the server and the
 * browser (`@jadarat/tms/approval-rules`). The database decides the same (migration 20261116100200).
 *
 *   draft / sent_back ─submit→ in_approval (hr) ─HR approves→ in_approval (finance, only when «Finance confirms the
 *   plan» was on) ─Finance confirms→ approved (version N, locked) ─revise→ draft (version N + 1)
 *   Any decision may send the plan back with one comment (Q5 = A). The first decision settles the step.
 */

/** The two approval steps: the HR Manager role, then the ready-made Finance role (optional per organization). */
export const APPROVAL_STEPS = ['hr', 'finance'] as const;
export type ApprovalStep = (typeof APPROVAL_STEPS)[number];

export const PLAN_DECISIONS = ['approve', 'send_back'] as const;
export type PlanDecision = (typeof PLAN_DECISIONS)[number];

/** The approver's comment when sending the plan back (one for the whole plan, Q5 = A). */
export const SEND_BACK_COMMENT_MAX = 2000;

/** Why the database refused a submission (migration 20261116100200, JK010). */
export const SUBMIT_PROBLEMS = [
  'needs_open',
  'needs_not_added',
  'uncosted',
  'over_budget',
] as const;
export type SubmitProblem = (typeof SUBMIT_PROBLEMS)[number];

export function submitProblemOf(message: string | null | undefined): SubmitProblem | null {
  const reason = message?.split(': ').at(-1)?.trim() ?? '';
  return (SUBMIT_PROBLEMS as readonly string[]).includes(reason) ? (reason as SubmitProblem) : null;
}

/** Where a step stands for the steps list (design 5b): done, waiting (now), later, off (not asked), or none yet. */
export type StepState = 'done' | 'waiting' | 'later' | 'off' | 'not_started';

export interface ApprovalFacts {
  readonly status: 'draft' | 'in_approval' | 'approved' | 'sent_back';
  readonly approvalStep: ApprovalStep | null;
  /** Finance was asked for the current submission (the switch at submission). */
  readonly financeStep: boolean;
  /** The organization's switch now (what the next submission will ask). */
  readonly financeSwitch: boolean;
  readonly hrDecided: boolean;
}

/** The state of each step: for the submit popup (before submission) and the review's side column. */
export function stepStates(facts: ApprovalFacts): Readonly<Record<ApprovalStep, StepState>> {
  const finance =
    facts.status === 'in_approval' || facts.status === 'approved'
      ? facts.financeStep
      : facts.financeSwitch;
  if (facts.status === 'in_approval') {
    if (facts.approvalStep === 'hr') return { hr: 'waiting', finance: finance ? 'later' : 'off' };
    return { hr: 'done', finance: 'waiting' };
  }
  if (facts.status === 'approved') {
    return { hr: 'done', finance: finance ? 'done' : 'off' };
  }
  return { hr: 'not_started', finance: finance ? 'not_started' : 'off' };
}

/** Which step the viewer decides now (deny by default): never their own submission, never twice. */
export function decidableStep(
  plan: {
    readonly status: ApprovalFacts['status'];
    readonly approvalStep: ApprovalStep | null;
    readonly submittedBy: string | null;
    readonly hrDecidedBy: string | null;
  },
  viewer: {
    readonly personId: string | null;
    readonly approve: boolean;
    readonly confirm: boolean;
  },
): ApprovalStep | null {
  if (plan.status !== 'in_approval' || plan.approvalStep === null || viewer.personId === null)
    return null;
  if (viewer.personId === plan.submittedBy) return null;
  if (plan.approvalStep === 'hr') return viewer.approve ? 'hr' : null;
  if (viewer.personId === plan.hrDecidedBy) return null;
  return viewer.confirm ? 'finance' : null;
}

// ---------------------------------------------------------------------------------------------------
// A version as approved, and a department's result (design 6a, 6b)
// ---------------------------------------------------------------------------------------------------

/** A line as the version keeps it (the snapshot the database wrote when the plan was approved). */
export interface VersionLine {
  readonly id: string;
  readonly title: string;
  readonly courseId: string | null;
  readonly deliveryType: PlanDeliveryType | null;
  readonly category: string | null;
  readonly quarter: Quarter;
  readonly minPerSession: number | null;
  readonly maxPerSession: number | null;
  readonly costPerSession: string | null;
  readonly costPerPerson: string | null;
  readonly durationHours: number | null;
  readonly status: LineStatus;
  readonly leftOutReason: string | null;
  readonly sortOrder: number;
  readonly departments: readonly {
    readonly departmentId: string;
    readonly seats: number;
    readonly named: number;
  }[];
}

/** A version line with its figures, as shown. */
export interface VersionLineView extends Omit<VersionLine, 'departments'> {
  readonly people: number;
  readonly sessions: SessionPlan | null;
  readonly cost: string | null;
  readonly departments: readonly {
    readonly departmentId: string;
    readonly seats: number;
    readonly share: string | null;
  }[];
}

export function versionLineView(line: VersionLine, fractionDigits: number): VersionLineView {
  const figures = lineFigures(
    {
      minPerSession: line.minPerSession,
      maxPerSession: line.maxPerSession,
      costPerSession: line.costPerSession,
      costPerPerson: line.costPerPerson,
      departments: line.departments,
    },
    fractionDigits,
  );
  return {
    ...line,
    people: figures.people,
    sessions: figures.plan,
    cost: figures.cost,
    departments: line.departments.map((d) => ({
      departmentId: d.departmentId,
      seats: d.seats,
      share: figures.shares.get(d.departmentId) ?? null,
    })),
  };
}

/** One department's result once the plan is approved (Q4 = A): its approved lines and its left-out lines. */
export interface DepartmentResult {
  readonly approved: readonly {
    readonly line: VersionLineView;
    /** The department's own seats and share of the cost. */
    readonly seats: number;
    readonly share: string | null;
    /** The other departments the line is shared with. */
    readonly sharedWith: readonly string[];
  }[];
  readonly leftOut: readonly { readonly line: VersionLineView; readonly seats: number }[];
  readonly seats: number;
  readonly cost: string;
  readonly envelope: string | null;
  readonly state: BudgetState;
}

export function departmentResult(
  departmentId: string,
  lines: readonly VersionLine[],
  envelope: string | null,
  fractionDigits: number,
): DepartmentResult {
  const views = lines
    .map((l) => versionLineView(l, fractionDigits))
    .filter((l) => l.departments.some((d) => d.departmentId === departmentId));
  const own = (line: VersionLineView) =>
    line.departments.find((d) => d.departmentId === departmentId);
  const approved = views
    .filter((l) => l.status === 'in_plan')
    .map((line) => ({
      line,
      seats: own(line)?.seats ?? 0,
      share: own(line)?.share ?? null,
      sharedWith: line.departments.map((d) => d.departmentId).filter((d) => d !== departmentId),
    }));
  const leftOut = views
    .filter((l) => l.status === 'left_out')
    .map((line) => ({ line, seats: own(line)?.seats ?? 0 }));
  const cost = fromMilli(approved.reduce((n, a) => n + (amountMilli(a.share) ?? 0n), 0n));
  return {
    approved,
    leftOut,
    seats: approved.reduce((n, a) => n + a.seats, 0),
    cost,
    envelope,
    state: budgetState(cost, envelope),
  };
}

// ---------------------------------------------------------------------------------------------------
// A plan's figures on the Approvals list (review L7: worked out for every plan from three queries)
// ---------------------------------------------------------------------------------------------------

export interface PlanFiguresLine {
  readonly id: string;
  readonly status: LineStatus;
  readonly minPerSession: number | null;
  readonly maxPerSession: number | null;
  readonly costPerSession: string | null;
  readonly costPerPerson: string | null;
}

export interface PlanFiguresLink {
  readonly lineId: string;
  readonly departmentId: string;
  readonly seats: number;
  readonly named: number;
}

export interface PlanFigures {
  readonly lines: number;
  readonly leftOut: number;
  readonly people: number;
  readonly sessions: number;
  readonly cost: string;
  readonly envelope: string | null;
  readonly overBudget: number;
  readonly currency: string;
  readonly fractionDigits: number;
}

/**
 * The organization-wide figures of a plan as its Plan tab works them out (planQueryDefinition, organization
 * scope): the lines in the plan and left out, the people, sessions and cost of the lines in the plan, the
 * envelopes' total and how many departments are over theirs. `links` in the order the plan reads them (a shared
 * line's cost is split in that order, to the currency's smallest unit).
 */
export function planFigures(
  lines: readonly PlanFiguresLine[],
  links: readonly PlanFiguresLink[],
  envelopes: readonly { readonly departmentId: string; readonly envelope: string | null }[],
  currency: string,
): PlanFigures {
  const fractionDigits = currencyFractionDigits(currency);
  const byLine = new Map<string, PlanFiguresLink[]>();
  for (const link of links) byLine.set(link.lineId, [...(byLine.get(link.lineId) ?? []), link]);
  let people = 0;
  let sessions = 0;
  let cost = 0n;
  let inPlan = 0;
  const budgetLines = lines.map((line) => {
    const own = byLine.get(line.id) ?? [];
    const departments = [...new Set(own.map((l) => l.departmentId))].map((departmentId) => {
      const mine = own.filter((l) => l.departmentId === departmentId);
      return {
        departmentId,
        seats: mine.reduce((n, l) => n + l.seats, 0),
        named: mine.reduce((n, l) => n + l.named, 0),
      };
    });
    const figures = lineFigures({ ...line, departments }, fractionDigits);
    if (line.status === 'in_plan') {
      inPlan += 1;
      people += figures.people;
      sessions += figures.plan?.sessions ?? 0;
      cost += amountMilli(figures.cost) ?? 0n;
    }
    return {
      lineId: line.id,
      status: line.status,
      cost: figures.cost,
      shares: figures.shares,
      departments,
    };
  });
  const check = budgetCheck(envelopes, budgetLines);
  return {
    lines: inPlan,
    leftOut: lines.length - inPlan,
    people,
    sessions,
    cost: fromMilli(cost),
    envelope: check.total.envelope,
    overBudget: check.departments.filter((d) => d.state.kind === 'over').length,
    currency,
    fractionDigits,
  };
}
