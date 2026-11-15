import { describe, expect, it } from 'vitest';
import { DEPT, planFixture } from '../components/training-plan/plan-fixture';
import {
  budgetMeter,
  budgetTone,
  cycleTab,
  defaultKeptLine,
  lineMatches,
  linePreview,
  mergePreview,
  planAmount,
  planGrouping,
  planNumber,
  planSubview,
  quarterAsked,
  typedAmount,
  typedCount,
  visibleGroups,
} from './training-plan-view';

const view = planFixture();
const line = (title: string) => {
  const found = view.lines.find((l) => l.title === title);
  if (!found) throw new Error(title);
  return found;
};
const names: Record<string, string> = {
  [DEPT.sales]: 'Sales',
  [DEPT.hr]: 'Human Resources',
  [DEPT.finance]: 'Finance',
  [DEPT.it]: 'IT',
};

describe('the Plan tab helpers (WP-LD-02, FR-PLN-05/06)', () => {
  it('reads the tab, the view and the grouping from the address, defaulting safely', () => {
    expect(cycleTab('plan')).toBe('plan');
    expect(cycleTab(['plan'])).toBe('progress');
    expect(cycleTab(undefined)).toBe('progress');
    expect(planSubview('budget')).toBe('budget');
    expect(planSubview('x')).toBe('lines');
    expect(planGrouping('quarter')).toBe('quarter');
    expect(planGrouping('delivery_type')).toBe('delivery_type');
    expect(planGrouping('anything')).toBe('topic');
    expect(planGrouping(undefined)).toBe('topic');
  });

  it('formats amounts in the cycle currency without needless decimals, Western digits in Arabic', () => {
    expect(planAmount('en', '15000', 'SAR').replace(/\s/gu, ' ')).toBe('SAR 15,000');
    expect(planAmount('en', '6383.33', 'SAR')).toContain('6,383.33');
    expect(planAmount('en', '1.2345', 'KWD', 3)).toContain('1.235');
    expect(planAmount('ar', '15000', 'SAR')).toMatch(/15,000|15٬000/u);
    expect(planAmount('ar', '15000', 'SAR')).not.toMatch(/[٠-٩]/u);
    expect(planAmount('en', 'oops', 'SAR')).toBe('oops');
    expect(planAmount('en', 10, 'NOT-A-CURRENCY')).toBe('10 NOT-A-CURRENCY');
    expect(planNumber('ar', 313)).toBe('313');
  });

  it('colours a budget as the server decided: within, amber under 10 %, red from 10 %', () => {
    expect(budgetTone({ kind: 'none' })).toBe('none');
    expect(budgetTone({ kind: 'within', left: '10' })).toBe('within');
    expect(budgetTone({ kind: 'over', overBy: '1', percentOver: 1, severity: 'amber' })).toBe(
      'amber',
    );
    expect(budgetTone({ kind: 'over', overBy: '9', percentOver: 13, severity: 'red' })).toBe('red');
    const hr = view.budget.departments.find((d) => d.departmentId === DEPT.hr);
    const finance = view.budget.departments.find((d) => d.departmentId === DEPT.finance);
    expect(hr && budgetTone(hr.state)).toBe('red');
    expect(finance && budgetTone(finance.state)).toBe('amber');
  });

  it('fills the meter up to the envelope, full once over, and never divides by zero', () => {
    expect(budgetMeter('500', '1000')).toEqual({ value: 500, max: 1000 });
    expect(budgetMeter('1500', '1000')).toEqual({ value: 1000, max: 1000 });
    expect(budgetMeter('0', null)).toEqual({ value: 0, max: 1 });
    expect(budgetMeter('5', '0')).toEqual({ value: 1, max: 1 });
  });

  it('searches titles and departments, spelling-insensitive', () => {
    const excel = line('Excel – advanced formulas');
    const name = (id: string) => names[id] ?? '';
    expect(lineMatches(excel, '', name)).toBe(true);
    expect(lineMatches(excel, 'EXCEL', name)).toBe(true);
    expect(lineMatches(excel, 'finance', name)).toBe(true);
    expect(lineMatches(excel, 'cloud', name)).toBe(false);
    const groups = visibleGroups(view, 'topic', (l) => lineMatches(l, 'security', name));
    expect(groups.flatMap((g) => g.lines.map((l) => l.title))).toEqual([
      'Cyber security awareness',
      'Information security basics',
    ]);
    expect(visibleGroups(view, 'quarter', () => true).map((g) => g.key)).toEqual(['1', '2', '3']);
  });

  it('reads amounts and counts as typed: separators, Arabic-Indic digits, empty and invalid', () => {
    expect(typedAmount('5,000')).toBe('5000');
    expect(typedAmount('٥٠٠٠٫٥')).toBeUndefined();
    expect(typedAmount('٥٠٠٠')).toBe('5000');
    expect(typedAmount('')).toBeNull();
    expect(typedAmount('abc')).toBeUndefined();
    expect(typedCount('20')).toBe(20);
    expect(typedCount('٢٠')).toBe(20);
    expect(typedCount(' ')).toBeNull();
    expect(typedCount('0')).toBeUndefined();
    expect(typedCount('2.5')).toBeUndefined();
    expect(typedCount('20000')).toBeUndefined();
  });

  it('previews a line as L&D types: 47 people, 8–20 a session at SAR 5,000 → 3 sessions of 16, 16 and 15', () => {
    const excel = line('Excel – advanced formulas');
    const preview = linePreview(
      excel,
      { min: '8', max: '20', costPerSession: '5,000', costPerPerson: '' },
      2,
    );
    expect(preview.plan?.sizes).toEqual([16, 16, 15]);
    expect(preview.cost).toBe('15000');
    expect(preview.shares.get(DEPT.sales)).toBe('6382.98');
    const noSize = linePreview(
      excel,
      { min: '', max: '', costPerSession: '5000', costPerPerson: '' },
      2,
    );
    expect(noSize.plan).toBeNull();
    expect(noSize.cost).toBeNull();
    const invalid = linePreview(
      excel,
      { min: 'x', max: '20', costPerSession: 'x', costPerPerson: '' },
      2,
    );
    expect(invalid.plan?.sessions).toBe(3);
    expect(invalid.cost).toBeNull();
  });

  it('preselects the quarter most departments asked for', () => {
    expect(quarterAsked(line('Excel – advanced formulas'))).toEqual({
      quarter: 1,
      asked: 2,
      departments: 3,
    });
    expect(quarterAsked({ needs: [], departments: [] })).toEqual({
      quarter: null,
      asked: 0,
      departments: 0,
    });
  });

  it('previews a merge with the kept line’s size and cost, and what it saves', () => {
    const cyber = line('Cyber security awareness');
    const basics = line('Information security basics');
    expect(defaultKeptLine([basics, cyber])).toBe(cyber.id);
    expect(defaultKeptLine([])).toBe('');
    const merged = mergePreview([cyber, basics], cyber.id, 2);
    expect(merged.people).toBe(77);
    expect(merged.departments).toBe(3);
    expect(merged.figures.plan?.sessions).toBe(2);
    expect(merged.sessionsBefore).toBe(3);
    expect(merged.figures.cost).toBe('5000');
    expect(merged.costBefore).toBe('7500');
    const withUncosted = mergePreview([cyber, line('First aid at work')], 'unknown', 2);
    expect(withUncosted.costBefore).toBeNull();
  });
});
