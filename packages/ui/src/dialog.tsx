'use client';

import { Children, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './icons';

export interface DialogProps {
  readonly open: boolean;
  /** Called when the dialog closes itself: Escape, the close button or a click on the backdrop. */
  readonly onClose: () => void;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** «إغلاق» / "Close" — the label of the close button in the corner. */
  readonly closeLabel: string;
  /** Buttons at the bottom (Kawadir DialogFooter: end-aligned, stacked on phones). */
  readonly footer?: ReactNode;
  /**
   * The box's width: `sm` 448 px (a confirmation, a simple «create» popup), `md` 560 px, `rich` 672 px (a
   * rich «create» popup — forms standard rule 9, docs/design/forms-standard.md), `lg` 768 px.
   */
  readonly size?: 'sm' | 'md' | 'rich' | 'lg' | undefined;
  /**
   * A confirmation's consequence (direction C): `danger` — destructive, cannot be undone (red tile);
   * `warning` — reversible but with an effect people should know (amber tile). The text still says it.
   */
  readonly tone?: 'danger' | 'warning' | undefined;
  readonly className?: string | undefined;
  readonly children?: ReactNode;
  /**
   * Asked before the dialog closes itself (Escape, the close button, the backdrop): false keeps it open —
   * e.g. while its action is working. The caller then closes it with `open`.
   */
  readonly canClose?: (() => boolean) | undefined;
  readonly 'data-testid'?: string | undefined;
}

// Wider than before (role-play feedback #5, PO 27 Oct 2026).
const widths = {
  sm: 'max-w-md',
  md: 'max-w-[560px]',
  // 672 px: the rich «create» popup of the Kawadir pattern (forms standard rule 9; PO, 12 Nov 2026).
  rich: 'max-w-2xl',
  lg: 'max-w-3xl',
} as const;
const toneTiles: Record<
  'danger' | 'warning',
  { readonly icon: IconName; readonly classes: string }
> = {
  danger: { icon: 'warning', classes: 'bg-danger-subtle text-danger' },
  warning: { icon: 'warning', classes: 'bg-warning-subtle text-warning' },
};

/** What the keyboard can already reach inside the body: then scrolling follows focus. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog for confirmations and short questions (direction C: when to use a dialog rather than a
 * side panel — docs/design/redesign-direction-c.md), on the native `<dialog>`: the
 * browser makes the page behind it inert and keeps Tab inside, Escape closes it, and focus returns to
 * the element that opened it. Titled by its heading, described by its description. No inline styles
 * (the CSP allows none): the look is Tailwind classes only.
 *
 * Three parts: the heading with the close button, the body, the `footer`. When the popup is taller than
 * the screen only the body scrolls — the heading and the buttons stay in view (the way out and the way on
 * are always there), and a line then separates the buttons from what scrolls behind them. A scrolling
 * body with nothing in it to focus becomes a keyboard stop itself, so the arrow keys can scroll it
 * (WCAG 2.1.1; axe `scrollable-region-focusable`). A short dialog looks as it always did.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  closeLabel,
  footer,
  size = 'md',
  tone,
  className,
  children,
  canClose,
  'data-testid': testId,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const body = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  // Whether the body is taller than its box, and whether it then needs to be a keyboard stop itself.
  const [scrolls, setScrolls] = useState(false);
  const [keyboardStop, setKeyboardStop] = useState(false);
  const hasBody = Children.toArray(children).length > 0;
  const hasFooter = Boolean(footer);

  useEffect(() => {
    const box = body.current;
    const inner = content.current;
    if (!open || !box || !inner || typeof ResizeObserver === 'undefined') return undefined;
    // Runs when observing starts and whenever the box or what is in it changes size («More» opens,
    // the window gets shorter).
    const observer = new ResizeObserver(() => {
      const taller = box.scrollHeight > box.clientHeight + 1;
      setScrolls(taller);
      setKeyboardStop(taller && inner.querySelector(FOCUSABLE) === null);
    });
    observer.observe(box);
    observer.observe(inner);
    return () => {
      observer.disconnect();
    };
  }, [open, hasBody]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    const onNativeClose = () => {
      opener.current?.focus();
      opener.current = null;
      onClose();
    };
    // A click on the backdrop lands on the <dialog> itself (its content fills the box): close it.
    // Escape and the close button are the keyboard paths.
    const onBackdrop = (event: MouseEvent) => {
      if (event.target === dialog && (!canClose || canClose())) dialog.close();
    };
    // Escape: the browser's `cancel` comes first and can be refused.
    const onCancel = (event: Event) => {
      if (canClose && !canClose()) event.preventDefault();
    };
    dialog.addEventListener('close', onNativeClose);
    dialog.addEventListener('click', onBackdrop);
    dialog.addEventListener('cancel', onCancel);
    return () => {
      dialog.removeEventListener('close', onNativeClose);
      dialog.removeEventListener('click', onBackdrop);
      dialog.removeEventListener('cancel', onCancel);
    };
  }, [onClose, canClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      data-testid={testId}
      className={cn(
        // A column only while open: `flex` on a closed <dialog> would show it.
        'm-auto w-[calc(100%-1.5rem)] rounded-xl border border-border bg-surface-raised p-0 text-text shadow-4 backdrop:bg-overlay open:flex open:flex-col',
        widths[size],
        className,
      )}
    >
      <div
        className={cn(
          'relative flex shrink-0 flex-col gap-3.5 px-6 pt-6 sm:px-6.5 sm:pt-6.5',
          !hasBody && (hasFooter ? 'pb-5' : 'pb-6 sm:pb-6.5'),
        )}
      >
        {tone ? (
          <span
            aria-hidden="true"
            className={cn(
              'grid size-12 place-items-center rounded-[16px]',
              toneTiles[tone].classes,
            )}
          >
            <Icon name={toneTiles[tone].icon} className="size-6" />
          </span>
        ) : null}
        <div className="flex flex-col gap-1.5 pe-8">
          <h2 id={titleId} className="m-0 text-[21px] font-bold leading-tight tracking-tight">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="m-0 text-text-muted">
              {description}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          aria-label={closeLabel}
          onClick={() => {
            if (!canClose || canClose()) ref.current?.close();
          }}
          className="absolute end-3 top-3 grid size-10 place-items-center rounded-full text-text-muted hover:bg-surface-hover hover:text-text pointer-coarse:size-11"
        >
          <Icon name="close" />
        </button>
      </div>
      {hasBody ? (
        <div
          ref={body}
          data-dialog-body=""
          className="min-h-0 overflow-y-auto overscroll-contain focus-visible:rounded-none focus-visible:shadow-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring"
          {...(keyboardStop ? { tabIndex: 0, role: 'group', 'aria-labelledby': titleId } : {})}
        >
          {/* The spacing lives on the inner box, so the room under the last field scrolls with it. A
              popup that draws its own buttons at the end of its body (`sticky bottom-0`, pulled out by
              the same 24/26 px) still lines up with the box's edges. */}
          <div
            ref={content}
            className={cn(
              'flex flex-col gap-3.5 px-6 pt-3.5 sm:px-6.5',
              hasFooter ? 'pb-5' : 'pb-6 sm:pb-6.5',
            )}
          >
            {children}
          </div>
        </div>
      ) : null}
      {hasFooter ? (
        <div
          data-dialog-footer=""
          className={cn(
            'flex shrink-0 flex-col-reverse gap-2.5 px-6 sm:flex-row sm:flex-wrap sm:justify-end sm:px-6.5',
            scrolls ? 'border-t border-border py-4' : 'pb-6 sm:pb-6.5',
          )}
        >
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}
