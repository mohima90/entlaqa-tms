import { searchKey } from '@jadarat/platform-i18n/text';

/**
 * Consolidation and budget check rules (WP-LD-02, T-M3-06; FR-PLN-05, FR-PLN-06; business flow
 * docs/business-flows/EP-PLN-planning-cycle.md §3 D11–13, BR-PLN-f; proposal
 * docs/product/proposals/wp-ld-02-03-consolidation-approval.md, Q1–Q5 = A; approved screens
 * docs/design/screens/m3-consolidation-approval/README.md). Pure: no I/O and no validation library — shared by the
 * server (definitions, repository) and the browser (the line popup works out sessions and cost as L&D types; the
 * `@jadarat/tms/consolidation-rules` entry keeps the client bundle small). The database repeats the limits.
 *
 * Amounts are canonical decimal TEXT in the cycle's currency (up to 3 decimals, as the envelope and the needs'
 * estimates) and are added and multiplied exactly in thousandths (BigInt) — never with floating point.
 */

// ---------------------------------------------------------------------------------------------------
// Vocabulary and limits
// ---------------------------------------------------------------------------------------------------

/** The plan's states (BRD Appendix C); WP-LD-02 opens `draft` plans, WP-LD-03 moves them. */
export const PLAN_STATUSES = ['draft', 'in_approval', 'approved', 'sent_back'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

/** A line is in the plan by default (Q2 = A) or left out with a reason. */
export const LINE_STATUSES = ['in_plan', 'left_out'] as const;
export type LineStatus = (typeof LINE_STATUSES)[number];

/** Quarters of the plan period (Q3 = A; FR-PLN-05 v3.8): the month is picked when sessions are scheduled. */
export const QUARTERS = [1, 2, 3, 4] as const;
export type Quarter = (typeof QUARTERS)[number];

/** FR-CAT-01 delivery types (the same list as tms.courses and tms.plan_lines). */
export const PLAN_DELIVERY_TYPES = [
  'classroom',
  'virtual',
  'blended',
  'hybrid',
  'on_the_job',
  'workshop',
  'conference',
  'exam',
  'elearning',
] as const;
export type PlanDeliveryType = (typeof PLAN_DELIVERY_TYPES)[number];

/** How the Plan tab groups its lines (design screen 1: Topic · Branch · Delivery type · Quarter). */
export const PLAN_GROUPINGS = ['topic', 'branch', 'delivery_type', 'quarter'] as const;
export type PlanGrouping = (typeof PLAN_GROUPINGS)[number];

/** The database's checks (migration 20261115100200) and the inputs' limits. */
export const CONSOLIDATION_LIMITS = {
  titleMax: 500,
  leftOutReasonMax: 500,
  budgetReasonMax: 300,
  peoplePerSessionMax: 10_000,
  /** Cost per session / per person: up to 12 digits before the decimal point, 3 after. */
  amountMax: 999_999_999_999,
  durationHoursMax: 9999.99,
  /** Lines in one call (merge, change the quarter of several lines). */
  bulkMax: 500,
} as const;

/** Over the envelope by this share or more is shown red, below it amber (design README, «Over budget»). */
export const OVER_BUDGET_RED_PERCENT = 10;

// ---------------------------------------------------------------------------------------------------
// Amounts (exact, in thousandths)
// ---------------------------------------------------------------------------------------------------

const AMOUNT_RE = /^\d{1,15}(\.\d{1,4})?$/;

/** A canonical amount text ("1200.5") as thousandths (1200500n); null for null. Throws on anything else. */
export function toMilli(amount: string | null): bigint | null {
  if (amount === null) return null;
  if (!AMOUNT_RE.test(amount)) throw new Error('not an amount');
  const [whole = '0', fraction = ''] = amount.split('.');
  // The database keeps 4 decimals (numeric(19,4)); amounts are written with at most 3 (its check).
  return BigInt(whole) * 1000n + BigInt((fraction + '000').slice(0, 3));
}

/** Thousandths as a canonical amount text: 1200500n → "1200.5", 0n → "0". */
export function fromMilli(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 1000n;
  const fraction = (abs % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole.toString()}${fraction ? `.${fraction}` : ''}`;
}

/**
 * Digits after the decimal point of a currency (ISO 4217): shares of a cost are split in its smallest unit so
 * they add up exactly to the total as shown. Unknown currencies: 2.
 */
export function currencyFractionDigits(currency: string): number {
  return ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'].includes(currency.toUpperCase()) ? 3 : 2;
}

// ---------------------------------------------------------------------------------------------------
// Topics: the same training whatever the spelling
// ---------------------------------------------------------------------------------------------------

/** Arabic marks beyond searchKey's (Quranic annotations, maddah/hamza above and below, small high letters). */
const EXTRA_MARKS = /[ؐ-ؚٓ-ٟۖ-ۭ]/g;

/**
 * A topic's comparison key (the grouping of D11): case, spaces and punctuation do not count, nor Arabic spelling
 * variants — alef forms (أ إ آ ٱ → ا), hamza on waw / yaa (ؤ → و, ئ → ي; a lone ء is dropped), taa marbuta
 * (ة → ه), alef maqsura and Persian yeh (ى ی → ي), Persian kaf (ک → ك), diacritics and tatweel; digits in any
 * script are ASCII; invisible format marks are removed. Built on platform-i18n `searchKey` (the search rule).
 */
export function topicKey(topic: string): string {
  return searchKey(topic.normalize('NFKC'))
    .replace(EXTRA_MARKS, '')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ء/g, '')
    .replace(/ی/g, 'ي')
    .replace(/ک/g, 'ك')
    .replace(/\p{Cf}/gu, '')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** What a line is built from: one course, else one normalized topic. */
export function groupKeyOf(need: {
  readonly courseId: string | null;
  readonly topic: string;
}): string {
  return need.courseId ? `course:${need.courseId}` : `topic:${topicKey(need.topic)}`;
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = prev[0] ?? 0;
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = prev[j] ?? 0;
      prev[j] = Math.min(
        above + 1,
        (prev[j - 1] ?? 0) + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return prev[b.length] ?? 0;
}

interface AlikeInfo {
  readonly courseId: string | null;
  readonly key: string;
  readonly words: ReadonlySet<string>;
}

function alikeInfo(line: { readonly title: string; readonly courseId: string | null }): AlikeInfo {
  const key = topicKey(line.title);
  return {
    courseId: line.courseId,
    key,
    words: new Set(key.split(' ').filter((w) => w.length >= 2)),
  };
}

function alike(a: AlikeInfo, b: AlikeInfo): boolean {
  if (a.courseId && b.courseId) return a.courseId === b.courseId;
  if (a.key === '' || b.key === '') return false;
  if (a.key === b.key) return true;
  const shared = [...a.words].filter((w) => b.words.has(w));
  const smaller = Math.min(a.words.size, b.words.size);
  const sharedLetters = shared.reduce((n, w) => n + w.length, 0);
  if (smaller > 0 && shared.length === smaller && sharedLetters >= 4) return true;
  const union = new Set([...a.words, ...b.words]).size;
  if (union > 0 && shared.length / union >= 0.6) return true;
  const longer = Math.max(a.key.length, b.key.length);
  const allowed = Math.floor(longer * 0.15);
  // Spelling: only titles of a similar length that share a word or begin alike are compared letter by letter.
  if (
    longer <= 80 &&
    allowed > 0 &&
    Math.abs(a.key.length - b.key.length) <= allowed &&
    (shared.length > 0 || a.key.slice(0, 2) === b.key.slice(0, 2))
  ) {
    return levenshtein(a.key, b.key) <= allowed;
  }
  return false;
}

/**
 * «Look alike» (design screen 1, «Needs your attention»): two lines whose titles are close enough that L&D may
 * want to merge them. A simple heuristic on the topic keys, documented so it can be explained:
 *   1. the same key — alike;
 *   2. word overlap: the words (two letters or more) of one title all appear in the other and they share at least
 *      four letters' worth of words («Excel» ~ «Excel advanced formulas»), or the two share at least 60 % of
 *      their words (Jaccard);
 *   3. spelling: titles up to 80 characters of a similar length that share a word or begin with the same two
 *      letters, and differ in at most 15 % of their characters (Levenshtein): «Leadreship skills» ~
 *      «Leadership skills».
 * Lines of two different library courses never look alike (L&D chose two courses on purpose); lines of the same
 * course always do.
 */
export function looksAlike(
  a: { readonly title: string; readonly courseId: string | null },
  b: { readonly title: string; readonly courseId: string | null },
): boolean {
  return alike(alikeInfo(a), alikeInfo(b));
}

/**
 * Every pair of look-alike lines in the plan (left-out lines are not compared), in line order: at most `limit`
 * pairs, among the first 1,000 lines (the hint is a help, not a guarantee).
 */
export function lookAlikePairs(
  lines: readonly {
    readonly id: string;
    readonly title: string;
    readonly courseId: string | null;
    readonly status: LineStatus;
  }[],
  limit = 50,
): [string, string][] {
  const inPlan = lines
    .filter((l) => l.status === 'in_plan')
    .slice(0, 1000)
    .map((l) => ({ id: l.id, info: alikeInfo(l) }));
  const pairs: [string, string][] = [];
  for (let i = 0; i < inPlan.length && pairs.length < limit; i += 1) {
    for (let j = i + 1; j < inPlan.length && pairs.length < limit; j += 1) {
      const a = inPlan[i];
      const b = inPlan[j];
      if (a && b && alike(a.info, b.info)) pairs.push([a.id, b.id]);
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------------------------------
// Building lines from the submitted needs (D11)
// ---------------------------------------------------------------------------------------------------

/** A submitted need as consolidation reads it (answers already mapped from the cycle's form). */
export interface ConsolidationNeed {
  readonly id: string;
  readonly departmentId: string;
  readonly topic: string;
  readonly courseId: string | null;
  readonly peopleCount: number;
  /** The quarter the department asked for (the form's «Preferred quarter»), or null. */
  readonly quarter: Quarter | null;
  readonly deliveryType: PlanDeliveryType | null;
  /** The form's «Category» option value, or null. */
  readonly category: string | null;
}

/** A line to create: what it is built from and the needs it holds, with its preselected values. */
export interface DraftLine {
  readonly groupKey: string;
  readonly title: string;
  readonly courseId: string | null;
  readonly quarter: Quarter;
  readonly deliveryType: PlanDeliveryType | null;
  readonly category: string | null;
  readonly needIds: readonly string[];
}

/** The most frequent value (first seen wins a tie); null when there is none. */
function mostFrequent<T>(values: readonly (T | null)[]): T | null {
  const counts = new Map<T, number>();
  let best: T | null = null;
  let bestCount = 0;
  for (const value of values) {
    if (value === null) continue;
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * The quarter preselected for a line (design screen 2): the quarter MOST DEPARTMENTS asked for — each department
 * counts once per quarter it asked —, the earliest on a tie; Q1 when nobody said.
 */
export function preselectedQuarter(
  needs: readonly { readonly departmentId: string; readonly quarter: Quarter | null }[],
): Quarter {
  const asked = new Map<Quarter, Set<string>>();
  for (const need of needs) {
    if (need.quarter === null) continue;
    const departments = asked.get(need.quarter) ?? new Set<string>();
    departments.add(need.departmentId);
    asked.set(need.quarter, departments);
  }
  let best: Quarter = 1;
  let bestCount = 0;
  for (const quarter of QUARTERS) {
    const count = asked.get(quarter)?.size ?? 0;
    if (count > bestCount) {
      best = quarter;
      bestCount = count;
    }
  }
  return best;
}

function draftLine(groupKey: string, courseId: string | null, needs: readonly ConsolidationNeed[]) {
  return {
    groupKey,
    // The title most of its needs used, as typed (the first one on a tie).
    title: mostFrequent(needs.map((n) => n.topic.trim())) ?? needs[0]?.topic.trim() ?? '',
    courseId,
    quarter: preselectedQuarter(needs),
    deliveryType: mostFrequent(needs.map((n) => n.deliveryType)),
    category: mostFrequent(needs.map((n) => n.category)),
    needIds: needs.map((n) => n.id),
  } satisfies DraftLine;
}

/**
 * The lines of a new plan (D11; design screen 1): needs for the same library course make one line; the other
 * needs make one line per topic key (case-, space-, punctuation- and Arabic-spelling-insensitive). A topic that
 * reads exactly like the topic of a course line's needs joins that course line (the head typed the course's
 * name instead of picking it). Lines come in the order their first need was entered (`needs` order).
 */
export function buildLines(needs: readonly ConsolidationNeed[]): DraftLine[] {
  const groups = new Map<string, { courseId: string | null; needs: ConsolidationNeed[] }>();
  // Course lines first, so topic needs can join them whatever the order.
  const courseByTopic = new Map<string, string>();
  for (const need of needs) {
    if (!need.courseId) continue;
    const key = groupKeyOf(need);
    const group = groups.get(key) ?? { courseId: need.courseId, needs: [] };
    group.needs.push(need);
    groups.set(key, group);
    const topic = topicKey(need.topic);
    if (topic !== '' && !courseByTopic.has(topic)) courseByTopic.set(topic, key);
  }
  const order: string[] = [];
  const seen = new Set<string>();
  for (const need of needs) {
    let key = groupKeyOf(need);
    if (!need.courseId) {
      key = courseByTopic.get(topicKey(need.topic)) ?? key;
      const group = groups.get(key) ?? { courseId: null, needs: [] };
      group.needs.push(need);
      groups.set(key, group);
    }
    if (!seen.has(key)) {
      seen.add(key);
      order.push(key);
    }
  }
  const position = new Map(needs.map((n, i) => [n.id, i]));
  return order.flatMap((key) => {
    const group = groups.get(key);
    if (!group) return [];
    // Within a line its needs keep their entry order.
    const ordered = [...group.needs].sort(
      (a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0),
    );
    return [draftLine(key, group.courseId, ordered)];
  });
}

/** A line of an open plan as attaching needs sees it. */
export interface AttachableLine {
  readonly id: string;
  readonly groupKey: string;
  /** L&D changed the line by hand (stamped by the database). */
  readonly edited: boolean;
  readonly status: LineStatus;
  /** The topic keys of the needs it holds now (a course line also takes topics typed like them). */
  readonly topicKeys: readonly string[];
}

/**
 * Where the needs of a department that resubmitted go (D14, «Return for changes» during consolidation): into the
 * line built from the same course or topic — but only a line L&D has not changed by hand and has not left out,
 * so no edited line moves under L&D's feet —, else into new lines built from them (buildLines).
 */
export function attachNeeds(
  lines: readonly AttachableLine[],
  needs: readonly ConsolidationNeed[],
): {
  readonly joins: readonly { readonly needId: string; readonly lineId: string }[];
  readonly newLines: DraftLine[];
} {
  const open = lines.filter((l) => !l.edited && l.status === 'in_plan');
  const joins: { needId: string; lineId: string }[] = [];
  const rest: ConsolidationNeed[] = [];
  for (const need of needs) {
    const key = groupKeyOf(need);
    const topic = topicKey(need.topic);
    const line =
      open.find((l) => l.groupKey === key) ??
      (need.courseId
        ? undefined
        : open.find((l) => l.groupKey.startsWith('course:') && l.topicKeys.includes(topic)));
    if (line) joins.push({ needId: need.id, lineId: line.id });
    else rest.push(need);
  }
  return { joins, newLines: buildLines(rest) };
}

// ---------------------------------------------------------------------------------------------------
// Sessions and cost (D12)
// ---------------------------------------------------------------------------------------------------

export interface SessionPlan {
  readonly sessions: number;
  /** People per session, spread evenly, the larger ones first (47, max 20 → 16, 16, 15). */
  readonly sizes: readonly number[];
  /** A session would have fewer people than the minimum (also when there are fewer people than it). */
  readonly belowMinimum: boolean;
}

/**
 * Sessions needed (D12): people ÷ maximum per session, rounded up; the people spread evenly over them. Null
 * without a maximum (the line needs its session size first).
 */
export function sessionPlan(
  people: number,
  minPerSession: number | null,
  maxPerSession: number | null,
): SessionPlan | null {
  if (maxPerSession === null || maxPerSession < 1) return null;
  if (people <= 0) return { sessions: 0, sizes: [], belowMinimum: false };
  const sessions = Math.ceil(people / maxPerSession);
  const base = Math.floor(people / sessions);
  const larger = people % sessions;
  const sizes = Array.from({ length: sessions }, (_, i) => (i < larger ? base + 1 : base));
  return { sessions, sizes, belowMinimum: minPerSession !== null && base < minPerSession };
}

/**
 * A line's estimated cost (D12): sessions × cost per session + people × cost per person (optional). Null when it
 * cannot be worked out yet — no session size or no cost per session («Needs a cost», not counted).
 */
export function lineCost(
  sessions: number | null,
  people: number,
  costPerSession: string | null,
  costPerPerson: string | null,
): string | null {
  const perSession = toMilli(costPerSession);
  if (sessions === null || perSession === null) return null;
  const perPerson = toMilli(costPerPerson) ?? 0n;
  return fromMilli(BigInt(sessions) * perSession + BigInt(people) * perPerson);
}

/**
 * A shared line's cost split between its departments by seats (Q9 of the business flow), in the currency's
 * smallest unit with the largest-remainder method, so the shares add up EXACTLY to the total; ties go to the
 * department with more seats, then to the earlier one. A total finer than the smallest unit (a cost with three
 * decimals in a two-decimal currency) leaves its fraction with the first largest share.
 */
export function splitBySeats(
  total: string,
  seats: readonly { readonly key: string; readonly seats: number }[],
  fractionDigits = 2,
): Map<string, string> {
  const result = new Map<string, string>();
  const totalSeats = seats.reduce((n, s) => n + Math.max(0, s.seats), 0);
  const milli = toMilli(total) ?? 0n;
  if (seats.length === 0) return result;
  if (totalSeats === 0) {
    seats.forEach((s, i) => result.set(s.key, fromMilli(i === 0 ? milli : 0n)));
    return result;
  }
  const unit = 10n ** BigInt(Math.max(0, 3 - Math.min(3, fractionDigits)));
  const units = milli / unit;
  const leftover = milli % unit;
  const base = seats.map((s, index) => {
    const numerator = units * BigInt(Math.max(0, s.seats));
    return {
      key: s.key,
      seats: s.seats,
      index,
      units: numerator / BigInt(totalSeats),
      remainder: numerator % BigInt(totalSeats),
    };
  });
  let missing = units - base.reduce((n, b) => n + b.units, 0n);
  const byRemainder = [...base].sort((a, b) =>
    a.remainder !== b.remainder
      ? a.remainder > b.remainder
        ? -1
        : 1
      : b.seats - a.seats || a.index - b.index,
  );
  for (const share of byRemainder) {
    if (missing <= 0n) break;
    share.units += 1n;
    missing -= 1n;
  }
  const largest = [...base].sort((a, b) => b.seats - a.seats || a.index - b.index)[0];
  for (const share of base) {
    const extra = share === largest ? leftover : 0n;
    result.set(share.key, fromMilli(share.units * unit + extra));
  }
  return result;
}

/** A line's figures as the Plan tab and the line popup show them. */
export interface LineFigures {
  readonly people: number;
  readonly named: number;
  readonly plan: SessionPlan | null;
  /** Null: «Needs a cost» (not counted in the budget). */
  readonly cost: string | null;
  /** The cost per department, by seats (empty without a cost). */
  readonly shares: ReadonlyMap<string, string>;
}

export interface LineInput {
  readonly minPerSession: number | null;
  readonly maxPerSession: number | null;
  readonly costPerSession: string | null;
  readonly costPerPerson: string | null;
  /** The departments' seats and named people in the line (each department once). */
  readonly departments: readonly {
    readonly departmentId: string;
    readonly seats: number;
    readonly named: number;
  }[];
}

export function lineFigures(line: LineInput, fractionDigits = 2): LineFigures {
  const people = line.departments.reduce((n, d) => n + d.seats, 0);
  const named = line.departments.reduce((n, d) => n + Math.min(d.named, d.seats), 0);
  const plan = sessionPlan(people, line.minPerSession, line.maxPerSession);
  const cost = lineCost(plan?.sessions ?? null, people, line.costPerSession, line.costPerPerson);
  const shares =
    cost === null
      ? new Map<string, string>()
      : splitBySeats(
          cost,
          line.departments.map((d) => ({ key: d.departmentId, seats: d.seats })),
          fractionDigits,
        );
  return { people, named, plan, cost, shares };
}

// ---------------------------------------------------------------------------------------------------
// Budget check (D13; BR-PLN-f: warns, never blocks)
// ---------------------------------------------------------------------------------------------------

export type BudgetState =
  | { readonly kind: 'none' }
  | { readonly kind: 'within'; readonly left: string }
  | {
      readonly kind: 'over';
      readonly overBy: string;
      /** How far over, in percent of the envelope (one decimal); null for an envelope of 0. */
      readonly percentOver: number | null;
      /** Amber under 10 % over, red from 10 % (design README). */
      readonly severity: 'amber' | 'red';
    };

/** A department's (or the organization's) estimated cost against its envelope. */
export function budgetState(cost: string, envelope: string | null): BudgetState {
  if (envelope === null) return { kind: 'none' };
  const spent = toMilli(cost) ?? 0n;
  const limit = toMilli(envelope) ?? 0n;
  if (spent <= limit) return { kind: 'within', left: fromMilli(limit - spent) };
  const over = spent - limit;
  // Tenths of a percent, rounded half up.
  const percentOver = limit === 0n ? null : Number((over * 2000n + limit) / (2n * limit)) / 10;
  return {
    kind: 'over',
    overBy: fromMilli(over),
    percentOver,
    severity: percentOver === null || percentOver >= OVER_BUDGET_RED_PERCENT ? 'red' : 'amber',
  };
}

/** One line's part in the budget: its departments' shares (lines in the plan with a cost only). */
export interface BudgetLine {
  readonly lineId: string;
  readonly status: LineStatus;
  readonly cost: string | null;
  readonly shares: ReadonlyMap<string, string>;
  readonly departments: readonly { readonly departmentId: string; readonly seats: number }[];
}

export interface DepartmentBudget {
  readonly departmentId: string;
  /** Lines in the plan with a need of the department. */
  readonly lines: number;
  readonly people: number;
  /** The sum of its shares of costed lines in the plan. */
  readonly cost: string;
  /** Lines in the plan with a need of the department but no cost yet (not counted). */
  readonly uncostedLines: number;
  readonly envelope: string | null;
  readonly state: BudgetState;
}

/**
 * The budget by department (design screen 3) and the organization's total: each department's shares of the
 * lines in the plan against its envelope; left-out lines and lines without a cost do not count. The total
 * envelope is the sum of the envelopes set (none set: no envelope).
 */
export function budgetCheck(
  departments: readonly { readonly departmentId: string; readonly envelope: string | null }[],
  lines: readonly BudgetLine[],
): {
  readonly departments: readonly DepartmentBudget[];
  readonly total: {
    readonly people: number;
    readonly cost: string;
    readonly envelope: string | null;
    readonly state: BudgetState;
  };
} {
  const inPlan = lines.filter((l) => l.status === 'in_plan');
  const rows = departments.map((department): DepartmentBudget => {
    let cost = 0n;
    let people = 0;
    let count = 0;
    let uncosted = 0;
    for (const line of inPlan) {
      const seats = line.departments.find((d) => d.departmentId === department.departmentId)?.seats;
      if (seats === undefined) continue;
      count += 1;
      people += seats;
      const share = line.shares.get(department.departmentId);
      if (line.cost === null || share === undefined) uncosted += 1;
      else cost += toMilli(share) ?? 0n;
    }
    const text = fromMilli(cost);
    return {
      departmentId: department.departmentId,
      lines: count,
      people,
      cost: text,
      uncostedLines: uncosted,
      envelope: department.envelope,
      state: budgetState(text, department.envelope),
    };
  });
  const totalCost = inPlan.reduce((n, l) => n + (toMilli(l.cost) ?? 0n), 0n);
  const totalPeople = inPlan.reduce(
    (n, l) => n + l.departments.reduce((m, d) => m + d.seats, 0),
    0,
  );
  const envelopes = departments.filter((d) => d.envelope !== null);
  const envelope =
    envelopes.length === 0
      ? null
      : fromMilli(envelopes.reduce((n, d) => n + (toMilli(d.envelope) ?? 0n), 0n));
  return {
    departments: rows,
    total: {
      people: totalPeople,
      cost: fromMilli(totalCost),
      envelope,
      state: budgetState(fromMilli(totalCost), envelope),
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// Groups (design screen 1: «Group by» with subtotals)
// ---------------------------------------------------------------------------------------------------

export interface GroupableLine {
  readonly id: string;
  readonly status: LineStatus;
  readonly quarter: Quarter;
  readonly deliveryType: PlanDeliveryType | null;
  readonly category: string | null;
  readonly cost: string | null;
  readonly sessions: number | null;
  readonly shares: ReadonlyMap<string, string>;
  readonly departments: readonly { readonly departmentId: string; readonly seats: number }[];
}

export interface LineGroup {
  /** The quarter (`'1'`…`'4'`), the delivery type, the category value or the branch id; null: none. */
  readonly key: string | null;
  readonly lineIds: readonly string[];
  /** Subtotals of the lines in the plan (a branch: its departments' seats and shares only). */
  readonly people: number;
  readonly sessions: number;
  readonly cost: string;
  /** Lines in the plan without a cost (not counted in `cost`). */
  readonly uncosted: number;
}

/**
 * The lines grouped for the Plan tab, groups in a stable order (quarters 1–4; the others in the order their
 * first line comes, «none» last). By topic: the line's category (the needs form's «Category»). By branch: a line
 * shared by departments of several branches shows in each, with that branch's seats and share of the cost — so
 * the subtotals add up to the plan's total; sessions are counted in full in each branch they serve.
 */
export function groupLines(
  lines: readonly GroupableLine[],
  by: PlanGrouping,
  branchOf: (departmentId: string) => string | null = () => null,
): LineGroup[] {
  const groups = new Map<
    string | null,
    { ids: string[]; people: number; sessions: number; cost: bigint; uncosted: number }
  >();
  const add = (key: string | null, line: GroupableLine, people: number, cost: bigint | null) => {
    const group = groups.get(key) ?? { ids: [], people: 0, sessions: 0, cost: 0n, uncosted: 0 };
    group.ids.push(line.id);
    if (line.status === 'in_plan') {
      group.people += people;
      group.sessions += line.sessions ?? 0;
      if (cost === null) group.uncosted += 1;
      else group.cost += cost;
    }
    groups.set(key, group);
  };
  for (const line of lines) {
    const people = line.departments.reduce((n, d) => n + d.seats, 0);
    const cost = toMilli(line.cost);
    switch (by) {
      case 'quarter':
        add(String(line.quarter), line, people, cost);
        break;
      case 'delivery_type':
        add(line.deliveryType, line, people, cost);
        break;
      case 'topic':
        add(line.category, line, people, cost);
        break;
      case 'branch': {
        const perBranch = new Map<string | null, { people: number; cost: bigint }>();
        for (const d of line.departments) {
          const branch = branchOf(d.departmentId);
          const entry = perBranch.get(branch) ?? { people: 0, cost: 0n };
          entry.people += d.seats;
          entry.cost += toMilli(line.shares.get(d.departmentId) ?? null) ?? 0n;
          perBranch.set(branch, entry);
        }
        if (perBranch.size === 0) add(null, line, 0, cost);
        for (const [branch, entry] of perBranch) {
          add(branch, line, entry.people, cost === null ? null : entry.cost);
        }
        break;
      }
    }
  }
  const keys = [...groups.keys()];
  const ordered =
    by === 'quarter'
      ? keys.sort((a, b) => Number(a) - Number(b))
      : [...keys.filter((k) => k !== null), ...keys.filter((k) => k === null)];
  return ordered.map((key) => {
    const g = groups.get(key);
    return {
      key,
      lineIds: g?.ids ?? [],
      people: g?.people ?? 0,
      sessions: g?.sessions ?? 0,
      cost: fromMilli(g?.cost ?? 0n),
      uncosted: g?.uncosted ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------------------------------
// The needs form's answers that consolidation reads
// ---------------------------------------------------------------------------------------------------

const QUARTER_VALUES: Readonly<Record<string, Quarter>> = { q1: 1, q2: 2, q3: 3, q4: 4 };
const PRIORITY_VALUES = ['critical', 'high', 'medium', 'low'] as const;
export type NeedPriority = (typeof PRIORITY_VALUES)[number];

/** The form fields consolidation reads (a field of the cycle's needs form, as stored). */
export interface PlanFormField {
  readonly id: string;
  readonly type: string;
  readonly options: readonly { readonly value: string }[];
}

export interface PlanFormFields {
  readonly quarter: string | null;
  readonly priority: string | null;
  readonly deliveryType: string | null;
  readonly category: string | null;
}

const isSubset = (values: readonly string[], allowed: readonly string[]) =>
  values.length > 0 && values.every((v) => allowed.includes(v));

/**
 * Which fields of the cycle's needs form hold the preferred quarter, the priority, the delivery type and the
 * category. Only the topic and the people are system fields (EP-PLN §12 (3)): the others may be renamed, so they
 * are recognised by their OPTION VALUES, which the default form seeds and duplicating keeps — a select whose
 * values are q1…q4 is the quarter; critical / high / medium / low the priority; FR-CAT-01 delivery types the
 * delivery type; a select labelled with the default categories' values (technical, leadership…) the category.
 * The first match wins; a form without one simply has no answer for it.
 */
export function planFormFields(
  fields: readonly PlanFormField[],
  categoryValues: readonly string[],
): PlanFormFields {
  const selects = fields.filter((f) => f.type === 'select' || f.type === 'radio');
  const find = (allowed: readonly string[]) =>
    selects.find((f) =>
      isSubset(
        f.options.map((o) => o.value),
        allowed,
      ),
    )?.id ?? null;
  return {
    quarter: find(Object.keys(QUARTER_VALUES)),
    priority: find(PRIORITY_VALUES),
    deliveryType: find(PLAN_DELIVERY_TYPES),
    category: find(categoryValues),
  };
}

const answerText = (answers: Readonly<Record<string, unknown>>, field: string | null) => {
  if (field === null) return null;
  const value = answers[field];
  return typeof value === 'string' && value !== '' ? value : null;
};

/** A need's answers that consolidation uses (unknown or missing values are null). */
export function needAnswers(
  answers: Readonly<Record<string, unknown>>,
  fields: PlanFormFields,
): {
  readonly quarter: Quarter | null;
  readonly priority: NeedPriority | null;
  readonly deliveryType: PlanDeliveryType | null;
  readonly category: string | null;
} {
  const quarter = answerText(answers, fields.quarter);
  const priority = answerText(answers, fields.priority);
  const delivery = answerText(answers, fields.deliveryType);
  const category = answerText(answers, fields.category);
  return {
    quarter: quarter !== null ? (QUARTER_VALUES[quarter] ?? null) : null,
    priority: (PRIORITY_VALUES as readonly string[]).includes(priority ?? '')
      ? (priority as NeedPriority)
      : null,
    deliveryType: (PLAN_DELIVERY_TYPES as readonly string[]).includes(delivery ?? '')
      ? (delivery as PlanDeliveryType)
      : null,
    category: category !== null && /^[A-Za-z0-9_.-]{1,80}$/.test(category) ? category : null,
  };
}

// ---------------------------------------------------------------------------------------------------
// Opening the plan (Q1 = A)
// ---------------------------------------------------------------------------------------------------

export type ConsolidationReadiness =
  | { readonly ready: true; readonly closeEarly: boolean }
  | {
      readonly ready: false;
      readonly reason:
        'not_launched' | 'already_open' | 'waiting_for_departments' | 'no_departments';
      /** Departments that have not submitted (waiting_for_departments). */
      readonly waiting: number;
    };

/**
 * May the plan be built now (Q1 = A)? After the needs' deadline — the cycle's and every department's extension
 * — whatever was submitted; earlier («Close needs now») only once every department in scope has submitted.
 */
export function consolidationReadiness(facts: {
  readonly cycleStatus: string;
  readonly latestDeadline: string;
  readonly today: string;
  readonly planExists: boolean;
  readonly departments: number;
  readonly submitted: number;
}): ConsolidationReadiness {
  if (facts.planExists) return { ready: false, reason: 'already_open', waiting: 0 };
  if (facts.cycleStatus !== 'open' && facts.cycleStatus !== 'closed') {
    return { ready: false, reason: 'not_launched', waiting: 0 };
  }
  const deadlinePassed = facts.cycleStatus === 'closed' || facts.latestDeadline < facts.today;
  if (deadlinePassed) return { ready: true, closeEarly: false };
  if (facts.departments === 0) return { ready: false, reason: 'no_departments', waiting: 0 };
  const waiting = facts.departments - facts.submitted;
  return waiting === 0
    ? { ready: true, closeEarly: true }
    : { ready: false, reason: 'waiting_for_departments', waiting };
}
