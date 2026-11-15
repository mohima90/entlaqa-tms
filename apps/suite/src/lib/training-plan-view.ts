import type { AppLocale } from '@jadarat/platform-i18n';
import { normalizeDigits, searchKey } from '@jadarat/platform-i18n/text';
import type { PlanView } from '@jadarat/tms';
import { budgetAmountText } from '@jadarat/tms/amount-text';
import {
  type BudgetState,
  type LineFigures,
  type PlanGrouping,
  PLAN_GROUPINGS,
  type Quarter,
  QUARTERS,
  lineFigures,
} from '@jadarat/tms/consolidation-rules';

/**
 * The Plan tab of a cycle (WP-LD-02, T-M3-06; FR-PLN-05, FR-PLN-06; approved screens
 * docs/design/screens/m3-consolidation-approval/README.md 1–3): pure helpers shared by the server page and the
 * client components — amounts in the cycle's currency, the budget's colour, search, the live figures of the line
 * popup and of a merge. Every figure the server shows comes from the query; these only preview what L&D types.
 */

export type PlanLine = PlanView['lines'][number];
export type PlanBudgetDepartment = PlanView['budget']['departments'][number];

/** The tabs of a cycle page (deep-linkable: `?tab=plan`). */
export const CYCLE_TABS = ['progress', 'plan'] as const;
export type CycleTab = (typeof CYCLE_TABS)[number];

export function cycleTab(value: string | string[] | undefined): CycleTab {
  return value === 'plan' ? 'plan' : 'progress';
}

/** The Plan tab's two views (screen 1 / screen 3): `?view=budget`. */
export type PlanSubview = 'lines' | 'budget';

export function planSubview(value: string | string[] | undefined): PlanSubview {
  return value === 'budget' ? 'budget' : 'lines';
}

export function planGrouping(value: string | string[] | undefined): PlanGrouping {
  return typeof value === 'string' && (PLAN_GROUPINGS as readonly string[]).includes(value)
    ? (value as PlanGrouping)
    : 'topic';
}

/**
 * An amount in the cycle's currency (BR-PLN-i), Western digits (ADR 0007 §1): no decimals when there are none,
 * up to the currency's own digits otherwise («SAR 15,000», «SAR 6,383.33»).
 */
export function planAmount(
  locale: AppLocale,
  amount: string | number,
  currency: string,
  fractionDigits = 2,
): string {
  const value = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(value)) return String(amount);
  try {
    return new Intl.NumberFormat(`${locale}-u-nu-latn`, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: Math.max(0, Math.min(3, fractionDigits)),
    }).format(value);
  } catch {
    return `${String(value)} ${currency}`;
  }
}

/** A whole number for the locale (Western digits). */
export function planNumber(locale: AppLocale, value: number): string {
  return new Intl.NumberFormat(`${locale}-u-nu-latn`, { maximumFractionDigits: 1 }).format(value);
}

/**
 * How a budget reads (design README «Over budget»): green within, amber under 10 % over, red from 10 % —
 * the server decides the severity; `none` without an envelope.
 */
export type BudgetTone = 'none' | 'within' | 'amber' | 'red';

export function budgetTone(state: BudgetState): BudgetTone {
  if (state.kind === 'none') return 'none';
  if (state.kind === 'within') return 'within';
  return state.severity;
}

/** The meter of a budget: spent of the envelope (a full bar once over). */
export function budgetMeter(
  cost: string,
  envelope: string | null,
): { readonly value: number; readonly max: number } {
  const spent = Number(cost);
  const limit = envelope === null ? 0 : Number(envelope);
  if (!(limit > 0)) return { value: spent > 0 ? 1 : 0, max: 1 };
  return { value: Math.min(spent, limit), max: limit };
}

/** Does a line match the search (its title, its departments' names) — spelling-insensitive, as needs search. */
export function lineMatches(
  line: Pick<PlanLine, 'title' | 'departments'>,
  query: string,
  departmentName: (id: string) => string,
): boolean {
  const key = searchKey(query);
  if (key === '') return true;
  if (searchKey(line.title).includes(key)) return true;
  return line.departments.some((d) => searchKey(departmentName(d.departmentId)).includes(key));
}

/** An amount as typed in a popup (separators ignored, Arabic-Indic digits accepted): canonical, null, or invalid. */
export function typedAmount(value: string): string | null | undefined {
  return budgetAmountText(normalizeDigits(value));
}

/** A count of people as typed: a whole number from 1, null when empty, undefined when invalid. */
export function typedCount(value: string): number | null | undefined {
  const plain = normalizeDigits(value).trim();
  if (plain === '') return null;
  if (!/^\d{1,5}$/.test(plain)) return undefined;
  const n = Number(plain);
  return n >= 1 && n <= 10_000 ? n : undefined;
}

/** What the line popup shows while L&D types (screen 2): sessions, sizes, cost and the split by department. */
export function linePreview(
  line: Pick<PlanLine, 'departments'>,
  typed: {
    readonly min: string;
    readonly max: string;
    readonly costPerSession: string;
    readonly costPerPerson: string;
  },
  fractionDigits: number,
): LineFigures {
  const valid = <T>(value: T | undefined): T | null => value ?? null;
  return lineFigures(
    {
      minPerSession: valid(typedCount(typed.min)),
      maxPerSession: valid(typedCount(typed.max)),
      costPerSession: valid(typedAmount(typed.costPerSession)),
      costPerPerson: valid(typedAmount(typed.costPerPerson)),
      departments: line.departments.map((d) => ({
        departmentId: d.departmentId,
        seats: d.seats,
        named: d.named,
      })),
    },
    fractionDigits,
  );
}

/**
 * The quarter most departments asked for, and how many (screen 2's hint «2 of 3 departments asked for Q1»):
 * each department counts once per quarter it asked.
 */
export function quarterAsked(line: Pick<PlanLine, 'needs' | 'departments'>): {
  readonly quarter: Quarter | null;
  readonly asked: number;
  readonly departments: number;
} {
  const byQuarter = new Map<Quarter, Set<string>>();
  for (const need of line.needs) {
    if (need.quarter === null) continue;
    const set = byQuarter.get(need.quarter) ?? new Set<string>();
    set.add(need.departmentId);
    byQuarter.set(need.quarter, set);
  }
  let best: Quarter | null = null;
  let count = 0;
  for (const quarter of QUARTERS) {
    const n = byQuarter.get(quarter)?.size ?? 0;
    if (n > count) {
      best = quarter;
      count = n;
    }
  }
  return { quarter: best, asked: count, departments: line.departments.length };
}

/**
 * A merge previewed (screen 1b): the needs of every line in one, with the session size and costs of the line
 * that is kept; and how many sessions and how much the lines need today, for «2 sessions instead of 3».
 */
export function mergePreview(
  lines: readonly Pick<
    PlanLine,
    | 'id'
    | 'departments'
    | 'minPerSession'
    | 'maxPerSession'
    | 'costPerSession'
    | 'costPerPerson'
    | 'sessions'
    | 'cost'
  >[],
  keepId: string,
  fractionDigits: number,
): {
  readonly people: number;
  readonly departments: number;
  readonly figures: LineFigures;
  readonly sessionsBefore: number;
  readonly costBefore: string | null;
} {
  const kept = lines.find((l) => l.id === keepId) ?? lines[0];
  const seats = new Map<string, { seats: number; named: number }>();
  for (const line of lines) {
    for (const d of line.departments) {
      const entry = seats.get(d.departmentId) ?? { seats: 0, named: 0 };
      entry.seats += d.seats;
      entry.named += d.named;
      seats.set(d.departmentId, entry);
    }
  }
  const figures = lineFigures(
    {
      minPerSession: kept?.minPerSession ?? null,
      maxPerSession: kept?.maxPerSession ?? null,
      costPerSession: kept?.costPerSession ?? null,
      costPerPerson: kept?.costPerPerson ?? null,
      departments: [...seats].map(([departmentId, v]) => ({ departmentId, ...v })),
    },
    fractionDigits,
  );
  const costed = lines.every((l) => l.cost !== null);
  return {
    people: figures.people,
    departments: seats.size,
    figures,
    sessionsBefore: lines.reduce((n, l) => n + (l.sessions?.sessions ?? 0), 0),
    costBefore: costed ? String(lines.reduce((n, l) => n + Number(l.cost ?? 0), 0)) : null,
  };
}

/** The line kept by default in a merge: the one with the most people (the first on a tie). */
export function defaultKeptLine(lines: readonly Pick<PlanLine, 'id' | 'people'>[]): string {
  let best = lines[0];
  for (const line of lines) if (best === undefined || line.people > best.people) best = line;
  return best?.id ?? '';
}

/** The lines of a group, in the order the query gives them, after the search. */
export function visibleGroups(
  view: Pick<PlanView, 'groups' | 'lines'>,
  grouping: PlanGrouping,
  matches: (line: PlanLine) => boolean,
): {
  readonly key: string | null;
  readonly group: PlanView['groups'][PlanGrouping][number];
  readonly lines: readonly PlanLine[];
}[] {
  const byId = new Map(view.lines.map((l) => [l.id, l]));
  return view.groups[grouping]
    .map((group) => ({
      key: group.key,
      group,
      lines: group.lineIds.flatMap((id) => {
        const line = byId.get(id);
        return line && matches(line) ? [line] : [];
      }),
    }))
    .filter((g) => g.lines.length > 0);
}
