// @vitest-environment happy-dom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoleOption } from '../../lib/role-choice';
import { ChangeRolePanel } from './change-role-panel';

const actions = vi.hoisted(() => ({
  updateMemberRolesAction: vi.fn(),
  updateMemberPrivilegedRolesAction: vi.fn(),
}));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('../../actions/users', () => actions);

/**
 * «Change role» in the shared popup (WP-UX-01 b; FR-IAM-02, T-M3-21): «Save role» closes the popup once the
 * change is saved — through the native dialog, so focus returns to the opener — and reports the close; a
 * refusal keeps it open with the reason. Regression guard for the self-hosted journey
 * (e2e/users.spec.ts «custom role … gives it to Mona»), where the popup must close after Save.
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

/** Lets the action's promise, the transition and the native `close` event (a queued task) run. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const option = (code: string, kind: RoleOption['kind'] = 'standard'): RoleOption => ({
  code,
  name: code,
  description: null,
  kind,
  privileged: false,
  scope: 'organization',
  assignable: true,
});

function renderPanel(onClose: () => void) {
  const opener = document.createElement('button');
  opener.textContent = 'Change role';
  document.body.append(opener);
  opener.focus();
  const container = mount(
    <ChangeRolePanel
      open
      onClose={onClose}
      target={{
        personId: '33333333-3333-4333-8333-333333333333',
        name: 'Mona Saeed Alzahrani',
        version: '7',
        currentRole: 'line_manager',
        currentUnit: null,
      }}
      options={[option('line_manager'), option('custom_0123456789ab', 'custom')]}
      selectTexts={{
        label: 'Role',
        placeholder: 'Choose',
        standardGroup: 'Standard',
        customGroup: 'Custom',
        privileged: 'privileged',
        notAllowed: 'not allowed',
      }}
      scopeUnits={[]}
      unitTexts={{ label: 'Unit', hint: '', placeholder: '', inactive: '', none: '' }}
      labels={{ save: 'Save role', saving: 'Saving…', cancel: 'Cancel', close: 'Close' }}
      errors={{}}
      undoLabel="Undo"
      locale="en"
    />,
  );
  return { container, opener };
}

function chooseAndSave(container: HTMLElement) {
  const dialog = container.querySelector<HTMLDialogElement>('[data-testid="change-role-panel"]')!;
  const radio = dialog.querySelector<HTMLInputElement>('input[value="custom_0123456789ab"]')!;
  act(() => {
    radio.click();
  });
  const form = dialog.querySelector('form')!;
  act(() => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  return dialog;
}

describe('ChangeRolePanel: Save closes the popup (WP-UX-01 b)', () => {
  it('closes after a successful save, reports the close, returns focus and refreshes the list', async () => {
    actions.updateMemberRolesAction.mockResolvedValue({
      ok: true,
      value: { changed: true, version: '8', beforeUnit: null, headSet: null, headsCleared: [] },
    });
    const onClose = vi.fn();
    const { container, opener } = renderPanel(onClose);
    const dialog = chooseAndSave(container);
    expect(actions.updateMemberRolesAction).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'custom_0123456789ab', version: '7' }),
    );
    await settle();
    expect(dialog.open).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
    expect(router.refresh).toHaveBeenCalled();
    // No navigation: the popup closes in place (no push / replace that could leave it waiting).
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('stays open with the reason when the change is refused', async () => {
    actions.updateMemberRolesAction.mockResolvedValue({
      ok: false,
      error: { code: 'CONFLICT_VERSION' },
    });
    const onClose = vi.fn();
    const { container } = renderPanel(onClose);
    const dialog = chooseAndSave(container);
    await settle();
    expect(dialog.open).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    // The buttons work again: Save is no longer busy.
    expect(dialog.querySelector('[data-testid="change-role-save"]')?.textContent).toBe('Save role');
  });
});
