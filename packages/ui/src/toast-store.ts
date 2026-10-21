/**
 * The toast queue behind `toast()` and `<Toaster />` (Kawadir uses sonner; its stylesheet is injected
 * at runtime, which our CSP — nonce'd styles only — refuses, so the same API is built here). Plain
 * TypeScript, no React: any client component calls `toast.success("Saved")`; the one `<Toaster />` of
 * the page shows the queue.
 */
export type ToastTone = 'default' | 'success' | 'error' | 'warning' | 'info';

/** One next step inside a toast, e.g. «تراجع» / "Undo" after a reversible change (redesign package 2). */
export interface ToastAction {
  readonly label: string;
  readonly onClick: () => void;
}

export interface ToastOptions {
  readonly description?: string | undefined;
  /** A button in the toast; clicking it runs `onClick` and closes the toast. */
  readonly action?: ToastAction | undefined;
  /** Milliseconds before it hides itself; `null` keeps it until closed (errors by default). */
  readonly duration?: number | null | undefined;
}

export interface ToastItem {
  readonly id: number;
  readonly tone: ToastTone;
  readonly message: string;
  readonly description: string | undefined;
  readonly duration: number | null;
  readonly action: ToastAction | undefined;
}

/** Long enough to read a sentence (WCAG 2.2.1: hover or focus also pauses it). */
export const DEFAULT_TOAST_DURATION = 6000;
/** A toast with an action (Undo) stays longer: time to read it and reach the button (WCAG 2.2.1). */
export const ACTION_TOAST_DURATION = 10000;
/** At most this many at once; the oldest goes first. */
export const MAX_TOASTS = 4;

type Listener = (items: readonly ToastItem[]) => void;

export interface ToastStore {
  readonly add: (tone: ToastTone, message: string, options?: ToastOptions) => number;
  readonly dismiss: (id: number) => void;
  readonly clear: () => void;
  readonly items: () => readonly ToastItem[];
  readonly subscribe: (listener: Listener) => () => void;
}

export function createToastStore(): ToastStore {
  let items: readonly ToastItem[] = [];
  let nextId = 1;
  const listeners = new Set<Listener>();
  const emit = () => {
    for (const listener of listeners) listener(items);
  };
  return {
    add(tone, message, options = {}) {
      const id = nextId++;
      const duration =
        options.duration === undefined
          ? tone === 'error'
            ? null
            : options.action
              ? ACTION_TOAST_DURATION
              : DEFAULT_TOAST_DURATION
          : options.duration;
      items = [
        ...items,
        { id, tone, message, description: options.description, duration, action: options.action },
      ].slice(-MAX_TOASTS);
      emit();
      return id;
    },
    dismiss(id) {
      const next = items.filter((item) => item.id !== id);
      if (next.length === items.length) return;
      items = next;
      emit();
    },
    clear() {
      if (items.length === 0) return;
      items = [];
      emit();
    },
    items: () => items,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The page's queue. */
export const toastStore = createToastStore();

type ToastFn = ((message: string, options?: ToastOptions) => number) & {
  readonly success: (message: string, options?: ToastOptions) => number;
  readonly error: (message: string, options?: ToastOptions) => number;
  readonly warning: (message: string, options?: ToastOptions) => number;
  readonly info: (message: string, options?: ToastOptions) => number;
  readonly dismiss: (id: number) => void;
};

/** sonner-compatible calls: `toast("…")`, `toast.success("…", { description })`, `toast.error("…")`. */
export const toast: ToastFn = Object.assign(
  (message: string, options?: ToastOptions) => toastStore.add('default', message, options),
  {
    success: (message: string, options?: ToastOptions) =>
      toastStore.add('success', message, options),
    error: (message: string, options?: ToastOptions) => toastStore.add('error', message, options),
    warning: (message: string, options?: ToastOptions) =>
      toastStore.add('warning', message, options),
    info: (message: string, options?: ToastOptions) => toastStore.add('info', message, options),
    dismiss: (id: number) => {
      toastStore.dismiss(id);
    },
  },
);
