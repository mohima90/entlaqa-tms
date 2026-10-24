/**
 * A branch's own working week (WP-HR-01; FR-ADM-04 working week with half-days and hours; business flow
 * EP-ORG-structure-completion.md §3 E): client-safe helpers of the branch form. A branch without its own week
 * follows the organization's (organization profile: days and one block of hours); with its own week, each day
 * has one block of hours, and a day of at most half the organization's hours shows as a half-day.
 */
export interface WeekDayRow {
  /** 0 = Sunday … 6 = Saturday (as platform.tenant_settings.working_days). */
  readonly day: number;
  readonly works: boolean;
  readonly startsAt: string;
  readonly endsAt: string;
}

export interface OrganizationWeekView {
  readonly days: readonly number[];
  readonly startsAt: string;
  readonly endsAt: string;
}

const DEFAULT_START = '08:00';
const DEFAULT_END = '16:00';

/** The seven rows the form edits: the branch's own days, else a copy of the organization's week. */
export function weekRows(
  own:
    readonly { readonly day: number; readonly startsAt: string; readonly endsAt: string }[] | null,
  organization: OrganizationWeekView | null,
): WeekDayRow[] {
  const startsAt = organization?.startsAt ?? DEFAULT_START;
  const endsAt = organization?.endsAt ?? DEFAULT_END;
  return Array.from({ length: 7 }, (_, day) => {
    if (own) {
      const found = own.find((row) => row.day === day);
      return found
        ? { day, works: true, startsAt: found.startsAt, endsAt: found.endsAt }
        : { day, works: false, startsAt, endsAt };
    }
    // Sunday to Thursday without a profile (the database's default week).
    const works = organization ? organization.days.includes(day) : day <= 4;
    return { day, works, startsAt, endsAt };
  });
}

/** What the action receives: the working days only (an empty week is refused by the action). */
export function workingDaysOf(
  rows: readonly WeekDayRow[],
): { day: number; startsAt: string; endsAt: string }[] {
  return rows
    .filter((row) => row.works)
    .map((row) => ({ day: row.day, startsAt: row.startsAt, endsAt: row.endsAt }));
}

function minutes(clock: string): number {
  const [hours = '0', mins = '0'] = clock.split(':');
  return Number(hours) * 60 + Number(mins);
}

/** A working day of at most half the organization's hours (8 hours without a profile). */
export function isHalfDay(row: WeekDayRow, organization: OrganizationWeekView | null): boolean {
  if (!row.works) return false;
  const length = minutes(row.endsAt) - minutes(row.startsAt);
  const full =
    minutes(organization?.endsAt ?? DEFAULT_END) - minutes(organization?.startsAt ?? DEFAULT_START);
  return length > 0 && full > 0 && length * 2 <= full;
}

/** The end is after the start (else the row shows an error and the form does not send). */
export function hoursValid(row: WeekDayRow): boolean {
  return !row.works || minutes(row.endsAt) > minutes(row.startsAt);
}
