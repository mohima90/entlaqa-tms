// @vitest-environment happy-dom
import en from '@jadarat/platform-i18n/messages/en.json';
import ar from '@jadarat/platform-i18n/messages/ar.json';
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flattenTexts } from '../../lib/flatten-texts';
import { CreateOrganization } from './organizations-console';
import { PlanEditor } from './plan-editor';

const actions = vi.hoisted(() => ({
  createOrganizationAction: vi.fn(),
  reissueOrganizationAdminCodeAction: vi.fn(),
  viewOrganizationAdminCodeAction: vi.fn(),
  savePlanAction: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: actions.refresh }) }));
vi.mock('../../auth/platform-console', () => actions);
vi.mock('../../auth/platform-plans', () => actions);

/**
 * The Super Admin's popups (WP-UX-01 d, T-M3-21; forms standard rules 8–9, PO 12 Nov 2026): «Create
 * organization» and a plan's «New plan» / «Edit» are one centred popup of 672 px — «Cancel» then the primary
 * button at the end. Creating an organization asks for its name in the language chosen in the same popup
 * (a red asterisk), the other language being optional; the Organization Admin's names wait behind «More».
 * With the real messages, in English and Arabic.
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

const byTestId = <T extends Element = HTMLElement>(id: string) =>
  document.querySelector<T>(`[data-testid="${id}"]`);
const click = (element: Element | null) => {
  act(() => {
    (element as HTMLElement).click();
  });
};
const type = (input: HTMLInputElement | null, value: string) => {
  act(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- the native setter, so React's value tracking sees a change
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const choose = (select: HTMLSelectElement | null, value: string) => {
  act(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- the native setter, as above
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setter?.call(select, value);
    select?.dispatchEvent(new Event('change', { bubbles: true }));
  });
};
/** Lets the transition, the server's answer and the focus effect run. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
const submit = async (id: string) => {
  click(byTestId(id));
  await settle();
};

const MESSAGES = { en, ar } as const;
function shared(locale: 'ar' | 'en') {
  const messages = MESSAGES[locale];
  const copy = messages.invitations.copy;
  return {
    locale,
    texts: flattenTexts(messages.platform),
    copyTexts: {
      codeLabel: copy.codeLabel,
      copyCode: copy.copyCode,
      copyLink: copy.copyLink,
      codeCopied: copy.codeCopied,
      linkCopied: copy.linkCopied,
      copyFailed: copy.copyFailed,
      loading: copy.loading,
    },
    errors: {},
    closeLabel: messages.common.close,
  };
}

/** The name fields in the order they are asked: [name, required]. */
const nameFields = () =>
  [
    ...document.querySelectorAll<HTMLInputElement>('input[name="nameEn"], input[name="nameAr"]'),
  ].map((input) => [input.name, input.required] as const);
const field = (name: string) => byTestId<HTMLInputElement>(`create-org-${name}`);

describe('Create organization', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`${locale}: one 672 px popup — English first and required by default, «Cancel» then «Create»`, () => {
      const texts = MESSAGES[locale].platform.create;
      mount(<CreateOrganization {...shared(locale)} plans={[]} />);
      click(byTestId('create-organization'));
      const popup = byTestId('create-organization-panel')!;
      expect(popup.tagName).toBe('DIALOG');
      expect(popup.className).toContain('max-w-2xl');
      expect(nameFields()).toEqual([
        ['nameEn', true],
        ['nameAr', false],
      ]);
      // A red asterisk on the English name, the short name and the e-mail; never «(required)» on screen.
      expect(popup.querySelectorAll('[data-required-mark]')).toHaveLength(3);
      expect(popup.querySelector('label[for$="-nameAr"]')?.textContent).toContain(texts.optional);
      // The Organization Admin's names wait behind «More».
      expect(byTestId('create-org-more')?.getAttribute('aria-expanded')).toBe('false');
      expect(field('adminFirstNameEn')?.closest('fieldset')?.className).toContain('hidden');
      const buttons = [...popup.querySelectorAll('button')].map((b) => b.textContent);
      expect(buttons.slice(-2)).toEqual([texts.cancel, texts.submit]);
      // The ✕ is «Close», never a footer button's name.
      expect(popup.querySelector('button[aria-label]')?.getAttribute('aria-label')).toBe(
        MESSAGES[locale].common.close,
      );
    });
  }

  it('the required name follows the language chosen; refused before sending, the focus on that name', async () => {
    mount(<CreateOrganization {...shared('en')} plans={[]} />);
    click(byTestId('create-organization'));
    choose(byTestId('create-org-locale'), 'ar');
    expect(nameFields()).toEqual([
      ['nameAr', true],
      ['nameEn', false],
    ]);
    type(field('nameEn'), 'Acme');
    type(field('slug'), 'acme');
    type(field('adminEmail'), 'admin@acme.test');
    await submit('create-organization-submit');
    expect(actions.createOrganizationAction).not.toHaveBeenCalled();
    expect(field('nameAr')?.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field('nameAr'));
    expect(document.getElementById(`${field('nameAr')?.id}-error`)?.textContent).toBe(
      en.platform.create.errors.nameAr,
    );
  });

  it('English chosen: the English name alone is sent; created → the code, the link and «Done»', async () => {
    actions.createOrganizationAction.mockResolvedValue({
      ok: true,
      value: { tenantId: 't', inviteCode: 'K7M2PQ9XHT4W', locale: 'en', inviteLink: null },
    });
    mount(<CreateOrganization {...shared('en')} plans={[{ planId: 'p1', name: 'Basic' }]} />);
    click(byTestId('create-organization'));
    type(field('nameEn'), ' Acme ');
    type(field('slug'), 'acme');
    type(field('adminEmail'), 'admin@acme.test');
    await submit('create-organization-submit');
    expect(actions.createOrganizationAction).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'acme',
        nameAr: '',
        nameEn: ' Acme ',
        adminEmail: 'admin@acme.test',
        locale: 'en',
        planId: null,
        trial: true,
      }),
    );
    const created = byTestId('organization-created-dialog')!;
    expect(created.textContent).toContain('Acme');
    expect(byTestId('invite-code')?.textContent).toBe('K7M2-PQ9X-HT4W');
    expect(document.activeElement).toBe(created);
    expect(byTestId('organization-created-done')?.textContent).toBe(en.platform.created.done);
  });

  it('a refused name of the Organization Admin opens «More» and takes the focus', async () => {
    actions.createOrganizationAction.mockResolvedValue({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        status: 422,
        messageKey: 'errors.validationFailed',
        expose: true,
        fieldErrors: [{ path: 'adminFamilyNameEn', code: 'CUSTOM' }],
      },
    });
    mount(<CreateOrganization {...shared('en')} plans={[]} />);
    click(byTestId('create-organization'));
    type(field('nameEn'), 'Acme');
    type(field('slug'), 'acme');
    type(field('adminEmail'), 'admin@acme.test');
    await submit('create-organization-submit');
    expect(byTestId('create-org-more')?.getAttribute('aria-expanded')).toBe('true');
    expect(field('adminFamilyNameEn')?.closest('fieldset')?.className).not.toContain('hidden');
    expect(document.activeElement).toBe(field('adminFamilyNameEn'));
    expect(document.getElementById(`${field('adminFamilyNameEn')?.id}-error`)?.textContent).toBe(
      en.platform.create.errors.adminNamePair,
    );
  });

  it('every opening starts with an empty form', () => {
    mount(<CreateOrganization {...shared('en')} plans={[]} />);
    click(byTestId('create-organization'));
    type(field('slug'), 'typed');
    click(
      [...byTestId('create-organization-panel')!.querySelectorAll('button')].find(
        (b) => b.textContent === en.platform.create.cancel,
      ) ?? null,
    );
    click(byTestId('create-organization'));
    expect(field('slug')?.value).toBe('');
  });
});

describe('Plan popup', () => {
  const plan = {
    planId: 'p1',
    name: 'Basic',
    description: null,
    maxPeople: 50,
    maxStorageGb: null,
    features: ['planning'],
    version: 2,
    tenantCount: 3,
  };
  const editor = (locale: 'ar' | 'en', value: typeof plan | null) => (
    <PlanEditor
      plan={value}
      texts={flattenTexts(MESSAGES[locale].platform)}
      planTexts={flattenTexts(MESSAGES[locale].plans)}
      errors={{}}
      closeLabel={MESSAGES[locale].common.close}
    />
  );

  for (const locale of ['en', 'ar'] as const) {
    it(`${locale}: New plan is one 672 px popup — the name required, «Cancel» then «Save plan»`, () => {
      const texts = MESSAGES[locale].platform.plans;
      mount(editor(locale, null));
      click(byTestId('plan-new'));
      const popup = byTestId('plan-panel')!;
      expect(popup.tagName).toBe('DIALOG');
      expect(popup.className).toContain('max-w-2xl');
      expect(popup.querySelector('h2')?.textContent).toBe(texts.newTitle);
      expect(popup.querySelectorAll('[data-required-mark]')).toHaveLength(1);
      const buttons = [...popup.querySelectorAll('button')].map((b) => b.textContent);
      expect(buttons.slice(-2)).toEqual([texts.cancel, texts.save]);
    });
  }

  it('Edit opens with the plan, says who it applies to; a refused limit takes the focus', async () => {
    mount(editor('en', plan));
    click(byTestId('plan-edit'));
    expect(byTestId<HTMLInputElement>('plan-name')?.value).toBe('Basic');
    expect(byTestId('plan-applies')?.textContent).toContain('3');
    type(byTestId<HTMLInputElement>('plan-maxPeople'), '0');
    await submit('plan-save');
    expect(actions.savePlanAction).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(byTestId('plan-maxPeople'));
  });

  it('saved → the popup closes and the list refreshes', async () => {
    actions.savePlanAction.mockResolvedValue({ ok: true, value: { planId: 'p1' } });
    mount(editor('en', plan));
    click(byTestId('plan-edit'));
    type(byTestId<HTMLInputElement>('plan-maxPeople'), '60');
    await submit('plan-save');
    expect(actions.savePlanAction).toHaveBeenCalledWith(
      expect.objectContaining({ planId: 'p1', name: 'Basic', maxPeople: 60, version: 2 }),
    );
    expect(actions.refresh).toHaveBeenCalled();
    expect(byTestId('plan-panel')?.hasAttribute('open')).toBe(false);
  });
});
