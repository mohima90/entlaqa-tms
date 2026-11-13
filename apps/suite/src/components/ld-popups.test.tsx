// @vitest-environment happy-dom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CourseAddDialog } from './courses/course-add-dialog';
import { NeedDialog } from './needs/need-dialog';
import { CreateRoleButton, CreateRoleProvider } from './roles/create-role';

const actions = vi.hoisted(() => ({
  createCourseAction: vi.fn(),
  updateCourseAction: vi.fn(),
  setCourseStatusAction: vi.fn(),
  addNeedAction: vi.fn(),
  updateNeedAction: vi.fn(),
  createCustomRoleAction: vi.fn(),
  updateCustomRoleAction: vi.fn(),
  deleteCustomRoleAction: vi.fn(),
}));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('../actions/courses', () => actions);
vi.mock('../actions/roles', () => actions);
vi.mock('@jadarat/tms/actions/needs', () => actions);

/**
 * The learning & development popups (WP-UX-01 c; forms standard rules 8–9, PO 12 Nov 2026): one centred
 * popup (the shared Dialog, 672 px), the name in the organization's default language asked first and
 * required (a red asterisk), the other language optional, «Cancel» then the primary button at the end; a
 * need's popup asks the shared «Discard» question, never the browser's.
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
const flush = () =>
  act(async () => {
    await Promise.resolve();
  });
/** The ids of a popup's text inputs whose id contains `part`, in order, with which one is required. */
const fields = (popup: Element, selector: string) =>
  [...popup.querySelectorAll<HTMLInputElement>(selector)].map(
    (input) => [input.id, input.required, input.lang] as const,
  );

const texts = { required: '(required)', optional: '(optional)' };

describe('«Add course»', () => {
  const dialog = (nameLanguage: 'ar' | 'en', onClose = vi.fn()) => (
    <CourseAddDialog
      open
      onClose={onClose}
      nameLanguage={nameLanguage}
      deliveryTypes={[
        { value: 'classroom', label: 'Classroom' },
        { value: 'virtual', label: 'Virtual' },
      ]}
      preview={false}
      texts={texts}
      errors={{}}
    />
  );

  it('is the rich popup: the default language’s title first and required, then the delivery type and hours', () => {
    mount(dialog('ar'));
    const popup = document.querySelector('dialog[data-testid="course-dialog"]')!;
    expect(popup.className).toContain('max-w-2xl');
    expect(fields(popup, 'input[id^="course-new-title"]')).toEqual([
      ['course-new-titleAr', true, 'ar'],
      ['course-new-titleEn', false, 'en'],
    ]);
    // A red asterisk on the required title, the delivery type and the hours; no code in the popup.
    expect(popup.querySelectorAll('[data-required-mark]')).toHaveLength(3);
    expect(popup.querySelector('[data-testid="course-field-code"]')).toBeNull();
    const buttons = [...popup.querySelectorAll('[data-dialog-footer] button')].map(
      (b) => b.textContent,
    );
    expect(buttons.slice(-2)).toEqual(['form.cancel', 'addCourse']);
  });

  it('sends the title in one language, no code, and the defaults; refuses before sending without the title', async () => {
    actions.createCourseAction.mockResolvedValue({ ok: true, value: {} });
    const onClose = vi.fn();
    mount(dialog('en', onClose));
    const popup = document.querySelector('dialog[data-testid="course-dialog"]')!;
    type(popup.querySelector<HTMLInputElement>('#course-new-titleAr')!, 'التفاوض');
    type(popup.querySelector<HTMLInputElement>('#course-new-durationHours')!, '6');
    await submit(popup.querySelector('form'));
    expect(actions.createCourseAction).not.toHaveBeenCalled();
    expect(popup.querySelector('#course-new-titleEn-error')?.textContent).toBe(
      'fieldErrors.REQUIRED',
    );
    type(popup.querySelector<HTMLInputElement>('#course-new-titleAr')!, '');
    type(popup.querySelector<HTMLInputElement>('#course-new-titleEn')!, 'Negotiation');
    await submit(popup.querySelector('form'));
    await flush();
    expect(actions.createCourseAction).toHaveBeenCalledWith(
      expect.objectContaining({
        titleEn: 'Negotiation',
        titleAr: '',
        deliveryType: 'classroom',
        durationHours: 6,
        minParticipants: 1,
        maxParticipants: 20,
      }),
    );
    expect(actions.createCourseAction.mock.calls[0]?.[0]).not.toHaveProperty('code');
    expect(onClose).toHaveBeenCalled();
    expect(router.refresh).toHaveBeenCalled();
  });
});

describe('«Add course» when no code can be given', () => {
  it('says so in the popup, in words, instead of a field to correct', async () => {
    actions.createCourseAction.mockResolvedValue({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        status: 422,
        messageKey: 'errors.validationFailed',
        fieldErrors: [{ path: 'code', code: 'CODE_TAKEN' }],
      },
    });
    const onClose = vi.fn();
    mount(
      <CourseAddDialog
        open
        onClose={onClose}
        nameLanguage="en"
        deliveryTypes={[{ value: 'classroom', label: 'Classroom' }]}
        preview={false}
        texts={{ ...texts, 'form.codeUnavailable': 'No free code.' }}
        errors={{ 'errors.validationFailed': 'Some fields need correcting.' }}
      />,
    );
    const popup = document.querySelector('dialog[data-testid="course-dialog"]')!;
    type(popup.querySelector<HTMLInputElement>('#course-new-titleEn')!, 'Negotiation');
    type(popup.querySelector<HTMLInputElement>('#course-new-durationHours')!, '6');
    await submit(popup.querySelector('form'));
    await flush();
    expect(popup.querySelector('[data-testid="course-form-message"]')?.textContent).toBe(
      'No free code.',
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('a need’s popup', () => {
  const need = (onClose = vi.fn()) => (
    <NeedDialog
      locale="en"
      open
      onClose={onClose}
      need={null}
      cycleId="00000000-0000-4000-8000-0000000000c1"
      departmentId="00000000-0000-4000-8000-0000000000d1"
      currency="SAR"
      team={[]}
      courses={[
        // A course titled in Arabic only: the picker shows the title that exists.
        { id: '00000000-0000-4000-8000-00000000c0a1', title: { ar: 'التفاوض', en: null } },
      ]}
      moreFields={[]}
      texts={{ discardChanges: 'Discard changes', keepEditing: 'Keep editing' }}
      formTexts={{}}
      errors={{}}
    />
  );

  it('is the rich popup, and closing with typed entries asks the shared question (no window.confirm)', () => {
    const confirm = vi.fn(() => true);
    window.confirm = confirm;
    const onClose = vi.fn();
    mount(need(onClose));
    const popup = document.querySelector('dialog[data-testid="need-panel"]')!;
    expect(popup.className).toContain('max-w-2xl');
    expect(popup.textContent).toContain('التفاوض');
    // Nothing typed: «Cancel» closes at once.
    click(popup.querySelector('[data-testid="need-cancel"]'));
    expect(onClose).toHaveBeenCalledTimes(1);
    // Typed: the question first; «Keep editing» keeps the popup, «Discard changes» closes it.
    type(popup.querySelector<HTMLInputElement>('[data-testid="need-topic"]')!, 'Phone skills');
    click(popup.querySelector('[data-testid="need-cancel"]'));
    expect(onClose).toHaveBeenCalledTimes(1);
    const question = document.querySelector('dialog[data-testid="discard-dialog"]')!;
    expect(question.textContent).toContain('panel.discardTitle');
    click(question.querySelector('[data-testid="discard-confirm"]'));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('«Create role»', () => {
  const setup = (nameLanguage: 'ar' | 'en') => ({
    starts: [
      {
        value: 'blank',
        label: 'A blank role',
        group: 'blank' as const,
        nameEn: null,
        nameAr: null,
        description: null,
        dataScope: 'own' as const,
        permissions: [],
      },
      {
        value: 'template:auditor',
        label: 'Auditor',
        group: 'template' as const,
        nameEn: 'Auditor',
        nameAr: 'مدقق',
        description: 'Reads the audit log.',
        dataScope: 'organization' as const,
        permissions: ['platform.audit.read'],
      },
    ],
    nameLanguage,
    texts: { ...texts, titleNew: 'Create role' },
    errors: {},
    rolesHref: '/en/suite/admin/roles',
    locale: 'en' as const,
  });

  it('opens one rich popup: start from, then the names — the default language first and required', () => {
    const container = mount(
      <CreateRoleProvider setup={setup('ar')} initial={null}>
        <CreateRoleButton label="Create role" />
      </CreateRoleProvider>,
    );
    click(container.querySelector('[data-testid="create-role-link"]'));
    const popup = document.querySelector('dialog[data-testid="role-create-dialog"]')!;
    expect(popup.className).toContain('max-w-2xl');
    expect(fields(popup, 'input[id^="role-name-"]')).toEqual([
      ['role-name-ar', true, 'ar'],
      ['role-name-en', false, 'en'],
    ]);
    const buttons = [...popup.querySelectorAll('[data-dialog-footer] button')].map(
      (b) => b.textContent,
    );
    expect(buttons.slice(-2)).toEqual(['cancel', 'Create role']);
  });

  it('creates the role with what its start gives, then opens its page', async () => {
    actions.createCustomRoleAction.mockResolvedValue({
      ok: true,
      value: { id: 'r1', code: 'custom_0123456789ab' },
    });
    mount(
      <CreateRoleProvider setup={setup('en')} initial={{ start: 'template:auditor' }}>
        <CreateRoleButton label="Create role" />
      </CreateRoleProvider>,
    );
    const popup = document.querySelector('dialog[data-testid="role-create-dialog"]')!;
    // The template's names are filled in; a missing default-language name is asked for.
    expect(popup.querySelector<HTMLInputElement>('#role-name-en')?.value).toBe('Auditor');
    type(popup.querySelector<HTMLInputElement>('#role-name-en')!, '');
    await submit(popup.querySelector('form'));
    expect(actions.createCustomRoleAction).not.toHaveBeenCalled();
    expect(popup.querySelector('#role-name-en-error')?.textContent).toBe('fieldErrors.required');
    type(popup.querySelector<HTMLInputElement>('#role-name-en')!, 'Quality auditor');
    await submit(popup.querySelector('form'));
    await flush();
    expect(actions.createCustomRoleAction).toHaveBeenCalledWith({
      nameEn: 'Quality auditor',
      nameAr: 'مدقق',
      description: 'Reads the audit log.',
      dataScope: 'organization',
      permissions: ['platform.audit.read'],
    });
    expect(router.push).toHaveBeenCalledWith('/en/suite/admin/roles/custom_0123456789ab');
  });
});
