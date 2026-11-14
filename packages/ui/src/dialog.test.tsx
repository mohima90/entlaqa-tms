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
    expect(dialog.className).toContain('max-w-3xl');
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

  it('stays open while canClose says no (Escape, the close button, the backdrop)', async () => {
    const working = vi.fn(() => false);
    const onClose = vi.fn();
    const container = mount(
      <Dialog open onClose={onClose} title="Deactivate" closeLabel="Close" canClose={working}>
        body
      </Dialog>,
    );
    const dialog = container.querySelector('dialog')!;
    const cancel = new Event('cancel', { cancelable: true });
    act(() => {
      dialog.dispatchEvent(cancel);
    });
    expect(cancel.defaultPrevented).toBe(true);
    act(() => {
      dialog.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
      dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushClose();
    expect(working).toHaveBeenCalledTimes(3);
    expect(dialog.open).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
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
    expect(dialog.className).toContain('max-w-[560px]');
    expect(dialog.querySelector('button')?.getAttribute('aria-label')).toBe('إغلاق');
  });

  it('has a 672 px size for a rich «create» popup (forms standard rule 9)', () => {
    const container = mount(
      <Dialog open onClose={vi.fn()} title="New planning cycle" closeLabel="Close" size="rich">
        x
      </Dialog>,
    );
    const dialog = container.querySelector('dialog')!;
    // Tailwind's max-w-2xl is 42rem = 672 px.
    expect(dialog.className).toContain('max-w-2xl');
    expect(dialog.className).not.toContain('max-w-3xl');
  });
});

/** A ResizeObserver that reports when asked: the test decides when the sizes «changed». */
function stubResizeObserver() {
  const callbacks = new Set<() => void>();
  class FakeResizeObserver {
    private readonly callback: () => void;
    constructor(callback: () => void) {
      this.callback = callback;
    }
    observe() {
      callbacks.add(this.callback);
    }
    unobserve() {
      callbacks.delete(this.callback);
    }
    disconnect() {
      callbacks.delete(this.callback);
    }
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  return () => {
    act(() => {
      for (const callback of callbacks) callback();
    });
  };
}

function setHeights(element: HTMLElement, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: clientHeight });
}

describe('Dialog: the heading and the buttons stay in view, the body scrolls', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the heading, the body and the buttons apart: only the body can scroll', () => {
    const container = mount(<Harness onClose={vi.fn()} />);
    const { dialog } = openDialog(container);
    const body = dialog.querySelector<HTMLElement>('[data-dialog-body]')!;
    const footer = dialog.querySelector<HTMLElement>('[data-dialog-footer]')!;
    expect(body.className).toContain('overflow-y-auto');
    expect(body.querySelector('input')).not.toBeNull();
    // The title, the close button and the buttons are outside what scrolls.
    expect(body.querySelector('h2')).toBeNull();
    expect(body.querySelector('button')).toBeNull();
    expect(body.contains(footer)).toBe(false);
    expect(footer.className).toContain('shrink-0');
    expect(footer.textContent).toBe('Send');
    // The close button is still the first stop, then the body, then the buttons.
    expect(dialog.querySelector('button')?.getAttribute('aria-label')).toBe('Close');
    expect(body.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is a column only while open, so a closed dialog stays hidden', () => {
    const container = mount(
      <Dialog open={false} onClose={vi.fn()} title="Delete?" closeLabel="Close">
        x
      </Dialog>,
    );
    const classes = container.querySelector('dialog')!.className.split(' ');
    expect(classes).toContain('open:flex');
    expect(classes).not.toContain('flex');
  });

  it('a short dialog has no line above its buttons and no extra keyboard stop', () => {
    const report = stubResizeObserver();
    const container = mount(<Harness onClose={vi.fn()} />);
    const { dialog } = openDialog(container);
    const body = dialog.querySelector<HTMLElement>('[data-dialog-body]')!;
    setHeights(body, 120, 120);
    report();
    expect(dialog.querySelector('[data-dialog-footer]')!.className).not.toContain('border-t');
    expect(body.hasAttribute('tabindex')).toBe(false);
  });

  it('draws a line above the buttons while the body scrolls; fields in it are the keyboard stops', () => {
    const report = stubResizeObserver();
    const container = mount(<Harness onClose={vi.fn()} />);
    const { dialog } = openDialog(container);
    const body = dialog.querySelector<HTMLElement>('[data-dialog-body]')!;
    setHeights(body, 900, 400);
    report();
    expect(dialog.querySelector('[data-dialog-footer]')!.className).toContain('border-t');
    // The body holds a field: Tab reaches it and the browser scrolls to it — no stop on the box itself.
    expect(body.hasAttribute('tabindex')).toBe(false);
    // …and the line goes away when everything fits again.
    setHeights(body, 300, 400);
    report();
    expect(dialog.querySelector('[data-dialog-footer]')!.className).not.toContain('border-t');
  });

  it('a scrolling body with nothing to focus is a keyboard stop named by the title', () => {
    const report = stubResizeObserver();
    const container = mount(
      <Dialog
        open
        onClose={vi.fn()}
        title="Terms"
        closeLabel="Close"
        footer={<button type="button">OK</button>}
      >
        <p>Long text…</p>
      </Dialog>,
    );
    const dialog = container.querySelector('dialog')!;
    const body = dialog.querySelector<HTMLElement>('[data-dialog-body]')!;
    expect(body.hasAttribute('tabindex')).toBe(false);
    setHeights(body, 900, 400);
    report();
    expect(body.getAttribute('tabindex')).toBe('0');
    expect(body.getAttribute('role')).toBe('group');
    expect(body.getAttribute('aria-labelledby')).toBe(dialog.getAttribute('aria-labelledby'));
  });

  it('has no body box without content, and no buttons row without a footer', () => {
    const container = mount(
      <Dialog open onClose={vi.fn()} title="Delete?" closeLabel="Close" footer={<b>ok</b>} />,
    );
    const dialog = container.querySelector('dialog')!;
    expect(dialog.querySelector('[data-dialog-body]')).toBeNull();
    expect(dialog.querySelector('[data-dialog-footer]')).not.toBeNull();
    act(() => root?.unmount());
    const second = mount(
      <Dialog open onClose={vi.fn()} title="Note" closeLabel="Close">
        text
      </Dialog>,
    );
    expect(second.querySelector('[data-dialog-footer]')).toBeNull();
    expect(second.querySelector('[data-dialog-body]')?.textContent).toBe('text');
  });
});
