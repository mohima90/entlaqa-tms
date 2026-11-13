// @vitest-environment happy-dom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CostCentresTable } from './cost-centres-table';
import { LevelsCard } from './levels-card';
import { UnitPanel } from './unit-panel';

const actions = vi.hoisted(() => ({
  createCostCentreAction: vi.fn(),
  updateCostCentreAction: vi.fn(),
  deleteCostCentreAction: vi.fn(),
  createStructureUnitAction: vi.fn(),
  updateStructureUnitAction: vi.fn(),
  addStructureLevelAction: vi.fn(),
  renameStructureLevelAction: vi.fn(),
  removeStructureLevelAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('../../actions/cost-centres', () => actions);
vi.mock('../../actions/structure', () => actions);

/**
 * The organization set-up popups (WP-UX-01 b; forms standard rules 8–9, PO 12 Nov 2026): one centred popup
 * (the shared Dialog, 448 px), the name in the organization's default language asked first and required
 * (a red asterisk), the other language optional, «Cancel» then the primary button at the end.
 */
let root: Root | undefined;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  vi.clearAllMocks();
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

const click = (element: Element | null) => {
  act(() => {
    (element as HTMLElement).click();
  });
};
const type = (input: HTMLInputElement, value: string) => {
  act(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- the native setter, so React's value tracking sees a change
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const submit = async (form: HTMLFormElement | null) => {
  await act(async () => {
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
};
/** The ids of a popup's name fields in the order they are asked, with which one is required. */
const nameFields = (popup: Element) =>
  [...popup.querySelectorAll<HTMLInputElement>('input[name="nameEn"], input[name="nameAr"]')].map(
    (input) => [input.name, input.required, input.lang] as const,
  );

// Keys stand in for the texts (the components show a key that has no text).
const texts = { required: '(required)', optional: '(optional)' };
const row = {
  id: 'c1',
  code: 'CC-100',
  nameEn: null,
  nameAr: 'المالية',
  name: 'المالية',
  active: true,
  version: 3,
  peopleCount: 0,
  unitCount: 0,
  usageLabel: '',
};

describe('cost centre popup', () => {
  const table = (nameLanguage: 'ar' | 'en', rows = [row]) => (
    <CostCentresTable
      rows={rows}
      canManage
      texts={texts}
      errors={{}}
      locale="en"
      nameLanguage={nameLanguage}
    />
  );

  it('is a small centred popup: the default language first and required, «Cancel» then the primary button', () => {
    const container = mount(table('ar'));
    click(container.querySelector('[data-testid="cost-centre-add"]'));
    const popup = document.querySelector('dialog[data-testid="cost-centre-dialog"]')!;
    expect(popup.className).toContain('max-w-md');
    expect(nameFields(popup)).toEqual([
      ['nameAr', true, 'ar'],
      ['nameEn', false, 'en'],
    ]);
    // The red asterisk on the required name and on the code; «(optional)» in words on the other name.
    expect(popup.querySelectorAll('[data-required-mark]')).toHaveLength(2);
    expect(popup.querySelector('label[for="cost-centre-nameEn"]')?.textContent).toContain(
      '(optional)',
    );
    const buttons = [...popup.querySelectorAll('button')].map((b) => b.textContent);
    expect(buttons.slice(-2)).toEqual(['form.cancel', 'form.create']);
  });

  it('asks for the default language’s name before sending; one saved with its names as they were is sent', async () => {
    actions.createCostCentreAction.mockResolvedValue({ ok: true, value: { id: 'c2' } });
    const container = mount(table('en'));
    click(container.querySelector('[data-testid="cost-centre-add"]'));
    const popup = document.querySelector('dialog[data-testid="cost-centre-dialog"]')!;
    type(popup.querySelector<HTMLInputElement>('#cost-centre-nameAr')!, 'مبيعات');
    type(popup.querySelector<HTMLInputElement>('#cost-centre-code')!, 'CC-200');
    await submit(popup.querySelector('form'));
    expect(actions.createCostCentreAction).not.toHaveBeenCalled();
    expect(popup.querySelector('#cost-centre-nameEn-error')?.textContent).toBe(
      'fieldErrors.required',
    );
    type(popup.querySelector<HTMLInputElement>('#cost-centre-nameEn')!, 'Sales');
    await submit(popup.querySelector('form'));
    expect(actions.createCostCentreAction).toHaveBeenCalledWith({
      code: 'CC-200',
      nameEn: 'Sales',
      nameAr: 'مبيعات',
      status: 'active',
    });
  });
});

describe('level popup', () => {
  it('asks the default language’s name first; a level with one name shows no empty second line', () => {
    const container = mount(
      <LevelsCard
        levels={[
          {
            id: 'l1',
            ordinal: 1,
            nameEn: 'Department',
            nameAr: null,
            name: 'Department',
            version: 1,
            unitCount: 0,
            unitCountLabel: '',
            inUseLabel: '',
          },
        ]}
        canManage
        maxLevels={10}
        locked={false}
        texts={texts}
        errors={{}}
        locale="ar"
        nameLanguage="en"
      />,
    );
    const levelRow = container.querySelector('[data-testid="level-row-1"]')!;
    expect(levelRow.querySelector('[data-testid="level-name"]')?.textContent).toBe('Department');
    expect(levelRow.querySelectorAll('[lang]')).toHaveLength(0);
    click(container.querySelector('[data-testid="level-add"]'));
    const popup = document.querySelector('dialog[data-testid="level-dialog"]')!;
    expect(popup.className).toContain('max-w-md');
    expect(nameFields(popup)).toEqual([
      ['nameEn', true, 'en'],
      ['nameAr', false, 'ar'],
    ]);
    const buttons = [...popup.querySelectorAll('button')];
    expect(buttons.at(-1)?.getAttribute('type')).toBe('submit');
    expect(buttons.at(-1)?.getAttribute('form')).toBe(popup.querySelector('form')?.id);
  });
});

describe('unit popup', () => {
  const panel = (nameLanguage: 'ar' | 'en') => (
    <UnitPanel
      mode={{ kind: 'create', parent: null, levelName: 'Department' }}
      branches={[]}
      people={[]}
      costCentres={[]}
      existingCodes={['UNIT']}
      levelNames={['Department', 'Section']}
      texts={texts}
      errors={{}}
      locale="ar"
      nameLanguage={nameLanguage}
      onClose={() => undefined}
      onFollowUp={() => undefined}
    />
  );

  it('a unit named in Arabic only is sent with a neutral code, then the next step is offered', async () => {
    actions.createStructureUnitAction.mockResolvedValue({
      ok: true,
      value: { id: 'u1', headRole: null },
    });
    mount(panel('ar'));
    const popup = document.querySelector('dialog[data-testid="unit-dialog"]')!;
    expect(popup.className).toContain('max-w-md');
    expect(nameFields(popup)).toEqual([
      ['nameAr', true, 'ar'],
      ['nameEn', false, 'en'],
    ]);
    // «More options» is closed: the code, branch and head wait there (hidden, still sent).
    const more = popup.querySelector('[data-testid="unit-more"]')!;
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(popup.querySelector('#unit-more')?.className).toBe('hidden');
    type(popup.querySelector<HTMLInputElement>('#unit-nameAr')!, 'المبيعات');
    await submit(popup.querySelector('form'));
    expect(actions.createStructureUnitAction).toHaveBeenCalledWith({
      code: 'UNIT-2',
      nameEn: '',
      nameAr: 'المبيعات',
      branchId: '',
      headPersonId: '',
      defaultCostCentreId: '',
      parentId: '',
    });
    // Added: the name that was given, and the follow-up buttons with «Done» first.
    expect(popup.querySelector('h2')?.textContent).toBe('form.addedTitle');
    expect(popup.querySelector('[data-testid="unit-dialog-added"]')).not.toBeNull();
    expect(
      [...popup.querySelectorAll('button[data-testid]')].map((b) => b.getAttribute('data-testid')),
    ).toEqual(['unit-dialog-done', 'unit-dialog-add-another', 'unit-dialog-add-under']);
  });

  it('suggests the code from the English name when there is one', async () => {
    actions.createStructureUnitAction.mockResolvedValue({
      ok: true,
      value: { id: 'u1', headRole: null },
    });
    mount(panel('en'));
    const popup = document.querySelector('dialog[data-testid="unit-dialog"]')!;
    type(popup.querySelector<HTMLInputElement>('#unit-nameEn')!, 'Human Resources');
    expect(popup.querySelector<HTMLInputElement>('#unit-code')?.value).toBe('HR');
    await submit(popup.querySelector('form'));
    expect(actions.createStructureUnitAction).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'HR', nameEn: 'Human Resources', nameAr: '' }),
    );
  });
});
