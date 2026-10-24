import { describe, expect, it } from 'vitest';
import { hoursValid, isHalfDay, weekRows, workingDaysOf } from './branch-week';

const ORG = { days: [0, 1, 2, 3, 4], startsAt: '08:00', endsAt: '16:00' };

describe('branch working week (WP-HR-01)', () => {
  it('starts from the organization week, or from the branch own days', () => {
    const rows = weekRows(null, ORG);
    expect(rows.map((r) => r.works)).toEqual([true, true, true, true, true, false, false]);
    expect(rows[5]).toEqual({ day: 5, works: false, startsAt: '08:00', endsAt: '16:00' });
    const own = weekRows([{ day: 6, startsAt: '09:00', endsAt: '13:00' }], ORG);
    expect(own.filter((r) => r.works)).toEqual([
      { day: 6, works: true, startsAt: '09:00', endsAt: '13:00' },
    ]);
    // Without a profile: Sunday to Thursday, 08:00–16:00.
    expect(
      weekRows(null, null)
        .filter((r) => r.works)
        .map((r) => r.day),
    ).toEqual([0, 1, 2, 3, 4]);
  });

  it('sends the working days only', () => {
    const rows = weekRows(null, ORG).map((r) => (r.day === 4 ? { ...r, endsAt: '12:00' } : r));
    expect(workingDaysOf(rows)).toHaveLength(5);
    expect(workingDaysOf(rows)[4]).toEqual({ day: 4, startsAt: '08:00', endsAt: '12:00' });
  });

  it('shows a half-day for at most half the organization hours, and checks the hours', () => {
    const day = { day: 4, works: true, startsAt: '08:00', endsAt: '12:00' };
    expect(isHalfDay(day, ORG)).toBe(true);
    expect(isHalfDay({ ...day, endsAt: '12:30' }, ORG)).toBe(false);
    expect(isHalfDay({ ...day, works: false }, ORG)).toBe(false);
    expect(hoursValid(day)).toBe(true);
    expect(hoursValid({ ...day, endsAt: '08:00' })).toBe(false);
    expect(hoursValid({ ...day, works: false, endsAt: '07:00' })).toBe(true);
  });
});
