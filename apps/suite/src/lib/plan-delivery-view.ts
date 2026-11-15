import { type LineSessionState, draftCost, outsideQuarter } from '@jadarat/tms/session-rules';
/** The planning cycles list (as PLANNING_PATHS.cycles; not imported, so popups do not load planning-view). */
const CYCLES_PATH = '/suite/planning/cycles';

/**
 * From the approved plan to courses and draft sessions (WP-LD-04, T-M3-08; FR-PLN-09, FR-CAT-01, FR-SCH-01;
 * approved screens docs/design/screens/m3-plan-to-sessions/README.md) — client-safe helpers of the «Courses and
 * sessions» page of a cycle and the training calendar: their addresses (filters, the popup that is open), the filter
 * pills, and the «Create draft sessions» popup's rows and live check. Every popup is opened by its address: the
 * server reads what it needs (the proposal, the library, the draft) and renders it, so the pages ship little code.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : Array.isArray(value) ? first(value[0]) : undefined;
const uuid = (value: unknown): string | undefined => {
  const text = first(value);
  return text && UUID_RE.test(text) ? text.toLowerCase() : undefined;
};

// ---------------------------------------------------------------------------------------------------
// The popups (`?open=course|link|sessions&line=…`, `?draft=…`)
// ---------------------------------------------------------------------------------------------------

export type DeliveryPopup =
  | { readonly kind: 'course'; readonly lineId: string; readonly mode: 'create' | 'link' }
  | { readonly kind: 'sessions'; readonly lineId: string }
  | null;

export function deliveryPopup(raw: Readonly<Record<string, unknown>>): DeliveryPopup {
  const lineId = uuid(raw.line);
  if (!lineId) return null;
  switch (first(raw.open)) {
    case 'course':
      return { kind: 'course', lineId, mode: 'create' };
    case 'link':
      return { kind: 'course', lineId, mode: 'link' };
    case 'sessions':
      return { kind: 'sessions', lineId };
    default:
      return null;
  }
}

/** `open=` of a popup. */
export function popupParam(popup: Exclude<DeliveryPopup, null>): string {
  if (popup.kind === 'sessions') return 'sessions';
  return popup.mode === 'link' ? 'link' : 'course';
}

// ---------------------------------------------------------------------------------------------------
// «Courses and sessions» of a cycle (design screen 1, on its own page — see the page)
// ---------------------------------------------------------------------------------------------------

/** The filter pills: All · Needs a course · Needs sessions · Sessions created. */
export const DELIVERY_FILTERS = [
  'all',
  'needs_course',
  'needs_sessions',
  'sessions_created',
] as const;
export type DeliveryFilter = (typeof DELIVERY_FILTERS)[number];

export interface DeliveryParams {
  readonly show: DeliveryFilter;
  readonly q: string;
}

export function deliveryParams(raw: Readonly<Record<string, unknown>>): DeliveryParams {
  const show = first(raw.show);
  return {
    show: (DELIVERY_FILTERS as readonly string[]).includes(show ?? '')
      ? (show as DeliveryFilter)
      : 'all',
    q: (first(raw.q) ?? '').trim().slice(0, 100),
  };
}

/** The pill a line counts under (none: left out, or waiting for a session size). */
export function lineFilter(line: {
  readonly status: 'in_plan' | 'left_out';
  readonly hasCourse: boolean;
  readonly state: LineSessionState;
}): Exclude<DeliveryFilter, 'all'> | null {
  if (line.status !== 'in_plan') return null;
  if (!line.hasCourse) return 'needs_course';
  if (line.state === 'needs_sessions' || line.state === 'partly_drafted') return 'needs_sessions';
  if (line.state === 'drafted' || line.state === 'over_drafted') return 'sessions_created';
  return null;
}

/** The locale-less path of a cycle's «Courses and sessions», with its filter and an open popup. */
export function deliveryPath(
  cycleId: string,
  params: Partial<DeliveryParams> = {},
  popup: DeliveryPopup = null,
): string {
  const query = new URLSearchParams();
  if (params.show && params.show !== 'all') query.set('show', params.show);
  if (params.q) query.set('q', params.q);
  if (popup) {
    query.set('open', popupParam(popup));
    query.set('line', popup.lineId);
  }
  const text = query.toString();
  return `${CYCLES_PATH}/${cycleId}/sessions${text ? `?${text}` : ''}`;
}

// ---------------------------------------------------------------------------------------------------
// The training calendar (design screens 4, 4p, 5)
// ---------------------------------------------------------------------------------------------------

export const CALENDAR_PATH = '/suite/calendar';

export interface CalendarParams {
  readonly year: number;
  readonly quarter: 1 | 2 | 3 | 4 | null;
  /** A branch id, `none` (no branch), or null (all). */
  readonly branch: string | null;
  readonly course: string | null;
  /** Null: the year grid from 768 px up, the list on a phone (design 4p). */
  readonly view: 'year' | 'list' | null;
  /** The draft that is open (screen 5). */
  readonly draft: string | null;
}

export function calendarParams(
  raw: Readonly<Record<string, unknown>>,
  fallbackYear: number,
): CalendarParams {
  const year = Number(first(raw.year));
  const quarter = Number(first(raw.quarter));
  const view = first(raw.view);
  const branch = first(raw.branch);
  return {
    year: Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : fallbackYear,
    quarter: [1, 2, 3, 4].includes(quarter) ? (quarter as 1 | 2 | 3 | 4) : null,
    branch: branch === 'none' ? 'none' : (uuid(branch) ?? null),
    course: uuid(raw.course) ?? null,
    view: view === 'year' || view === 'list' ? view : null,
    draft: uuid(raw.draft) ?? null,
  };
}

/** The locale-less path of the calendar with its filters, and an open draft or popup. */
export function calendarPath(
  params: Partial<CalendarParams>,
  open: { readonly draft?: string; readonly popup?: DeliveryPopup } = {},
): string {
  const query = new URLSearchParams();
  if (params.year !== undefined) query.set('year', String(params.year));
  if (params.quarter) query.set('quarter', String(params.quarter));
  if (params.branch) query.set('branch', params.branch);
  if (params.course) query.set('course', params.course);
  if (params.view) query.set('view', params.view);
  if (open.draft) query.set('draft', open.draft);
  if (open.popup) {
    query.set('open', popupParam(open.popup));
    query.set('line', open.popup.lineId);
  }
  const text = query.toString();
  return `${CALENDAR_PATH}${text ? `?${text}` : ''}`;
}

/** The year a plan's period starts in (the calendar opened from a plan shows that year). */
export function periodYear(periodStart: string): number {
  return Number(periodStart.slice(0, 4));
}

// ---------------------------------------------------------------------------------------------------
// «Create draft sessions» (design screen 3): the editable rows and their check
// ---------------------------------------------------------------------------------------------------

export interface SessionRowState {
  /** Stable key of the row (the proposal's order). */
  readonly key: string;
  readonly month: string;
  /** '' — no branch («Online», or not decided). */
  readonly branchId: string;
  /** As typed. */
  readonly seats: string;
  readonly personIds: readonly string[];
  /** The proposal's seats per department (the «Planned participants» chips). */
  readonly departments: readonly {
    readonly departmentId: string;
    readonly seats: number;
    readonly named: number;
  }[];
}

export function rowsFromProposal(
  sessions: readonly {
    readonly month: string;
    readonly branchId: string | null;
    readonly seats: number;
    readonly personIds: readonly string[];
    readonly departments: SessionRowState['departments'];
  }[],
): SessionRowState[] {
  return sessions.map((s, i) => ({
    key: `s${String(i)}`,
    month: s.month,
    branchId: s.branchId ?? '',
    seats: String(s.seats),
    personIds: s.personIds,
    departments: s.departments,
  }));
}

/** Seats as typed: digits in any script; null when not a whole number from 1 to 10,000. */
export function parseSeats(text: string): number | null {
  const digits = text
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  if (!/^\d{1,5}$/.test(digits)) return null;
  const value = Number(digits);
  return value >= 1 && value <= 10_000 ? value : null;
}

export type RowProblem = 'SEATS' | 'FEWER_THAN_PEOPLE' | 'OUTSIDE_PERIOD';

export interface SessionsCheck {
  readonly seats: number;
  /** Seats of the drafts that exist + the rows. */
  readonly totalSeats: number;
  readonly allPlaced: boolean;
  /** People with no seat yet (0 when all are placed). */
  readonly unplaced: number;
  /** Per row: its estimated cost (null: the line has no cost per session, or the seats are not a number). */
  readonly costs: readonly (string | null)[];
  /** The rows' cost + the existing drafts' (null when any is unknown). */
  readonly cost: string | null;
  readonly matchesPlan: boolean;
  readonly outsideQuarter: readonly boolean[];
  readonly problems: Readonly<Record<number, RowProblem>>;
  /** The planned participants of the rows, each person once. */
  readonly named: number;
}

const milli = (amount: string): bigint => {
  const [whole = '0', fraction = ''] = amount.split('.');
  return BigInt(whole) * 1000n + BigInt((fraction + '000').slice(0, 3));
};
const fromMilli = (value: bigint): string => {
  const whole = value / 1000n;
  const fraction = (value % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return `${whole.toString()}${fraction ? `.${fraction}` : ''}`;
};

/**
 * The popup's live figures as L&D edits the rows (the same rules as the server: session-rules): seats against the
 * line's people, each row's cost, «matches the approved plan», a month outside the line's quarter (allowed, marked)
 * or outside the planning period (refused), fewer seats than planned participants (refused).
 */
export function checkSessions(
  rows: readonly SessionRowState[],
  line: {
    readonly people: number;
    readonly costPerSession: string | null;
    readonly costPerPerson: string | null;
    readonly cost: string | null;
    readonly quarter: number;
  },
  existing: { readonly seats: number; readonly cost: string | null; readonly count: number },
  period: { readonly start: string; readonly end: string },
): SessionsCheck {
  const problems: Record<number, RowProblem> = {};
  const seatsOf = rows.map((r) => parseSeats(r.seats));
  const costs = seatsOf.map((n) =>
    n === null ? null : draftCost(n, line.costPerSession, line.costPerPerson),
  );
  rows.forEach((row, i) => {
    const n = seatsOf[i] ?? null;
    if (row.month < period.start.slice(0, 7) || row.month > period.end.slice(0, 7)) {
      problems[i] = 'OUTSIDE_PERIOD';
    } else if (n === null) problems[i] = 'SEATS';
    else if (n < row.personIds.length) problems[i] = 'FEWER_THAN_PEOPLE';
  });
  const seats = seatsOf.reduce<number>((sum, n) => sum + (n ?? 0), 0);
  const totalSeats = seats + existing.seats;
  const known = [...costs, existing.count > 0 ? existing.cost : '0'];
  const cost = known.some((c) => c === null)
    ? null
    : fromMilli(known.reduce((sum, c) => sum + milli(c ?? '0'), 0n));
  return {
    seats,
    totalSeats,
    allPlaced: totalSeats >= line.people,
    unplaced: Math.max(0, line.people - totalSeats),
    costs,
    cost,
    matchesPlan: cost !== null && line.cost !== null && milli(cost) === milli(line.cost),
    outsideQuarter: rows.map((r) => outsideQuarter(r.month, period.start, line.quarter)),
    problems,
    // Unique people: a person is planned at most once per line (the server refuses a repeat).
    named: new Set(rows.flatMap((r) => r.personIds.map((id) => id.toLowerCase()))).size,
  };
}
