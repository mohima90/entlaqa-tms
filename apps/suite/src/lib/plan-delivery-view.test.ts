import { describe, expect, it } from 'vitest';
import {
  calendarParams,
  calendarPath,
  checkSessions,
  deliveryParams,
  deliveryPath,
  deliveryPopup,
  lineFilter,
  parseSeats,
  periodYear,
  rowsFromProposal,
} from './plan-delivery-view';

const CYCLE = '40000000-0000-4000-8000-000000000001';
const LINE = '20000000-0000-4000-8000-00000000000A';

describe('the popups by address (WP-LD-04)', () => {
  it('reads «open» and «line», and refuses anything else', () => {
    expect(deliveryPopup({ open: 'course', line: LINE })).toEqual({
      kind: 'course',
      lineId: LINE.toLowerCase(),
      mode: 'create',
    });
    expect(deliveryPopup({ open: 'link', line: LINE })).toMatchObject({ mode: 'link' });
    expect(deliveryPopup({ open: 'sessions', line: [LINE] })).toEqual({
      kind: 'sessions',
      lineId: LINE.toLowerCase(),
    });
    expect(deliveryPopup({ open: 'sessions', line: 'not-a-uuid' })).toBeNull();
    expect(deliveryPopup({ open: 'delete', line: LINE })).toBeNull();
    expect(deliveryPopup({})).toBeNull();
  });
});

describe('«Courses and sessions» addresses and filter pills', () => {
  it('keeps a known filter and a short search', () => {
    expect(deliveryParams({ show: 'needs_course', q: '  excel ' })).toEqual({
      show: 'needs_course',
      q: 'excel',
    });
    expect(deliveryParams({ show: 'everything', q: 'x'.repeat(300) }).show).toBe('all');
    expect(deliveryParams({ q: 'x'.repeat(300) }).q).toHaveLength(100);
  });

  it('builds the page address with its filter and an open popup', () => {
    expect(deliveryPath(CYCLE)).toBe(`/suite/planning/cycles/${CYCLE}/sessions`);
    expect(deliveryPath(CYCLE, { show: 'all', q: '' })).toBe(
      `/suite/planning/cycles/${CYCLE}/sessions`,
    );
    expect(
      deliveryPath(CYCLE, { show: 'needs_sessions' }, { kind: 'sessions', lineId: 'l1' }),
    ).toBe(`/suite/planning/cycles/${CYCLE}/sessions?show=needs_sessions&open=sessions&line=l1`);
    expect(deliveryPath(CYCLE, {}, { kind: 'course', lineId: 'l1', mode: 'link' })).toContain(
      'open=link&line=l1',
    );
  });

  it('counts a line under the pill of where it stands', () => {
    const f = (status: 'in_plan' | 'left_out', hasCourse: boolean, state: string) =>
      lineFilter({ status, hasCourse, state: state as never });
    expect(f('left_out', false, 'left_out')).toBeNull();
    expect(f('in_plan', false, 'needs_course')).toBe('needs_course');
    expect(f('in_plan', true, 'needs_sessions')).toBe('needs_sessions');
    expect(f('in_plan', true, 'partly_drafted')).toBe('needs_sessions');
    expect(f('in_plan', true, 'drafted')).toBe('sessions_created');
    expect(f('in_plan', true, 'over_drafted')).toBe('sessions_created');
    expect(f('in_plan', true, 'needs_size')).toBeNull();
  });
});

describe('the training calendar address', () => {
  it('reads the year, quarter, branch, course, view and draft — untrusted, with a fallback year', () => {
    expect(
      calendarParams(
        {
          year: '2027',
          quarter: '2',
          branch: 'none',
          course: LINE,
          view: 'list',
          draft: LINE,
        },
        2026,
      ),
    ).toEqual({
      year: 2027,
      quarter: 2,
      branch: 'none',
      course: LINE.toLowerCase(),
      view: 'list',
      draft: LINE.toLowerCase(),
    });
    expect(calendarParams({ year: '1999', quarter: '5', branch: 'x', view: 'grid' }, 2026)).toEqual(
      { year: 2026, quarter: null, branch: null, course: null, view: null, draft: null },
    );
  });

  it('builds the calendar address, with a draft or a popup open', () => {
    expect(calendarPath({ year: 2027 })).toBe('/suite/calendar?year=2027');
    expect(calendarPath({ year: 2027, quarter: 1, branch: 'none', view: 'year' })).toBe(
      '/suite/calendar?year=2027&quarter=1&branch=none&view=year',
    );
    expect(calendarPath({ year: 2027 }, { draft: 'd1' })).toBe(
      '/suite/calendar?year=2027&draft=d1',
    );
    expect(calendarPath({}, { popup: { kind: 'sessions', lineId: 'l1' } })).toBe(
      '/suite/calendar?open=sessions&line=l1',
    );
    expect(periodYear('2027-07-01')).toBe(2027);
  });
});

describe('«Create draft sessions»: the rows and their live check', () => {
  const line = {
    people: 47,
    costPerSession: '9000',
    costPerPerson: null,
    cost: '27000',
    quarter: 1,
  };
  const period = { start: '2027-01-01', end: '2027-12-31' };
  const none = { seats: 0, cost: '0', count: 0 };
  const rows = rowsFromProposal([
    { month: '2027-01', branchId: 'b1', seats: 16, personIds: ['p1', 'p2'], departments: [] },
    { month: '2027-02', branchId: 'b1', seats: 16, personIds: [], departments: [] },
    { month: '2027-03', branchId: null, seats: 15, personIds: [], departments: [] },
  ]);

  it('starts from the proposal and matches the approved plan', () => {
    expect(rows.map((r) => [r.month, r.branchId, r.seats])).toEqual([
      ['2027-01', 'b1', '16'],
      ['2027-02', 'b1', '16'],
      ['2027-03', '', '15'],
    ]);
    const check = checkSessions(rows, line, none, period);
    expect(check).toMatchObject({
      seats: 47,
      allPlaced: true,
      unplaced: 0,
      costs: ['9000', '9000', '9000'],
      cost: '27000',
      matchesPlan: true,
      outsideQuarter: [false, false, false],
      problems: {},
      named: 2,
    });
  });

  it('follows the edits: fewer seats, a month outside the quarter or the period, a removed row', () => {
    const edited = [
      { ...rows[0], seats: '1' },
      { ...rows[1], month: '2027-05' },
      { ...rows[2], seats: 'abc' },
    ] as typeof rows;
    const check = checkSessions(edited, line, none, period);
    expect(check.problems).toEqual({ 0: 'FEWER_THAN_PEOPLE', 2: 'SEATS' });
    expect(check.outsideQuarter).toEqual([false, true, false]);
    expect(check.allPlaced).toBe(false);
    expect(check.unplaced).toBe(30);
    expect(check.cost).toBeNull();
    const [firstRow] = rows;
    if (!firstRow) throw new Error('no row');
    const outside = checkSessions([{ ...firstRow, month: '2028-01' }], line, none, period);
    expect(outside.problems).toEqual({ 0: 'OUTSIDE_PERIOD' });
    const two = checkSessions(rows.slice(0, 2), line, none, period);
    expect(two).toMatchObject({ seats: 32, cost: '18000', matchesPlan: false, unplaced: 15 });
  });

  it('counts each planned participant once', () => {
    const [firstRow, secondRow] = rows;
    if (!firstRow || !secondRow) throw new Error('no row');
    const check = checkSessions(
      [firstRow, { ...secondRow, personIds: ['P1', 'p3'] }],
      line,
      none,
      period,
    );
    expect(check.named).toBe(3);
  });

  it('adds the drafts that exist already', () => {
    const check = checkSessions(
      rows.slice(2),
      line,
      { seats: 32, cost: '18000', count: 2 },
      period,
    );
    expect(check).toMatchObject({ seats: 15, totalSeats: 47, cost: '27000', matchesPlan: true });
  });

  it('reads seats in any digits, whole numbers from 1 to 10,000', () => {
    expect(parseSeats(' 16 ')).toBe(16);
    expect(parseSeats('١٦')).toBe(16);
    expect(parseSeats('۱۶')).toBe(16);
    expect(parseSeats('0')).toBeNull();
    expect(parseSeats('10001')).toBeNull();
    expect(parseSeats('1.5')).toBeNull();
    expect(parseSeats('')).toBeNull();
  });
});
