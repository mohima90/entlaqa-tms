// @vitest-environment happy-dom
import { type ReactNode, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TOAST_DURATION,
  MIN_ACTION_TOAST_DURATION,
  type ToastStore,
  Toaster,
  createToastStore,
  toast,
  toastStore,
} from './index';

let root: Root | undefined;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
  toastStore.clear();
  vi.useRealTimers();
});

function mount(ui: ReactNode) {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(ui));
  return container;
}

const items = (container: HTMLElement) => [...container.querySelectorAll('li')];

describe('toast() (sonner-compatible calls on the page queue)', () => {
  it('adds each tone to the shared queue and dismisses by id', () => {
    const ids = [
      toast('Plain'),
      toast.success('Saved', { description: 'All changes saved.' }),
      toast.warning('Check the dates'),
      toast.info('New version'),
    ];
    expect(toastStore.items().map((t) => [t.tone, t.message])).toEqual([
      ['default', 'Plain'],
      ['success', 'Saved'],
      ['warning', 'Check the dates'],
      ['info', 'New version'],
    ]);
    expect(toastStore.items()[1]?.description).toBe('All changes saved.');
    const error = toast.error('Not saved');
    // At most four at once: the oldest went first.
    expect(toastStore.items().map((t) => t.id)).toEqual([...ids.slice(1), error]);
    toast.dismiss(error);
    expect(toastStore.items().some((t) => t.id === error)).toBe(false);
  });

  it('lets the caller choose the duration, and does not notify for no change', () => {
    const store = createToastStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.add('error', 'Timed error', { duration: 1000 });
    store.add('success', 'Sticky', { duration: null });
    expect(store.items().map((t) => t.duration)).toEqual([1000, null]);
    expect(listener).toHaveBeenCalledTimes(2);
    store.dismiss(999);
    store.clear();
    store.clear();
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

describe('Toaster', () => {
  let store: ToastStore;
  beforeEach(() => {
    store = createToastStore();
  });

  it('is a named polite live region at the bottom end, empty on the server', () => {
    const html = renderToStaticMarkup(<Toaster label="الإشعارات" closeLabel="إغلاق" />);
    expect(html).toMatch(/<section[^>]*aria-label="الإشعارات"[^>]*aria-live="polite"/);
    expect(html).toContain('end-4');
    expect(html).not.toContain('<li');
  });

  it('shows the queue, newest last, with tone icon, description and a close button', () => {
    const container = mount(<Toaster label="Notifications" closeLabel="Close" store={store} />);
    act(() => {
      store.add('default', 'Plain');
      store.add('success', 'Saved', { description: 'All changes saved.' });
    });
    const [plain, saved] = items(container);
    expect(plain?.dataset.tone).toBe('default');
    expect(plain?.querySelectorAll('svg')).toHaveLength(1); // only the close icon
    expect(saved?.dataset.tone).toBe('success');
    // Direction C: dark toasts; the icon is drawn in the toast's text colour and marks its tone.
    expect(saved?.querySelector('svg')?.getAttribute('data-tone-icon')).toBe('success');
    expect(saved?.textContent).toContain('All changes saved.');
    act(() => {
      saved!.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
    });
    expect(items(container).map((li) => li.textContent)).toEqual(['Plain']);
  });

  it('hides a toast after its duration; errors stay until closed', () => {
    vi.useFakeTimers();
    const container = mount(<Toaster label="Notifications" closeLabel="Close" store={store} />);
    act(() => {
      store.add('success', 'Saved');
      store.add('error', 'Not saved');
    });
    act(() => {
      vi.advanceTimersByTime(DEFAULT_TOAST_DURATION - 1);
    });
    expect(items(container)).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(items(container).map((li) => li.dataset.tone)).toEqual(['error']);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(items(container)).toHaveLength(1);
  });

  it('pauses while the pointer or focus is on the toast and resumes with the time left (WCAG 2.2.1)', () => {
    vi.useFakeTimers();
    const container = mount(<Toaster label="Notifications" closeLabel="Close" store={store} />);
    act(() => {
      store.add('info', 'Reading', { duration: 1000 });
    });
    const li = items(container)[0]!;
    act(() => {
      vi.advanceTimersByTime(400);
    });
    act(() => {
      li.dispatchEvent(new Event('pointerenter'));
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(items(container)).toHaveLength(1);
    act(() => {
      li.dispatchEvent(new Event('pointerleave'));
    });
    act(() => {
      vi.advanceTimersByTime(599);
    });
    expect(items(container)).toHaveLength(1);
    act(() => {
      li.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(items(container)).toHaveLength(1);
    act(() => {
      li.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(items(container)).toHaveLength(0);
  });

  it('offers one action (Undo) that runs once and closes the toast (redesign package 3)', () => {
    const container = mount(
      <Toaster
        label="Notifications"
        closeLabel="Close"
        store={store}
        actionHint="You can use “{action}” from this message until you close it."
      />,
    );
    const undo = vi.fn();
    act(() => {
      store.add('success', 'Role saved.', { action: { label: 'Undo', onClick: undo } });
    });
    const button = container.querySelector<HTMLButtonElement>('[data-testid="toast-action"]');
    expect(button?.textContent).toBe('Undo');
    expect(store.items()[0]?.action?.label).toBe('Undo');
    // Stays until closed, and the announcement says the action is there (WCAG 2.2.1, 2.1.1).
    expect(store.items()[0]?.duration).toBeNull();
    expect(container.querySelector('[data-testid="toast-action-hint"]')?.textContent).toBe(
      'You can use “Undo” from this message until you close it.',
    );
    act(() => {
      button!.click();
    });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(items(container)).toHaveLength(0);
  });

  it('never hides a toast with an action in less than MIN_ACTION_TOAST_DURATION', () => {
    const onClick = vi.fn();
    store.add('success', 'Short', { duration: 5000, action: { label: 'Undo', onClick } });
    store.add('success', 'Long', { duration: 60_000, action: { label: 'Undo', onClick } });
    store.add('success', 'Plain', { duration: 5000 });
    expect(store.items().map((t) => t.duration)).toEqual([MIN_ACTION_TOAST_DURATION, 60_000, 5000]);
  });

  it('uses the page queue by default', () => {
    const container = mount(<Toaster label="Notifications" closeLabel="Close" />);
    act(() => {
      toast.warning('Check the dates');
    });
    expect(items(container)[0]?.dataset.tone).toBe('warning');
    expect(items(container)[0]?.querySelector('svg')?.getAttribute('data-tone-icon')).toBe(
      'warning',
    );
  });
});
