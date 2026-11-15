// @vitest-environment happy-dom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { trainingPlanTexts } from '../../lib/training-plan-queries';
import { DEPT, planFixture } from './plan-fixture';
import { PlanNotOpen } from './plan-not-open';
import { PlanTab } from './plan-tab';

const actions = vi.hoisted(() => ({
  openConsolidationAction: vi.fn(),
  syncPlanNeedsAction: vi.fn(),
  updatePlanLineAction: vi.fn(),
  mergePlanLinesAction: vi.fn(),
  moveNeedOutAction: vi.fn(),
  setPlanLinesQuarterAction: vi.fn(),
  leaveOutPlanLineAction: vi.fn(),
  bringBackPlanLineAction: vi.fn(),
  setBudgetReasonAction: vi.fn(),
}));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@jadarat/tms/actions/consolidation', () => actions);
vi.mock('next-intl/server', () => ({ getTranslations: vi.fn() }));

/**
 * The Plan tab (WP-LD-02, T-M3-06; FR-PLN-05/06; design screens 1, 1b, 2, 2b, 3): the summary, «Needs your
 * attention», groups with subtotals, the bulk bar, the line popup's live figures, merge, leave out with a
 * reason, the budget by department with its colours and reasons; read-only without the right to change it;
 * the empty state before the plan exists.
 */
let root: Root | undefined;
const texts = trainingPlanTexts('en');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/en/suite/planning/cycles/x?tab=plan');
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
});

function mount(ui: ReactNode) {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(ui));
  return container;
}
const click = (element: Element | null | undefined) => {
  if (!element) throw new Error('nothing to click');
  act(() => {
    (element as HTMLElement).click();
  });
};
const type = (input: HTMLInputElement | HTMLTextAreaElement | null, value: string) => {
  if (!input) throw new Error('no field');
  act(() => {
    const proto =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- the native setter, so React's value tracking sees a change
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
const byTest = (id: string, scope: ParentNode = document) =>
  scope.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const allByTest = (id: string, scope: ParentNode = document) => [
  ...scope.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
];
const row = (title: string) =>
  allByTest('plan-line-row').find((r) => r.textContent.includes(title)) ?? null;
const tab = (manage = true) => (
  <PlanTab
    locale="en"
    view={planFixture({ manage })}
    texts={texts}
    errors={{ 'errors.internalError': 'Something went wrong.' }}
    initialSubview="lines"
    initialGrouping="topic"
  />
);

describe('the Plan tab', () => {
  it('shows the summary, what needs attention and the lines grouped by topic with subtotals', () => {
    mount(tab());
    const summary = byTest('plan-summary')?.textContent ?? '';
    expect(summary).toContain('Plan lines');
    expect(summary).toContain('4 in the plan · 1 left out');
    expect(summary).toContain('1 line still needs a cost');
    expect(byTest('plan-attention-uncosted')?.textContent).toContain(
      '«First aid at work» has no cost',
    );
    expect(byTest('plan-attention-look-alike')?.textContent).toContain(
      '«Cyber security awareness» and «Information security basics» look alike.',
    );
    expect(byTest('plan-attention-budget')?.textContent).toContain(
      '2 departments are over budget; 1 still needs a one-line reason',
    );
    expect(byTest('plan-attention-pending')?.textContent).toContain('Human Resources');
    const groups = allByTest('plan-group').map((g) => g.querySelector('th')?.textContent);
    expect(groups[0]).toContain('Digital skills');
    expect(groups[0]).toContain('3 lines');
    expect(row('First aid at work')?.textContent).toContain('Needs a cost');
    const leftOut = row('Public speaking');
    expect(leftOut?.textContent).toContain('Left out');
    expect(leftOut?.textContent).toContain('«Not a priority this year.»');
    expect(row('Excel – advanced formulas')?.textContent).toContain('16 · 16 · 15');
  });

  it('filters by the search and switches the grouping, keeping it in the address', () => {
    mount(tab());
    const search = document.querySelector<HTMLInputElement>('#plan-search');
    type(search, 'security');
    expect(allByTest('plan-line-row')).toHaveLength(2);
    type(search, 'nothing like this');
    expect(document.body.textContent).toContain('No lines match');
    type(search, '');
    click(byTest('plan-group-quarter'));
    expect(allByTest('plan-group').map((g) => g.querySelector('th')?.textContent ?? '')).toEqual([
      expect.stringContaining('Q1'),
      expect.stringContaining('Q2'),
      expect.stringContaining('Q3'),
    ]);
    expect(router.replace).toHaveBeenLastCalledWith(expect.stringContaining('group=quarter'), {
      scroll: false,
    });
  });

  it('opens the bulk bar for ticked lines and merges two of them into the larger', async () => {
    actions.mergePlanLinesAction.mockResolvedValue({ ok: true, value: {} });
    mount(tab());
    click(byTest('plan-line-select', row('Information security basics') ?? document));
    expect(byTest('plan-bulk-merge')).toBeNull();
    click(byTest('plan-line-select', row('Cyber security awareness') ?? document));
    expect(byTest('plan-bulk-bar')?.textContent).toContain('2 lines selected');
    click(byTest('plan-bulk-merge'));
    const popup = byTest('plan-merge-dialog');
    expect(popup?.textContent).toContain('Merge 2 lines into one?');
    expect(byTest('plan-merge-preview', popup ?? document)?.textContent).toBe(
      '77 people · 3 departments · 2 sessions instead of 3',
    );
    expect(byTest('plan-merge-title', popup ?? document)).toHaveProperty(
      'value',
      'Cyber security awareness',
    );
    click(byTest('plan-merge-confirm'));
    await flush();
    const view = planFixture();
    expect(actions.mergePlanLinesAction).toHaveBeenCalledWith({
      lines: [
        { id: view.lines[2]?.id, version: 1 },
        { id: view.lines[1]?.id, version: 1 },
      ],
      intoLineId: view.lines[1]?.id,
      title: 'Cyber security awareness',
    });
    expect(router.refresh).toHaveBeenCalled();
    expect(byTest('plan-bulk-bar')).toBeNull();
  });

  it('works out sessions and cost in the line popup while L&D types, and saves only what changed', async () => {
    actions.updatePlanLineAction.mockResolvedValue({ ok: true, value: {} });
    mount(tab());
    click(byTest('plan-line-title', row('Excel – advanced formulas') ?? document));
    const popup = byTest('plan-line-dialog');
    expect(popup?.className).toContain('max-w-2xl');
    expect(byTest('plan-line-preview', popup ?? document)?.textContent).toContain(
      '3 sessions of 16, 16, 15 people',
    );
    expect(popup?.textContent).toContain('2 of 3 departments asked for Q1');
    // Required: people per session, cost per session, When.
    expect(popup?.querySelectorAll('[data-required-mark]')).toHaveLength(3);
    type(popup?.querySelector<HTMLInputElement>('#plan-line-max') ?? null, '25');
    expect(byTest('plan-line-preview', popup ?? document)?.textContent).toContain(
      '2 sessions of 24, 23 people',
    );
    click(byTest('plan-line-save', popup ?? document));
    await flush();
    expect(actions.updatePlanLineAction).toHaveBeenCalledWith({
      lineId: planFixture().lines[0]?.id,
      version: 1,
      maxPerSession: 25,
    });
  });

  it('refuses to save a line without a cost per session, and says why on the field', async () => {
    mount(tab());
    click(byTest('plan-line-title', row('First aid at work') ?? document));
    const popup = byTest('plan-line-dialog');
    expect(byTest('plan-line-preview', popup ?? document)?.textContent).toContain(
      'needs a cost per session',
    );
    click(byTest('plan-line-save', popup ?? document));
    await flush();
    expect(actions.updatePlanLineAction).not.toHaveBeenCalled();
    expect(popup?.querySelector('#plan-line-cost-error')?.textContent).toBe('Fill in this field.');
  });

  it('leaves a line out only with a reason', async () => {
    actions.leaveOutPlanLineAction.mockResolvedValue({ ok: true, value: {} });
    mount(tab());
    click(byTest('plan-line-title', row('Excel – advanced formulas') ?? document));
    click(byTest('plan-line-leave-out'));
    const popup = byTest('plan-leave-out-dialog');
    expect(popup?.textContent).toContain('Leave «Excel – advanced formulas» out of the plan?');
    click(byTest('plan-leave-out-confirm'));
    await flush();
    expect(actions.leaveOutPlanLineAction).not.toHaveBeenCalled();
    expect(popup?.textContent).toContain('Fill in this field.');
    type(popup?.querySelector('textarea') ?? null, '  Covered by the vendor.  ');
    click(byTest('plan-leave-out-confirm'));
    await flush();
    expect(actions.leaveOutPlanLineAction).toHaveBeenCalledWith({
      lineId: planFixture().lines[0]?.id,
      version: 1,
      reason: 'Covered by the vendor.',
    });
  });

  it('shows the budget by department in its colours and saves a reason', async () => {
    actions.setBudgetReasonAction.mockResolvedValue({ ok: true, value: {} });
    mount(tab());
    click(byTest('plan-view-budget'));
    expect(router.replace).toHaveBeenLastCalledWith(expect.stringContaining('view=budget'), {
      scroll: false,
    });
    const rows = allByTest('plan-budget-row');
    expect(rows).toHaveLength(4);
    const hr = rows.find((r) => r.textContent.includes('Human Resources'));
    const finance = rows.find((r) => r.textContent.includes('Finance'));
    expect(hr?.querySelector('[data-tone]')?.getAttribute('data-tone')).toBe('red');
    expect(finance?.querySelector('[data-tone]')?.getAttribute('data-tone')).toBe('amber');
    expect(hr?.textContent).toContain('Needed before you submit');
    expect(byTest('plan-budget-total')?.textContent).toContain('Organization total');
    type(hr?.querySelector<HTMLInputElement>('input') ?? null, 'Two new teams join in Q2.');
    click(byTest('plan-budget-reason-save', hr ?? document));
    await flush();
    expect(actions.setBudgetReasonAction).toHaveBeenCalledWith({
      planId: planFixture().plan?.id,
      departmentId: DEPT.hr,
      reason: 'Two new teams join in Q2.',
    });
  });

  it('adds the changes of departments that submitted again', async () => {
    actions.syncPlanNeedsAction.mockResolvedValue({ ok: true, value: {} });
    mount(tab());
    click(byTest('plan-add-pending'));
    await flush();
    expect(actions.syncPlanNeedsAction).toHaveBeenCalledWith({ planId: planFixture().plan?.id });
  });

  it('is read-only for a viewer who may not change the plan', () => {
    mount(tab(false));
    expect(allByTest('plan-line-select')).toHaveLength(0);
    expect(byTest('plan-add-pending')).toBeNull();
    click(byTest('plan-line-title', row('Excel – advanced formulas') ?? document));
    expect(byTest('plan-line-save')).toBeNull();
    expect(byTest('plan-line-leave-out')).toBeNull();
  });
});

describe('the Plan tab before the plan exists', () => {
  const notOpen = (closeEarly: boolean, canOpen = true) => (
    <PlanNotOpen
      locale="en"
      cycleId="40000000-0000-4000-8000-000000000001"
      readiness={{ ready: true, closeEarly }}
      deadline="30 Nov 2026"
      canOpen={canOpen}
      texts={texts}
      errors={{}}
    />
  );

  it('closes the needs early only after asking', async () => {
    actions.openConsolidationAction.mockResolvedValue({
      ok: true,
      value: { cycleId: 'c', planId: 'p', lines: 12, needs: 20, closedEarly: true },
    });
    mount(notOpen(true));
    expect(byTest('plan-not-open')?.textContent).toContain('Every department has submitted');
    click(byTest('plan-open'));
    expect(actions.openConsolidationAction).not.toHaveBeenCalled();
    click(byTest('plan-open-confirm'));
    await flush();
    expect(actions.openConsolidationAction).toHaveBeenCalledWith({
      cycleId: '40000000-0000-4000-8000-000000000001',
    });
    expect(router.refresh).toHaveBeenCalled();
  });

  it('says when the plan opens while departments are still entering, without a button', () => {
    mount(
      <PlanNotOpen
        locale="en"
        cycleId="40000000-0000-4000-8000-000000000001"
        readiness={{ ready: false, reason: 'waiting_for_departments', waiting: 2 }}
        deadline="30 Nov 2026"
        canOpen
        texts={texts}
        errors={{}}
      />,
    );
    expect(byTest('plan-not-open')?.textContent).toContain(
      "The needs close on 30 Nov 2026. 2 departments haven't submitted yet.",
    );
    expect(byTest('plan-open')).toBeNull();
  });

  it('builds the plan at once after the deadline; no button without the right to', async () => {
    actions.openConsolidationAction.mockResolvedValue({
      ok: false,
      error: { code: 'INTERNAL', status: 500, messageKey: 'errors.trainingPlanNotReady' },
    });
    mount(notOpen(false));
    click(byTest('plan-open'));
    await flush();
    expect(actions.openConsolidationAction).toHaveBeenCalled();
    act(() => root?.render(notOpen(false, false)));
    expect(byTest('plan-open')).toBeNull();
  });
});
