// @vitest-environment happy-dom
import ar from '@jadarat/platform-i18n/messages/ar.json';
import en from '@jadarat/platform-i18n/messages/en.json';
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flattenTexts } from '../../lib/flatten-texts';
import type { PickerUnit } from '../../lib/planning-view';
import { LaunchCycleButton, LaunchCycleDialog } from './cycle-action-buttons';
import { CycleDialog, type CycleDialogProps } from './cycle-dialog';
import {
  CycleDepartmentsForm,
  CycleInstructionsForm,
  CycleNeedsFormForm,
  CycleRemindersForm,
} from './cycle-settings-forms';
import { type CycleRow, CyclesScreen, type CyclesScreenProps } from './cycles-screen';

/**
 * The planning cycle screens of the Kawadir pattern (WP-UX-01 a, T-M3-20; FR-PLN-02), without a database:
 * the «New cycle» / «Edit» popup, the launch question, the cycles list and the sections of the cycle's
 * Settings — with the server actions mocked and the real English and Arabic messages. The journey against a
 * real stack is e2e/planning-journey.spec.ts.
 */
const actions = vi.hoisted(() => ({
  createPlanCycleAction: vi.fn(),
  updatePlanCycleBasicsAction: vi.fn(),
  savePlanCycleScopeAction: vi.fn(),
  savePlanCycleBudgetsAction: vi.fn(),
  savePlanCycleRemindersAction: vi.fn(),
  launchPlanCycleAction: vi.fn(),
  deletePlanCycleAction: vi.fn(),
  extendPlanCycleDeadlineAction: vi.fn(),
}));
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock('@jadarat/tms/actions/planning', () => actions);
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const MESSAGES = { en, ar } as const;
const textsOf = (locale: 'ar' | 'en'): Record<string, string> => {
  const messages = MESSAGES[locale];
  return {
    ...flattenTexts(messages.planning),
    discardChanges: messages.common.discardChanges,
    unsavedChanges: messages.common.unsavedChanges,
    leaveTitle: messages.common.leaveTitle,
    leaveText: messages.common.leaveText,
    leaveStay: messages.common.leaveStay,
    leaveGo: messages.common.leaveGo,
  };
};
const ERRORS = {
  'errors.validationFailed': en.errors.validationFailed,
  'errors.internalError': en.errors.internalError,
  'errors.planCycleNotReady': en.errors.planCycleNotReady,
};

const SALES = '66666666-6666-4666-8666-666666666661';
const EAST = '66666666-6666-4666-8666-666666666662';
const HR = '66666666-6666-4666-8666-666666666663';
const FORM = '99999999-9999-4999-8999-999999999991';
const CYCLE = '55555555-5555-4555-8555-555555555555';

const unit = (
  id: string,
  name: string,
  head: string | null,
  over: Partial<PickerUnit> = {},
): PickerUnit => ({
  id,
  parentId: null,
  branchId: null,
  name,
  depth: 0,
  active: true,
  head,
  ...over,
});
/** Human Resources (a head), Sales (no head) and East under Sales (no head up the tree). */
const UNITS: readonly PickerUnit[] = [
  unit(HR, 'Human Resources', 'Sara Ali'),
  unit(SALES, 'Sales', null),
  unit(EAST, 'East', null, { parentId: SALES, depth: 1 }),
];
const FORMS = [{ id: FORM, name: 'Default needs form', active: true, isDefault: true }];

let root: Root | undefined;
let host: HTMLDivElement;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  for (const mock of [...Object.values(actions), ...Object.values(router)]) mock.mockReset();
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
  delete document.body.dataset.unsaved;
});

function mount(ui: ReactNode) {
  root = createRoot(host);
  act(() => root?.render(ui));
}
/** Elements in the page (dialogs included) for a selector, by the kind the test expects. */
const link = (selector: string) => document.querySelector<HTMLAnchorElement>(selector);
const button = (selector: string) => document.querySelector<HTMLButtonElement>(selector);
const dialogEl = (selector: string) => document.querySelector<HTMLDialogElement>(selector);
const el = (selector: string) => document.querySelector<HTMLElement>(selector);
const input = (selector: string) => document.querySelector<HTMLInputElement>(selector);
const select = (selector: string) => document.querySelector<HTMLSelectElement>(selector);
const area = (selector: string) => document.querySelector<HTMLTextAreaElement>(selector);
const els = (selector: string) => document.querySelectorAll<HTMLElement>(selector);
const inputs = (selector: string) => document.querySelectorAll<HTMLInputElement>(selector);
/** The selector of a test id. */
const tid = (id: string) => `[data-testid="${id}"]`;

/** Types into a controlled field as the browser does (React reads the native value). */
function type(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  act(() => {
    // The prototype's own setter, with the element as its receiver.
    Reflect.set(proto, 'value', value, element);
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}
function click(element: Element | null | undefined) {
  if (!element) throw new Error('nothing to click');
  act(() => {
    (element as HTMLElement).click();
  });
}
/** Submits a form and lets its action (a transition) finish. */
async function submit(form: HTMLElement | null) {
  if (!form) throw new Error('no form');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
/** Text with plain spaces (amounts are formatted with a no-break space after the currency). */
const plain = (text: string | null | undefined) => (text ?? '').replace(/\u00a0/g, ' ');
const ok = (value: { readonly id: string; readonly version: number }) => ({
  ok: true as const,
  value,
});
const refused = (code: string, extra: Record<string, unknown> = {}) => ({
  ok: false as const,
  error: { code, status: 422, messageKey: 'errors.validationFailed', ...extra },
});

// ---------------------------------------------------------------------------------------------------
// The popup
// ---------------------------------------------------------------------------------------------------

function dialogProps(over: Partial<CycleDialogProps> = {}): CycleDialogProps {
  return {
    locale: 'en',
    open: true,
    onClose: vi.fn(),
    editing: null,
    initial: {
      nameAr: '',
      nameEn: '',
      periodStart: '2027-01-01',
      periodEnd: '2027-12-31',
      deadline: '2026-12-15',
      needsFormId: FORM,
      scope: { departmentIds: [HR, SALES], branchIds: [] },
    },
    units: UNITS,
    needsForms: FORMS,
    nameLanguage: 'en',
    display: 'gregorian',
    needsFormsLabel: 'Needs forms',
    texts: textsOf('en'),
    errors: ERRORS,
    onSaved: vi.fn(),
    ...over,
  };
}

describe('«New cycle»: one centred popup (forms standard rule 9)', () => {
  it('is a 672 px dialog with the few fields, defaults filled in, Cancel then Create at the end', () => {
    mount(<CycleDialog {...dialogProps()} />);
    const dialog = dialogEl(tid('cycle-dialog'))!;
    expect(dialog.open).toBe(true);
    // Tailwind's max-w-2xl is 672 px.
    expect(dialog.className).toContain('max-w-2xl');
    expect(dialog.querySelector('h2')?.textContent).toBe('New planning cycle');
    // The default language's name first and required: a red asterisk, never the word on screen.
    const names = [...dialog.querySelectorAll<HTMLInputElement>('#cycle-name-en, #cycle-name-ar')];
    expect(names.map((input) => [input.id, input.required])).toEqual([
      ['cycle-name-en', true],
      ['cycle-name-ar', false],
    ]);
    const requiredLabel = dialog.querySelector('label[for="cycle-name-en"]')!;
    expect(requiredLabel.querySelector('[data-required-mark]')?.textContent).toBe('*');
    expect(requiredLabel.querySelector('[data-required-mark]')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(requiredLabel.querySelector('.sr-only')?.textContent).toContain('(required)');
    expect(dialog.querySelector('label[for="cycle-name-ar"] [data-required-mark]')).toBeNull();
    for (const id of ['cycle-period-start', 'cycle-period-end', 'cycle-deadline']) {
      const field = dialog.querySelector<HTMLInputElement>(`#${id}`)!;
      expect([id, field.required, field.value !== '']).toEqual([id, true, true]);
      expect(dialog.querySelector(`label[for="${id}"] [data-required-mark]`)).not.toBeNull();
    }
    // Every department is in the cycle by default, each with its head or «No head yet».
    const all = input(tid('scope-all'))!;
    expect(all.checked).toBe(true);
    expect(all.closest('label')?.textContent).toBe('All departments (3)');
    const rows = [...inputs(tid('scope-unit'))];
    expect(
      rows.map((box) => [box.closest('label')?.textContent, box.checked, box.disabled]),
    ).toEqual([
      ['Human ResourcesHead: Sara Ali', true, false],
      ['SalesNo head yet', true, false],
      // Comes with Sales: ticked, and not to be taken out on its own.
      ['EastNo head yet', true, true],
    ]);
    expect(el(tid('scope-forms-count'))?.textContent).toBe('Needs forms to send: 3');
    expect(select(tid('cycle-needs-form'))?.value).toBe(FORM);
    expect(el(tid('cycle-dialog-note'))?.textContent).toContain('the HR Manager approves');
    // «Cancel», then the primary button, last in the form.
    const buttons = [...el(tid('cycle-form'))!.querySelectorAll('button')].slice(-2);
    expect(buttons.map((button) => [button.textContent, button.type])).toEqual([
      ['Cancel', 'button'],
      ['Create cycle', 'submit'],
    ]);
  });

  it('checks the fields before anything is sent', async () => {
    mount(<CycleDialog {...dialogProps()} />);
    await submit(el(tid('cycle-form')));
    expect(el('#cycle-name-en-error')?.textContent).toBe('Fill in this field.');
    expect(el('#cycle-name-ar-error')).toBeNull();
    type(input('#cycle-name-en')!, 'Training plan 2027');
    type(input('#cycle-period-end')!, '2027-01-01');
    await submit(el(tid('cycle-form')));
    expect(el('#cycle-period-end-error')?.textContent).toBe('The period must end after it starts.');
    expect(el('#cycle-name-en-error')).toBeNull();
    expect(actions.createPlanCycleAction).not.toHaveBeenCalled();
  });

  it('creates the cycle with its departments and the needs form in one go', async () => {
    actions.createPlanCycleAction.mockResolvedValue(ok({ id: CYCLE, version: 1 }));
    const props = dialogProps();
    mount(<CycleDialog {...props} />);
    type(input('#cycle-name-en')!, 'Training plan 2027');
    await submit(el(tid('cycle-form')));
    expect(actions.createPlanCycleAction).toHaveBeenCalledExactlyOnceWith({
      nameAr: '',
      nameEn: 'Training plan 2027',
      periodStart: '2027-01-01',
      periodEnd: '2027-12-31',
      deadline: '2026-12-15',
      needsFormId: FORM,
      departmentIds: [HR, SALES],
      branchIds: [],
    });
    expect(props.onSaved).toHaveBeenCalledExactlyOnceWith({
      created: true,
      name: 'Training plan 2027',
    });
    expect(actions.savePlanCycleScopeAction).not.toHaveBeenCalled();
  });

  it('takes a department out: the count follows, «All departments» is in between', async () => {
    actions.createPlanCycleAction.mockResolvedValue(ok({ id: CYCLE, version: 1 }));
    mount(<CycleDialog {...dialogProps()} />);
    type(input('#cycle-name-en')!, 'Plan');
    // Without Sales, East is no longer included either.
    click([...els(tid('scope-unit'))][1]);
    expect([...inputs(tid('scope-unit'))].map((b) => [b.checked, b.disabled])).toEqual([
      [true, false],
      [false, false],
      [false, false],
    ]);
    expect(el(tid('scope-forms-count'))?.textContent).toBe('Needs forms to send: 1');
    const all = input(tid('scope-all'))!;
    expect([all.checked, all.indeterminate]).toEqual([false, true]);
    await submit(el(tid('cycle-form')));
    expect(actions.createPlanCycleAction.mock.calls[0]?.[0]).toMatchObject({
      departmentIds: [HR],
      branchIds: [],
    });
    // «All departments» again: the top-level departments (each includes what is under it).
    click(all);
    expect([...inputs(tid('scope-unit'))].every((box) => box.checked)).toBe(true);
    click(el(tid('scope-all')));
    expect(el(tid('scope-forms-count'))?.textContent).toBe('Needs forms to send: 0');
  });

  it('shows what the server refused on its field and keeps what was typed', async () => {
    actions.createPlanCycleAction.mockResolvedValue(
      refused('VALIDATION_FAILED', {
        fieldErrors: [
          { path: 'departmentIds.1', code: 'UNKNOWN' },
          { path: 'deadline', code: 'AFTER_PERIOD' },
        ],
      }),
    );
    const props = dialogProps();
    mount(<CycleDialog {...props} />);
    type(input('#cycle-name-en')!, 'Plan');
    await submit(el(tid('cycle-form')));
    expect(el(tid('cycle-form-error'))).not.toBeNull();
    expect(el('#cycle-deadline-error')?.textContent).toBe(
      'The deadline must be within the planning period.',
    );
    expect(el(tid('scope-picker'))?.textContent).toContain(
      'This item no longer exists. Reload the page.',
    );
    expect(input('#cycle-name-en')?.value).toBe('Plan');
    expect(props.onSaved).not.toHaveBeenCalled();
  });

  it('Arabic as the default language: the Arabic name first and required, in Arabic', () => {
    mount(
      <CycleDialog {...dialogProps({ locale: 'ar', nameLanguage: 'ar', texts: textsOf('ar') })} />,
    );
    const dialog = el(tid('cycle-dialog'))!;
    expect(dialog.querySelector('h2')?.textContent).toBe('حملة حصر احتياجات جديدة');
    const names = [...dialog.querySelectorAll<HTMLInputElement>('#cycle-name-en, #cycle-name-ar')];
    expect(names.map((input) => [input.id, input.required, input.dir])).toEqual([
      ['cycle-name-ar', true, 'rtl'],
      ['cycle-name-en', false, 'ltr'],
    ]);
    expect(dialog.querySelector('label[for="cycle-name-ar"]')?.textContent).toContain(
      'اسم الحملة (بالعربية)',
    );
    expect(el(tid('scope-all'))?.closest('label')?.textContent).toBe('كل الإدارات (3)');
    expect(dialog.textContent).toContain('بلا رئيس بعد');
    expect(dialog.textContent).toContain('إنشاء الحملة');
    // Never the word «(required)» on screen: it is for screen readers only.
    const visible = dialog.cloneNode(true) as HTMLElement;
    for (const hidden of visible.querySelectorAll('.sr-only')) hidden.remove();
    expect(visible.textContent).not.toContain('(مطلوب)');
  });

  it('an organization that shows Hijri dates reads the days as they will be shown', () => {
    mount(<CycleDialog {...dialogProps({ display: 'dual' })} />);
    expect(el(tid('cycle-period-shown'))?.textContent).toContain(' · ');
    expect(el(tid('cycle-deadline-shown'))).not.toBeNull();
  });
});

describe('«Edit»: the same popup, pre-filled', () => {
  const editing = {
    id: CYCLE,
    version: 3,
    name: 'Training plan 2027',
    instructionsAr: '',
    instructionsEn: 'Tell us what your team needs.',
  };
  const initial = {
    nameAr: '',
    nameEn: 'Training plan 2027',
    periodStart: '2027-01-01',
    periodEnd: '2027-12-31',
    deadline: '2026-12-15',
    needsFormId: FORM,
    scope: { departmentIds: [HR], branchIds: [] },
  };

  it('saves the names and dates, then the departments with the version the first save returned', async () => {
    actions.updatePlanCycleBasicsAction.mockResolvedValue(ok({ id: CYCLE, version: 4 }));
    actions.savePlanCycleScopeAction.mockResolvedValue(ok({ id: CYCLE, version: 5 }));
    const props = dialogProps({ editing, initial });
    mount(<CycleDialog {...props} />);
    expect(el(tid('cycle-dialog'))?.querySelector('h2')?.textContent).toBe(
      'Edit Training plan 2027',
    );
    expect(input('#cycle-name-en')?.value).toBe('Training plan 2027');
    type(input('#cycle-name-ar')!, 'خطة التدريب 2027');
    click([...els(tid('scope-unit'))][1]);
    await submit(el(tid('cycle-form')));
    // The instructions are edited on the Settings page: they go back as they are.
    expect(actions.updatePlanCycleBasicsAction).toHaveBeenCalledExactlyOnceWith({
      nameAr: 'خطة التدريب 2027',
      nameEn: 'Training plan 2027',
      periodStart: '2027-01-01',
      periodEnd: '2027-12-31',
      deadline: '2026-12-15',
      needsFormId: FORM,
      instructionsAr: '',
      instructionsEn: 'Tell us what your team needs.',
      id: CYCLE,
      version: 3,
    });
    expect(actions.savePlanCycleScopeAction).toHaveBeenCalledExactlyOnceWith({
      id: CYCLE,
      version: 4,
      departmentIds: [HR, SALES],
      branchIds: [],
    });
    expect(props.onSaved).toHaveBeenCalledExactlyOnceWith({
      created: false,
      name: 'Training plan 2027',
    });
    expect(actions.createPlanCycleAction).not.toHaveBeenCalled();
  });

  it('sends only what changed', async () => {
    actions.savePlanCycleScopeAction.mockResolvedValue(ok({ id: CYCLE, version: 4 }));
    mount(<CycleDialog {...dialogProps({ editing, initial })} />);
    click([...els(tid('scope-unit'))][1]);
    await submit(el(tid('cycle-form')));
    expect(actions.updatePlanCycleBasicsAction).not.toHaveBeenCalled();
    expect(actions.savePlanCycleScopeAction).toHaveBeenCalledExactlyOnceWith({
      id: CYCLE,
      version: 3,
      departmentIds: [HR, SALES],
      branchIds: [],
    });
  });

  it('a refused second part: the first is in, and the next try continues from it', async () => {
    actions.updatePlanCycleBasicsAction.mockResolvedValue(ok({ id: CYCLE, version: 4 }));
    actions.savePlanCycleScopeAction
      .mockResolvedValueOnce(
        refused('VALIDATION_FAILED', {
          fieldErrors: [{ path: 'departmentIds.1', code: 'UNKNOWN' }],
        }),
      )
      .mockResolvedValueOnce(ok({ id: CYCLE, version: 5 }));
    const props = dialogProps({ editing, initial });
    mount(<CycleDialog {...props} />);
    type(input('#cycle-name-en')!, 'Plan 2027');
    click([...els(tid('scope-unit'))][1]);
    await submit(el(tid('cycle-form')));
    expect(el(tid('cycle-form-error'))).not.toBeNull();
    expect(props.onSaved).not.toHaveBeenCalled();
    await submit(el(tid('cycle-form')));
    // The names are not sent again; the departments go with the version the names' save returned.
    expect(actions.updatePlanCycleBasicsAction).toHaveBeenCalledTimes(1);
    expect(actions.savePlanCycleScopeAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: CYCLE, version: 4 }),
    );
    expect(props.onSaved).toHaveBeenCalledTimes(1);
  });

  it('an older copy is refused: what was typed stays and the latest version is offered', async () => {
    actions.updatePlanCycleBasicsAction.mockResolvedValue(refused('CONFLICT_VERSION'));
    mount(<CycleDialog {...dialogProps({ editing, initial })} />);
    type(input('#cycle-name-en')!, 'Mine');
    await submit(el(tid('cycle-form')));
    expect(el(tid('cycle-form-error'))?.textContent).toContain('Someone else changed this cycle');
    expect(input('#cycle-name-en')?.value).toBe('Mine');
  });
});

// ---------------------------------------------------------------------------------------------------
// The launch question
// ---------------------------------------------------------------------------------------------------

const LAUNCH = {
  locale: 'en' as const,
  cycle: { id: CYCLE, version: 3 },
  name: 'Training plan 2027',
  deadline: 'Dec 15, 2026',
  departments: [
    { id: HR, name: 'Human Resources', head: 'Sara Ali' },
    { id: 'fin', name: 'Finance', head: 'Omar Nasser' },
    { id: SALES, name: 'Sales', head: null },
  ],
  problems: [],
  editHref: '/en/suite/planning/cycles?edit=c',
  settingsHref: '/en/suite/planning/cycles/c/settings?tab=form',
  structureHref: '/en/suite/admin/structure',
  launchedHref: '/en/suite/planning/cycles/c?launched=1',
  texts: textsOf('en'),
  errors: ERRORS,
};

describe('«Launch {name}?»: a small confirmation from the row menu', () => {
  it('says how many departments get the form and until when, with their heads', () => {
    mount(<LaunchCycleDialog {...LAUNCH} open onClose={vi.fn()} />);
    const dialog = dialogEl(tid('cycle-launch-dialog'))!;
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('h2')?.textContent).toBe('Launch Training plan 2027?');
    expect(dialog.querySelector('p')?.textContent).toBe(
      '3 departments get the needs form. Their heads fill it in until Dec 15, 2026. After launch you can only extend the deadline.',
    );
    expect([...els(tid('cycle-launch-department'))].map((row) => row.textContent)).toEqual([
      'Human ResourcesSara Ali',
      'FinanceOmar Nasser',
      'SalesNo head yet',
    ]);
    // A long list scrolls: it can take the keyboard focus, and it is named.
    const list = el(tid('cycle-launch-departments'))!;
    expect([list.tabIndex, list.getAttribute('aria-label')]).toEqual([
      0,
      'Departments and their heads',
    ]);
    // One warning per department without a head, with the way to pick one.
    const warnings = [...els(tid('cycle-launch-no-head'))];
    expect(warnings.map((warning) => warning.querySelector('p')?.textContent)).toEqual([
      'Sales has no head, so nobody can fill in its form. You can launch now and pick the head later.',
    ]);
    const pick = link(tid('cycle-launch-pick-head'))!;
    expect([pick.textContent, pick.getAttribute('href')]).toEqual([
      'Pick a head for Sales',
      '/en/suite/admin/structure',
    ]);
    const buttons = [...dialog.querySelectorAll('button')].slice(-2);
    expect(buttons.map((button) => button.textContent)).toEqual(['Cancel', 'Launch']);
    expect(button(tid('cycle-launch-confirm'))?.disabled).toBe(false);
  });

  it('a member who does not pick heads is told who does; many headless departments are counted', () => {
    mount(<LaunchCycleDialog {...LAUNCH} structureHref={null} open onClose={vi.fn()} />);
    expect(el(tid('cycle-launch-pick-head'))).toBeNull();
    expect(el(tid('cycle-launch-ask-hr'))?.textContent).toBe(
      'The HR Manager picks heads under Organization → Departments.',
    );
    act(() => root?.unmount());
    host = document.createElement('div');
    document.body.append(host);
    mount(
      <LaunchCycleDialog
        {...LAUNCH}
        departments={['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase(), head: null }))}
        open
        onClose={vi.fn()}
      />,
    );
    const warnings = [...els(tid('cycle-launch-no-head'))];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.textContent).toContain('4 departments have no head');
  });

  it('launches with the cycle’s version and goes to its progress', async () => {
    actions.launchPlanCycleAction.mockResolvedValue(ok({ id: CYCLE, version: 4 }));
    const onClose = vi.fn();
    mount(<LaunchCycleDialog {...LAUNCH} open onClose={onClose} />);
    await act(async () => {
      el(tid('cycle-launch-confirm'))?.click();
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(actions.launchPlanCycleAction).toHaveBeenCalledExactlyOnceWith({
      id: CYCLE,
      version: 3,
    });
    expect(onClose).toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledExactlyOnceWith(LAUNCH.launchedHref);
  });

  it('lists what stops the launch, each with where to fix it, and keeps «Launch» off', () => {
    mount(
      <LaunchCycleDialog
        {...LAUNCH}
        departments={[]}
        problems={['deadline_past', 'no_needs_form', 'no_departments', 'another_open']}
        open
        onClose={vi.fn()}
      />,
    );
    expect(button(tid('cycle-launch-confirm'))?.disabled).toBe(true);
    const problems = el(tid('cycle-problems'))!;
    expect([...problems.querySelectorAll('li')].map((item) => item.dataset.testid)).toEqual([
      'cycle-problem-deadline_past',
      'cycle-problem-no_needs_form',
      'cycle-problem-no_departments',
      'cycle-problem-another_open',
    ]);
    expect(
      ['deadline_past', 'no_needs_form', 'no_departments', 'another_open'].map(
        (problem) => link(tid(`cycle-problem-fix-${problem}`))?.getAttribute('href') ?? null,
      ),
    ).toEqual([LAUNCH.editHref, LAUNCH.settingsHref, LAUNCH.editHref, null]);
    // No approval chain is asked for any more (EP-PLN §13 e).
    expect(problems.textContent).not.toMatch(/approv/i);
    // Nothing is sent to departments that are not there: no count line.
    expect(el(tid('cycle-launch-dialog'))?.hasAttribute('aria-describedby')).toBe(false);
  });

  it('the server has the last word: its reasons are said and the page loads the latest', async () => {
    actions.launchPlanCycleAction.mockResolvedValue(
      refused('PLAN_CYCLE_NOT_READY', {
        messageKey: 'errors.planCycleNotReady',
        params: { reasons: 'no_departments,approver_missing' },
      }),
    );
    mount(<LaunchCycleDialog {...LAUNCH} open onClose={vi.fn()} />);
    await act(async () => {
      el(tid('cycle-launch-confirm'))?.click();
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const error = el(tid('cycle-launch-error'))!;
    expect(error.textContent).toContain('No department is in this cycle.');
    // A reason this version does not know (an older database during a deploy) gets the general words.
    expect(error.textContent).toContain('This cycle isn’t ready to launch yet.');
    expect(router.refresh).toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('«Launch cycle» on the Settings page waits for unsaved entries', () => {
    mount(<LaunchCycleButton {...LAUNCH} />);
    document.body.dataset.unsaved = 'true';
    click(el(tid('cycle-launch')));
    expect(dialogEl(tid('cycle-launch-dialog'))?.open).toBe(false);
    delete document.body.dataset.unsaved;
    click(el(tid('cycle-launch')));
    expect(dialogEl(tid('cycle-launch-dialog'))?.open).toBe(true);
  });

  it('in Arabic', () => {
    mount(
      <LaunchCycleDialog
        {...LAUNCH}
        locale="ar"
        texts={textsOf('ar')}
        name="خطة التدريب 2027"
        deadline="15 ديسمبر 2026"
        departments={[
          { id: HR, name: 'الموارد البشرية', head: 'سارة علي' },
          { id: SALES, name: 'المبيعات', head: null },
        ]}
        open
        onClose={vi.fn()}
      />,
    );
    const dialog = el(tid('cycle-launch-dialog'))!;
    expect(dialog.querySelector('h2')?.textContent).toBe('إطلاق خطة التدريب 2027؟');
    expect(dialog.querySelector('p')?.textContent).toBe(
      'يصل نموذج الاحتياجات إلى إدارتين، ويعبّئه رؤساؤها حتى 15 ديسمبر 2026. بعد الإطلاق لا يمكن إلا تمديد الموعد النهائي.',
    );
    expect(el(tid('cycle-launch-no-head'))?.querySelector('p')?.textContent).toBe(
      'المبيعات بلا رئيس، فلن يعبّئ نموذجها أحد. يمكنك الإطلاق الآن واختيار الرئيس لاحقًا.',
    );
  });
});

// ---------------------------------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------------------------------

const row = (over: Partial<CycleRow> = {}): CycleRow => ({
  id: CYCLE,
  name: 'Training plan 2027',
  nameAr: null,
  nameEn: 'Training plan 2027',
  periodStart: '2027-01-01',
  periodEnd: '2027-12-31',
  deadline: '2026-12-15',
  status: 'draft',
  departmentCount: 3,
  submittedCount: 0,
  draft: {
    version: 3,
    needsFormId: FORM,
    needsFormOff: null,
    instructionsAr: null,
    instructionsEn: null,
    scope: { departmentIds: [HR, SALES], branchIds: [] },
    problems: [],
  },
  ...over,
});
const OPEN_ROW = row({
  id: 'open',
  name: 'Training plan 2026',
  status: 'open',
  submittedCount: 2,
  deadline: '2026-11-20',
  draft: null,
});

function screenProps(over: Partial<CyclesScreenProps> = {}): CyclesScreenProps {
  return {
    locale: 'en',
    header: {
      title: 'Planning cycles',
      description: 'Ask every department what training its team needs, then build one plan.',
      breadcrumbsLabel: 'Breadcrumb',
      breadcrumbs: [{ label: 'Planning' }, { label: 'Planning cycles' }],
    },
    today: '2026-11-12',
    cycles: [row(), OPEN_ROW],
    filter: 'all',
    counts: { all: 2, draft: 1, open: 1, closed: 0 },
    canManage: true,
    setup: {
      defaults: { periodStart: '2027-01-01', periodEnd: '2027-12-31', deadline: '2026-12-12' },
      nameLanguage: 'en',
      units: UNITS,
      needsForms: FORMS,
    },
    open: null,
    canPickHeads: true,
    display: 'gregorian',
    needsFormsLabel: 'Needs forms',
    texts: textsOf('en'),
    errors: ERRORS,
    ...over,
  };
}

describe('the cycles list', () => {
  it('has the primary action in the header, summary cards that filter, and the cycles in a table', () => {
    mount(<CyclesScreen {...screenProps()} />);
    expect(el('h1')?.textContent).toBe('Planning cycles');
    expect(el(tid('new-cycle'))?.textContent).toBe('New cycle');
    // The cards are links (each its own address); the current one is marked.
    const cards = ['all', 'draft', 'open', 'closed'].map((key) => link(tid(`cycles-stat-${key}`))!);
    expect(cards.map((card) => [card.textContent, card.getAttribute('href')])).toEqual([
      ['All cycles 2', '/en/suite/planning/cycles'],
      ['Draft 1', '/en/suite/planning/cycles?status=draft'],
      ['Open 1', '/en/suite/planning/cycles?status=open'],
      ['Closed 0', '/en/suite/planning/cycles?status=closed'],
    ]);
    expect(cards.map((card) => card.getAttribute('aria-current'))).toEqual([
      'page',
      null,
      null,
      null,
    ]);
    expect(el(tid('cycles-stats'))?.getAttribute('aria-label')).toBe('Show cycles by status');
    const table = el(tid('cycles-table'))!;
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual([
      'Cycle',
      'Plan period',
      'Needs deadline',
      'Status',
      'Departments',
      'Actions',
    ]);
    const [draft, open] = [...els(tid('cycle-row'))];
    // A draft: its departments, and the row menu named after the cycle.
    expect(draft?.querySelector('[data-testid="cycle-departments"]')?.textContent).toBe(
      '3 departments',
    );
    expect(draft?.querySelector('[data-testid="cycle-status"]')?.textContent).toBe('Draft');
    expect(draft?.querySelector('[data-testid="cycle-menu"]')?.getAttribute('aria-label')).toBe(
      'Actions for Training plan 2027',
    );
    expect(draft?.querySelector('[data-testid="cycle-name"]')?.getAttribute('href')).toBe(
      `/en/suite/planning/cycles/${CYCLE}/settings`,
    );
    // The open cycle folded into its row: status, «n of m submitted», days left, the way to progress.
    expect(open?.querySelector('[data-testid="cycle-status"]')?.textContent).toBe('Open');
    expect(open?.querySelector('[data-testid="cycle-departments"]')?.textContent).toBe(
      '2 of 3 submitted',
    );
    expect(open?.querySelector('progress')?.getAttribute('aria-label')).toBe('2 of 3 submitted');
    expect(open?.querySelector('[data-testid="cycle-days-left"]')?.textContent).toBe('8 days left');
    const progress = open?.querySelector<HTMLAnchorElement>('[data-testid="cycle-open-link"]');
    expect([
      progress?.textContent,
      progress?.getAttribute('aria-label'),
      progress?.getAttribute('href'),
    ]).toEqual([
      'View progress',
      'View progress of Training plan 2026',
      '/en/suite/planning/cycles/open',
    ]);
    // The visible words are part of the link's accessible name (WCAG 2.5.3).
    expect(progress?.getAttribute('aria-label')).toContain(progress?.textContent ?? '?');
    expect(open?.querySelector('[data-testid="cycle-menu"]')).toBeNull();
  });

  it('filters by the card of the address; an empty filter offers all cycles', () => {
    mount(<CyclesScreen {...screenProps({ filter: 'open' })} />);
    expect([...els(tid('cycle-row'))].map((r) => r.dataset.status)).toEqual(['open']);
    expect(el(tid('cycles-stat-open'))?.getAttribute('aria-current')).toBe('page');
    act(() => root?.unmount());
    host = document.createElement('div');
    document.body.append(host);
    mount(<CyclesScreen {...screenProps({ filter: 'closed' })} />);
    expect(el(tid('cycles-table'))).toBeNull();
    const empty = el(tid('cycles-empty-filter'))!;
    expect(empty.textContent).toContain('No cycles with this status');
    expect(empty.querySelector('a')?.getAttribute('href')).toBe('/en/suite/planning/cycles');
  });

  it('without cycles: an empty state that offers the first one, which opens the popup', () => {
    mount(
      <CyclesScreen
        {...screenProps({ cycles: [], counts: { all: 0, draft: 0, open: 0, closed: 0 } })}
      />,
    );
    expect(el(tid('cycles-empty'))?.textContent).toContain('No planning cycles yet');
    expect(dialogEl(tid('cycle-dialog'))?.open).toBe(false);
    click(el(tid('new-cycle-empty')));
    const dialog = dialogEl(tid('cycle-dialog'))!;
    expect(dialog.open).toBe(true);
    // Sensible defaults: the suggested period and deadline, every department, the default form.
    expect(input('#cycle-period-start')?.value).toBe('2027-01-01');
    expect(input('#cycle-deadline')?.value).toBe('2026-12-12');
    expect(input(tid('scope-all'))?.checked).toBe(true);
    expect(select(tid('cycle-needs-form'))?.value).toBe(FORM);
  });

  it('a reader sees the list without actions', () => {
    mount(
      <CyclesScreen
        {...screenProps({
          canManage: false,
          setup: null,
          cycles: [row({ draft: null }), OPEN_ROW],
        })}
      />,
    );
    expect(el(tid('new-cycle'))).toBeNull();
    expect(el(tid('cycle-menu'))).toBeNull();
    expect(el(tid('cycle-dialog'))).toBeNull();
    // The draft still opens (its page shows what it will cover).
    expect(el(tid('cycle-name'))?.getAttribute('href')).toBe(`/en/suite/planning/cycles/${CYCLE}`);
    expect([...els(tid('cycle-open-link'))]).toHaveLength(2);
  });

  it('opens the popup the address asks for — only for a draft the member may change', () => {
    mount(<CyclesScreen {...screenProps({ open: { kind: 'edit', id: CYCLE } })} />);
    expect(el(tid('cycle-dialog'))?.querySelector('h2')?.textContent).toBe(
      'Edit Training plan 2027',
    );
    expect(input('#cycle-name-en')?.value).toBe('Training plan 2027');
    act(() => root?.unmount());
    host = document.createElement('div');
    document.body.append(host);
    mount(<CyclesScreen {...screenProps({ open: { kind: 'launch', id: CYCLE } })} />);
    // The departments the cycle covers now, with their heads: East comes with Sales.
    expect([...els(tid('cycle-launch-department'))].map((r) => r.textContent)).toEqual([
      'Human ResourcesSara Ali',
      'SalesNo head yet',
      'EastNo head yet',
    ]);
    expect([...els(tid('cycle-launch-no-head'))]).toHaveLength(2);
    act(() => root?.unmount());
    host = document.createElement('div');
    document.body.append(host);
    // A launched cycle cannot be edited or launched again, whatever the address says.
    mount(<CyclesScreen {...screenProps({ open: { kind: 'launch', id: 'open' } })} />);
    expect(el(tid('cycle-launch-dialog'))).toBeNull();
    expect(dialogEl(tid('cycle-dialog'))?.open).toBe(false);
  });

  it('after creating: the list says so and loads the new draft', async () => {
    actions.createPlanCycleAction.mockResolvedValue(ok({ id: CYCLE, version: 1 }));
    mount(<CyclesScreen {...screenProps({ open: { kind: 'new' }, filter: 'open' })} />);
    type(input('#cycle-name-en')!, 'Training plan 2028');
    await submit(el(tid('cycle-form')));
    expect(dialogEl(tid('cycle-dialog'))?.open).toBe(false);
    // The new draft would be hidden by the «Open» filter: back to all cycles.
    expect(router.push).toHaveBeenCalledExactlyOnceWith('/en/suite/planning/cycles');
    expect(router.refresh).toHaveBeenCalled();
  });

  it('in Arabic', () => {
    mount(
      <CyclesScreen
        {...screenProps({
          locale: 'ar',
          texts: textsOf('ar'),
          header: { title: 'حملات حصر الاحتياجات' },
        })}
      />,
    );
    expect(el(tid('new-cycle'))?.textContent).toBe('حملة جديدة');
    expect(el(tid('cycles-stat-all'))?.textContent).toBe('كل الحملات 2');
    expect(
      [...el(tid('cycles-table'))!.querySelectorAll('thead th')].map((th) => th.textContent),
    ).toEqual([
      'الحملة',
      'فترة الخطة',
      'الموعد النهائي للاحتياجات',
      'الحالة',
      'الإدارات',
      'الإجراءات',
    ]);
    expect(el(tid('cycle-menu'))?.getAttribute('aria-label')).toBe('إجراءات Training plan 2027');
    expect(el(tid('cycle-days-left'))?.textContent).toBe('بقيت 8 أيام');
  });
});

// ---------------------------------------------------------------------------------------------------
// The cycle's Settings
// ---------------------------------------------------------------------------------------------------

const SETTINGS = {
  locale: 'en' as const,
  cycle: { id: CYCLE, version: 3 },
  texts: textsOf('en'),
  errors: ERRORS,
};
const BASICS = {
  nameAr: '',
  nameEn: 'Training plan 2027',
  periodStart: '2027-01-01',
  periodEnd: '2027-12-31',
  deadline: '2026-12-15',
  instructionsAr: '',
  instructionsEn: 'Old words',
  needsFormId: FORM,
};
const BUDGET_ROWS = [
  { departmentId: HR, name: 'Human Resources', head: 'Sara Ali', amount: '150000' },
  { departmentId: SALES, name: 'Sales', head: null, amount: null },
];
const departments = (over: Record<string, unknown> = {}) => (
  <CycleDepartmentsForm
    {...SETTINGS}
    currency="EGP"
    unitColumn="Department"
    rows={BUDGET_ROWS}
    units={UNITS}
    branches={[{ id: 'cairo', name: 'Cairo', active: true }]}
    scope={{ departmentIds: [HR, SALES], branchIds: [] }}
    canPickHeads
    {...over}
  />
);

describe('cycle Settings: one save bar for the open section', () => {
  it('Departments & budgets: budgets per department, the total, and a head to pick', () => {
    mount(departments());
    expect([...els(tid('budget-row'))].map((r) => r.querySelector('th')?.textContent)).toEqual([
      'Human Resources',
      'Sales',
    ]);
    const amounts = [...inputs(tid('budget-amount'))];
    expect(amounts.map((input) => [input.value, input.placeholder])).toEqual([
      ['150000', 'No budget'],
      ['', 'No budget'],
    ]);
    expect(el('label[for="budget-' + SALES + '"]')?.textContent).toBe('Budget for Sales');
    expect(plain(el(tid('budget-total'))?.textContent)).toBe(
      'Total of the budgets: EGP 150,000.00',
    );
    const pick = link(tid('budget-pick-head'))!;
    expect([pick.textContent, pick.getAttribute('aria-label'), pick.getAttribute('href')]).toEqual([
      'Pick a head',
      'Pick a head for Sales',
      '/en/suite/admin/structure',
    ]);
    // Nothing changed: no save bar.
    expect(el(tid('save-bar'))).toBeNull();
    expect(button(tid('cycle-departments-edit'))?.disabled).toBe(false);
  });

  it('saves with the version the fields were read at, then with the one the save returned', async () => {
    actions.savePlanCycleBudgetsAction
      .mockResolvedValueOnce(ok({ id: CYCLE, version: 4 }))
      .mockResolvedValueOnce(ok({ id: CYCLE, version: 5 }));
    mount(departments());
    type([...inputs(tid('budget-amount'))][1]!, '300,000');
    expect(plain(el(tid('budget-total'))?.textContent)).toBe(
      'Total of the budgets: EGP 450,000.00',
    );
    expect(el(tid('save-bar'))?.dataset.state).toBe('unsaved');
    expect(document.body.dataset.unsaved).toBe('true');
    // Saving the departments would make a new version under the typed budgets: budgets first.
    expect(button(tid('cycle-departments-edit'))?.disabled).toBe(true);
    await submit(el(tid('cycle-budgets')));
    expect(actions.savePlanCycleBudgetsAction).toHaveBeenLastCalledWith({
      id: CYCLE,
      version: 3,
      budgets: [
        { departmentId: HR, amount: '150000' },
        { departmentId: SALES, amount: '300,000' },
      ],
    });
    // Saved: the bar goes, the page loads the latest copy.
    expect(el(tid('save-bar'))).toBeNull();
    expect(document.body.dataset.unsaved).toBeUndefined();
    expect(router.refresh).toHaveBeenCalledTimes(1);
    // Before that copy arrives, a second change is sent with the version the save returned.
    type([...inputs(tid('budget-amount'))][0]!, '');
    await submit(el(tid('cycle-budgets')));
    expect(actions.savePlanCycleBudgetsAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ version: 4 }),
    );
  });

  it('takes the latest copy when nothing was typed, and keeps typed entries otherwise', () => {
    mount(departments());
    const latest = [
      { ...BUDGET_ROWS[0]!, amount: '200000' },
      { ...BUDGET_ROWS[1]!, amount: '50' },
    ];
    act(() => root?.render(departments({ cycle: { id: CYCLE, version: 4 }, rows: latest })));
    expect([...inputs(tid('budget-amount'))].map((i) => i.value)).toEqual(['200000', '50']);
    type([...inputs(tid('budget-amount'))][1]!, '75');
    act(() =>
      root?.render(
        departments({
          cycle: { id: CYCLE, version: 5 },
          rows: latest.map((r) => ({ ...r, amount: '1' })),
        }),
      ),
    );
    expect([...inputs(tid('budget-amount'))][1]?.value).toBe('75');
  });

  it('refuses an amount that is not a number before anything is sent; Discard brings the saved one back', async () => {
    mount(departments());
    type([...inputs(tid('budget-amount'))][1]!, 'lots');
    await submit(el(tid('cycle-budgets')));
    expect(el(`#budget-${SALES}-error`)?.textContent).toBe(
      'Enter an amount in numbers, with up to 3 decimals.',
    );
    expect(actions.savePlanCycleBudgetsAction).not.toHaveBeenCalled();
    act(() => {
      el(tid('cycle-budgets'))?.dispatchEvent(
        new Event('reset', { bubbles: true, cancelable: true }),
      );
    });
    expect([...inputs(tid('budget-amount'))][1]?.value).toBe('');
    expect(el(tid('save-bar'))).toBeNull();
  });

  it('«Add or remove departments» is a popup that saves the departments on its own', async () => {
    actions.savePlanCycleScopeAction.mockResolvedValue(ok({ id: CYCLE, version: 4 }));
    mount(departments());
    click(el(tid('cycle-departments-edit')));
    const dialog = dialogEl(tid('cycle-scope-dialog'))!;
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('h2')?.textContent).toBe('Departments in this cycle');
    // The branches too, and how many forms reach nobody.
    expect([...els(tid('scope-branch'))]).toHaveLength(1);
    expect(el(tid('scope-no-head'))?.textContent).toContain('2 departments have no head');
    click([...els(tid('scope-unit'))][0]);
    click(el(tid('scope-branch')));
    await submit(el(tid('cycle-scope')));
    expect(actions.savePlanCycleScopeAction).toHaveBeenCalledExactlyOnceWith({
      id: CYCLE,
      version: 3,
      departmentIds: [SALES],
      branchIds: ['cairo'],
    });
    expect(dialogEl(tid('cycle-scope-dialog'))?.open).toBe(false);
    expect(router.refresh).toHaveBeenCalled();
  });

  it('no department yet: the section offers to add them', () => {
    mount(departments({ rows: [], scope: { departmentIds: [], branchIds: [] } }));
    expect(el(tid('cycle-budgets'))?.textContent).toContain('No department is in this cycle');
    expect(el(tid('cycle-departments-edit'))).not.toBeNull();
    expect(el(tid('budget-total'))).toBeNull();
  });

  it('Instructions to heads: the default language first; the rest of the cycle goes back as it is', async () => {
    actions.updatePlanCycleBasicsAction.mockResolvedValue(ok({ id: CYCLE, version: 4 }));
    mount(<CycleInstructionsForm {...SETTINGS} basics={BASICS} nameLanguage="en" />);
    expect(
      [...document.body.querySelectorAll('textarea')].map((area) => [area.id, area.dir]),
    ).toEqual([
      ['cycle-instructionsEn', 'ltr'],
      ['cycle-instructionsAr', 'rtl'],
    ]);
    type(area('#cycle-instructionsAr')!, 'أخبرونا باحتياجات فريقكم.');
    await submit(el(tid('cycle-instructions')));
    expect(actions.updatePlanCycleBasicsAction).toHaveBeenCalledExactlyOnceWith({
      ...BASICS,
      instructionsAr: 'أخبرونا باحتياجات فريقكم.',
      id: CYCLE,
      version: 3,
    });
  });

  it('Needs form: the chosen form is saved; a form switched off since stays listed', async () => {
    actions.updatePlanCycleBasicsAction.mockResolvedValue(ok({ id: CYCLE, version: 4 }));
    const OTHER = '99999999-9999-4999-8999-999999999992';
    mount(
      <CycleNeedsFormForm
        {...SETTINGS}
        basics={BASICS}
        needsForms={[
          { id: FORM, name: 'Default needs form', active: false },
          { id: OTHER, name: 'Short form', active: true },
        ]}
        needsFormsLabel="Needs forms"
      />,
    );
    const chooser = select(tid('cycle-needs-form'))!;
    expect([...chooser.options].map((option) => option.textContent)).toEqual([
      'Default needs form (switched off)',
      'Short form',
    ]);
    type(chooser, OTHER);
    await submit(el(tid('cycle-needs-form-section')));
    expect(actions.updatePlanCycleBasicsAction).toHaveBeenCalledExactlyOnceWith({
      ...BASICS,
      needsFormId: OTHER,
      id: CYCLE,
      version: 3,
    });
  });

  it('Reminders: days before the deadline, saved as numbers', async () => {
    actions.savePlanCycleRemindersAction.mockResolvedValue(ok({ id: CYCLE, version: 4 }));
    mount(<CycleRemindersForm {...SETTINGS} initial={[7, 2]} />);
    expect([...els(tid('reminder-day'))].map((chip) => chip.textContent)).toEqual([
      '7 days before',
      '2 days before',
    ]);
    type(input('#reminder-new')!, '14');
    click(el(tid('reminder-add')));
    expect(el(tid('save-bar'))?.dataset.state).toBe('unsaved');
    await submit(el(tid('cycle-reminders')));
    expect(actions.savePlanCycleRemindersAction).toHaveBeenCalledExactlyOnceWith({
      id: CYCLE,
      version: 3,
      reminderDays: [7, 2, 14],
    });
  });

  it('an older copy is refused: the entries stay and the latest version is offered', async () => {
    actions.savePlanCycleRemindersAction.mockResolvedValue(refused('CONFLICT_VERSION'));
    mount(<CycleRemindersForm {...SETTINGS} initial={[7]} />);
    type(input('#reminder-new')!, '3');
    click(el(tid('reminder-add')));
    await submit(el(tid('cycle-reminders')));
    expect(el(tid('cycle-settings-error'))?.textContent).toContain(
      'Someone else changed this cycle',
    );
    expect([...els(tid('reminder-day'))]).toHaveLength(2);
    expect(el(tid('save-bar'))).not.toBeNull();
  });
});
