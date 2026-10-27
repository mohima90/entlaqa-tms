'use client';

import { type ReactNode, useEffect, useId, useRef } from 'react';
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
  readonly size?: 'sm' | 'md' | 'lg' | undefined;
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
const widths = { sm: 'max-w-md', md: 'max-w-[560px]', lg: 'max-w-3xl' } as const;
const toneTiles: Record<
  'danger' | 'warning',
  { readonly icon: IconName; readonly classes: string }
> = {
  danger: { icon: 'warning', classes: 'bg-danger-subtle text-danger' },
  warning: { icon: 'warning', classes: 'bg-warning-subtle text-warning' },
};

/**
 * A modal dialog for confirmations and short questions (direction C: when to use a dialog rather than a
 * side panel — docs/design/redesign-direction-c.md), on the native `<dialog>`: the
 * browser makes the page behind it inert and keeps Tab inside, Escape closes it, and focus returns to
 * the element that opened it. Titled by its heading, described by its description. No inline styles
 * (the CSP allows none): the look is Tailwind classes only.
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
        'm-auto w-[calc(100%-1.5rem)] rounded-xl border border-border bg-surface-raised p-0 text-text shadow-4 backdrop:bg-overlay',
        widths[size],
        className,
      )}
    >
      <div className="relative flex flex-col gap-3.5 p-6 sm:p-6.5">
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
        {children}
        {footer ? (
          <div className="mt-1.5 flex flex-col-reverse gap-2.5 sm:flex-row sm:flex-wrap sm:justify-end">
            {footer}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
