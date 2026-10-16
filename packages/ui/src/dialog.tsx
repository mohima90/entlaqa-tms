'use client';

import { type ReactNode, useEffect, useId, useRef } from 'react';
import { cn } from './cn';
import { Icon } from './icons';

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
  readonly className?: string | undefined;
  readonly children?: ReactNode;
  readonly 'data-testid'?: string | undefined;
}

const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' } as const;

/**
 * A modal dialog for short forms and confirmations (Kawadir Dialog), on the native `<dialog>`: the
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
  className,
  children,
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
      if (event.target === dialog) dialog.close();
    };
    dialog.addEventListener('close', onNativeClose);
    dialog.addEventListener('click', onBackdrop);
    return () => {
      dialog.removeEventListener('close', onNativeClose);
      dialog.removeEventListener('click', onBackdrop);
    };
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      data-testid={testId}
      className={cn(
        'm-auto w-[calc(100%-2rem)] rounded-xl border border-border bg-surface p-0 text-text shadow-3 backdrop:bg-overlay',
        widths[size],
        className,
      )}
    >
      <div className="relative flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1.5 pe-8">
          <h2 id={titleId} className="m-0 text-lg font-semibold leading-tight tracking-tight">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="m-0 text-sm text-text-muted">
              {description}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          aria-label={closeLabel}
          onClick={() => ref.current?.close()}
          className="absolute end-3 top-3 grid size-9 place-items-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text pointer-coarse:size-11"
        >
          <Icon name="close" />
        </button>
        {children}
        {footer ? (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>
        ) : null}
      </div>
    </dialog>
  );
}
