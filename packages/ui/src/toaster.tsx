'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Icon, type IconName } from './icons';
import { type ToastItem, type ToastStore, type ToastTone, toastStore } from './toast-store';

const toneIcon: Record<ToastTone, IconName | null> = {
  default: null,
  success: 'success',
  error: 'error',
  warning: 'warning',
  info: 'info',
};

export interface ToasterProps {
  /** Names the region, e.g. «الإشعارات» / "Notifications". */
  readonly label: string;
  /** «إغلاق» / "Close" — each toast's close button. */
  readonly closeLabel: string;
  /** The queue (tests and stories pass their own). */
  readonly store?: ToastStore | undefined;
}

/**
 * The toasts of the page (direction C: dark rounded toasts at the bottom end): a polite live region,
 * newest last, each with an icon, its text and a close button. The icon is in the toast's text colour
 * (the words say what happened). A toast hides itself after its duration unless the pointer
 * or focus is on it (WCAG 2.2.1); errors stay until closed. Bottom end = bottom right in English,
 * bottom left in Arabic.
 */
export function Toaster({ label, closeLabel, store = toastStore }: ToasterProps) {
  const items = useSyncExternalStore(store.subscribe, store.items, () => EMPTY);
  return (
    <section
      aria-label={label}
      aria-live="polite"
      aria-relevant="additions text"
      className="pointer-events-none fixed bottom-4 end-4 z-[1500] flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {items.map((item) => (
          <Toast key={item.id} item={item} closeLabel={closeLabel} store={store} />
        ))}
      </ol>
    </section>
  );
}

const EMPTY: readonly ToastItem[] = [];

function Toast({
  item,
  closeLabel,
  store,
}: {
  readonly item: ToastItem;
  readonly closeLabel: string;
  readonly store: ToastStore;
}) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(item.duration);
  const element = useRef<HTMLLIElement>(null);
  // Hover or focus pauses the timer (WCAG 2.2.1); listeners, not handlers: the item is no control.
  useEffect(() => {
    const li = element.current;
    if (!li) return undefined;
    const pause = () => {
      setPaused(true);
    };
    const resume = () => {
      setPaused(false);
    };
    li.addEventListener('pointerenter', pause);
    li.addEventListener('pointerleave', resume);
    li.addEventListener('focusin', pause);
    li.addEventListener('focusout', resume);
    return () => {
      li.removeEventListener('pointerenter', pause);
      li.removeEventListener('pointerleave', resume);
      li.removeEventListener('focusin', pause);
      li.removeEventListener('focusout', resume);
    };
  }, []);
  useEffect(() => {
    if (paused || remaining.current === null) return undefined;
    const started = Date.now();
    const timer = window.setTimeout(() => {
      store.dismiss(item.id);
    }, remaining.current);
    return () => {
      window.clearTimeout(timer);
      if (remaining.current !== null) remaining.current -= Date.now() - started;
    };
  }, [paused, item.id, store]);
  const icon = toneIcon[item.tone];
  return (
    <li
      className="pointer-events-auto flex items-start gap-3 rounded-lg bg-inverse-surface py-3 pe-2.5 ps-4.5 text-[14.5px] text-inverse-text shadow-4"
      ref={element}
      data-tone={item.tone}
    >
      {icon ? <Icon name={icon} className="mt-0.5 size-5" data-tone-icon={item.tone} /> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="m-0 font-medium">{item.message}</p>
        {item.description ? <p className="m-0">{item.description}</p> : null}
      </div>
      {item.action ? (
        <button
          type="button"
          onClick={() => {
            store.dismiss(item.id);
            item.action?.onClick();
          }}
          className="-my-1 inline-flex min-h-8.5 shrink-0 items-center rounded-full px-2.5 font-semibold text-inverse-text underline underline-offset-3 hover:bg-inverse-text/20 pointer-coarse:min-h-11"
          data-testid="toast-action"
        >
          {item.action.label}
        </button>
      ) : null}
      <button
        type="button"
        aria-label={closeLabel}
        onClick={() => {
          store.dismiss(item.id);
        }}
        className="-my-1 grid size-8.5 shrink-0 place-items-center rounded-full text-inverse-text hover:bg-inverse-text/20 pointer-coarse:size-11"
      >
        <Icon name="close" />
      </button>
    </li>
  );
}
