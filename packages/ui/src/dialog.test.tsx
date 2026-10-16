// @vitest-environment happy-dom
import { type ReactNode, act, useState } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Dialog } from './index';

let root: Root | undefined;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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

/** The native `close` event is queued as a task; let it run. */
async function flushClose() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function Harness({ onClose }: { readonly onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Open
      </button>
      <button
        type="button"
        data-testid="force-close"
        onClick={() => {
          setOpen(false);
        }}
      >
        Force close
      </button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          onClose();
        }}
        title="Invite member"
        description="They receive an email."
        closeLabel="Close"
        footer={<button type="button">Send</button>}
        size="lg"
        data-testid="invite-dialog"
      >
        <input aria-label="Email" />
      </Dialog>
    </>
  );
}

function openDialog(container: HTMLElement) {
  const opener = container.querySelector('button')!;
  opener.focus();
  act(() => {
    opener.click();
  });
  return { opener, dialog: container.querySelector<HTMLDialogElement>('dialog')! };
}

describe('Dialog (native <dialog>, Kawadir)', () => {
  it('opens as a modal named by its title and described by its description', () => {
    const container = mount(<Harness onClose={vi.fn()} />);
    const { dialog } = openDialog(container);
    expect(dialog.open).toBe(true);
    expect(dialog.dataset.testid).toBe('invite-dialog');
    expect(dialog.className).toContain('max-w-2xl');
    const title = document.getElementById(dialog.getAttribute('aria-labelledby')!);
    expect(title?.textContent).toBe('Invite member');
    const description = document.getElementById(dialog.getAttribute('aria-describedby')!);
    expect(description?.textContent).toBe('They receive an email.');
    expect(dialog.textContent).toContain('Send');
  });

  it('closes with its close button, reports it and returns focus to the opener', async () => {
    const onClose = vi.fn();
    const container = mount(<Harness onClose={onClose} />);
    const { opener, dialog } = openDialog(container);
    act(() => {
      dialog.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
    });
    await flushClose();
    expect(dialog.open).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
  });

  it('closes on a click on the backdrop, not on a click inside the box', async () => {
    const onClose = vi.fn();
    const container = mount(<Harness onClose={onClose} />);
    const { dialog } = openDialog(container);
    act(() => {
      dialog.querySelector('input')!.click();
    });
    await flushClose();
    expect(dialog.open).toBe(true);
    act(() => {
      dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushClose();
    expect(dialog.open).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the parent sets open to false', () => {
    const container = mount(<Harness onClose={vi.fn()} />);
    const { dialog } = openDialog(container);
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="force-close"]')!.click();
    });
    expect(dialog.open).toBe(false);
  });

  it('has no description reference without a description and defaults to the medium width', () => {
    const container = mount(
      <Dialog open onClose={vi.fn()} title="Delete?" closeLabel="إغلاق">
        x
      </Dialog>,
    );
    const dialog = container.querySelector('dialog')!;
    expect(dialog.open).toBe(true);
    expect(dialog.hasAttribute('aria-describedby')).toBe(false);
    expect(dialog.className).toContain('max-w-lg');
    expect(dialog.querySelector('button')?.getAttribute('aria-label')).toBe('إغلاق');
  });
});
