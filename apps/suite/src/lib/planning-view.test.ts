import type { CycleListItem } from '@jadarat/tms';
import { describe, expect, it } from 'vitest';
import { dayFormatter, formatAmount } from './planning-format';
import {
  CYCLE_TONE,
  FORM_TONE,
  type PickerUnit,
  allUnitsScope,
  cycleHref,
  cycleSettingsHref,
  cyclesHref,
  daysLeft,
  fieldErrorKey,
  filterCycles,
  legacyStepHref,
  listFilter,
  localName,
  parseReminderDays,
  pickerUnits,
  progressCounts,
  sameScope,
  settingsTab,
  statusCounts,
  sumAmounts,
  unitPicks,
  unitsInScope,
} from './planning-view';

describe('addresses of the cycle pages (the Kawadir pattern, T-M3-20)', () => {
  it('links a cycle, its Settings sections and the list with a popup open', () => {
    expect(cycleHref('ar', 'c1')).toBe('/ar/suite/planning/cycles/c1');
    expect(cycleSettingsHref('en', 'c1')).toBe('/en/suite/planning/cycles/c1/settings');
    // The first section needs no parameter.
    expect(cycleSettingsHref('en', 'c1', 'departments')).toBe(
      '/en/suite/planning/cycles/c1/settings',
    );
    expect(cycleSettingsHref('ar', 'c1', 'reminders')).toBe(
      '/ar/suite/planning/cycles/c1/settings?tab=reminders',
    );
    expect(cyclesHref('en')).toBe('/en/suite/planning/cycles');
    expect(cyclesHref('en', { filter: 'all' })).toBe('/en/suite/planning/cycles');
    expect(cyclesHref('ar', { filter: 'draft' })).toBe('/ar/suite/planning/cycles?status=draft');
    expect(cyclesHref('en', { open: { kind: 'new' } })).toBe('/en/suite/planning/cycles?new=1');
    expect(cyclesHref('en', { open: { kind: 'launch', id: 'c1' } })).toBe(
      '/en/suite/planning/cycles?launch=c1',
    );
  });

  it('reads the list filter and the settings section from the address, the first by default', () => {
    expect(listFilter('open')).toBe('open');
    expect(listFilter('nope')).toBe('all');
    expect(listFilter(['draft'])).toBe('all');
    expect(listFilter(undefined)).toBe('all');
    expect(settingsTab('form')).toBe('form');
    expect(settingsTab('approvals')).toBe('departments');
    expect(settingsTab(undefined)).toBe('departments');
  });

  it('sends the addresses of the old six-step set-up to their new place', () => {
    expect(legacyStepHref('en', 'c1', 'basics')).toBe('/en/suite/planning/cycles?edit=c1');
    expect(legacyStepHref('en', 'c1', 'review')).toBe('/en/suite/planning/cycles?launch=c1');
    expect(legacyStepHref('en', 'c1', 'reminders')).toBe(
      '/en/suite/planning/cycles/c1/settings?tab=reminders',
    );
    for (const step of ['scope', 'budget', 'approvals', undefined, 'nope']) {
      expect(legacyStepHref('ar', 'c1', step)).toBe('/ar/suite/planning/cycles/c1/settings');
    }
  });
});

describe('list helpers', () => {
  const item = (status: CycleListItem['status']): CycleListItem => ({
    id: status,
    name: { ar: 'خطة', en: 'Plan' },
    periodStart: '2027-01-01',
    periodEnd: '2027-12-31',
    deadline: '2026-11-30',
    status,
    departmentCount: 1,
    submittedCount: 0,
    draft: null,
  });

  it('filters the cycles by the summary cards: all, drafts, open, everything closed', () => {
    const cycles = [item('draft'), item('open'), item('closed'), item('consolidated')];
    expect(filterCycles(cycles, 'all')).toBe(cycles);
    expect(filterCycles(cycles, 'draft').map((c) => c.id)).toEqual(['draft']);
    expect(filterCycles(cycles, 'open').map((c) => c.id)).toEqual(['open']);
    expect(filterCycles(cycles, 'closed').map((c) => c.id)).toEqual(['closed', 'consolidated']);
    expect(filterCycles([], 'closed')).toEqual([]);
  });

  it('counts the days left to a deadline from the organization’s today', () => {
    expect(daysLeft('2026-10-21', '2026-11-20')).toBe(30);
    expect(daysLeft('2026-10-21', '2026-10-21')).toBe(0);
    expect(daysLeft('2026-10-21', '2026-10-20')).toBe(-1);
  });

  it('counts the units per status for the progress chips', () => {
    expect(statusCounts(['not_started', 'late', 'submitted', 'late', 'returned'])).toEqual({
      all: 5,
      not_started: 1,
      draft: 0,
      submitted: 1,
      returned: 1,
      late: 2,
    });
  });

  it('names in the page language, else the other one', () => {
    expect(localName('en', { ar: 'خطة', en: 'Plan' })).toBe('Plan');
    expect(localName('en', { ar: 'خطة', en: null })).toBe('خطة');
    expect(localName('en', { ar: 'خطة', en: '' })).toBe('خطة');
    expect(localName('ar', { ar: 'خطة', en: 'Plan' })).toBe('خطة');
    expect(localName('ar', { ar: '', en: 'Plan' })).toBe('Plan');
  });

  it('gives every status a badge tone; Late is a danger', () => {
    expect(CYCLE_TONE.open).toBe('success');
    expect(FORM_TONE.late).toBe('danger');
    expect(FORM_TONE.submitted).toBe('success');
  });

  it('counts the progress per form status (C9)', () => {
    expect(progressCounts(['not_started', 'late', 'submitted', 'late', 'draft'])).toEqual({
      departments: 5,
      notStarted: 1,
      submitted: 1,
      late: 2,
    });
  });
});

describe('formatting', () => {
  it('shows calendar days as the organization does, without a time-zone shift', () => {
    expect(dayFormatter('en', 'gregorian')('2027-01-01')).toBe('Jan 1, 2027');
    expect(dayFormatter('en', 'dual')('2027-01-01')).toContain(' · ');
    expect(dayFormatter('en', 'gregorian')('not a day')).toBe('not a day');
  });

  it('shows amounts in the organization’s currency with Western digits', () => {
    expect(formatAmount('en', '1200.5', 'SAR')).toContain('1,200.5');
    expect(formatAmount('ar', 50000, 'SAR')).toMatch(/50[,٬]000/);
    expect(formatAmount('en', 'x', 'SAR')).toBe('x');
    expect(formatAmount('en', '5', 'NOPE!')).toBe('5 NOPE!');
  });

  it('sums typed envelopes, ignoring empty ones', () => {
    expect(sumAmounts(['1,000', '', null, '250.5', 'abc'])).toBe(1250.5);
  });

  it('maps field error codes to texts', () => {
    expect(fieldErrorKey('BEFORE_START')).toBe('setup.fieldErrors.beforeStart');
    // The approval chain's codes are gone with its screens (EP-PLN §13 e).
    expect(fieldErrorKey('DUPLICATE_APPROVER')).toBe('setup.fieldErrors.invalid');
    expect(fieldErrorKey('TOO_SMALL')).toBe('setup.fieldErrors.required');
    expect(fieldErrorKey('SOMETHING')).toBe('setup.fieldErrors.invalid');
  });
});

describe('departments of a cycle (the popup, Settings, the launch question)', () => {
  const unit = (
    id: string,
    parentId: string | null,
    over: Partial<PickerUnit> = {},
  ): PickerUnit => ({
    id,
    parentId,
    branchId: null,
    name: id,
    depth: parentId === null ? 0 : 1,
    active: true,
    head: 'Head',
    ...over,
  });
  // Tree order: Sales (East, West under it), Operations (no head), an inactive Legacy with a live unit.
  const units = [
    unit('sales', null),
    unit('east', 'sales', { branchId: 'jeddah', head: 'Head (from sales)' }),
    unit('west', 'sales', { head: null }),
    unit('ops', null, { head: null }),
    unit('legacy', null, { active: false }),
    unit('archive', 'legacy'),
  ];

  it('«All departments» picks the top-level units: everything under them is included', () => {
    expect(allUnitsScope(units)).toEqual(['sales', 'ops', 'legacy']);
    // A unit whose parent is not in the list (it cannot be seen) counts as top level.
    expect(allUnitsScope([unit('orphan', 'gone')])).toEqual(['orphan']);
    expect(
      unitsInScope(units, { departmentIds: allUnitsScope(units), branchIds: [] }).map((u) => u.id),
    ).toEqual(['sales', 'east', 'west', 'ops', 'archive']);
  });

  it('lists the units a scope covers, in tree order — one form each; inactive units get none', () => {
    expect(
      unitsInScope(units, { departmentIds: ['sales'], branchIds: [] }).map((u) => u.id),
    ).toEqual(['sales', 'east', 'west']);
    expect(
      unitsInScope(units, { departmentIds: [], branchIds: ['jeddah'] }).map((u) => u.id),
    ).toEqual(['east']);
    expect(
      unitsInScope(units, { departmentIds: ['legacy'], branchIds: [] }).map((u) => u.id),
    ).toEqual(['archive']);
    expect(unitsInScope(units, { departmentIds: [], branchIds: [] })).toEqual([]);
    // The heads the launch question shows, and who is missing one.
    expect(
      unitsInScope(units, { departmentIds: ['sales', 'ops'], branchIds: [] }).map((u) => u.head),
    ).toEqual(['Head', 'Head (from sales)', null, null]);
  });

  it('tells a picked unit from one that comes with a unit above or with its branch', () => {
    const picks = unitPicks(units, { departmentIds: ['sales', 'west', 'ops'], branchIds: [] });
    expect(Object.fromEntries(picks)).toEqual({
      sales: 'picked',
      east: 'covered',
      // Picked itself too, but it comes with Sales anyway: it cannot be taken out on its own.
      west: 'covered',
      ops: 'picked',
      legacy: 'out',
      archive: 'out',
    });
    const byBranch = unitPicks(units, { departmentIds: [], branchIds: ['jeddah'] });
    expect(byBranch.get('east')).toBe('covered');
    expect(byBranch.get('sales')).toBe('out');
  });

  it('names the units for the pickers: the level when levels mix, the head and where it comes from', () => {
    const option = (
      id: string,
      levelOrdinal: number,
      head: { ar: string | null; en: string | null } | null,
      via: { ar: string; en: string | null } | null = null,
    ) => ({
      id,
      parentId: levelOrdinal === 1 ? null : 'sales',
      branchId: null,
      name: { ar: `ع-${id}`, en: id },
      levelOrdinal,
      depth: levelOrdinal - 1,
      active: true,
      hasHead: head !== null,
      head: head ? { name: head, via } : null,
    });
    const levels = [
      { ordinal: 1, nameEn: 'Sector', nameAr: 'قطاع' },
      { ordinal: 2, nameEn: 'Section', nameAr: 'شعبة' },
    ];
    const via = (name: string, unit: string) => `${name} (from ${unit})`;
    const mixed = pickerUnits(
      'en',
      [
        option('sales', 1, { ar: 'سارة', en: 'Sara' }),
        option('east', 2, { ar: 'سارة', en: 'Sara' }, { ar: 'المبيعات', en: 'Sales' }),
        option('west', 2, null),
      ],
      levels,
      via,
    );
    expect(mixed.map((u) => [u.name, u.depth, u.head])).toEqual([
      ['sales · Sector', 0, 'Sara'],
      ['east · Section', 1, 'Sara (from Sales)'],
      ['west · Section', 1, null],
    ]);
    // One level only: the plain names; Arabic names in Arabic.
    expect(
      pickerUnits('ar', [option('sales', 1, { ar: 'سارة', en: null })], levels, via).map((u) => [
        u.name,
        u.head,
      ]),
    ).toEqual([['ع-sales', 'سارة']]);
  });

  it('compares two scopes whatever their order', () => {
    const scope = { departmentIds: ['a', 'b'], branchIds: ['x'] };
    expect(sameScope(scope, { departmentIds: ['b', 'a'], branchIds: ['x'] })).toBe(true);
    expect(sameScope(scope, { departmentIds: ['a'], branchIds: ['x'] })).toBe(false);
    expect(sameScope(scope, { departmentIds: ['a', 'c'], branchIds: ['x'] })).toBe(false);
    expect(sameScope(scope, { departmentIds: ['a', 'b'], branchIds: [] })).toBe(false);
  });
});

describe('reminders', () => {
  it('reads reminder days: whole days 1–90, each once', () => {
    expect(parseReminderDays(['7', ' 2 '])).toEqual({ ok: true, days: [7, 2] });
    expect(parseReminderDays([])).toEqual({ ok: true, days: [] });
    expect(parseReminderDays([''])).toEqual({ ok: false, key: 'setup.fieldErrors.dayRange' });
    expect(parseReminderDays(['0'])).toEqual({ ok: false, key: 'setup.fieldErrors.dayRange' });
    expect(parseReminderDays(['1.5'])).toEqual({ ok: false, key: 'setup.fieldErrors.dayRange' });
    expect(parseReminderDays(['3', '3'])).toEqual({
      ok: false,
      key: 'setup.fieldErrors.duplicateDay',
    });
  });
});
