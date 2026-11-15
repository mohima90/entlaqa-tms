/**
 * Draft-session rules (WP-LD-04, T-M3-08; FR-PLN-09, FR-SCH-01 core; proposal
 * docs/product/proposals/wp-ld-04-plan-to-courses-and-draft-sessions.md, its questions answered «A»; approved screens
 * docs/design/screens/m3-plan-to-sessions/README.md). Pure: no I/O and no validation library — shared by the server
 * (definitions) and the browser (the «Create draft sessions» popup recomputes as L&D edits; the
 * `@jadarat/tms/session-rules` entry keeps the client bundle small). The database repeats the limits (migration
 * 20261117100200: JK013–JK016).
 *
 * Months are `YYYY-MM` strings (the database keeps the first day of the month). The plan's quarters are quarters of
 * its PLANNING PERIOD: Q1 is the period's first three months (a period starting in July has Q1 = Jul–Sep).
 */

/** Delivery types without a place: a draft of these proposes no branch («Online»). */
export const ONLINE_DELIVERY_TYPES: readonly string[] = ['virtual', 'elearning'];

/** The database's limit of a session's seats (sessions_seats_check). */
export const SESSION_SEATS_MAX = 10_000;

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** `YYYY-MM` of a date (`YYYY-MM-DD`) or a month. Throws on anything else. */
export function monthOf(date: string): string {
  const month = date.slice(0, 7);
  if (!MONTH_RE.test(month)) throw new Error('not a date');
  return month;
}

export function isMonth(value: string): boolean {
  return MONTH_RE.test(value);
}

/** `month` moved by `n` months (negative: back). */
export function addMonths(month: string, n: number): string {
  const match = MONTH_RE.exec(month);
  if (!match) throw new Error('not a month');
  const index = Number(match[1]) * 12 + (Number(match[2]) - 1) + n;
  const year = Math.floor(index / 12);
  return `${String(year).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** The first day of a month, as the database keeps it. */
export function monthStart(month: string): string {
  if (!MONTH_RE.test(month)) throw new Error('not a month');
  return `${month}-01`;
}

/** The three months of a quarter of the planning period that starts on `periodStart` (`YYYY-MM-DD`). */
export function quarterMonths(periodStart: string, quarter: number): [string, string, string] {
  const first = addMonths(monthOf(periodStart), (quarter - 1) * 3);
  return [first, addMonths(first, 1), addMonths(first, 2)];
}

/** The quarter of the planning period a month falls in (1…n; 0 or less: before the period). */
export function periodQuarterOf(periodStart: string, month: string): number {
  const diff = monthsBetween(monthOf(periodStart), month);
  return Math.floor(diff / 3) + 1;
}

function monthsBetween(from: string, to: string): number {
  const a = MONTH_RE.exec(from);
  const b = MONTH_RE.exec(to);
  if (!a || !b) throw new Error('not a month');
  return Number(b[1]) * 12 + Number(b[2]) - (Number(a[1]) * 12 + Number(a[2]));
}

/** A draft's month lies in the planning period (the database's JK015). */
export function monthInPeriod(month: string, periodStart: string, periodEnd: string): boolean {
  return month >= monthOf(periodStart) && month <= monthOf(periodEnd);
}

/** A draft planned outside its line's quarter (Q3 = A: allowed, marked). */
export function outsideQuarter(month: string, periodStart: string, quarter: number): boolean {
  return !quarterMonths(periodStart, quarter).includes(month);
}

/**
 * The months proposed for a line's `count` sessions over its quarter (Q1 = A, design screen 3): one session → the
 * middle month (room to move either way); two → the first and the last; three → one a month; more → as evenly as
 * possible, the earlier months first (4 → Jan, Jan, Feb, Mar). In session order.
 */
export function proposedMonths(count: number, months: readonly [string, string, string]): string[] {
  if (count <= 0) return [];
  const [first, middle, last] = months;
  if (count === 1) return [middle];
  if (count === 2) return [first, last];
  const base = Math.floor(count / 3);
  const extra = count % 3;
  return months.flatMap((month, i) =>
    Array.from({ length: base + (i < extra ? 1 : 0) }, () => month),
  );
}

/** `total` spread over `count` parts, the larger ones first (47 over 3 → 16, 16, 15). */
export function evenSizes(total: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(total / count);
  const larger = total % count;
  return Array.from({ length: count }, (_, i) => (i < larger ? base + 1 : base));
}

/** A department of the line as the proposal places it. */
export interface ProposalDepartment {
  readonly departmentId: string;
  /** The department's branch (null: none). */
  readonly branchId: string | null;
  /** Its seats in the line (what it asked for). */
  readonly seats: number;
  /** The people it named, in the order they were named (candidates for its seats). */
  readonly people: readonly { readonly personId: string; readonly needId: string }[];
}

export interface ProposedSession {
  readonly month: string;
  /** Null: no branch («Online», or none of the departments has one, or L&D picks — see `branchToCheck`). */
  readonly branchId: string | null;
  readonly seats: number;
  /** Seats per department (design: «Finance 4 + Human Resources 12»), in fill order. */
  readonly departments: readonly {
    readonly departmentId: string;
    readonly seats: number;
    readonly named: number;
  }[];
  /** The planned participants (named people), at most `seats`. */
  readonly people: readonly {
    readonly personId: string;
    readonly needId: string;
    readonly departmentId: string;
  }[];
}

export interface SessionProposal {
  readonly sessions: readonly ProposedSession[];
  /**
   * The line's people are in more branches than its sessions can keep apart (Q2 = A: the plan's session count is
   * kept): each session got the branch of most of its people, and L&D checks it.
   */
  readonly branchToCheck: boolean;
  /** The people of each branch (design: «two branches (Riyadh 32, Jeddah 15)»), most first. */
  readonly branches: readonly { readonly branchId: string | null; readonly seats: number }[];
}

interface Group {
  readonly branchId: string | null;
  readonly seats: number;
  readonly departments: readonly ProposalDepartment[];
}

/** Departments by branch, the branch with most seats first (then first seen); departments by seats, most first. */
function groupsOf(departments: readonly ProposalDepartment[], online: boolean): Group[] {
  const bySeats = [...departments]
    .map((d, index) => ({ d, index }))
    .sort((a, b) => b.d.seats - a.d.seats || a.index - b.index)
    .map((x) => x.d);
  if (online) {
    return [
      { branchId: null, seats: bySeats.reduce((n, d) => n + d.seats, 0), departments: bySeats },
    ];
  }
  const groups = new Map<string | null, ProposalDepartment[]>();
  for (const department of departments) {
    groups.set(department.branchId, [...(groups.get(department.branchId) ?? []), department]);
  }
  return [...groups.entries()]
    .map(([branchId, members], index) => ({
      branchId,
      seats: members.reduce((n, d) => n + d.seats, 0),
      departments: [...members].sort(
        (a, b) => b.seats - a.seats || departments.indexOf(a) - departments.indexOf(b),
      ),
      index,
    }))
    .sort((a, b) => b.seats - a.seats || a.index - b.index)
    .map(({ branchId, seats, departments: members }) => ({
      branchId,
      seats,
      departments: members,
    }));
}

/**
 * Sessions per branch when each branch can have its own (Q2 = A): every branch gets the sessions its people need
 * (seats ÷ maximum, rounded up); sessions left over go one by one to the branch with the fullest sessions. Null when
 * the branches need more sessions than the plan has.
 */
function sessionsPerGroup(groups: readonly Group[], count: number, max: number): number[] | null {
  const counts = groups.map((g) => Math.max(1, Math.ceil(g.seats / max)));
  if (counts.reduce((n, c) => n + c, 0) > count) return null;
  let left = count - counts.reduce((n, c) => n + c, 0);
  while (left > 0) {
    let best = -1;
    for (let i = 0; i < groups.length; i += 1) {
      const g = groups[i];
      const c = counts[i] ?? 1;
      if (!g || c >= g.seats) continue;
      const bestGroup = groups[best];
      if (best < 0 || !bestGroup) {
        best = i;
        continue;
      }
      // The fullest sessions first; then more people; then the earlier branch.
      const mine = g.seats * (counts[best] ?? 1);
      const theirs = bestGroup.seats * c;
      if (mine > theirs || (mine === theirs && g.seats > bestGroup.seats)) best = i;
    }
    if (best < 0) break;
    counts[best] = (counts[best] ?? 0) + 1;
    left -= 1;
  }
  return counts;
}

interface Slot {
  branchId: string | null;
  seats: number;
  filled: Map<string, number>;
}

/** Fills `slots` in order with the departments' seats (each department's seats go on until it has none). */
function fill(slots: Slot[], departments: readonly ProposalDepartment[]): void {
  let index = 0;
  for (const department of departments) {
    let left = department.seats;
    while (left > 0 && index < slots.length) {
      const slot = slots[index];
      if (!slot) break;
      const free = slot.seats - [...slot.filled.values()].reduce((n, s) => n + s, 0);
      if (free <= 0) {
        index += 1;
        continue;
      }
      const take = Math.min(free, left);
      slot.filled.set(
        department.departmentId,
        (slot.filled.get(department.departmentId) ?? 0) + take,
      );
      left -= take;
    }
  }
}

/**
 * The proposal of a line's draft sessions (design screen 3; Q1 = A, Q2 = A):
 *   * `count` sessions (the plan's: people ÷ maximum per session, rounded up), months spread over the line's quarter
 *     (`proposedMonths`);
 *   * branches: a line whose people are all in one branch (or online: virtual, e-learning — no branch) keeps the
 *     plan's session sizes; people in several branches are placed BY BRANCH when the branches fit in the plan's
 *     sessions (Riyadh 32 + Jeddah 15, at most 20, 3 sessions → Riyadh 16, 16 and Jeddah 15), else the plan's sizes
 *     are kept, departments placed branch after branch, each session gets the branch of most of its people and
 *     `branchToCheck` says L&D should check them;
 *   * people: each department's seats fill the sessions in order, the larger departments first («Finance 16 ·
 *     Finance 4 + Human Resources 12 · Sales 15»), and the people it named take its seats in the order named; seats
 *     of a department that named nobody stay seats («names later»).
 * Deterministic: the same line gives the same proposal.
 */
export function proposeSessions(input: {
  readonly count: number;
  readonly maxPerSession: number;
  readonly deliveryType: string | null;
  readonly quarterMonths: readonly [string, string, string];
  readonly departments: readonly ProposalDepartment[];
}): SessionProposal {
  const departments = input.departments.filter((d) => d.seats > 0);
  const total = departments.reduce((n, d) => n + d.seats, 0);
  const online = input.deliveryType !== null && ONLINE_DELIVERY_TYPES.includes(input.deliveryType);
  const groups = groupsOf(departments, online);
  const branches = groups.map((g) => ({ branchId: g.branchId, seats: g.seats }));
  if (input.count <= 0 || total === 0) return { sessions: [], branchToCheck: false, branches };
  const count = Math.min(input.count, total);
  const max = Math.max(1, input.maxPerSession);

  const perGroup = groups.length > 1 ? sessionsPerGroup(groups, count, max) : [count];
  const slots: Slot[] = [];
  let branchToCheck = false;
  if (perGroup) {
    groups.forEach((group, i) => {
      for (const seats of evenSizes(group.seats, perGroup[i] ?? 0)) {
        slots.push({ branchId: group.branchId, seats, filled: new Map() });
      }
      fill(slots.slice(slots.length - (perGroup[i] ?? 0)), group.departments);
    });
  } else {
    branchToCheck = true;
    for (const seats of evenSizes(total, count))
      slots.push({ branchId: null, seats, filled: new Map() });
    fill(
      slots,
      groups.flatMap((g) => g.departments),
    );
    const branchOf = new Map(departments.map((d) => [d.departmentId, d.branchId]));
    for (const slot of slots) {
      const seatsByBranch = new Map<string | null, number>();
      for (const [departmentId, seats] of slot.filled) {
        const branch = branchOf.get(departmentId) ?? null;
        seatsByBranch.set(branch, (seatsByBranch.get(branch) ?? 0) + seats);
      }
      let best: string | null = null;
      let bestSeats = -1;
      for (const [branch, seats] of seatsByBranch) {
        if (seats > bestSeats) {
          best = branch;
          bestSeats = seats;
        }
      }
      slot.branchId = best;
    }
  }

  // The people each department named take its seats in session order.
  const queue = new Map(departments.map((d) => [d.departmentId, [...d.people]]));
  const months = proposedMonths(slots.length, input.quarterMonths);
  const sessions = slots.map((slot, i): ProposedSession => {
    const people: { personId: string; needId: string; departmentId: string }[] = [];
    const shares = [...slot.filled.entries()].map(([departmentId, seats]) => {
      const named = (queue.get(departmentId) ?? []).splice(0, seats);
      for (const person of named) people.push({ ...person, departmentId });
      return { departmentId, seats, named: named.length };
    });
    return {
      month: months[i] ?? input.quarterMonths[0],
      branchId: slot.branchId,
      seats: slot.seats,
      departments: shares,
      people,
    };
  });
  return { sessions, branchToCheck, branches };
}

/**
 * The part of a line's proposal still to draft when some drafts exist («Create sessions» again after a draft was
 * deleted): each existing draft takes the proposed session most like it — the same month and branch, else the same
 * month, else the same branch, else the last one — and the people already in a draft are left out of the rest.
 */
export function remainingProposal(
  proposal: SessionProposal,
  existing: readonly { readonly month: string; readonly branchId: string | null }[],
  placedPersonIds: ReadonlySet<string>,
): ProposedSession[] {
  const left = [...proposal.sessions];
  for (const draft of [...existing].sort((a, b) => a.month.localeCompare(b.month))) {
    if (left.length === 0) break;
    const pick =
      [
        left.findIndex((s) => s.month === draft.month && s.branchId === draft.branchId),
        left.findIndex((s) => s.month === draft.month),
        left.findIndex((s) => s.branchId === draft.branchId),
      ].find((i) => i >= 0) ?? left.length - 1;
    left.splice(pick, 1);
  }
  return left.map((s) => {
    const people = s.people.filter((p) => !placedPersonIds.has(p.personId));
    return {
      ...s,
      people,
      departments: s.departments.map((d) => ({
        ...d,
        named: people.filter((p) => p.departmentId === d.departmentId).length,
      })),
    };
  });
}

/**
 * A line's sessions against its drafts (the Plan tab's «Draft sessions» cell, design screen 1 and its states):
 *   left_out        the line is not in the plan (nothing needed)
 *   needs_course    no course yet («After the course»)
 *   needs_size      no session size, so no session count (only after a revision; an approved plan has them)
 *   needs_sessions  a course and no draft («Create sessions», 0 of n)
 *   partly_drafted  some drafts (k of n)
 *   drafted         n of n
 *   over_drafted    more drafts than the plan now says («3 drafts, plan says 2»: the plan was revised)
 */
export type LineSessionState =
  | 'left_out'
  | 'needs_course'
  | 'needs_size'
  | 'needs_sessions'
  | 'partly_drafted'
  | 'drafted'
  | 'over_drafted';

export function lineSessionState(line: {
  readonly status: 'in_plan' | 'left_out';
  readonly hasCourse: boolean;
  readonly planned: number | null;
  readonly drafted: number;
}): LineSessionState {
  if (line.status === 'left_out') return line.drafted > 0 ? 'over_drafted' : 'left_out';
  if (line.planned !== null && line.drafted > line.planned) return 'over_drafted';
  if (!line.hasCourse) return 'needs_course';
  if (line.planned === null) return 'needs_size';
  if (line.drafted === 0) return line.planned === 0 ? 'drafted' : 'needs_sessions';
  return line.drafted < line.planned ? 'partly_drafted' : 'drafted';
}

/**
 * A draft's estimated cost, as the database works it out: the line's cost per session + seats × its cost per person
 * (exact, in thousandths of the cycle's currency). Null without a cost per session.
 */
export function draftCost(
  seats: number,
  costPerSession: string | null,
  costPerPerson: string | null,
): string | null {
  const milli = (amount: string | null): bigint | null => {
    if (amount === null) return null;
    const [whole = '0', fraction = ''] = amount.split('.');
    return BigInt(whole) * 1000n + BigInt((fraction + '000').slice(0, 3));
  };
  const perSession = milli(costPerSession);
  if (perSession === null) return null;
  const value = perSession + BigInt(seats) * (milli(costPerPerson) ?? 0n);
  const whole = value / 1000n;
  const fraction = (value % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return `${whole.toString()}${fraction ? `.${fraction}` : ''}`;
}
