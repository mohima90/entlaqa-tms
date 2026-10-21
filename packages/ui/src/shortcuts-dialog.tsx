'use client';

import { Dialog } from './dialog';

export interface Shortcut {
  /** What the keys do, e.g. «البحث في الصفحات» / "Search pages". */
  readonly label: string;
  /** The keys, pressed together, as shown on the keyboard (e.g. ["Ctrl", "K"], ["Esc"]). */
  readonly keys: readonly string[];
}

export interface ShortcutsDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** «اختصارات لوحة المفاتيح» / "Keyboard shortcuts". */
  readonly title: string;
  readonly closeLabel: string;
  readonly items: readonly Shortcut[];
}

/**
 * The keyboard shortcuts list (direction C, redesign package 1): a small dialog that lists the shortcuts
 * the product already has (Ctrl K / ⌘K page search, Esc, the arrow keys and Enter in lists). Design
 * only: it adds no shortcut, and every shortcut has a visible equivalent. Keys are shown left to right
 * in both languages (they are printed so on the keyboard).
 */
export function ShortcutsDialog({ open, onClose, title, closeLabel, items }: ShortcutsDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      closeLabel={closeLabel}
      size="lg"
      data-testid="shortcuts-dialog"
    >
      <dl className="m-0 grid grid-cols-1 gap-x-7 sm:grid-cols-2">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex items-center justify-between gap-3 border-b border-border py-3"
          >
            <dt className="text-sm">{item.label}</dt>
            <dd className="m-0 inline-flex shrink-0 gap-1" dir="ltr">
              {item.keys.map((key) => (
                <kbd
                  key={key}
                  className="rounded-[7px] border border-border bg-surface px-2 py-1 font-sans text-xs font-medium leading-none text-text-muted"
                >
                  {key}
                </kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
