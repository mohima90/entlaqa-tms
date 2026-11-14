// @vitest-environment happy-dom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditUserForm, type EditUserFormProps } from './edit-user-form';

const actions = vi.hoisted(() => ({
  updateUserDetailsAction: vi.fn(),
  updatePersonRecordAction: vi.fn(),
}));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('../../actions/users', () => actions);

/**
 * A person's settings sections (WP-UX-01 e; FR-IAM-01, T-M3-21): each tab shows its own fields, the save bar
 * appears only once something changed, a save sends the whole record with its version — the open section's
 * fields as typed, the others as stored — and only the action whose fields changed runs.
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

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Types into a controlled input the way React listens for it. */
function type(input: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto =
    input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  act(() => {
    descriptor?.set?.call(input, value);
    input.dispatchEvent(
      new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}

function props(section: EditUserFormProps['section']): EditUserFormProps {
  return {
    section,
    locale: 'en',
    personId: '5eed1000-0000-4000-8000-000000000002',
    version: '4:2',
    names: {
      values: {
        firstNameAr: 'خالد',
        fatherNameAr: null,
        grandfatherNameAr: null,
        familyNameAr: 'الشهري',
        firstNameEn: 'Khalid',
        fatherNameEn: null,
        grandfatherNameEn: null,
        familyNameEn: 'Alshehri',
        mobileE164: null,
        preferredLocale: 'ar',
      },
      prefilled: { ar: false, en: false },
      unsplit: { ar: null, en: null },
    },
    nameLanguage: 'en',
    values: {
      email: 'khalid@example.test',
      hasLogin: true,
      employeeNumber: 'EMP-1',
      departmentId: '',
      branchId: '',
      costCentreId: '',
      managerPersonId: '',
      jobTitleAr: '',
      jobTitleEn: '',
      hireOn: '',
    },
    departments: [],
    branches: [],
    costCentres: [],
    managers: [],
    labels: {},
    fieldTexts: {},
    errors: {},
    hireOnHijri: undefined,
    record: {
      locked: false,
      gradeId: '',
      grades: [{ id: 'g1', code: 'G7' }],
      gradesHref: '/en/suite/admin/grades',
      canEditHr: false,
      hr: { gender: '', birthDate: '', employmentCategory: '' },
      birthDateHijri: undefined,
      labels: {},
    },
  };
}

describe('EditUserForm (a person settings section)', () => {
  it('«Personal details» shows the names and contact, not the work fields', () => {
    const container = mount(<EditUserForm {...props('personal')} />);
    expect(container.querySelector('#edit-firstNameEn')).not.toBeNull();
    expect(container.querySelector('#edit-mobile')).not.toBeNull();
    expect(container.querySelector('#edit-employeeNumber')).toBeNull();
    expect(container.querySelector('#edit-grade')).toBeNull();
    // Nothing changed: no save bar.
    expect(container.querySelector('[data-testid="save-bar"]')).toBeNull();
  });

  it('«Work details» saves the whole record with its version: typed work fields, stored names', async () => {
    actions.updateUserDetailsAction.mockResolvedValue({
      ok: true,
      value: { personId: 'p', changed: ['employeeNumber'], version: '5:2' },
    });
    const container = mount(<EditUserForm {...props('work')} />);
    expect(container.querySelector('#edit-firstNameEn')).toBeNull();
    type(container.querySelector<HTMLInputElement>('#edit-employeeNumber')!, 'EMP-2');
    expect(container.querySelector('[data-testid="save-bar"]')).not.toBeNull();
    act(() => {
      container.querySelector<HTMLFormElement>('form')?.requestSubmit();
    });
    await settle();
    expect(actions.updateUserDetailsAction).toHaveBeenCalledTimes(1);
    expect(actions.updateUserDetailsAction.mock.calls[0]?.[0]).toMatchObject({
      version: '4:2',
      employeeNumber: 'EMP-2',
      firstNameEn: 'Khalid',
      familyNameEn: 'Alshehri',
      // The login e-mail is never sent.
      email: '',
    });
    expect(actions.updatePersonRecordAction).not.toHaveBeenCalled();
    expect(router.refresh).toHaveBeenCalled();
    // Saved: the bar is gone until the next change.
    expect(container.querySelector('[data-testid="save-bar"]')).toBeNull();
  });

  it('a grade change alone saves the grade only', async () => {
    actions.updatePersonRecordAction.mockResolvedValue({
      ok: true,
      value: { grade: { changed: true }, hrChanged: [] },
    });
    const container = mount(<EditUserForm {...props('work')} />);
    type(container.querySelector<HTMLSelectElement>('#edit-grade')!, 'g1');
    act(() => {
      container.querySelector<HTMLFormElement>('form')?.requestSubmit();
    });
    await settle();
    expect(actions.updateUserDetailsAction).not.toHaveBeenCalled();
    expect(actions.updatePersonRecordAction).toHaveBeenCalledWith({
      personId: '5eed1000-0000-4000-8000-000000000002',
      gradeId: 'g1',
    });
  });

  it('«Discard changes» puts the stored values back', () => {
    const container = mount(<EditUserForm {...props('personal')} />);
    const first = container.querySelector<HTMLInputElement>('#edit-firstNameEn')!;
    type(first, 'Kh');
    expect(container.querySelector('[data-testid="save-bar"]')).not.toBeNull();
    act(() => {
      container.querySelector<HTMLFormElement>('form')?.reset();
    });
    expect(first.value).toBe('Khalid');
    expect(container.querySelector('[data-testid="save-bar"]')).toBeNull();
  });
  it('a second save on the same tab sends the version the first one returned (no conflict)', async () => {
    actions.updateUserDetailsAction.mockResolvedValue({
      ok: true,
      value: { personId: 'p', changed: ['employeeNumber'], version: '5:2' },
    });
    const container = mount(<EditUserForm {...props('work')} />);
    const number = container.querySelector<HTMLInputElement>('#edit-employeeNumber')!;
    type(number, 'EMP-2');
    act(() => {
      container.querySelector<HTMLFormElement>('form')?.requestSubmit();
    });
    await settle();
    // Typed again before the page has loaded the new copy.
    type(number, 'EMP-3');
    act(() => {
      container.querySelector<HTMLFormElement>('form')?.requestSubmit();
    });
    await settle();
    expect(actions.updateUserDetailsAction).toHaveBeenCalledTimes(2);
    expect(actions.updateUserDetailsAction.mock.calls[1]?.[0]).toMatchObject({
      version: '5:2',
      employeeNumber: 'EMP-3',
    });
  });

  it('details saved, HR fields refused: the retry sends only the HR fields', async () => {
    actions.updateUserDetailsAction.mockResolvedValue({
      ok: true,
      value: { personId: 'p', changed: ['mobile'], version: '5:2' },
    });
    actions.updatePersonRecordAction.mockResolvedValueOnce({
      ok: false,
      error: { code: 'VALIDATION_FAILED', fieldErrors: [{ path: 'birthDate', code: 'INVALID' }] },
    });
    actions.updatePersonRecordAction.mockResolvedValueOnce({
      ok: true,
      value: { grade: null, hrChanged: ['birthDate'] },
    });
    const base = props('personal');
    const container = mount(
      <EditUserForm {...base} record={{ ...base.record, canEditHr: true }} />,
    );
    type(container.querySelector<HTMLInputElement>('#edit-mobile')!, '+966551112233');
    const birth = container.querySelector<HTMLInputElement>('#edit-birthDate')!;
    type(birth, '2999-01-01');
    act(() => {
      container.querySelector<HTMLFormElement>('form')?.requestSubmit();
    });
    await settle();
    expect(actions.updateUserDetailsAction).toHaveBeenCalledTimes(1);
    expect(birth.getAttribute('aria-invalid')).toBe('true');
    // Still unsaved: the date.
    expect(container.querySelector('[data-testid="save-bar"]')).not.toBeNull();
    type(birth, '1992-05-14');
    act(() => {
      container.querySelector<HTMLFormElement>('form')?.requestSubmit();
    });
    await settle();
    // The mobile number is not sent again (no conflict with the version it already moved on).
    expect(actions.updateUserDetailsAction).toHaveBeenCalledTimes(1);
    expect(actions.updatePersonRecordAction).toHaveBeenLastCalledWith({
      personId: '5eed1000-0000-4000-8000-000000000002',
      hr: { gender: '', birthDate: '1992-05-14', employmentCategory: '' },
    });
    expect(container.querySelector('[data-testid="save-bar"]')).toBeNull();
  });
});
