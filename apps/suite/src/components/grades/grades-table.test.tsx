// @vitest-environment happy-dom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GradesTable } from './grades-table';

const actions = vi.hoisted(() => ({
  addGradeAction: vi.fn(),
  renameGradeAction: vi.fn(),
  deleteGradeAction: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: actions.refresh }) }));
vi.mock('../../actions/grades', () => actions);

/**
 * Organization → Grades (WP-ADM-04, WP-UX-01 e): the add popup stays in the page while closed, yet every
 * opening starts empty — a code typed before (or added) never reappears when «Add grade» is pressed again.
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

/** Types into an uncontrolled input. */
function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const codeField = () => document.querySelector<HTMLInputElement>('#grade-code');
const pressAdd = () => {
  act(() => {
    document.querySelector<HTMLElement>('[data-testid="grade-add"]')?.click();
  });
};

const table = (
  <GradesTable
    rows={[]}
    live
    header={{ title: 'Grades', description: '', breadcrumbs: [], breadcrumbsLabel: 'Breadcrumbs' }}
    notice={null}
    texts={{ errRequired: 'Enter a grade code.' }}
    errors={{}}
  />
);

describe('GradesTable (the add popup)', () => {
  it('starts empty on every opening, after a cancel and after an add', async () => {
    mount(table);
    pressAdd();
    type(codeField()!, 'G7');
    act(() => {
      document.querySelector<HTMLDialogElement>('[data-testid="grade-dialog"]')?.close();
      document
        .querySelector<HTMLDialogElement>('[data-testid="grade-dialog"]')
        ?.dispatchEvent(new Event('close'));
    });
    pressAdd();
    expect(codeField()?.value).toBe('');

    actions.addGradeAction.mockResolvedValueOnce({ ok: true, value: { id: 'g1' } });
    type(codeField()!, 'G8');
    act(() => {
      document.querySelector<HTMLFormElement>('#grade-form')?.requestSubmit();
    });
    await settle();
    expect(actions.addGradeAction).toHaveBeenCalledWith({ code: 'G8' });
    pressAdd();
    expect(codeField()?.value).toBe('');
    // Pressing the button with nothing typed: the message is on the field (nothing is sent).
    act(() => {
      document.querySelector<HTMLFormElement>('#grade-form')?.requestSubmit();
    });
    expect(codeField()?.getAttribute('aria-invalid')).toBe('true');
    expect(actions.addGradeAction).toHaveBeenCalledTimes(1);
  });
});
